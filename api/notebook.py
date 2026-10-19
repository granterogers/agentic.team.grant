"""Read from Gemini Notebook over HTTP, so a runtime with no Python can too.

    POST /api/notebook
    Authorization: Bearer <NOTEBOOK_READER_SECRET>
    {"op": "notebooks" | "sources" | "fulltext" | "probe",
     "master_token": {"email": "...", "android_id": "...", "master_token": "aas_et/..."},
     "storage_state": "<the cookie jar, as JSON text>",
     "notebook_id": "...", "source_id": "..."}

The master token is preferred: when it is present a fresh jar is minted from it
for this call, and `storage_state` is used only when there is no master token.

## Why this exists

Every notebook read in this system went through `scripts/notebook/read.py` in a
subprocess. That was fine while a GitHub Actions runner was the worker. Actions
are off, the only worker is a Supabase Edge Function, and Deno has no
subprocesses — so five notebook job kinds and the whole of discovery had no
runtime that could run them (0137).

The read path turns out not to need a browser. `notebooklm-py` depends on
`click`, `filelock`, `httpx` and `rich`; Playwright appears only in the *login*
capture path, which Grant already completed and which produced the cookie jar
in the vault. So the reads are ordinary HTTPS calls in a few hundred kilobytes
of pure Python — which fits in a serverless function on the Vercel project
already serving Team HQ, at no cost and with no new account.

The operations and their JSON shapes are deliberately identical to `read.py`.
Two implementations of the same contract is the point of §7's adapter boundary;
two DIFFERENT contracts would be a second thing to keep in step.

## Why the credential arrives in the request

Vercel stores nothing. §15 puts secrets in the Supabase Vault and nowhere
else, and the caller already has vault access — so it reads the cookie jar and
sends it, over TLS, for the life of one request. The alternative is a copy of
Grant's Google session living in a Vercel environment variable, which is a
second home for a credential and a second thing to rotate.

The cost of that choice, stated plainly: the jar transits a third party on
every read. It is never written to disk here except as a 0600 temp file the
client library requires, never logged, and never included in an error message —
see `fail` below.
"""

from __future__ import annotations

import hmac
import json
import os
import tempfile
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SECRET = os.environ.get("NOTEBOOK_READER_SECRET", "")

# Bigger than any plausible cookie jar and small enough that a stray POST
# cannot exhaust the function's memory.
MAX_BODY = 2_000_000


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def _send(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, status: int, message: str) -> None:
        """Refuse without echoing anything from the request.

        An error that quotes the body is an error that can put a cookie jar in
        a log line. Every message here is a constant.
        """
        self._send(status, {"error": message})

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        # A liveness answer that proves the deployment exists and whether it is
        # configured, without doing anything or revealing what with.
        self._send(200, {"ok": True, "endpoint": "notebook", "configured": SECRET != ""})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        if SECRET == "":
            self._fail(503, "the notebook reader is not configured")
            return

        presented = self.headers.get("Authorization", "")
        prefix = "Bearer "
        token = presented[len(prefix) :] if presented.startswith(prefix) else ""
        # Constant time, so a wrong secret cannot be found one character at a
        # time from the response latency.
        if not hmac.compare_digest(token, SECRET):
            self._fail(401, "unauthorized")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._fail(400, "a content length is required")
            return
        if length <= 0 or length > MAX_BODY:
            self._fail(400, "the request body is missing or too large")
            return

        try:
            request = json.loads(self.rfile.read(length))
        except Exception:
            self._fail(400, "the request body is not JSON")
            return
        if not isinstance(request, dict):
            self._fail(400, "the request body is not an object")
            return

        op = str(request.get("op", ""))
        storage_state = str(request.get("storage_state", ""))
        if storage_state == "" and not isinstance(request.get("master_token"), dict):
            self._fail(400, "a storage state or a master token is required")
            return
        if op not in {"notebooks", "sources", "fulltext", "probe"}:
            self._fail(400, "unknown operation")
            return

        import asyncio

        try:
            self._send(200, asyncio.run(run(op, request, storage_state)))
        except Exception as error:
            # The type and the message from the client library, and nothing
            # from the request. A notebook outage must be distinguishable from
            # a bug here, which needs the message; §7 also requires an outage
            # to degrade rather than look like success.
            self._send(
                502,
                {"error": f"{type(error).__name__}: {str(error)[:300]}"},
            )


