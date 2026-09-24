# Backend behavioural completion

**24 September 2026.** The autonomous backend behavioural-discovery programme
has reached its evidence-based stopping point.

This document says what was done, what the verdict rests on, and — at least as
importantly — **what it does not claim**. It is written for somebody who was
not in the conversation.

---

## The verdict

**Five consecutive materially different qualifying clean passes (60–64),
followed by a clean final adversarial synthesis pass.**

| | |
|---|---|
| **Branch** | `claude/human-simulation-harness` (not merged to `main`) |
| **Worker** | **v835**, ACTIVE, liveness ok, http 200 |
| **Migrations** | **604** applied; this checkout and the shared database agree exactly |
| **Tests** | **3,066 passing across 190 files** |
| **Gate** | 56 suites and checks; lint 0, typecheck 0 |
| **Containment** | **0 new escapes**, 22 known and acknowledged, 291 refused |
| **Passes recorded** | 57, in `docs/testing/behavioural-run-ledger.md` |

The stopping criterion was never "no defect is imaginable". It was
**diminishing returns on meaningful behavioural defects**, demonstrated rather
than asserted: five fresh territories in a row produced no product defect, and
a synthesis pass built specifically to break the combination produced one
latent coupling and no wrong behaviour.

---

## What the five clean passes actually asked

Each took a materially different territory, and each carries its own positive
control — because a check that has only ever reported zero is
indistinguishable from one that cannot report anything.

