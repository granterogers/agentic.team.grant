# Running Hermes for the office: the host runbook

Status: written in M5, **never run on a real host by this work**. Every step below was exercised against a replica with a real Hermes and a
scripted model (`scripts/isolated/engine-bridge.ts`); nothing has been run against production, against a free model on a real key, or on a machine
that is not this build sandbox. Steps marked **(Grant)** are decisions or credentials only Grant can supply. Nothing here switches Hermes on:
the last step is a separate, deliberate act.

## 0. What this is, in one paragraph

Hermes is an open-source agent. The office can hand ONE message to it, when the person chooses Hermes for that message. Hermes runs on a machine
Grant owns, reads the office through a read-only door, and its answer comes back through the office's own gates labelled as an inference. The
team never runs a message the person sent to Hermes, and Hermes never runs a message the person sent to the team. There is no automatic fallback in
either direction. It costs nothing: the model is a `:free` OpenRouter model on a key whose credit limit is zero, and the machine is yours.

## 1. Decide where it runs **(Grant: G1)**

Recommended: a machine you already own that is on when you are (an idle laptop or a home server). Hermes measured 290 to 336 MB; plan for 1 GB
free. A free cloud tier is possible but not recommended: free tiers sleep, and a sleeping host makes Hermes "unavailable", which the office says
plainly and never works around. Two processes run there: Hermes (loopback only) and the bridge (outbound only). Neither listens on a public port.

## 2. Install Hermes at the validated commit

Hermes `NousResearch/hermes-agent` at `d4d2ab7b5d104166e7e22a02cafd12f1fe456a31` (10 October 2026, MIT) is what M0 and M5 ran against. Install it
into `/opt/hermes/venv` as an unprivileged `hermes` user, from a checkout at that commit (record the commit you used if you change it, and re-run
`scripts/isolated/engine-bridge.ts` before trusting a newer one). Create `/var/lib/hermes/{home,work}` owned by `hermes`.

## 3. Credentials **(Grant: G4)**

* **The Hermes-only OpenRouter key.** At https://openrouter.ai/settings/keys create a NEW key named `hermes-office` with **credit limit 0**.
  It must not be the office's own key: the office's key can spend, and a zero-limit key makes "Hermes cannot cost anything" a fact the provider
  enforces. Put it in `/var/lib/hermes/home/.env` as `OPENROUTER_API_KEY`. Never paste it into chat; it goes into the file on the host and into
  the Supabase Vault through the established mechanism if the office needs a record of it.
* **The bridge credentials.** On a machine that has the office's operator access, run
  `npm run engine:bridge-credential -- --office=<office id|operator> "Grant's laptop"` (a production write; it needs the two switches).
  It stores only hashes, and sends the bridge token and the MCP token to your phone as two separate messages. Put the bridge token in
  `/etc/hermes-bridge/bridge.env` as `ENGINE_BRIDGE_TOKEN`, and the MCP token in `/var/lib/hermes/home/.env` as `OFFICE_ENGINE_MCP_TOKEN`.
* `API_SERVER_KEY`: 32 random bytes (`openssl rand -hex 32`), the same value in both files (`HERMES_API_KEY` for the bridge).
* Both files `chmod 600`, owned by their service user. See `.env.example` for the names. Do not set `SUPABASE_*`, `DATABASE_URL` or
  `HERMES_YOLO_MODE` anywhere on this host: the bridge refuses to start if it sees them.

## 4. Configure Hermes

Copy `config.yaml` to `/var/lib/hermes/home/config.yaml` and replace `<project-ref>`. Do not weaken it: every toolset except the office server is
off, tool search is the quoted `"off"`, one concurrent run. The bridge's preflight checks the toolsets on every start and every ten minutes.

## 5. Start and look

```
sudo cp hermes-gateway.service hermes-bridge.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now hermes-gateway hermes-bridge
journalctl -u hermes-bridge -n 30 --no-pager
```

You should see `bridge 0.1.0 up`, and no `preflight failed` lines. The bridge needs the checkout at `/opt/agentic-team` with `npm ci` done.
`curl -s http://127.0.0.1:8642/health` answers `{"status":"ok",...}` from the host.

## 6. Retention

Hermes keeps its own session store. The office keeps the answer and the record of what was read; the host does not need to. Prune weekly with
`hermes sessions delete` for sessions older than seven days (M0 found sessions are not removed by Hermes itself). Never run it while a run is live.

## 7. Turn it on **(Grant, a separate decision)**

Only after steps 1 to 6 are green and Grant says so: add the office's id to the setting `engine.hermes.offices` (the Sample office first, then
Grant's). Until then the selector is disabled and every message goes to the team. Daily ceiling `engine.hermes.daily_runs` defaults to 20 **(Grant: G3)**.

## 8. Turn it off, and roll back

* **The off switch is the rollback.** Remove the office from `engine.hermes.offices`: new runs stop at once, a live run is told to stop at its
  next heartbeat, and nothing else depends on Hermes. Stopping the bridge (`systemctl stop hermes-bridge`) is also safe: a run it held expires
  honestly and the person is told.
* **Before restoring an older worker** (one that predates the engine), run `npm run engine:drain` AFTER switching Hermes off. It refuses while
  Hermes is on for an office that holds a live run, then stops each such job. An older worker would otherwise resume a parked Hermes job as an ordinary
  message and answer it with the team, which is the silent engine switch the design forbids.
* Retire a bridge: `npm run engine:bridge-credential -- --retire=<bridge id> --office=<id> "why"`. Its token stops working at once and the bridge exits.

## 9. What to watch

