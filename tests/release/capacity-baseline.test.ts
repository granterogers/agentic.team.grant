import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPlainSelect, parsePreflight } from '../../scripts/release/plain-select.ts'

/**
 * The capacity baseline reads production under a READ-ONLY approval (A3). Every statement it can send is held to the same static rule as
 * the preflight (one select, nothing that writes, locks, sleeps or changes a setting), selects no secret or message text, and the two
 * copies of the file (the one the read-only tool can load, and the one the runbook names) cannot drift apart.
 */
const audit = readFileSync('docs/audit/ACTIVITY-CAPACITY-BASELINE-QUERIES-2026-10-12.sql', 'utf8')
const ops = readFileSync('scripts/ops/capacity-baseline.sql', 'utf8')
const inventory = readFileSync(
  'docs/audit/ACTIVITY-CAPACITY-BACKUPS-INVENTORY-2026-10-12.sql',
  'utf8',
)
const baseline = parsePreflight(audit)
const backups = parsePreflight(inventory)

describe('the capacity baseline statements', () => {
  it('parse into Q01 to Q23, each once', () => {
    const ids = baseline.map((s) => s.id)
    for (let n = 1; n <= 23; n += 1) expect(ids).toContain(`Q${String(n).padStart(2, '0')}`)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every one is a single plain select', () => {
    expect(baseline.filter((s) => !isPlainSelect(s.sql)).map((s) => s.id)).toEqual([])
    expect(backups.length).toBeGreaterThanOrEqual(2)
    expect(backups.filter((s) => !isPlainSelect(s.sql)).map((s) => s.id)).toEqual([])
  })

  it('none selects a secret, a token, a password, a message body or a transcript', () => {
    for (const s of [...baseline, ...backups])
      expect(s.sql).not.toMatch(
        /\b(secret|vault|token|password|api_key|body|transcript|content)\b/i,
      )
  })

  it('the file the runbook names is byte-identical to the one the read-only tool loads', () => {
    expect(ops).toBe(audit)
  })

  it('the only statement that can fail on production is the optional exact-bloat one', () => {
    expect(baseline.find((s) => s.id === 'Q06')?.sql).toMatch(/pgstattuple_approx/)
  })
})

describe('the rule still refuses (a control for this file)', () => {
  it('a write appended to a baseline statement is refused', () => {
    const q = baseline[0]?.sql ?? ''
    expect(isPlainSelect(q)).toBe(true)
    expect(isPlainSelect(`${q}; delete from public.jobs`)).toBe(false)
    expect(isPlainSelect(`${q} for update`)).toBe(false)
  })
})