| pass | territory | the evidence, and what makes the zero mean something |
|---|---|---|
| **60** | what the office writes to his real task list | His visible list is 5 items with 1 known piece of debris. The four suite rows sit on **archived** `mytasks-proof-*` projects and `app.my_tasks` returns none of them. |
| **61** | project / context isolation | **125 retrieval hits, 0 cross-project**, with a control proving the scope narrows (9 / 18 / **0 shared** / 29 unscoped). **289 document citations in real answers, 0 cross-project**; the in-query sabotage flags **289 of 289**. |
| **62** | duplicate execution | `verify:another-go` **10/10** — *"repeating the request starts nothing"* beside *"the first ask starts work"*. The one real instance (#337) predates its guard by six days. |
| **63** | cancellation | `verify:stop` **19/19** across the whole path, including partial-progress preservation and three controls. Real frequency is nil, which is exactly why it was driven rather than queried. |
| **64** | obligation fulfilment | 137 fulfilled / 74 cancelled / 3 failed with no disagreement. The reader **discriminates** — 140 jobs are `complete` at job level and `partially_complete` at obligation level, every one harness. Bar stated honestly: 118 of the 137 were childless, so the population that could have failed is **19, and all 19 completed**. |

## What the synthesis pass combined

Deliberately the systems this repository breaks most often, against the state
they write that cannot be taken back.

1. **The announcement dedupe (0584/0585/0589) against the apology a dead turn
   owes him (0571).** `lastWord` builds a fresh output carrying
   `announce: true` and calls the notifier directly without writing the
   **column** the notifier reads — so the apology would be judged by a flag
   written for a different output. **Not reachable today**: all 77 jobs with
   that exact shape are verify suites, and every handler returning
   `announce: false` is a duty, which `app.owed_a_word` excludes by
   construction. Closed anyway, because the invariant held by the accident of
   which handlers exist. The obvious fix — reading `output.announce` in the
   notifier — would have defeated `say_once` entirely, and was rejected before
   production was touched.
2. **Every filter this programme narrowed, audited as a set.** 0 of his work
   hidden by 0586, 0588 or 0590. 0582's 23 suspects are all `scenario-a` voice
   turns on a fixture project, classified by 0355's predating signal —
   **23 of 23 explained, 0 unexplained**.
3. **Long-lived state.** Thirteen standing checks green. `check:callers` failed
   on three wrappers that arrive from the sibling branch's recovered 0583/0584
   and whose caller is that branch's `hq-api` — verified with `git grep`
   against `origin`, then baselined with that reason.

---

## What this does NOT claim

- **It is not a certification.** The backend certification campaign closed
  GREEN on 15 September and is not reopened. This programme was beta-era
  behavioural discovery against **real usage**, and nothing here revisits that
  verdict.
- **It does not claim the office is defect-free.** It claims that five fresh
  territories and one adversarial combination produced no meaningful systemic
  product defect, which is a statement about the *rate of discovery*, not about
  the absence of defects.
- **It does not claim broad statistical power.** The genuinely real corpus is
  **182 turns** — not the 1,438 an earlier pass published before the filter was
  corrected. Several passes rest on populations of 19 or 20. Those numbers are
  stated where they are used rather than rounded up.
- **It says nothing about the frontend.** No UI work was done, and no UX QA was
  run.
- **It does not cover territories with no real traffic.** `public.contacts`
  holds zero rows; `job_pauses` is entirely harness; the Stop button has never
  been pressed on real work. Those were driven rather than measured, and
  driving proves the mechanism, not the usage.

---

## Deferred, and why none of it blocks

| item | why it does not block |
|---|---|
| **Slack `config token (12h)` is dead** | A human must regenerate it at https://api.slack.com/apps. It administers the app; it does not carry messages. 0590 makes the office stop denying a capability it is exercising, and Grant's chore for the repair stands. |
| **Google OAuth app in testing mode** | A console setting, not code. It is the cause of #355's recurrence and the dedupe now bounds the damage to once a day. |
| **#365 — a cancelled turn owes him a word** | One occurrence, cause unidentified, and closing it needs a sweeper rather than a predicate change (a SQL-side cancellation never passes the worker). Filed with the evidence rather than built on one event. |
| **#358 — `undoable_actions.job_id` never populated** | Latent. Nothing reads the column today; recorded so the next reader does not treat 396 unattributable rows as real. |
| **#362 — two first-person phrasings still missed** | *"I see no emails from Sergio"* needs a verb vocabulary, and widening a provenance gate's verbs has real false-positive risk. A gate that fires wrongly is one somebody switches off. |
| **63 archived debris projects; 1 personal task with a run token** | Permanent by construction — each carries a job, and a job can never be deleted. The task is Grant's to remove; deleting real-list data was explicitly out of scope. |
| **Three cross-branch wrappers in the callers baseline** | Self-heals when `claude/basecamp-team-hq` merges. The baseline entry names the command that re-checks it. |
| **Two preserved escapes (#298) and twenty (#354)** | Evidence, deliberately kept in `known_escapes` so the witness can say *"22 known, 0 new"* rather than staying red by design. Never rewritten to obtain green. |

---

## The discipline that produced this, stated because it is the reusable part

More findings died on inspection than survived it. The recurring causes, each
now recorded in CLAUDE.md:

- **Instrument errors.** A `sed` that grabbed a table separator so a sabotage
  never applied; a `grep` that matched the literal `GONE` inside echoed SQL and
  made a successful restore read as a failure; `count(*)` over a set-returning
  JSON function; `search_documents` treated as jsonb; `outputs.sources` treated
  as `text[]`.
- **Contaminated populations.** The corpus was 1,438 turns by the weak
  predicate and **182** by the canonical one, and five sentences published as
  Grant's turned out to be a suite's. Corrected publicly on the issue rather
  than edited quietly.
- **Job-level observations of obligation-level behaviour.** Two turns that
  looked undelivered had been answered by their children.
- **Historical defects already fixed.** A task created from a question, and a
  planner that dropped a creation clause — both dead on today's code.
- **Deliberately conservative behaviour read as a bug.** `callsItOff` declining
  a gerund; `#364`'s obvious fix would have made *"do not run it twice"* a
  permanent rule.

The single most-used rule in this repository earned its place again:
**validate the test before believing the finding.**

---

## Where to pick it up

1. `CLAUDE.md` — the standing brief and the traps.
2. `docs/testing/behavioural-run-ledger.md` — every pass, with its evidence and
   its corrections.
3. [GitHub Issues](https://github.com/granterogers/agentic.team.grant/issues) —
   the backlog. 66 open; the recent ones are findings with their fixes recorded.

Reopening this programme should follow the same rule the certification campaign
set: **evidence from real use that something is wrong**, not a new idea for
something that could be probed.
