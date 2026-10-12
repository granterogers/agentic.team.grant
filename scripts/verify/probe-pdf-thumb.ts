/**
 * Render real first-page thumbnails from the repository's sample PDFs with the bundled pdf.js, in a real
 * browser, using the same calls the document tiles use (pdf.pages then docthumbs.shrink).
 *
 *   npx tsx scripts/verify/probe-pdf-thumb.ts
 *
 * Writes .out/probe/thumb-<name>.png for each sample and reports whether a thumbnail was produced.
 * Nothing is stored or sent; the thumbnail cache (localStorage) is not written by this probe.
 * Serves web/studio locally.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const SAMPLES = ['ws01.pdf', 'journey.pdf', 'one-pager.pdf']

type Thumb = { ok: boolean; dataUrl: string | null; total: number | null }

const { port, close } = await serve()
const browser = await chromium.launch()
try {
  await mkdir(join(process.cwd(), '.out', 'probe'), { recursive: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  for (const name of SAMPLES) {
    const result: Thumb = await page.evaluate(async (file) => {
      const pdf = await import('/pdf.js')
      const shrink = (await import('/bc/docthumbs.js')).shrink
      const rendered = await pdf.pages(`/samples/${file}`, 220, 1)
      const first = rendered.pages[0]
      if (!first) return { ok: false, dataUrl: null, total: null }
      const small = await shrink(first.src, 220)
      const ok = typeof small === 'string' && small.startsWith('data:image/')
      return { ok, dataUrl: ok ? small : null, total: rendered.total ?? null }
    }, name)
    if (result.dataUrl !== null) {
      const base64 = result.dataUrl.split(',')[1] ?? ''
      const file = `thumb-${name.replace('.pdf', '')}.png`
      await writeFile(join(process.cwd(), '.out', 'probe', file), Buffer.from(base64, 'base64'))
    }
    console.log(JSON.stringify({ sample: name, ok: result.ok, pages: result.total }))
  }
  console.log(JSON.stringify({ pageErrors: errors.slice(0, 3) }))
} finally {
  await browser.close()
  close()
}
