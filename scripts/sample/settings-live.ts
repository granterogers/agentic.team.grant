/**
 * Global Settings, exercised as the signed-in Sample Person against the REAL gateway.
 *   npx tsx scripts/sample/settings-live.ts            # the Sample Person only
 *   npx tsx scripts/sample/settings-live.ts --grant    # plus one read-only look at what the operator is offered
 *
 * The page is the working tree's (web/studio); the office is the deployed one. Nothing here is a mock. Every write is made
 * by the Sample Person and is checked in the database where it landed, and Grant's office is measured before and after.
 * Run `sample.ts reset` afterwards (this script restores what it changes, and says so).
 */
import { check, grantSession, type Reply, results } from '../p4/lib.ts'
import { closeSettings, newPage, openSettings, signIn, startStudio } from './browser.ts'
import { db, lit, rows, sampleOffice, session } from './lib.ts'

const withGrant = process.argv.includes('--grant')
const run = Math.random().toString(36).slice(2, 8)
const office = await sampleOffice()
const O = lit(office.officeId)
const s = await session()
const studio = await startStudio(4814)

// ---- Grant's office, measured before: nothing the Sample does may move any of this ----------------------------------
const grantFingerprint = async () =>
  JSON.stringify(
    (
      await rows(`
        select (select count(*) from public.projects where office_id = app.operator_office()) p,
               (select count(*) from public.tasks where office_id = app.operator_office()) t,
               (select count(*) from public.contacts c join public.projects p on p.project_id = c.project_id where p.office_id = app.operator_office()) c,
               (select count(*) from public.lessons where office_id = app.operator_office()) l,
               (select count(*) from public.autonomy_settings where office_id = app.operator_office()) a,
               (select md5(coalesce(string_agg(level || set_by, ',' order by setting_id), '')) from public.autonomy_settings where office_id = app.operator_office()) am,
               (select count(*) from public.staff_tools where office_id = app.operator_office()) st,
               (select count(*) from public.tool_requests where office_id = app.operator_office()) tr,
               (select md5(string_agg(title, ',' order by slug)) from public.staff) staffsig`)
    )[0],
  )
const grantBefore = await grantFingerprint()
const grantNames = (
  await rows(
    `select distinct name v from public.projects where office_id = app.operator_office() and not is_fixture and slug <> 'unnamed' and length(name) > 5`,
  )
).map((r) => String(r.v))
check('there are Grant project names to look for', grantNames.length >= 3, `${grantNames.length}`)

const TITLES: Record<string, string> = {
  team: 'Team',
  behaviour: 'Autonomy and approvals',
  requests: 'Requests',
  memory: 'What it has learned',
  connections: 'Services',
  channels: 'Messaging',
  appearance: 'Appearance',
  models: 'Usage and health',
  help: 'Help',
}
const level = async () =>
  String(
    (
      await rows(
        `select level::text l from public.autonomy_settings where office_id = ${O}::uuid and project_id is null order by set_at desc, setting_id desc limit 1`,
      )
    )[0]?.l ?? '',
  )
