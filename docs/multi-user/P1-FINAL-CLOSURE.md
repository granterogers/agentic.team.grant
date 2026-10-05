# P1 final closure

Written 1 October 2026, before any P2 change reached production. It answers the five requirements of the closure
turn one at a time and says what was run, against what, and what came back.

**P1 FINAL CLOSURE: PASS**, with seven pre-existing red suites that are NOT closed and are fenced below by a
check-by-check fingerprint, so that a P2 regression cannot hide behind them.

## 1. P1 is the implementation baseline

| | |
|---|---|
| P1 branch | `claude/multi-user-p0-p1`, tip `0b682ba2` (production migrations through 0652) |
| `main` | `41de1965`, unmoved since P1 branched: P1 is a fast-forward of it |
| This work | `claude/multi-user-p2`, cut from P1 + `f740eac3` (0653 and the MCP revocations) |
| History | nothing was force-pushed; no P1 fix was dropped; `git merge-base` of the two is `41de1965` |

Fetched first (`git fetch origin main`); the worktrees used to classify the gate (`/tmp/p1wt` at this branch's committed
tip, `/tmp/basewt` at `origin/main`) were made after the fetch, so "baseline" below means `41de1965` exactly.

## 2. MCP clients

**Rule recorded, in force:** *no second real office may activate MCP until the office-bound MCP conversion is
complete.* It is a check, not a sentence: `npm run check:office-edges` fails if more than one `person`/`sample` office
is active while any MCP client is enabled and `system_config['mcp.office_bound']` is not `true`
(`transitional` in `src/ownership/enforcement.ts`; its control is the ninth of nine).

**Future invariant:** an MCP credential belongs to exactly one office and the credential itself establishes it.
`mcp_clients.office_id` is NOT NULL and immutable after 0659 and `token_sha256` stays globally unique, so a token can
only ever resolve to one office. The gateway still resolves the person from the bearer, not the client's office: that
conversion is P3 and is the thing the rule above waits for.

Before: 22 clients, all enabled, all `read,write`, **0 calls ever** (`mcp_calls` is empty), none ever seen.

| Client(s) | Count | Created | Purpose | Scope | Last use | Decision | Evidence |
|---|---|---|---|---|---|---|---|
| `Flow probe` (`mcpc_…`) | 20 | 7-14 Sep | an OAuth discovery probe; registered by a flow test, never used for anything | read,write | never | **REVOKED** (`enabled=false`, reason recorded) | `mcp_oauth_clients` holds the same 20; `mcp_calls` 0 rows; the P1 closure measurement of 30 Sep; no document names them |
| `Claude Desktop` (`claude`) | 1 | 6 Sep | Grant's own Claude Desktop connector | read,write | never | **KEPT, bound to the person office** | `migrations/0064_mcp_clients.sql` registers it by name as one of the designed readers; 0068 records Grant asking for write ("I use ChatGPT and I say ...") |
| `ChatGPT` (`chatgpt`) | 1 | 6 Sep | Grant's own ChatGPT connector | read,write | never | **KEPT, bound to the person office** | same two migrations |

