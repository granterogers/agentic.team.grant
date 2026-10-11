// biome-ignore-all format: dense state tables and mutation pairs kept readable as written
/**
 * The Team HQ Activity page consumes the unified ledger without a visual change (docs/activity-ledger/ARCHITECTURE.md).
 *
 * `needLately` keeps the existing list and replaces its rows ONLY when the ledger answers enabled with at least one drawable row.
 * Off, absent, empty, malformed, slow or failing, the list the page already had stands, so switching the ledger on can never empty
 * the page and a ledger that hangs can never delay it. Two kinds of assertion:
 *   - BEHAVIOUR: the real `ledgerRows` and `needLately` source is extracted from web/studio/app.js and run against stubs, through the
 *     states the ledger can be in (off, empty, invalid, duplicated, unavailable, never answering, answering after a refresh);
 *   - WIRING: the expressions that make it so are present, and each detector is shown a synthetic defect it must catch (a name
 *     appearing in a file is not evidence that anything calls it).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('web/studio/app.js', 'utf8')

const between = (src: string, from: string, to: string): string => {
  const a = src.indexOf(from)
  if (a < 0) return ''
  const b = src.indexOf(to, a + from.length)
  return src.slice(a, b < 0 ? a + 3000 : b)
}
const ledgerRowsSource = between(source, 'function ledgerRows(ledger)', '\nasync function needLately()')
const needLatelySource = between(source, 'async function needLately()', '\nasync function refresh()')

type Row = Record<string, unknown>
interface Rig {
  latest: { lately: { office: Row[]; [k: string]: unknown } | null }
  renders: Array<Row[] | null>
  needLately: () => Promise<void>
}
const rig = (read: (name: string) => Promise<unknown>, settles = (p: Promise<unknown>) => p): Rig => {
  const latest: Rig['latest'] = { lately: null }
  const renders: Rig['renders'] = []
  const render = () => {
    renders.push(latest.lately === null ? null : latest.lately.office)
  }
  const factory = new Function(
    'latest',
    'settles',
    'read',
    'render',
    `${ledgerRowsSource}\n${needLatelySource}\nreturn needLately`,
  )
  return { latest, renders, needLately: factory(latest, settles, read, render) as () => Promise<void> }
}
const mk = (id: string, at = '2026-10-11T08:00:00Z'): Row => ({ id, at, who: 'research-director', verb: 'Finished', what: 'x' })
const existing = { office: [mk('old-1')], building: { a: 1 }, today: { done: 2 } }
const answers =
  (lately: unknown, ledger: unknown | Error) =>
  async (name: string): Promise<unknown> => {
    if (name === 'lately') return lately
    if (ledger instanceof Error) throw ledger
    return ledger
  }

describe('the extracted source (a control: the behaviour below would pass on nothing otherwise)', () => {
  it('found both functions', () => {
    expect(ledgerRowsSource.length).toBeGreaterThan(200)
    expect(needLatelySource.length).toBeGreaterThan(300)
    expect(needLatelySource).toContain("read('lately')")
  })
})

describe('needLately, by behaviour', () => {
  it('flag off: the existing list stands and the counters are untouched', async () => {
    const r = rig(answers(existing, { enabled: false, office: [] }))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(existing.office)
    expect(r.latest.lately?.building).toEqual({ a: 1 })
  })

  it('flag on: the ledger rows replace the list, the rest of the page is kept', async () => {
    const rows = [mk('a'), mk('b', '2026-10-11T07:00:00Z')]
    const r = rig(answers(existing, { enabled: true, office: rows }))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(rows)
    expect(r.latest.lately?.building).toEqual({ a: 1 })
    expect(r.latest.lately?.today).toEqual({ done: 2 })
  })

  it('empty history: the existing list stands (switching the ledger on can never empty the page)', async () => {
    const r = rig(answers(existing, { enabled: true, office: [] }))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(existing.office)
  })

  it('unavailable: a ledger that errors changes nothing', async () => {
    const r = rig(answers(existing, new Error('502 upstream failed')))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(existing.office)
  })

  it('invalid: a wrong-shaped answer, null, a string or rows with no usable id or instant change nothing', async () => {
    for (const bad of [null, 'nope', 42, { enabled: true }, { enabled: true, office: 'x' }, { enabled: true, office: [null, 7, {}, { id: 'x' }, { id: '', at: '2026-10-11T08:00:00Z' }, { id: 'y', at: 'not a date' }] }]) {
      const r = rig(answers(existing, bad))
      await r.needLately()
      expect(r.latest.lately?.office, JSON.stringify(bad)).toEqual(existing.office)
    }
  })

  it('partial history: only the drawable rows are kept, in the order given', async () => {
    const good = [mk('a'), mk('b')]
    const r = rig(answers(existing, { enabled: true, office: [null, good[0], { id: 'z', at: 'garbage' }, good[1]] }))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(good)
  })

  it('duplicate ids: the page keys by id, so a repeated id is drawn once', async () => {
    const r = rig(answers(existing, { enabled: true, office: [mk('a'), mk('a'), mk('b')] }))
    await r.needLately()
    expect((r.latest.lately?.office ?? []).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('multi-project rows pass through as they came (the page does not filter them)', async () => {
    const rows = [{ ...mk('a'), project: 'Alpha' }, { ...mk('b'), project: 'Beta' }, { ...mk('c'), project: null }]
    const r = rig(answers(existing, { enabled: true, office: rows }))
    await r.needLately()
    expect(r.latest.lately?.office).toEqual(rows)
  })

  it('the existing read failing: the page is drawn empty, as before, and a good ledger answer is still used', async () => {
    const read = async (name: string): Promise<unknown> => {
      if (name === 'lately') throw new Error('down')
      return { enabled: true, office: [mk('a')] }
    }
    const r = rig(read)
    await r.needLately()
    expect(r.renders[0]).toEqual([])
    expect(r.latest.lately?.office).toEqual([mk('a')])
  })

  it('a ledger that never answers does not delay the first draw', async () => {
    let release: (v: unknown) => void = () => undefined
    const never = new Promise<unknown>((res) => {
      release = res
    })
    const read = async (name: string): Promise<unknown> => (name === 'lately' ? existing : never)
    const r = rig(read)
    const done = r.needLately()
    await new Promise((res) => setTimeout(res, 20))
    expect(r.renders.length).toBe(1)
    expect(r.renders[0]).toEqual(existing.office)
    release({ enabled: true, office: [mk('late')] })
    await done
    expect(r.latest.lately?.office).toEqual([mk('late')])
    expect(r.renders.length).toBe(2)
  })

  it('an answer that arrives after a refresh does not overwrite the newer copy', async () => {
    let release: (v: unknown) => void = () => undefined
    const slow = new Promise<unknown>((res) => {
      release = res
    })
    const read = async (name: string): Promise<unknown> => (name === 'lately' ? existing : slow)
    const r = rig(read)
    const done = r.needLately()
    await new Promise((res) => setTimeout(res, 10))
    // refresh() sets latest.lately = null and a new needLately fills it with a newer copy
    const newer = { office: [mk('newer')], building: {}, today: {} }
    r.latest.lately = newer
    release({ enabled: true, office: [mk('stale-ledger')] })
    await done
    expect(r.latest.lately).toBe(newer)
  })

  it('a ledger that answers is not asked again once the page holds the list', async () => {
    let asks = 0
    const read = async (name: string): Promise<unknown> => {
      if (name === 'activity_ledger') asks++
      return name === 'lately' ? existing : { enabled: true, office: [mk('a')] }
    }
    const r = rig(read)
    await r.needLately()
    await r.needLately()
    expect(asks).toBe(1)
  })
})

describe('needLately, by wiring (each detector can fail)', () => {
  const properties = {
    readsTheLedgerSection: (t: string) => /settles\(read\('activity_ledger'\)\)\.catch\(\(\) => null\)/.test(t),
    startsBeforeTheExistingReadFinishes: (t: string) =>
      t.indexOf("read('activity_ledger')") > -1 && t.indexOf("read('activity_ledger')") < t.indexOf("await settles(read('lately'))"),
    replacesOnlyTheListAndOnlyForTheCopyItHolds: (t: string) =>
      /if \(rows !== null && latest\.lately === mine\) \{\s*latest\.lately = \{ \.\.\.mine, office: rows \}/.test(t),
    validatesThroughLedgerRows: (t: string) => /const rows = ledgerRows\(await ledgerAsked\)/.test(t),
    drawsBeforeTheLedgerAnswers: (t: string) => t.indexOf('render()') > -1 && t.indexOf('render()') < t.indexOf('await ledgerAsked'),
  }
  const mutants: Record<keyof typeof properties, [string, string]> = {
    readsTheLedgerSection: ["read('activity_ledger')", "read('lately')"],
    startsBeforeTheExistingReadFinishes: ["const ledgerAsked = settles(read('activity_ledger')).catch(() => null)\n  try {\n    latest.lately = await settles(read('lately'))", "try {\n    latest.lately = await settles(read('lately'))\n  } catch {}\n  const ledgerAsked = settles(read('activity_ledger')).catch(() => null)\n  try {"],
    replacesOnlyTheListAndOnlyForTheCopyItHolds: ['rows !== null && latest.lately === mine', 'rows !== null'],
    validatesThroughLedgerRows: ['ledgerRows(await ledgerAsked)', '(await ledgerAsked)?.office'],
    drawsBeforeTheLedgerAnswers: ['  const mine = latest.lately\n  render()', '  const mine = latest.lately'],
  }
  for (const [name, holds] of Object.entries(properties)) {
    it(`holds: ${name}`, () => {
      expect(holds(needLatelySource), name).toBe(true)
    })
    it(`${name} goes red when the code is changed to defeat it`, () => {
      const [from, to] = mutants[name as keyof typeof properties]
      const mutated = needLatelySource.replace(from, to)
      expect(mutated, 'the mutation landed').not.toBe(needLatelySource)
      expect(holds(mutated), name).toBe(false)
    })
  }
})
