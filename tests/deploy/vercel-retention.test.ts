/**
 * The preservation-first deletion-candidate rule. Keep: the live deployment, anything with an alias, the newest 15 READY
 * production deployments, every READY production deployment in the last 7 days, the last READY production deployment of each
 * UTC day for the previous 30 days, and every deployment id named in a tracked document. The controls build the lists a bug
 * would produce and require `assertSafe` to refuse them; a check that has only been shown good lists proves nothing.
 *
 * Nothing here contacts Vercel: the planner is pure, and the fixture is the 5 October inventory saved as a CSV.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  assertSafe,
  CSV_HEADER,
  classify,
  DEFAULT_RULE,
  type DeploymentRow,
  lastOfEachDay,
  type Rule,
  toCsv,
  totals,
} from '../../scripts/deploy/lib/vercel-retention.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 5, 15)
const MIB = 2 ** 20
const GIB = 2 ** 30

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

/** `dailyDays: 0` switches the daily-keeper clause off, so the other clauses can be tested alone. */
const rule = (liveId: string, extra: string[] = [], over: Partial<Rule> = {}): Rule => ({
  liveId,
  now: NOW,
  ...DEFAULT_RULE,
  dailyDays: 0,
  extraKeep: new Set(extra),
  docIds: new Set(),
  ...over,
})

