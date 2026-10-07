# Quarantined proofs (tier d)

Nothing in this folder is run by `npm run verify:critical`, `verify:extended` or `verify:proofs`, and the runner refuses
`--only` on any of them. They are kept, not deleted, because each records something the office once had to prove and a
future person should be able to read what it was. The registry that says the same thing in code is
`scripts/gate/quarantine.ts`; `tests/gate/registry.test.ts` fails if the two ever disagree.

| File | Why it is quarantined | What replaced it |
|---|---|---|
| `compat-0600.ts` | Asserts the schema production had BEFORE 0601 (`app.job_origin` absent). Its first check is that the function does not exist, which is false on every candidate: it can only fail. | Nothing for the 0600 skew itself (history). The live rule it guarded, that a harness job is refused a real destination, is `containment`, `job-origin` and `synthetic-origins` in the critical tier. |
| `job-skew.ts` | Version skew: the NEW worker on the OLD schema (before 0619 and 0620), on a database built by replaying a fixed, since-superseded range of migrations. | **Nothing.** The current worker-versus-schema skew matrix is an open gap, named in the System Health Report. `job-lifecycle` proves the other direction (old code, a job with no claim, on the new schema). |
| `p3-sabotage.sh` | Applies its sabotage by rewriting a migration FILE in the working tree and restoring it afterwards. In a shared tree that races every other editor, and if it is killed it leaves a broken migration behind. | `scripts/gate/sabotage.ts`: the same idea (break one control, show the gate goes red, restore) applied to a clone DATABASE, with proof the break landed. |
| `policy-sabotage.sh` | Edits copies of source files in the working tree and restores them from a backup directory every run shares by name. | `scripts/gate/sabotage.ts` for the database half; the TypeScript half is `scripts/audit/mutation-campaign.ts`, which works in a git-backed throwaway worktree. |

`scripts/isolated/fresh-replay.ts` is not here: it is the replay ENGINE, and the proof that uses it is
`scripts/isolated/replay-parity.ts` (an empty database, every migration, the schema fingerprint compared with the candidate
and shown able to fail). Run alone, the engine cannot judge anything, which is why it is a helper and not a proof.

To bring one back: make its precondition true on the current candidate (or change the claim), move it to
`scripts/isolated/`, register it in `scripts/gate/critical.ts` or `extended.ts`, and remove it from `scripts/gate/quarantine.ts`.
