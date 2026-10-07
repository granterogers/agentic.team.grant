# Version 1: owner decisions applied and two production reads settled, 7 October 2026

Baseline: `V1-RELIABILITY-ACCEPTANCE-2026-10-07.md`. This phase: two authorised read-only production reads, four decisions applied
**locally**, and a full re-verification. **Nothing was deployed. No migration was applied to production. No production contact except the two reads
below, after which production access was closed.** Migrations 1023 to 1034 and all code in this branch are undeployed, so production still runs the
defects they fix.

## 1. The two authorised production reads

| Read | What was selected | Returned | Sensitive data |
|---|---|---|---|
| PA | `staff_slug`, `is_pager`, `enabled`, token-present boolean for each row of `public.telegram_bots` | 8 rows | none (no token, username, message or chat) |
| PB | date, uuid-masked `state_reason` truncated to 120 characters, count, for failed `office.notion_sync` jobs since 15 Sep | 10 groups | none (no Notion content) |

Both logged in the session record. One slip of mine: my habit of unsetting production credentials removed the access token for the first attempt of
PA, which failed with "SUPABASE_ACCESS_TOKEN is not set"; I re-ran it without the unset, which was the authorised read. No other production access.

## 2. Telegram delegation: CONFIRMED in production configuration, FIXED locally

**Read PA:** the Chief of Staff bot is the pager bot (`is_pager`, enabled, token present) with `staff_slug = 'chief-of-staff'`, not null. The seven
director bots are all disabled. Migration 0082's comment (null slug) was false; `roster.ts` already said so.

**Defect (reproduced locally with the exact configuration through the real webhook and worker):** the webhook writes `addressed_to = <bot slug>`, so every
Telegram instruction was stored as addressed to `chief-of-staff`; `speaker()` took its "addressed directly" branch for any non-empty value and convened
nobody. Telegram, the main interface, never delegated.

**Fix (no migration):** two concepts were sharing one column. (A) Which bot receives the reply is unchanged: the stored `addressed_to` still drives
`roster.ts`, `reply.ts`, threading and `pinned_config`. (B) Whether a specialist was addressed directly is now one definition,
`src/agents/addressing.ts`: nobody named is false; a hand-off child is true; a specialist other than the chief is true; the chief alone is false (she routes);
the chief plus people he picked himself is true. Two readers that asked "was this addressed to a person" (the consultation record and the teaching scope) now use
it (a rule typed to the chief bot used to fail with a `lessons_scope_matches_target` violation in a project chat). Reminders, task adds and task completions stay
with Claire and make no model call. Rejected: nulling `addressed_to` for the chief (breaks reply routing, files and threading), a new column, a chief
special-case inside `speaker()` alone.

**Evidence:** replica proof `tg-chief-addressing` 34/34, registered in the critical gate: chief ordinary instruction, chief delegation (3 roster, 2 children,
1 group, 1 synthesis, replies through the chief token to the same chat), multi-specialist request, specialist direct request through her own bot and token,
reply routing, approvals (typed yes binds, forwarded yes does not, button resolves), retries and redrive that do not re-convene, duplicate webhook (one team),
cross-office isolation. Journey H now PASS. Mutations M27, M27b, M27c each CAUGHT (three vitest tests); the registered proof also goes red when the conflation
is restored.

**What changes for you once deployed (stated plainly):** anything typed to the chief bot is routed, not answered by Claire alone. "Ask the team to
investigate this" convenes specialists. Measured locally: a lead plus two children, one synthesis, two Telegram messages. **Ordinary questions are routed too**:
"What is the status of the venue contract?" went to the quality director plus finance (hand-off, synthesis, two messages) where Claire answered once before. More
jobs, messages and model calls, on free-tier quotas that have run out before. This matches what Team HQ already does for an unaddressed turn and the documented
design, but it is **your product decision**: if you prefer questions to stay with Claire and only delegation phrasing to be routed, that is a narrower rule.
MODEL-DEPENDENT: which specialists a real model names. PARKED: existing production lessons scoped to the chief through Telegram (a read of `public.lessons`).

## 3. Notion failures: every observed class classified (read PB)

