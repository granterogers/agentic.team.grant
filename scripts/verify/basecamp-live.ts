/*
 * THE DEPLOYED PAGE, IN A REAL BROWSER, SIGNED IN TO THE REAL OFFICE.
 *
 * This is the leg every previous report had to mark "could not be verified
 * here". The reason was never a policy boundary: Chromium in this sandbox read
 * an EMPTY NSS trust store, so every request to a public origin died with
 * ERR_CERT_AUTHORITY_INVALID while the identical request from Node succeeded.
 * `npm run trust:proxy-ca` puts the sandbox's own CA where the browser looks,
 * with verification left on - a bad certificate is still refused - and this
 * suite is what that buys.
 *
 * WHAT ONLY THIS CAN SEE, and it is not a small list:
 *
 *  - CORS. CLAUDE.md records the voice call being dead for weeks while every
 *    probe passed, because a server-side fetch sends no `Origin` and therefore
 *    cannot detect a CORS misconfiguration. `voice-token` takes NO
 *    authentication, so its origin allowlist is the entire security boundary
 *    around a credential minted on Grant's OpenAI key. Only a browser at the
 *    real deployed origin can test it, and only against the DEPLOYED function.
 *  - Real assets over real TLS: the staff avatars and the document thumbnails
 *    come from private Supabase storage through signed URLs. A local capture
 *    has never once loaded one.
 *  - That signing in actually flips the page from the prototype to HIS office.
 *
 * SECRETS. The office token is read from the vault, typed into the page and
 * never printed, never written to a file and never put in a URL. The minted
 * voice credential is asserted on its SHAPE and its value is never read into a
 * variable that anything logs. Nothing here is committed but the code.
 *
 * SIDE EFFECTS. Reads only. Nothing is enqueued, nothing is written, no job is
 * created. One ephemeral voice credential is minted, which is what proves the
 * allowlist works, and it expires on its own.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const SITE =
  process.env.BASECAMP_SITE ?? 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)

const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
check('the office has a token in the vault', token !== '')
if (token === '') process.exit(1)

/* What HIS office actually holds, so "live" is checked against the office. */
const realProjects = (
  await db.execute(
    `select name from public.projects where status = 'active' and not is_fixture order by name`,
  )
).rows.map((r) => String((r as { name: string }).name))
check(
  'the office has real projects to recognise',
  realProjects.length > 0,
  String(realProjects.length),
)

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

/* --- 1. the deployed page is reachable, over real TLS -------------------- */

const landed = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 40000 })
check(
  `the deployed page answers at ${SITE}`,
  landed !== null && landed.status() < 400,
  landed === null ? 'no response' : `http ${String(landed.status())}`,
)
await page.waitForSelector('.bcpanes, .bchome, .bcmain', { timeout: 30000 })
await page.waitForTimeout(1200)

/* --- 2. without a token it says so, rather than inventing an office ------ */

const strip = await page
  .locator('.bcnotlive')
  .innerText()
  .catch(() => '')
check(
  'with no token the deployed page says it is showing the prototype',
  /prototype|sign in/i.test(strip),
  strip.replace(/\n/g, ' / ').slice(0, 120),
)

/* --- 3. signing in flips it to HIS office ------------------------------- */

/*
  WHAT THE PROTOTYPE SAYS, BEFORE ANY OF IT IS REAL.

  Read first, because the prototype has a project called "Legacy Coaching
  Course" and so does Grant's office - the first version of the check below
  looked for any real project name and passed while the page was still showing
  invented data. A name in BOTH lists proves nothing. The discriminator has to
  be a project the prototype cannot produce, and taking it from the page itself
  means it cannot go stale when either list changes.
*/
const inventedBody = (await page.evaluate(
  inPage(`return (document.body.innerText ?? '').replace(/\\s+/g, ' ')`),
)) as string
const onlyReal = realProjects.filter((n) => !inventedBody.includes(n))
check(
  'the office holds a project the prototype does not, to tell them apart by',
  onlyReal.length > 0,
  `real: ${realProjects.join(' | ')}`,
)

await page.locator('#bc-token').fill(token)
await page.locator('[data-bc-signin]').click()

/*
  WAIT FOR THE STRIP TO GO, NOT FOR A DURATION. Four seconds was enough against
  a local server and not against the real office, which fetches a studio
  payload and then a document for every thumbnail - so the first run reported a
  signed-in page still claiming to show invented projects, and the defect was
  the stopwatch.
*/
const wentLive = await page
  .waitForFunction("document.querySelector('.bcnotlive') === null", undefined, { timeout: 40000 })
  .then(() => true)
  .catch(() => false)
