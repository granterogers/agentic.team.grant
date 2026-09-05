/**
 * How a staff member appears in Slack.
 *
 * §9: staff are presented via `chat:write.customize` plus rich blocks — *"name,
 * title, avatar"* — and *"true staff identity lives in Postgres, never in Slack
 * message authorship."* This module is the translation between the two, and it
 * is pure: it takes a staff row and returns what the Slack call should carry.
 *
 * The whole of the interesting content here is what happens when there is no
 * avatar URL, so it is worth stating plainly rather than burying in a branch.
 *
 * `icon_url` needs a publicly reachable image. The artwork exists
 * (`assets/avatars/png/`) but nothing is hosted, and `staff.avatar_ref` holds a
 * repository path rather than a URL for that reason (0032). Three things could
 * be done with that:
 *
 *   1. guess a URL and send it — Slack renders a broken image, and the failure
 *      is invisible to us because `chat.postMessage` succeeds either way;
 *   2. send no icon — eight staff share one default app icon, which is the
 *      exact failure §9's "avatar" is there to prevent;
 *   3. send a deterministic per-role emoji, and SAY that is what happened.
 *
 * Three, because it degrades to something legible instead of something broken,
 * and because `iconSource` on the result makes the degradation visible to the
 * caller. A system that silently falls back is a system where nobody notices
 * the avatars never got hosted.
 */

/** The parts of a `staff` row that presentation needs. */
export interface StaffPresentation {
  readonly slug: string
  readonly name: string
  readonly title: string
  /** Repository path from `staff.avatar_ref`, or null when none is drawn. */
  readonly avatarRef: string | null
}

export interface IdentityOptions {
  /**
   * Public base URL under which `avatarRef` paths are served, with or without
   * a trailing slash. Absent, empty or non-HTTPS means there is no hosting,
   * which is a normal state and not an error.
   */
  readonly avatarBaseUrl?: string | null
}

export type IconSource = 'avatar_url' | 'emoji_fallback'

export interface SlackIdentity {
  /** `username` on the Slack call. Slack truncates past 80; we do it visibly. */
  readonly username: string
  readonly iconUrl: string | null
  readonly iconEmoji: string | null
  readonly iconSource: IconSource
}

/**
 * One emoji per permanent role.
 *
 * Fixed rather than derived, because a hash-derived emoji changes when the
 * hash changes and staff identity is not something to shuffle. These are all
 * in Slack's default set — a custom emoji name renders as literal `:foo:` text
 * if the workspace does not have it, which is worse than the default icon.
 */
const ROLE_EMOJI: Readonly<Record<string, string>> = {
  'chief-of-staff': ':compass:',
  'research-director': ':books:',
  'strategy-director': ':chess_pawn:',
  'growth-director': ':chart_with_upwards_trend:',
  'finance-director': ':abacus:',
  'operations-director': ':gear:',
  'quality-director': ':shield:',
  'communications-director': ':pencil:',
}

/**
 * Emoji for anyone not in the fixed table — temporary specialists, who are
 * recommended at runtime and cannot be enumerated here.
 *
 * Deterministic per slug so the same specialist looks the same twice, and
 * drawn from a pool that deliberately does not overlap `ROLE_EMOJI`: a
 * temporary specialist wearing the Quality & Risk Director's shield is a
 * misattribution, not a clash of decoration.
 */
const SPECIALIST_POOL: readonly string[] = [
  ':bulb:',
  ':microscope:',
  ':triangular_ruler:',
  ':globe_with_meridians:',
  ':hammer_and_wrench:',
  ':scroll:',
  ':telescope:',
  ':jigsaw:',
]

const hash = (value: string): number => {
  // FNV-1a, 32-bit. Chosen because it is short enough to read and stable
  // across runtimes; nothing here is security-sensitive.
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function emojiFor(slug: string): string {
  const fixed = ROLE_EMOJI[slug]
  if (fixed !== undefined) return fixed
  const pool = SPECIALIST_POOL
  const chosen = pool[hash(slug) % pool.length]
  // `pool` is a non-empty literal, so the index is always in range; the check
  // exists for the type, not for the case.
  return chosen ?? ':bulb:'
}

/**
 * Report slugs that would end up wearing the same emoji.
 *
 * The avatar generator reports feature collisions rather than reseeding until
 * the spread looks right, for the reason given in its header: reseeding hides
 * which two collided. Same discipline, same reason. Two permanent roles can
 * never collide — the table is explicit — but two temporary specialists can,
 * and a caller that wants to know can ask.
 */
export function emojiCollisions(slugs: readonly string[]): readonly (readonly string[])[] {
  const byEmoji = new Map<string, string[]>()
  for (const slug of slugs) {
    const emoji = emojiFor(slug)
    const bucket = byEmoji.get(emoji)
    if (bucket === undefined) byEmoji.set(emoji, [slug])
    else bucket.push(slug)
  }
  return [...byEmoji.values()].filter((bucket) => bucket.length > 1)
}

/** Slack's own limit on the `username` override. */
export const USERNAME_MAX = 80

/**
 * Turn a repository avatar path into a public URL, or null.
 *
 * Refuses anything that is not absolute HTTPS: an `http://` icon is blocked by
 * Slack's image proxy and renders as nothing, which lands us back at the
 * invisible-failure case this module exists to avoid. Refuses path traversal
 * for the ordinary reason.
 */
export function avatarUrl(
  avatarRef: string | null,
  baseUrl: string | null | undefined,
): string | null {
  if (avatarRef === null || avatarRef.trim() === '') return null
  if (baseUrl === null || baseUrl === undefined || baseUrl.trim() === '') return null
  if (!baseUrl.startsWith('https://')) return null
  if (avatarRef.includes('..')) return null

  const base = baseUrl.replace(/\/+$/, '')
  const path = avatarRef.replace(/^\/+/, '')
  return `${base}/${path}`
}

export function identityFor(
  staff: StaffPresentation,
  options: IdentityOptions = {},
): SlackIdentity {
  const url = avatarUrl(staff.avatarRef, options.avatarBaseUrl)
  const username =
    staff.name.length <= USERNAME_MAX ? staff.name : `${staff.name.slice(0, USERNAME_MAX - 1)}…`

  return url === null
    ? { username, iconUrl: null, iconEmoji: emojiFor(staff.slug), iconSource: 'emoji_fallback' }
    : { username, iconUrl: url, iconEmoji: null, iconSource: 'avatar_url' }
}
