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

Skip this unless the operator has put the office in `engine.hermes.learning_offices` (an empty list by default; never in production without Grant).
**It is not finished on the host side**, and the real Hermes explains why (checked against the pinned commit with `scripts/hermes-m0/m8-learning-probe.ts`, scripted model, no spend):

* The default profile cannot learn and cannot see an approved skill. With the `skills` toolset off (this kit), a skill in `skills.external_dirs` is NOT put in front of the model.
* A `/p/hermes-learn/` prefix is refused by a Hermes that does not serve that profile (HTTP 404 "Unknown or unconfigured profile"), so a learning run on a host without the profile fails; it is never answered by the default profile. Serving it needs Hermes's profile multiplexing (`gateway.multiplex_profiles`, a `hermes-learn` profile home with the `skills` toolset on, `skills.create_dir` set to the learn directory and `skills.external_dirs` set to the export directory). Creating and verifying that profile is a host task this kit does not yet script (blocker B3 in `docs/hermes/RELEASE-READINESS.md`).
* With the `skills` toolset on, Hermes offers its model `skill_manage`, and that tool CAN edit or delete a skill that lives in `skills.external_dirs`: Hermes does not treat an external directory as read-only. The only thing that stops it is the operating system, so the export directory MUST be a place Hermes's own unit cannot write.

Directories (both absolute, different, neither inside the other, set in `/etc/hermes-bridge/bridge.env`):

* `HERMES_SKILLS_EXPORT_DIR=/var/lib/hermes-skills-export`: the office's approved skills, written by the bridge as reference and replaced atomically before each run, emptied if anything is in doubt. It is OUTSIDE `/var/lib/hermes`, so Hermes's unit (`ProtectSystem=strict`, writable only under `/var/lib/hermes`) cannot write it. `hermes-bridge.service` lists it in `ReadWritePaths`.
* `HERMES_LEARN_DIR=/var/lib/hermes/learn`: where the learning profile writes a draft (`skills.create_dir`); the bridge reads at most three `SKILL.md` files (20 KB each, no symlinks), proposes them to the office, and always deletes the directory.

Check before turning learning on, as the `hermes` user on the host: `touch /var/lib/hermes-skills-export/x` from inside Hermes's unit's sandbox (`systemd-run -p ProtectSystem=strict -p ReadWritePaths=/var/lib/hermes -p User=hermes touch /var/lib/hermes-skills-export/x`) must FAIL. If it succeeds the isolation is not in place; do not enable learning.

What happens: after a finished run the bridge PROPOSES a draft to the office. Nothing is used until a person reads the procedure under Settings, Requests and presses Keep it. Nothing the office does ever writes into Hermes's own skill folder. To stop learning: remove the office from `engine.hermes.learning_offices` (the export empties at the next run) or retire the bridge.

Python: the pinned Hermes needs Python 3.14 here. Its `pyproject.toml` pins `ruamel.yaml` and other core dependencies only for Python 3.14, so a 3.13 virtualenv installs and then fails at start with `ModuleNotFoundError: ruamel`/`dotenv` (found 11 October). Create the virtualenv with `uv venv --python 3.14`.

## 10. What this runbook does not promise

* That the free model answers well, or at all within its rate limit. A provider 429 fails the run and the person is told plainly. The free
  model's quality has not been measured by this work (M0 measured that it can call tools; it did not rate its answers).
* That the host is available. A host that is off is "unavailable", said in one sentence.
* Anything about a Hermes newer than the pinned commit.