check(
  'signing in clears the prototype strip',
  wentLive,
  await page
    .locator('.bcnotlive')
    .innerText()
    .catch(() => '(gone)'),
)

await page.waitForTimeout(2500)

/*
  ON THE PAGE IT IS ACTUALLY SHOWING. The site opens on ONE project, so the
  other project names live in the switcher and are not in the document - the
  first version of this looked for them in the body and failed against a page
  that had gone live perfectly. What IS on this page is the project's own
  material, so the discriminator is a document title the office holds and the
  prototype does not.
*/
const realDocs = (
  await db.execute(
    `select d.title
       from public.documents d
       join public.projects p on p.project_id = d.project_id
      where p.status = 'active' and not p.is_fixture and d.state = 'approved'
      order by d.created_at desc
      limit 40`,
  )
).rows.map((r) => String((r as { title: string }).title))
const onlyRealDocs = realDocs.filter((t) => t.length > 8 && !inventedBody.includes(t))
check(
  'the office holds documents the prototype does not',
  onlyRealDocs.length > 0,
  `${String(realDocs.length)} real document title(s)`,
)

const body = (await page.evaluate(
  inPage(`return (document.body.innerText ?? '').replace(/\\s+/g, ' ')`),
)) as string
check(
  'and the page now shows material only the real office has',
  onlyReal.some((n) => body.includes(n)) || onlyRealDocs.some((t) => body.includes(t)),
  `looked for a project in [${onlyReal.join(' | ')}] or a document in [${onlyRealDocs.slice(0, 6).join(' | ')}]`,
)

/* --- 4. real assets, over real TLS, from private storage ---------------- */

/*
  The avatars are the thing that failed for the whole life of this branch. An
  `<img>` that 404s or is refused has `naturalWidth` 0, and a decoded one does
  not - which is the property, rather than counting the tags.
*/
await page.waitForTimeout(2500)
const imgs = (await page.evaluate(
  inPage(`const out = { total: 0, decoded: 0, broken: [] }
     for (const i of document.querySelectorAll('img')) {
       const src = i.currentSrc || i.src || ''
       if (!src.startsWith('http')) continue
       out.total += 1
       if (i.complete && i.naturalWidth > 0) out.decoded += 1
       else out.broken.push(src.slice(0, 90))
     }
     return out`),
)) as { total: number; decoded: number; broken: string[] }
check(
  'no remote image on the page is broken',
  imgs.broken.length === 0,
  `${String(imgs.decoded)}/${String(imgs.total)} decoded — ${imgs.broken.slice(0, 3).join(', ')}`,
)

/*
  AND WHAT THE OFFICE ACTUALLY HOLDS DECIDES WHAT CAN BE ASSERTED HERE.

  The first version demanded a painted thumbnail and reported "0 painted of 9"
  as a failure. It is not one: NOT ONE approved document in the live office has
  a file behind it - all of them are connector records from NotebookLM, Notion
  and uploads whose text lives in the row - so there is no first page to
  render and the drawn page is the correct answer. A check that demands
  something the data cannot supply is a check that will be switched off.

  So it asks the office first, and asserts the half that is true today: every
  tile drew SOMETHING, and the gateway really did answer for these documents
  over real TLS from this origin, which is the signed-URL path working as far
  as the data allows it to be exercised.
*/
const withFiles = Number(
  (
    await db.execute(
      `select count(*) as n
         from public.documents d
         join public.projects p on p.project_id = d.project_id
        where p.status = 'active' and not p.is_fixture and d.state = 'approved'
          and coalesce(d.storage_path, '') <> ''`,
    )
  ).rows[0]?.n ?? 0,
)

const painted = (await page.evaluate(
  inPage(`const tiles = [...document.querySelectorAll('[data-bc-thumb]')]
     return {
       tiles: tiles.length,
       real: tiles.filter((t) => t.classList.contains('has-real')).length,
       blank: tiles.filter((t) => t.querySelector('.bcpline, .bcglyph, .realpage') === null).length,
     }`),
)) as { tiles: number; real: number; blank: number }

check(
  'every document tile on the live page drew something',
  painted.tiles > 0 && painted.blank === 0,
  `${String(painted.tiles)} tile(s), ${String(painted.blank)} blank`,
)
if (withFiles > 0) {
  check(
    'a document thumbnail painted from a real signed URL out of private storage',
    painted.real > 0,
    `${String(painted.real)} painted of ${String(painted.tiles)}, with ${String(withFiles)} file-backed document(s) in the office`,
  )
} else {
  console.log(
    `note  the office holds NO approved document with a file behind it, so there is no first page to render and none of the ${String(painted.tiles)} tiles can paint one. Not a defect; the drawn page is the right answer.`,
  )
}

