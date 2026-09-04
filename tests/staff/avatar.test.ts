/**
 * Staff avatars (§9).
 *
 * The interesting property is not that a portrait renders — it is that the
 * eight are telling APART. A generator can produce eight valid SVGs that all
 * look like the same person, and nothing in the type system notices.
 */
import { describe, expect, it } from 'vitest'
import { ROLE_SLUGS } from '../../src/agents/router.ts'
import { avatarFor, chooseFeatures, featuresFor, identityKey } from '../../src/staff/avatar.ts'

describe('the eight are distinguishable', () => {
  it('no two roles share a face', () => {
    // Two of the eight collided on the raw hash. This is the test that would
    // have caught it, and the one that catches the next one when a role is
    // added.
    const keys = ROLE_SLUGS.map(identityKey)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes).toEqual([])
  })

  it('uses a genuine spread of skin tones rather than one with variations', () => {
    const tones = new Set(ROLE_SLUGS.map((s) => featuresFor(s).skin))
    expect(tones.size).toBeGreaterThanOrEqual(5)
  })

  it('varies the silhouette, not just the colours', () => {
    // Colour alone reads as the same person recoloured, which is exactly what
    // fails at 44px.
    const shapes = new Set(ROLE_SLUGS.map((s) => featuresFor(s).hairStyle))
    expect(shapes.size).toBeGreaterThanOrEqual(4)
  })
})

describe('determinism', () => {
  it('gives a slug the same face every time', () => {
    for (const slug of ROLE_SLUGS) {
      expect(chooseFeatures(slug)).toEqual(chooseFeatures(slug))
      expect(avatarFor(slug)).toBe(avatarFor(slug))
    }
  })

  it('gives different slugs different features', () => {
    expect(chooseFeatures('research-director')).not.toEqual(chooseFeatures('finance-director'))
  })

  it('is stable for a slug not in the roster, so a new role gets a face', () => {
    const a = avatarFor('temporary-specialist-pricing')
    expect(a).toContain('<svg')
    expect(a).toBe(avatarFor('temporary-specialist-pricing'))
  })
})

describe('the SVG itself', () => {
  it('scopes its gradient and clip ids per slug', () => {
    // Two avatars on one page with the same `id` means the second silently
    // inherits the first's background - a real bug in the contact sheet and in
    // any dashboard that shows the team together.
    const ids = ROLE_SLUGS.flatMap((s) =>
      [...avatarFor(s).matchAll(/id="([^"]+)"/g)].map((m) => m[1]),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('carries an accessible label', () => {
    expect(avatarFor('chief-of-staff')).toContain(
      'aria-label="Illustrated portrait for chief-of-staff"',
    )
  })

  it('has balanced tags', () => {
    for (const slug of ROLE_SLUGS) {
      const svg = avatarFor(slug)
      const opens = (svg.match(/<(?!\/)[a-zA-Z]/g) ?? []).length
      const closes = (svg.match(/<\/[a-zA-Z]/g) ?? []).length
      const selfClosing = (svg.match(/\/>/g) ?? []).length
      expect(opens).toBe(closes + selfClosing)
    }
  })
})
