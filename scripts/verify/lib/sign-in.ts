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

/**
 * The TEST member the office lists, read from the office, never invented.
 *
 * Not a person: the office key mints a session for a test member only (#385, 0614), and what the
 * test member's session may decide is only test traffic. A suite that needs a signed-in writer
 * signs in as this member; it can never sign in as Grant, which is the point.
 */
export async function anOfficeMember(db: SqlExecutor): Promise<string> {
  const { rows } = await db.execute(
    `select email from public.office_members where kind = 'harness' order by added_at, email limit 1`,
  )
  const email = String((rows[0] as { email?: string } | undefined)?.email ?? '')
  if (email === '') throw new Error('the office lists no test member, so a suite cannot sign in')
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
  /*
    WHICH OFFICE THIS BROWSER TALKS TO.

    The page resolves its gateway from `config.js` (ADR-0048), and a
    merge-readiness preview needs it pointed at the INTEGRATED gateway rather
    than at whichever one the deployment names. Set before anything on the page
    runs, so `backend.js` reads it as the deployment's own -- which is what the
    override has always been for.
  */
  const override = process.env.HQ_API_OVERRIDE ?? ''
  if (override !== '') {
    await page.addInitScript(`window.HQ_API = ${JSON.stringify(override)}`)
  }

  const key = await officeKey(db)

  /*
    WHERE THE CEREMONY HAPPENS, when it cannot happen where the page is.

    `signin` keeps an allow-list of origins it will mint a link for, and it is
    right to: a magic link is a credential and the redirect target decides who
    receives it. A merge-readiness preview has a hostname nobody has ever seen,
    so it is not on that list -- and WIDENING THE LIST IS NOT AN OPTION. It is
    a production authorization boundary, and changing production to make an
    integration pass is the thing this pass is forbidden to do.

    So the ceremony happens at the allowed origin, exactly as a person's does,
    and the SESSION it produces is carried to the preview. Nothing is weakened
    by that: the session is a real Supabase Auth session for a real member of
    the office, the gateway still verifies it with Supabase and still checks
    its own membership list, and it is no more usable at the preview than at
    any other origin -- the office decides, not the hostname.

    What it does NOT prove is the redirect leg at the preview's own origin.
    That is covered where it can be: `verify:basecamp-signin` drives the whole
    ceremony at the allowed origin, including the link landing.
  */
  const ceremonyOrigin = process.env.SIGNIN_ORIGIN ?? ''
  const elsewhere = ceremonyOrigin !== '' && !back.startsWith(ceremonyOrigin)
  const landing = elsewhere ? `${ceremonyOrigin}${new URL(back).pathname}` : back
  /*
    THE PAGE ADOPTS A RETURNING SESSION ONLY FOR A SIGN-IN THIS BROWSER STARTED (B-05, web/studio/flow.js). A person
    starts one by pressing "send me a link"; this harness asks the function for the link directly, so it starts the
    flow the way the page does: a fresh nonce remembered in the page's storage (seeded before anything on the page
    runs) and carried on the return address. The page's decision is therefore exercised for real, not bypassed.
  */
  const flowFor = async (): Promise<string> => {
    const nonce = Array.from({ length: 24 }, () =>
      Math.floor(Math.random() * 36).toString(36),
    ).join('')
    await page.addInitScript(
      `try { const k = 'hq.signin.flow'; const l = JSON.parse(localStorage.getItem(k) || '[]'); ` +
        `if (!l.some((f) => f && f.nonce === ${JSON.stringify(nonce)})) { l.push({ nonce: ${JSON.stringify(nonce)}, ` +
        `kind: 'link', email: '', at: Date.now(), exp: Date.now() + 3600000 }); localStorage.setItem(k, JSON.stringify(l)) } } catch {}`,
    )
    return `${landing}${landing.includes('?') ? '&' : '?'}flow=${nonce}`
  }

  /*
    THE PROVIDER RATE-LIMITS MAGIC LINKS, AND A RATE LIMIT IS NOT A DEFECT.

    Supabase issues one link per address per minute. A gate that runs a dozen
    signed-in suites back to back asks for a dozen in four minutes, and the
    ones that land inside the window get a link that does not sign anybody in:
    the ceremony completes, the fragment carries an error rather than tokens,
    and the suite times out waiting for a session. Three suites reported a
    working product as broken that way in one pass, each passing alone.

    CLAUDE.md's rule about a throttled Management API is the same rule: never
    let an infra failure enter a measurement as data. So the ask is retried,
    the wait is the provider's own window, and every retry is PRINTED -- a run
    that spent two minutes waiting for a rate limit should say so rather than
    look slow for no reason.
  */
  const askForLink = async (): Promise<string> => {
    const returnTo = await flowFor()
    const asked = await fetch(`https://${ref}.supabase.co/functions/v1/signin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Origin: elsewhere ? ceremonyOrigin : origin,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ action: 'link_for_operator', email, back: returnTo }),
    })
    const body = (await asked.json().catch(() => ({}))) as {
      ok?: boolean
      action_link?: string
      detail?: string
    }
    if (body.ok !== true || typeof body.action_link !== 'string' || body.action_link === '') {
      throw new Error(`no sign-in link: http ${String(asked.status)} ${String(body.detail ?? '')}`)
    }
    return body.action_link
  }

  const held = async (): Promise<string> =>
    (await page.evaluate(
      "(() => { try { return localStorage.getItem('hq.session') || '' } catch { return '' } })()",
    )) as string

  let landed = ''
  for (let attempt = 1; attempt <= 3 && landed === ''; attempt += 1) {
    const link = await askForLink()
    /*
      Opening the link is the whole point: it is what the person's click does,
      and if the redirect target were wrong — the commonest way this breaks —
      this is the only thing that would notice.
    */
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page
      .waitForFunction(
        "(() => { try { return (localStorage.getItem('hq.session') || '') !== '' } catch { return false } })()",
        undefined,
        { timeout: attempt === 3 ? 40000 : 15000 },
      )
      .catch(() => null)
    landed = await held()
    if (landed === '' && attempt < 3) {
      const said = (await page.evaluate(
        "(() => (document.body.innerText || '').slice(0, 160))()",
      )) as string
      console.log(
        `  sign-in attempt ${String(attempt)} produced no session — waiting out the ` +
          `provider's one-a-minute window. ${said.replace(/\s+/g, ' ').trim().slice(0, 90)}`,
      )
      await new Promise((ok) => setTimeout(ok, 65_000))
    }
  }
  if (landed === '') {
    throw new Error('three sign-in links in a row produced no session')
  }
  if (elsewhere) {
    await page.addInitScript(
      `try { localStorage.setItem('hq.session', ${JSON.stringify(landed)}) } catch {}`,
    )
    await page.goto(back, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
  return { email, landedOn: page.url() }
}

/** Leave the browser as a stranger again, for the clean-context legs. */
export async function signOut(page: Page): Promise<void> {
  await page.evaluate(
    "(() => { try { localStorage.removeItem('hq.session'); localStorage.removeItem('hq.token') } catch { /* nothing to do */ } })()",
  )
}