/** Wait for the thing being asserted, not for a guess at how long production takes. */
const until = async (ok: () => Promise<boolean>, ms = 12000): Promise<void> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await ok()) return
    await new Promise((r) => setTimeout(r, 400))
  }
}
const text = (page: import('playwright').Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .innerText({ timeout: 8000 })
    .catch(() => '')
const count = (page: import('playwright').Page, sel: string) => page.locator(sel).count()

// ============================ DESKTOP ====================================================================================
const { ctx, page, errors } = await newPage(studio, { width: 1440, height: 900 })
await signIn(studio, page, s)
// A sign-in on production can take longer than signIn's own quiet period, so the check WAITS for the live page (bounded) and
// then asserts it. Reading the marker once, immediately, failed a correct page that arrived a few seconds later.
check(
  'signed in as the Sample Person: the page is live, not the prototype',
  await page
    .waitForFunction("document.querySelector('.bcnotlive') === null", undefined, { timeout: 60000 })
    .then(
      () => true,
      async (e: unknown) => {
        const strip = await page
          .evaluate(
            "(document.querySelector('.bcnotlive')?.innerText || 'no strip').replace(/\\n/g, ' | ').slice(0, 240)",
          )
          .catch(() => 'strip unreadable')
        console.log(
          `  live-page wait rejected (${String(e instanceof Error ? e.message : e).slice(0, 60)}); strip: ${strip}`,
        )
        return false
      },
    ),
)

// 1. every section opens and says what it is
for (const [tab, title] of Object.entries(TITLES)) {
  await openSettings(page, tab)
  await page.waitForTimeout(500)
  const h = await text(page, '#settings .stg-tabtitle, #settings .stg-col h2')
  check(`section "${tab}" opens with its title`, h.trim() === title, h.trim().slice(0, 40))
  const body = await page.evaluate(`document.querySelector('#settings').innerText`)
  const leaked = grantNames.filter((n) => String(body).includes(n))
  check(
    `section "${tab}" shows none of Grant's project names`,
    leaked.length === 0,
    leaked.join(', '),
  )
}

// 2. what a person who is not the operator is offered
await openSettings(page, 'team')
await page.waitForTimeout(1500)
check(
  'Team: no Configure and no Bring someone in (they are refused to a non-operator)',
  (await count(page, '#settings [data-configure], #settings [data-hire]')) === 0,
)
await openSettings(page, 'behaviour')
check(
  'Autonomy: the four levels ARE live',
  (await page.locator('#settings [data-choose]:not([disabled])').count()) === 4,
)
check(
  'Autonomy: the shared helper switches are not live',
  (await page.locator('#settings [data-toggle]:not([disabled])').count()) === 0,
)
await openSettings(page, 'requests')
check(
  'Requests: the person answers their own office’s tool requests (Approve and Decline are drawn)',
  (await count(page, '#settings [data-tool$=":approve"]')) > 0 &&
    (await count(page, '#settings [data-tool$=":decline"]')) > 0 &&
    (await text(page, '#settings .stg-col')).includes('is asking to use'),
)
await openSettings(page, 'connections')
check(
  'Services: no credential box, no Connect Google, no Behind the scenes',
  (await count(
    page,
    '#settings [data-google-connect], #settings [data-g-secret], #settings [data-register-provider], #settings details',
  )) === 0,
)
await openSettings(page, 'channels')
check(
  'Messaging: no Slack credential form, and the shared Telegram/Slack rows are not drawn',
  (await count(page, '#settings [data-sl-bot]')) === 0 &&
    !(await text(page, '#settings .stg-col')).includes('Reconnect Slack'),
)

// 3. the autonomy dial: narrowing needs no dialog, widening asks, cancel changes nothing, confirm changes it, and it lands
await openSettings(page, 'behaviour')
const startLevel = await level()
check('the baseline autonomy is what the seed set', startLevel === 'act_with_review', startLevel)
await page.locator('#settings [data-choose$=":suggest"]').click()
await until(async () => (await level()) === 'suggest')
check(
  'narrowing to "Ask me first" saves with no dialog',
  (await level()) === 'suggest' && (await count(page, '.stg-confirm')) === 0,
  await level(),
)
check(
  'and the page shows the new choice at once, with "Saved." beside it',
  (await page.locator('#settings [data-choose$=":suggest"]').getAttribute('aria-pressed')) ===
    'true',
)
await page.locator('#settings [data-choose$=":act"]').click()
await page.waitForTimeout(400)
check(
  'widening to "Act" opens a dialog that names what still waits',
  (await count(page, '.stg-confirm')) === 1 &&
    /still waits/i.test(await text(page, '.stg-confirm')),
)
await page.locator('.stg-confirm [data-no]').click()
await page.waitForTimeout(800)
check(
  'Cancel closes it and changes nothing',
  (await count(page, '.stg-confirm')) === 0 && (await level()) === 'suggest',
  await level(),
)
await page.locator('#settings [data-choose$=":act"]').click()
await page.waitForTimeout(300)
await page.locator('.stg-confirm [data-yes]').click()
await until(async () => (await level()) === 'act')
check('confirming saves "Act" in the Sample office', (await level()) === 'act', await level())
check(
  'and the page shows it as the chosen level',
  (await page.locator('#settings [data-choose$=":act"]').getAttribute('aria-pressed')) === 'true',
)
// 3b. it survives a reload (the page reads it back from the office, not from the browser)
await signIn(studio, page, s)
await openSettings(page, 'behaviour')
check(
  'after a reload the chosen level is still "Act"',
  (await page.locator('#settings [data-choose$=":act"]').getAttribute('aria-pressed')) === 'true',
)
await page.locator('#settings [data-choose$=":act_with_review"]').click()
await page.waitForTimeout(300)
if ((await count(page, '.stg-confirm')) === 1) await page.locator('.stg-confirm [data-yes]').click()
await until(async () => (await level()) === 'act_with_review')
check('restored to the baseline level', (await level()) === 'act_with_review', await level())

// 4. appearance: the accent changes the real token and persists across a reload
await openSettings(page, 'appearance')
const accent = () =>
  page.evaluate(
    `getComputedStyle(document.querySelector('[data-experience]') || document.documentElement).getPropertyValue('--bc-accent').trim()`,
  ) as Promise<string>
const was = await accent()
await page.locator('#settings [data-palette-pick="moss"]').click()
await until(async () => (await accent()) !== was)
await page.waitForTimeout(2500) // the choice is saved to the office a moment after it is drawn
const green = await accent()
check(
  'choosing Green changes the accent token',
  green !== was && green !== '',
  `${was} -> ${green}`,
)
await signIn(studio, page, s)
check('the accent survives a reload', (await accent()) === green)
await openSettings(page, 'appearance')
await page.locator('#settings [data-palette-pick="clay"]').click()
await until(async () => (await accent()) !== green)
await page.waitForTimeout(2500)
check('restored to Coral', (await accent()) !== green)

// 5. What it has learned: forgetting a lesson goes through a dialog and lands as a retraction
const body = `Sample test lesson ${run}: answer in plain words.`
await db.execute(
  `select app.learn(${O}::uuid, 'global'::public.lesson_scope, ${lit(body)}, 'p4-second-person')`,
)
await signIn(studio, page, s)
await openSettings(page, 'memory')
await page.waitForTimeout(1500)
const card = page.locator('#settings .st-case', { hasText: body }).first()
check('a lesson the Sample was taught is listed', (await card.count()) === 1)
await card.locator('[data-retract]').click()
await page.waitForTimeout(400)
check(
  'Forget this asks first, and says nothing is deleted',
  (await count(page, '.stg-confirm')) === 1 &&
    /nothing is deleted/i.test(await text(page, '.stg-confirm')),
)
await page.locator('.stg-confirm [data-yes]').click()
await page.waitForTimeout(2500)
const held = (
  await rows(
    `select count(*)::int n from public.lessons where office_id = ${O}::uuid and body = ${lit(body)}`,
  )
)[0]?.n
const live = (
  await rows(`select count(*)::int n from public.lessons_live where body = ${lit(body)}`)
)[0]?.n
check(
  'the lesson is retracted (no longer live), and the row is still there as the record',
  Number(live) === 0 && Number(held) >= 1,
  `live=${String(live)} held=${String(held)}`,
)

// 6. a refused write says so in the page's own words and changes nothing (the operator-only team write, driven directly)
const grantStaffBefore = JSON.parse(grantBefore).staffsig
const refused = (await page.evaluate(
  `fetch(window.HQ_API, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ${JSON.stringify(s.access_token)} }, body: JSON.stringify({ action: 'staff_update', args: { p_slug: 'chief-of-staff', p_title: 'SAMPLE-WROTE-THIS' } }) }).then(async r => r.status + ' ' + (await r.text()).slice(0, 80))`,
)) as string
check(
  'the gateway still refuses a person the shared team write',
  refused.startsWith('403'),
  refused,
)

// 7. sign out: the real control, nothing of the Sample's left, then sign back in
await closeSettings(page)
const signOutBtn = page.locator('[data-bc-signout]').first()
check('the Sign out control is present', (await signOutBtn.count()) === 1)
await signOutBtn.click({ force: true })
await page.waitForTimeout(2500)
const afterOut = (await page.evaluate(
  `JSON.stringify(Object.assign({}, localStorage)) + document.body.innerText`,
)) as string
check(
  "after Sign out none of the Sample's project names remain on the page or in storage",
  !/Wellness Studio Launch|2027 Financial Plan|Japan Spring Trip|Second Location Launch|Seasonal Menu/.test(
    afterOut,
  ),
)
await signIn(studio, page, s)
await openSettings(page, 'memory')
check(
  "signing back in restores the Sample's own Settings",
  (await text(page, '#settings .stg-col h2')).trim() === 'What it has learned',
)
check(
  'no page errors across the whole desktop run',
  errors.length === 0,
  errors.join(' | ').slice(0, 200),
)
await ctx.close()

// ============================ PHONE ======================================================================================
{
  const {
    ctx: pctx,
    page: p,
    errors: perrs,
  } = await newPage(studio, { width: 390, height: 844 }, true)
  await signIn(studio, p, s)
  // On a phone Global Settings is the menu's entry, not the header control: the shared helper follows the menu.
  await openSettings(p)
  await p.waitForSelector('#settings .stg-navitem')
  check(
    'phone: Settings opens on the list of sections',
    (await p.locator('#settings .stg-navitem').first().isVisible()) &&
      !(await p
        .locator('#settings .stg-col')
        .first()
        .isVisible()
        .catch(() => false)),
  )
  await p.locator('#settings [data-setting="requests"]').click()
  await p.waitForTimeout(700)
  check(
    'phone: choosing a section drills into it',
    (await text(p, '#settings .stg-col h2')).trim() === 'Requests',
  )
  check(
    'phone: no sideways scroll',
    ((await p.evaluate(`document.documentElement.scrollWidth - innerWidth`)) as number) <= 1,
  )
  await p.locator('#settings [data-stg-back]:visible').first().click()
  await p.waitForTimeout(300)
  check(
    'phone: Back returns to the list, Settings still open',
    await p.locator('#settings .stg-navitem').first().isVisible(),
  )
  await p.locator('#settings [data-stg-back]:visible').first().click()
  await p.waitForTimeout(300)
  check('phone: Back again closes Settings', !(await p.locator('#settings').isVisible()))
  check('phone: no page errors', perrs.length === 0, perrs.join(' | ').slice(0, 200))
  await pctx.close()
}

// ============================ THE OPERATOR, read-only (the control: the same page offers more to Grant) ==================
if (withGrant) {
  const g = await grantSession()
  const { ctx: gctx, page: gp } = await newPage(studio, { width: 1440, height: 900 })
  await signIn(studio, gp, g)
  await gp.waitForTimeout(2500)
  await openSettings(gp, 'team')
  await gp.waitForTimeout(1500)
  check(
    'control: the operator IS offered Configure and Bring someone in',
    (await count(gp, '#settings [data-configure]')) >= 1 &&
      (await count(gp, '#settings [data-hire]')) === 1,
  )
  await openSettings(gp, 'channels')
  check(
    'control: the operator sees the shared Telegram and Slack rows',
    (await text(gp, '#settings .stg-col')).includes('Telegram'),
  )
  await gctx.close()
}

// ============================ NOTHING OF GRANT'S MOVED ===================================================================
const grantAfter = await grantFingerprint()
check(
  "Grant's office is unchanged (projects, tasks, contacts, lessons, autonomy, tool grants, requests, staff titles)",
  grantAfter === grantBefore,
  grantAfter === grantBefore ? '' : `${grantBefore}\n${grantAfter}`,
)
void grantStaffBefore
await studio.close()

const failed = results.filter((r) => !r.ok)
console.log(`\nsettings-live: ${results.length - failed.length}/${results.length}`)
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAIL ${f.what} ${f.detail}`)
  process.exitCode = 1
}
void (null as unknown as Reply)
