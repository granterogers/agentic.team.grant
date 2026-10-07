# The proof tiers, and the critical gate

Written 7 October 2026, after the deep audit found that the proofs that matter most (tenant isolation, approvals, job
recovery) were red or stale for weeks because **nothing ran them**: `npm test` (5,700+ hermetic unit tests) runs no replica
proof at all, and `scripts/isolated/run-all.sh` could not run (it re-applied migrations the replica already holds and used a
scheme that no longer exists). This is the structural repair. It changes no product code.

## The four tiers

| Tier | What | How to run | Time | Where it is registered |
|---|---|---|---|---|
| (a) FAST | the hermetic unit tests, no database | `npm test` | about 80 s | `tests/**` |
| (b) CRITICAL | the small security and reliability set: tenant isolation, office identity, approvals, the human-contact boundary, job execution and recovery, delivery, task mutation, reminders, provenance, and the migration history itself | `npm run verify:critical` | about 70 s on 4 cores | `scripts/gate/critical.ts` |
| (c) EXTENDED | every other proof that is worth keeping and passes: the seven policy decisions, the Sample, documents, channels, migration-specific proofs, the typed restore, a real browser | `npm run verify:extended` | about 90 s | `scripts/gate/extended.ts` |
| (d) QUARANTINED | historical proofs that cannot say anything true about the current product, or are unsafe in a shared tree | never run | | `scripts/gate/quarantine.ts`, `scripts/isolated/quarantine/README.md` |

`npm run verify:proofs` (also `verify:isolated`, and `bash scripts/isolated/run-all.sh`) runs (b) and (c) together.
`npm run check:proofs` checks the registries only and needs no database.

## What `verify:critical` does

1. **Registry integrity.** Every file under `scripts/isolated/` is a registered proof or a listed helper, none twice, none
   quarantined and running. A new proof that nobody registered stops the gate (use `--allow-unregistered` while a proof is still
   being written: it is named, loudly, and still run by no tier).
2. **The replica.** The cluster must answer on the unix socket (`/tmp/pgs`, port 55432; the gate never uses TCP) and `post` must
   carry `public.isolated_replica_marker`. If the cluster is stopped and you are root it starts it; if `post` is missing and you
   are root it builds the replica with `scripts/isolated/replica.sh`. Anyone else is told the one command:
   `sudo bash scripts/isolated/replica.sh` (about 90 seconds). Measured: a brand-new cluster, built and gated by the runner alone,
   4 proofs in 95 s.
3. **The candidate.** `post` is only ever a TEMPLATE; the gate never connects to it to write. It makes `<prefix>_cand` = a clone of
   `post` plus every migration file in `migrations/` that `post` does not already hold (`replica.sh` records what it holds as the
   comment on `public.isolated_replica_marker`; an older `post` with no such comment is taken to hold everything up to 1026).
   The candidate is rebuilt only when `post` or those files change. A migration that cannot be applied to a copy stops the gate
   and is named: nothing can be said about a branch whose schema does not build.
4. **One clone per proof.** Each proof runs on its own fresh clone of the candidate (`xargs -P4` style pool, `GATE_JOBS` to change
   it), dropped afterwards, with every production credential and `ALLOW_PRODUCTION_*` switch removed from its environment.
   Setup the proof needs is done by the runner, not by weakening a guard: the attack suites demand a database named
   `p2_attack*` / `p3_attack*`, so the runner calls the existing `p2-attack.sh` / `p3-attack.sh` with the candidate as template;
   `p2-backfill-plants` and `ownership-composite-fk` get a pre-0654 template built once; the shell proofs get their own database
   prefix and the candidate (`GATE_DB_PREFIX`, `ISOLATED_POST`).
