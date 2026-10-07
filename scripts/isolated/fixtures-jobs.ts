/**
 * The columns a hand-built command or job needs since the office model (deep systems audit, 7 October 2026).
 *
 * `inbound_commands`, `jobs`, `blockers`, `deliveries` and `responsibilities` all carry `office_id` NOT NULL, and a
 * command/job also names a project that sits in THE SAME office (`*_project_id_same_office`). The older proofs insert
 * rows without either, so they stop at a 23502 before they assert anything: a stale fixture, not a defect. This is the
 * one place that says how to build those two columns, so the proofs that repair themselves do it the same way.
 *
 * Which office is a decision, not a default, and is the whole reason this is a helper and not a constant:
 *   - REAL  = the operator's office (Grant's). A turn here is a real person's: it is trusted, shown, answered, and
 *             containment has something to protect. Use it where the proof's point is "this is real traffic".
 *   - TEST  = the quarantine office. Everything written here is harness by construction (0602); use it for fixtures
 *             whose point is "this must never reach anybody".
 *
 *   const s = scopeOf('real')                        // the office's unnamed project
 *   insert into public.inbound_commands (${s.cols}, origin_channel, ...) values (${s.vals}, 'telegram', ...)
 *   const p = scopeOfProject(projectId)              // office taken FROM the project, so the two always agree
 */
export type Which = 'real' | 'test'

export const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export const officeSql = (which: Which): string =>
  which === 'real' ? 'app.operator_office()' : 'app.test_office()'

export interface Scope {
  /** `office_id, project_id` - no trailing comma, so it can sit anywhere in a column list. */
  readonly cols: string
  /** The two matching values. */
  readonly vals: string
}

/** The office, and that office's catch-all project (what the doors use for an unaddressed turn). */
export const scopeOf = (which: Which): Scope => ({
  cols: 'office_id, project_id',
  vals: `${officeSql(which)}, app.unnamed_project(${officeSql(which)})`,
})

/** A given project, and the office it is in: the pair can never disagree. */
export const scopeOfProject = (projectId: string): Scope => ({
  cols: 'office_id, project_id',
  vals: `(select office_id from public.projects where project_id = ${lit(projectId)}::uuid), ${lit(projectId)}::uuid`,
})
