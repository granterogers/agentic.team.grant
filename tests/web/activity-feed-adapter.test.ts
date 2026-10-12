// biome-ignore-all format: dense tables kept readable as written
/**
 * The Activity screen over the office's EXISTING activity rows (the gateway's `lately` section and each project's `activity`), with the
 * ledger off. The adapter must say only what a row says: no outcome is invented, an unknown actor is not credited to anybody, a row with
 * no instant is kept (undated) rather than dropped, and the held rows are filtered the way the person asked.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no type declarations
import { describe as describeEvent, filterFeed, fromFeedRow, sortFeed } from '../../web/studio/bc/activity-model.js'

const crew = [
  { slug: 'chief-of-staff', staffSlug: 'chief-of-staff', name: 'Claire' },
  { slug: 'research-director', staffSlug: 'research-director', name: 'Emma' },
]
const projects = [
  { id: 'p1', slug: 'launch', name: 'Riverside launch' },
  { id: 'p2', slug: 'course', name: 'Legacy Coaching Course' },
]
const ctx = { crew, projects }
const row = (o: Record<string, unknown>) => ({ at: '2026-10-12T09:30:00Z', who: 'research-director', kind: 'agent', verb: 'pulled', what: 'the client list', project: 'Riverside launch', via: 'telegram', category: 'sync', ...o })

describe('fromFeedRow', () => {
  it('turns a feed row into what the timeline draws: the agent, the sentence, the project, the door', () => {
    const e = fromFeedRow(row({ why: 'Asked to refresh the list', reversible: true }), 0, ctx)
    const d = describeEvent(e, ctx)
    expect(d.who).toBe('Emma')
    expect(d.sentence).toBe('Pulled the client list')
    expect(d.projectName).toBe('Riverside launch')
    expect(d.project?.slug).toBe('launch')
    expect(d.via).toBe('Telegram')
    expect(e.rationale).toBe('Asked to refresh the list')
    expect(e.reversible).toBe(true)
  })

  it('invents no outcome: a feed row has no status, so no result word and no problem flag', () => {
    const d = describeEvent(fromFeedRow(row({ verb: 'failed to send', what: 'the email' }), 0, ctx), ctx)
    expect(d.status).toBe('')
    expect(d.result).toBe('')
    expect(d.problem).toBe(false)
  })

  it('a person is You, and an unknown specialist is never credited to anybody on the roster', () => {
    expect(describeEvent(fromFeedRow(row({ who: 'you', kind: 'user' }), 0, ctx), ctx).who).toBe('You')
    const ghost = describeEvent(fromFeedRow(row({ who: 'retired-director', kind: 'agent' }), 0, ctx), ctx)
    expect(ghost.who).toMatch(/no longer on the roster/)
    expect(ghost.slug).toBe('retired-director')
  })

  it('an outside worker is named as one and marked by its actor, not as a team member', () => {
    const d = describeEvent(fromFeedRow(row({ who: 'hermes', kind: 'external' }), 0, ctx), ctx)
    expect(d.who).toBe('Hermes (outside worker)')
    expect(d.tone).toBe('external')
  })

  it('keeps a row with no instant (undated) and drops a row that says nothing', () => {
    expect(fromFeedRow(row({ at: 'not a date' }), 0, ctx).at).toBe('')
    expect(fromFeedRow(row({ verb: '', what: '' }), 0, ctx)).toBeNull()
    expect(fromFeedRow(null, 0, ctx)).toBeNull()
    expect(fromFeedRow('x', 0, ctx)).toBeNull()
  })

  it('a folded row says how many more it stands for', () => {
    expect(fromFeedRow(row({ times: 7 }), 0, ctx).more).toBe(7)
    expect(fromFeedRow(row({}), 0, ctx).more).toBe(0)
  })

  it('a project the page does not know has no link target (nothing is guessed)', () => {
    const d = describeEvent(fromFeedRow(row({ project: 'A project nobody has' }), 0, ctx), ctx)
    expect(d.project).toBeUndefined()
    expect(d.projectName).toBe('A project nobody has')
  })
})

describe('sortFeed and filterFeed', () => {
  const a = fromFeedRow(row({ at: '2026-10-12T09:00:00Z', who: 'you', kind: 'user' }), 0, ctx)
  const b = fromFeedRow(row({ at: '2026-10-12T11:00:00Z' }), 1, ctx)
  const c = fromFeedRow(row({ at: '2026-10-01T11:00:00Z', project: 'Legacy Coaching Course', who: 'chief-of-staff' }), 2, ctx)
  const u = fromFeedRow(row({ at: '' }), 3, ctx)
  const all = [a, b, c, u]
  const now = new Date('2026-10-12T12:00:00Z')

  it('orders newest first and keeps undated rows after every dated one', () => {
    expect(sortFeed([u, a, c, b]).map((e: { id: string }) => e.id)).toEqual([b.id, a.id, c.id, u.id])
  })
  it('narrows by person, by project and by date, and a project page cannot be widened by a stale choice', () => {
    expect(filterFeed(all, { agent: 'research-director' }, { now }).map((e: { id: string }) => e.id)).toEqual([b.id, u.id])
    expect(filterFeed(all, { project: 'p2' }, { now })).toEqual([c])
    expect(filterFeed(all, { range: '1' }, { now }).map((e: { id: string }) => e.id)).toEqual([a.id, b.id])
    expect(filterFeed(all, { project: 'p1' }, { scopeProject: 'p2', now })).toEqual([c])
  })
  it('CONTROL: with no filter every row is kept, so a filter that matches nothing is the filter and not the harness', () => {
    expect(filterFeed(all, {}, { now })).toHaveLength(4)
    expect(filterFeed(all, { agent: 'nobody' }, { now })).toHaveLength(0)
  })
})

describe('the screen is wired to the existing feed and not to the ledger', () => {
  const src = readFileSync('web/studio/bc/activity.js', 'utf8')
  it('draws the feed whenever the ledger is not answering, and offers only the views it can answer', () => {
    expect(src).toMatch(/if \(legacyOn\(\)\) return legacyBody\(\)/)
    expect(src).toMatch(/legacyOn\(\) \|\| v\.id === 'all' \|\| v\.id === 'attention'|!legacyOn\(\) \|\| v\.id === 'all' \|\| v\.id === 'attention'/)
  })
  it('asks no server when a filter changes in feed mode', () => {
    expect(src).toMatch(/if \(!legacyOn\(\)\) reload\(\)/)
  })
  it('CONTROL: the detector fails on a screen that always reloads', () => {
    expect(src.replace(/if \(!legacyOn\(\)\) reload\(\)/g, 'reload()')).not.toMatch(/if \(!legacyOn\(\)\) reload\(\)/)
  })
})
