"""Create three PREVIEW deployments of ai-team-hq from the same file set (no target => not production,
no alias). A = current vercel.json. B = excludeFiles on every function, act.py kept. C = like B but also
excludes scripts/** (negative control). A throwaway reader secret is passed per deployment; it is never
printed or stored anywhere but this process and the deployment's own env."""
import hashlib
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("REPO_ROOT", os.getcwd())
OUT = os.environ["EXP_OUT"]  # a directory OUTSIDE the repository: it holds the throwaway secret
TOKEN = os.environ["VERCEL_TOKEN"]
TEAM = "team_ZY2bNbs5CeXioIl7AWeb5tw5"
SKIP_DIRS = {"raw"}


def api(method, path, body=None, headers=None, raw=None):
    url = "https://api.vercel.com" + path + ("&" if "?" in path else "?") + "teamId=" + TEAM
    h = {"Authorization": "Bearer " + TOKEN}
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    for attempt in range(1, 6):
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                txt = r.read()
                return r.status, (json.loads(txt) if txt else {})
        except urllib.error.HTTPError as e:
            txt = e.read()
            try:
                return e.code, json.loads(txt)
            except Exception:
                return e.code, {"raw": txt[:200].decode("utf8", "replace")}
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            # transport-level cut-off (the sandbox proxy can drop a transfer); safe to repeat: every call
            # here is a GET, an idempotent digest upload, or a create that returned nothing
            print(f"  transport error on {method} {path.split('?')[0]} (attempt {attempt}): {type(e).__name__}", flush=True)
            if attempt == 5:
                raise
            time.sleep(2 ** attempt)


# ---- the same file set deploy:hq-page-delta builds ------------------------------------------
files: dict[str, bytes] = {}


def add(name, path):
    files[name] = open(path, "rb").read()


add("index.html", f"{REPO}/web/studio/index.html")
add("api/notebook.py", f"{REPO}/api/notebook.py")
add("api/notebook-act.py", f"{REPO}/api/notebook-act.py")
add("scripts/notebook/act.py", f"{REPO}/scripts/notebook/act.py")
add("requirements.txt", f"{REPO}/requirements.txt")
add("api/zz-probe.py", f"{OUT}/zz-probe.py")  # experiment-only, listed in every variant

top_names: list[str] = []
base = f"{REPO}/web/studio"
for entry in sorted(os.listdir(base)):
    if entry in SKIP_DIRS:
        continue
    full = os.path.join(base, entry)
    top_names.append(entry + "/**" if os.path.isdir(full) else entry)
for dirpath, dirnames, filenames in os.walk(base):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, base).replace(os.sep, "/")
        add("studio/" + rel, full)
        if rel != "index.html":
            add(rel, full)

orig = json.load(open(f"{REPO}/vercel.json"))
assert list(orig["functions"].keys()) == ["api/notebook.py"], orig

ext = sorted({n.rsplit(".", 1)[1] for n in top_names if "/" not in n and "." in n})
assert set(ext) <= {"js", "css", "html"}, ext  # nothing that could be a runtime file (.py .txt .json)
dirs = [n for n in top_names if n.endswith("/**")]
EXCL = [f"*.{e}" for e in ext] + ["studio/**"] + dirs
G_B = "{" + ",".join(EXCL) + "}"
G_C = "{" + ",".join(EXCL + ["scripts/**"]) + "}"
assert len(G_B) <= 256 and len(G_C) <= 256, (len(G_B), len(G_C))
# the required runtime files must never be matched by the exclusion set
import fnmatch
for required in ("api/notebook.py", "api/notebook-act.py", "scripts/notebook/act.py", "requirements.txt", "vercel.json"):
    for pat in EXCL:
        if pat.endswith("/**"):
            assert not required.startswith(pat[:-3] + "/"), (required, pat)
        else:
            assert not fnmatch.fnmatchcase(required, pat) or "/" in required, (required, pat)


def variant_json(glob):
    cfg = json.loads(json.dumps(orig))
    if glob is None:
        return cfg
    cfg["functions"] = {
        "api/notebook.py": {**orig["functions"]["api/notebook.py"], "excludeFiles": glob},
        "api/notebook-act.py": {"excludeFiles": glob},
        "api/zz-probe.py": {"excludeFiles": glob},
    }
    return cfg


VARIANTS = {"B": G_B, "C": G_C}
secret = open(f"{OUT}/.exp-secret").read().strip()
results = dict(json.load(open(f"{OUT}/variants.json"))["variants"])
results = {k: v for k, v in results.items() if k == "A"}
for name, glob in VARIANTS.items():
    f = dict(files)
    f["vercel.json"] = (json.dumps(variant_json(glob), indent=2) + "\n").encode()
    listing = [
        {"file": k, "sha": hashlib.sha1(v).hexdigest(), "size": len(v)} for k, v in sorted(f.items())
    ]
    body = {
        "name": "ai-team-hq",
        "files": listing,
        "projectSettings": {"framework": None},
        "env": {"NOTEBOOK_READER_SECRET": secret},
        "meta": {"experiment": f"functions-excludefiles-{name}", "audit": "2026-10-05"},
    }
    # NOTE: no "target" => a preview deployment; nothing here can move a production alias.
    for _ in range(4):
        status, resp = api("POST", "/v13/deployments?skipAutoDetectionConfirmation=1", body)
        if status == 400 and resp.get("error", {}).get("code") == "missing_files":
            by_sha = {hashlib.sha1(v).hexdigest(): v for v in f.values()}
            for sha in resp["error"].get("missing", []):
                b = by_sha[sha]
                s, _ = api("POST", "/v2/files", headers={
                    "Content-Type": "application/octet-stream", "x-vercel-digest": sha,
                    "Content-Length": str(len(b))}, raw=b)
                assert s in (200, 201), f"upload {s}"
            continue
        break
    if status not in (200, 201):
        print(name, "create failed", status, json.dumps(resp)[:300])
        sys.exit(1)
    results[name] = {"id": resp["id"], "url": resp["url"], "target": resp.get("target"),
                     "files": len(listing), "glob_len": len(glob or "")}
    print(name, "created", resp["id"], "target=", resp.get("target"), "readyState=", resp.get("readyState"))

# secret goes to a 0600 file in the scratchpad (outside the repo) for the test phase, never printed
fd = os.open(f"{OUT}/.exp-secret", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, secret.encode()); os.close(fd)
json.dump({"variants": results, "globs": {"B": G_B, "C": G_C}, "file_count": len(files)}, open(f"{OUT}/variants.json", "w"), indent=1)

deadline = time.time() + 480
pending = set(VARIANTS)
while pending and time.time() < deadline:
    time.sleep(6)
    for name in list(pending):
        s, d = api("GET", f"/v13/deployments/{results[name]['id']}")
        st = d.get("readyState")
        if st in ("READY", "ERROR", "CANCELED"):
            results[name]["state"] = st
            results[name]["alias"] = d.get("alias")
            pending.discard(name)
            print(name, st, "alias=", d.get("alias"), "target=", d.get("target"))
json.dump({"variants": results, "globs": {"B": G_B, "C": G_C}, "file_count": len(files)}, open(f"{OUT}/variants.json", "w"), indent=1)
print("pending:", sorted(pending))