/*
  The gateway answering for a real document, from this origin, over real TLS.
  That is the half of the signed-URL path the data can exercise today.
*/
const asked = (await page.evaluate(
  inPage(`return fetch('https://${ref}.supabase.co/functions/v1/hq-api?section=studio', {
       headers: { Authorization: 'Bearer ' + (localStorage.getItem('hq.token') || '') },
     })
       .then((r) => r.status)
       .catch(() => 0)`),
)) as number
check(
  'the gateway answers this origin with the office token',
  asked === 200,
  `http ${String(asked)}`,
)

/* --- 5. CORS on the credential minter, from the real page origin -------- */

/*
  `voice-token` has no authentication, so this allowlist is the whole of the
  security around minting against Grant's OpenAI key. Run IN the page, so the
  browser sends the real `Origin` - which is the one thing a server-side probe
  can never do, and the reason this was dead for weeks the last time.

  The response is inspected for SHAPE. Its value is never returned to Node.
*/
const mint = (await page.evaluate(
  inPage(`return fetch('https://${ref}.supabase.co/functions/v1/voice-token', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ about: 'harness: origin allowlist check' }),
     })
       .then(async (r) => {
         try {
           const j = await r.json()
           /*
             The client secret comes back as a STRING here, not as the object
             the OpenAI documentation shows - reading a value property off it
             found nothing and reported a working minter as broken. No
             backticks in this comment: it is inside a template literal.
           */
           const secret = typeof j.client_secret === 'string' ? j.client_secret : (j.client_secret && j.client_secret.value) || ''
           return {
             ok: r.ok,
             status: r.status,
             keys: Object.keys(j || {}).sort().join(','),
             credential: typeof secret === 'string' && secret.length > 20,
             degraded: j.degraded === true,
           }
         } catch (e) {
           return { ok: false, status: r.status, keys: 'unreadable', credential: false, degraded: false }
         }
       })
       .catch((e) => ({ ok: false, status: 0, keys: String(e).slice(0, 90), credential: false, degraded: false }))`),
)) as { ok: boolean; status: number; keys: string; credential: boolean; degraded: boolean }

check(
  'the credential minter allows the real deployed origin (CORS)',
  mint.status !== 0,
  `a zero status is the browser refusing the response, which is what a CORS failure looks like: ${mint.keys}`,
)
/*
  ASKED AS FIELDS, NOT AS A STRING. The first version folded everything into
  one label and tested it with `includes('degraded')` - which matched the word
  in the KEY LIST rather than the flag, so a healthy mint read as a degraded
  one. A substring check satisfied by a superstring, which this repository
  already has a rule about.
*/
check(
  'and it mints a real credential for this page',
  mint.ok && mint.credential,
  `http ${String(mint.status)} — keys ${mint.keys}`,
)
check('and the minter is not answering in a degraded mode', !mint.degraded)

/* --- 6. and a stranger's origin is refused ------------------------------ */

