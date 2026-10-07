"""Serve ONE Vercel Python function from a materialised bundle on a local port. Used only by scripts/verify/notebook-bundle.ts.

    python serve-function.py <bundle>/api/notebook-act.py

It loads the function file from where it sits in the bundle (so the function's own `Path(__file__).parent.parent / "scripts" /
"notebook" / "act.py"` resolves inside the bundle, exactly as it does on Vercel), serves its `handler` class on an ephemeral
loopback port, and prints that port as the first line. It reads no secret itself: the function reads NOTEBOOK_READER_SECRET from
the environment its parent gave it. Never ship this file; it is not in the page upload set.
"""

import http.server
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("bundle_function", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), module.handler)
print(server.server_address[1], flush=True)
server.serve_forever()
