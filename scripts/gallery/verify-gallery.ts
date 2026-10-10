// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
/**
 * Opens the finished gallery in Chromium and checks that every image it references loads (thumbnails; full-resolution links exist on disk
 * when screenshots/ is present), that every manifest entry appears on the page, and that the page does not overflow a phone.
 *
 *   npx tsx scripts/gallery/verify-gallery.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

declare const document: any
const DIR = 'docs/integration/final-visual-gallery'
const manifest = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8')) as {
  entries: { file: string; id: string }[]
}
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const hasFull = existsSync(`${DIR}/screenshots`)
const missingThumb = manifest.entries.filter(
  (e) =>
    !existsSync(`${DIR}/${e.file.replace('screenshots/', 'thumbs/').replace(/\.png$/, '.jpg')}`),
)
check(
  'every entry has a thumbnail',
  missingThumb.length === 0,
  missingThumb
    .slice(0, 2)
    .map((e) => e.id)
    .join(', '),
)
if (hasFull) {
  const missing = manifest.entries.filter((e) => !existsSync(`${DIR}/${e.file}`))
  check(
    'every entry has its full-resolution PNG',
    missing.length === 0,
    missing
      .slice(0, 2)
      .map((e) => e.id)
      .join(', '),
  )
} else
  console.log(
    'note full-resolution PNGs are not in this checkout (they ship in the ZIP); only thumbnails were checked',
  )

const browser = await chromium.launch()
for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const bad: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(r.url())
  })
  await page.goto(`file://${process.cwd()}/${DIR}/index.html`)
  await page.evaluate(`document.querySelectorAll('img').forEach((i) => { i.loading = 'eager' })`)
  await page
    .waitForFunction(`[...document.images].every((i) => i.complete)`, undefined, { timeout: 30000 })
    .catch(() => null)
  const r = (await page.evaluate(
    `(() => { const im = [...document.images]; return { n: im.length, broken: im.filter((i) => i.naturalWidth === 0).map((i) => i.src.slice(-70)), sw: document.documentElement.scrollWidth } })()`,
  )) as { n: number; broken: string[]; sw: number }
  check(
    `${w}px: ${r.n} images, all load`,
    r.n === manifest.entries.length && r.broken.length === 0,
    r.broken.slice(0, 2).join(', '),
  )
  check(`${w}px: no horizontal overflow`, r.sw <= w + 1, String(r.sw))
  check(`${w}px: no failed request`, bad.length === 0, bad.slice(0, 2).join(', '))
  await page.close()
}
await browser.close()
process.exit(failed === 0 ? 0 : 1)
