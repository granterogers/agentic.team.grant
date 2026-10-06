/**
 * The Sample Office's showcase, walked as a visitor, on the deployed page: logged out, Explore, then every major surface, on a
 * desktop and on a phone. No model call: it reads and presses, and the only writes it makes are the ones the gateway must refuse.
 *
 *   npm run sample:public-showcase-ui -- [--page=https://ai-team-hq.vercel.app] [--only=desktop|phone]
 *
 * It asserts the things a screenshot cannot: no content from another office or from the prototype, no raw code or "[object Object]",
 * no page error, no refused READ, and that each surface actually holds what the showcase put there. A control that is refused for
 * a visitor must answer in a sentence. Run `npm run trust:proxy-ca` first in a sandbox. Each half is a long walk (every surface is
 * a full page load against a small host): run one half per call, and never while the platform is unhealthy.
 */
import '../../src/safety/require-production-checks.ts'
import { chromium, type Page } from 'playwright'

const PAGE =
  process.argv.find((a) => a.startsWith('--page='))?.slice(7) ?? 'https://ai-team-hq.vercel.app'
// Names that must never appear: another office, the prototype's invented projects, internals, and a lost value.
const FORBIDDEN = [
  /Grant Rogers/i,
  /Legacy/i,
  /\[object Object\]/,
  /sample_readonly/,
  /guest_only/,
  /\bundefined\b/,
  /\bfixture\b/i,
  /verify-/i,
  /\bnull\b/,
]
let failures = 0
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

