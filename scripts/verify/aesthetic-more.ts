// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a capture list, one surface per line
/* The other surfaces: pages, record sheets, the event editor, the new-project form, project settings, the empty canvas. Captures only. */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4704
const PALETTE = process.argv[2] ?? 'slate'
const OUT = process.argv[3] ?? '.out/aesthetic-more'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const u = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
for (const scheme of (process.env.SCHEMES ?? 'dark,light').split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(`try { localStorage.setItem('studio.appearance', JSON.stringify({ palette: '${PALETTE}', texture: 'concrete', own: null, ownName: '', scheme: '${scheme}', density: 'comfortable' })) } catch {}`)
  const page = await ctx.newPage()
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(e.message))
  const shot = async (name: string): Promise<void> => { await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${PALETTE}-${scheme}-${name}.png` }) }
  const go = async (p: string): Promise<void> => { await page.goto(u(p), { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700) }
  await go('/basecamp')
  const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
  await go('/')
  await shot('empty-canvas')
  await go('/search'); await shot('search')
  await go('/tasks'); await shot('my-tasks')
  await go('/activity'); await shot('activity')
  await go(`${slug}/settings`); await shot('project-settings')
  await go(slug)
  await page.locator('[data-bc-menu]').first().click({ force: true })
  await page.locator('[data-bc-menu-new], .bcmenucreate').first().click({ force: true }).catch(() => null)
  await shot('new-project')
  await page.keyboard.press('Escape')
  await go(slug)
  await page.locator('.bcstage [data-cal-new]').first().click({ force: true }).catch(() => null)
  await shot('event-editor')
  await page.keyboard.press('Escape')
  await go(slug)
  await page.locator('.bcstage [data-bc-contact]').first().click({ force: true }).catch(() => null)
  await shot('contact-record')
  await go(slug)
  await page.locator('.bcstage [data-bc-doc]').first().click({ force: true }).catch(() => null)
  await shot('document-viewer')
  await go(slug)
  await page.locator('.bcstage [data-bc-task-open]').first().click({ force: true }).catch(() => null)
  await shot('task-record')
  console.log(scheme, errs.length === 0 ? 'no page errors' : errs.join(' | '))
  await ctx.close()
}
await browser.close()
server.close()
