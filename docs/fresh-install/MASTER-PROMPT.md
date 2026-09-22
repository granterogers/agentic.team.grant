<!--
  STORED VERBATIM. This is the authoritative master prompt for the
  fresh-install / new-user deployment workstream, supplied by Grant on
  2026-09-22 as an HTML document. The text below is the document's own
  content, unedited and uncondensed, per CLAUDE.md:
  "Never condense a requirements document."
  Source: agentic_team_fresh_install_new_user_11_hour_master_prompt.html
-->

# MASTER PROMPT — FRESH INSTALL / NEW-USER DEPLOYMENT — 11-HOUR UNATTENDED CLOUD RUN

Repository: `granterogers/agentic.team.grant`
Preferred branch: `claude/fresh-install-onboarding`

Parallel branches:
- `claude/human-simulation-harness` — behavioural intelligence / Shadow Grant
- `claude/basecamp-team-hq` — frontend / UX
- `claude/production-reliability` — production reliability / operations

## MISSION

Prove this:

**Can a genuinely new person, with no Grant-specific infrastructure, historical knowledge, existing Vault, hard-coded project IDs or help from old Claude conversations, take this repository from zero to a safe, working Agentic Team?**

Method:

**FRESH STATE → FOLLOW CANONICAL SETUP → RECORD FRICTION → AUTOMATE/FIX → RESET SAFELY → REPEAT → PROVE FIRST REAL USE**

This is not a documentation beautification run. Do not write a nicer guide around a broken deployment process.

Work approximately ELEVEN HOURS continuously and autonomously. Do not merge main.

## 1. ISOLATION

At start:
1. Fetch remote main; record exact SHA.
2. Confirm branch/HEAD/working tree.
3. Work only on isolated branch `claude/fresh-install-onboarding` unless Cloud has already supplied a safe task branch.
4. Push/upstream.
5. Create a durable run ledger immediately so mission, evidence, defects and next action survive compaction.
6. Inspect current architecture and the three parallel branches enough to avoid collisions; do not repeatedly rebase because they move.

THIS BRANCH OWNS:
installation/bootstrap/setup scripts; first-run deployment automation; prerequisites; configuration discovery/validation; clean-environment verification; migration/bootstrap orchestration; setup diagnostics; required-vs-optional integration semantics; reset/re-run/idempotency; deployment verification; new-user acceptance harness; removal of Grant-specific assumptions from reusable deployment paths; automation of everything not genuinely human-only.

DO NOT OWN:
`web/studio/**` visual redesign; Shadow Grant/evaluator semantics; production reliability architecture; unrelated agent capabilities; a major multi-user architecture rewrite.

If another branch owns a needed change, document the exact integration requirement and continue.

## 2. REPO FACTS FOUND BEFORE THIS RUN — REVALIDATE

A pre-run scan found:

- `docs/new-environment.md` is mainly about starting a fresh CLAUDE DEVELOPMENT SESSION, not necessarily deploying Agentic Team for a fresh END USER. It says `npm ci`, `setup:python`, `check:secrets`, `inventory`, `verify:db`; expects `SUPABASE_ACCESS_TOKEN`; historically defaults `SUPABASE_PROJECT_REF` to Grant's project in many scripts; and contains a historical branch name. It was last verified 2026-09-07 at the scanned baseline.
- `docs/prerequisites.md` is dated 2026-09-02 and describes a historical setup plan involving Supabase, Cloudflare, OpenRouter, Telegram, Slack, Google, etc. Determine CURRENT requirements from code.
- `HUMAN_ONLY_PREREQUISITES.md` is heavily Grant-specific: completed accounts, bot/workspace state, Backblaze, historical phases/decisions. Treat as history/evidence, not a canonical new-user guide.
- migration 0111 created `app.hq_setup()`, a live-state checklist for database, OpenRouter, Slack, Telegram, Notion, Google, Calendar, Notebook and backups. Determine whether its assumptions are still correct and whether a fresh deployment can even reach it.
- searches found scripts that default `SUPABASE_PROJECT_REF` to Grant's project. Every Grant project ref, workspace ID, bot ID, URL, account, user identity and credential assumption in an actual setup/runtime path is suspicious.