const run = async (label: string, phone: boolean): Promise<void> => {
  console.log(`\n== ${label}`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1440, height: 900 } },
  )
  const page: Page = await ctx.newPage()
  const errors: string[] = []
  const refusedReads: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)))
  page.on('response', (r) => {
    if (r.url().includes('/functions/v1/') && r.request().method() === 'GET' && r.status() >= 400)
      refusedReads.push(`${r.status()} ${new URL(r.url()).search.slice(0, 60)}`)
  })
  const text = async (): Promise<string> =>
    (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  // A surface is loaded again (twice at most) until it holds what it should: from the build sandbox a read can outlast the page's
  // ten-second deadline, and what is asserted is the product, not the weather. Every extra load is printed.
  const go = async (path: string, waitFor?: string, expect?: RegExp): Promise<string> => {
    let t = ''
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      t = await load(path, waitFor)
      if (expect === undefined || expect.test(t)) return t
      console.log(
        `     (${path} did not hold what it should yet; loading it again, attempt ${String(attempt + 1)})`,
      )
    }
    return t
  }
  const load = async (path: string, waitFor?: string): Promise<string> => {
    await page.goto(`${PAGE}${path}`, { waitUntil: 'domcontentloaded' })
    if (waitFor !== undefined)
      await page
        .waitForFunction(
          `(document.body.innerText||'').includes(${JSON.stringify(waitFor)})`,
          undefined,
          { timeout: 45000 },
        )
        .catch(() => null)
    else {
      // Wait for the page to hold something beyond its frame (the header and the three-link footer), not for a fixed pause.
      await page
        .waitForFunction("(document.body.innerText||'').length > 420", undefined, {
          timeout: 20000,
        })
        .catch(() => null)
      await page.waitForTimeout(2500)
    }
    // From the build sandbox the studio read is sometimes slower than the page's ten-second deadline, and the page then says
    // so (and offers Try again). That is the page working, so it is pressed once rather than counted as a failed surface.
    if (/could not be loaded|did not answer/.test(await text())) {
      await page
        .locator('[data-bc-retry-office]')
        .first()
        .click()
        .catch(() => null)
      await page
        .waitForFunction(
          "(document.body.innerText||'').length > 420 && !/could not be loaded/.test(document.body.innerText)",
          undefined,
          { timeout: 30000 },
        )
        .catch(() => null)
      await page.waitForTimeout(2500)
    }
    return text()
  }
  const clean = (t: string, where: string): void => {
    const bad = FORBIDDEN.filter((f) => f.test(t)).map(String)
    check(
      bad.length === 0,
      `${where}: nothing from another office, the prototype or the plumbing${bad.length > 0 ? ` (${bad.join(' ')})` : ''}`,
    )
  }
  const noOverflow = async (where: string): Promise<void> => {
    const wide = await page.evaluate(
      'document.documentElement.scrollWidth > document.documentElement.clientWidth + 1',
    )
    check(!wide, `${where}: no sideways scroll`)
  }

  // Logged out, then in.
  const first = await go('/', 'Explore the Sample Office')
  check(
    first.includes('Explore the Sample Office'),
    'logged out: the way into the Sample is on the first screen',
  )
  // Entering asks the sign-in function for a session. From the build sandbox the proxy sometimes cuts a transfer off, so a
  // press that shows no banner is repeated on a fresh load (twice), and the attempts are counted in the report.
  let entered = false
  for (let attempt = 1; attempt <= 3 && !entered; attempt += 1) {
    if (attempt > 1) {
      console.log(`     (entering again: attempt ${String(attempt)})`)
      await go('/', 'Explore the Sample Office')
    }
    await page.locator('[data-bc-sample-start]').click()
    entered = await page
      .waitForFunction(
        "document.querySelector('.bcsamplebar') !== null && (document.body.innerText||'').includes('Riverside')",
        undefined,
        { timeout: 45000 },
      )
      .then(() => true)
      .catch(() => false)
  }
  check(entered, 'Explore opens the Sample Office with its banner')
  if (!entered) throw new Error('could not enter the Sample')
  await page.waitForTimeout(2500)
  const home = await text()
  for (const n of ['Riverside Café Launch', 'Autumn Menu Research', 'Winter Market Pop-up'])
    check(home.includes(n), `home: ${n}`)
  clean(home, 'home')
  await noOverflow('home')

  // Each project: its to-dos, documents, contacts, sources, team and activity hold something.
  for (const slug of ['riverside-caf-launch', 'autumn-menu-research', 'winter-market-pop-up']) {
    // Every project is opened on its to-dos, documents and people; Sources and Activity are walked on the project that holds the most.
    const tools = [
      ['board', /not started|in progress|done/i],
      ['documents', /\.(md|csv|pdf)|report|brief|summary/i],
      ['contacts', /@|\+44|Nair|Webb|Harvest|Priya|Hannah/i],
    ] as const
    const more =
      slug === 'riverside-caf-launch'
        ? ([
            ['sources', /./],
            ['activity', /./],
          ] as const)
        : ([] as const)
    for (const [tool, expect] of [...tools, ...more]) {
      const t = await go(`/p/${slug}/${tool}`, undefined, expect)
      check(expect.test(t) && t.length > 250, `${slug}/${tool}: shows content`)
      clean(t, `${slug}/${tool}`)
    }
  }
  await noOverflow('a project page')

  // The gateway's own refusal, polled for anywhere on the page (a toast or an inline line), never the standing Sample notice.
  const refused = () =>
    page
      .waitForFunction(
        "/sample office, so changes are not saved/.test((document.body.innerText||'').replace(/\\s+/g,' '))",
        undefined,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false)
  const press = (sel: string) =>
    page
      .locator(sel)
      .first()
      .click({ timeout: 8000, force: true })
      .then(() => true)
      .catch(() => false)

  // A contact: Save changes and Remove contact (two presses) are refused in a sentence and the contact is still there.
  const crm = await go(
    '/p/riverside-caf-launch/contacts',
    undefined,
    /@|\+44|Nair|Webb|Harvest|Priya|Hannah/i,
  )
  const contactName = /(Nair|Webb|Harvest|Priya|Hannah)/i.exec(crm)?.[1] ?? ''
  const opened = await press('[data-bc-contact]')
  await page.waitForSelector('[data-bc-contact-save]', { timeout: 8000 }).catch(() => null)
  check(
    opened && (await page.locator('[data-bc-contact-save]').count()) > 0,
    'Contact: opens with Save changes and Remove contact',
  )
  let saveSaid = false
  for (let n = 0; n < 3 && !saveSaid; n++) {
    await press('[data-bc-contact-save]')
    saveSaid = await refused()
  }
  check(saveSaid, 'Contact: Save changes is refused in a sentence, and saves nothing')
  await press('[data-bc-contact-away]')
  await page.waitForTimeout(400)
  await press('[data-bc-contact-away]')
  await page.waitForTimeout(2500)
  const afterRemove = await go('/p/riverside-caf-launch/contacts', undefined, /./)
  check(
    contactName !== '' && afterRemove.includes(contactName),
    `Contact: Remove is refused and the contact is still listed (${contactName})`,
  )

  // Project Settings > Automations: setting one going is refused in a sentence and the existing automation is unchanged.
  const sett = await go('/p/riverside-caf-launch/settings', undefined, /Team|Automations/)
  check(/Automations/.test(sett), 'Project Settings: opens with Automations')
  await press('[data-setpane="automations"]')
  await page.waitForSelector('[data-auto-what]', { timeout: 10000 }).catch(() => null)
  const autoBefore =
    (await page.locator('[data-auto-set]').count()) +
    (await page.locator('[data-auto-remove]').count())
  await page
    .locator('[data-auto-what]')
    .first()
    .fill('Tell me every Friday how the week went')
    .catch(() => null)
  // A forced press can land just before a redraw and do nothing (the studio never stops moving): refill and press again, up to three times.
  let autoSaid = false
  for (let n = 0; n < 3 && !autoSaid; n++) {
    await page
      .locator('[data-auto-what]')
      .first()
      .fill('Tell me every Friday how the week went')
      .catch(() => null)
    await press('[data-auto-add]')
    autoSaid = await refused()
  }
  check(autoSaid, 'Automations: Set it going is refused in a sentence')
  const autoAfter =
    (await page.locator('[data-auto-set]').count()) +
    (await page.locator('[data-auto-remove]').count())
  check(
    autoAfter === autoBefore,
    `Automations: nothing was added (${autoBefore} controls before, ${autoAfter} after)`,
  )
  clean(
    (await page.locator('body').innerText()).replace(/\s+/g, ' '),
    'Project Settings (Automations)',
  )

  // My Tasks names the project of a task as a name, not an object.
  const mine = await go('/tasks', 'Gareth Webb', /Riverside Café Launch/)
  check(
    /Gareth Webb/.test(mine) && /Riverside Café Launch/.test(mine) && /overdue/.test(mine),
    'My Tasks: dated work, an overdue item, and the project named',
  )
  clean(mine, 'My Tasks')

  // The Agentic Team tool: made work, listed with who made it. (A pending review is not demonstrated here: the product accepts
  // what its own handlers make, so nothing is left to decide. See the capability matrix.)
  const team = await go(
    '/p/winter-market-pop-up/team',
    'Winter Market Stall Costs Report',
    /Stall Costs Report/,
  )
  check(
    /Winter Market Stall Costs Report/.test(team) && /Oliver/.test(team),
    'Agentic Team (Winter): the costs report and the caption are listed as made work',
  )
  check(
    !/google\.com|drive\.google/i.test(team),
    'Agentic Team (Winter): no claim of an upload nothing made',
  )
  clean(team, 'Agentic Team (Winter)')
  const rteam = await go(
    '/p/riverside-caf-launch/team',
    'Report',
    /What the team has made[\s\S]*Report/,
  )
  check(/Report/.test(rteam) && /made/.test(rteam), 'Agentic Team (Riverside): a made report')
  clean(rteam, 'Agentic Team (Riverside)')
  const wchat = await go('/p/winter-market-pop-up/chat', 'Winter')
  check(
    !/drive\.google|uploaded it to Drive/i.test(wchat),
    'Chat (Winter): the thread that claimed a Drive upload is not shown',
  )

  // Chat: the seeded conversation is there, in the team's words, with no invented prototype thread.
  const chat = await go('/p/riverside-caf-launch/chat', 'Daniel', /88,000/)
  check(
    /Daniel|Grace|Claire/.test(chat) && /£88,000|88,000/.test(chat),
    'Chat: the seeded delegation is readable',
  )
  clean(chat, 'Chat')

  // Search and the command bar.
  const search = await go('/search')
  check(search.length > 200, 'Search: opens')
  await page.locator('input:visible').first().fill('espresso')
  await page.locator('input:visible').first().press('Enter')
  await page.waitForTimeout(3500)
  check(/Order the espresso machine/.test(await text()), 'Search: finds a task by a word in it')
  await go('/', 'Autumn Menu Research')
  await page.keyboard.press('Shift+J')
  await page.keyboard.type('Winter')
  await page.waitForTimeout(1500)
  // The bar lists matches in its own dialog; "Winter Market Pop-up" is also on the home, so the dialog is what is read.
  const bar = (
    await page
      .locator('#bcjumplist')
      .innerText({ timeout: 8000 })
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check(
    /Winter Market Pop-up/.test(bar),
    `Command bar: typing a project name lists it (${bar.slice(0, 80) || 'no results list'})`,
  )
  await page.keyboard.press('Escape')

  // A document opens.
  await go('/p/riverside-caf-launch/documents')
  const popup = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null)
  await page.getByText('Mill Street lease summary.md').first().click()
  const tab = await popup
  check(tab !== null, 'Documents: a document opens in its own tab')
  if (tab !== null) {
    await tab.waitForLoadState('domcontentloaded').catch(() => null)
    await tab.waitForTimeout(2500)
    // What the tab was sent is read directly: a signed link served with the wrong type downloads or prints mojibake.
    await tab.waitForURL(/^https?:/, { timeout: 40000 }).catch(() => null)
    const served = await ctx.request.get(tab.url()).catch(() => null)
    const body = served === null ? '' : await served.text()
    const kind = served?.headers()['content-type'] ?? 'none'
    check(
      served !== null && /text\//.test(kind) && /ten years/i.test(body),
      `Documents: the opened note is served as text and reads correctly (${kind}, ${tab.url().slice(0, 60)}, ${String(body.length)} chars)`,
    )
    await tab.close()
  }

  // Settings: nothing is connected, nothing pretends to be, and a refused change says why in a sentence.
  await go('/?settings=connections', 'Not connected')
  await page.waitForSelector('#settings', { timeout: 20000 }).catch(() => null)
  const services = (
    await page
      .locator('#settings')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  // On a phone Settings is two panes: a deep link opens the detail pane, and the heading (with the Sample line) belongs to the
  // index pane, which the back control reaches. A desktop shows both at once.
  const backToIndex = async (): Promise<void> => {
    if (!phone) return
    if (
      (await page
        .locator('#settings [data-setting="behaviour"]')
        .first()
        .isVisible()
        .catch(() => false)) === true
    )
      return
    await page
      .locator('#settings [data-stg-back]')
      .first()
      .click({ force: true })
      .catch(() => null)
    await page.waitForTimeout(1200)
  }
  await backToIndex()
  const indexText = (
    await page
      .locator('#settings')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ')
  check(/Sample Office/.test(indexText), 'Settings: it says this is the Sample')
  check(
    /Not connected/.test(services) &&
      !/\bConnected\b(?! by)/.test(services.replace(/Connected by whoever/g, '')),
    'Settings: services are honestly not connected',
  )
  clean(services, 'Settings (Services)')
  // Only connections, channels and health deep-link; the rest are opened by pressing their name, as a person does.
  const settingsTab = async (name: string, marker?: string): Promise<string> => {
    await backToIndex()
    await page.waitForSelector('#settings [data-setting]', { timeout: 20000 }).catch(() => null)
    let why = ''
    let clicked = false
    let arrived = marker === undefined
    // Pressed again (twice at most) if the pane did not change: a redraw that lands just after a press can replace the node the
    // press went to, which is the studio's own behaviour and not something to report as a dead control on the first miss.
    for (let attempt = 1; attempt <= 3 && !arrived; attempt += 1) {
      clicked = await page
        .locator(`#settings [data-setting="${name}"]`)
        .first()
        // force: the studio never stops moving, so Playwright's "element is not stable" check can never pass inside it. The
        // press still goes through a real hit test at the control's centre, which is what a pointer does.
        .click({ timeout: 10000, force: true })
        .then(() => true)
        .catch((e) => {
          why =
            String(e)
              .split('\n')
              .find((l) => /intercepts|not visible|not stable|waiting for/.test(l))
              ?.trim()
              .slice(0, 140) ?? String(e).slice(0, 100)
          return false
        })
      if (!clicked) break
      // The pane is drawn from its own read; wait for something only that pane holds rather than for the frame around it.
      arrived = await page
        .waitForFunction(
          `(document.querySelector('#settings')?.innerText||'').includes(${JSON.stringify(marker)})`,
          undefined,
          { timeout: 14000 },
        )
        .then(() => true)
        .catch(() => false)
    }
    if (marker === undefined) {
      clicked = await page
        .locator(`#settings [data-setting="${name}"]`)
        .first()
        .click({ timeout: 10000, force: true })
        .then(() => true)
        .catch(() => false)
      await page
        .waitForFunction(
          "!(document.querySelector('#settings')?.innerText||'').includes('Asking Team HQ')",
          undefined,
          { timeout: 30000 },
        )
        .catch(() => null)
    }
    check(clicked && arrived, `Settings: "${name}" can be opened${why === '' ? '' : ` (${why})`}`)
    if (!clicked) return ''
    await page.waitForTimeout(1200)
    return (await page.locator('#settings').innerText()).replace(/\s+/g, ' ')
  }
  const behaviour = await settingsTab('behaviour')
  check(
    /Watch only/.test(behaviour) && /Act, then show me/.test(behaviour),
    'Settings: the autonomy levels are explained',
  )
  await page
    .locator('#settings button', { hasText: 'Act, then show me' })
    .first()
    .click({ force: true })
    .catch(() => null)
  // Raising autonomy asks first, in the page's own dialog (never a browser dialog); the visitor says yes and is then refused.
  await page
    .getByRole('button', { name: /^Yes, let it$/ })
    .first()
    .click({ timeout: 5000, force: true })
    .catch(() => null)
  // The gateway's own sentence, not the page's standing notice (which also says "changes are not saved").
  const autonomySaid = await page
    .waitForFunction(
      "/sample office, so changes are not saved/.test((document.body.innerText||'').replace(/\\s+/g,' '))",
      undefined,
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false)
  check(
    autonomySaid,
    `Settings: a refused change answers in a sentence${autonomySaid ? '' : ` (${(await page.locator('#settings').innerText()).replace(/\s+/g, ' ').slice(0, 300)})`}`,
  )
  const requests = await settingsTab('requests', 'Sending email')
  check(
    /Oliver is asking to use/.test(requests) && /Sending email/.test(requests),
    `Settings: the tool request waiting for a decision is listed (${requests.slice(330, 520)})`,
  )
  // The studio never stops moving, so a forced press can land just before a redraw and do nothing: press again (once) if no sentence came.
  let approveSaid = false
  for (let press = 0; press < 3 && !approveSaid; press++) {
    await page
      .locator('#settings button', { hasText: /^Approve$/ })
      .first()
      .click({ force: true })
      .catch(() => null)
    // Approving asks first, in the page's own dialog; the visitor says yes and is then refused.
    await page
      .locator('.stg-confirm button', { hasText: /^Approve$/ })
      .first()
      .click({ timeout: 4000, force: true })
      .catch(() => null)
    approveSaid = await page
      .waitForFunction(
        "/sample office, so changes are not saved/.test((document.body.innerText||'').replace(/\\s+/g,' '))",
        undefined,
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false)
  }
  check(
    approveSaid,
    `Settings: Approve on the request is refused in a sentence, and approves nothing${approveSaid ? '' : ` (${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(-240)})`}`,
  )
  const learned = await settingsTab('memory', 'Oak boards')
  check(
    /Oak boards/.test(learned) && /Webb & Sons/.test(learned),
    `Settings: decisions the team recorded are listed (${learned.slice(330, 520)})`,
  )
  clean(learned, 'Settings (What it has learned)')
  const channels = await settingsTab('channels')
  check(
    /Connect Telegram/.test(channels) && /Not connected/.test(channels),
    'Settings: Messaging offers to connect and shows nothing as connected',
  )
  await page
    .locator('#settings button', { hasText: 'Connect Telegram' })
    .first()
    .click()
    .catch(() => null)
  await page.waitForTimeout(4000)
  check(
    /sample office, so changes are not saved/.test(
      (await page.locator('#settings').innerText()).replace(/\s+/g, ' '),
    ),
    'Settings: Connect Telegram answers in a sentence',
  )

  check(errors.length === 0, `no page error${errors.length > 0 ? `: ${errors.join(' | ')}` : ''}`)
  check(
    refusedReads.length === 0,
    `no refused read${refusedReads.length > 0 ? `: ${refusedReads.join(' | ')}` : ''}`,
  )

  // A failed first read (#426): the prototype's invented projects are not shown in its place, the failure is said, and Try
  // again brings the real office back. The read is refused at the network, so the proof does not depend on a bad morning.
  await page.route(/section=studio(&|$)/, (r) => r.abort())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page
    .waitForFunction("(document.body.innerText||'').includes('could not be loaded')", undefined, {
      timeout: 30000,
    })
    .catch(() => null)
  const failed = await text()
  check(
    /could not be loaded/.test(failed),
    'failed read: the page says the projects could not be loaded',
  )
  check(
    !/Legacy|Grant Rogers|Riverside|Autumn Menu|Winter Market/.test(failed),
    'failed read: no project names at all, invented or real',
  )
  check(
    (await page.locator('[data-bc-retry-office]').count()) > 0,
    'failed read: Try again is offered',
  )
  await page.unroute(/section=studio(&|$)/)
  await page
    .locator('[data-bc-retry-office]')
    .first()
    .click()
    .catch(() => null)
  const back = await page
    .waitForFunction("(document.body.innerText||'').includes('Riverside')", undefined, {
      timeout: 40000,
    })
    .then(() => true)
    .catch(() => false)
  check(back, 'failed read: Try again brings the Sample back')
  await browser.close()
}

// A walk is run again (once) from the start if the BUILD SANDBOX stops it: a navigation the proxy cut off throws, and that says
// nothing about the product. The failures counted before it began are kept; the aborted attempt's are dropped and its lines are
// still printed above, so nothing is hidden.
const walk = async (label: string, phone: boolean): Promise<void> => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const before = failures
    try {
      await run(label, phone)
      return
    } catch (e) {
      console.log(
        `     (the walk was stopped by the environment: ${String(e).split('\n')[0]?.slice(0, 120)}; ${attempt === 1 ? 'walking again from the start' : 'giving up'})`,
      )
      failures = before
      if (attempt === 2) check(false, `${label}: the walk could not be completed`)
    }
  }
}
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
if (only === undefined || only === 'desktop') await walk('desktop 1440x900', false)
if (only === undefined || only === 'phone') await walk('phone 390x844', true)
console.log(`\n${failures === 0 ? 'ALL PASS' : `${String(failures)} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
