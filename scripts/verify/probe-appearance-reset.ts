/**
 * The appearance defaults and the Reset to recommended action, in three browsers: a clean one, one with an earlier customised
 * choice (Clay palette, Dark scheme, a texture), and the same browser after the reset. Local, read-only apart from browser storage.
 *
 *   npx tsx scripts/verify/probe-appearance-reset.ts
 */
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const { port, close } = await serve()
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const record = (check: string, ok: boolean, detail: unknown) => results.push({ check, ok, detail })

const CUSTOMISED = JSON.stringify({
  palette: 'clay',
  texture: 'granite',
  own: null,
  ownName: '',
  scheme: 'dark',
  density: 'comfortable',
  look: 'forest',
  glass: 'rich',
  depth: 'deep',
})

const state = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement
    let stored: Record<string, unknown> = {}
    try {
      stored = JSON.parse(localStorage.getItem('studio.appearance') ?? '{}')
    } catch {
      /* unreadable */
    }
    return {
      palette: root.dataset.palette ?? null,
      look: root.dataset.look ?? null,
      scheme: root.dataset.scheme ?? null,
      texture: root.dataset.texture ?? null,
      stored: {
        palette: stored.palette ?? null,
        look: stored.look ?? null,
        scheme: stored.scheme ?? null,
        texture: stored.texture ?? null,
      },
    }
  })

const isRecommended = (s: {
  palette: string | null
  look: string | null
  scheme: string | null
  texture: string | null
}) => s.palette === 'slate' && s.look === 'silver' && s.scheme !== 'dark' && s.texture === 'none'

const open = async (page: Page) => {
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
}

try {
  // A clean browser: nothing stored. The recommended appearance is what a new visitor sees.
  {
    const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    })
    const page = await c.newPage()
    await open(page)
    const s = await state(page)
    record(
      'clean browser: the recommended appearance is what a new visitor sees',
      isRecommended(s),
      s,
    )
    await c.close()
  }

  // A browser that already chose Clay, Dark, a texture, Forest and Deep: the choice is kept (never overwritten silently), and the
  // reset restores the recommended appearance from it.
  const c = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  })
  // Seeded once per browser session: an init script runs on every navigation, and a reload must not re-seed the old choice.
  await c.addInitScript((value) => {
    try {
      if (sessionStorage.getItem('probe-seeded') === null) {
        localStorage.setItem('studio.appearance', value)
        sessionStorage.setItem('probe-seeded', '1')
      }
    } catch {
      /* private */
    }
  }, CUSTOMISED)
  const page = await c.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  await open(page)
  const before = await state(page)
  record(
    'customised browser: an earlier choice is kept until the person resets it',
    before.palette === 'clay' && before.scheme === 'dark' && before.texture === 'granite',
    before,
  )

  // Open Settings, go to Appearance, press Reset to recommended.
  await page
    .locator('[data-bc-settings]:visible')
    .first()
    .click({ force: true })
    .catch(() => undefined)
  await page.waitForTimeout(900)
  const tab = page
    .locator('#settings')
    .getByRole('button', { name: /^Appearance$/ })
    .first()
  if ((await tab.count()) > 0) await tab.click({ force: true })
  await page.waitForTimeout(600)
  const reset = page.locator('[data-appearance-reset]').first()
  record('the Appearance tab offers Reset to recommended', (await reset.count()) > 0, {
    found: await reset.count(),
  })
  if ((await reset.count()) > 0) {
    await reset.click({ force: true })
    await page.waitForTimeout(700)
    const after = await state(page)
    record(
      'reset restores Slate & Silver, Light, the slate accent and no texture, and stores them',
      isRecommended(after) && after.stored.palette === 'slate' && after.stored.texture === 'none',
      after,
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    const reloaded = await state(page)
    record('the reset survives a reload', isRecommended(reloaded), reloaded)
  }
  record('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3))
  await c.close()
} finally {
  await browser.close()
  close()
}

for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`, JSON.stringify(r.detail))
const failed = results.filter((r) => !r.ok).length
console.log(
  failed === 0
    ? `ALL ${String(results.length)} CHECKS PASS`
    : `${String(failed)} of ${String(results.length)} FAILED`,
)
process.exitCode = failed === 0 ? 0 : 1
