/**
 * The deletion-candidate rule: live deployment, newest 15 production, seven-day window. The controls build the lists a bug
 * would produce and require `assertSafe` to refuse them; a check that has only been shown good lists proves nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  assertSafe,
  CSV_HEADER,
  classify,
  DEFAULT_RULE,
  type DeploymentRow,
  type Rule,
  toCsv,
  totals,
} from '../../scripts/deploy/lib/vercel-retention.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 5, 15)
const MIB = 2 ** 20

const row = (n: number, over: Partial<DeploymentRow> = {}): DeploymentRow => ({
  id: `dpl_${String(n).padStart(4, '0')}`,
  url: `https://x-${n}.example`,
  created: NOW - n * 3_600_000,
  target: 'production',
  state: 'READY',
  bundles: 2,
  bytes: 43 * MIB,
  aliases: [],
  docRefs: [],
  experiment: null,
  ...over,
})

// ids 0..59, one an hour apart: 0 is newest. Everything past 168 hours (7 days) would be outside the window, but with only
// 60 hourly rows the window covers all of them, so the age-based cases below space rows a day apart instead.
const daily = (n: number, over: Partial<DeploymentRow> = {}): DeploymentRow =>
  row(n, { created: NOW - n * DAY, ...over })

const rule = (liveId: string, extra: string[] = []): Rule => ({
  liveId,
  now: NOW,
  ...DEFAULT_RULE,
  extraKeep: new Set(extra),
})

describe('deletion candidates', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    daily(i, { aliases: i === 0 ? ['live.example'] : [] }),
  )
  const r = rule('dpl_0000')
  const decisions = classify(rows, r)
  const by = (id: string) => decisions.find((d) => d.id === id)

  it('keeps the live deployment', () => {
    expect(by('dpl_0000')?.action).toBe('KEEP')
    expect(by('dpl_0000')?.keepReasons).toContain('live production deployment')
  })

  it('keeps the newest 15 production deployments whatever their age, and a seven-day window', () => {
    for (let i = 0; i < 15; i += 1)
      expect(by(`dpl_${String(i).padStart(4, '0')}`)?.action).toBe('KEEP')
    // day-spaced rows: ids 0..7 are inside seven days, 15 is the first outside the newest 15 AND outside the window
    expect(by('dpl_0014')?.action).toBe('KEEP')
    expect(by('dpl_0015')?.action).toBe('DELETE')
    expect(decisions.filter((d) => d.action === 'KEEP')).toHaveLength(15)
    expect(decisions.filter((d) => d.action === 'DELETE')).toHaveLength(25)
  })

  it('keeps a recent production deployment even when it is not among the newest 15', () => {
    const burst = Array.from({ length: 30 }, (_, i) =>
      row(i, { aliases: i === 0 ? ['live.example'] : [] }),
    )
    const out = classify(burst, rule('dpl_0000'))
    expect(out.every((d) => d.action === 'KEEP')).toBe(true)
    expect(out[29]?.keepReasons.join(' ')).toContain('rollback window')
  })

  it('deletes previews and failed builds unless they hold an alias', () => {
    const mixed = [
      daily(0, { aliases: ['live.example'] }),
      daily(1, { target: 'preview', experiment: 'e1' }),
      daily(2, { state: 'ERROR', bundles: 0, bytes: 0 }),
      daily(3, { target: 'preview', aliases: ['review.example'] }),
    ]
    const out = classify(mixed, rule('dpl_0000'))
    expect(out.map((d) => d.action)).toEqual(['KEEP', 'DELETE', 'DELETE', 'KEEP'])
    expect(out[1]?.deleteReasons.join(' ')).toContain('experiment e1')
  })

  it('honours a name kept on review', () => {
    const out = classify(rows, rule('dpl_0000', ['dpl_0030']))
    expect(out.find((d) => d.id === 'dpl_0030')?.action).toBe('KEEP')
  })

  it('totals add up and report the share of bytes', () => {
    const t = totals(decisions)
    expect(t.keep.deployments + t.delete.deployments).toBe(t.total.deployments)
    expect(t.keep.bytes + t.delete.bytes).toBe(t.total.bytes)
    expect(t.deleteShareOfBytes).toBeCloseTo(25 / 40, 5)
  })

  it('names deletion candidates that a document refers to', () => {
    const withRef = rows.map((d, i) => (i === 20 ? { ...d, docRefs: ['docs/x.md'] } : d))
    expect(totals(classify(withRef, r)).deleteWithDocRefs).toEqual(['dpl_0020'])
  })

  it('accepts a list built by the rule', () => {
    expect(() => assertSafe(decisions, r)).not.toThrow()
  })

  it('writes one CSV row per deployment, with the documented columns', () => {
    const lines = toCsv(decisions).trim().split('\n')
    expect(lines).toHaveLength(41)
    expect(lines[0]).toBe(CSV_HEADER.join(','))
    expect(lines[1]).toContain('dpl_0000')
  })
})

describe('assertSafe can fail (controls)', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    daily(i, { aliases: i === 0 ? ['live.example'] : [] }),
  )
  const r = rule('dpl_0000')
  const good = classify(rows, r)
  const flip = (id: string, to: 'KEEP' | 'DELETE') =>
    good.map((d) => (d.id === id ? { ...d, action: to } : d))

  it('refuses a list that deletes the live deployment', () => {
    expect(() => assertSafe(flip('dpl_0000', 'DELETE'), r)).toThrow(
      /live deployment is marked DELETE/,
    )
  })

  it('refuses a list that deletes an aliased deployment', () => {
    const aliased = good.map((d) =>
      d.id === 'dpl_0030' ? { ...d, aliases: ['a.example'], action: 'DELETE' as const } : d,
    )
    expect(() => assertSafe(aliased, r)).toThrow(/holds a live alias/)
  })

  it('refuses a list that deletes one of the newest 15', () => {
    expect(() => assertSafe(flip('dpl_0010', 'DELETE'), r)).toThrow(/newest 15/)
  })

  it('refuses a list that deletes a deployment inside the window', () => {
    const burst = classify(
      Array.from({ length: 30 }, (_, i) => row(i, { aliases: i === 0 ? ['l'] : [] })),
      r,
    )
    const bad = burst.map((d) => (d.id === 'dpl_0025' ? { ...d, action: 'DELETE' as const } : d))
    expect(() => assertSafe(bad, r)).toThrow(/window/)
  })

  it('refuses a list that deletes a name kept on review', () => {
    const named = rule('dpl_0000', ['dpl_0030'])
    const bad = classify(rows, rule('dpl_0000')) // computed WITHOUT the override, so 30 is DELETE
    expect(() => assertSafe(bad, named)).toThrow(/named to keep/)
  })

  it('refuses an inventory that does not contain the live deployment', () => {
    expect(() => assertSafe(good.slice(1), r)).toThrow(/not in the inventory/)
  })

  it('refuses a duplicated id', () => {
    expect(() => assertSafe([...good, good[1] as (typeof good)[number]], r)).toThrow(/twice/)
  })
})