| Failures | Dates | Recorded reason | Classification | Why |
|---|---|---|---|---|
| 30 | 16, 17, 18 Sep (6, 12, 12) | "output refused: cannot be marked deterministic: job has 1 recorded inference attempt" | **HISTORICAL / OBSOLETE** | The provenance-order defect (CLAUDE.md, 18 Sep). Fixed in production before 19 Sep: the duty ran clean from 19 to 30 Sep. The candidate adds a behavioural test that pins it |
| 1 | 1 Oct | "notion /search failed: internal_server_error" | **NOT FIXED** | A provider 5xx is transient by design and ends the run failed after its attempts; the next run two hours later recovers. One occurrence |
| 11 | 4, 5, 6 Oct (3, 3, 5) | "recovery: 5 attempts exhausted while in running" | **NOT FIXED** | The job died while running five times. The live and rising class. The candidate bounds one hung request at 20 s but not the total run or the whole-workspace re-crawl per attached project. Cannot be split into a platform stall or an overlong run from this read (PARKED: it would need job durations) |
| 3 | 4, 5, 6 Oct (1 each) | "write CONNECT_TIMEOUT" | **NOT FIXED** (platform) | The worker's database connection timed out on days of platform instability; infrastructure errors still burn attempts (G-5). No Notion product defect |

**None of the four local Notion defects fixed in the candidate (revoked token, no timeout, HTML error page, empty-workspace read) appeared in production.** The
candidate fixes none of the 15 failures from 1 October on. Last failures were 6 October; none on 7 October at read time. A bounded, resumable sync is the
candidate improvement for the 11, if you want it.

## 4. Recurring reminder decision applied (migration 1034, undeployed)

Completing a recurring reminder completes **that occurrence only**; the series stays open and the next occurrence stays scheduled. A completion before the
occurrence fires **skips** it (never fires); after delivery it simply records it. **Stopping is a separate explicit act**: "stop / cancel / end the recurring
reminder" phrasings (grounded in his own words, never a forwarded or paraphrased message), a gateway action, and a "Stop repeating" button in the task
editor. The decision lives at a `BEFORE UPDATE` trigger on `tasks.state`, because ten writers set it. Three nullable columns record fired, completed
and completed-at; no extra rows, so no duplicate occurrence can exist. Deviation from your wording: stopping leaves the repeat setting on the cancelled row so
the product's own undo restores the whole series. A repeating **task** with a due date keeps its existing behaviour (ticking makes the next one).

Evidence: replica proof `rm-series` 67/67 (registered): occurrence 1 fires and is delivered once; completed; occurrence 2 stays at Monday 09:00 office time;
fires; explicit stop ends it (undo restores it whole; no third firing); row and delivery counts asserted throughout (never a duplicate); DST both directions in Athens,
New York and Auckland, month, year, February and leap-year ends, a 30-day outage fires once. Eight sabotages each red. Not run: a real-browser check of the new
button (PARKED, needs the Sample harness).

## 5. Failed or uncertain delivery: a durable question on his Needs me list (migration 1032, undeployed)

A finished answer whose delivery ends terminally failed or parks as uncertain raises **one** blocker (`on_answer.kind = 'delivery.decide'`) in the
owner's office: it quotes the answer (500 characters), says in plain words that it may not have reached him, and offers **Send it again**, **It arrived, close
this** and **Dismiss**. The original output is untouched and the Team HQ thread shows it marked failed or "may not have reached you, so it was not sent
again". **An uncertain delivery is never auto-resent**; his choice settles it. One item per answer (a unique partial index, an after-trigger on
`deliveries` and a backstop in the settle sweep); a harness job raises none; another office cannot see or answer it; the item closes itself if the answer arrives
another way. **Nothing is sent on a second channel**: policy (`telegram.only_chief_speaks`, the pager, delivery containment) does not clearly permit it. So
**someone who never opens Team HQ is still not told on a chat channel**. That is the stated limit, with where a channel would plug in.

Evidence: `dl-delivery-redrive` 57/57 and journey K 21/21 (PASS): retryable then success (no item), terminal failure, indeterminate, accepted-but-ack-lost,
worker restart mid-send, duplicate workers and presses (one item, one send), harness and cross-office containment, the answer recoverable from the readers. Nine
sabotages each red. Risks: 1032 splices `hq_answer_blocker` (I checked the final applied schema: the branch is present); the first worker tick after deploy raises
items for failed answers inside the last two days; `app.undelivered` is still unscoped by office and not served by any gateway section (adjacent, not fixed).

## 6. Backup retention policy: recorded and tested, NOT executed

