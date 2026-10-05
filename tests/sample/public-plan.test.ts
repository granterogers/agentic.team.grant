/**
 * The public Sample Office's content, as properties. It is one fictional story told consistently, so these are the things a
 * visitor (or a search, or a specialist) would trip over if they were wrong: a figure that disagrees with its own total, a
 * task whose parent does not exist, a real-looking address, a trace of Grant.
 */
import { describe, expect, it } from 'vitest'
import { bucketOf } from '../../scripts/sample/plan.ts'
import {
  allTasks,
  LESSONS,
  OFFICE_NAME,
  PERSONAL_TASKS,
  PROJECTS,
  SAMPLE_EMAIL,
} from '../../scripts/sample/public-plan.ts'

const AGENTS = new Set([
  'chief-of-staff',
  'communications-director',
  'finance-director',
  'growth-director',
  'operations-director',
  'quality-director',
  'research-director',
  'strategy-director',
])
const everyString = (): string[] => {
  const out: string[] = [OFFICE_NAME, SAMPLE_EMAIL]
  for (const p of PROJECTS) {
    out.push(p.name, p.ref)
    for (const t of p.tasks)
      out.push(t.title, t.detail ?? '', t.blockedOn ?? '', ...(t.labels ?? []))
    for (const c of p.contacts) out.push(c.name, c.role, c.org, c.email, c.phone, c.note ?? '')
    for (const d of p.docs) out.push(d.name, d.text)
  }
  for (const t of PERSONAL_TASKS) out.push(t.title, t.detail ?? '')
  for (const l of LESSONS) out.push(l.body)
  return out
}
const csv = (name: string): string[][] =>
  (PROJECTS.flatMap((p) => p.docs).find((d) => d.name === name)?.text ?? '')
    .trim()
    .split('\n')
    .map((l) => l.split(','))

