import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Reading } from '../../scripts/rollout/gate-lib.ts'
import { appendLine, GATE_LOG, logWrite, requireTwoGo } from '../../scripts/rollout/log.ts'

/*
  requireTwoGo is what scripts/rollout/read.ts and step.ts call before the baseline and before the first write. It reads the two
  logs under .out/rollout/ relative to the working directory, so each test runs in its own empty directory.
*/
const HEALTHY = ['auth', 'db', 'rest', 'storage'].map((name) => ({
  name,
  status: 'ACTIVE_HEALTHY',
}))
const OKS = [
  { name: 'the cron canary is quick and succeeding', ok: true, detail: '0.1s succeeded' },
]
const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const reading = (minutesAgo: number, over: Partial<Reading> = {}): Reading => ({
  at: at(minutesAgo),
  go: true,
  health: HEALTHY,
  checks: OKS,
  reasons: [],
  ...over,
})

const spyOnExit = () =>
  vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit')
  }) as never)
let cwd = ''
let dir = ''
let exit: ReturnType<typeof spyOnExit>
beforeEach(() => {
  cwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'gate-'))
  process.chdir(dir)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  exit = spyOnExit()
})
afterEach(() => {
  process.chdir(cwd)
  vi.restoreAllMocks()
})

describe('requireTwoGo reads the logs and refuses (exit 1, nothing sent) unless the condition holds', () => {
  it('refuses with no log at all', () => {
    expect(() => requireTwoGo('the read-only baseline')).toThrow('exit')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('refuses with one good reading', () => {
    appendLine(GATE_LOG, reading(1))
    expect(() => requireTwoGo('the read-only baseline')).toThrow('exit')
  })

  it('passes for two good readings ten minutes apart, the latest recent (the control)', () => {
    appendLine(GATE_LOG, reading(11))
    appendLine(GATE_LOG, reading(1))
    expect(() => requireTwoGo('the read-only baseline')).not.toThrow()
  })

  it('refuses if the second reading deteriorates, so the baseline is not run', () => {
    appendLine(GATE_LOG, reading(11))
    appendLine(GATE_LOG, reading(1, { go: false }))
    expect(() => requireTwoGo('the read-only baseline')).toThrow('exit')
  })

  it('refuses when a production write has been logged since the first reading', () => {
    appendLine(GATE_LOG, reading(11))
    appendLine(GATE_LOG, reading(1))
    logWrite('apply-attempt 1023', false)
    expect(() => requireTwoGo('step 1023 apply', true)).toThrow('exit')
  })

  it('applies to the FIRST write only: after a successful apply a later step is not blocked by it', () => {
    appendLine(GATE_LOG, reading(11))
    appendLine(GATE_LOG, reading(1))
    logWrite('apply 1023', true)
    expect(() => requireTwoGo('step 1027 apply', true)).not.toThrow()
    // but the baseline reads still need the pair
    expect(() => requireTwoGo('the read-only baseline')).toThrow('exit')
  })
})