5. **A verdict from the exit code AND the output** (`scripts/gate/verdict.ts`, unit-tested in `tests/gate/verdict.test.ts`).
   Green only when the proof exited with its success code, printed no failed assertion, printed at least its registered floor of
   passed assertions, and any `p/q passed` summary says p = q. The reds are labelled by cause:

   | Label | Meaning |
   |---|---|
   | `CRASHED` | exited non-zero before a single assertion ran (a stale fixture, a missing migration: the stack trace is not an assertion) |
   | `RED` | an assertion failed, or it exited non-zero after asserting, or its own summary says 18/20 |
   | `NO-ASSERTIONS` | **exited 0 having asserted nothing**: a proof that cannot fail |
   | `BELOW-FLOOR` | exited 0 but ran fewer assertions than its registered floor (about 80% of today's count): checks were dropped |
   | `TIMEOUT` | stopped by the runner (480 s default, per-proof override) |

6. Prints per-proof counts and exit code live, then a summary and the total wall-clock; writes `.out/gate/<run>/<proof>.log` and
   `.out/gate/latest.json`. Exit 0 only when every proof is green; 1 when any is not; 2 when the gate itself could not start.

Two people can gate at once on one cluster by giving different prefixes: `GATE_PREFIX=ab npm run verify:critical`. One gate per
prefix at a time (a lock refuses the second); a crashed run's databases are swept by prefix at the next start.

## How to add a proof

A proof is `scripts/isolated/<name>.ts <database>`. It uses `isolated()` from `guard.ts`, the product's REAL writers, the
multi-user columns (`office_id`, `project_id`; see `fixtures-jobs.ts`, `fixtures-approvals.ts`, `real-telegram.ts`), prints one
line per assertion starting `ok` or `FAIL` (or `PROVEN` / `FAILED`), and exits non-zero on any failure. Then add ONE line:

```ts
// scripts/gate/critical.ts  (or extended.ts)
p('my-proof', 12, 'the invariant it guards, in a sentence'),
```

`12` is the floor: about 80% of the assertions it prints today. For a proof that needs its own setup use `via('p2' | 'p3' |
'script' | 'sql' | 'plants' | 'fk', ...)`; a proof that prints another format gives `okRe` / `failRe` (see `recovery-matrix`); a driver
that prints findings and no assertions says `{ informational: true }`. `tests/gate/registry.test.ts` fails if a committed file
in `scripts/isolated/` is neither registered nor a listed helper, and `npm run check:proofs` fails for an uncommitted one.

Choose the tier by one question: *if this goes red for a day, could a person be harmed, could a stranger read somebody's office,
could the office act outward unasked, or could work be lost without a word?* If yes it is critical. Keep tier (b) small enough to
finish inside ten minutes.

## Why each quarantined proof is quarantined

See `scripts/isolated/quarantine/README.md` (the registry in code is `scripts/gate/quarantine.ts`; a test holds the two together).
In short: `compat-0600` asserts the schema production had before 0601, which is false on every candidate; `job-skew` needs a
database built from a superseded range of migrations and **nothing replaced it** (the worker-versus-schema skew matrix is an open
gap); `p3-sabotage.sh` and `policy-sabotage.sh` rewrite files in the shared working tree, replaced by `scripts/gate/sabotage.ts`.
`fresh-replay.ts` is the replay engine and is now driven by the proof `replay-parity`.

## The gate shown to fail: `npm run verify:gate-sabotage`

A gate that has only ever been green is a gate nobody has seen fail. `scripts/gate/sabotage.ts` breaks one control on a CLONE of
the candidate (never `post`, never the candidate, never a repository file), runs the whole critical tier against the clone, and
requires it to go red naming the proof. Rules it keeps: each edit is made from the LIVE definition, asserts its anchor exists,
reads the definition back and prints the md5 before and after (**a sabotage that did not land is not a passing control**); the
result is compared with a BASELINE run, so a proof that is red for an unrelated reason is not credited; `replay-parity` is ignored
for the verdict except for a drift sabotage, because it goes red for any edit to the candidate and would make every sabotage look
caught; a sabotage the gate does not catch is a coverage finding and fails the run.

Run on 7 October 2026 against the current tree (the baseline had three proofs red for other people's unfinished work:
`project-provenance`, `e2e-convergence`, `e2e-failure`):

| Sabotage (all on a clone) | Caught by (newly red) |
|---|---|
| `harness-false`: `app.harness_job` always false | 16 proofs: p3-app-attack, p1-credentials, authority, forwarded-authority, audit-closure, external-containment, chat-containment, narration-containment, task-content-containment, test-origins, job-origin, terminal-job-owes-a-word, parked-turn-owes-a-word, office-fairness, e2e-tasks, e2e-duties-budget |
| `operator-open`: `public.deployment_operator` true for anybody | p1-operator, p3-app-attack, p1-credentials |
| `level3-proceeds`: CHECK dropped, level-3 rows set to proceed | e2e-boundary, p3-app-attack (not `authority`) |
| `suggest2-proceeds`: one matrix cell flipped | approval-binding, authority, forwarded-authority, e2e-boundary, audit-closure |
| `retrieval-office-join`: `app.search_documents` loses its office predicate | p3-app-attack, e2e-mcp, e2e-documents (not `office-ownership`) |
| `claim-fence-removed`: `app.job_held` stops comparing attempt and claim | job-fence, job-lifecycle, p3-app-attack (not `exactly-once`) |
| `delivery-containment-removed`: `app.claim_delivery` ignores a refusal | containment, approval-delivery, narration-containment, correction-containment, synthetic-origins, test-origins, e2e-tasks, p3-app-attack |
| `reminder-harness-filter-removed`: `app.reminders_due` stops excluding harness tasks | **NOT CAUGHT at first** (50 green; neither `tk-reminders` nor `e2e-tasks` asserted it). Closed by the new proof `reminder-harness`, now the only proof that catches it |
| `origin-trusts-everything`: `app.job_origin` always trusted | 12 proofs incl. job-origin, synthetic-origins, audit-closure, containment |
| `may-act-ignores-origin`: `app.may_act` treats every job as asked-for | **audit-closure only** (one proof: a single point of coverage) |
| `authority-refusal-null`: `app.authority_refusal` never refuses | principals, approver-identity, audit-closure, p3-app-attack |
| `one-live-job-per-key-dropped`: the duplicate-job index dropped | 30 proofs |
| `office-key-dropped`: composite FK `jobs_project_same_office` dropped | office-ownership, office-ownership-sabotage (not `p3-app-attack`) |
| `anon-can-answer`: anon granted EXECUTE on `public.hq_answer_blocker` | anon-surface, p3-app-attack, authority, office-ownership-sabotage. (A first version granted on `app.hq_answer_blocker` and was rightly not caught: anon has no USAGE on schema `app`, so the grant reaches nothing) |
| `schema-drift`: a table no migration creates | replay-parity, office-ownership-sabotage |

15 of 15 turn the gate red after the one proof was added. The restored clean candidate shows nothing red that was not red at
the baseline. The "not by" notes are gaps in WHICH proof catches a break, not in whether anything does; the single-proof ones
(`may-act-ignores-origin`, `reminder-harness-filter-removed`) are the thinnest cover and the first to strengthen.

`scripts/gate/sabotage.ts` takes `--only a,b`, `--list`, `--reuse-baseline` and `--no-restore`, so a long list can be split across
calls that each fit a shell's ten-minute ceiling.

## Measured (7 October 2026, 4 cores, 16 GB)

* Critical tier, 55 proofs, from a replica the runner built itself on a brand-new cluster: 53 green, 2 red, 3,071 assertions
  passed, **149 s gate + about 30 s to build the replica**. On the existing replica: about 70 s.
* Both tiers together, 126 proofs: 124 green, 2 red, 4,692 assertions passed, 141 s (after a candidate rebuild with three newer
  migrations). Per-proof counts are printed live and in `.out/gate/latest.json`.
* The first from-scratch run found two defects in this tooling and both were fixed: `replica.sh` had recorded what it holds in a new
  table in `public`, which `check:ownership` and `check:office-edges` correctly refused as an unclassified product table (the list
  is now the comment on the marker table), and `approval-race.sh` hard-coded the default socket and a `tee /dev/stderr` that fails
  when stderr is a socket. A gate that has only run on the author's cluster has not been run.

## Known state at the time of writing

* The gate is **red on three proofs that belong to work in progress**, and says so by name: `project-provenance` (two assertions:
  a visit's thread key and six concurrent turns, the `conversation-key` change), `e2e-convergence` (two: the actor of a surface
  resolves to null, and the Team HQ composer's `origin_channel` is `voice`). These are findings, not harness faults.
* `e2e-tasks` was red (6 findings) and went green during this window as the task defects were fixed.
* `e2e-failure`'s F7 control asserted that a manual re-drive is the call that SENDS; since migration 1029 the worker re-drives
  the delivery itself, so the first manual call correctly answers `already_sent`. The assertion was updated to the property
  (exactly one message under one key, a repeat drive is a no-op) and was not weakened: the second outcome is now required to be
  `already_sent`, and exactly one message must exist.
* Formatting: every proof file this work owns is clean under `npx biome ci`. The work-in-progress suites `v1-acceptance-a/b` and the
  `vb-probe*` scratch files (somebody else's, still being edited, unregistered) are not: see `npx biome ci scripts/isolated`.
  The pinned formatter is Biome 2.5.11; format by printing (`npx biome check --write --stdin-file-path=<file> < <file>`), never in place.

## Other repairs made with the gate

* `audit-closure`: stale fixtures repaired with the product's real columns and writers (roots built in the operator's office with
  `scopeOf('real')`; `autonomy_settings`, `slack_app_credentials`, `tool_requests`, `mcp_clients`, `blockers` carry `office_id`;
  `hq_task_state` takes the office first). All 31 assertions kept and green; no behavioural finding.
* `tests/text/hostile.test.ts`: the two flaky tests were the cases that take 7 to 9 s alone against the reader's own 10 s wall
  clock. The child now takes a wall allowance (`HOSTILE_WALL_MS`, 120 s) and reports CPU time; the test judges the case on CPU time
  (15 s bound; the cases use 1 to 4 s), keeps the 450 MB memory bound, and still fails if a counter does not end a case (shown by
  lowering the bound to 1 s: it goes red naming the cases). It passed with six CPU burners on four cores.
