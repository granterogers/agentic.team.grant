/**
 * Render the prototype, capture it, and put the pictures where they can be
 * judged.
 *
 *   npm run shots
 *
 * §14A: *"Never evaluate visual quality from source code alone."* This runs the
 * real files in a real browser at real sizes, in both themes, and writes PNGs.
 * It is not a pass/fail harness — it is the capture half of the
 * render→capture→critique loop, and the critique is done by looking.
 */

import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

const ROOT = 'web/studio'
const OUT = '.out'
const PORT = 4610

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
await new Promise<void>((r) =>
  server.listen(PORT, '127.0.0.1', () => {
    r()
  }),
)
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const shots: string[] = []

const SIZES = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', devices['iPhone 14']],
] as const

for (const [size, opts] of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${String(PORT)}/`, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    })
    await page.waitForTimeout(900)

    const shoot = async (name: string) => {
      const file = `${OUT}/${name}-${size}-${scheme}.png`
      await page.screenshot({ path: file, fullPage: false })
      shots.push(file)
    }

    await shoot('portfolio')
    // Into a project, which is the shared-element transition.
    await page.locator('[data-open="legacy-coaching-course"]').click()
    await page.waitForTimeout(900)
    await shoot('project')
    // And a document, which is the second one.
    await page.locator('[data-doc="0"]').click()
    await page.waitForTimeout(700)
    await shoot('document')

    // Anything thrown while doing all that is a defect, not a note.
    if (errors.length > 0) {
      console.error(`  ${size}/${scheme} threw: ${errors.join(' · ')}`)
    }

    // Overflow is the failure that only shows on a phone.
    const wide = await page.evaluate(
      'document.documentElement.scrollWidth > document.documentElement.clientWidth + 2',
    )
    if (wide === true) console.error(`  ${size}/${scheme} OVERFLOWS sideways`)

    await ctx.close()
  }
}

await browser.close()
server.close()
console.log(shots.join('\n'))
