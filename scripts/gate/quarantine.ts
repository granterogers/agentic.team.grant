/**
 * TIER (d): OBSOLETE / QUARANTINED historical proofs. Never run by `verify:critical` or `verify:extended`.
 *
 * A proof lands here when it cannot be made to say anything true about the CURRENT product, or when running it is unsafe
 * in a shared tree. Each entry says why, and what replaced it. "Nothing" is a legitimate answer and is written as such:
 * a gap that is named is better than a proof that is green for the wrong reason. The files themselves live in
 * scripts/isolated/quarantine/ with a README that repeats this table.
 */
import { out } from './p.ts'
import type { Quarantined } from './types.ts'

export const QUARANTINE: readonly Quarantined[] = [
  out(
    'quarantine/compat-0600',
    'RC2 deployment compatibility: asserts the schema production had BEFORE 0601 (app.job_origin absent). Production has moved far past it and the candidate gate runs on a schema where the precondition is false by construction, so it can only fail.',
    'nothing for the 0600 skew itself (it is history). The live rule it guarded, that a harness job is refused a real destination, is containment, job-origin and synthetic-origins in tier b.',
  ),
  out(
    'quarantine/job-skew',
    'Run 4 version skew: the NEW worker on the OLD schema (before 0619 and 0620), on a database built by replaying a fixed range of migrations that the repository has since moved past.',
    'NOTHING: the current worker-versus-schema skew matrix is an open gap (the health report lists it). job-lifecycle proves the other direction (old code on the new schema, a job with no claim).',
  ),
  out(
    'quarantine/p3-sabotage.sh',
    'Applies a sabotage by rewriting a migration FILE in the working tree (python in place) and restoring it afterwards. In a shared tree that races every other agent and, if killed, leaves a broken migration committed.',
    'scripts/gate/sabotage.ts: the same idea (break one control, show the gate goes red, restore) applied to a CLONE DATABASE, never a file, with proof the break landed.',
  ),
  out(
    'quarantine/policy-sabotage.sh',
    'Breaks each policy boundary by editing a COPY of source files in the working tree and restoring from /tmp backups; unsafe under concurrent editing and its backup directory is shared by name.',
    'scripts/gate/sabotage.ts for the database half; the TypeScript half is covered by the unit mutation campaign (scripts/audit/mutation-campaign.ts, a git-backed throwaway worktree).',
  ),
]
