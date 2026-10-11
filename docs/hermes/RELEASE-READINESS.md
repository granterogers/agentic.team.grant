# Hermes release readiness

Written 11 October 2026 on `feature/hermes-agent-integration` (audit of `403e1d5e`, this document committed with the audit). **Nothing here was
released, deployed, merged or applied to production.** No production flag was set, no production credential was used, no model was called with the
office's key, and no spend was incurred. Where a number appears it was recounted from the command output named beside it.

Four words are used exactly:

| Word | Means |
|---|---|
| **implemented** | the code and migration exist on this branch |
| **locally verified** | proved by a command in this repository on an isolated replica or in a hermetic test, with its sabotage |
| **live verified** | proved against a real Hermes with a scripted model, or against production. **Nothing is live verified against a real model, and nothing against production.** |
| **production ready** | none. The blockers below stand between this branch and that word. |

## 1. Milestones

| M | What | Implemented | Locally verified | Live (real Hermes, scripted model) | Production ready |
|---|---|---|---|---|---|
| M0 | validation of Hermes assumptions | yes | yes | V1 to V5, V8 to V13 yes; **V6 blocked** | n/a |
| M1 | schema and SQL (1070) | yes | `engine-runs` 131 | no | no |
| M2 | engine gateway (edge function) | yes | `engine-gateway` 33 | no | no |
| M3 | MCP server engine client kind (1071) | yes | `engine-mcp` 27 | MCP read tools through real Hermes | no |
| M4 | handler seam | yes | `engine-turn` 29 | no | no |
| M5 | bridge and host kit | yes | 59 bridge unit tests (8 sabotages) | **`engine-bridge` 21/21 with the pinned real Hermes** (re-run 11 Oct) | no |
| M6 | Team HQ selection, status, voice door (1072) | yes | `engine-ui` 43, `engine-ui-browser` 33 | no | no |
| **M7** | **Activity Ledger events** | **yes** (1070 mirror, 1076 two more events) | **`engine-ledger` 28/28 against the ledger branch's REAL door** | no | **no: the ledger is not merged** |
| M8a/b | reviewed skill transfer (1073 to 1075) | yes | `engine-skills` 67, `engine-learning` 88, `engine-skill-card-browser` 24 | **`engine-learning-host` 26/26: the `hermes-learn` profile on the pinned Hermes, scripted model, kernel read-only mounts, control host** (11 Oct); no real model | no |
| M9 | Telegram and Slack prefixes | yes | `engine-channels` 18 | no | no |
| M10 | authorised writes | **not started, not authorised** | | | |
| M11 | web access | **not started** | | | |
| audit | stale-worker detector (1077) | yes | `engine-mixed` 12/12 | no | no |
| hardening | stale-worker PREVENTION (1078, claim gate) | yes | `engine-gate` 20/20 incl. a real pre-Hermes worker build | no | no |
| hardening | `hermes-learn` host profile and OS isolation | yes | `learn-profile` 8, `provision-learn-profile` 7, `bridge-learning` 25 | `engine-learning-host` 26/26 | no |
| hardening | reconciliation with `main` and the ledger | trial only, nothing merged | trees A and B green (`BRANCH-RECONCILIATION.md`) | no | no |

M7 is called **complete on the Hermes side and blocked on the ledger's merge**: every call the integration makes is proved against the ledger's own
door, but the door does not exist in `main`, so no event can reach a ledger until that branch is merged and its migrations applied.

## 2. What was verified in this audit (commands and counts)

