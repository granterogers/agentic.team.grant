/**
 * The whole new-person journey THROUGH THE PAGE, against the real gateway and database.
 *   npm run verify:account-ui [label]       screenshots land in .out/account-<label>/
 *
 * Two disposable people, one after the other, in one browser: arrive signed out -> Create account -> (the mailbox) ->
 * set up the office -> first-run -> create the first project -> reload -> sign out -> back to the entry screen ->
 * the next person. Then the isolation questions: the second person has none of the first person's data, the first
 * person's address cannot be reached by navigating to a project name, and the previous person never flashes onto the
 * next person's screen.
 *
 * What is REAL: the page, the gateway, the database, the office provisioning, the session (a genuine Supabase session
 * for a genuine auth user), sign-out, the browser storage clearing. What is REPLACED: the mailbox only. The link-sending
 * endpoint is answered by this harness (the page is served from 127.0.0.1, an origin the endpoint refuses by design, and
 * nobody should be emailed), and the session the emailed link would have produced is minted through the admin API.
 *
 * Disposable people only (`.invalid` addresses, a per-run token). Never Grant, never the canonical Sample Person.
 * Teardown retires both offices and bans both logins; an office is never deleted, so a disabled row remains.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { check, db, REF, results, SECOND_OFFICE } from '../p4/lib.ts'
import { apiKeys } from '../p4/provision-second-person.ts'

const label = process.argv[2] ?? 'now'
const out = `.out/account-${label}`
mkdirSync(out, { recursive: true })
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
const DOMAIN = 'lifecycle.agentic.invalid'
const PORT = 4794
// A real-looking host name, mapped to this machine in the browser only: the page treats a deployed host as deployed
// (it shows the entry screen to a stranger), and treats 127.0.0.1 as a developer's local server (it draws the prototype).
const HOST = 'hq-acceptance.test'
const BASE = `http://${HOST}:${PORT}`

const q = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const one = async (sql: string): Promise<string> => String((await q(sql))[0]?.v ?? '')
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
const keys = await apiKeys()

const admin = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`https://${REF}.supabase.co/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: keys.service,
      Authorization: `Bearer ${keys.service}`,
      'content-type': 'application/json',
    },
  })
const retrying = async <T>(what: string, f: () => Promise<T>): Promise<T> => {
  let last = ''
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await f()
    } catch (e) {
      last = e instanceof Error ? e.message.slice(0, 80) : String(e)
      await sleep(5000)
    }
  }
  throw new Error(`${what}: ${last}`)
}

type Person = {
  tag: string
  name: string
  email: string
  id: string
  project: string
  slug: string
}
const person = (tag: string, name: string, project: string): Person => ({
  tag,
  name,
  email: `p6ui-${tag}-${RUN}@${DOMAIN}`,
  id: '',
  project: `${project} ${RUN}`,
  slug: '',
})
const A = person('a', 'Alex Morgan', 'Garden Studio')
const B = person('b', 'Riley Chen', 'Pottery Fair')

/** The auth user as signing up leaves them (address not yet confirmed) and the session the link would carry. */
const mailbox = async (p: Person): Promise<{ access: string; refresh: string }> => {
  p.id = await retrying('create login', async () => {
    const res = await admin('/users', {
      method: 'POST',
      body: JSON.stringify({
        email: p.email,
        email_confirm: false,
        user_metadata: { purpose: 'p6-account-ui', run: RUN, disposable: true },
      }),
    })
    const b = (await res.json()) as { id?: string; msg?: string }
    if (!res.ok || b.id === undefined) throw new Error(`http ${res.status} ${b.msg ?? ''}`)
    return b.id
  })
  return await retrying('session', async () => {
    const gen = await admin('/generate_link', {
      method: 'POST',
      body: JSON.stringify({ type: 'magiclink', email: p.email }),
    })
    const g = (await gen.json()) as { hashed_token?: string }
    if (g.hashed_token === undefined) throw new Error('no link generated')
    const v = await fetch(`https://${REF}.supabase.co/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: keys.anon, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: g.hashed_token }),
    })
    const b = (await v.json()) as { access_token?: string; refresh_token?: string }
    if (b.access_token === undefined) throw new Error('no session')
    return { access: b.access_token, refresh: b.refresh_token ?? '' }
  })
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  try {
    const body = await readFile(
      join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, '')),
    )
    res.writeHead(200, {
      'content-type':
        TYPES[extname(path) === '' ? '.html' : extname(path)] ?? 'application/octet-stream',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not here')
  }
})
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()))

const grantOffice = await one('select app.operator_office()::text v')
const fingerprint = async (office: string): Promise<string> =>
  one(`select md5(concat_ws('|',
      (select count(*) from public.projects where office_id = '${office}'),
      (select string_agg(slug || status, ',' order by slug) from public.projects where office_id = '${office}'),
      (select count(*) from public.tasks where office_id = '${office}'),
      (select count(*) from public.documents where office_id = '${office}'))) v`)
// Jobs are left out on purpose: the live worker runs Grant's own duties, so his job count moves for reasons that are not ours.
const grantBefore = await fingerprint(grantOffice)

const FORBIDDEN = /tenant|workspace|organi[sz]ation|office[_ ]?id|supabase|basecamp/i
const errors: string[] = []
const sent: string[] = []

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.route(/\/functions\/v1\/signin/, async (route) => {
  const req = route.request()
  if (req.method() === 'OPTIONS')
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    })
  const body = JSON.parse(req.postData() ?? '{}') as { action?: string; email?: string }
  if (body.action === 'link') sent.push(String(body.email))
  // `whoami` and `refresh` are real calls the page makes with its own session: pass them through to nothing and
  // answer from the harness only for the link, so the real endpoint is never asked for an email.
  if (body.action === 'link')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, said: 'Check your email for a link to sign in.' }),
    })
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ ok: true, email: '' }),
  })
})
const page = await context.newPage()
page.on('pageerror', (e) => errors.push(e.message))

const text = async (p: Page): Promise<string> =>
  (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const shot = async (p: Page, name: string): Promise<void> => {
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: true })
}

/** Everything the browser holds that could be the last person's. */
const residue = async (p: Page): Promise<{ keys: string[]; dbs: number; caches: number }> =>
  (await p.evaluate(`(async () => ({
    keys: Object.keys(localStorage).concat(Object.keys(sessionStorage)),
    // Databases the page re-opens empty at boot are not residue; records in them would be.
    dbs: await (async () => {
      let n = 0
      for (const d of (await indexedDB.databases?.()) ?? []) {
        const db = await new Promise((ok, no) => { const r = indexedDB.open(d.name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
        for (const s of Array.from(db.objectStoreNames)) {
          n += await new Promise((ok) => { const c = db.transaction(s).objectStore(s).count(); c.onsuccess = () => ok(c.result); c.onerror = () => ok(0) })
        }
        db.close()
      }
      return n
    })(),
    caches: typeof caches === 'undefined' ? 0 : (await caches.keys()).length,
  }))()`)) as { keys: string[]; dbs: number; caches: number }

const journey = async (p: Person, other: Person | null): Promise<void> => {
  const t = p.tag
  console.log(`\n--- person ${t.toUpperCase()} (${p.email.slice(0, 10)}…) ---`)

  // 1. Arrive signed out.
  await page.goto('about:blank')
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcentrycard', { timeout: 20000 })
  check(
    `${t}: arriving signed out shows the entry screen, not a project or a debug strip`,
    (await page.locator('.bcentrycard').count()) === 1 &&
      (await page.locator('.bcmain, .bctop').count()) === 0,
  )
  check(
    `${t}: nothing of anybody's is on the page`,
    other === null || !(await text(page)).includes(other.project),
  )

  // 2. Create account (the form; the mailbox is the harness).
  await page.locator('[data-bc-entry-tab="create"]').click()
  await page.fill('#bc-entry-name', p.name)
  await page.fill('#bc-entry-email-new', p.email)
  await page.locator('[data-bc-entry-form="create"] button[type=submit]').click()
  await page.waitForSelector('.bcentrysent', { timeout: 10000 })
  check(
    `${t}: Create account asked for a link for exactly that address`,
    sent.at(-1) === p.email,
    String(sent.at(-1)),
  )
  await shot(page, `${t}-1-sent`)

  // 3. The mailbox: the link comes back with a verified session.
  const mail = await mailbox(p)
  await page.goto('about:blank')
  await page.goto(
    `${BASE}/#access_token=${mail.access}&refresh_token=${mail.refresh}&expires_in=3600&token_type=bearer`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForSelector('[data-bc-setup-form]', { timeout: 30000 })
  const setup = await page.locator('.bcentrycard').innerText()
  check(
    `${t}: the link lands on the set-up screen, in plain words`,
    /set up your office/i.test(setup) && !FORBIDDEN.test(setup),
  )
  check(`${t}: the address is not left in the address bar`, !page.url().includes('access_token'))
  check(
    `${t}: the name typed at sign-up is already there`,
    (await page.inputValue('#bc-setup-name')) === p.name,
  )
  check(
    `${t}: no office exists yet (nothing is made until the person presses the button)`,
    (await one(`select count(*) v from public.offices where auth_user_id = '${p.id}'`)) === '0',
  )
  await shot(page, `${t}-2-setup`)

  // 4. Create the office, once.
  await page.locator('[data-bc-setup-form] button[type=submit]').click()
  try {
    await page.waitForSelector('.bcfirst', { timeout: 40000 })
  } catch (e) {
    // Say what the page said: a timeout alone does not tell a refusal from a hang.
    console.log(`  (set-up did not finish: "${(await text(page)).slice(0, 200)}")`)
    await shot(page, `${t}-2-setup-stuck`)
    throw e
  }
  check(
    `${t}: exactly one private office now exists for this login`,
    (await one(
      `select count(*) v from public.offices where auth_user_id = '${p.id}' and kind = 'person' and state = 'active'`,
    )) === '1',
  )
  const office = await one(
    `select office_id::text v from public.offices where auth_user_id = '${p.id}'`,
  )
  check(
    `${t}: its owner key comes from the login, not the address`,
    (
      await one(`select owner_key v from public.office_members where lower(email) = '${p.email}'`)
    ).startsWith('u-'),
  )
  check(
    `${t}: it is not Grant's office and not the Sample's`,
    office !== grantOffice && office !== SECOND_OFFICE,
  )
  const first = await text(page)
  check(
    `${t}: first run says where you are, what to do first and where things live`,
    /your office is ready/i.test(first) &&
      /create your first project/i.test(first) &&
      /where things live/i.test(first) &&
      /your team/i.test(first),
    '',
  )
  check(
    `${t}: and has no invented projects, no other person's data, no technical nouns`,
    !FORBIDDEN.test(first) &&
      (other === null || !first.includes(other.project)) &&
      (await page.locator('.bcgrid--projects').count()) === 0,
  )
  await shot(page, `${t}-3-first-run`)

  // 5. The first project, through the form.
  await page.locator('[data-bc-newproject-form] button[type=submit]').click()
  check(
    `${t}: submitting an empty project says a name is needed`,
    /needs a name/i.test(await page.locator('[data-bc-newproject-said]').innerText()),
  )
  await page.fill('#bc-newproject-name', p.project)
  await page.locator('[data-bc-newproject-form] button[type=submit]').click()
  await page.waitForURL(/\/p\//, { timeout: 40000 })
  p.slug = new URL(page.url()).pathname.split('/')[2] ?? ''
  await page.waitForTimeout(1200)
  check(
    `${t}: creating the project opens it`,
    (await text(page)).includes(p.project),
    page.url().replace(BASE, ''),
  )
  check(
    `${t}: the project belongs to this person's office`,
    (await one(
      `select count(*) v from public.projects where name = '${p.project}' and office_id = '${office}'`,
    )) === '1',
  )
  await shot(page, `${t}-4-project`)

  // 6. It persists across a reload.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check(
    `${t}: after a reload the project is still there and the person is still signed in`,
    (await text(page)).includes(p.project) &&
      (await page.locator('[data-bc-signout]').count()) === 1,
  )
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcgrid--projects', { timeout: 20000 })
  const shown = (await page.locator('.bcgrid--projects').innerText()).replace(/\s+/g, ' ')
  check(
    `${t}: the portfolio lists this person's project and nobody else's`,
    shown.includes(p.project) && (other === null || !shown.includes(other.project)),
    shown.slice(0, 80),
  )
  await shot(page, `${t}-5-portfolio`)

  // 7. Foreign names do not resolve.
  if (other !== null) {
    await page.goto(`${BASE}/p/${other.slug}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2500)
    const body = await text(page)
    check(
      `${t}: the other person's project address opens nothing of theirs`,
      !body.includes(other.project),
      body.slice(0, 80),
    )
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.bcgrid--projects', { timeout: 20000 })
  }

  // 8. Sign out.
  await page.locator('[data-bc-signout]').click()
  await page.waitForSelector('.bcentrycard', { timeout: 30000 })
  const left = await residue(page)
  check(
    `${t}: after sign out the entry screen is back`,
    (await page.locator('.bcentrycard').count()) === 1,
  )
  check(
    `${t}: nothing of the person is left in the browser`,
    !left.keys.some((k) => /session|token|chat|task|bc\.|hq\.(?!welcome)/.test(k)) &&
      left.dbs === 0 &&
      left.caches === 0,
    `${left.keys.join(',')} dbs=${left.dbs} caches=${left.caches}`,
  )
  const after = await text(page)
  check(`${t}: the page no longer shows their project`, !after.includes(p.project))
  // Back, and the authenticated address typed in directly: neither brings the project back.
  await page.goBack().catch(() => undefined)
  await page.waitForTimeout(1500)
  check(
    `${t}: Back does not reopen their work`,
    !(await text(page)).includes(p.project) && (await page.locator('.bcentrycard').count()) === 1,
  )
  await page.goto(`${BASE}/p/${p.slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  check(
    `${t}: opening their project address signed out shows the entry screen`,
    (await page.locator('.bcentrycard').count()) === 1 && !(await text(page)).includes(p.project),
  )
  await shot(page, `${t}-6-signed-out`)
}

try {
  await journey(A, null)
  await journey(B, A)

  // The two offices are different, disjoint, and neither is a fixture of the other.
  const oa = await one(
    `select office_id::text v from public.offices where auth_user_id = '${A.id}'`,
  )
  const ob = await one(
    `select office_id::text v from public.offices where auth_user_id = '${B.id}'`,
  )
  check('two people made two different offices', oa !== '' && ob !== '' && oa !== ob)
  check(
    "A's office holds only A's project and B's only B's",
    (await one(
      `select count(*) v from public.projects where office_id = '${oa}' and name = '${B.project}'`,
    )) === '0' &&
      (await one(
        `select count(*) v from public.projects where office_id = '${ob}' and name = '${A.project}'`,
      )) === '0',
  )
  check(
    "neither office received a copy of the Sample Person's projects",
    (await one(
      `select count(*) v from public.projects where office_id in ('${oa}','${ob}') and name in (select name from public.projects where office_id = '${SECOND_OFFICE}' and slug <> 'unnamed')`,
    )) === '0',
  )
  check('no page errors in either journey', errors.length === 0, errors.join('; ').slice(0, 160))
} finally {
  console.log('\nteardown')
  const ids = [A.id, B.id].filter((i) => i !== '')
  const idList = ids.map((i) => `'${i}'`).join(',') || "''"
  for (const s of (
    await q(
      `select p.slug from public.projects p join public.offices o on o.office_id = p.office_id where p.slug <> 'unnamed' and o.auth_user_id in (${idList})`,
    ).catch(() => [])
  ).map((r) => String(r.slug))) {
    await q(`select app.project_delete('${s}', false)::text as v`).catch(() => undefined)
  }
  for (const r of await q(
    `select office_id::text id from public.offices where auth_user_id in (${idList})`,
  ).catch(() => [])) {
    const id = String(r.id)
    if (id === grantOffice || id === SECOND_OFFICE) {
      check("REFUSED to retire an office that is Grant's or the Sample's", false)
      continue
    }
    await q(`select app.retire_person_office('${id}'::uuid) v`).catch(() => undefined)
  }
  for (const id of ids) {
    const d = await admin(`/users/${id}`, { method: 'DELETE' }).catch(() => null)
    if (d === null || !d.ok)
      await admin(`/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ban_duration: '876000h' }),
      }).catch(() => undefined)
  }
  check(
    'teardown left no ACTIVE office for either person',
    (await one(
      `select count(*) v from public.offices where auth_user_id in (${idList}) and state = 'active'`,
    )) === '0',
  )
  check(
    "Grant's office is byte-for-byte unchanged",
    (await fingerprint(grantOffice)) === grantBefore,
  )
  // Not a fingerprint: the Sample is also being reseeded by other work. What matters is that nothing of THIS run reached it.
  check(
    'nothing from this run reached the Sample Person’s office',
    (await one(
      `select count(*) v from public.projects where office_id = '${SECOND_OFFICE}' and name like '%${RUN}%'`,
    )) === '0',
  )
  await browser.close()
  server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(
  `\naccount-ui: ${results.length - failed.length}/${results.length}  (captures in ${out})`,
)
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAIL ${f.what} ${f.detail}`)
  process.exitCode = 1
}
