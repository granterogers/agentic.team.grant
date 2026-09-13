/**
 * All six materials, side by side, so a person can pick.
 *
 *   npm run textures:sheet
 *
 * Issue #206. Grant asked for choice — *"give some choice obviously"* — and a
 * choice nobody can see is a list of words. This paints the same corner of the
 * same screen with each material in turn and writes the crops out, so they can
 * be looked at together rather than one reload at a time.
 *
 * Both schemes, because each material ships as two cuts: its shadows in black
 * for a light page, its highlights in white for a dark one. A material that
 * works on paper and dies on charcoal is a material that has only been half
 * looked at.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { seedAppearance } from './seed-appearance.ts'

const ROOT = 'web/studio'
const PORT = 4618
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
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

const MATERIALS = [
  'none',
  'plaster',
  'paper',
  'travertine',
  'oak',
  'linen',
  'concrete',
  'granite',
  'basalt',
  'sandstone',
  'terrazzo',
  'steel',
]

const browser = await chromium.launch()
for (const dark of [false, true]) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: dark ? 'dark' : 'light',
  })
  await ctx.addInitScript(seedAppearance(dark ? 'dark' : 'light'))
  const page = await ctx.newPage()
  await page.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.project[data-open="legacy-coaching-course"]').first().click()
  await page.waitForTimeout(700)

  for (const m of MATERIALS) {
    await page.evaluate(`document.documentElement.dataset.texture = ${JSON.stringify(m)}`)
    // Long enough for the WebP to be fetched and painted the first time.
    await page.waitForTimeout(700)
    await page.screenshot({
      path: `.out/texture-${m}-${dark ? 'dark' : 'light'}.png`,
      clip: { x: 250, y: 300, width: 780, height: 340 },
    })
    console.log(`  .out/texture-${m}-${dark ? 'dark' : 'light'}.png`)
  }
  await ctx.close()
}
await browser.close()
server.close()