After: 2 enabled, 20 disabled. The two kept clients are the only ones whose purpose is established from a source other
than their existence (the migration that created them, and Grant's own request for the write scope). Neither has ever
been called. They stay revocable by one `update`, and 0659 stamps them to the person office, so the transitional rule
above is the only thing standing between them and a second office.

## 3. The ten leaked harness tasks

Cleared by `migrations/0653_clear_ten_harness_tasks_left_on_his_list.sql`, a one-shot, applied once, creating no
function and no capability. `check:leaks` was not modified and no residue was whitelisted.

* It names the ten task ids, counts the rows that match **all** of `assigned_to_human`, `state <> 'done'`,
  `job_id is not null`, `app.harness_job(job_id)`, created 2026-10-01 10:30-11:00, **raises unless exactly ten**
  match, deletes those ten, and asserts ten were deleted. On a database that holds none it does nothing.
* An earlier attempt at a direct `delete` was refused by the permission classifier and was not retried by another
  route; the migration was the path this turn's instruction named.
* One further fixture task (not one of the ten) was cleared with the sanctioned `npm run purge:fixtures -- --go`.
* `check:leaks` after: green (gate entry 40: PASS in 35s).

## 4. The complete 73-entry gate

`scripts/e2e.ts --gate`, no ten-minute ceiling, one process, 8,106 s. **58 of 73 passed.** Every failure was then
re-run alone, sequentially, on a clean worktree of this branch's committed tip (`P1`) and, where it failed again, on
`origin/main` (`BASE`). While the gate ran I was also dry-running the P2 migrations against production, which take
`ACCESS EXCLUSIVE` locks and which also left uncommitted P2 files in the working tree the gate was using; that is why
the reruns are on clean worktrees.

| Gate entry | In the gate | Rerun P1 | Rerun BASE | Classification |
|---|---|---|---|---|
| verify:review | FAIL | FAIL (same 8 checks) | FAIL (same) | **baseline failure**, reproduced. The review-copy bundle never boots in this browser (`waitForSelector` times out) |
| verify:wrappers | 42/43 | 42/43 | 42/43 | **baseline**: `approve_document` wrapper and app function disagree on arguments |
| verify:attests | 9/11 | 9/11 | 9/11 | **baseline**: harness work "may not write to an unclassified destination" |
| verify:recovers | 13/19 | 13/19 | 13/19 | **baseline**: same containment message |
| verify:backups | FAIL | FAIL | FAIL | **baseline**: the backup chore does not clear |
| verify:transport | FAIL | 14/23 | 14/23 | **baseline**: same nine checks, same reason |
| verify:mytasks | FAIL | FAIL (same 4) | FAIL (same 4) | **baseline**: finishing a repeating task |
| verify:history | FAIL | **58/58 x3** | n/a | **environmental, self-inflicted**: `40P01 deadlock detected` - it waited for the `AccessExclusiveLock` my concurrent migration dry-run held. Three clean runs, all 58/58 |
| verify:artifact-slack | 13/16 | 20/20 | n/a | **interference** (same cause); passes alone |
| verify:handoff | FAIL | 13/13 | n/a | **interference**; passes alone |
| verify:escapes | FAIL | pass | n/a | **interference**; passes alone |
| verify:collaborates | 9/13 | 13/13 | n/a | **interference**; passes alone |
| verify:routing-breadth | 10/11 | 11/11 | n/a | **interference / model variance**; passes alone |
| verify:another-go | FAIL | 9/10, 9/10, 10/10 | 10/10; then 2 runs timed out inside the ceiling with the check under test passing | **expected stochastic variance**: it asserts what a model chose; both trees talk to the same deployed worker |
| verify:isolated | FAIL (1 s) | 3 failing groups | 3 failing groups | see below |

`verify:isolated` failed in one second in the gate because the working tree already held the unapplied P2 migrations
and the replica `cand` had no logins for `office_members`. Run on the clean worktree (`MIG_FLOOR=0653`, because the
replica `post` already holds everything through 0652): 68 proofs, three groups red.

* `version skew` and `0596 overlapping answers`: **baseline**, red identically on BASE. The replica `post` is already
  the new schema, and both proofs need an older one.
* `anon-surface`: red on BASE only, because the base code still calls `public.vault_secret`, which P1's 0649 removed.
  Not a P1 failure; the schema is ahead of that tree.
* `policy-vikunja`: red on P1 only, and the **one genuine P1 differential**. P1.3 made connecting a board an
  operator-only act, so the gateway now refuses a test member at the door (`403 operator_required`) instead of
  answering 200 with an error in the result, and the proof asserted that mechanism. The security property it exists
  for (a test member mints no authorisation) holds. The proof now asserts the property (refused with
  `operator_required` or `person_required`, or an error in the result, **and** zero authorisations minted): 25/25.

### The fence around the seven baseline reds

Seven suites are red on the baseline and stay red. They are not P1's and not closed by this turn, but a P2 regression
in the area one of them covers would be invisible behind an existing red. So the failing *checks* are recorded; P2's
final gate must fail the same checks and no others.

```
verify:wrappers   approve_document's wrapper takes the same arguments
verify:review     the bundle boots from a sub-path with no rewrite rules; every asset it asks for is in the bundle;
                  it opens ON the experimental experience rather than the default one; and says it is a review copy;
                  a fragment the host owns (#artifact-abc | #section-2 | #) still opens the experiment;
                  it opens ON the redesigned project home, not one click away
verify:backups    the chore raises once, does not repeat itself, and clears when the backup is healthy;
                  the drive left no chore behind
verify:recovers   the recorded reason names what actually happened; and it is waiting to be retried rather than
                  silently dropped; and the refusal is recorded where a person looks; the mutation that succeeded is
                  still there; and the job is honestly complete rather than failed; and the answer says which half
                  did not happen
verify:attests    the message is refused rather than produced; and the refusal is recorded, so a lost answer is
                  visible rather than silent
verify:transport  a delivery is claimed before anything is sent; claiming the same key twice does not make a second
                  delivery; a failing send is retried, and then gives up; the failure is recorded against the
                  delivery, not swallowed; a delivery that gave up is not quietly retried by the worker; a person can
                  send it again, and only the failed one is queued; and it gets a fresh budget rather than one more
                  go; one surface failing does not stop another; the one that already arrived is left alone
verify:mytasks    finishing a repeating task leaves the done one and makes the next; the finished occurrence stops
                  repeating, or every completion makes another; and the next one is not in the past; the done one is
                  in Done and out of Today
```

## 5. The history flake

Root cause, from the failing run itself: `40P01 deadlock detected ... Process A waits for RowShareLock on relation
17561; blocked by process B. Process B waits for AccessExclusiveLock on relation 17860; blocked by process A.` Process B
was a P2 migration dry run (`ALTER TABLE ... ADD COLUMN` on a table `verify:history` reads) running concurrently. Three
subsequent runs on a quiet database: 58/58, 58/58, 58/58. It is a property of running schema changes under a live
suite, not a defect of the suite. The same fact is a finding for P2's apply procedure: the same dry runs deadlocked
against the **live worker** when they were run without pausing it (a rolled-back dry run lost the deadlock race
twice), so the production apply pauses the worker heartbeat first and retries on `40P01`.

## 6. P1 security properties

Green in the gate: `verify:security` 20/20, `check:anon-exposure`, `check:machine-key`, `check:system-secrets`,
`check:ownership`, `check:leaks`; and in the clean isolated run, every proof except the three groups explained above.

## Verdict

* P1 is the baseline. **Yes.**
* Flow probes revoked, the other two accounted for. **Yes.**
* Ten tasks cleared; `check:leaks` green. **Yes.**
* The unrestricted gate completed. **Yes**, 58/73, every red classified by reproduction.
* No unexplained P1 differential. **Yes**: one found (`policy-vikunja`), explained, proof corrected.
* P1 security properties green. **Yes.**

**P1 FINAL CLOSURE: PASS**
