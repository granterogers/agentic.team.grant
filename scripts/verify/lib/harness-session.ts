/**
 * A signed-in session for the TEST member, as a bearer token, for a suite that drives the gateway
 * directly rather than through a browser (#385, 0614).
 *
 * Why it exists. A suite used to present the office key and be Grant. The key is a machine now and
 * cannot decide, so a suite that answers a question, sets autonomy or says something in a project
 * needs a session, and the only one the key can ask for is the test member's: `signin` mints a link
 * for a test member and for nobody else. The database lets that session decide only test traffic
 * (`app.authority_refusal`), so a suite that points it at something real is refused, which is the
 * property, not an inconvenience.
 *
 * It opens the link the way a click does and reads the session out of the redirect's fragment. The
 * provider allows one link per address per minute, so the session is minted once per process and
 * reused, and a throttled ask is retried and printed.
 */
import type { SqlExecutor } from '../../../src/db/executor.ts'
import { anOfficeMember, officeKey } from './sign-in.ts'

export type HarnessSession = {
  readonly access: string
  readonly refresh: string
  readonly email: string
}

const ORIGIN = 'https://ai-team-hq.vercel.app'
let held: HarnessSession | null = null

export async function harnessSession(db: SqlExecutor, ref: string): Promise<HarnessSession> {
  if (held !== null) return held
  const email = await anOfficeMember(db)
  const key = await officeKey(db)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const asked = await fetch(`https://${ref}.supabase.co/functions/v1/signin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: ORIGIN,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ action: 'link_for_operator', email, back: `${ORIGIN}/` }),
    })
    const body = (await asked.json().catch(() => ({}))) as { ok?: boolean; action_link?: string }
    if (body.ok !== true || typeof body.action_link !== 'string' || body.action_link === '') {
      throw new Error(`no sign-in link for the test member: http ${String(asked.status)}`)
    }
    const followed = await fetch(body.action_link, { redirect: 'manual' })
    const where = followed.headers.get('location') ?? ''
    const fragment = where.includes('#') ? where.slice(where.indexOf('#') + 1) : ''
    const q = new URLSearchParams(fragment)
    const access = q.get('access_token') ?? ''
    if (access !== '') {
      held = { access, refresh: q.get('refresh_token') ?? '', email }
      return held
    }
    if (attempt < 4) {
      console.log(
        `  (the provider did not issue a session, attempt ${String(attempt)}; waiting out its window)`,
      )
      await new Promise((ok) => setTimeout(ok, 65_000))
    }
  }
  throw new Error('the identity provider issued no session for the test member')
}

/** One gateway action as the test member. */
export async function actAsTestMember(
  db: SqlExecutor,
  ref: string,
  action: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const s = await harnessSession(db, ref)
  const r = await fetch(`https://${ref}.supabase.co/functions/v1/hq-api`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}
