# Handover — the 8-hour autonomous completion run, 18 September 2026

| | |
|---|---|
| **starting HEAD** | `927073c` (= `origin/main` at the time) |
| **ending HEAD** | see `git log`; all work pushed to `claude/phase-7-communications-kh8ow8` |
| **migrations** | 488 → **493** |
| **unit tests** | 1,716 → **1,735** |
| **gate** | ran 36 suites in 2,399s → 32 passed; **all four failures fixed and individually re-run green** |
| **issues closed** | **#272**, **#276** |
| **deployments** | `worker` ×4 · `google-oauth` v377 · `hq-api` v586 · studio |
| **run ledger** | `docs/RUN-LEDGER.md` — kept current throughout, for compaction |

---

## The governing question

*Does the Agentic Team actually work when Grant uses it?* Nine defects were
found. **Not one came from reading code.** Every one came from asking the
database what happened, running the thing, or opening the artifact.

---

## TESTED — exercised end to end, evidence in hand

### The nightly backup had been dead since 16 September

`office.backup` failed silently on the 17th. Not a flake: `buildArchive` takes
a **measured 148 seconds** for 119 tables and 107,193 rows, against an edge
function that does not get that long, and it grows nightly.

Rebuilt as a folder — one gzipped object per table, each a checkpointed step.
**Proved end to end**: attempt 1 banked 111 of 120 steps before the function
was killed; the lease expired; `app.recover_stalled_jobs` moved it to
`retrying`; **attempt 2 finished all 120** — 107,255 rows, 9.6 MB. Then
`backup:rehearse` restored **107,255 of 107,255 rows** into a scratch schema,
120 objects checksum-clean, every table's count matching the manifest.

The first backup to complete in two days and the first restore ever rehearsed
from one. **ADR-0042** records why the prefix is job-derived and the effect is
`local` — both look wrong and "fixing" either reinstates the bug.

### The office could not tell Grant what it cannot do

`app.proposals_to_send` and `app.proposals_sent` had **never had a production
caller**, so #49's loop ran correctly to the last link and stopped. 0489 wires
it, with `proposals_undeliver` so a failed delivery cannot silently lose the
one message that says the office is stuck. Driven against the real database:
announced, named the gap, marked against its own job, not re-offered, and came
back when that job did not deliver.

### Grant's morning briefing failed at 04:00, and four siblings with it

Confirmed against `public.jobs`, not inferred:

    office.slack_rotate      10   latest 07:13 18 Sep
    briefing.morning          2   latest 04:00 18 Sep   <- he got no briefing
    office.capacity_report    2
    office.sync               2

Five handlers claimed `deterministic_retrieval` on the one branch that spends a
model; the gate threw the answer away and failed the job. All fixed.
`office.capacity_report` re-driven against the real database with a real model:
`path=inference`.

### Every failure the office "recognised" was a suite's

`failure_signatures` feeds a weight-75 suggestion and the morning briefing.
**Every row was harness traffic** — 138 of them saying `office.instruction` had
failed, which is how Grant's own messages are answered and which had zero real
failures in the same period. 0491 fixes both ends of the pipe and sweeps.

### Every report printed Grant's request on its cover

Pulled the newest PDF out of Storage and opened it. The body is good — heading
hierarchy, captioned table, running header. Page one carried
*"Write me a PDF report on the coaching course modules, from what we hold."*
and two thirds of an empty page. `coverLine` takes the document's own opening
clause. Re-rendered and looked at again.

### Two more, from the gate

- **0492** — 0490's filter ignored `p_include_fixtures`, the switch that exists
  to disable it; and its own drive found that **`proposals_to_send` had no
  harness filter at all**, because 0490's splice loop asserted it had hit ONE
  of three targets rather than each. Between 0489 and 0492 a suite could have
  made the office message Grant about a gap it invented.
- **0493** — a config key I named `app.base_url` made a correct function look
  like it referenced a missing relation. Renamed `web.base_url`; a trigger now
  refuses any new key whose prefix is a schema name.

### And Telegram / Slack, from the beta session that preceded this run

0486–0488 are in the same branch: the OAuth pages had never rendered, Telegram
was never disconnected though the dashboard said so, and Slack could have lied
the same way.

---

## INFERRED — sound but not exercised end to end

- **`briefing.morning`'s own fix.** Unit-tested and identical in mechanism to
  `office.slack_rotate` (proved end to end) and `office.capacity_report`
  (proved against a real model). Its model branch could not be driven without
  clearing today's briefing record and risking a duplicate to Grant.
- **`office.sync` and `office.notion_sync`.** Same fix, same class; their
  announce branches are data-dependent and did not arise during the run.

## NOT TESTED

- #41 §8 chaos: a 100 MB file, clock skew on lease expiry, two workers on one job.
- Voice, mobile Safari, and the phone leg of the deployed studio.
- `browser_session_establish` (#135) — blocked behind the Cloudflare account.
- `ci_lately` / `ci_budget` — `public.ci_runs` holds 0 rows; Actions off (#17).

---

## Baselines

| | before | after |
|---|---|---|
| `check:pressable` | 15 | **14** — and one entry left carrying a FALSE reason |
| `check:callers` | 10 | **8** — every survivor now has a stated reason |

---

## What this run learned about its own instruments

Worth more than the defect list, and the reason to trust the rest of it.

**Three checks I wrote were inert and green**, each caught by a control rather
than by reading:

1. the determinism rule matched **zero** return blocks and stayed green under
   sabotage — its block reader jumped past every inner `return {`;
2. `verify:notice`'s new check asked the reader 0491 had just taught to filter,
   so planting a harness signature left it green;
3. the cover-line test passed on `"…client enga…"` because it asserted length
   and an ellipsis, not a word boundary.

**Two more were environment-dependent or asserting against a safety rule**:
`verify:mail` probed "the cache as it is, which is stale", true only while
Google's token was dead; `verify:proposes` asserted its own fixture should
reach the batch Claire sends.

**And one baseline entry carried a reason that was simply false.**

The discipline that caught all of these: sabotage every new detector, give
every found-nothing check a control that must come back positive, and validate
the test before believing the finding.

---

## Mistakes made in this run, recorded so they cost once

- **Pushed a red tree** by reading `npm run lint`'s tail instead of its exit
  code. CLAUDE.md records this twice. Corrected in the next commit.
- **Committed an unverified suite change** under a Management API 429 — stated
  plainly in the commit message rather than implied, and re-run (26/26) as the
  first action after the gate.
- **0489's sweep deleted nothing and reported success**, the exact trap the
  migration's own header quotes.
- **Hit the backtick-in-a-comment-in-a-template-literal trap**, two comments
  below one warning about it.

---

## What Grant has to do

**Nothing urgent.** One optional item, unchanged from this morning: regenerate
the Slack app configuration tokens at https://api.slack.com/apps → *Your App
Configuration Tokens*. Slack posting and reading are unaffected.

#18 and #213 remain external credential rotations on his own accounts.

---

## Exact recommended next work

1. **#261 / #16 / #135 as ONE vertical slice** — authorized task → browser →
   gather → artifact → deliver. Check first what is independent of the
   Cloudflare credential, because `browser_session_establish` is not.
2. **#41 §8 chaos cases** — the three named above are the honest remainder.
3. **The routing pattern** — eleven of thirteen misses are decided by the
   literal trigram matcher before the semantic layer is consulted
   (`docs/testing/e2e-2026-09-18.md`).
4. **#259's Vikunja provider** — waiting on Grant's hosting decision.
5. **#260** — verify what NotebookLM actually exposes before designing.
6. **The visual pass**, with the screenshot loop.
