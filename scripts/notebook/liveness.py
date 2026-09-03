"""Does this credential actually authenticate to NotebookLM?

    python3 scripts/notebook/liveness.py   (reads NOTEBOOK_CANDIDATE_STATE)

Prints one JSON object: {"alive": bool, "detail": str, "notebooks": int|null}.

## Why this asks the library rather than making its own HTTP request

The first version did a plain `httpx` GET to notebooklm.google.com and
myaccount.google.com with redirects disabled, and treated "redirects to
accounts.google.com" as dead. That heuristic is unsound, and it cost Grant a
single-use token: a freshly minted, *verified* jar was rejected by it, and the
bootstrap threw the credential away on the strength of that verdict.

A bare GET to notebooklm.google.com 302s even for a valid session - account
resolution, regional hosts, `/u/0/` - so a redirect proves nothing either way.

The library already answers this question properly. `master_token_bootstrap`'s
own `verify=True` step is `_verify_by_listing_notebooks`, which authenticates
and performs a real RPC. That is the authoritative check, so this file now runs
the same one instead of inventing a worse one alongside it.

The general lesson, which this build keeps relearning: when a dependency ships
a way to answer a question about itself, a hand-rolled approximation is not a
second opinion - it is a worse first one.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path


def emit(payload: dict[str, object]) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


async def main() -> None:
    raw = os.environ.get("NOTEBOOK_CANDIDATE_STATE", "")
    if not raw:
        emit({"alive": False, "detail": "no candidate was passed", "notebooks": None})
        return

    try:
        json.loads(raw)
    except ValueError as exc:
        emit({"alive": False, "detail": f"not valid JSON: {exc}", "notebooks": None})
        return

    try:
        from notebooklm import NotebookLMClient
    except ImportError as exc:
        emit({"alive": False, "detail": f"notebooklm is not importable: {exc}", "notebooks": None})
        return

    directory = Path(tempfile.mkdtemp(prefix="nlm-liveness-"))
    storage_path = directory / "storage_state.json"
    storage_path.write_text(raw)
    storage_path.chmod(0o600)

    try:
        # `NotebookLMClient.from_storage`, not the deprecated
        # `AuthTokens.from_storage`: the library warns that the latter goes
        # away in v1.0 and that auth belongs inside the managed client
        # lifecycle. Loading and listing therefore share one try, because with
        # the managed client they are one operation.
        try:
            async with NotebookLMClient.from_storage(storage_path) as client:
                notebooks = await client.notebooks.list()
        except Exception as exc:  # noqa: BLE001
            emit(
                {
                    "alive": False,
                    "detail": f"notebooks.list failed: {type(exc).__name__}: {exc}"[:250],
                    "notebooks": None,
                }
            )
            return

        emit(
            {
                "alive": True,
                "detail": f"authenticated; notebooks.list returned {len(notebooks)}",
                "notebooks": len(notebooks),
            }
        )
    finally:
        # Only the temporary copy is removed. The caller owns the credential
        # itself and has already stored it.
        try:
            storage_path.unlink(missing_ok=True)
            directory.rmdir()
        except OSError:
            pass


asyncio.run(main())