/*
  THE CONTROL. An allowlist that lets everybody through would pass every check
  above. A page on another origin asks for the same thing, and must not get it.
*/
const other = await ctx.newPage()
await other.goto('https://example.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
const stranger = (await other.evaluate(
  inPage(`return fetch('https://${ref}.supabase.co/functions/v1/voice-token', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ about: 'harness: a stranger' }),
     })
       .then((r) => ({ reached: true, status: r.status }))
       .catch(() => ({ reached: false, status: 0 }))`),
)) as { reached: boolean; status: number }
check(
  'a page on another origin cannot mint one',
  !stranger.reached,
  `it got http ${String(stranger.status)} — the allowlist is not holding`,
)
await other.close()

/* --- 7. the chat path, from the real deployed origin --------------------- */

/*
  `verify:chat-live` already proves this endpoint over the network from Node.
  What Node cannot prove is that the DEPLOYED PAGE can reach it: a fetch from a
  script sends no Origin, and CORS is the failure this repository has paid for
  twice. So the same request is made from inside the page.

  NOTHING IS ENQUEUED. The office answers this kind of question from its own
  state and says so in `did` - the check asserts that, so a run of this suite
  can never leave work in Grant's queue, and the session id names the harness.
*/
const turn = (await page.evaluate(
  inPage(`return fetch('https://${ref}.supabase.co/functions/v1/voice/turn', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         Authorization: 'Bearer ' + (localStorage.getItem('hq.token') || ''),
       },
       body: JSON.stringify({ said: 'what projects have we got', session: 'verify-basecamp-live-' + Date.now() }),
     })
       .then(async (r) => {
         const j = await r.json().catch(() => ({}))
         return { status: r.status, did: String(j.did || ''), spoke: String(j.speak || '') }
       })
       .catch((e) => ({ status: 0, did: 'threw', spoke: String(e).slice(0, 90) }))`),
)) as { status: number; did: string; spoke: string }

check(
  'the office answers the deployed page over CORS',
  turn.status === 200,
  `http ${String(turn.status)} — ${turn.spoke.slice(0, 90)}`,
)
check('and the answer is a real sentence', turn.spoke.length > 20, turn.spoke.slice(0, 120))
check(
  'and it answered from its own state rather than starting work',
  turn.did === 'answered',
  turn.did,
)
check(
  'and it names a project that is really in the database',
  realProjects.some((n) => turn.spoke.includes(n)),
  `said: ${turn.spoke.slice(0, 140)}`,
)

/* --- 8. how a project looks, written through the real picker ------------- */

/*
  ITEM 9'S LAST GAP. Everything else about the appearance controls was verified
  against the prototype and against the office separately; what was never shown
  is a PRESS in the real picker changing the real row, because a browser here
  could not reach the office.

  THE SUBJECT IS THE TEST PROJECT, by name, and it is put back exactly as it
  was - read first, restored through the sanctioned writer afterwards, and the
  restore is asserted. Changing how one of Grant's projects looks and leaving
  it changed would be a suite redecorating his office.
*/
const SUBJECT = 'ai-team-hq-test'
const lookOf = async (): Promise<{ icon: string | null; hue: string | null }> => {
  const row = (
    await db.execute(
      `select icon, icon_hue from public.projects where slug = ${JSON.stringify(SUBJECT).replace(/"/g, "'")}`,
    )
  ).rows[0] as { icon: string | null; icon_hue: string | null } | undefined
  return { icon: row?.icon ?? null, hue: row?.icon_hue ?? null }
}

const was = await lookOf()
check(`the test project ${SUBJECT} is there to write to`, true, JSON.stringify(was))

await page.goto(`${SITE}/basecamp/p/${SUBJECT}`, { waitUntil: 'domcontentloaded', timeout: 40000 })
await page.waitForSelector('.bcpanes, .bcmain', { timeout: 30000 })
await page.waitForTimeout(2000)
await page.locator('[data-bc-pagemenu]').first().click()
await page.waitForTimeout(400)
await page.locator('[data-bc-look]').first().click()
await page.waitForSelector('#viewer [data-look-hue]', { timeout: 20000 })
await page.waitForTimeout(600)

const offered = (await page.evaluate(
  inPage(
    `return [...document.querySelectorAll('#viewer [data-look-hue]')].map((b) => b.dataset.lookHue)`,
  ),
)) as string[]
const pick = offered.find((h) => h !== was.hue) ?? ''
check(
  'the picker offers a colour this project is not already wearing',
  pick !== '',
  offered.join(','),
)

if (pick !== '') {
  await page.locator(`#viewer [data-look-hue="${pick}"]`).first().click()
  /*
    Poll the OFFICE, not the page. The page redraws optimistically - CLAUDE.md
    records a press that looked applied while the write never completed - so
    the row is what decides.
  */
  let stored: string | null = null
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(1000)
    stored = (await lookOf()).hue
    if (stored === pick) break
  }
  check(
    'pressing a colour in the real picker writes it to the office',
    stored === pick,
    `asked for ${pick}, the row says ${String(stored)}`,
  )

  /* And it is back exactly as it was, through the sanctioned writer. */
  if (was.hue === null) {
    await db.execute(`select app.hq_project_look('${SUBJECT}', null, null, null, array['hue'])`)
  } else {
    await db.execute(
      `select app.hq_project_look('${SUBJECT}', null, '${was.hue}', null, array[]::text[])`,
    )
  }
  const now = await lookOf()
  check(
    'and the suite puts the project back exactly as it found it',
    now.hue === was.hue && now.icon === was.icon,
    `was ${JSON.stringify(was)}, now ${JSON.stringify(now)}`,
  )
}

/* --- 9. and the token can be taken back out of the browser -------------- */

await page.evaluate(inPage(`try { localStorage.removeItem('hq.token') } catch {} return true`))
const gone = (await page.evaluate(inPage(`return localStorage.getItem('hq.token')`))) as
  | string
  | null
check('the office token can be removed from this browser again', gone === null)

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await ctx.clearCookies()
await browser.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed — subject: ${SITE}`)
process.exit(fail === 0 ? 0 : 1)