| Command | Result |
|---|---|
| `npm test` | exit 0; 446 files passed, 1 skipped; **7036 tests passed**, 21 skipped |
| `npm run verify:critical` (candidate rebuilt) | exit 0; **77 of 77 proofs green, 4130 assertions** |
| `npm run verify:extended` | exit 0; **76 of 76 proofs green, 1833 assertions** (includes `engine-ledger` 28, `engine-skill-card-browser` 24, `engine-ui-browser` 33) |
| `npm run check:deployment-state` | exit 0 (8 committed migrations not in the ledger, all Hermes's: 1070 to 1077) |
| `npx tsc --noEmit` | exit 0 |
| `npx biome ci . --diagnostic-level=error` | exit 0 (warnings are the repository's baseline plus 7 in new files) |
| `check:secrets`, `check:migrations`, `check:templates`, `check:proofs` | exit 0 |
| `HERMES_HOST_DIR=… npx tsx scripts/isolated/engine-bridge.ts <clone>` | **21/21** with Hermes `v0.21.6+636.gd4d2ab7` (Python 3.14), scripted model |
| `npx tsx scripts/hermes-m0/m8-learning-probe.ts` | all probes answered; findings in section 4 |
| `engine-ledger` | 28/28, 5 sabotages, against migrations 1060 to 1062 read from commit `96a7dec4` |
| `engine-mixed` | 12/12, 5 sabotages |
| the six catalogue checks, run LOCALLY against a replica (see section 7) | five clean; `check:carrier-writers` red on two functions that are not Hermes's |

### Defects found and fixed by this audit

| # | Finding | Class | Fix |
|---|---|---|---|
| 1 | **ADR-0073 collided** with the ledger branch's ADR | numbering | Hermes ADR is now **0074** |
| 2 | A run the office **stopped** reported nothing at its end, so the ledger would show a worker that began and never finished | product (local) | 1076 reports `external.worker_error` ("stopped"), key `run:<run>:cancelled`; sabotage-proved |
| 3 | A **proposed skill** was never reported to the ledger | product (local) | 1076 reports `external.skill_proposed` with the NAME only, once; sabotage-proved |
| 4 | **No way to find a Hermes message the team answered** (stale worker, rollback, skipped deploy step) | product (class) | 1077 `app.engine_mismatches` + `npm run check:engine-mismatch`; `engine-mixed` 12/12 |
| 5 | **`skill_manage` in real Hermes can edit and delete a skill in `skills.external_dirs`**; the "read-only reference directory" had no operating-system protection, because both units ran as one user | **security, host kit** | the export directory moves outside Hermes's writable paths; the bridge unit lists it; a unit test asserts Hermes's unit cannot write it (sabotage-proved, red then green) |
| 6 | The pinned Hermes **fails to start on Python 3.13** (`ruamel`/`dotenv` missing: its `pyproject.toml` pins them for 3.14 only) | host kit | RUNBOOK says Python 3.14 |
| 7 | Bridge returned from an abandoned run **without waiting for its stop request to Hermes**: the next poll could start while the old run held Hermes's only slot (a unit test lost this race once in a full run) | product (local) | the bridge waits for the stop; a deterministic test with a slow stop, sabotage-proved |
| 8 | `engine-bridge` real-Hermes proof failed 14/21 on a slower host (`claim failed: rate_limited`: its claim spacing was 7 s against a 5 s throttle plus a 2 s preflight) | harness | spacing 9 s; 21/21 |
| 9 | `engine-ui-browser` check 2a failed about one full run in three (read the dock before the status read returned) | harness | waits for the control; 4 of 4 green after |

## 3. M7 and the Activity Ledger

State on 11 October: `feature/unified-activity-ledger` is **not merged**, has advanced to `96a7dec4` (its phase 5, the fail-closed model) and is 25 files
away from `main`'s tree in places Hermes also touches. It uses migrations **1060 to 1062** and ADR **0073**. Hermes uses migrations **1070 to 1077** and ADR **0074**,
so the two never collide and apply in numeric order. A trial merge of this branch with `main` conflicts only in `docs/adr/README.md` and
`web/studio/settings-ui.css` (80 commits of `main` UX work); with the ledger branch it conflicts only in `docs/adr/README.md` and `scripts/gate/critical.ts`
(registry lines: keep both). `git merge-tree` was used; nothing was merged.

What the ledger requires of an external worker (its `EXTERNAL-AGENT-CONTRACT.md`), and how Hermes meets it:

| Contract point | Hermes |
|---|---|
| The worker never touches the database | the bridge talks to the engine gateway; the gateway is the boundary; the SQL mirror runs in the office's own transaction |
| The boundary names the office, from the credential | `engine_bridge_for` derives it; `engine_mirror` takes the run's own office; never a request field |
| A report is a claim, never evidence of an effect | events say "Hermes finished a message", never "the answer was delivered" or "a person approved" |
| `external.skill_proposed` grants nothing | it does not; the name only is sent, never the procedure |
| Idempotency key from the worker | `run:<run_id>:<event>`; the door stores it as `ext:hermes:run:<run_id>:<event>` |
| Off means off | proved: absent door, ledger off, fail-closed (no office listed), on for another office: **nothing is reported and nothing is noted** |
| A refusal is not swallowed | a refusal (the door's own hourly cap, 54000) is written to `engine_runs.ledger_note`; the run still finishes and the job still wakes |
| No second ledger | the only activity tables are the ledger's own three (`engine-ledger` F1) |
| The boundary's caller is added to `callers-baseline.json`'s removal list | on merge: the ledger's baseline lists `app.record_external_activity` as unreached; Hermes reaches it through a string in `app.engine_mirror`, so remove that entry in the merge commit |

Events sent: `external.research_started` (first claim), `external.research_completed` (finish), `external.worker_error` (failed, stopped, expired, bridge lost, bridge retired),
`external.skill_proposed` (a proposal that passed validation). Not sent: `external.output_produced`, `external.usage_recorded`, `external.evaluation_completed`
(the office's own `inference_usage` and `outputs` already hold those facts; a copy would be the second record this repository warns against).

`engine-ledger` applies the ledger's migrations from the pinned commit onto a throwaway replica and **fails, never skips,** if that commit cannot be read.
It is registered in the extended tier. It needs the ledger commit in the local git object store (`git fetch origin feature/unified-activity-ledger`).

## 4. Real Hermes runtime (what was run, and what was not)

Hermes `v0.21.6+636.gd4d2ab7` (the pinned commit) installed from a clean clone into a scratch virtualenv outside the repository. `origin/main` of Hermes is 94
commits ahead of the pin; **the pin was not moved** and nothing here says anything about a newer Hermes.

| Claim | How it was tested | Result |
|---|---|---|
| Runs API, bridge auth, claim, events, completion, failure, stop, restart re-attach | `engine-bridge` against real Hermes with a scripted model | **21/21** (real-Hermes, **scripted-model**) |
| MCP discovery and read-only project reads through the real MCP function | same, R3 to R5 | pass |
| Built-in tools disabled; a hallucinated write tool cannot execute; no file written | same, R11 to R14 | pass |
| Bridge process killed, restarted bridge re-attaches the same Hermes run | same, R15 to R17 | pass |
| Provider 429 / 500 and no-progress are told plainly, nothing is retried by the team | same, R6, R7 | pass |
| **A `/p/hermes-learn/` prefix on a Hermes that serves no such profile** | `m8-learning-probe` P1 | **HTTP 404 "Unknown or unconfigured profile"**; never answered by the default profile (fails closed) |
| **A skill in `skills.external_dirs` with the `skills` toolset off** | P2 | **not shown to the model at all.** The default profile can neither learn nor see an approved skill |
| A skill removed from that directory is gone at the next run | P3 | pass (no cache) |
| With `skills` ON | P6 to P8 | the model is also offered `skill_manage`, and **it can edit and delete a skill in the external directory** |
| The real `hermes-learn` profile end to end (multiplexed profile, `create_dir`, `external_dirs`, harvest, propose) | **not run** | **UNPROVEN** (blocker B3) |
| Behaviour with a real model | **not run** | **UNPROVEN** (blocker B1) |

Consequence for M8: reviewed learning is **inert by default and safe**: the learning flag is empty, the default profile cannot learn, and a learning run on a host without
the profile fails closed. Making it work needs a host-side profile this kit does not yet script, and an export directory Hermes's unit cannot write (now in the kit).

## 5. V6, the zero-spend model

**Blocked, and cannot be unblocked without you.**

* The only credential in this environment is `OPENROUTER_API_KEY`, the **office's funded key**: its metadata (read-only `GET /api/v1/key`, no model call) shows a limit of $10, $7.22 remaining,
  not a free-tier key. Hermes must never hold it, so it was **not used** for any model call. No limit was changed and nothing chargeable was created.
* OpenRouter's public model list (no key) shows **458 models, 19 free, 16 free with tool support**, several with context windows of 256K to 1M, so the 64K floor Hermes enforces is not the obstacle.
  A model being free is read from its pricing, never from its name.
* **What you must do (no secret in chat):** create a key at https://openrouter.ai/settings/keys with **credit limit 0**, then store it with the repository's established secret mechanism so it lands in
  `/var/lib/hermes/home/.env` as `OPENROUTER_API_KEY` on the Hermes host only (RUNBOOK section 3). Then M7's live free run can be attempted.

## 6. Blockers, ranked

| # | Severity | Blocker | Owner | Unblocks |
|---|---|---|---|---|
| B1 | **release-blocking** | V6: no zero-limit key; Hermes has never answered with a real (free) model, so answer quality, tool use and rate behaviour on the free tier are unmeasured | you | live acceptance, A1 to A6 |
| B2 | **release-blocking** | no host: a machine you own that runs the gateway and bridge continuously (1 GB RAM floor), plus the operator step that mints the bridge credential | you | everything live |
| B3 | **reduced to: needs a real host and a real model** (learning only) | the `hermes-learn` profile is **built and proved on the pinned Hermes with a scripted model and kernel read-only mounts** (`engine-learning-host` 26/26, RUNBOOK 9a); what is unproven is the same on a machine you own under systemd, and any real model's behaviour when it writes a skill | you (host), then a free key | M8b live |
| B4 | medium | this branch is **80 commits behind `main`**; trial merges (`BRANCH-RECONCILIATION.md`) show 2 conflicts with `main` (both keep-both) and a 3-way merge with the ledger green after two compatibility fixes already committed here; the ledger is unmerged | you decide merge order (recommendation: ledger first) | M7 live, release |
| B5 | high | the seven production-read checks plus `check:engine-mismatch` have not run against production (they refuse without `ALLOW_PRODUCTION_CHECKS=1`) | you | acceptance A8 |
| B6 | **closed for a worker; still procedure for a stale voice door** | a worker that does not know Hermes can no longer claim a message sent to it: **prevented in the database (1078)**, proved with a real pre-Hermes worker build (`engine-gate`); the mismatch detector (1077) stays as a monitor. Applying 1078 is a production write and is not done; until it is, deploy order and rollback discipline (section 10) are the only control | procedure, and your approval to apply 1078 | none |
| B7 | medium | `check:carrier-writers` is red on two functions (`app.document_preview_record`, `app.document_index_outcome`, migrations 0990 and 1020) that are **not Hermes's**; they exist on `main` | separate issue | none for Hermes |
| B8 | low | Hermes's `/health` is unauthenticated on loopback; the bridge's preflight reads the toolsets every start and every ten minutes | accepted | |

## 7. The seven deferred production-read checks

Every one is a **production catalogue read** (`ManagementApiExecutor`, behind `src/safety/require-production-checks.ts`), none runs on this branch without
`ALLOW_PRODUCTION_CHECKS=1`, and none was run against production. `main`'s sibling branch (the ledger) added a `--replica` mode to six of them. To learn whether Hermes
adds anything those checks would flag, **the ledger branch's six scripts were overlaid on a throwaway worktree of this branch** and run with `--replica` against a replica built from
this branch's migrations (no production contact; the worktree was removed). That says nothing about production's own state.

| Check | What it asks | Local result on this branch's schema |
|---|---|---|
| `check:callers` | does anything call each database function | exit 0: 14 known, all in the baseline; **no Hermes function is unreached** |
| `check:consumed` | is every written table read | exit 0: 3 written-and-unread tables, each with a recorded reason; none is Hermes's |
| `check:pressable` | does something press each gateway action | **no replica mode on the ledger branch**, production-only: **not run.** Hermes's one gateway section (`engine_status`) has its caller in `web/studio/engine.js` and wrapper/entry assertions in `engine-ui` B1/B2 |
| `check:gateway-wrappers` | does every gateway function have a public wrapper | exit 0: 185 functions routed, 294 public |
| `check:machine-key` | does the office key reach a function defaulting to a person | exit 0: 40 actions, **0 reach an ambient person** |
| `check:anon-exposure` | can a public key execute anything | exit 0: 294 functions, 154 tables, 14 views: none reachable |
| `check:carrier-writers` | does a function write a carrier row without its office | **exit 1**: two functions from migrations 0990 and 1020 (on `main`), not Hermes's; every `engine_*` writer names its office |
| `check:engine-mismatch` (new, 1077) | did a Hermes message get a team answer | production read; **not run**; proved by `engine-mixed` |

## 8. Production prerequisites and hosting

* Decisions G1 to G4 of `IMPLEMENTATION-PROGRESS.md` (host, which projects may leave to a free provider, the daily run cap, the zero-limit key).
* **Host:** a machine you own, 1 GB RAM minimum (Hermes measured 290 to 336 MB), **Python 3.14**, outbound to the office gateway and MCP host and to OpenRouter only. Two units (`hermes-gateway.service`,
  `hermes-bridge.service`), a **bridge token** and an **MCP token** minted by the operator command (hashes only in the database), the Hermes API key, the zero-limit key. RUNBOOK sections 1 to 9.
* **Learning host layout (only if learning is ever enabled):** export directory `/var/lib/hermes-skills-export` (outside Hermes's writable paths), learn directory `/var/lib/hermes/learn`, and the OS check in RUNBOOK 9a.
* Cost: **£0 added.** Supabase free tier and Vercel Hobby are unchanged; Hermes is open source on your hardware; the model is a `:free` model on a limit-0 key, so a paid fallback is refused by the provider, not by our code.
  The daily run cap (`engine.hermes.daily_runs`, default 20) and the free-tier watch (1045) bound usage.

## 9. Deployment sequence (NOT performed; every step that writes production needs your explicit approval and the two production-write switches)

Migration order on a database that holds 1053 as its highest: **(ledger 1060 to 1062 if it has merged and been approved), then 1070, 1071, 1072, 1073, 1074, 1075, 1076, 1077, 1078.** 1078 (the claim gate) is safe to apply before the worker is redeployed: an old worker simply cannot claim a Hermes message, and the new worker falls back to the old call if 1078 is absent. Use `npm run migrate`
only from a tree that is not behind production's ledger; otherwise `npm run migrate:one -- <file>`. Never apply from this branch before the merge question (B4) is settled.

| Step | Command | Automatable? | Human decision |
|---|---|---|---|
| 0 | merge decisions (main, ledger); renumber nothing | no | **yes** |
| 1 | `npm run check:deployment-state`, `check:migrations`, `verify:critical`, `verify:extended` on the release commit | yes | |
| 2 | read-only production checks incl. `check:engine-mismatch` (baseline: no office has chosen Hermes) | yes, once authorised | **yes** (`ALLOW_PRODUCTION_CHECKS`) |
| 3 | apply migrations 1070 to 1078 | no | **yes** (`ALLOW_PRODUCTION_WRITES`, clean pushed tree) |
| 4 | `deploy:worker` (carries the engine seam; **must be first**) | script | **yes** |
| 5 | `deploy:engine`, `deploy:mcp`, `deploy:hq-api` | script | **yes** |
| 6 | `deploy:voice` (refuses unless the LIVE worker carries the seam), then `deploy:telegram`, `deploy:slack`, then the page | script | **yes** |
| 7 | host: install Hermes (Python 3.14), config, units; operator mints the bridge credential (`engine:bridge-credential`; tokens arrive as two phone messages) | partly | **yes** (credential), you (host) |
| 8 | set `engine.hermes.offices` to ONE office (yours). Learning stays empty | one setting | **yes** |
| 9 | acceptance A1 to A9 below | scripted where possible | you judge answer quality |
| 10 | daily `check:engine-mismatch`; weekly review of `engine_runs` failures | yes | |

## 10. Rollback (the order matters)

1. **Switch Hermes off first:** remove the office from `engine.hermes.offices`. Team HQ shows Hermes as unavailable, and a message still sent to Hermes is answered by the worker with ONE plain sentence that Hermes is not available (`openHermesTurn`, never by the team). This holds only while the worker still carries the seam.
2. `npm run engine:drain` (a production write; it refuses while Hermes is still on for an office holding a live run) stops every job that holds a live Hermes run, so none is left for an older worker to pick up.
3. **Only then** roll back the worker below the seam. With 1078 applied an older worker cannot claim a Hermes message at all (it waits `queued`, loudly, until stopped or until a current worker runs), so this order is now a second line of defence rather than the only one; without 1078 it is the only one.
4. Stop `hermes-bridge`, then `hermes-gateway`. Retire the bridge: `engine:bridge-credential -- --retire=<bridge id> --office=<id> "why"` (its token dies at once).
5. Run `check:engine-mismatch`. It must report zero, or you have the list of messages that were answered by the team.
6. Migrations 1070 to 1078 are additive and are **not reversed** (the repository's rule for applied migrations). Each file's header states how to restore the previous function definition. A rollback of the page and functions is by `scripts/deploy/restore-function.ts`.

Mixed-version behaviour (proved or read): new worker on a database that predates 1070 treats everything as the team (`predatesEngine`, no Hermes choice can exist); old worker on the new schema
is the hazard above (detectable by 1077); stale voice/Telegram/Slack doors send no engine field, so nothing selects Hermes; 1076 and 1077 fail loudly, not silently, if applied before 1074, because their splices assert their anchors.

## 11. Monitoring, alerts, acceptance

Monitor: `check:engine-mismatch` (must be zero); `engine_status` in Team HQ (host available, why not); `engine_runs` failures and `ledger_note` non-null; `inference_usage` rows with provider `hermes` (cost must be 0.00000000); `deliveries` for Hermes jobs;
the free-tier watch (1045). **Alert** on: any mismatch; a bridge unhealthy more than 10 minutes; a run `expired` or `failed` twice in an hour; any `ledger_note` mentioning 54000 (volume); any Hermes `inference_usage` cost above zero.

Host health checks (RUNBOOK 9a step 4, learning only): `/p/hermes-learn/v1/toolsets` lists only `skills`; the default profile lists none; a write from Hermes's sandbox to the export directory and to both `config.yaml` files fails with a read-only file system; `ls` of the learn directory is empty between runs.

Security checks before any enablement: `npm run check:secrets`; `check:anon-exposure`, `check:machine-key`, `check:gateway-wrappers`, `check:carrier-writers` (production, authorised); the RUNBOOK 9a OS write test if learning is ever on; confirm the Hermes host's environment holds no `SUPABASE_*`.

**Acceptance criteria (all must hold; A1 to A6 need B1 and B2):**

| # | Criterion |
|---|---|
| A1 | a typed message to Hermes (Team HQ, Telegram, Slack) is answered by Hermes, labelled, with the answer delivered once |
| A2 | at least 8 of 10 designed outcomes (the M5 pass mark), zero containment events, zero calls to any model but the free one |
| A3 | the job's `inference_usage` is Hermes's at cost 0 and no team model was asked |
| A4 | Stop from the person reaches Hermes and nothing is delivered |
| A5 | the host being off produces ONE plain sentence and no team answer |
| A6 | provider rate-limit exhaustion fails the run, tells the person, and retries nothing |
| A7 | `check:engine-mismatch` reports zero after A1 to A6 |
| A8 | the seven production-read checks are clean or unchanged from their recorded baselines |
| A9 | (if the ledger has merged) each run shows one started and one ending event as `external:hermes` |

## 12. What can be automated and what needs a person

Automatable and safe: every local gate; the static checks; the replica proofs; `check:engine-mismatch` once you authorise production reads; the monitoring queries; the deploy scripts once you authorise writes (they probe themselves).
**Needs a person:** the merge order and the merges; the zero-limit key; the host; minting the bridge credential; every production write; enabling Hermes for an office; M10 and M11; any change to the autonomy policy;
judging whether a free model's answers are good enough.

## 13. Explicit approvals required from you

1. Merge order for `main`, `feature/unified-activity-ledger` and this branch, and who resolves the keep-both conflicts listed in `BRANCH-RECONCILIATION.md` (recommendation there: ledger first).
2. Create the limit-0 OpenRouter key and supply it through the Vault mechanism, not chat (G4).
3. Provide the host (G1) and accept the privacy trade of G2 (project text leaves for a free provider).
4. `ALLOW_PRODUCTION_CHECKS=1` for the eight reads in section 7 and `ALLOW_PRODUCTION_WRITES=1` plus a named list for migrations 1070 to 1078 and the deploys in section 9.
5. Which single office may use Hermes first. Learning stays disabled until you separately say otherwise.
