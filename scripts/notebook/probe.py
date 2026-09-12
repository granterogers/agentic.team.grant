"""Probe NotebookLM with the vaulted credential and report what actually works.

    npm run notebook:probe

Python rather than TypeScript because the adapter library is Python and §7's
rule is a strict `NotebookAdapter` boundary, not a strict language. Re-writing
NotebookLM's private RPC protocol in TypeScript to keep the stack uniform would
mean maintaining an undocumented wire format by hand - which is exactly the
risk §7 says to contain behind an adapter, not to take on.

Output is a single JSON object on stdout, which the TypeScript side records as
a capability probe. Nothing else is printed to stdout, so the caller can parse
it without pattern-matching log lines.

The state this reports is `available_unofficial` at best, never `available`.
§7 lists them as different states for a reason: the private RPC path working
today carries no stability promise, and calling that `available` would hide
the exact risk the adapter boundary exists to contain.

## The API this is written against

The first version of this file was written against a *guessed* API -
`client.list_notebooks()`, synchronous - and every call failed. The real
library is **async** and namespaced: an async context manager yielding
`client.notebooks.list()`, `client.sources.list(id)`,
`client.settings.get_account_limits()`.

That is worth a note rather than a silent correction. §7 calls this adapter
high-risk *because* its behaviour is undocumented, and the first thing that
went wrong was not the undocumented Google protocol - it was assuming the
shape of the Python wrapper without reading it. The lesson generalises: for a
dependency whose whole risk profile is "we cannot rely on documentation",
reading the source is the cheap step, not the thorough one.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path


def emit(payload: dict[str, object]) -> None:
    """One JSON object on stdout, then stop."""
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(state: str, detail: str, **extra: object) -> None:
    emit({"state": state, "capabilities": [], "detail": detail, **extra})
    sys.exit(0)  # Not an error: reporting unavailability IS the job.


storage_raw = os.environ.get("NOTEBOOK_STORAGE_STATE", "")
if not storage_raw:
    fail("auth_required", "no credential was passed to the probe")

try:
    import notebooklm
    from notebooklm import AuthTokens, NotebookLMClient
except ImportError as exc:  # pragma: no cover - environment problem, not logic
    fail("unavailable", f"notebooklm is not importable: {exc}")

version = getattr(notebooklm, "__version__", "unknown")

# The library reads a storage_state.json from disk. Written to a private
# temporary path rather than the default profile location so a probe never
# disturbs a real profile, and unlinked in the finally block below.
storage_path = Path(os.environ.get("NOTEBOOK_STORAGE_PATH", "/tmp/nlm-probe/storage_state.json"))
storage_path.parent.mkdir(parents=True, exist_ok=True)
storage_path.write_text(storage_raw)
storage_path.chmod(0o600)


async def probe() -> dict[str, object]:
    started = time.monotonic()
    capabilities: list[str] = []
    tier: int | None = None
    notebook_limit: int | None = None
    source_limit: int | None = None

    try:
        # `AuthTokens.from_storage`, not `auth.load_auth_from_storage`. The
        # latter returns a flat name->value dict of cookies, which the client
        # accepts without complaint and then fails on deep inside with
        # "'dict' object has no attribute 'storage_path'" - an error message
        # that names a symptom three layers from the cause. It is also a
        # coroutine, so it must be awaited; without the await the same
        # attribute error reappears naming 'coroutine' instead of 'dict',
        # which is the same lesson arriving twice.
        tokens = await AuthTokens.from_storage(storage_path)
    except Exception as exc:
        return {
            "state": "auth_required",
            "capabilities": [],
            "adapter_version": version,
            "detail": f"the credential did not load: {type(exc).__name__}: {exc}"[:300],
        }

    async with NotebookLMClient(tokens, storage_path=storage_path) as client:
        account = None
        try:
            account = await client.get_account_email()
        except Exception:
            pass

        # Capability 1: can we list at all? The cheapest real call, and the one
        # that distinguishes "signed in" from "has a cookie file".
        try:
            notebooks = await client.notebooks.list()
            capabilities.append("list_notebooks")
        except Exception as exc:
            name = type(exc).__name__
            # An auth failure and an outage need different responses, so they
            # are reported as different states rather than one generic failure.
            text = str(exc)
            state = "auth_required" if "Auth" in name or "401" in text else "unavailable"
            return {
                "state": state,
                "capabilities": [],
                "adapter_version": version,
                "account": account,
                "detail": f"notebooks.list failed: {name}: {text}"[:300],
                "latency_ms": int((time.monotonic() - started) * 1000),
            }

        # Capability 2: the account's real limits. §11 is explicit that these
        # are read, never hard-coded - "Google changes them without updating
        # its own published tables". A failure here is DEGRADED, not fatal: we
        # can work without knowing the tier, we just cannot budget against it.
        try:
            limits = await client.settings.get_account_limits()
            tier = getattr(limits, "tier", None)
            notebook_limit = getattr(limits, "notebook_limit", None)
            source_limit = getattr(limits, "source_limit", None)
            capabilities.append("account_limits")
        except Exception:
            pass

        # Capability 3: reading a notebook's sources, which is what the whole
        # quota design depends on - pull each source's text once, cache it, and
        # reason over the cache at zero Notebook quota.
        source_count = None
        first = notebooks[0] if notebooks else None
        if first is not None:
            try:
                sources = await client.sources.list(first.id)
                source_count = len(sources)
                capabilities.append("list_sources")
            except Exception:
                pass

        # Capability 4 onwards: what the adapter OFFERS, checked without
        # calling it.
        #
        # Issue #64. This table reported `list_notebooks, account_limits,
        # list_sources` while `act.py` demonstrably creates notebooks, uploads
        # sources and generates audio — so an agent consulting it told Grant it
        # could not create a notebook, in the same conversation in which it
        # told him it could not send a button.
        #
        # The three above are PROBED: they were called and they worked. A write
        # cannot be probed that way without creating a notebook on every run,
        # which is wasteful and litters his account. So these are checked by
        # asking the client whether the method is there — a weaker claim, and
        # an honest one, and enough to stop an agent denying a capability the
        # office uses daily.
        #
        # Named `offers_*` for exactly that reason: a reader can tell which
        # half was exercised and which half was only found.
        for name, path in (
            ("create_notebook", ("notebooks", "create")),
            ("add_source_url", ("sources", "add_url")),
            ("add_source_text", ("sources", "add_text")),
            ("delete_source", ("sources", "delete")),
            ("generate_artifact", ("artifacts", "retry_failed")),
            ("list_artifacts", ("artifacts", "list")),
            ("download_artifact", ("artifacts", "get")),
            ("create_note", ("notes", "create")),
            ("ask", ("chat", "ask")),
        ):
            group = getattr(client, path[0], None)
            if group is not None and callable(getattr(group, path[1], None)):
                capabilities.append(f"offers_{name}")

        latency_ms = int((time.monotonic() - started) * 1000)

        # DEGRADED when the basics work but something expected did not.
        # Reporting `available_unofficial` while a capability is missing would
        # be the same error as calling a stored credential a working one.
        state = "available_unofficial"
        # Only the probed three decide the state. An `offers_` entry says the
        # method exists, which is not evidence that it works, and letting it
        # promote the state would be the stored-credential error again.
        if first is not None and "list_sources" not in capabilities:
            state = "degraded"
        if "account_limits" not in capabilities:
            state = "degraded"

        return {
            "state": state,
            "capabilities": capabilities,
            "adapter_version": version,
            "detected_tier": tier,
            "notebook_limit": notebook_limit,
            "source_limit": source_limit,
            "notebook_count": len(notebooks),
            "source_count": source_count,
            # The account, so it is obvious in the probe history if a personal
            # account was used by mistake. An email address, never a token.
            "account": account,
            "detail": (
                f"{len(notebooks)} notebook(s)"
                + (f", {source_count} source(s) in the first" if source_count is not None else "")
                + f"; capabilities: {', '.join(capabilities) or 'none'}"
            ),
            "latency_ms": latency_ms,
        }


try:
    emit(asyncio.run(probe()))
except Exception as exc:  # noqa: BLE001 - any failure must still report a state
    fail("unavailable", f"the probe raised {type(exc).__name__}: {exc}"[:300],
         adapter_version=version)
finally:
    # The credential does not stay on disk after the probe.
    try:
        storage_path.unlink(missing_ok=True)
    except OSError:
        pass
