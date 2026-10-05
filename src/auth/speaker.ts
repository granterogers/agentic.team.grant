/**
 * Who is speaking: the one verifier the voice functions share (multi-user P1, #400).
 *
 * `voice` carried a private copy of this logic and `voice-token` carried none: it minted a realtime
 * session for anybody who could reach it. The copy's comment said the duplication was "deliberate
 * and unavoidable" because an edge function is uploaded as one file. That stopped being true when the
 * worker's deploy learned to bundle its import graph, and the cost of believing it was a function
 * with no authentication at all.
 *
 * ## What counts as a speaker
 *
 *   service  - the office's machine key. It names nobody; `voice` lets it speak only as a declared
 *              test speaker, and `voice-token` lets it mint (the deploy probe and verify:talk).
 *   person   - a signed-in member whose `office_members` row says `kind = 'person'`. They speak as
 *              THEIR OWN `owner_key`.
 *   harness  - a signed-in member of any other kind (a test principal). Speaks as itself.
 *
 * ## What it refuses to do
 *
 *   - decode a JWT itself. A token a function merely decoded is a token anybody can write, so
 *     Supabase is asked whether it issued this session (`/auth/v1/user`) and `office_members` is
 *     asked whether the address is somebody the office works for;
 *   - invent a subject. The previous code spoke every person as the environment value
 *     `VOICE_SUBJECT` (default `'grant'`), so a second member's spoken instruction would have been
 *     attributed to Grant. A person with no `owner_key` is NOT a speaker: it fails closed instead of
 *     defaulting;
 *   - cache a refusal. Only a positive answer is held, and only for a minute.
 */

export type Speaker = {
  readonly kind: 'person' | 'harness' | 'service'
  readonly actor: string
  /**
   * The office the VERIFIED LOGIN belongs to (P3). Resolved from the auth user id by `public.resolve_office`; null
   * only for the machine key, which names no office. A session whose login resolves to no active office is not a
   * speaker at all - it is never defaulted to the person.
   */
  readonly office: string | null
}

export type SpeakerEnv = {
  /** The office's machine key (`HQ_API_TOKEN`). Empty means "no machine key configured". */
  readonly hqToken: string
  readonly supabaseUrl: string
  readonly anonKey: string
  readonly serviceKey: string
}

export type SpeakerDeps = {
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly cache?: Map<string, { until: number; speaker: Speaker }>
}

export const SESSION_TTL_MS = 60_000
const CACHE_LIMIT = 64
const sharedCache = new Map<string, { until: number; speaker: Speaker }>()

/** The stand-in actor for the machine key. It is not a person and is never written as one. */
export const SERVICE_ACTOR = 'verify-service'

const digest = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

/** Constant-time comparison of the presented bearer with the machine key. */
export const tokenMatches = async (
  presented: string | null,
  expected: string,
): Promise<boolean> => {
  if (expected === '' || presented === null || presented === '') return false
  const [a, b] = await Promise.all([digest(presented), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** The bearer token on a request, or null. */
export const bearerOf = (request: {
  headers: { get(name: string): string | null }
}): string | null => {
  const header = request.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null
}

type OfficeMemberRow = { ok?: boolean; owner_key?: string | null; kind?: string | null }

const sessionSpeaker = async (
  presented: string,
  env: SpeakerEnv,
  deps: Required<SpeakerDeps>,
): Promise<Speaker | null> => {
  const held = deps.cache.get(presented)
  if (held !== undefined && held.until > deps.now()) return held.speaker

  const who = await deps
    .fetch(`${env.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${presented}` },
    })
    .catch(() => null)
  if (who === null || !who.ok) return null
  const user = (await who.json().catch(() => ({}))) as { id?: string; email?: string }
  const email = String(user.email ?? '')
    .trim()
    .toLowerCase()
  if (email === '') return null

  const asked = await deps
    .fetch(`${env.supabaseUrl}/rest/v1/rpc/office_member`, {
      method: 'POST',
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_email: email }),
    })
    .catch(() => null)
  if (asked === null || !asked.ok) return null
  const rows = (await asked.json().catch(() => [])) as OfficeMemberRow[]
  const row = rows[0]
  if (row?.ok !== true) return null

  const found = await deps
    .fetch(`${env.supabaseUrl}/rest/v1/rpc/resolve_office`, {
      method: 'POST',
      headers: {
        apikey: env.serviceKey,
        Authorization: `Bearer ${env.serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_auth_user_id: String(user.id ?? '') }),
    })
    .catch(() => null)
  if (found === null || !found.ok) return null
  const resolved = (await found.json().catch(() => ({}))) as { ok?: boolean; office_id?: string }
  if (resolved.ok !== true || typeof resolved.office_id !== 'string' || resolved.office_id === '')
    return null
  const office = resolved.office_id

  const ownerKey = String(row.owner_key ?? '').trim()
  let speaker: Speaker
  if (row.kind === 'person') {
    // A person speaks as THEMSELVES. No owner key means no identity to attribute an instruction to.
    if (ownerKey === '') return null
    speaker = { kind: 'person', actor: ownerKey, office }
  } else {
    // A kind the database did not say is a test member: the restrictive reading.
    speaker = { kind: 'harness', actor: ownerKey === '' ? 'verify-operator' : ownerKey, office }
  }

  deps.cache.set(presented, { until: deps.now() + SESSION_TTL_MS, speaker })
  if (deps.cache.size > CACHE_LIMIT) {
    for (const k of [...deps.cache.keys()].slice(0, CACHE_LIMIT / 2)) deps.cache.delete(k)
  }
  return speaker
}

/** Resolve a presented bearer to a verified speaker, or null. Never throws on a bad credential. */
export const resolveSpeaker = async (
  presented: string | null,
  env: SpeakerEnv,
  deps: SpeakerDeps = {},
): Promise<Speaker | null> => {
  if (presented === null || presented === '') return null
  if (await tokenMatches(presented, env.hqToken))
    return { kind: 'service', actor: SERVICE_ACTOR, office: null }
  // A Supabase session is a three-part JWT of real length; anything else is not worth a network call.
  if (presented.split('.').length !== 3 || presented.length <= 60) return null
  return await sessionSpeaker(presented, env, {
    fetch: deps.fetch ?? fetch,
    now: deps.now ?? Date.now,
    cache: deps.cache ?? sharedCache,
  })
}
