// biome-ignore-all format: probe table kept as written
/**
 * Local look captures of the prototype: no office, no sign-in, nothing contacts production. The home and a project screen
 * in each scheme and each look, at desktop and phone width, for judging a look by eye.
 *
 *   npx tsx scripts/verify/look-shots.ts <tag> [look,look]
 */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const tag = process.argv[2] ?? 'looks'
const looks = (process.argv[3] ?? 'porcelain').split(',')
const dir = `.out/looks/${tag}`
mkdirSync(dir, { recursive: true })
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join('web/studio', extname(path) === '' ? 'index.html' : path.replace(/^\//, ''))
  try { res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(await readFile(file)) } catch { res.writeHead(404); res.end() }
})
await new Promise<void>((r) => server.listen(4893, '127.0.0.1', () => r()))
const browser = await chromium.launch()
for (const look of looks)
  for (const scheme of ['light', 'dark'] as const)
    for (const [vname, vp, touch] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]] as const) {
      const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch })
      await ctx.addInitScript(`localStorage.setItem('studio.appearance', JSON.stringify({ v: 3, scheme: '${scheme}', palette: 'slate', look: '${look}', texture: 'none', density: 'comfortable', glass: 'soft', depth: 'soft' }))`)
      const page = await ctx.newPage()
      await page.goto('http://127.0.0.1:4893/p/legacy-coaching-course', { waitUntil: 'load' })
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `${dir}/${look}-${scheme}-${vname}.png` })
      await ctx.close()
    }
await browser.close()
server.close()
process.exit(0)
