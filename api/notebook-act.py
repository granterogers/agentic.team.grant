"""Write to Gemini Notebook over HTTP, so a runtime with no subprocess can too.

    POST /api/notebook-act
    Authorization: Bearer <NOTEBOOK_READER_SECRET>
    {"action": "add_text" | "generate" | "poll" | ...,
     "args": {...},
     "storage_state": "<the cookie jar, as JSON text>"}

The read side moved to `api/notebook.py` first (0138). This is the other half,
and it is the harder half, so it is worth saying exactly how little it does.

## It does not reimplement anything

Every notebook write lives in `scripts/notebook/act.py` — fourteen actions,
quota detection, the argument order the library actually wants, and a docstring
per mistake already made. Copying that here would be a second implementation of
a delicate contract, and the two would drift on the first library update.

So this spawns it. `sys.executable` is the same Python that imports
`notebooklm`, `act.py` ships in the deployment, and its stdout is already a
one-line JSON contract — `{"ok": true, ...}` on success and `{"ok": false,
"error": ..., "quota": ...}` with exit 1 on a handled failure. Both are relayed
verbatim, so `NotebookActions` on the other side parses exactly what it parses
today.

A serverless function spawning a subprocess looks like the thing the move away
from subprocesses was meant to avoid. It is the opposite: the point was never
that subprocesses are bad, it is that the Supabase Edge worker is Deno and
cannot have one. Here there is a Python runtime, so the work runs where the
runtime is and the office reaches it over HTTPS.

## Why the timeout is the interesting part

§7: *"Never blindly retry an ambiguous Notebook write. After a timeout or
uncertain write, reconcile actual Notebook state first."*

A write that reached Google and then ran out of function time looks identical
to one that never arrived. That case is reported as `timeout: true` and NOT as
an ordinary error, so the caller can raise `AmbiguousWriteError` rather than
retrying into a duplicate source. Getting this wrong is how you end up with
three copies of the same document in Grant's notebook and no way to tell which.

## The credential

Read from the vault by the caller and sent in the request, exactly as for the
read side: Vercel stores nothing, §15 keeps one home for a secret, and the jar
lives on disk here only as a 0600 file in a per-invocation temp directory.
"""

from __future__ import annotations

import hmac
import json
import os
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SECRET = os.environ.get("NOTEBOOK_READER_SECRET", "")

# Every action `act.py` knows. Named here as well, so an unknown action is
# refused before a process is spawned rather than after.
ACTIONS = {
    "add_text",
    "add_url",
    "create_note",
    "create_notebook",
    "generate",
    "poll",
    "retry",
    "artifacts",
    "sources",
    "ask",
    "notebooks",
    "delete_source",
    "delete_artifact",
}

# Under Vercel's own ceiling (60s, set in vercel.json), so the subprocess is
# killed by us with a message rather than by the platform with a 504 and no
# body. The difference is whether the caller can tell an ambiguous write from
# an unreachable endpoint.
RUN_TIMEOUT_S = 50

MAX_BODY = 4_000_000


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def _send(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        self._send(
            200,
            {"ok": True, "endpoint": "notebook-act", "configured": SECRET != ""},
        )

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        if SECRET == "":
            self._send(503, {"ok": False, "error": "the notebook writer is not configured"})
            return

        presented = self.headers.get("Authorization", "")
        prefix = "Bearer "
        token = presented[len(prefix) :] if presented.startswith(prefix) else ""
        if not hmac.compare_digest(token, SECRET):
            self._send(401, {"ok": False, "error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(400, {"ok": False, "error": "a content length is required"})
            return
        if length <= 0 or length > MAX_BODY:
            self._send(400, {"ok": False, "error": "the request body is missing or too large"})
            return

        try:
            request = json.loads(self.rfile.read(length))
        except Exception:
            self._send(400, {"ok": False, "error": "the request body is not JSON"})
            return
        if not isinstance(request, dict):
            self._send(400, {"ok": False, "error": "the request body is not an object"})
            return

        action = str(request.get("action", ""))
        storage_state = str(request.get("storage_state", ""))
        args = request.get("args", {})
        if action not in ACTIONS:
            self._send(400, {"ok": False, "error": "unknown action"})
            return
        if storage_state == "":
            self._send(400, {"ok": False, "error": "a storage state is required"})
            return
        if not isinstance(args, dict):
            self._send(400, {"ok": False, "error": "args must be an object"})
            return

        self._send(*run(action, args, storage_state))


def run(action: str, args: dict, storage_state: str) -> tuple[int, object]:
    script = Path(__file__).resolve().parent.parent / "scripts" / "notebook" / "act.py"
    if not script.exists():
        # Named precisely, because the cause is a deployment that did not carry
        # the script rather than anything about Google.
        return 500, {"ok": False, "error": f"act.py is not in this deployment ({script})"}

    with tempfile.TemporaryDirectory(prefix="nlm-act-") as directory:
        environment = {
            **os.environ,
            # Through the environment, not argv: argv is world-readable in `ps`
            # and this is a live Google session.
            "NOTEBOOK_STORAGE_STATE": storage_state,
            "NOTEBOOK_STORAGE_DIR": directory,
        }
        try:
            completed = subprocess.run(  # noqa: S603 - fixed script, no shell
                [sys.executable, str(script), action, json.dumps(args)],
                capture_output=True,
                text=True,
                env=environment,
                timeout=RUN_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            # §7's ambiguous write. NOT an error the caller may retry: the
            # write may well have reached Google, and asking again is how one
            # source becomes three.
            return 504, {
                "ok": False,
                "timeout": True,
                "action": action,
                "error": (
                    f"{action} did not finish within {RUN_TIMEOUT_S}s. Whether it reached "
                    "Google is unknown — reconcile before any retry (§7)."
                ),
            }
        except Exception as error:  # noqa: BLE001 - the message is the point
            return 500, {
                "ok": False,
                "action": action,
                "error": f"{type(error).__name__}: {str(error)[:300]}",
            }

    text = (completed.stdout or "").strip()
    start = text.find("{")
    if start == -1:
        # No JSON at all means the script died before its own error handling —
        # an import failure, a missing dependency. stderr says which, and it
        # cannot contain the cookie jar because that never reaches argv or a
        # message.
        return 500, {
            "ok": False,
            "action": action,
            "error": (completed.stderr or "the runner produced no output").strip()[:300],
        }

    try:
        payload = json.loads(text[start:])
    except Exception:
        return 500, {"ok": False, "action": action, "error": text[:300]}

    # 200 either way. A handled failure is a well-formed answer, and the caller
    # reads `ok`, exactly as it does when it spawns the script itself. Making
    # this a 4xx would give the same outcome two shapes depending on transport.
    return 200, payload
