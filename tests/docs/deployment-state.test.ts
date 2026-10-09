/**
 * The deployment record agrees with the ledger, and the human documents defer to it (deep systems audit, docs state).
 *
 * The first-wave audit found CLAUDE.md saying 770 applied, HANDOFF saying nothing deployed, and the readiness note
 * saying 798 deployed. One source now carries the facts; this holds the repository to it, and each rule is shown failing.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFERS_TO,
  type DeploymentState,
  pending,
  problems,
} from '../../scripts/lib/deployment-state.ts'

const read = (p: string): string => readFileSync(p, 'utf8')
const state = JSON.parse(read('docs/ops/deployment-state.json')) as DeploymentState
const ledger = Object.keys(JSON.parse(read('migrations/applied.json')) as Record<string, unknown>)
const files = readdirSync('migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f))
const documents = { 'CLAUDE.md': read('CLAUDE.md'), 'docs/HANDOFF.md': read('docs/HANDOFF.md') }

describe('the repository agrees with the deployment record', () => {
  it('has no problems', () => {
    expect(problems({ state, files, ledger, documents })).toEqual([])
  })

  it('derives the pending set from the files, so it cannot go stale', () => {
    const pend = pending(files, ledger)
    for (const f of pend) expect(ledger).not.toContain(f)
    expect(pend.length + ledger.length).toBe(files.length)
  })
})

describe('each rule can fail', () => {
  const ok = { state, files, ledger, documents }
  it('a ledger that disagrees with the record', () => {
    expect(problems({ ...ok, ledger: ledger.slice(1) }).join('\n')).toContain('lists')
  })
  it('a ledger naming a file that is gone', () => {
    expect(problems({ ...ok, files: files.slice(1) }).join('\n')).toContain('do not exist')
  })
  it('a different highest migration', () => {
    const wrong = { ...state, migrations: { ...state.migrations, highestAppliedAtRecord: '0001' } }
    expect(problems({ ...ok, state: wrong }).join('\n')).toContain('highest applied')
  })
  it('a document that does not defer', () => {
    expect(problems({ ...ok, documents: { 'CLAUDE.md': 'nothing here' } }).join('\n')).toContain(
      'does not defer',
    )
  })
  it('a document that restates a production count', () => {
    const restated = `${DEFERS_TO} but also: Production has **770 applied**`
    expect(problems({ ...ok, documents: { 'CLAUDE.md': restated } }).join('\n')).toContain(
      'restates',
    )
  })
  it('a record that claims to be a live reading', () => {
    const live = { ...state, recorded: { ...state.recorded, isLiveProductionReading: true } }
    expect(problems({ ...ok, state: live }).join('\n')).toContain('NOT a live production')
  })
})
