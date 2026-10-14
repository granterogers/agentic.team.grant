/**
 * Visual evidence for a Team HQ look: screenshots of the surfaces a person sees, at desktop and phone width, in the look a
 * FRESH browser gets and in a browser that kept an earlier saved choice. Used before and after a visual change, so every
 * "after" has a "before" of the same surface.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/visual-evidence.ts <tag>
 *
 * Local surfaces are the prototype served from web/studio (no office, no sign-in, no database). The public landing is read
 * from production as a signed-out visitor (a page load and the public sign-in state; nothing is created or signed in).
 * Writes only under .out/redesign/<tag>/ and prints each surface's computed colours so the change is measured, not assumed.
 */
// biome-ignore-all format: the colour and probe tables are kept as written, as the other verification probes are
import '../../src/safety/require-production-checks.ts'
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const tag = process.argv[2] ?? 'unnamed'
const dir = join('.out/redesign', tag)
mkdirSync(dir, { recursive: true })
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)) } catch { res.writeHead(404); res.end('not here') }
})
await new Promise<void>((r) => server.listen(4871, '127.0.0.1', () => r()))
const LOCAL = 'http://127.0.0.1:4871'
const PROD_API = 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'
const browser = await chromium.launch()
const OLD = JSON.stringify({ palette: 'clay', look: 'graphite', scheme: 'dark', texture: 'none', density: 'comfortable', glass: 'soft', depth: 'flat' })
const VIEWPORTS = [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]] as const
// A person's own dark choice, saved at the current revision: it must survive a reload untouched.
const CHOSEN_DARK = JSON.stringify({ v: 3, palette: 'slate', scheme: 'dark', look: 'porcelain', texture: 'none', density: 'comfortable', glass: 'soft', depth: 'soft' })
const STATES = [['fresh', null], ['saved-earlier-choice', OLD], ['chosen-dark', CHOSEN_DARK]] as const
/* A probe that says what it measured, and says so when it cannot measure (an empty result is never a pass). */
const PROBE = `(() => {
  try {
    const b = getComputedStyle(document.body)
    const m = document.querySelector('main') || document.body
    const root = document.documentElement.dataset
    const ver = document.querySelector('.bcver')
    return JSON.stringify({ scheme: root.scheme || 'system', look: root.look || null, palette: root.palette || null, bodyBg: b.backgroundColor, font: b.fontFamily.slice(0, 22), chars: m.innerText.trim().length, version: ver ? ver.textContent : null })
  } catch (e) {
    return 'PROBE ERROR: ' + String(e && e.message || e)
  }
})()`
const report: string[] = []
const shoot = async (name: string, url: string, vp: { width: number; height: number }, touch: boolean, stored: string | null, prodApi: boolean, after?: (p: import('playwright').Page) => Promise<void>) => {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })
  if (stored !== null) await ctx.addInitScript(`localStorage.setItem('studio.appearance', ${JSON.stringify(stored)})`)
  if (prodApi) await ctx.addInitScript(`window.HQ_API = ${JSON.stringify(PROD_API)}`)
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => undefined)
  await page.waitForTimeout(2500)
  if (after) await after(page).catch(() => undefined)
  // A probe that cannot run is reported as a failure in the output, never as an empty measurement.
  const probe = await page.evaluate(PROBE).catch((e) => `PROBE FAILED: ${String(e).slice(0, 160)}`)
  report.push(`${name}: ${probe}`)
  await page.screenshot({ path: join(dir, `${name}.png`) })
  await ctx.close()
}
for (const [vname, vp, touch] of VIEWPORTS) {
  for (const [sname, stored] of STATES) {
    const tag2 = `${vname}-${sname}`
    // The signed-out entry screen, from the local build: ?welcome is the page's own route to it off production.
    await shoot(`landing-${tag2}`, `${LOCAL}/?welcome`, vp, touch, stored, true)
    await shoot(`home-${tag2}`, `${LOCAL}/`, vp, touch, stored, false)
    await shoot(`project-${tag2}`, `${LOCAL}/p/legacy-coaching-course`, vp, touch, stored, false)
    await shoot(`tasks-${tag2}`, `${LOCAL}/p/legacy-coaching-course/tasks`, vp, touch, stored, false)
    await shoot(`documents-${tag2}`, `${LOCAL}/p/legacy-coaching-course/documents`, vp, touch, stored, false)
    await shoot(`chat-${tag2}`, `${LOCAL}/p/legacy-coaching-course/chat`, vp, touch, stored, false)
    await shoot(`calendar-${tag2}`, `${LOCAL}/p/legacy-coaching-course/schedule`, vp, touch, stored, false)
    await shoot(`team-${tag2}`, `${LOCAL}/p/legacy-coaching-course/team`, vp, touch, stored, false)
  }
}
console.log(report.join('\n'))
await browser.close()
server.close()
process.exit(0)
