"""Measure bundle sizes and run one identical request matrix against preview variants A, B, C."""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

OUT = os.environ["EXP_OUT"]  # a directory OUTSIDE the repository: it holds the throwaway secret
TOKEN = os.environ["VERCEL_TOKEN"]
TEAM = "team_ZY2bNbs5CeXioIl7AWeb5tw5"
SECRET = open(f"{OUT}/.exp-secret").read().strip()
V = json.load(open(f"{OUT}/variants.json"))["variants"]
JAR = json.dumps({"cookies": [], "origins": []})  # deliberately invalid: no Google session


def call(method, url, headers=None, data=None, timeout=90):
    for attempt in range(1, 5):
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, e.read(), dict(e.headers)
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            if attempt == 4:
                return -1, f"TRANSPORT {type(e).__name__}".encode(), {}
            time.sleep(2 ** attempt)


def vapi(path):
    s, b, _ = call("GET", f"https://api.vercel.com{path}{'&' if '?' in path else '?'}teamId={TEAM}",
                   {"Authorization": "Bearer " + TOKEN})
    return json.loads(b)


def js(o):
    return json.dumps(o).encode()


GOOD = {"Authorization": "Bearer " + SECRET, "Content-Type": "application/json"}
BAD = {"Authorization": "Bearer " + SECRET + "x", "Content-Type": "application/json"}
NONE = {"Content-Type": "application/json"}

MATRIX = [
    ("reader GET liveness", "GET", "/api/notebook", None, None),
    ("reader POST no auth", "POST", "/api/notebook", NONE, js({"op": "notebooks", "storage_state": JAR})),
    ("reader POST wrong bearer", "POST", "/api/notebook", BAD, js({"op": "notebooks", "storage_state": JAR})),
    ("reader POST empty body", "POST", "/api/notebook", GOOD, b""),
    ("reader POST not JSON", "POST", "/api/notebook", GOOD, b"not json at all"),
    ("reader POST unknown op", "POST", "/api/notebook", GOOD, js({"op": "nope", "storage_state": JAR})),
    ("reader POST missing storage", "POST", "/api/notebook", GOOD, js({"op": "notebooks"})),
    ("reader POST notebooks invalid jar", "POST", "/api/notebook", GOOD, js({"op": "notebooks", "storage_state": JAR})),
    ("writer GET liveness", "GET", "/api/notebook-act", None, None),
    ("writer POST no auth", "POST", "/api/notebook-act", NONE, js({"action": "notebooks", "storage_state": JAR})),
    ("writer POST wrong bearer", "POST", "/api/notebook-act", BAD, js({"action": "notebooks", "storage_state": JAR})),
    ("writer POST unknown action", "POST", "/api/notebook-act", GOOD, js({"action": "nope", "storage_state": JAR})),
    ("writer POST missing storage", "POST", "/api/notebook-act", GOOD, js({"action": "notebooks"})),
    ("writer POST args not object", "POST", "/api/notebook-act", GOOD, js({"action": "notebooks", "storage_state": JAR, "args": 5})),
    ("writer POST notebooks invalid jar (runs act.py)", "POST", "/api/notebook-act", GOOD,
     js({"action": "notebooks", "args": {"notebook_id": "any"}, "storage_state": JAR})),
]

report = {}
for name, v in V.items():
    dep = vapi(f"/v13/deployments/{v['id']}")
    builds = vapi(f"/v13/deployments/{v['id']}/builds")
    fns = []
    for b in builds.get("builds", []):
        for o in b.get("output") or []:
            if o.get("type") == "lambda":
                l = o.get("lambda") or {}
                fns.append({"path": o["path"], "size": o["size"], "digest": o["digest"].split("/")[-1][:12],
                            "memory": l.get("memorySize"), "timeout": l.get("timeout"),
                            "runtime": l.get("runtime"), "regions": l.get("deployedTo")})
    base = "https://" + v["url"]
    rows = []
    for label, method, path, headers, data in MATRIX:
        s, b, h = call(method, base + path, headers, data)
        text = b.decode("utf8", "replace")
        assert SECRET not in text and JAR not in text, "response echoed the secret or the submitted jar"
        rows.append({"check": label, "status": s, "body_sha": hashlib.sha256(b).hexdigest()[:12], "body": text[:230]})
    s, b, _ = call("GET", base + "/api/zz-probe")
    try:
        probe = json.loads(b)
    except Exception:
        probe = {"error": b[:200].decode("utf8", "replace"), "status": s}
    report[name] = {"id": v["id"], "target": dep.get("target"), "alias": dep.get("alias"),
                    "state": dep.get("readyState"), "functions": fns, "matrix": rows, "probe": probe}
    print(name, "measured", flush=True)

json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)
print("saved")