`journalctl -u hermes-bridge` holds one line per event and never a message or an answer. The office's Team HQ settings show whether Hermes is
available and why not (M6). Outbound traffic from this host should be exactly: the office gateway and MCP host, and OpenRouter. If it is anything
else, stop both services and tell the office's operator.

## 9a. Learning (optional, off by default; M8)

Skip this unless the operator has put the office in `engine.hermes.learning_offices` (an empty list by default; never in production without Grant). Everything below was
run on the pinned Hermes with a scripted model and no spend (`docs/hermes/m8-evidence/engine-learning-host-2026-10-11.txt`, 23 checks). It has NOT been run with a real model.

**What a learning run is.** The office opens it on a second Hermes profile, `hermes-learn`, served by the same gateway under `/p/hermes-learn/`. A Hermes that does not serve that
profile answers 404 and the run fails in plain words; it is never answered by the default profile. The learning profile differs from the default in three things only: the `skills`
toolset is on, `skills.create_dir` is the learn directory, and `skills.external_dirs` is the export directory. Hermes's `/v1/toolsets` lists only built-in toolsets, so a correct
learning profile reports exactly `["skills"]` and the default reports `[]`; the bridge checks that on the learning profile itself before every learning run (`learning_profile_unsafe`
fails the run if anything else is on, or the list cannot be read).

**Directories** (both absolute, different, neither inside the other, set in `/etc/hermes-bridge/bridge.env`):

* `HERMES_SKILLS_EXPORT_DIR=/var/lib/hermes-skills-export/office`: the office's approved skills, written by the bridge and replaced by rename before each run. It is OUTSIDE `/var/lib/hermes`.
  Its PARENT, `/var/lib/hermes-skills-export`, is owned by the bridge's user and is what Hermes's unit sees read-only (see below).
* `HERMES_LEARN_DIR=/var/lib/hermes/learn`: where the learning profile writes a draft (`skills.create_dir`); the bridge reads at most three `SKILL.md` files (20 KB each, no symlinks), proposes them,
  and deletes the directory after every learning run, success or failure.

**Isolation is the operating system's, and it is required.** Hermes's own `skill_manage` edits and deletes a skill in `skills.external_dirs`: a control host without isolation did both. Two units
run as one user here, so permissions cannot separate them; the kernel's read-only mount does. `hermes-gateway.service` has `ReadOnlyPaths=-/var/lib/hermes-skills-export` (the parent, because the
bridge replaces its directory by rename and a mount of the directory itself would go stale), `RestrictNamespaces=true` and `CapabilityBoundingSet=`; `hermes-bridge.service` lists the export and learn
directories in `ReadWritePaths`. The proof made every file world-writable and owned by Hermes's own user, so only the mount stood in the way: edit and delete answered
`OSError: [Errno 30] Read-only file system`, a path traversal, an absolute path and a symlink changed nothing, and a skill written under an approved skill's name was refused.

**Steps (as the user Hermes runs as):**

1. Python **3.14** (`uv venv --python 3.14`). The pinned Hermes pins its core dependencies for 3.14 only; a 3.13 virtualenv installs and then fails at start (`ModuleNotFoundError: ruamel`/`dotenv`).
2. `npm run hermes:learn-profile -- --hermes-home=/var/lib/hermes/home --learn-dir=/var/lib/hermes/learn --export-dir=/var/lib/hermes-skills-export/office --mcp-url=https://<project-ref>.supabase.co/functions/v1/mcp --model=<a :free slug>`.
   It writes `profiles/hermes-learn/config.yaml` (rendered by `src/engines/hermes/learn-profile.ts`, identical to `learn-profile.config.yaml` here) and a 0600 `.env` copied from the default profile's
   (`API_SERVER_KEY`, `OFFICE_ENGINE_MCP_TOKEN`, `OPENROUTER_API_KEY`). **With two profiles Hermes multiplexes and reads secrets from each profile's own `.env`, not from the process environment**,
   so the default profile's `.env` must also hold `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_PORT` (as in `.env.example`). It refuses a model that does not end in `:free`.
3. `sudo mkdir -p /var/lib/hermes-skills-export && sudo chown hermes: /var/lib/hermes-skills-export`; add the two directories to `bridge.env`; restart `hermes-gateway` then `hermes-bridge`.
4. **Check before enabling anything:** `curl -s -H "Authorization: Bearer $HERMES_API_KEY" http://127.0.0.1:8642/p/hermes-learn/v1/toolsets` lists only `skills` as enabled; the default prefix lists none;
   and from Hermes's sandbox `systemd-run --pipe -p User=hermes -p ProtectSystem=strict -p ReadWritePaths=/var/lib/hermes -p ReadOnlyPaths=/var/lib/hermes-skills-export touch /var/lib/hermes-skills-export/x`
   must FAIL with a read-only file system. If either check is wrong, do not enable learning.

What happens: after a finished learning run the bridge PROPOSES a draft to the office. Nothing is used until a person reads the procedure under Settings, Requests and presses Keep it. Nothing the
office does ever writes into Hermes's own skill folder, and the bridge never writes the office's skills registry: its only calls are the run's own, reading the approved list, and the proposal.
To stop learning: remove the office from `engine.hermes.learning_offices` (the export empties at the next run) or retire the bridge.

## 10. What this runbook does not promise

* That the free model answers well, or at all within its rate limit. A provider 429 fails the run and the person is told plainly. The free
  model's quality has not been measured by this work (M0 measured that it can call tools; it did not rate its answers).
* That the host is available. A host that is off is "unavailable", said in one sentence.
* Anything about a Hermes newer than the pinned commit.
