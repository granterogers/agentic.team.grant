// The gate comes first: this reads the production site, so it refuses to run without ALLOW_PRODUCTION_CHECKS=1.
import '../../src/safety/require-production-checks.ts'
/**
 * Read-only check of the live public landing screen. It sends no sign-in, creates no session and writes nothing: a signed-out
 * visitor's first screen only. Checks the default look with nothing stored, both colour modes, and page errors.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/probe-production-landing.ts
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = 'https://ai-team-hq.vercel.app'
const OUT = join(process.cwd(), '.out', 'probe')
const browser = await chromium.launch()
const results: Array<{ check: string; ok: boolean; detail: unknown }> = []
const nonGet: string[] = []
try {
  await mkdir(OUT, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    })
    // The light run keeps nothing stored, so the default is what is measured. The dark run stores the Dark choice, in its own
    // fresh context, to see the Dark screen.
    if (scheme === 'dark') {
      await context.addInitScript(() => {
        localStorage.setItem(
          'studio.appearance',
          JSON.stringify({ scheme: 'dark', look: 'silver' }),
        )
      })
    }
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('request', (r) => {
      if (r.method() !== 'GET')
        nonGet.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`)
    })
    const started = Date.now()
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    // Wait for the app to draw, not for a fixed time; the time it took is reported.
    const drawn = await page
      .waitForFunction(() => document.documentElement.dataset.experience === 'basecamp', null, {
        timeout: 25000,
      })
      .then(() => true)
      .catch(() => false)
    const secondsToDraw = Math.round((Date.now() - started) / 1000)
    await page.waitForTimeout(800)
    const state = await page.evaluate(() => ({
      look: document.documentElement.dataset.look ?? null,
      scheme: document.documentElement.dataset.scheme ?? null,
      experience: document.documentElement.dataset.experience ?? null,
      signInVisible: document.body.innerText.includes('Sign in'),
    }))
    await page.screenshot({ path: join(OUT, `production-landing-${scheme}.png`) })
    results.push({
      check:
        scheme === 'light'
          ? 'light: landing renders, default look is silver with nothing stored'
          : 'dark: landing renders with the stored Dark choice',
      ok:
        scheme === 'light'
          ? state.look === 'silver' && state.signInVisible
          : state.scheme === 'dark' && state.signInVisible,
      detail: { ...state, drawn, secondsToDraw, pageErrors: errors.slice(0, 3) },
    })
    results.push({
      check: `${scheme}: no page errors on the landing screen`,
      ok: errors.length === 0,
      detail: errors.slice(0, 3),
    })
    await context.close()
  }
} finally {
  await browser.close()
}
for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.check}`, JSON.stringify(r.detail).slice(0, 300))
console.log(`non-GET requests: ${String(nonGet.length)} ${JSON.stringify(nonGet)}`)
const failed = results.filter((r) => !r.ok).length
process.exitCode = failed === 0 ? 0 : 1