async def mint_storage_state(master: dict) -> str:
    """A fresh cookie jar from the durable master token, with no browser.

    A stored jar goes stale, and on 19 October Google served its signed-out page
    to the stored one. The master token does not go stale, and the library mints
    from it in a few HTTPS calls, so each read mints its own jar.
    """
    from notebooklm._auth.master_token import storage_state_from_jar
    from notebooklm.auth import mint_cookies

    email = str(master.get("email", ""))
    jar = await mint_cookies(
        email, str(master.get("master_token", "")), str(master.get("android_id", ""))
    )
    return json.dumps(storage_state_from_jar(jar, email=email or None))


async def run(op: str, request: dict, storage_state: str) -> object:
    from notebooklm import NotebookLMClient

    # Present, the master token wins over any stored jar. A mint failure is
    # raised as it is, so the caller sees why instead of a stale jar's sign-in page.
    master = request.get("master_token")
    if isinstance(master, dict):
        storage_state = await mint_storage_state(master)

    # The library wants a path. `/tmp` is the only writable place in a
    # serverless function and is per-invocation; 0600 because the file is a
    # live Google session for as long as it exists.
    with tempfile.TemporaryDirectory(prefix="nlm-") as directory:
        storage_path = Path(directory) / "storage_state.json"
        storage_path.write_text(storage_state)
        storage_path.chmod(0o600)

        async with NotebookLMClient.from_storage(storage_path) as client:
            if op == "notebooks":
                return [
                    {"id": nb.id, "title": getattr(nb, "title", "") or ""}
                    for nb in await client.notebooks.list()
                ]

            if op == "probe":
                started = time.monotonic()
                capabilities: list[str] = []
                tier = notebook_limit = source_limit = None
                notebooks = await client.notebooks.list()
                capabilities.append("list_notebooks")
                try:
                    limits = await client.settings.get_account_limits()
                    tier = getattr(limits, "tier", None)
                    notebook_limit = getattr(limits, "notebook_limit", None)
                    source_limit = getattr(limits, "source_limit", None)
                    capabilities.append("account_limits")
                except Exception:
                    pass
                return {
                    # Never "available". §7 lists them separately because the
                    # private RPC path working today is not a promise.
                    "state": "available_unofficial"
                    if "account_limits" in capabilities
                    else "degraded",
                    "capabilities": capabilities,
                    "detected_tier": tier,
                    "notebook_limit": notebook_limit,
                    "source_limit": source_limit,
                    "notebook_count": len(notebooks),
                    "latency_ms": int((time.monotonic() - started) * 1000),
                    "detail": f"{len(notebooks)} notebook(s); {', '.join(capabilities)}",
                }

            notebook_id = str(request.get("notebook_id", ""))
            if notebook_id == "":
                raise ValueError("a notebook id is required")

            if op == "sources":
                # Metadata AND fulltext, exactly as `read.py` does it: §7's
                # quota design is to pull each source's text once, cache it in
                # Postgres, and let agents reason over the cache at zero
                # notebook quota. A listing without text leaves that cache
                # permanently empty.
                out: list[dict[str, object]] = []
                for source in await client.sources.list(notebook_id):
                    content = ""
                    try:
                        full = await client.sources.get_fulltext(notebook_id, source.id)
                        content = (
                            getattr(full, "content", None) or getattr(full, "text", "") or ""
                        )
                    except Exception:
                        # Per-source and non-fatal. "We know this exists and
                        # could not read it" is a more useful state than "we
                        # never saw it".
                        content = ""
                    updated = getattr(source, "updated_at", None) or getattr(
                        source, "last_modified", None
                    )
                    out.append(
                        {
                            "remote_notebook_id": notebook_id,
                            "remote_source_id": source.id,
                            "title": getattr(source, "title", None),
                            "content": content,
                            "remote_updated_at": updated.isoformat()
                            if hasattr(updated, "isoformat")
                            else None,
                        }
                    )
                return out

            source_id = str(request.get("source_id", ""))
            if source_id == "":
                raise ValueError("a source id is required")
            full = await client.sources.get_fulltext(notebook_id, source_id)
            return {
                "remote_notebook_id": notebook_id,
                "remote_source_id": source_id,
                "title": getattr(full, "title", None),
                "content": getattr(full, "content", None) or getattr(full, "text", "") or "",
                "remote_updated_at": None,
            }
