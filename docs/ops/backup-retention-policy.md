# Backup retention policy

**Status: RECORDED AND TESTED. NOT EXECUTED.** Nothing has been deleted, no backup has been touched, migration 1026 has not been deployed,
and no production system was contacted to write this. Destructive retention in production stays separately approval-gated (see "The approval
gate").

## The owner's policy, verbatim

> the desired future backup retention is: (1) the NEWEST 7 DAILY VERIFIED backups; PLUS (2) the NEWEST VERIFIED backup from each of the
> PREVIOUS 8 ISO WEEKS.

(Grant, 7 October 2026.) The earlier implementation was *"newest 7 plus one a week for 8 weeks; never the newest verified; never an object it
did not create; a dry run by default and a deletion only with an attended flag"*. It counted the newest 7 **runs** (not days), counted the current
week as one of the 8, treated verification as a single flag on the newest run only, and deleted unfinished runs after three days. It is replaced
by the reading below. The code is `src/backup/retention.ts` (a pure function), `src/backup/runs.ts` (reads the bucket, verifies, and is the only
thing that deletes) and `scripts/backup/prune.ts` (the attended command).

## The precise interpretation

| Term | Meaning here | Why |
|---|---|---|
| **Backup (a run)** | One `run-<uuid>` folder (246 to 286 objects a night) or one legacy `aiteamhq-<stamp>.json.gz` with its checksum. Kept or dropped **whole**; the plan names runs, never objects. | A backup is only a backup if it is complete. The executor deletes a run's manifest **last**, so an interrupted deletion leaves an unfinished run, not a manifest vouching for missing objects. |
| **Verified** | The repository's own check: every object of the run was read back and its sha-256 matched the checksum stored beside it (`readFolder` in `src/backup/portable.ts`, the read `backup:rehearse` does), and the run has a manifest. `verifyRuns` in `runs.ts` performs it for each run; the planner takes the result as an input (`verified: boolean`) and never infers it. | One definition, the one the restore rehearsal already trusts. |
| **Unverified / unknown** | Ours but not verified, or ours but unfinished (no manifest). They are **reported** in the plan (`unknown`), are **never counted** toward the kept set, are **never selected for deletion**, and can never cause a verified run to be deleted. | The policy can only delete what is proven readable; deleting a copy we cannot vouch for would be a decision nobody asked for. Consequence: an unfinished run, including debris left by an interrupted deletion, stays until a person decides about it. |
| **Daily** | One per **UTC calendar day**: the newest verified run of that day. The kept dailies are the **newest 7 days that have a verified run** (today included). A night with several runs yields one daily; the others are outside the policy. | "Newest 7 daily verified backups" is a count of backups, one per day. Counting days that *have* a verified run (rather than the last 7 calendar days) keeps seven copies through an outage or a day nobody verified: the 2 to 5 October outages must not shrink the daily set to four. |
| **ISO week** | Monday-based, UTC, week 1 holds the first Thursday. 2027-01-01 is 2026-W53; 2025-12-29 is 2026-W01. | ISO 8601. A run's week is decided from its UTC instant only. |
| **Previous 8 ISO weeks** | The 8 ISO weeks **before** the current one; the current week is excluded. For each, the newest verified run in that week is kept, even when older than the daily window. | The wording says "previous". |
| **Counts once** | A run that is both a daily and a weekly is one kept run (reported as the daily). So the kept set is at most 7 + 8 = 15 runs (14 whenever the newest week's keeper is also a daily). | |
| **Newest verified** | Always kept, whatever the numbers say (even with the daily and weekly counts set to zero). | The retention pass must never leave the bucket without a copy proven readable. If nothing is verified the plan is **refused** and deletes nothing. |
| **Created by this system** | Only `run-<uuid>` folders and legacy `aiteamhq-<stamp>.json.gz` files. Anything else is listed as foreign and is never touched, kept, counted or deleted. | A person may drop a hand-made export in the bucket. |

Two safety limits remain that are **not** part of the owner's wording and are configurable: nothing younger than 24 hours is deleted (a second
run on today's date is not removed an hour after it finished), and at most 30 runs are deleted a pass, oldest first (a wrong policy has a bounded
blast radius; a later pass takes the rest). Both only ever keep more; a run held back by either is reported as `too-young` or `deferred`.

The plan's output per run is one of `keep` (with rule `newest-verified`, `daily`, `weekly`, `too-young` or `deferred`), `remove`
(`outside-policy`) or `unknown` (`unverified` or `incomplete`), plus `foreign` names and `refused`. Tests assert on the rule value, never on the
wording of a reason.

## The approval gate (reused, not new)

* `npm run backup:prune` is a **dry run**: it verifies each finished run by reading it back, prints the plan, and deletes nothing.
* A deletion needs **both** `--attended` **and** the repository's own production-write approval, `ALLOW_PRODUCTION_CHECKS=1` plus
  `ALLOW_PRODUCTION_WRITES=1` (`src/safety/production-gate.ts`; the script's first import refuses without them). `applyRetention` repeats both checks
  at the moment of deletion and **throws** (it does not quietly downgrade to a dry run) when either is missing. `--go`, the old flag, no longer
  deletes; it exits with a message.
* `applyRetention` also refuses a plan that names a foreign file, an unverified run or an unfinished run, whatever produced the plan.
* **Production destructive execution additionally needs the owner's separate approval of that specific deletion.** No code in this repository can
  grant that, and the two environment variables are the owner's switch, never an agent's. The nightly handler never plans a deletion; it only
  reports the size and says to run the dry run.

## Worked example (computed, not production)

`npx tsx scripts/ops/backup-retention-example.ts` runs the pure planner over the **shape** recorded in
`docs/audit/TIER1-PRODUCTION-EVIDENCE-2026-10-07.md`: one nightly backup for 16 days, 21 September to 6 October, 12.6 MB growing to 26.0 MB
(intermediate sizes are interpolated; only the endpoints and the day count are from that document, and no bucket was read). "Now" is 7 October
12:00 UTC (ISO 2026-W41, Monday 5 October). The policy is today's current week W41 (5 to 11 October), so the previous 8 weeks are W40 back to W33.

**A. every night verified** (308.8 MB held): keep 8 (181.2 MB), delete 8 (127.6 MB).

| Night | Decision | Rule |
|---|---|---|
| 21 to 26 Sep (6 nights) | delete | outside-policy |
| 27 Sep (Sunday, last night of W39) | keep | weekly |
| 28, 29 Sep | delete | outside-policy |
| 30 Sep to 5 Oct (6 nights) | keep | daily |
| 6 Oct | keep | newest-verified (also the 7th daily) |

W40's keeper is 4 October, which is already a daily, so it counts once; W38 and earlier have no run. The current week W41 contributes only through
the daily window.

**B. 3 and 5 October not verified** (hypothetical): keep 8 (171.4 MB), delete 6 (89.0 MB), unknown 2. The two unverified nights are reported and
neither kept nor deleted; the daily window reaches back to 28 and 29 September to find seven *verified* days, so those two are kept and only
21 to 26 September go.

**C. only the newest night verified** (hypothetical, nothing older read back): keep 1, delete 0, unknown 15. Until older runs are verified the
policy can free nothing, by design.

For scale, the same policy on a steady nightly series settles at 14 to 15 kept runs; the earlier capacity model
(`capacity-scenarios-2026-10-06.md`) was run before this wording and counted the current week as one of the 8, so its "after" column is within one
archive of this policy.

## Tests

`tests/backup/retention.test.ts` (44 tests): one table-driven group per rule (daily, weekly, verified, current week excluded, newest verified,
boundaries), the ISO boundaries 2026-W53 / 2027-W01 and 2025-W52 / 2026-W01, UTC and daylight-saving independence (the suite is run under four process
time zones and must give the same plan), 0, 1 and only-unverified inputs, a gap of days, two runs in a day, a run at the exact Monday instant and one
millisecond before it, and property tests over 600 seeded random histories against an independent oracle (epoch-day arithmetic, sharing no code with
the planner): never deletes the newest verified, never deletes a run in the kept set, never deletes unverified, unfinished or foreign runs,
idempotent, the policy-kept set is exactly what the oracle says and is bounded by 7 + 8, and a series already within policy deletes nothing. The
deletion path is driven with a recording `fetch`: the default is a dry run that sends nothing, `go` without `--attended` throws, `--attended`
without the production-write approval throws, both together delete the whole run with its manifest last, and a corrupted plan naming an unverified,
unfinished or foreign run is refused whole.

The replica proof `scripts/isolated/backup-restore-typed.ts` drives the real `verifyRuns`, `planRetention` and `applyRetention` against the storage
emulator (59 checks): only the genuinely written backup verifies, seeded runs with a wrong checksum are unverified and never removed, the three
refusals hold, deletion proceeds run by run with the manifest last, the passes converge and what is left is within the owner's policy.

Sabotage results are recorded in the change report: 7 days to 8; the verified filter dropped; the current week counted as one of the 8; the
newest-verified guard removed; unverified runs made deletable; the attended check, the production-write check and the unverified-plan guard in the
executor each removed. Each turns named tests red; the one mutation that did not (weeks 0 to 8 instead of 1 to 8) is an equivalent mutant, because
the current week's newest verified run is by definition the newest verified run overall, which is always kept anyway.

## Not executed, and what is not claimed

* **No backup has been deleted and the policy has not been run against production.** The first attended run needs the owner's approval of the exact list
  the dry run prints.
* **`verifyRuns` has been driven against the storage emulator only.** Reading roughly 26 MB and 246 to 286 objects per run through the real Storage
  API (30 or more runs) has not been timed; a first attended pass may be slow.
* The list call in `src/backup/portable.ts` (`listUnder`) asks for 500 entries; a run with more than 500 objects would be listed truncated. Nightly runs are
  246 to 286 objects, so this is not reached today (PARKED as an adjacent observation).
* Migration 1026 holds no retention setting that encodes the old policy (it is the capacity watch); nothing there needs to change.
