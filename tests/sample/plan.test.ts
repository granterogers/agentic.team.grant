import { describe, expect, it } from 'vitest'
import { diffFingerprints } from '../../scripts/sample/diff.ts'
import {
  baselineTitles,
  bucketOf,
  driftOf,
  isoDay,
  looksReal,
  PERSONAL_TASKS,
  PROJECTS,
  planProblems,
  planSummary,
  wantedOf,
} from '../../scripts/sample/plan.ts'

const NAMES = ['Wellness Studio Launch', '2027 Financial Plan', 'Japan Spring Trip']
// two different "todays", a leap day and a month end among them, so nothing here can depend on the date of the run
const DAYS = [
  new Date('2026-10-03T12:00:00Z'),
  new Date('2028-02-28T23:59:00Z'),
  new Date('2027-12-31T00:00:00Z'),
]

describe('the Sample baseline plan', () => {
  it('has exactly the three canonical projects, by exact name', () => {
    expect(PROJECTS.map((p) => p.name)).toEqual(NAMES)
  })

  it('is internally consistent (unique titles, parents first, blocked tasks say why, fictional addresses)', () => {
    expect(planProblems()).toEqual([])
  })

  it('keeps every task title distinct across the office, because the seed and reset match on it', () => {
    const all = [...PROJECTS.flatMap((p) => p.tasks), ...PERSONAL_TASKS].map((t) => t.title)
    expect(new Set(all).size).toBe(all.length)
    expect(baselineTitles().size).toBe(all.length)
  })

  it('never holds a real-looking secret or a non-fictional address', () => {
    const text = JSON.stringify(PROJECTS)
    expect(looksReal(text)).toBe(false)
    // and the detector can fail: a real-looking address is caught
    expect(looksReal('write to someone@gmail.com')).toBe(true)
    expect(looksReal('write to someone@brightside.invalid')).toBe(false)
  })

  for (const today of DAYS) {
    describe(`relative to ${today.toISOString().slice(0, 10)}`, () => {
      for (const p of PROJECTS) {
        it(`${p.name} covers every task bucket the UI shows`, () => {
          const s = planSummary(p, today)
          // by property, never by count: the project must exercise each state, not hold a particular number
          for (const b of ['overdue', 'today', 'tomorrow', 'later', 'undated', 'closed'] as const)
            expect(s.buckets[b], `${p.name} has nothing ${b}`).toBeGreaterThan(0)
          expect(s.subtasks).toBeGreaterThan(0)
          expect(p.tasks.some((t) => t.state === 'doing')).toBe(true)
          expect(p.tasks.some((t) => t.state === 'blocked')).toBe(true)
          expect(p.tasks.some((t) => (t.priority ?? 100) < 100)).toBe(true)
          expect(p.tasks.some((t) => t.title.length > 100)).toBe(true)
          expect(p.tasks.some((t) => t.title.length < 15)).toBe(true)
          expect(p.tasks.some((t) => t.agent !== undefined)).toBe(true)
          expect(p.tasks.some((t) => t.owner === 'person')).toBe(true)
          expect(p.tasks.some((t) => (t.labels ?? []).length > 0)).toBe(true)
        })
      }
    })
  }

  it('resolves overdue, today and tomorrow to the right calendar days whatever day it is run', () => {
    for (const today of DAYS) {
      expect(bucketOf(isoDay(today, -1), 'todo', today)).toBe('overdue')
      expect(bucketOf(isoDay(today, 0), 'todo', today)).toBe('today')
      expect(bucketOf(isoDay(today, 1), 'todo', today)).toBe('tomorrow')
      expect(bucketOf(isoDay(today, 5), 'todo', today)).toBe('this_week')
      expect(bucketOf(isoDay(today, 30), 'todo', today)).toBe('later')
      expect(bucketOf(null, 'todo', today)).toBe('undated')
      // a finished task is closed however old its date
      expect(bucketOf(isoDay(today, -9), 'done', today)).toBe('closed')
    }
    expect(isoDay(new Date('2028-02-28T10:00:00Z'), 1)).toBe('2028-02-29')
    expect(isoDay(new Date('2026-12-31T10:00:00Z'), 1)).toBe('2027-01-01')
  })

  it('Japan Spring Trip is the calendar-heavy one: many dated items, spans, and several on one day', () => {
    const japan = PROJECTS.find((p) => p.name === 'Japan Spring Trip')
    const others = PROJECTS.filter((p) => p.name !== 'Japan Spring Trip')
    expect(japan).toBeDefined()
    const dated = (japan?.tasks ?? []).filter((t) => t.due !== undefined)
    for (const o of others)
      expect(dated.length).toBeGreaterThan(o.tasks.filter((t) => t.due !== undefined).length)
    expect(
      (japan?.tasks ?? []).filter((t) => t.start !== undefined && t.start !== t.due).length,
    ).toBeGreaterThan(0)
    const perDay = new Map<number, number>()
    for (const t of dated) perDay.set(t.due as number, (perDay.get(t.due as number) ?? 0) + 1)
    expect(Math.max(...perDay.values())).toBeGreaterThanOrEqual(3)
  })

  it('the finance plan has the longest document names and the fewest contacts; the wellness plan has the most contacts', () => {
    const by = (n: string) => PROJECTS.find((p) => p.name === n)
    const longest = (n: string) => Math.max(...(by(n)?.docs ?? []).map((d) => d.name.length))
    expect(longest('2027 Financial Plan')).toBeGreaterThan(110)
    expect((by('2027 Financial Plan')?.contacts ?? []).length).toBeLessThanOrEqual(3)
    expect((by('Wellness Studio Launch')?.contacts ?? []).length).toBeGreaterThanOrEqual(
      (by('Japan Spring Trip')?.contacts ?? []).length,
    )
  })

  it('writes the same bytes every time (a second seed is not a second set of documents)', () => {
    const a = JSON.stringify(PROJECTS.map((p) => p.docs.map((d) => d.text)))
    const b = JSON.stringify(PROJECTS.map((p) => p.docs.map((d) => d.text)))
    expect(a).toBe(b)
    for (const p of PROJECTS) {
      const texts = p.docs.map((d) => d.text)
      expect(new Set(texts).size).toBe(texts.length)
    }
  })
})

