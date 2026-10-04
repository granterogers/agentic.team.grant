/**
 * The production-heavy guard lives at the executor, so a suite started directly cannot skip `scripts/suite.ts`.
 * Pure classification is tested here; the behaviour (a direct run is refused before any SQL is sent, and the runner's
 * intent lets it through) is driven as a real subprocess, which is the only way to see argv[1] as the guard does.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isProductionHeavy } from '../../src/db/suite-guard.ts'

const manifest = {
  sample: ['verify:sample-settings'],
  smoke: ['verify:pulse'],
  local: [],
  scripts: { 'scripts/verify/known-local.ts': 'local' },
}
const npm = {
  'verify:sample-settings': 'tsx scripts/verify/sample-thing.ts',
  'verify:pulse': 'tsx scripts/verify/pulse.ts',
}

describe('isProductionHeavy', () => {
  it('refuses an unclassified suite by default', () => {
    expect(isProductionHeavy('/r/scripts/verify/anything.ts', npm, manifest)).toBe(true)
  })
  it('lets a sample or smoke suite through, and an explicitly local one', () => {
    expect(isProductionHeavy('/r/scripts/verify/sample-thing.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/verify/pulse.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/verify/known-local.ts', npm, manifest)).toBe(false)
  })
  it('never refuses what is not a suite (an operator command, a deploy)', () => {
    expect(isProductionHeavy('/r/scripts/deploy/hq.ts', npm, manifest)).toBe(false)
    expect(isProductionHeavy('/r/scripts/sample/sample.ts', npm, manifest)).toBe(false)
  })
})

describe('the executor refuses a heavy suite started directly', () => {
  const heavy = Object.entries(
    (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> })
      .scripts,
  ).find(([n, c]) => n === 'verify:worker' && /scripts\/verify\/\S+\.ts/.test(c))
  // verify:worker, not verify:hq: hq was converted to the test office and reclassified smoke (#414), so it is no longer a
  // heavy suite to drive. The worker suite dequeues work and is genuinely heavy.
  const file = /(scripts\/verify\/\S+\.ts)/.exec(heavy?.[1] ?? '')?.[1] ?? ''

  it('has a real heavy suite to drive', () => {
    expect(file).not.toBe('')
  })

  it('and does so before any statement is sent', () => {
    // A bogus token: if the guard failed, the request would fail with an authorisation error instead of REFUSED.
    const out = spawnSync('npx', ['tsx', file], {
      env: {
        ...process.env,
        HQ_PRODUCTION_INTENT: '',
        SUPABASE_ACCESS_TOKEN: 'sbp_not_a_real_token',
      },
      encoding: 'utf8',
      timeout: 90000,
    })
    expect(`${out.stdout}${out.stderr}`).toContain('REFUSED: this is a production-heavy suite')
  }, 120000)
})
