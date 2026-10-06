import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  classifyCommandId,
  commandIdUnreadableSql,
  commandIdUuidSql,
} from '../../scripts/lib/command-id.ts'

const GOOD = '0b9a3c1e-5f6d-4a7b-8c9d-0e1f2a3b4c5d'

describe('command_id reading (check:leaks parser / data-quality split)', () => {
  it('a valid uuid is read, in either case', () => {
    expect(classifyCommandId(GOOD)).toBe('uuid')
    expect(classifyCommandId(GOOD.toUpperCase())).toBe('uuid')
  })
  it('NULL and a missing key are absent, not malformed', () => {
    expect(classifyCommandId(null)).toBe('absent')
    expect(classifyCommandId(undefined)).toBe('absent')
  })
  it('the empty string is its own kind (the Sample duty hand-off jobs of 5 October)', () => {
    expect(classifyCommandId('')).toBe('empty')
  })
  it('malformed text and non-text are malformed, never a uuid', () => {
    for (const v of ['not-a-uuid', GOOD.slice(1), `${GOOD}x`, ` ${GOOD}`, 12, {}, []])
      expect(classifyCommandId(v)).toBe('malformed')
  })
  it('the SQL states the same shape the TypeScript does, and guards the cast with it', () => {
    const sql = commandIdUuidSql(`(j.pinned_config ->> 'command_id')`)
    expect(sql).toMatch(/^\(case when .+ ~\* '\^\[0-9a-f\]\{8\}-.+\$' then .+::uuid end\)$/)
    // the cast is only ever reached through the case arm
    expect(sql.indexOf('::uuid')).toBeGreaterThan(sql.indexOf('then'))
    const unreadable = commandIdUnreadableSql('j.pinned_config')
    expect(unreadable).toContain("j.pinned_config ? 'command_id'")
    expect(unreadable).toContain('!~*')
  })
  it('check:leaks has no bare cast of command_id left, and keeps data quality out of the leak count', () => {
    const src = readFileSync('scripts/check-leaks.ts', 'utf8')
    expect(src).not.toMatch(/'command_id'\s*\)\s*::uuid/)
    expect(src).not.toMatch(/->> 'command_id'\)::uuid/)
    expect(src).toMatch(/commandIdUuidSql\(/)
    // the orphan count excludes unreadable ids by calling the predicate, and the report has its own heading
    expect(src).toMatch(/and not \$\{commandIdUnreadableSql\('j\.pinned_config'\)\}/)
    expect(src).toMatch(/data quality \(not a leak\)/)
  })
})
