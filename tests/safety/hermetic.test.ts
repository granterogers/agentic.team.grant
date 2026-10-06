/**
 * The unit suite cannot be handed a production credential, and importing a script cannot end the test process.
 *
 * Two properties, both asserted from inside a test:
 *  - whatever the launching shell exported, no production credential or production-access flag is visible to a test
 *    (`tests/setup/hermetic.ts` removes them, and the config loads it for every file);
 *  - importing the pure helpers that tests need from `scripts/` does not require a credential, so a test target cannot
 *    `process.exit` at import time (the defect that made `weather-is-not-a-failure` red without a token).
 */
import { describe, expect, it } from 'vitest'
import { PRODUCTION_ENV } from '../setup/hermetic.ts'

describe('the unit suite is hermetic', () => {
  it('sees no production credential or production-access flag', () => {
    expect(PRODUCTION_ENV.length).toBeGreaterThan(8)
    for (const name of PRODUCTION_ENV) expect(process.env[name], name).toBeUndefined()
  })

  it("the session runner's pure helper imports without a credential", async () => {
    const exit = process.exit
    let exited: number | undefined
    process.exit = ((code?: number) => {
      exited = code ?? 0
      throw new Error('process.exit called during import')
    }) as typeof process.exit
    try {
      const mod = await import('../../scripts/sessions/weather.ts')
      expect(mod.weather('provider x is unavailable')).toBe(true)
      expect(mod.weather('incoherent output metadata: body')).toBe(false)
    } finally {
      process.exit = exit
    }
    expect(exited).toBeUndefined()
  })

  it('CONTROL: the credential demand it replaced is real (the runner still refuses to start without one)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('scripts/sessions/run.ts', 'utf8')
    // The runner keeps its own demand; only the pure helper moved out of its import path.
    expect(src).toMatch(/process\.exit\(2\)/)
    expect(src).toMatch(/export \{ weather \} from '\.\/weather\.ts'/)
  })
})
