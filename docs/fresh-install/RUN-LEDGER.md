# FRESH INSTALL / NEW-USER DEPLOYMENT — RUN LEDGER

**This file is the durable memory of the fresh-install workstream.**
It exists so that the mission, boundaries, persona, acceptance criteria and
current position survive context compaction. After a compaction: read this
file, then `docs/fresh-install/FINDINGS.md`, then `git log --oneline` on this
branch, then continue from **NEXT AUTONOMOUS ACTION** at the bottom.

Do not condense this file. Do not summarise the mission section. CLAUDE.md's
own rule applies: *"Never condense a requirements document."*

---

## 0. IDENTITY OF THIS RUN

| | |
|---|---|
| **Workstream** | Fresh Install / New-User Deployment (fourth parallel workstream) |
| **Branch** | `claude/fresh-install-onboarding` |
| **Branched from** | `origin/main` at `3c9415084f4b2664bf8147d995412609e58a24f8` |
| **Started** | 2026-09-22 |
| **Budget** | ~11 hours continuous, unattended, autonomous |
| **Authoritative prompt** | `docs/fresh-install/MASTER-PROMPT.md` (stored verbatim) |

### Parallel workstreams — remain isolated from all three

| Branch | Owns | SHA at our start |
|---|---|---|
| `claude/human-simulation-harness` | behavioural intelligence / Shadow Grant | `1a26e3152b956d0a27b27fb3552fbda7c5068042` |
| `claude/basecamp-team-hq` | frontend / UX | `be1f5f533b71dc01d75bdb1770b4b320df2446d7` |
| `claude/production-reliability` | production reliability / operations | `7be135f02325fb2c4cecb1fbd661da59285aacdb` |

---

## 1. MISSION (verbatim intent, §MISSION)

Prove this:

> **Can a genuinely new person, with no Grant-specific infrastructure, historical
> knowledge, existing Vault, hard-coded project IDs or help from old Claude
> conversations, take this repository from zero to a safe, working Agentic Team?**

Method:

> **FRESH STATE → FOLLOW CANONICAL SETUP → RECORD FRICTION → AUTOMATE/FIX →
> RESET SAFELY → REPEAT → PROVE FIRST REAL USE**

> *"This is not a documentation beautification run. Do not write a nicer guide
> around a broken deployment process."*

**The objective is not better setup documentation. The objective is to PROVE a
genuinely fresh user can get from zero to their first working Agentic Team
interaction.**

---

## 2. BOUNDARIES

### THIS BRANCH OWNS

installation/bootstrap/setup scripts; first-run deployment automation;
prerequisites; configuration discovery/validation; clean-environment
verification; migration/bootstrap orchestration; setup diagnostics;
required-vs-optional integration semantics; reset/re-run/idempotency;
deployment verification; new-user acceptance harness; removal of Grant-specific
assumptions from reusable deployment paths; automation of everything not
genuinely human-only.

### THIS BRANCH DOES **NOT** OWN

- `web/studio/**` visual redesign — **`claude/basecamp-team-hq` owns it**
- Shadow Grant / evaluator / human-simulation semantics — `claude/human-simulation-harness`
- production reliability architecture — `claude/production-reliability`
- unrelated agent capabilities
- a major multi-user / multi-tenancy architecture rewrite

If another branch owns a needed change: **document the exact integration
requirement in `docs/fresh-install/INTEGRATION-REQUESTS.md` and continue.**

### HARD PROHIBITIONS

1. **Never merge main. Never push main.**
2. **Never use Grant's production Supabase project as the fresh target.**
3. **Never deploy Fresh Alex onto Grant's production resources or URLs.**
4. **Never delete Grant's data, bots, Slack app, deployments, Supabase project,
   buckets or provider keys.**
5. **Never expose a secret value** in logs, commits, reports, test output or chat
   (CLAUDE.md, absolute).
6. Do not indiscriminately erase historical docs/fixtures. Remove hard-coding
   only where it contaminates a real new-user path.

---

## 3. FRESH ALEX — THE CLEAN-ROOM PERSONA

A permanent, safe fresh-install persona and harness. Fresh Alex is the subject
of every acceptance journey in §8 below.

**Fresh Alex HAS:**
- repo access
- ordinary development prerequisites (node, git, a terminal)

**Fresh Alex HAS NOT:**
- Grant's Supabase project or Vault
- Grant's Telegram / Slack / Google / Vercel / Cloudflare / backup resources
- any historical migrations already applied
- a `.env`
- any secret copied from Grant
- any conversation memory
- a pre-populated database

