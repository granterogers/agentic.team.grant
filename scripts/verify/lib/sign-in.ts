/**
 * Sign a browser in to the office, the way a person does.
 *
 * ## Why this exists in one place
 *
 * Three suites need a signed-in page and each had its own copy of the
 * ceremony. A row list built twice is a list that will disagree, and an
 * authentication ceremony copied three times is worse: two of the copies go
 * stale the day the flow changes and pass for the wrong reason.
 *
 * ## What it does, and what it deliberately does not fake
 *
 * It asks the office to PRODUCE the sign-in link rather than email it, using
 * the office key — the machine credential every deploy script already reads
 * from the vault, and one that already opens the whole gateway, so nothing is
 * escalated. Then it opens that link in the browser, exactly as clicking it in
 * the mail would, and lets the product's own redirect handling do the rest.
 *
 * So everything either side of the SMTP hop is genuinely exercised: the link
 * GoTrue built, the redirect, the fragment, the page adopting the session,
 * the gateway verifying it and the office's own allowlist. What is not
 * exercised is the mail arriving, and no suite may claim otherwise.
 *
 * It never writes a credential into the browser. §47: twenty-nine suites here
 * once wrote a made-up token into storage and passed only because Chromium
 * could not reach the office.
 */
import type { Page } from 'playwright'
import type { SqlExecutor } from '../../../src/db/executor.ts'

export type SignedIn = {
  readonly email: string
  /** Where the link pointed, so a caller can say which journey it drove. */
  readonly landedOn: string
}

/** The address the office answers to. Read from the office, never invented. */
export async function anOfficeMember(db: SqlExecutor): Promise<string> {
  const { rows } = await db.execute(
    `select email from public.office_members order by added_at, email limit 1`,
  )
  const email = String((rows[0] as { email?: string } | undefined)?.email ?? '')
  if (email === '') throw new Error('the office has no members, so nobody can sign in')
  return email
}

/** The office key, from the vault. Read, used, never printed. */
export async function officeKey(db: SqlExecutor): Promise<string> {
  const { rows } = await db.execute(
    `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
  )
  const key = String((rows[0] as { v?: string } | undefined)?.v ?? '')
  if (key === '') throw new Error('no hq.api_token in the vault')
  return key
}

/**
 * Put a signed-in session in this page.
 *
 * `back` is where the link should land — the same page a person would have
 * been on. The session arrives in the URL fragment and the product takes it
 * from there.
 */
export async function signIn(
  page: Page,
  db: SqlExecutor,
  { ref, origin, back }: { ref: string; origin: string; back: string },
): Promise<SignedIn> {
  const email = await anOfficeMember(db)
  const key = await officeKey(db)

  const asked = await fetch(`https://${ref}.supabase.co/functions/v1/signin`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: origin,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ action: 'link_for_operator', email, back }),
  })
  const body = (await asked.json().catch(() => ({}))) as {
    ok?: boolean
    action_link?: string
    detail?: string
  }
  if (body.ok !== true || typeof body.action_link !== 'string' || body.action_link === '') {
    throw new Error(`no sign-in link: http ${String(asked.status)} ${String(body.detail ?? '')}`)
  }

  /*
    Opening the link is the whole point: it is what the person's click does,
    and if the redirect target were wrong — the commonest way this breaks —
    this is the only thing that would notice.
  */
  await page.goto(body.action_link, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForFunction(
    "(() => { try { return (localStorage.getItem('hq.session') || '') !== '' } catch { return false } })()",
    undefined,
    { timeout: 40000 },
  )
  return { email, landedOn: page.url() }
}

/** Leave the browser as a stranger again, for the clean-context legs. */
export async function signOut(page: Page): Promise<void> {
  await page.evaluate(
    "(() => { try { localStorage.removeItem('hq.session'); localStorage.removeItem('hq.token') } catch { /* nothing to do */ } })()",
  )
}
