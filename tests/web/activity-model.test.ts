// biome-ignore-all format: dense tables kept readable as written
/**
 * The Activity screen's pure half (web/studio/bc/activity-model.js): what a person reads for one ledger event, and what a filter asks.
 * The rules are conservative on purpose (docs/activity-ledger/EVENT-CONTRACT.md): the sentence is the ledger's, an unknown actor is never
 * credited to Claire or a specialist, "confirmed" is a provider's word, an outside worker's report is marked as reported, and a
 * destination exists only for a project the page knows. Each guard has a control: a defect it must catch.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no type declarations
import { activeFilters, appendPage, dayKey, dayLabel, describe as describeEvent, destinationFor, groupByDay, howWeKnow, kindWords, queryFor, safeFacts, sinceFor, stageOf, VIEWS } from '../../web/studio/bc/activity-model.js'

const crew = [
  { slug: 'claire', staffSlug: 'chief-of-staff', name: 'Claire' },
  { slug: 'emma', staffSlug: 'research-director', name: 'Emma' },
]
const projects = [{ id: 'p-1', slug: 'riverside', name: 'Riverside' }]
const ev = (o: Record<string, unknown> = {}) => ({ id: 'e1', at: '2026-10-11T10:00:00Z', category: 'job', severity: 'info', status: 'completed', actor_kind: 'agent', actor: 'research-director', summary: 'Finished a request', provenance: 'projected', source: 'jobs', metadata: {}, ...o })
const d = (o: Record<string, unknown> = {}) => describeEvent(ev(o), { crew, projects })

describe('who did it', () => {
  it('names a person, Claire, a specialist, an outside worker and the office each by what the record says', () => {
    expect(d({ actor_kind: 'user', actor: 'you' }).who).toBe('You')
    expect(d({ actor_kind: 'agent', actor: 'chief-of-staff' })).toMatchObject({ who: 'Claire', tone: 'chief' })
    expect(d({ actor_kind: 'agent', actor: 'research-director' })).toMatchObject({ who: 'Emma', tone: 'agent' })
    expect(d({ actor_kind: 'external', actor: 'external:hermes', provenance: 'external' })).toMatchObject({ who: 'Hermes (outside worker)', tone: 'external', reported: true })
    expect(d({ actor_kind: 'system', actor: 'office' })).toMatchObject({ who: 'Team HQ', tone: 'system' })
  })
  it('never credits an unknown or retired specialist to Claire or to another specialist', () => {
    const x = d({ actor_kind: 'agent', actor: 'retired-director' })
    expect(x.who).not.toBe('Claire')
    expect(x.who).not.toBe('Emma')
    expect(x).toMatchObject({ tone: 'unknown' })
    expect(x.who).toMatch(/no longer on the roster/)
  })
  it('an actor kind it does not know is the office, not a person', () => {
    expect(d({ actor_kind: 'banana', actor: 'x' }).tone).toBe('system')
  })
  it('CONTROL: a describer that falls back to the first roster member would credit the unknown actor to Claire, and this test would catch it', () => {
    const wrongName = (actor: string) => (crew.find((c) => c.staffSlug === actor) ?? (crew[0] as { name: string })).name
    expect(wrongName('retired-director')).toBe('Claire')
    expect(d({ actor_kind: 'agent', actor: 'retired-director' }).who).not.toBe(wrongName('retired-director'))
  })
})

describe('what it says and how it ended', () => {
  it('uses the ledger sentence, minus the stored outside-worker marker, and nothing composed', () => {
    expect(d({ summary: '[external:hermes] Produced a draft' }).sentence).toBe('Produced a draft')
    expect(d({ summary: 'Sent to Telegram' }).sentence).toBe('Sent to Telegram')
    expect(d({ summary: 'A [external:x] mid-sentence mention stays' }).sentence).toBe('A [external:x] mid-sentence mention stays')
  })
  it('says Confirmed sent only for a confirmed status, and a person-marked delivery says so', () => {
    expect(d({ category: 'delivery', status: 'confirmed' }).result).toBe('Confirmed sent')
    expect(d({ category: 'delivery', status: 'completed', metadata: { confirmed_by_person: true } }).result).toBe('Marked as delivered by you')
    expect(d({ category: 'delivery', status: 'completed' }).result).toBe('Done')
    expect(d({ category: 'delivery', status: 'attempted' }).result).not.toBe('Confirmed sent')
  })
  it('an unconfirmed delivery that could not be verified is not reported as failed to send', () => {
    expect(d({ category: 'delivery', status: 'failed', metadata: { indeterminate: true } }).result).toBe('Could not be confirmed')
    expect(d({ category: 'delivery', status: 'failed' }).result).toBe('Failed')
  })
  it('says a yes or a no only for an approval status that is positively one; a hand-off is not an approval', () => {
    expect(d({ category: 'approval', status: 'authorised' }).result).toBe('You said yes')
    expect(d({ category: 'approval', status: 'declined' }).result).toBe('You said no')
    expect(d({ category: 'approval', status: 'requested' }).result).toBe('Asked')
    expect(d({ category: 'job', status: 'requested' }).result).toBe('')
  })
  it('marks failed, blocked and error-severity events as problems, and nothing else', () => {
    expect(d({ status: 'failed' }).problem).toBe(true)
    expect(d({ status: 'blocked' }).problem).toBe(true)
    expect(d({ status: 'completed', severity: 'error' }).problem).toBe(true)
    expect(d({ status: 'completed', severity: 'warning' }).problem).toBe(false)
    expect(d({ status: 'completed' }).problem).toBe(false)
  })
  it('is only Reported for an outside worker\'s own record', () => {
    expect(d({ provenance: 'projected' }).reported).toBe(false)
    expect(d({ provenance: 'native' }).reported).toBe(false)
    expect(d({ provenance: 'external' }).reported).toBe(true)
    expect(howWeKnow({ provenance: 'external' })).toMatch(/not independently confirmed/)
    expect(howWeKnow({ provenance: 'projected' })).not.toMatch(/outside worker/)
  })
  it('never throws on a malformed event and reads absent fields as absent', () => {
    for (const bad of [null, undefined, {}, { id: 3, summary: 7 }, { metadata: 'x' }]) expect(() => describeEvent(bad as never, { crew, projects })).not.toThrow()
    expect(describeEvent({} as never, { crew, projects })).toMatchObject({ sentence: '', result: '', projectName: '' })
  })
})

describe('where it leads', () => {
  it('leads only to a project the page knows, by the tool its category belongs to', () => {
    expect(destinationFor(d({ project_id: 'p-1', category: 'approval' }))).toMatchObject({ to: '/p/riverside/team' })
    expect(destinationFor(d({ project_id: 'p-1', category: 'task' }))).toMatchObject({ to: '/p/riverside/tasks' })
    expect(destinationFor(d({ project_id: 'p-1', category: 'document' }))).toMatchObject({ to: '/p/riverside/documents' })
    expect(destinationFor(d({ project_id: 'p-1', category: 'usage' }))).toMatchObject({ to: '/p/riverside', label: 'Open the project' })
  })
  it('invents nothing: an unknown or absent project has no destination', () => {
    expect(destinationFor(d({ project_id: 'p-unknown' }))).toBeNull()
    expect(destinationFor(d({ project_id: null }))).toBeNull()
  })
})

describe('what a filter asks the server', () => {
  const now = new Date('2026-10-11T15:30:00')
  it('each view is a server query: completed is a status, problems is a minimum severity, attention asks nothing of the feed', () => {
    expect(queryFor({ view: 'all' }, { now })).toMatchObject({ visibility: 'user', limit: '40' })
    expect(queryFor({ view: 'completed' }, { now })).toMatchObject({ status: 'completed' })
    expect(queryFor({ view: 'problems' }, { now })).toMatchObject({ severity: 'warning' })
    expect(VIEWS.find((v: { id: string }) => v.id === 'attention')?.ask).toBeNull()
    expect(queryFor({ view: 'nonsense' }, { now })).not.toHaveProperty('status')
  })
  it('combines agent, project and range, and passes the cursor exactly as written', () => {
    const q = queryFor({ view: 'problems', agent: 'research-director', project: 'p-1', range: '7' }, { now, cursor: { at: '2026-10-10T09:08:07.123456+00:00', id: 'abc' } })
    expect(q).toMatchObject({ severity: 'warning', agent: 'research-director', project: 'p-1', before_at: '2026-10-10T09:08:07.123456+00:00', before_id: 'abc' })
    expect(q.since).toBeTruthy()
  })
  it('a project page cannot be widened by a stale project filter', () => {
    expect(queryFor({ project: 'p-other' }, { scopeProject: 'p-1' }).project).toBe('p-1')
    expect(queryFor({ project: '' }, { scopeProject: 'p-1' }).project).toBe('p-1')
  })
  it('a malformed cursor is ignored rather than sent', () => {
    for (const c of [null, {}, { at: 1, id: 2 }, { at: 'x' }]) expect(queryFor({}, { cursor: c as never })).not.toHaveProperty('before_at')
  })
  it('ranges are the person\'s own calendar: Today starts at local midnight, 7 days is today and the six before', () => {
    const t = (id: string) => new Date(sinceFor(id, now))
    expect(t('1').getTime()).toBe(new Date(2026, 9, 11).getTime())
    expect(t('7').getTime()).toBe(new Date(2026, 9, 5).getTime())
    expect(t('30').getTime()).toBe(new Date(2026, 8, 12).getTime())
    expect(sinceFor('', now)).toBe('')
    expect(sinceFor('banana', now)).toBe('')
  })
  it('names the active filters, in a stable order, and never lists the project inside a project', () => {
    const f = activeFilters({ view: 'completed', agent: 'research-director', project: 'p-1', range: '7' }, { agentName: () => 'Emma', projectName: () => 'Riverside' })
    expect(f.map((x: { key: string }) => x.key)).toEqual(['view', 'agent', 'project', 'range'])
    expect(activeFilters({ view: 'all', agent: '', project: 'p-1', range: '' }, { scopeProject: 'p-1' })).toEqual([])
    expect(activeFilters({ view: 'attention', agent: '', project: '', range: '' })).toEqual([])
  })
  it('CONTROL: a view that filtered the loaded page instead would not carry a status to the server, and this test would catch it', () => {
    const clientSideOnly = () => ({ visibility: 'user', limit: '40' })
    expect(clientSideOnly()).not.toMatchObject({ status: 'completed' })
    expect(queryFor({ view: 'completed' })).toMatchObject({ status: 'completed' })
  })
})

describe('the day headings and paging', () => {
  const now = new Date(2026, 9, 11, 15, 30)
  it('groups under Today, Yesterday and then dated headings, newest first, keeping order', () => {
    const at = (day: number, h: number) => new Date(2026, 9, day, h).toISOString()
    const g = groupByDay([{ id: 'a', at: at(11, 14) }, { id: 'b', at: at(11, 9) }, { id: 'c', at: at(10, 20) }, { id: 'd', at: at(5, 8) }], now)
    expect(g.map((x: { label: string }) => x.label)).toEqual(['Today', 'Yesterday', 'Monday 5 October'.replace('Monday', new Date(2026, 9, 5).toLocaleDateString('en-GB', { weekday: 'long' }))])
    expect(g.map((x: { events: { id: string }[] }) => x.events.map((e) => e.id))).toEqual([['a', 'b'], ['c'], ['d']])
  })
  it('puts an event with no usable instant under Undated, and never throws', () => {
    expect(dayLabel('nonsense', now)).toBe('Undated')
    expect(dayKey('nonsense')).toBe('undated')
    expect(groupByDay([{ id: 'x', at: 'nonsense' }], now)[0].label).toBe('Undated')
  })
  it('appends a page by id: a boundary event delivered twice is shown once and the order is kept', () => {
    const held = [{ id: 'a' }, { id: 'b' }]
    expect(appendPage(held, [{ id: 'b' }, { id: 'c' }]).map((e: { id: string }) => e.id)).toEqual(['a', 'b', 'c'])
    expect(appendPage(held, [{ id: 3 as never }, {} as never]).map((e: { id: string }) => e.id)).toEqual(['a', 'b'])
  })
})

describe('what is shown beside an event', () => {
  it('shows only short scalar facts from a whitelist, in plain words, and never a long or private value', () => {
    const f = safeFacts({ kind: 'office.instruction', answer: 'Yes', body: 'PRIVATE TEXT', password: 'x', note: { a: 1 }, total_tokens: 1234, long: 'x'.repeat(500), confirmed_by_person: true })
    const keys = f.map(([k]: [string, string]) => k)
    expect(keys).toEqual(['Kind of work', 'Answer given', 'Confirmed by the provider'.replace('Confirmed by the provider', 'Marked by you'), 'Tokens'].sort((a, b) => keys.indexOf(a) - keys.indexOf(b)))
    expect(JSON.stringify(f)).not.toMatch(/PRIVATE|password|office\.instruction/)
    expect(f.find(([k]: [string, string]) => k === 'Kind of work')?.[1]).toBe('A request')
  })
  it('a long value of a whitelisted key is dropped, not truncated into something misleading', () => {
    expect(safeFacts({ answer: 'x'.repeat(200) })).toEqual([])
    expect(safeFacts(null)).toEqual([])
    expect(safeFacts('string' as never)).toEqual([])
  })
  it('a job kind is words, never a dotted identifier', () => {
    expect(kindWords('office.instruction')).toBe('A request')
    expect(kindWords('artifact.report')).toBe('Artifact report')
  })
  it('names a stage for each step of a chain, and Work for anything it does not recognise', () => {
    expect(['request.received', 'job.delegated', 'approval.granted', 'output.created', 'output.reviewed', 'delivery.succeeded', 'job.completed', 'job.failed', 'external.output_produced', 'banana'].map(stageOf)).toEqual(['Request', 'Handed over', 'Approval', 'Output', 'Review', 'Delivery', 'Finished', 'Stopped', 'Outside worker', 'Work'])
  })
})

describe('the module is wired the way these rules assume', () => {
  const src = readFileSync('web/studio/bc/activity.js', 'utf8')
  const shell = readFileSync('web/studio/bc/shell.js', 'utf8')
  const wire = readFileSync('web/studio/bc/wire.js', 'utf8')
  it('asks the whole-history reader, never filters the loaded page, and asks the chain reader only on a press', () => {
    expect(src).toMatch(/read\('activity_feed', undefined, q\)/)
    expect(src).toMatch(/queryFor\(S, \{ scopeProject: scopeProject\(\), limit: PAGE, cursor: more \? S\.next : null \}\)/)
    expect(src).toMatch(/read\('activity_chain', undefined, \{ \.\.\.ask, visibility: 'user' \}\)/)
    expect(src.match(/void loadChain\(/g)?.length).toBe(1) // one call, in the press handler
    expect(src).not.toMatch(/\.filter\(\(e\) => e\.status/) // no client-side narrowing of the loaded events
  })
  it('drops an answer to an older question (a sequence number checked after every await)', () => {
    expect(src.match(/if \(mine !== S\.seq\) return/g)?.length).toBeGreaterThanOrEqual(2)
  })
  it('the office page and the project page both go through it, with the older list as the fallback', () => {
    expect(shell).toMatch(/activity\.render\(''\, older\)/)
    expect(shell).toMatch(/activity\.render\(p\.slug, older\)/)
    expect(wire).toMatch(/activity\.wire\(root\)/)
  })
  it('a second approval mechanism is not built here: no answer or decide call exists in the module', () => {
    expect(src).not.toMatch(/act\('(answer|approve|decline|decide)/)
    expect(src).not.toMatch(/hq_answer_blocker|approval_answer|\bact\(/)
  })
  it('CONTROL: the wiring detector fails on a module that applies a filter to the loaded events', () => {
    const defective = "S.events = S.events.filter((e) => e.status === 'completed')"
    expect(defective).toMatch(/\.filter\(\(e\) => e\.status/)
  })
})
