/**
 * Logged out -> Explore the Sample -> leave -> sign in as a REAL person -> sign out -> Explore again, on the DEPLOYED page.
 *
 *   npx tsx scripts/sample/public-transition.ts [--widths=desktop,phone]
 *
 * The real person is the Sample Person (a genuine second person with their own office), signed in by the same hand-off a magic
 * link ends with: the session arrives in the URL fragment and the page's own adopt() takes it. The mail hop is not exercised
 * and this does not claim it is. No credential is printed. Nothing is written to any office: every step reads, and the one
 * sign-out only removes this browser's own session.
 *
 * What it proves is the thing a shared browser can get wrong: that a visitor's Sample and a person's office never show each
 * other's content, in either direction, and that leaving one does not leave anything of it behind for the next.
 */
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import type { Session } from '../p4/lib.ts'
import { session as samplePersonSession } from './lib.ts'

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const PAGE = 'https://ai-team-hq.vercel.app'
const out = '.out/public-transition'
mkdirSync(out, { recursive: true })
const WIDTHS: Record<string, { width: number; height: number; touch: boolean }> = {
  desktop: { width: 1440, height: 900, touch: false },
  phone: { width: 390, height: 844, touch: true },
}
const chosen = (arg('widths') ?? 'desktop,phone').split(',')

const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const SAMPLE_PROJECTS = /Riverside Café Launch|Autumn Menu Research|Winter Market Pop-up/
const REAL_OFFICES = /grant|innergy|rogers|legacy coaching|japan spring|2027 financial|ai learning/i
const text = async (p: Page): Promise<string> =>
  (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const held = async (
  p: Page,
): Promise<{ session: string; sample: boolean | null; visitor: boolean }> =>
  (await p.evaluate(`(() => { let s = null; try { s = JSON.parse(localStorage.getItem('hq.session') || 'null') } catch {}
    return { session: s === null ? 'none' : 'held', sample: s === null ? null : s.sample === true, visitor: localStorage.getItem('hq.visitor') !== null } })()`)) as {
    session: string
    sample: boolean | null
    visitor: boolean
  }

const person: Session = await samplePersonSession()
const browser = await chromium.launch()
for (const name of chosen) {
  const vp = WIDTHS[name]
  if (vp === undefined) continue
  const tag = name
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.touch,
    isMobile: vp.touch && vp.width < 600,
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))

  // 1. a logged-out visitor explores the Sample
  await page.goto(`${PAGE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-sample-start]', { timeout: 30000 })
  await page.locator('[data-bc-sample-start]').click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  await page.waitForFunction("(document.body.innerText || '').includes('Riverside')", undefined, {
    timeout: 60000,
  })
  let t = await text(page)
  check(`${tag}: the visitor is in the Sample, with its own projects`, SAMPLE_PROJECTS.test(t), '')
  check(
    `${tag}: and none of any real office is on the page`,
    !REAL_OFFICES.test(t),
    t.match(REAL_OFFICES)?.[0] ?? '',
  )

  // 2. they choose to sign in instead: the Sample is left behind, completely
  await page.locator('[data-bc-sample-signin]').first().click()
  await page.waitForSelector('.bcentrycard', { timeout: 30000 })
  const left = await held(page)
  check(
    `${tag}: Sign in leaves the Sample: no session, no visitor id held`,
    left.session === 'none' && !left.visitor,
    JSON.stringify(left),
  )

  // 3. a real person signs in on the same browser (the hand-off a magic link ends with)
  await page.goto('about:blank')
  const frag = `access_token=${encodeURIComponent(person.access_token)}&refresh_token=${encodeURIComponent(person.refresh_token)}&expires_in=3000`
  await page.goto(`${PAGE}/#${frag}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page
    .waitForFunction(
      "document.querySelector('.bcnotlive') === null && (document.body.innerText || '').length > 200",
      undefined,
      { timeout: 60000 },
    )
    .catch(() => null)
  await page.waitForTimeout(4000)
  t = await text(page)
  const real = await held(page)
  check(
    `${tag}: the real person is signed in, and it is not a sample session`,
    real.session === 'held' && real.sample === false,
    JSON.stringify(real),
  )
  check(
    `${tag}: no Sample banner on a real office`,
    (await page.locator('.bcsamplebar').count()) === 0,
    '',
  )
  check(
    `${tag}: and none of the Sample's projects are in it`,
    !SAMPLE_PROJECTS.test(t),
    t.match(SAMPLE_PROJECTS)?.[0] ?? '',
  )
  check(
    `${tag}: the real office shows its own projects`,
    /Your projects/.test(t) && !/not live|invented projects/i.test(t),
    t.slice(0, 100),
  )
  await page.screenshot({ path: `${out}/${tag}-real-office.png` })

  // 4. sign out: nothing of that person is left, and the Sample is still on offer
  const signOut = page.getByRole('button', { name: /^sign out$/i }).first()
  check(
    `${tag}: a real office offers Sign out (and not "Leave sample")`,
    (await signOut.count()) > 0 && (await page.getByText('Leave sample').count()) === 0,
    '',
  )
  await signOut.click().catch(() => null)
  await page.waitForSelector('.bcentrycard', { timeout: 30000 })
  const gone = await held(page)
  check(
    `${tag}: signing out leaves no session behind`,
    gone.session === 'none',
    JSON.stringify(gone),
  )
  const leftover = (await page.evaluate(
    `Object.keys(localStorage).concat(Object.keys(sessionStorage))`,
  )) as string[]
  check(
    `${tag}: and no office data in browser storage`,
    !leftover.some((k) => /token|session$|office|project|chat/i.test(k) && k !== 'hq.welcome'),
    leftover.join(','),
  )
  check(
    `${tag}: the Sample is still on offer after a real person signs out`,
    (await page.locator('[data-bc-sample-start]').count()) === 1,
    '',
  )

  // 5. and exploring it again is still clean: the Sample, not the person's office
  await page.locator('[data-bc-sample-start]').click()
  await page.waitForSelector('.bcsamplebar', { timeout: 60000 })
  await page.waitForFunction("(document.body.innerText || '').includes('Riverside')", undefined, {
    timeout: 60000,
  })
  t = await text(page)
  check(`${tag}: Explore again shows the Sample`, SAMPLE_PROJECTS.test(t), '')
  check(
    `${tag}: and still nothing of the person who just signed out`,
    !REAL_OFFICES.test(t) && !/wellness/i.test(t),
    t.match(/wellness/i)?.[0] ?? t.match(REAL_OFFICES)?.[0] ?? '',
  )
  await page.screenshot({ path: `${out}/${tag}-sample-again.png` })
  check(`${tag}: no page errors anywhere`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}
await browser.close()
const passed = results.filter(Boolean).length
console.log(`\n${String(passed)}/${String(results.length)} passed (captures in ${out})`)
process.exit(passed === results.length ? 0 : 1)
