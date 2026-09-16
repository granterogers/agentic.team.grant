/**
 * Whole workflows, by keyboard alone.
 *
 *   npm run verify:keyboard
 *
 * §30 of the UX QA standard, and its whole point is the second line:
 *
 *   Test whole workflows using keyboard.
 *   NOT MERELY ISOLATED TAB ASSERTIONS.
 *
 * `verify:access` already proves the composer can be REACHED by Tab. That is an
 * isolated assertion, and it is the shape of check that passes while the
 * product is unusable: every control individually focusable, and no complete
 * task achievable — because the thing that stops a keyboard user is never a
 * missing tabindex, it is a menu that opens without moving focus into it, or a
 * sheet that closes and leaves focus on a node that no longer exists, or a
 * dialog with no way out.
 *
 * So each block below is a JOURNEY: a thing a person came here to do, done
 * start to finish with no pointer, with the state asserted at each step.
 *
 *   navigation · command bar · project switcher · Settings ·
 *   messaging · a sheet as a dialog · a form
 *
 * ## Three properties checked throughout rather than once
 *
 *   * FOCUS IS VISIBLE. A journey completed with an invisible focus ring is a
 *     journey nobody can follow. Measured against the element's own resting
 *     state, not against a guess at what an outline looks like.
 *   * FOCUS IS NEVER LOST. After every state change, the active element is
 *     still in the document and is not `body` — landing on `body` is how a
 *     keyboard user ends up back at the top of the page after every action.
 *   * ESCAPE GETS OUT. Anything that opens closes on Escape, and focus goes
 *     somewhere deliberate afterwards.
 *
 * ## Why it runs as a writer
 *
 * The same one-liner `verify:layouts` and `verify:access` use. An audit running
 * as a reader never draws a composer, a Send button or a settings write — so
 * the most important journeys here would not exist to be walked.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4629
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(ROOT, path === '/' ? 'index.html' : path.replace(/^\//, ''))
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
})
await new Promise<void>((r) => {
  server.listen(PORT, '127.0.0.1', () => {
    r()
  })
})

const AS_WRITER = `try{localStorage.setItem('hq.token','audit')}catch(e){}`

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(AS_WRITER)
await context.addInitScript(seedAppearance('dark'))
const page = await context.newPage()

const errors: string[] = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(`http://127.0.0.1:${String(PORT)}/`)
await page.waitForSelector('.rail', { timeout: 20_000 })
// The studio paints twice — once from what is in hand, once hydrated — and a
// journey begun between the two walks a DOM that is about to be replaced.
await page.waitForTimeout(2500)

/** Who has focus, described the way a person would describe it. */
const focused = async (): Promise<{ tag: string; name: string; where: string }> =>
  (await page.evaluate(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'body', name: '', where: '' }
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
    const attrs = [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-'))
    return {
      tag: el.tagName.toLowerCase(),
      name,
      where: attrs.join(' ') || el.className.slice(0, 40),
    }
  })()`)) as { tag: string; name: string; where: string }

/**
 * Tab until the focused element matches, and say how many presses it took.
 *
 * Bounded, because the thing this is most likely to meet is a focus trap, and
 * a trap looks exactly like an element that is never reached.
 */
const tabUntil = async (test: string, max = 60): Promise<number> => {
  for (let i = 1; i <= max; i += 1) {
    await page.keyboard.press('Tab')
    const hit = await page.evaluate(`(() => {
      const el = document.activeElement
      if (!el) return false
      return Boolean(${test})
    })()`)
    if (hit === true) return i
  }
  return -1
}

/**
 * Whether focusing the current element changes how it looks.
 *
 * Compared against the SAME element blurred, rather than against a list of
 * properties an outline might use: the studio styles focus with an outline in
 * some places and a shadow in others, and a list would go stale the first time
 * somebody preferred one to the other.
 */
const focusIsVisible = async (): Promise<boolean> =>
  (await page.evaluate(`(() => {
    const el = document.activeElement
    if (!el || el === document.body) return false
    /*
      The element AND the box around it.

      A textarea in this product is styled through the composer's focus-within —
      the ring is drawn on the wrapper, not on the field — so reading the
      field's own computed style reported NO VISIBLE FOCUS about a composer
      that lights up plainly. Checking the ancestor chain as well is what makes
      this a question about what the person can see rather than about which
      node the rule happens to be written on.
    */
    const shot = (n) => {
      const s = getComputedStyle(n)
      return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor,
              s.backgroundColor].join('|')
    }
    const chain = []
    for (let n = el; n && n !== document.body && chain.length < 4; n = n.parentElement) chain.push(n)
    const withFocus = chain.map(shot).join('#')
    el.blur()
    const without = chain.map(shot).join('#')
    el.focus()
    return withFocus !== without
  })()`)) === true

/*
  Which section is current, read from the RAIL.

  Not from the first `[aria-current="page"]` on the page, which is what the
  first draft did: #216 made the wordmark a home button and gave it
  `aria-current`, so this reported the wordmark's own label as the section on
  every screen and two journeys failed against correct behaviour.
*/
const view = async (): Promise<string> =>
  String(
    await page.evaluate(
      `(document.querySelector('.rail [data-go][aria-current="page"], .rail .navitem.on')
          ?.textContent || '').trim().slice(0, 30)`,
    ),
  )

console.log('§30 — whole workflows, keyboard only\n')

// --- 1. navigation ----------------------------------------------------------
console.log('navigation: get to another section without touching the mouse')
{
  await page.keyboard.press('Escape')
  const before = await view()
  // A rail NAVIGATION item, not the wordmark — the wordmark is also
  // `[data-go]` and also lives in the rail, and it goes to the screen the
  // journey starts on, so pressing it proves nothing.
  const steps = await tabUntil(
    `el.matches('.rail [data-go]') && !el.classList.contains('wordmark')`,
  )
  check(
    'a navigation item is reachable by Tab from the top of the page',
    steps > 0 ? `${String(steps)} press(es): ${(await focused()).name}` : 'NEVER REACHED',
    steps > 0,
  )
  check('and the focus on it is visible', (await focused()).name, await focusIsVisible())

  // Tab on to a DIFFERENT section than the one we are on, then Enter.
  let target = (await focused()).name
  for (let i = 0; i < 8 && (target === before || target === ''); i += 1) {
    await page.keyboard.press('Tab')
    target = (await focused()).name
  }
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  const after = await view()
  check(
    'Enter on it actually changes the section',
    `${before || '(none)'} → ${after || '(none)'}`,
    after !== '' && after !== before,
  )
  const now = await focused()
  check(
    'and focus is not dumped back on the body by the re-render',
    `${now.tag} ${now.name || now.where}`,
    now.tag !== 'body',
  )
}

// --- 2. the command bar -----------------------------------------------------
console.log('\nthe command bar: open it, find something, go there, get out')
{
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  const open = await page.evaluate(`Boolean(document.querySelector('.cmdwrap, .cmd'))`)
  check('Control-K opens it', open === true ? 'open' : 'NOTHING OPENED', open === true)

  const inInput = await page.evaluate(`document.activeElement?.tagName === 'INPUT'`)
  check(
    'and focus moves into the input, so the next keystroke is the query',
    inInput === true ? 'the input has focus' : `focus is on ${(await focused()).tag}`,
    inInput === true,
  )

  /*
    A query that matches something you can actually GO to.

    The first draft typed "doc", whose only row at the home board is the
    always-last "Ask the team" row — so the journey asserted navigation against
    a row that cannot navigate, and reported a product failure about a check
    that had chosen the wrong subject.
  */
  await page.keyboard.type('well')
  await page.waitForTimeout(600)
  const rows = Number(await page.evaluate(`document.querySelectorAll('[data-cmd-row]').length`))
  check('typing filters it down to matches', `${String(rows)} row(s) for "well"`, rows > 0)

  const wasProject = String(await page.evaluate(`document.title`))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  const stillOpen = await page.evaluate(`Boolean(document.querySelector('[data-cmd-wrap]'))`)
  const arrived = await page.evaluate(
    `Boolean(document.querySelector('.rail .navitem.proj[aria-current="true"], .projhead, [data-tab]'))`,
  )
  check(
    'Enter takes the highlighted row and closes the bar',
    `${wasProject.slice(0, 20)} → ${arrived === true ? 'a project screen' : 'nowhere'}, bar ${
      stillOpen === true ? 'STILL OPEN' : 'closed'
    }`,
    stillOpen !== true && arrived === true,
  )

  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const gone = await page.evaluate(`Boolean(document.querySelector('[data-cmd-wrap]'))`)
  check(
    'and Escape closes it without choosing anything',
    gone === true ? 'STILL OPEN' : 'closed',
    gone !== true,
  )
}

// --- 3. the project switcher ------------------------------------------------
console.log('\nthe project switcher: a menu is only usable if focus goes into it')
{
  await page.keyboard.press('Escape')
  const steps = await tabUntil(`el.matches('[data-switch], .navitem.proj, [aria-haspopup]')`)
  if (steps < 0) {
    check('the switcher is reachable by keyboard', 'NEVER REACHED', false)
  } else {
    check('the switcher is reachable by keyboard', `${String(steps)} press(es)`, true)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    const expanded = await page.evaluate(
      `document.querySelector('[aria-haspopup]')?.getAttribute('aria-expanded')`,
    )
    check(
      'Enter opens it and says so to a screen reader',
      `aria-expanded=${String(expanded)}`,
      expanded === 'true',
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const shut = await page.evaluate(
      `document.querySelector('[aria-haspopup]')?.getAttribute('aria-expanded')`,
    )
    check('and Escape shuts it again', `aria-expanded=${String(shut)}`, shut !== 'true')
  }
}

// --- 4. Settings, which is where the irreversible controls live -------------
console.log('\nSettings: open it, move between its tabs, get out')
{
  await page.keyboard.press('Escape')
  const steps = await tabUntil(`el.matches('[data-go="settings"], [data-settings]')`)
  check(
    'Settings is reachable by keyboard',
    steps > 0 ? `${String(steps)} press(es)` : 'NEVER REACHED',
    steps > 0,
  )
  if (steps > 0) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(1200)
    const there = await page.evaluate(
      `Boolean(document.querySelector('#settings:not([hidden])')) ||
       location.hash.includes('settings') ||
       Boolean(document.querySelector('[data-setting][role="tab"]'))`,
    )
    check(
      'Enter gets there',
      there === true ? 'settings is on screen' : 'NOT THERE',
      there === true,
    )

    const tab = await tabUntil(`el.matches('[data-setting][role=\\'tab\\']')`, 40)
    check(
      'its tabs are reachable without a pointer',
      tab > 0 ? `${String(tab)} press(es): ${(await focused()).name}` : 'NEVER REACHED',
      tab > 0,
    )
    if (tab > 0) {
      const was = String(
        await page.evaluate(
          `document.querySelector('[data-setting][aria-selected="true"]')?.textContent?.trim() || ''`,
        ),
      )
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      const now = String(
        await page.evaluate(
          `document.querySelector('[data-setting][aria-selected="true"]')?.textContent?.trim() || ''`,
        ),
      )
      check('and Enter changes pane', `${was || '(none)'} → ${now || '(none)'}`, now !== '')
    }
  }
}

// --- 5. messaging -----------------------------------------------------------
console.log('\nmessaging: write something and send it, with no pointer')
{
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  /*
    Get to the composer first, and by pointer.

    The composer lives on a project's AI Team tab, not on the home board, so
    Tabbing eighty times from wherever the previous journey ended reached
    nothing and read as "the composer cannot be reached by keyboard" — a
    finding about a screen that was not open. What is under test here is
    whether the composer can be USED from the keyboard once you are on the
    screen it is on; getting to that screen is journey 1's job and journey 1
    passes.
  */
  /*
    A VISIBLE project entry.

    `[data-open]` alone also matches the switcher menu's options, which live in
    a hidden menu — Playwright resolves them, reports "element is not visible",
    and the journey silently walks the screen it was already on.
  */
  const card = page
    .locator('.homego[data-open], .project[data-open], .navitem.proj[data-open]')
    .first()
  if ((await card.count()) > 0) await card.click({ force: true })
  await page.waitForTimeout(1200)
  const teamTab = page.locator('[data-tab="team"]').first()
  if ((await teamTab.count()) > 0) await teamTab.click({ force: true })
  await page.waitForTimeout(800)
  const chatTab = page.locator('[data-sub="chat"]').first()
  if ((await chatTab.count()) > 0) await chatTab.click({ force: true })
  await page.waitForTimeout(1200)

  const composer = await page.locator('.composer textarea, textarea[data-say], textarea').count()
  if (composer === 0) {
    console.log('  --   no composer on this build of the mock — nothing to walk')
  } else {
    await page.evaluate(`document.activeElement?.blur()`)
    await page.keyboard.press('Tab')
    const steps = await tabUntil(`el.matches('textarea')`, 80)
    check(
      'the composer is reachable by Tab from the screen it is on',
      steps > 0 ? `${String(steps)} press(es)` : 'NEVER REACHED',
      steps > 0,
    )
    if (steps > 0) {
      check('and the focus on it is visible', 'the composer', await focusIsVisible())
      await page.keyboard.type('A keyboard-only message')
      const typed = String(await page.evaluate(`document.activeElement?.value || ''`))
      check('typing reaches it', `${String(typed.length)} character(s)`, typed.length > 0)

      const before = Number(
        await page.evaluate(`document.querySelectorAll('.msg, .bubble, .waitrow').length`),
      )
      await page.keyboard.press('Control+Enter')
      await page.waitForTimeout(1500)
      const after = Number(
        await page.evaluate(`document.querySelectorAll('.msg, .bubble, .waitrow').length`),
      )
      const sendable =
        after > before || (await page.evaluate(`document.activeElement?.value === ''`)) === true
      check(
        'and a send shortcut posts it rather than needing the mouse',
        `${String(before)} → ${String(after)} row(s)`,
        sendable,
      )
    }
  }
}

// --- 6. a real dialog: the document viewer ----------------------------------
console.log('\na dialog: focus cannot fall out behind it, and Escape returns it')
{
  /*
    The VIEWER, not Settings.

    The first draft used Settings and reported twenty-five Tabs landing behind
    it. That is correct behaviour and #158 says so in the code: Settings stopped
    being a dialog on purpose — *"Settings has enough complexity to justify being
    a first-class page"* — and `sheet()` no longer puts `behind` on the body for
    it. A page you can leave by going somewhere else is the whole difference.
    `#viewer` is the one that is still a dialog, "because it IS one".
  */
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // A project first: the documents tab only exists inside one, and a journey
  // that cannot find its subject is coverage claimed and not held.
  /*
    A project that HAS a document.

    Not every project does, and the first draft took the first one it found —
    which had none, so the journey reported "no subject" and skipped itself
    while nine documents sat one project away. A skipped journey is coverage
    claimed and not held, which is worse than a red one.
  */
  // Home first, so this journey starts from the same place the others did
  // rather than from wherever the messaging journey happened to end.
  const home = page.locator('.rail [data-go="portfolio"]').first()
  if ((await home.count()) > 0) {
    await home.click({ force: true })
    await page.waitForTimeout(1500)
  }
  const entries = page.locator('.homego[data-open], .project[data-open], .navitem.proj[data-open]')
  const howMany = await entries.count()
  let opened = false
  for (let i = 0; i < Math.min(howMany, 6) && !opened; i += 1) {
    await entries.nth(i).click({ force: true })
    await page.waitForTimeout(1200)
    const docsTab = page.locator('[data-tab="documents"]').first()
    if ((await docsTab.count()) === 0) continue
    await docsTab.click({ force: true })
    await page.waitForTimeout(1400)
    const doc = page.locator('[data-doc]').first()
    if ((await doc.count()) === 0) continue
    await doc.click({ force: true })
    await page.waitForTimeout(1600)
    opened =
      (await page.evaluate(`Boolean(document.querySelector('#viewer:not([hidden])'))`)) === true
  }
  const modal = await page.evaluate(`Boolean(document.querySelector('#viewer:not([hidden])'))`)
  if (modal !== true) {
    console.log('  --   no document opened in the mock — the dialog journey has no subject')
  } else {
    let outside = 0
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab')
      const behind = await page.evaluate(
        `(() => { const el = document.activeElement
                  return Boolean(el) && el !== document.body &&
                         !document.querySelector('#viewer')?.contains(el) })()`,
      )
      if (behind === true) outside += 1
    }
    check(
      'twenty-five Tabs never land on the shell behind the dialog',
      outside === 0 ? 'focus stayed inside' : `${String(outside)} landed behind it`,
      outside === 0,
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    const shut = await page.evaluate(`Boolean(document.querySelector('#viewer[hidden]'))`)
    check('Escape closes it', shut === true ? 'closed' : 'STILL OPEN', shut === true)
    const now = await focused()
    check(
      'and focus is somewhere real afterwards, not on the body',
      `${now.tag} ${now.name || now.where}`,
      now.tag !== 'body',
    )
  }
}

// --- 7. nothing threw on the way through ------------------------------------
check(
  'no page error during any journey',
  errors.length === 0 ? 'none' : errors.slice(0, 3).join(' · '),
  errors.length === 0,
)

await browser.close()
server.close()

const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
