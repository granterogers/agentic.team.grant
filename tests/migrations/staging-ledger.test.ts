/**
 * migrations/applied.json is PRODUCTION's ledger. A migrate run in a staging shell must write its own, or a staging run
 * would rewrite the record of what production has applied. The property is asserted on the wired expressions: the path is
 * chosen by the shell's TARGET_ENVIRONMENT and the write goes to the chosen path, not to a literal.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const src = readFileSync('scripts/migrate.ts', 'utf8')

describe('the migration ledger a run writes', () => {
  it('is .staging/applied.json in a staging shell and migrations/applied.json otherwise', () => {
    expect(src).toMatch(
      /const STAGING = \(process\.env\.TARGET_ENVIRONMENT \?\? ''\)\.trim\(\) === 'staging'/,
    )
    expect(src).toMatch(
      /const APPLIED_LEDGER = STAGING\s*\?\s*join\('\.staging',\s*'applied\.json'\)\s*:\s*join\(MIGRATIONS_DIR,\s*'applied\.json'\)/,
    )
  })
  it('writes only through that path (no other write of applied.json)', () => {
    expect([...src.matchAll(/writeFile\(([^,]+),/g)].map((m) => m[1])).toEqual(['APPLIED_LEDGER'])
    expect(src).not.toMatch(/writeFile\([^)]*['"]migrations\/applied\.json/)
  })
  it('replay writes .staging only', () => {
    const replay = readFileSync('scripts/staging/replay.ts', 'utf8')
    expect(replay).toMatch(/writeFile\(\s*'\.staging\/applied\.json'/)
    expect(replay).not.toMatch(/MIGRATIONS_DIR|migrations\/applied\.json'\s*,\s*`/)
  })
})
