/**
 * Project switching.
 *
 * A wrong project context is uniquely bad: everything afterwards looks normal
 * and is filed in the wrong place, and nothing surfaces it until someone goes
 * looking for work that is not where they left it. So the tests are mostly
 * about refusing to guess.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { trustedOffice } from '../../src/office/context.ts'
import { clarificationFor, matchProject, parseSwitch } from '../../src/projects/context.ts'

const OFFICE = trustedOffice('11111111-1111-4111-8111-111111111111')

const projects = [
  { project_id: '1', slug: 'pricing-research', name: 'Pricing Research' },
  { project_id: '2', slug: 'pricing-page-rebuild', name: 'Pricing Page Rebuild' },
  { project_id: '3', slug: 'onboarding', name: 'Onboarding' },
]

const db = (rows = projects): SqlExecutor => ({
  kind: 'fake',
  execute: (): Promise<SqlResult> => Promise.resolve({ rows }),
})

describe('recognising a switch', () => {
  it.each([
    ['switch to pricing research', 'pricing research'],
    ["let's switch over to the onboarding project", 'onboarding'],
    ['move to pricing page rebuild', 'pricing page rebuild'],
    ['work on onboarding', 'onboarding'],
    ['set project to pricing research', 'pricing research'],
  ])('%s', (text, expected) => {
    const r = parseSwitch(text)
    expect(r.kind).toBe('switch')
    expect(r.kind === 'switch' && r.name).toBe(expected)
  })

  it.each(['clear the project', 'no project', 'unset project to none'])(
    'recognises %s as an explicit un-scoping',
    (text) => {
      expect(parseSwitch(text).kind).toBe('unset')
    },
  )

  it('does not treat a passing remark as a context change', () => {
    // "switch to" mid-sentence is the trap. Anchoring costs a few unusual
    // phrasings and avoids a silent context change from an aside.
    for (const text of [
      'We should switch to a monthly cadence',
      'I think we could move to the new pricing model next quarter',
      'Remind me why we work on this at all',
    ]) {
      expect(parseSwitch(text).kind).toBe('none')
    }
  })

  it('refuses a name too short to be one', () => {
    expect(parseSwitch('switch to x').kind).toBe('none')
  })
})

describe('matching a name to a project', () => {
  it('matches an exact name', async () => {
    const r = await matchProject(db(), OFFICE, 'Pricing Research')
    expect(r.kind).toBe('matched')
    expect(r.kind === 'matched' && r.project.slug).toBe('pricing-research')
  })

  it('matches a slug, and a spoken name that slugifies to one', async () => {
    for (const n of ['onboarding', 'Pricing Page Rebuild']) {
      expect((await matchProject(db(), OFFICE, n)).kind).toBe('matched')
    }
  })

  it('REFUSES to choose between two plausible projects', async () => {
    // The whole point. Edit distance or recency would answer confidently here,
    // and would be wrong half the time with no signal that it was.
    const r = await matchProject(db(), OFFICE, 'pricing')
    expect(r.kind).toBe('ambiguous')
    expect(r.kind === 'ambiguous' && r.candidates).toHaveLength(2)
  })

  it('is not made ambiguous by a looser match when an exact one exists', async () => {
    // "Onboarding" is exact; if tiers pooled rather than stopping at the first
    // that matched, a project called "Onboarding Redesign" would make every
    // exact match ambiguous, and asking would become noise instead of care.
    const withExtra = [
      ...projects,
      { project_id: '4', slug: 'onboarding-redesign', name: 'Onboarding Redesign' },
    ]
    const r = await matchProject(db(withExtra), OFFICE, 'Onboarding')
    expect(r.kind).toBe('matched')
    expect(r.kind === 'matched' && r.project.slug).toBe('onboarding')
  })

  it('reports not_found rather than picking the nearest', async () => {
    const r = await matchProject(db(), OFFICE, 'invoicing')
    expect(r.kind).toBe('not_found')
  })

  it('treats an empty name as not_found, never as "everything"', async () => {
    expect((await matchProject(db(), OFFICE, '   ')).kind).toBe('not_found')
  })
})

describe('what the user is told', () => {
  it('names the candidates when ambiguous', async () => {
    const msg = clarificationFor(await matchProject(db(), OFFICE, 'pricing'))
    expect(msg).toContain('Pricing Research')
    expect(msg).toContain('Pricing Page Rebuild')
  })

  it('says so plainly when nothing matched', async () => {
    expect(clarificationFor(await matchProject(db(), OFFICE, 'invoicing'))).toContain('invoicing')
  })

  it('says nothing when there is nothing to ask', async () => {
    expect(clarificationFor(await matchProject(db(), OFFICE, 'Onboarding'))).toBe('')
  })
})
