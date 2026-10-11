import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSwitchArgs } from '../../src/activity/switch-cli'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('the operator command line', () => {
  it('no arguments is a read-only status', () => {
    const p = parseSwitchArgs([])
    expect(p).toEqual({ ok: true, request: { kind: 'status' }, apply: false })
  })
  it('an operation without --apply is a plan, never a write', () => {
    for (const argv of [
      ['--canary', A],
      ['--add', A],
      ['--remove', A],
      ['--off'],
      ['--all-offices', '--confirm=ALL OFFICES'],
    ]) {
      const p = parseSwitchArgs(argv)
      expect(p.ok && p.apply).toBe(false)
    }
  })
  it('--apply is the only thing that makes a plan a write, and it needs an operation', () => {
    expect(parseSwitchArgs(['--canary', A, '--apply'])).toMatchObject({ ok: true, apply: true })
    expect(parseSwitchArgs(['--apply']).ok).toBe(false)
    expect(parseSwitchArgs(['--status', '--apply']).ok).toBe(false)
    expect(parseSwitchArgs(['--off', '--apply', '--dry-run']).ok).toBe(false)
  })
  it('refuses unknown options, stray arguments, repeats and two operations', () => {
    for (const argv of [
      ['--all'],
      ['--enable'],
      ['canary'],
      ['--canary', A, '--canary', B],
      ['--canary', A, '--off'],
      ['--off', '--add', A],
      ['--off=1'],
      ['--force'],
    ]) {
      expect(parseSwitchArgs(argv).ok, JSON.stringify(argv)).toBe(false)
    }
  })
  it('the old --all is gone: global activation is --all-offices with an explicit confirmation', () => {
    expect(parseSwitchArgs(['--all']).ok).toBe(false)
    const p = parseSwitchArgs(['--all-offices', '--confirm', 'ALL OFFICES'])
    expect(p).toMatchObject({ ok: true, request: { kind: 'all', confirm: 'ALL OFFICES' } })
    expect(parseSwitchArgs(['--all-offices'])).toMatchObject({
      ok: true,
      request: { kind: 'all', confirm: '' },
    })
    expect(parseSwitchArgs(['--canary', A, '--confirm', 'ALL OFFICES']).ok).toBe(false)
  })
  it('lists of offices are split, trimmed and handed on untouched for the planner to validate', () => {
    expect(parseSwitchArgs(['--canary', `${A}, ${B}`])).toMatchObject({
      request: { kind: 'canary', offices: [A, B] },
    })
    expect(parseSwitchArgs(['--canary=bad id'])).toMatchObject({
      request: { kind: 'canary', offices: ['bad id'] },
    })
    expect(parseSwitchArgs(['--canary']).ok).toBe(false)
    expect(parseSwitchArgs(['--canary', '--apply']).ok).toBe(false)
  })
})

describe('the script itself', () => {
  it('refuses to run at all without the production flags a person must set (even for a plan)', () => {
    const env = {
      ...process.env,
      ALLOW_PRODUCTION_CHECKS: '',
      ALLOW_PRODUCTION_WRITES: '',
      SUPABASE_DB_URL: '',
      SUPABASE_ACCESS_TOKEN: '',
    }
    const r = spawnSync(
      'npx',
      ['tsx', 'scripts/ops/activity-switch.ts', '--canary', A, '--apply'],
      { env, encoding: 'utf8', timeout: 60000 },
    )
    expect(r.status).not.toBe(0)
  })
  it('imports the production-writes gate before anything else and plans before it applies', () => {
    const src = readFileSync('scripts/ops/activity-switch.ts', 'utf8')
    const imports = [...src.matchAll(/^import .*$/gm)].map((m) => m[0])
    expect(imports[0]).toContain('require-production-writes')
    expect(src).toMatch(/const plan = planSwitch\(request, state\)/)
    expect(src).toMatch(
      /\} else if \(!plan\.noop\) \{\s*const result = await applyPlan\(db, plan\)/,
    )
  })
})