**Fresh Alex must be able to determine, unaided:**
1. what is required
2. what is optional
3. what costs money
4. what genuinely requires a human
5. what software can automate
6. where secrets go
7. the exact next action
8. how each step is verified
9. how to recover
10. when setup is complete
11. how to send the first real instruction and receive a result

**Assume the new user is NOT a software engineer.** Jargon must be explained.
An error must say what to do next, not merely what failed.

---

## 4. MINIMUM VIABLE INSTALL — derive from CURRENT code, not old docs

The smallest honest configuration providing:
- canonical DB / state
- inference / Chief-of-Staff brain
- one interaction surface
- worker / execution path
- necessary auth / secrets
- deployment
- first real request → processing → response

**Every dependency must be classified as exactly one of:**

| Class | Meaning |
|---|---|
| `REQUIRED_FOR_CORE` | minimum viable install cannot work without it |
| `REQUIRED_FOR_FEATURE` | required only for a selected feature/channel |
| `OPTIONAL` | genuinely additive; absence must not break core |
| `DEV_ONLY` | development / maintenance only; a user never needs it |
| `LEGACY` | no longer required; documentation drift |

> *"The office must become useful before optional integrations are requested."*

---

## 5. THE HUMAN-ONLY FILTER (§8 of the prompt)

For every manual step, ask in order:
1. Can repository code do it?
2. Is there an official CLI?
3. Is there an official API?
4. Is there safe, supported browser automation in the intended environment?
5. Does it genuinely require identity verification, consent, payment, CAPTCHA,
   one-time secret retrieval, provider policy, or a subjective human choice?

**Only a genuine #5 belongs on the human list.** Never pretend an unsupported
provider action can be safely automated.

---

## 6. SECRETS CONTRACT (§9)

Prove, with evidence:
- no committed or copied secrets
- setup output redacts tokens
- logs and transcripts do not echo them
- build/session secret stores are not confused with production stores
- every required secret has a stated purpose
- optional secrets do not block core
- credentials are **functionally verified** where safe — presence is not connection
- a wrong or expired credential produces an **actionable** recovery message

Preserve the direction where each user supplies their own infrastructure and
keys — but **do not turn this run into a multi-tenancy rewrite**.

---

## 7. SAFE RESET / REPEATABILITY (§16)

- unmistakable test namespace
- explicit refusal of production identifiers
- refuse known Grant production resource IDs **by name**
- destructive-operation guards
- clean only resources the harness itself created
- external deletion only when safely scoped

---

## 8. ACCEPTANCE JOURNEYS — the definition of proof (§18)

Each must have recorded evidence in `docs/fresh-install/EVIDENCE/`.

| ID | Journey | Passing means |
|---|---|---|
| **A** | CLEAN CONFIG DISCOVERY | no project-specific variables set → accurate missing-prerequisites report; **not** a crash and **not** a silent fall back to Grant defaults |
| **B** | MINIMUM BOOTSTRAP | core prerequisites supplied → setup progresses automatically |
| **C** | ZERO-STATE DB | fresh DB/schema → migrations + seed → valid operational state |
| **D** | INTERRUPTION | kill halfway → rerun → safe resume, no duplication |
| **E** | WRONG CREDENTIAL | bad credential → precise failure → replace → resume |
| **F** | OPTIONAL MISSING | non-core integrations absent → core remains usable |
| **G** | FIRST REAL USE | harmless instruction traverses a real channel through the office and yields a real response |
| **H** | SECOND RUN | setup rerun after success → no duplicate staff/config/webhooks/resources |
| **I** | UPDATE | existing install behind migrations → safe upgrade |
| **J** | NO GRANT CONTAMINATION | search actual runtime/setup paths and prove no dependency on Grant production identifiers |

### DEFINITION OF DONE (§22)

**NOT done** because the README is nicer, bootstrap exits 0, migrations pass
against Grant's DB, the setup page renders, credentials are "present", or a
deployment returned HTTP 200.

**Done only when** the strongest available evidence shows a person with NO Grant
infrastructure can follow ONE canonical path from blank state to a working
minimal Agentic Team, with optional services genuinely optional, human-only work
minimised, setup resumable and idempotent, secrets safe, and the first real
interaction proven.

---

## 9. UNATTENDED-RUN PROTOCOL (§19, §20)

**Do NOT stop for:** progress updates · the first green bootstrap · commits ·
one HUMAN_BLOCKED account · an optional provider being unavailable · docs
completion · the first deployment · ordinary decisions · main moving.