Do not indiscriminately erase historical docs/fixtures. Remove hard-coding where it contaminates a real new-user path.

## 3. FRESH USER PERSONA: "FRESH ALEX"

Create a permanent safe fresh-install persona/harness.

Fresh Alex has:
- repo access and ordinary development prerequisites;
- NO Grant Supabase project/Vault;
- NO Grant Telegram/Slack/Google/Vercel/Cloudflare/backup resources;
- NO historical migrations;
- NO `.env`;
- NO secrets copied from Grant;
- NO conversation memory;
- NO pre-populated DB.

Fresh Alex must be able to determine:
what is required; what is optional; what costs money; what genuinely requires a human; what software can automate; where secrets go; exact next action; how each step is verified; how to recover; when setup is complete; how to send the first real instruction and receive a result.

Assume the new user is not a software engineer.

## 4. DEFINE THE MINIMUM VIABLE INSTALL FIRST

Derive from CURRENT code the smallest honest configuration providing:
- canonical DB/state
- inference/Chief-of-Staff brain
- one interaction surface
- worker/execution path
- necessary auth/secrets
- deployment
- first real request → processing → response.

Classify EVERY dependency:
- REQUIRED FOR CORE
- REQUIRED FOR SELECTED FEATURE/CHANNEL
- OPTIONAL
- DEVELOPMENT/MAINTENANCE ONLY
- LEGACY/NO LONGER REQUIRED.

Do not require OpenAI if it is voice-only; Slack if another channel provides first use; Notebook if core works without it. These are examples—prove current reality.

The office must become useful before optional integrations are requested.

## 5. PRE-MORTEM — ASSUME SETUP ONLY WORKS FOR GRANT

Actively hunt:
- hard-coded Grant project refs/resources;
- scripts succeeding only because Grant's Vault is populated;
- development-session setup mistaken for product installation;
- stale hosting/provider instructions;
- secret chicken-and-egg problems;
- migrations assuming manually created Grant data;
- missing/wrong ownership seed data;
- setup UI unreachable until setup is already complete;
- optional integration blocking core;
- credential presence mistaken for working connection;
- external provider instructions that have drifted;
- secrets leaked into chat/source/logs/shell history;
- bootstrap printing success while external steps remain unverified;
- rerun duplicating staff/config/webhooks/resources;
- partial setup leaving unrecoverable state;
- reset/cleanup capable of touching production;
- Claude-Cloud-only assumptions not declared;
- hidden manual steps never captured;
- asking humans to do something API/CLI can automate;
- attempting to automate genuine identity/consent/payment steps;
- deployment returning green without a real first interaction;
- no safe update/upgrade path.

## 6. ONE CANONICAL SETUP CONTRACT

Prefer one machine-readable source of truth for setup state rather than drifting lists in Markdown, SQL, UI and scripts.

The system should be able to determine:
required core prerequisites; optional integrations; current state; missing item; whether human action is genuinely required; next action; verification method; secret presence without exposing value; credential verification status; migration/deployment currency.

Do not perform a huge rewrite merely to centralize data, but eliminate obvious setup-list drift.

## 7. AUTOMATION TARGET

Aim for the safest practical equivalent of:

1. clone/fork/open repo
2. run ONE bootstrap/setup entry point
3. receive concise genuine human-only prerequisites
4. create/provide minimum credentials/resources
5. rerun/resume bootstrap
6. software performs everything automatable
7. migrations deploy
8. runtime deploys
9. checks prove readiness
10. user sends first instruction
11. user receives real answer
12. optional integrations can be added later.

A single command may orchestrate subcommands. Never hide important failures.

If account creation cannot be automated, automate around the human boundary: exact current instruction → immediate validation → resume.

## 8. HUMAN-ONLY FILTER

For every manual step ask:
1. Can repository code do it?
2. Official CLI?
3. Official API?
4. Safe supported browser automation in intended environment?
5. Does it genuinely require identity verification, consent, payment, CAPTCHA, one-time secret retrieval, provider policy, or subjective choice?

Only genuine #5 belongs on the human list.

