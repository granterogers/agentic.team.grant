"""Why do slide decks fail? Read-only — nothing is generated.

Four attempts across two sessions have all come back `failed` from Google within
twenty minutes, on a notebook where audio overviews and mind maps succeed. The
artifact simply arrives failed with no error detail, which leaves two very
different explanations that look identical from outside:

  - the tier does not offer slide decks at all, and the API accepts the request
    anyway and fails it later;
  - it does offer them, and something about this notebook's sources breaks it.

`get_customization_choices` answers the first question without spending anything.
Grant requires manual approval for any generation (0083), and a retry consumes
the allowance like any other, so this script deliberately cannot generate — it
reports what is free to know and stops.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from notebooklm import NotebookLMClient


async def main() -> None:
    state = os.environ.get("NOTEBOOK_STORAGE_STATE")
    if not state:
        print(json.dumps({"ok": False, "error": "NOTEBOOK_STORAGE_STATE is not set"}))
        sys.exit(1)
    notebook = sys.argv[1] if len(sys.argv) > 1 else None

    # Same construction as `act.py`: the library reads a FILE, so the credential
    # is written to a private path in a temp directory rather than passed as a
    # string. Kept identical on purpose — two ways of building this client is
    # two places for the file mode to be wrong.
    directory = Path(os.environ.get("NOTEBOOK_STORAGE_DIR", "/tmp/nlm-diag"))
    directory.mkdir(parents=True, exist_ok=True)
    storage_path = directory / "storage_state.json"
    storage_path.write_text(state)
    storage_path.chmod(0o600)

    async with NotebookLMClient.from_storage(storage_path) as client:
        out: dict[str, object] = {"ok": True}

        # Which artifact kinds this account is actually offered, per notebook.
        try:
            choices = await client.artifacts.get_customization_choices(notebook)
            out["choices"] = {
                k: str(v)[:200]
                for k, v in vars(choices).items()
                if not k.startswith("_")
            }
        except Exception as error:  # noqa: BLE001 - the failure IS the finding
            out["choices_error"] = f"{type(error).__name__}: {error}"

        if notebook:
            try:
                decks = await client.artifacts.list_slide_decks(notebook)
                out["slide_decks"] = [
                    {
                        "id": getattr(d, "id", None),
                        "title": getattr(d, "title", None),
                        "status": getattr(d, "status_str", None),
                        "failed": getattr(d, "is_failed", None),
                        "created": str(getattr(d, "created_at", "") or ""),
                    }
                    for d in decks
                ]
            except Exception as error:  # noqa: BLE001
                out["slide_decks_error"] = f"{type(error).__name__}: {error}"

            try:
                everything = await client.artifacts.list(notebook)
                out["by_kind"] = {}
                for a in everything:
                    # `artifact_type` is not the attribute name; the first version read it,
                    # got nothing, and reported every artifact as "unknown" — which is a
                    # diagnostic lying about the thing it exists to diagnose.
                    kind = str(getattr(a, "type", None) or getattr(a, "kind", None) or "unknown")
                    row = out["by_kind"].setdefault(kind, {"total": 0, "failed": 0})
                    row["total"] += 1
                    if getattr(a, "is_failed", False):
                        row["failed"] += 1
            except Exception as error:  # noqa: BLE001
                out["list_error"] = f"{type(error).__name__}: {error}"

        print(json.dumps(out, indent=2, default=str))


asyncio.run(main())