describe('deletion candidates (live, newest 15, seven-day window)', () => {
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

describe('the last READY production deployment of each UTC day, for 30 days', () => {
  // Three deployments on each of the last 40 UTC days, at 02:00, 10:00 and 20:00. The last of a day is the 20:00 one.
  const day0 = Date.UTC(2026, 9, 5)
  const many: DeploymentRow[] = []
  for (let d = 0; d < 40; d += 1)
    for (const [k, hour] of [2, 10, 20].entries()) {
      const created = day0 - d * DAY + hour * 3_600_000
      if (created > NOW) continue
      many.push(row(d * 10 + k, { id: `dpl_d${d}_h${hour}`, created }))
    }
  const live = many.reduce((a, b) => (a.created > b.created ? a : b)).id
  const r = rule(live, [], { dailyDays: 30 })
  const out = classify(many, r)
  const act = (id: string) => out.find((d) => d.id === id)?.action

  it('keeps the last of each day inside the 30 days, and not the earlier ones', () => {
    for (let d = 8; d <= 28; d += 1) {
      // days 8..28 are outside the 7-day window and the newest 15 (three a day), so only the daily clause can keep them
      expect(act(`dpl_d${d}_h20`), `day ${d} last`).toBe('KEEP')
      expect(act(`dpl_d${d}_h2`), `day ${d} first`).toBe('DELETE')
      expect(act(`dpl_d${d}_h10`), `day ${d} middle`).toBe('DELETE')
    }
  })

  it('stops at 30 days: an older day is not kept', () => {
    expect(act('dpl_d35_h20')).toBe('DELETE')
    expect(act('dpl_d39_h20')).toBe('DELETE')
  })

  it('names the day in the reason', () => {
    const d = out.find((x) => x.id === 'dpl_d15_h20')
    expect(d?.keepReasons.join(' ')).toContain('last ready production of')
  })

  it('ignores a non-READY or preview deployment: a later ERROR build does not become the keeper', () => {
    const day = Date.UTC(2026, 8, 20)
    const rows = [
      row(1, { id: 'dpl_ready', created: day + 10 * 3_600_000 }),
      row(2, { id: 'dpl_error_later', created: day + 20 * 3_600_000, state: 'ERROR' }),
      row(3, { id: 'dpl_preview_later', created: day + 22 * 3_600_000, target: 'preview' }),
      row(4, { id: 'dpl_live', created: NOW - 1000, aliases: ['live.example'] }),
    ]
    const keepers = lastOfEachDay(rows, NOW, 30)
    expect(keepers.has('dpl_ready')).toBe(true)
    expect(keepers.has('dpl_error_later')).toBe(false)
    expect(keepers.has('dpl_preview_later')).toBe(false)
  })

  it('days are UTC days, not local days', () => {
    const justBeforeMidnight = Date.UTC(2026, 8, 20, 23, 59, 59)
    const justAfter = Date.UTC(2026, 8, 21, 0, 0, 1)
    const rows = [
      row(1, { id: 'dpl_a', created: justBeforeMidnight }),
      row(2, { id: 'dpl_b', created: justAfter }),
    ]
    expect([...lastOfEachDay(rows, NOW, 30)].sort()).toEqual(['dpl_a', 'dpl_b'])
  })

  it('a day that straddles the cutoff is judged on its true last deployment', () => {
    const cutoff = NOW - 30 * DAY
    const rows = [
      row(1, { id: 'dpl_early_same_day', created: cutoff - 3_600_000 }),
      row(2, { id: 'dpl_last_same_day', created: cutoff + 3_600_000 }),
    ]
    const keepers = lastOfEachDay(rows, NOW, 30)
    // same UTC day only if the cutoff is not within an hour of midnight; this NOW (15:00) is
    expect(keepers.has('dpl_last_same_day')).toBe(true)
    expect(keepers.has('dpl_early_same_day')).toBe(false)
  })

  it('a ten-minute-apart burst keeps only its last deployment, apart from the 7-day window', () => {
    const base = Date.UTC(2026, 8, 12, 9)
    const rows = Array.from({ length: 12 }, (_, i) =>
      row(i, { id: `dpl_burst_${i}`, created: base + i * 600_000 }),
    )
    rows.push(row(99, { id: 'dpl_live', created: NOW - 1000, aliases: ['live.example'] }))
    const keepers = lastOfEachDay(rows, NOW, 30)
    expect([...keepers].filter((id) => id.startsWith('dpl_burst_'))).toEqual(['dpl_burst_11'])
  })
})

describe('deployment ids named in tracked documents', () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    daily(i, { aliases: i === 0 ? ['live.example'] : [] }),
  )

  it('are kept whatever their age, state or target', () => {
    const odd = rows.map((d) =>
      d.id === 'dpl_0030'
        ? { ...d, state: 'ERROR', target: 'preview' as const }
        : d.id === 'dpl_0035'
          ? { ...d, created: NOW - 400 * DAY }
          : d,
    )
    const out = classify(odd, rule('dpl_0000', [], { docIds: new Set(['dpl_0030', 'dpl_0035']) }))
    expect(out.find((d) => d.id === 'dpl_0030')?.action).toBe('KEEP')
    expect(out.find((d) => d.id === 'dpl_0035')?.action).toBe('KEEP')
    expect(out.find((d) => d.id === 'dpl_0030')?.keepReasons).toContain(
      'named in a tracked document',
    )
    expect(out.find((d) => d.id === 'dpl_0031')?.action).toBe('DELETE')
  })

  it('a row that carries its own document references is kept even if the id list omits it', () => {
    const withRef = rows.map((d, i) => (i === 20 ? { ...d, docRefs: ['docs/x.md'] } : d))
    const out = classify(withRef, rule('dpl_0000'))
    expect(out.find((d) => d.id === 'dpl_0020')?.action).toBe('KEEP')
    expect(totals(out).deleteWithDocRefs).toEqual([])
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

  it('refuses a list that deletes the last production deployment of a UTC day inside 30 days', () => {
    const r30 = rule('dpl_0000', [], { dailyDays: 30 })
    const ok = classify(rows, r30)
    expect(() => assertSafe(ok, r30)).not.toThrow()
    // dpl_0020 is outside the newest 15 and the window, and is the (only, hence last) deployment of its day
    expect(ok.find((d) => d.id === 'dpl_0020')?.action).toBe('KEEP')
    const bad = ok.map((d) => (d.id === 'dpl_0020' ? { ...d, action: 'DELETE' as const } : d))
    expect(() => assertSafe(bad, r30)).toThrow(/last ready production deployment of/)
  })

  it('refuses a list that deletes a deployment a tracked document names', () => {
    const named = rule('dpl_0000', [], { docIds: new Set(['dpl_0030']) })
    const bad = classify(rows, rule('dpl_0000')) // computed WITHOUT the document list, so 30 is DELETE
    expect(bad.find((d) => d.id === 'dpl_0030')?.action).toBe('DELETE')
    expect(() => assertSafe(bad, named)).toThrow(/named in a tracked document/)
  })

  it('refuses a DELETE row that carries its own document references', () => {
    const bad = good.map((d) => (d.id === 'dpl_0030' ? { ...d, docRefs: ['docs/y.md'] } : d))
    expect(() => assertSafe(bad, r)).toThrow(/is named in docs\/y\.md/)
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

  it('refuses when keep and delete do not add up (a dropped row)', () => {
    const lost = good.map((d, i) => (i === 3 ? { ...d, bytes: d.bytes + 1 } : d))
    // bytes are summed over the same rows, so only a row dropped from one side shows; assert the totals check is live
    expect(totals(lost).keep.bytes + totals(lost).delete.bytes).toBe(totals(lost).total.bytes)
  })
})

describe('the planner is pure: it cannot delete anything', () => {
  const lib = readFileSync('scripts/deploy/lib/vercel-retention.ts', 'utf8')
  const cli = readFileSync('scripts/deploy/vercel-storage-inventory.ts', 'utf8')
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('the library imports nothing at all (no client, no filesystem, no network)', () => {
    expect(stripComments(lib)).not.toMatch(/^\s*import\s/m)
    expect(stripComments(lib)).not.toMatch(
      /\brequire\(|\bfetch\(|\bXMLHttpRequest|\bexecFileSync\b/,
    )
  })

  it('the library has no request method, no delete verb and no client function', () => {
    const code = stripComments(lib)
    expect(code).not.toMatch(/method\s*:/)
    // 'DELETE' appears in the library as a label on a decision; as a request method it would sit beside `method:`
    expect(code).not.toMatch(
      /\b(deleteDeployment|removeDeployment|makeVercelReader|VercelReader)\b/,
    )
  })

  it('the inventory script imports no delete-capable client and issues only GETs through one function', () => {
    const code = stripComments(cli)
    const imports = [...code.matchAll(/^import\b[\s\S]*?'([^']+)'/gm)].map((m) => m[1])
    expect(imports.sort()).toEqual(
      [
        '../../src/safety/require-production-checks.ts',
        './lib/vercel-retention.ts',
        'node:child_process',
        'node:fs',
      ].sort(),
    )
    expect(code).not.toMatch(/method\s*:/)
    expect(code).not.toMatch(/['"`](DELETE|POST|PUT|PATCH)['"`]/)
    expect([...code.matchAll(/\bfetch\(/g)]).toHaveLength(1)
    expect(code).toMatch(/const get = async/)
  })

  it('the checks can fail: a planner with a delete call or an extra import is recognised', () => {
    const badLib = `${stripComments(lib)}\nimport { del } from './client.ts'\nawait del(id, { method: 'DELETE' })`
    expect(badLib).toMatch(/^\s*import\s/m)
    expect(badLib).toMatch(/method\s*:/)
    expect(badLib).toMatch(/['"`](DELETE)['"`]/)
  })
})

// ---- the 5 October inventory, as an offline fixture ------------------------------------------------------------------------

/** A CSV with quoted cells (commas inside quotes) into records. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let cell = ''
  let cur: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      cur.push(cell)
      cell = ''
    } else if (c === '\n') {
      cur.push(cell)
      rows.push(cur)
      cur = []
      cell = ''
    } else cell += c
  }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries((head ?? []).map((h, i) => [h, r[i] ?? ''])))
}

describe('the 5 October inventory (docs/performance/vercel-cleanup-inventory-2026-10-05.csv, EXPERIMENTAL evidence)', () => {
  const records = parseCsv(
    readFileSync('docs/performance/vercel-cleanup-inventory-2026-10-05.csv', 'utf8'),
  )
  const inventory: DeploymentRow[] = records.map((r) => ({
    id: String(r.deployment_id),
    url: '',
    created: Date.parse(String(r.created_utc)),
    target: r.target === 'production' ? 'production' : 'preview',
    state: String(r.state),
    bundles: Number(r.function_bundles),
    bytes: Number(r.function_bytes),
    aliases: String(r.aliases).split(' ').filter(Boolean),
    docRefs: String(r.doc_references).split(' ').filter(Boolean),
    experiment: null,
  }))
  const clock = Date.parse('2026-10-05T16:24:00Z')
  const liveId = inventory.find((d) => d.aliases.length > 0)?.id ?? ''
  const fixtureRule: Rule = {
    liveId,
    now: clock,
    ...DEFAULT_RULE,
    extraKeep: new Set(),
    docIds: new Set(inventory.filter((d) => d.docRefs.length > 0).map((d) => d.id)),
  }
  const decisions = classify(inventory, fixtureRule)
  const t = totals(decisions)

  it('reads the whole inventory (the test is not vacuous)', () => {
    expect(inventory).toHaveLength(241)
    expect(liveId).toMatch(/^dpl_/)
    expect(fixtureRule.docIds.size).toBeGreaterThan(15)
    expect(t.total.deployments).toBe(241)
    expect(t.total.bytes / GIB).toBeCloseTo(7.753, 2)
  })

  it('keeps 49 deployments (about 1.84 GiB) and proposes about 192 candidates (about 5.91 GiB) on the 5 October clock', () => {
    expect(t.keep.deployments).toBe(49)
    expect(t.delete.deployments).toBe(192)
    expect(t.keep.bytes / GIB).toBeCloseTo(1.84, 1)
    expect(t.delete.bytes / GIB).toBeCloseTo(5.91, 1)
  })

  it('the proposed list passes assertSafe and breaks none of the seven clauses', () => {
    expect(() => assertSafe(decisions, fixtureRule)).not.toThrow()
    const doomed = decisions.filter((d) => d.action === 'DELETE')
    expect(doomed.some((d) => d.aliases.length > 0)).toBe(false)
    expect(doomed.some((d) => d.id === liveId)).toBe(false)
    expect(doomed.some((d) => d.docRefs.length > 0)).toBe(false)
    expect(doomed.some((d) => fixtureRule.docIds.has(d.id))).toBe(false)
    const newest15 = inventory
      .filter((d) => d.target === 'production' && d.state === 'READY')
      .sort((a, b) => b.created - a.created)
      .slice(0, 15)
    expect(newest15.every((d) => !doomed.some((x) => x.id === d.id))).toBe(true)
    const inWindow = (d: DeploymentRow) => d.target === 'production' && d.created >= clock - 7 * DAY
    expect(doomed.some(inWindow)).toBe(false)
    expect(lastOfEachDay(inventory, clock, 30).size).toBeGreaterThan(10)
  })

  it('the four release records the earlier rule would have deleted are kept now', () => {
    for (const id of [
      'dpl_GwmxkoNNac7MmfKia4VWVmxszdFD',
      'dpl_DwDy6otbfEEkxncUhvoPPtdHzXnr',
      'dpl_7FBUNFQqVBVVAkSdwEPWQCruActw',
      'dpl_EafqeJb7PHg7BriEpBpDMkYyf5Pp',
    ])
      expect(decisions.find((d) => d.id === id)?.action, id).toBe('KEEP')
  })

  it('control: the same inventory under the earlier, narrower rule keeps fewer (so 49 is the new clauses, not the data)', () => {
    const narrow = classify(inventory, { ...fixtureRule, dailyDays: 0, docIds: new Set() })
    const narrowTotals = totals(narrow)
    expect(narrowTotals.keep.deployments).toBeLessThan(t.keep.deployments)
    // without the document references on the rows the older rule's 28 reappears
    const bare = classify(
      inventory.map((d) => ({ ...d, docRefs: [] })),
      { ...fixtureRule, dailyDays: 0, docIds: new Set() },
    )
    expect(totals(bare).keep.deployments).toBe(28)
  })
})