describe('drift: converging is symmetric, and a converged task reports nothing', () => {
  const today = DAYS[0] as Date
  const t = PROJECTS[0]?.tasks.find((x) => x.state === 'blocked')
  if (t === undefined) throw new Error('the plan has no blocked task')
  const want = wantedOf(t, today)
  const have = {
    title: want.title,
    state: want.state,
    due: want.due,
    start: want.start,
    priority: want.priority,
    labels: [...want.labels].reverse(),
    blockedOn: want.blockedOn,
    agent: want.agent,
    parent: want.parent,
  }

  it('is silent for a task that matches, whatever order its labels are stored in', () => {
    expect(driftOf(have, want)).toEqual([])
  })

  it('names each field that differs, including a date that has gone stale and a state a tester changed', () => {
    expect(driftOf({ ...have, due: '2000-01-01' }, want)).toEqual(['due'])
    expect(driftOf({ ...have, state: 'done' }, want)).toEqual(['state'])
    expect(driftOf({ ...have, priority: 1 }, want)).toEqual(['priority'])
    expect(driftOf({ ...have, labels: [] }, want)).toEqual(['labels'])
    expect(driftOf({ ...have, parent: null }, want)).toEqual(['parent'])
    expect(driftOf({ ...have, blockedOn: 'something else' }, want)).toEqual(['blockedOn'])
  })

  it('treats the same task seeded on another day as drifted only in its dates', () => {
    const later = wantedOf(t, DAYS[1] as Date)
    expect(driftOf(have, later)).toEqual(['due'])
  })
})

describe('diffFingerprints: the guard that nothing outside the Sample office moved', () => {
  const a = { 'aaaaaaaa-1': { tasks: 'x', documents: 'y' }, 'bbbbbbbb-2': { tasks: 'p' } }

  it('is silent for identical fingerprints', () => {
    expect(diffFingerprints(a, structuredClone(a))).toEqual([])
  })

  it('names the office and the table that changed, and nothing else', () => {
    const b = structuredClone(a)
    b['aaaaaaaa-1'].tasks = 'changed'
    expect(diffFingerprints(a, b)).toEqual(['aaaaaaaa:tasks'])
  })

  it('sees an office that appeared or vanished', () => {
    const more = { ...a, 'cccccccc-3': { tasks: 'z' } }
    expect(diffFingerprints(a, more)).toEqual(['cccccccc:office appeared'])
    expect(diffFingerprints(more, a)).toEqual(['cccccccc:office vanished'])
  })
})