Never pretend unsupported provider actions can be safely automated.

## 9. SECRETS

Fresh user must never need Grant's secrets.

Prove:
- no committed/copied secrets;
- setup output redacts tokens;
- logs/transcripts do not echo them;
- build/session vs production secret stores are not confused;
- required secrets have clear purpose;
- optional secrets do not block core;
- credentials are functionally verified where safe, not just non-empty;
- wrong/expired credential produces actionable recovery.

Preserve the future direction where each user supplies their own infrastructure/keys, but do NOT turn this run into a multi-tenancy rewrite.

## 10. ZERO-STATE DATABASE — MAJOR GATE

Using a disposable fresh project or strongest faithful isolated equivalent:
- start with no application schema/data;
- apply migrations canonically;
- detect missing/out-of-order migrations;
- prove safe resume/idempotency as intended;
- verify seed/bootstrap records;
- verify staff/config/capability state required for first use;
- verify RLS/permissions;
- find migrations that assume Grant-specific rows;
- prove rerunning setup does not duplicate canonical records;
- prove nothing points to Grant's production project.

NEVER use Grant's production DB as the fresh target.

If creating a real disposable Supabase project is human-blocked, prove everything else in isolation, mark only that external creation step HUMAN_BLOCKED, and continue.

## 11. DEPLOYMENT

Determine CURRENT hosting topology from code, not old docs.

Identify actual deployed components: frontend/static HQ, HQ API, worker, selected channel webhook, scheduler, Python/serverless pieces if still current, backup process, etc.

For each define/prove:
canonical deploy command; required config; generated config; verification; retry/rollback.

Remove or clearly deprecate stale deployment instructions rather than adding another contradictory guide.

Never deploy Fresh Alex onto Grant's production resources/URLs.

## 12. PROVE ONE MINIMAL CHANNEL END-TO-END

At least ONE fresh-user interaction surface must work end-to-end.

If Telegram is the simplest current route, a possible journey is:
human creates one Chief-of-Staff bot where BotFather genuinely requires it → token supplied safely → bootstrap configures webhook → Fresh Alex sends harmless instruction → office processes it → reply arrives.

But derive the best route from current code.

Then classify Slack/Team HQ/voice/etc. appropriately as optional/additional.

Do not require eight bots if current product only needs one.

## 13. OPTIONAL INTEGRATIONS

For each current integration—Google Calendar/Gmail/Drive, Slack, Telegram, OpenRouter, OpenAI voice, Notion, Notebook/knowledge, backup provider, etc.—verify:
does it still exist; required/optional classification; current connection method; disconnect/reconnect where relevant; absence doesn't break unrelated core; instructions are actionable; automatable portions are automated.

Do not perfect optional integrations before minimum first use succeeds.

## 14. ONBOARDING UX BOUNDARY

Do NOT redesign `web/studio/**`; Basecamp branch owns that.

You may improve setup-state contracts/APIs, CLI/text guidance, diagnostics and backend setup metadata.

If visual setup changes are needed, leave a precise integration note for `claude/basecamp-team-hq`.

Desired experience:
no wall of red integrations; clear required-now vs optional-later; one next action; progress; jargon explained; actionable errors; secrets never redisplayed; success ends with first real use, not merely "configuration complete."

## 15. PERMANENT FRESH-INSTALL HARNESS

Create a repeatable guard against:
- hard-coded Grant project refs in setup/runtime paths;
- undocumented required env vars;
- zero-state migration failure;
- absent required seed;
- non-idempotent bootstrap;
- optional credential treated as required;
- docs/setup contract disagreement;
- default config targeting Grant infrastructure;
- "connected" inferred from mere credential presence;
- no reachable first-use path.

Enforce user-level invariants, not implementation trivia.

## 16. SAFE RESET / REPEATABILITY

Fresh-install testing must be repeatable:
- unmistakable test namespace;
- explicit refusal of production identifiers;
- refuse known Grant production resource IDs;
- destructive-operation guards;
- clean only resources harness created;
- external deletion only when safely scoped.

Never delete Grant's data, bots, Slack app, deployments, Supabase project, buckets or provider keys.