**If blocked:** record the exact HUMAN_BLOCKED step and the exact action a human
must take, in `docs/fresh-install/HUMAN-BLOCKED.md`, then **continue all
independent work**.

**When ambiguous:** take the safest reversible choice.

**Pacing (suggested, from the prompt):**

| Window | Work |
|---|---|
| 0–2h | map current setup / dependencies / hard-coding; Fresh Alex harness + ledger |
| 2–4h | minimum bootstrap; config validation; canonical setup contract |
| 4–6h | zero-state migration / seed / deploy proof and fixes |
| 6–7.5h | interruption / resume / idempotency / wrong-credential / reset |
| 7.5–9h | minimal real channel → first interaction; optional degradation |
| 9–10h | documentation consolidation; setup diagnostics; adversarial fresh-user pass |
| 10–10.5h | repeat from blank state using ONLY the canonical instructions |
| final ~30m | fetch current main; inspect parallel divergence; broad gates; evidence; push; readiness |

**If early:** repeat the clean-room setup and attack hidden assumptions rather
than adding decorative onboarding features.

**Commit and push coherent milestones. Never merge main.**

---

## 10. LEDGER STATE — update after every meaningful milestone

### Position

| | |
|---|---|
| **Branch** | `claude/fresh-install-onboarding` |
| **main SHA at start** | `3c9415084f4b2664bf8147d995412609e58a24f8` |
| **Working tree** | clean |
| **Phase** | 9–10h: adversarial clean-room pass |

### What exists now — the whole deliverable in one table

| Command | What it does |
|---|---|
| `npm run fresh:doctor` | what is done, what is missing, the ONE next action. Works with nothing configured. |
| `npm run fresh:install` | empty database → working office, in one atomic statement |
| `npm run fresh:configure` | everything that needs no person; idempotent |
| `npm run fresh:secret -- <name>` | a credential into the vault, prompted, never echoed |
| `npm run fresh:first-use` | asks the office something and shows the answer |
| `npm run fresh:accept` | the ten acceptance journeys, no account needed |
| `npm run fresh:zero-state` | every migration against a genuinely blank database |
| `npm run fresh:baseline` | rebuild the baseline (run after adding a migration) |
| `npm run fresh:docs` | regenerate SETUP.md from the contract |
| `npm run check:fresh` | the static guard, for the gate |

| File | Role |
|---|---|
| `SETUP.md` | **the one canonical starting point.** Generated. |
| `src/fresh/contract.ts` | **the single source of truth** for what an install needs |
| `src/fresh/forbidden.ts` | identifiers the harness refuses by name |
| `src/fresh/project-ref.ts` | the 252-file default, no longer silent |
| `src/db/postgres-executor.ts` | the `pg` transport `executor.ts` always described |
| `migrations/baseline/` | schema + product seed, what a fresh install applies |
| `scripts/fresh/sql/` | the Supabase shim, the stub extensions, the staged preconditions |

### Migrations added

`0534` the MCP address is this office's or it is nothing ·
`0535` a column comment naming a bot nobody else has ·
`0536` an office can connect its own thinking

All three drive themselves and all were proven from zero state.

### Evidence recorded

`docs/fresh-install/EVIDENCE/acceptance-run.txt` — 10/10 journeys, 54 assertions
`docs/fresh-install/EVIDENCE/journey-a-nothing-configured.txt` — the doctor with nothing set

### Defects found / fixed

F-001 … F-009 in `docs/fresh-install/FINDINGS.md`. The headline is **F-002**:
nine migrations assert the CONTENTS of Grant's database, so the corpus stops at
migration 54 of 536 on a blank one, and the fix cannot be in `migrations/`
because applied migrations are immutable.

### HUMAN_BLOCKED

Four, in `docs/fresh-install/HUMAN-BLOCKED.md`: a Supabase project, a Supabase
access token, an OpenRouter key (these three are core, ~10 min, free), and one
Telegram bot for the first surface.

### Known pre-existing failures, NOT caused by this branch

Both reproduce identically on `origin/main`:
- `npm run lint` exits 1 (biome findings across `src/agents`, `scripts/verify`, …)
- `tests/sessions/weather-is-not-a-failure.test.ts` fails — it needs
  `SUPABASE_ACCESS_TOKEN`, which a clean container has none of. 2,207 tests pass.

### NEXT AUTONOMOUS ACTION

> Adversarial clean-room pass: wipe every harness database, unset every
> variable, and follow `SETUP.md` literally as somebody who knows nothing,
> recording each point of friction. Then final reconciliation with main.
