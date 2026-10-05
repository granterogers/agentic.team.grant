"""EXPERIMENT ONLY. Lists what is inside this function's bundle so exclusions can be
measured by name, not inferred from a size. Not part of the repository or production."""
import json
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path


class handler(BaseHTTPRequestHandler):  # noqa: N801
    def do_GET(self) -> None:  # noqa: N802
        root = Path(__file__).resolve().parent.parent
        top: dict[str, dict[str, int]] = {}
        total = 0
        count = 0
        site_packages = 0
        for path, _dirs, names in os.walk(root):
            for name in names:
                full = Path(path) / name
                try:
                    size = full.stat().st_size
                except OSError:
                    continue
                rel = full.relative_to(root)
                key = rel.parts[0]
                slot = top.setdefault(key, {"files": 0, "bytes": 0})
                slot["files"] += 1
                slot["bytes"] += size
                total += size
                count += 1
        act = root / "scripts" / "notebook" / "act.py"
        try:
            import notebooklm  # noqa: F401

            lib = "importable"
        except Exception as error:  # noqa: BLE001
            lib = f"{type(error).__name__}: {str(error)[:120]}"
        body = json.dumps(
            {
                "root_entries": sorted(os.listdir(root)),
                "top_level": top,
                "files": count,
                "bytes": total,
                "act_py_present": act.exists(),
                "notebooklm": lib,
                "site_packages_bytes": site_packages,
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