## 17. CANONICAL DOCUMENTATION END STATE

There must be ONE obvious current starting point for a new user covering:
what Agentic Team is; minimum cost; optional paid features; minimum accounts; exact setup order; automated vs human-only; secret placement; resume after interruption; verification; first use; optional integrations; updates; troubleshooting/reset.

Historical docs may remain if clearly historical. Do not leave multiple contradictory "canonical" setup guides.

## 18. REQUIRED ACCEPTANCE JOURNEYS

A. CLEAN CONFIG DISCOVERY
No project-specific variables → accurate missing-prerequisites report, not crash or Grant defaults.

B. MINIMUM BOOTSTRAP
Core prerequisites supplied → setup progresses automatically.

C. ZERO-STATE DB
Fresh DB/schema → migrations/seed → valid operational state.

D. INTERRUPTION
Kill halfway → rerun → safe resume, no duplication.

E. WRONG CREDENTIAL
Bad credential → precise failure → replace → resume.

F. OPTIONAL MISSING
Non-core integrations absent → core remains usable.

G. FIRST REAL USE
Harmless instruction traverses selected real channel through office and yields real response.

H. SECOND RUN
Setup rerun after success → no duplicate staff/config/webhooks/resources.

I. UPDATE
Existing install behind migrations → safe upgrade.

J. NO GRANT CONTAMINATION
Search actual runtime/setup paths/evidence and prove no dependency on Grant production identifiers.

## 19. 11-HOUR UNATTENDED PROTOCOL

Do NOT stop for:
progress updates; first green bootstrap; commits; one HUMAN_BLOCKED account; optional provider unavailable; docs completion; first deployment; ordinary decisions; main moving.

If blocked: record exact HUMAN_BLOCKED step/action, then continue all independent work.

Use safest reversible choice when ambiguous.

Suggested pacing:
0–2h map current setup/dependencies/hard-coding; Fresh Alex harness/ledger.
2–4h minimum bootstrap/config validation/canonical setup contract.
4–6h zero-state migration/seed/deploy proof and fixes.
6–7.5h interruption/resume/idempotency/wrong-credential/reset.
7.5–9h minimal real channel → first interaction; optional degradation.
9–10h documentation consolidation/setup diagnostics/adversarial fresh-user pass.
10–10.5h repeat from blank state using ONLY canonical instructions.
Final ~30m fetch current main, inspect parallel divergence, broad gates, evidence, push, readiness.

If early: repeat clean-room setup and attack hidden assumptions rather than adding decorative onboarding features.

## 20. COMPACTION / COMMITS

After meaningful milestones update ledger:
branch/HEAD; current main SHA; fresh scenario; evidence; defects/fixes; HUMAN_BLOCKED; next autonomous action.

After compaction reread ledger + canonical setup entry + diff and continue.

Commit/push coherent milestones. Never merge main.

## 21. FINAL RECONCILIATION

Near end:
fetch current main; compare relevant parallel changes; integrate latest main on YOUR branch only if safe; never overwrite parallel work; inspect migration conflicts; rerun fresh-install acceptance; push final branch; do not merge.

## 22. DEFINITION OF DONE

NOT done because README is nicer, bootstrap exits 0, migrations pass against Grant's DB, setup page renders, credentials are "present", or deployment returns HTTP 200.

Done only when strongest available evidence shows a person with NO Grant infrastructure can follow ONE canonical path from blank state to a working minimal Agentic Team, with optional services genuinely optional, human-only work minimized, setup resumable/idempotent, secrets safe, and first real interaction proven.

## 23. FINAL REPORT

At actual end only report:
branch/final SHA; starting/current main; old vs new canonical setup; minimum accounts/credentials; optional integrations; estimated human steps/time; automated steps; Grant assumptions removed; zero-state migration evidence; interruption/resume/idempotency evidence; first-use evidence; secret-handling evidence; reset safety; docs consolidated/deprecated; HUMAN_BLOCKED; exact remaining human actions; parallel-owned areas untouched; conflicts/divergence; tests/gates; readiness READY / READY WITH NAMED CONFLICTS / NOT READY; exact integration next action.

START NOW. Do not stand by for Grant.
