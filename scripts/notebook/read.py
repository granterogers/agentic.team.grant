"""Read from NotebookLM and print it as JSON. The adapter's live read side.

    python3 scripts/notebook/read.py <op> [args...]

Operations, all read-only:

    notebooks                      -> [{id, title}]
    sources <notebook_id>          -> [{remote_notebook_id, remote_source_id,
                                        title, content, remote_updated_at}]
    fulltext <notebook_id> <src>   -> one source object
    probe                          -> capability object

Reads are separated from writes deliberately. Every Notebook *write* in this
system goes through `notebook_sync_queue` (migration 0015), which is what makes
§7's "never blindly retry an ambiguous write" enforceable: a module that could
write directly could not be held to it. This file therefore has no write
operation at all, and that absence is the enforcement.

## Why `sources` fetches fulltext

`sources.list` returns metadata; the text arrives from `get_fulltext`. §7's
quota design is to pull each source's text **once**, cache it in Postgres, and
let agents reason over the cache at zero Notebook quota — so a listing without
text would leave the cache permanently empty and the design unimplemented.

Fulltext failures are per-source and non-fatal. A source whose text cannot be
read is still worth recording as present with empty content, because "we know
this exists and could not read it" is a different and more useful state than
"we never saw it".
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path


def emit(payload: object) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")
    sys.stdout.flush()


def die(message: str) -> None:
    emit({"error": message})
    sys.exit(1)


async def main() -> None:
    if len(sys.argv) < 2:
        die("usage: read.py <notebooks|sources|fulltext|probe> [args]")
    op = sys.argv[1]

    raw = os.environ.get("NOTEBOOK_STORAGE_STATE", "")
    if not raw:
        die("NOTEBOOK_STORAGE_STATE is not set")

    from notebooklm import NotebookLMClient

    directory = Path(os.environ.get("NOTEBOOK_STORAGE_DIR", "/tmp/nlm-read"))
    directory.mkdir(parents=True, exist_ok=True)
    storage_path = directory / "storage_state.json"
    storage_path.write_text(raw)
    storage_path.chmod(0o600)

    async with NotebookLMClient.from_storage(storage_path) as client:
        if op == "notebooks":
            notebooks = await client.notebooks.list()
            emit([{"id": nb.id, "title": getattr(nb, "title", "") or ""} for nb in notebooks])
            return

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
            emit(
                {
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
            )
            return

        if op == "sources":
            if len(sys.argv) < 3:
                die("sources needs a notebook id")
            notebook_id = sys.argv[2]
            sources = await client.sources.list(notebook_id)
            out: list[dict[str, object]] = []
            for source in sources:
                content = ""
                try:
                    full = await client.sources.get_fulltext(notebook_id, source.id)
                    content = getattr(full, "content", None) or getattr(full, "text", "") or ""
                except Exception:
                    # Non-fatal, and deliberately so: see the module docstring.
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
            emit(out)
            return

        if op == "fulltext":
            if len(sys.argv) < 4:
                die("fulltext needs a notebook id and a source id")
            notebook_id, source_id = sys.argv[2], sys.argv[3]
            full = await client.sources.get_fulltext(notebook_id, source_id)
            emit(
                {
                    "remote_notebook_id": notebook_id,
                    "remote_source_id": source_id,
                    "title": getattr(full, "title", None),
                    "content": getattr(full, "content", None) or getattr(full, "text", "") or "",
                    "remote_updated_at": None,
                }
            )
            return

        die(f"unknown operation {op}")


asyncio.run(main())