Your policy, recorded verbatim in `docs/ops/backup-retention-policy.md`: the **newest 7 daily verified backups plus the newest verified backup from each of
the previous 8 ISO weeks**. Interpretation fixed in code (`src/backup/retention.ts`, a pure planner): one backup per UTC day (the newest verified), the
newest 7 days that have a verified backup; ISO weeks Monday-based, UTC, excluding the current week; at most 15 runs kept; the newest verified run is always kept; an
unverified or unfinished run is reported and **never deleted**; a run is kept or dropped whole; foreign objects are never touched; if nothing is verified the plan is
refused. The old code did not match your wording (it kept 7 runs, counted the current week, and deleted unfinished runs after 72 hours). Deletion is dry-run by default and
refuses without the attended flag **and** both production-write flags; production execution still needs your separate approval of the exact list. Worked example on
the recorded 16-night series: keep 8 runs (181 MB), delete 8 (128 MB). 44 unit tests plus seeded property tests; eight sabotages red (one equivalent mutant). **Nothing
deleted; 1026 not deployed.**

## 7. Final verification (final tree, commit after `e2e-duties-budget` fix), run by me

| Gate | Result |
|---|---|
| typecheck | exit 0 |
| pinned Biome `npm run lint` and root `biome ci .` | exit 0 (warnings only, all pre-existing) |
| `check:migrations`, `check:secrets`, `check:templates`, `check:deployment-state`, `check:proofs`, `check:pressable` | all exit 0 |
| `npm test` (hermetic) | exit 0: **402 files passed, 1 skipped; 6,292 tests passed, 21 skipped** (the pre-existing live Vikunja tests) |
| `verify:critical` | **59 green, 0 red; 3,492 assertions** |
| `verify:extended` | **71 green, 0 red; 1,625 assertions** |
| acceptance suites | part A **131/131** (journeys A to F, L PASS); part B **148/148**: H, I, J, K, N **PASS**; G and M **PARTIAL** (documented limits, below) |
| gate sabotage, 15 breaks on cloned databases | **15 of 15 turned the critical gate red** (5, 3, 3 and 4 in four batches) |
| mutation campaign on the controls this phase changed | **12 caught of 12, 0 survived, 0 did not land**: M1, M3, M4b, M15, M16, M17, M18, M25, M25b, M27, M27b, M27c. The full 32-mutation campaign was not repeated (about an hour in the foreground) |

One red appeared and was fixed on the way: the first critical run was 58 of 59 because `e2e-duties-budget` is **clock-dependent** (a 07:00 briefing copied into offices
in Auckland and London is correctly not due for about seven hours of each UTC day, 11:00 to 18:00; it passed earlier in the morning and failed at 13:34 UTC). It
was reproduced 36/37 and fixed to 37/37 at the same hour by anchoring the copied briefing at local midnight; what it asserts is unchanged.

Limits that remain on journeys G and M (characterised, not failures): an independent safe step after a parked step waits for the answer; refused outward steps are
not announced at the pause; the final summary can say "I could not slack.post" (a capability identifier); a model that obeys an injected document writes its sentence
as a task on his list (undoable, nothing sent, unmarked as outside-origin).

## 8. Deployment surface of this branch (not authorised)

Migrations, in order: 1023, 1024, 1025, 1026, 1027, 1029, 1030, 1032, 1033, 1034 (1028, 1031, 1035, 1036 unused; `check:migrations` accepts the gaps). Apply 1029
before the worker is deployed. Deploys: **worker** (all of `src/`, including addressing, reminders, delivery, backup retention code), **hq-api** (new action
`reminder_series_stop`), the **voice** edge function (conversation key, message id) and the **Team HQ page** (`app.js`, `chat.js`, `call.js`: "Stop repeating", the
delivery state in the thread). The Telegram webhook, Slack events and MCP functions are unchanged. 1026's retention command stays dry-run and attended; do not
run it. Rollback: capture the live definitions of every function 1027, 1029, 1032, 1033 and 1034 rewrite first; roll the worker back before any database change.

## 9. Decisions and approvals that are yours

1. **Telegram routing scope**: route everything typed to the chief (as built, matching Team HQ), or only delegation phrasing. More jobs, messages and model calls with the former.
2. **A chat-channel notice for a failed or uncertain delivery**: not built because policy does not clearly permit it; say so if you want it and on which channel.
3. **Notion**: whether to bound and resume the sync run (the live class is the 11 "died while running" failures).
4. **Any deployment, and the exact backup deletion list**, each separately.
5. **PARKED reads** (not made): `public.lessons` rows scoped to the chief through Telegram; Notion job durations to split the 11.

Process disclosures: two long sabotage batches exceeded the ten-minute ceiling and were moved to the background by the harness (the first was sized wrong; each
sabotage reruns the whole critical tier, about two minutes); an agent restarted the replica cluster that had stopped; the earlier stray scratch files at the filesystem
root (`/cb.sql`, `/ck.bak`, `/ck.keep`, `/h1.out`, `/h1s.out`, `/h1d.out`) are still there and need deleting by a person.
