/**
 * How staff appear, and what happens when the avatars are not hosted.
 *
 * The degradation is the part worth testing hardest. A broken `icon_url` costs
 * nothing at call time — `chat.postMessage` succeeds either way — so the only
 * defence against shipping eight broken images is a rule that refuses to build
 * a URL it cannot justify, and a `iconSource` that says which branch was taken.
 */
import { describe, expect, it } from 'vitest'
import {
  avatarUrl,
  emojiCollisions,
  emojiFor,
  identityFor,
  USERNAME_MAX,
} from '../../src/slack/identity.ts'

const THE_EIGHT = [
  'chief-of-staff',
  'research-director',
  'strategy-director',
  'growth-director',
  'finance-director',
  'operations-director',
  'quality-director',
  'communications-director',
]

const staff = (over: Partial<Parameters<typeof identityFor>[0]> = {}) => ({
  slug: 'research-director',
  name: 'Research Director',
  title: 'Research Director',
  avatarRef: 'assets/avatars/png/research-director.png',
  ...over,
})

describe('avatar URLs', () => {
  it('is built when there is somewhere to host it', () => {
    expect(avatarUrl('assets/avatars/png/x.png', 'https://cdn.example/')).toBe(
      'https://cdn.example/assets/avatars/png/x.png',
    )
  })

  it('tolerates a base with or without a trailing slash, because both get typed', () => {
    expect(avatarUrl('a/b.png', 'https://cdn.example')).toBe('https://cdn.example/a/b.png')
    expect(avatarUrl('/a/b.png', 'https://cdn.example///')).toBe('https://cdn.example/a/b.png')
  })

  it('refuses plain http, which Slack silently declines to render', () => {
    expect(avatarUrl('a.png', 'http://cdn.example')).toBeNull()
  })

  it('refuses traversal', () => {
    expect(avatarUrl('../../etc/passwd', 'https://cdn.example')).toBeNull()
  })

  it('is null when there is no base, rather than a guess at one', () => {
    expect(avatarUrl('a.png', null)).toBeNull()
    expect(avatarUrl('a.png', '')).toBeNull()
    expect(avatarUrl('a.png', undefined)).toBeNull()
  })

  it('is null when the staff member has no avatar drawn', () => {
    expect(avatarUrl(null, 'https://cdn.example')).toBeNull()
  })
})

describe('identity', () => {
  it('uses the avatar when it can, and says so', () => {
    const id = identityFor(staff(), { avatarBaseUrl: 'https://cdn.example' })
    expect(id.iconSource).toBe('avatar_url')
    expect(id.iconUrl).toBe('https://cdn.example/assets/avatars/png/research-director.png')
    expect(id.iconEmoji).toBeNull()
  })

  it('falls back to a per-role emoji when there is no hosting, and says THAT', () => {
    const id = identityFor(staff(), {})
    expect(id.iconSource).toBe('emoji_fallback')
    expect(id.iconEmoji).toBe(':books:')
    expect(id.iconUrl).toBeNull()
  })

  it('never returns neither, because a default app icon on eight staff is the failure §9 names', () => {
    for (const slug of THE_EIGHT) {
      const id = identityFor(staff({ slug, avatarRef: null }))
      expect(id.iconUrl === null && id.iconEmoji === null).toBe(false)
    }
  })

  it('carries the name as the username, since Slack shows that and not the title', () => {
    expect(identityFor(staff()).username).toBe('Research Director')
  })

  it('truncates visibly rather than letting Slack cut it', () => {
    const long = 'x'.repeat(200)
    const id = identityFor(staff({ name: long }))
    expect(id.username.length).toBe(USERNAME_MAX)
    expect(id.username.endsWith('…')).toBe(true)
  })
})

describe('the emoji fallback', () => {
  it('gives all eight permanent roles distinct emoji — the whole point of having any', () => {
    expect(emojiCollisions(THE_EIGHT)).toEqual([])
  })

  it('is stable for a given slug, so a specialist looks the same twice', () => {
    expect(emojiFor('pricing-analyst')).toBe(emojiFor('pricing-analyst'))
  })

  it('never gives a temporary specialist the emoji of a permanent role, which would misattribute', () => {
    const permanent = new Set(THE_EIGHT.map(emojiFor))
    for (const slug of ['pricing-analyst', 'seo-specialist', 'tax-adviser', 'ux-writer']) {
      expect(permanent.has(emojiFor(slug))).toBe(false)
    }
  })

  it('reports collisions rather than hiding them, as the avatar generator does', () => {
    // Constructed from the pool so the reporting is exercised even though the
    // eight never collide.
    const many = Array.from({ length: 40 }, (_, i) => `specialist-${String(i)}`)
    const collisions = emojiCollisions(many)
    expect(collisions.length).toBeGreaterThan(0)
    for (const bucket of collisions) expect(bucket.length).toBeGreaterThan(1)
  })
})
