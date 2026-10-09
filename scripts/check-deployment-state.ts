/**
 * npm run check:deployment-state
 *
 * Holds the canonical deployment record (docs/ops/deployment-state.json) against the migrations ledger, the committed
 * migrations directory, and the human documents that must defer to it. Local only: reads files, contacts nothing.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { type DeploymentState, pending, problems } from './lib/deployment-state.ts'

const read = (p: string): string => readFileSync(p, 'utf8')
const state = JSON.parse(read('docs/ops/deployment-state.json')) as DeploymentState
const ledger = Object.keys(JSON.parse(read('migrations/applied.json')) as Record<string, unknown>)
const files = readdirSync('migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f))
const found = problems({
  state,
  files,
  ledger,
  documents: { 'CLAUDE.md': read('CLAUDE.md'), 'docs/HANDOFF.md': read('docs/HANDOFF.md') },
})
const notApplied = pending(files, ledger)
console.log(
  `deployment record ${state.recorded.at}: ${String(state.migrations.appliedAtRecord)} applied at the record; ` +
    `${String(notApplied.length)} committed and not in the ledger${notApplied.length > 0 ? ` (${notApplied.join(', ')})` : ''}`,
)
if (found.length > 0) {
  for (const p of found) console.error(`FAIL ${p}`)
  process.exit(1)
}
console.log('ok')
