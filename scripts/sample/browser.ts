/**
 * Browser harness for the Sample Person: Team HQ served from web/studio, talking to the REAL gateway, signed in as the Sample
 * Person by the same hand-off a magic link ends with (the session arrives in the URL fragment and the page's own adopt()
 * takes it). The mail hop is not exercised, and nothing here may claim it is.
 *
 * No credential is printed. The page is the working tree's, so an unreleased change can be tested against the real office
 * with a real login before it is deployed. Every write lands in the Sample office and nowhere else.
 */
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join } from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright'
import type { Session } from '../p4/lib.ts'
import { ENDPOINT } from './lib.ts'

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

export type Studio = { base: string; browser: Browser; close: () => Promise<void> }

export const startStudio = async (port: number): Promise<Studio> => {
  const server: Server = createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404)
      res.end('not here')
    }
  })
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()))
  const browser = await chromium.launch()
  return {
    base: `http://127.0.0.1:${port}`,
    browser,
    close: async () => {
      await browser.close()
      server.close()
    },
  }
}

export const newPage = async (
  studio: Studio,
  viewport: { width: number; height: number },
  touch = false,
): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> => {
  const ctx = await studio.browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch && viewport.width < 500,
  })
  await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(ENDPOINT)}`)
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  return { ctx, page, errors }
}

/** Wait for the page to be live (not the invented-projects prototype) and quiet. */
export const settle = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      "document.querySelector('.bcnotlive') === null && (document.body.innerText || '').length > 200",
      undefined,
      { timeout: 45000 },
    )
    .catch(() => null)
  await page.waitForTimeout(2000)
}

/** Open the page the way a magic link does: a navigation carrying the session in the fragment. */
/*
  SIGNING IN AS THE SAMPLE PERSON, the way this browser does it (B-05, web/studio/flow.js). The page adopts a sign-in only
  when this browser asked for one: it stores a pending flow under `hq.signin.flow` and the link back carries its nonce as
  `?flow=`. The harness records that pending flow in the same storage with a fresh nonce, then returns with the token in
  the fragment. The page's own decision code runs unchanged. A token placed in the fragment with no pending flow is refused
  by design (login CSRF), which is what the earlier harness did and what the product now correctly refuses.
*/
export const signIn = async (studio: Studio, page: Page, s: Session): Promise<void> => {
  await page.goto('about:blank')
  const nonce = randomBytes(32).reduce((out, b) => out + (b % 36).toString(36), '')
  await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.evaluate(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* storage refused: the sign-in cannot be recognised, and the test will say so */
      }
    },
    [
      'hq.signin.flow',
      JSON.stringify([
        { nonce, kind: 'link', email: '', at: Date.now(), exp: Date.now() + 60 * 60 * 1000 },
      ]),
    ],
  )
  const frag = `access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`
  await page.goto(`${studio.base}/?flow=${nonce}#${frag}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  await settle(page)
}

export const openSettings = async (page: Page, tab?: string): Promise<void> => {
  const open = await page
    .locator('#settings')
    .isVisible()
    .catch(() => false)
  const listShown = await page
    .locator('#settings .stg-navitem')
    .first()
    .isVisible()
    .catch(() => false)
  if (open && !listShown) {
    // On a phone a section replaces the list; a person goes back to choose another, so the harness does too.
    await page
      .locator('#settings [data-stg-back]:visible')
      .first()
      .click({ force: true, timeout: 5000 })
      .catch(() => null)
    await page.waitForTimeout(400)
  } else if (!open) {
    await page.locator('[data-bc-settings]').first().click({ force: true })
  }
  await page.waitForSelector('#settings .stg-navitem', { timeout: 20000 })
  if (tab !== undefined) {
    await page.locator(`#settings [data-setting="${tab}"]`).click({ force: true })
    // the section draws "Asking Team HQ…" until the office has answered; wait for the real thing
    await page
      .waitForFunction(
        "!document.querySelector('#settings')?.innerText.includes('Asking Team HQ')",
        undefined,
        {
          timeout: 25000,
        },
      )
      .catch(() => null)
    await page.waitForTimeout(500)
  }
}

export const closeSettings = async (page: Page): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('#settings').isVisible())) return
    await page
      .locator('#settings [data-stg-back]:visible')
      .first()
      .click({ force: true, timeout: 5000 })
      .catch(() => null)
    await page.waitForTimeout(300)
  }
}
