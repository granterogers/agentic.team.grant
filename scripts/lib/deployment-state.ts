/**
 * The checks that hold the canonical deployment record (docs/ops/deployment-state.json) against the repository.
 *
 * Pure: every function takes what it needs, so the unit tests can show each one failing. Nothing here contacts
 * production; the record is evidence recorded at a time, never a live reading, and says so itself.
 */

export interface DeploymentState {
  readonly schema: number
  readonly recorded: { readonly at: string; readonly isLiveProductionReading: boolean }
  readonly migrations: {
    readonly ledger: string
    readonly appliedAtRecord: number
    readonly highestAppliedAtRecord: string
  }
}

/** The marker a human document carries to say it defers to the record. */
export const DEFERS_TO = 'docs/ops/deployment-state.json'

/** A restated production count is how the human documents drifted; none may carry one. */
export const RESTATED_COUNT = /Production has \*{0,2}\d+ applied/i

export const migrationNumber = (file: string): string => file.slice(0, 4)

/** Committed migration files that the ledger does not list: the pending set, derived. */
export const pending = (files: readonly string[], ledger: readonly string[]): string[] => {
  const applied = new Set(ledger)
  return files.filter((f) => !applied.has(f)).sort()
}

export const problems = (input: {
  readonly state: DeploymentState
  readonly files: readonly string[]
  readonly ledger: readonly string[]
  readonly documents: Readonly<Record<string, string>>
}): string[] => {
  const out: string[] = []
  const { state, files, ledger, documents } = input
  if (state.schema !== 1)
    out.push(`deployment-state.json has schema ${String(state.schema)}, expected 1`)
  if (state.recorded.isLiveProductionReading !== false) {
    out.push('the record must say it is NOT a live production reading')
  }
  if (ledger.length !== state.migrations.appliedAtRecord) {
    out.push(
      `the ledger (migrations/applied.json) lists ${String(ledger.length)} applied migrations but the deployment record says ${String(state.migrations.appliedAtRecord)}; ` +
        'a deploy changes both in one commit',
    )
  }
  const missing = ledger.filter((f) => !files.includes(f))
  if (missing.length > 0)
    out.push(`the ledger names files that do not exist: ${missing.slice(0, 5).join(', ')}`)
  const highest = ledger.map(migrationNumber).sort().at(-1) ?? ''
  if (highest !== state.migrations.highestAppliedAtRecord) {
    out.push(
      `the highest applied migration is ${highest} but the record says ${state.migrations.highestAppliedAtRecord}`,
    )
  }
  for (const [name, text] of Object.entries(documents)) {
    if (!text.includes(DEFERS_TO)) out.push(`${name} does not defer to ${DEFERS_TO}`)
    if (RESTATED_COUNT.test(text)) {
      out.push(
        `${name} restates a production migration count; it must defer to ${DEFERS_TO} instead`,
      )
    }
  }
  return out
}
