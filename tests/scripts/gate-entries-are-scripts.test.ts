import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The readiness gate lists npm scripts by name. One that does not exist makes the gate fail every run with
  "Missing script" (the Run 5 acceptance suite was listed before its script was added - found by the final review).
  The property: every entry of GATE and PREFLIGHT is a script in package.json.
*/
const src = readFileSync(new URL('../../scripts/e2e.ts', import.meta.url), 'utf8')
const scripts = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>
  }
).scripts
const start = src.indexOf('const GATE:')
const body = src.slice(start, src.indexOf('\n]\n', start))
const entries = [...body.matchAll(/^\s*\[\s*'([a-z0-9:_-]+)'/gm)].map((m) => m[1] as string)
describe('the gate names only scripts that exist', () => {
  it('found the entries', () => {
    expect(entries.length).toBeGreaterThan(50)
  })
  it('every entry is an npm script', () => {
    expect(entries.filter((e) => scripts[e] === undefined)).toEqual([])
  })
  it('includes the audit suites', () => {
    for (const s of ['verify:isolated', 'verify:final-audit-live', 'verify:run5-live'])
      expect(entries).toContain(s)
  })
})