describe('the public Sample Office is one coherent, fictional story', () => {
  it('is small enough to be curated: quality over quantity', () => {
    expect(PROJECTS).toHaveLength(3)
    expect(allTasks().length).toBeGreaterThanOrEqual(30)
    expect(allTasks().length).toBeLessThanOrEqual(60)
    const docs = PROJECTS.flatMap((p) => p.docs)
    expect(docs.length).toBeGreaterThanOrEqual(8)
    expect(docs.length).toBeLessThanOrEqual(20)
    expect(PROJECTS.flatMap((p) => p.contacts).length).toBeGreaterThanOrEqual(6)
  })

  it('has unique task titles across the whole office, and every parent exists earlier in its project', () => {
    const titles = allTasks().map((t) => t.title)
    expect(new Set(titles).size).toBe(titles.length)
    for (const p of PROJECTS) {
      const seen = new Set<string>()
      for (const t of p.tasks) {
        if (t.parent !== undefined)
          expect(seen.has(t.parent), `${t.title} -> ${t.parent}`).toBe(true)
        seen.add(t.title)
      }
    }
  })

  it('gives work to real specialists or to Jordan, never both, and blocks work for a stated reason', () => {
    for (const t of allTasks()) {
      if (t.agent !== undefined) {
        expect(AGENTS.has(t.agent), t.title).toBe(true)
        expect(t.owner, t.title).not.toBe('person')
      }
      if (t.state === 'blocked') expect((t.blockedOn ?? '').length, t.title).toBeGreaterThan(10)
    }
  })

  it('always shows overdue, due today, due tomorrow and finished work, because dates are offsets from the day it is seeded', () => {
    const today = new Date()
    const buckets = new Set(
      allTasks().map((t) =>
        bucketOf(
          t.due === undefined ? null : new Date(today.getTime() + t.due * 86_400_000).toISOString(),
          t.state ?? 'todo',
          today,
        ),
      ),
    )
    for (const b of ['overdue', 'today', 'tomorrow', 'later', 'closed'])
      expect(buckets.has(b as never), b).toBe(true)
  })

  it('is fictional all the way down: only reserved addresses, no trace of Grant, no real brand', () => {
    for (const text of everyString()) {
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g))
        expect(m[1]?.endsWith('.invalid'), m[0]).toBe(true)
      expect(text).not.toMatch(/\bgrant\b/i)
      expect(text).not.toMatch(/innergy|rogers|legacy coaching|wellness studio|japan/i)
    }
    for (const c of PROJECTS.flatMap((p) => p.contacts))
      expect(c.phone).toMatch(/^\+44 7700 900\d{3}$/)
  })

  it('has a launch budget whose rows add up to its own total, and a contingency that is ten percent', () => {
    const rows = csv('Launch budget.csv').slice(1)
    const total = rows.find((r) => r[0] === 'Total') as string[]
    const items = rows.filter((r) => r[0] !== 'Total')
    for (const col of [1, 2, 3]) {
      expect(
        items.reduce((s, r) => s + Number(r[col]), 0),
        `column ${String(col)}`,
      ).toBe(Number(total[col]))
    }
    const contingency = Number((items.find((r) => /Contingency/.test(String(r[0]))) as string[])[1])
    const rest = items
      .filter((r) => !/Contingency/.test(String(r[0])))
      .reduce((s, r) => s + Number(r[1]), 0)
    expect(contingency).toBe(rest * 0.1)
    // the prose quotes the same total
    expect(PROJECTS[0]?.tasks.some((t) => (t.detail ?? '').includes('£88,000'))).toBe(true)
    expect(Number(total[1])).toBe(88_000)
  })

  it('has market costs that add up, and a deposit that is the same in the lease, the budget and the task', () => {
    const rows = csv('Market stall costs.csv').slice(1)
    const total = Number((rows.find((r) => r[0] === 'Total') as string[])[1])
    expect(
      rows
        .filter((r) => r[0] !== 'Total' && !/Break-even/.test(String(r[0])))
        .reduce((s, r) => s + Number(r[1]), 0),
    ).toBe(total)
    const lease = PROJECTS[0]?.docs.find((d) => /lease summary/.test(d.name))?.text ?? ''
    expect(lease).toContain('£4,800')
    expect(PROJECTS[0]?.tasks.some((t) => t.title.includes('£4,800'))).toBe(true)
    expect(csv('Launch budget.csv')[1]?.[1]).toBe('4800')
  })

  it('shares people, suppliers and places across projects so a question can be answered across the story', () => {
    const per = PROJECTS.map((p) => JSON.stringify(p))
    expect(per.filter((s) => s.includes('Harvest Lane')).length).toBeGreaterThanOrEqual(2)
    expect(per.filter((s) => s.includes('Berg')).length).toBeGreaterThanOrEqual(2)
    expect(per.filter((s) => s.includes('Riverside')).length).toBe(3)
  })

  it('has readable documents: every project has a pinned one, names are unique, text is neither empty nor a wall', () => {
    const docs = PROJECTS.flatMap((p) => p.docs)
    expect(new Set(docs.map((d) => d.name)).size).toBe(docs.length)
    for (const p of PROJECTS)
      expect(
        p.docs.some((d) => d.pinned === true),
        p.name,
      ).toBe(true)
    for (const d of docs) {
      expect(d.text.length, d.name).toBeGreaterThan(150)
      expect(d.text.length, d.name).toBeLessThan(2600)
      expect(d.approve, d.name).toBe(true)
    }
  })

  it('tells the team where it is, as standing guidance: what this is, and that nothing can be changed', () => {
    // A lesson is at most 280 characters (lessons_body_check): the first live seed found that out the hard way.
    for (const l of LESSONS) {
      expect(l.body.length, l.body.slice(0, 30)).toBeLessThanOrEqual(280)
      expect(l.body.length, l.body.slice(0, 30)).toBeGreaterThanOrEqual(8)
    }
    const all = LESSONS.map((l) => l.body).join(' ')
    expect(all).toMatch(/Sample Office/)
    expect(all).toMatch(/fictional/)
    expect(all).toMatch(/Nothing can be changed/)
    expect(all).toMatch(/never say you (have )?(created|saved|sent)/i)
  })
})
