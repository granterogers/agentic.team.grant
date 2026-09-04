/**
 * Rasterise the staff avatars to PNG.
 *
 *   npm run avatars:png
 *
 * ## Why PNG exists alongside the SVG
 *
 * The SVG is the source: versioned, diffable, deterministic, no image service.
 * But the two places these are actually consumed will not take one.
 *
 *   * Slack's `chat:write.customize` takes an `icon_url`, and Slack does not
 *     render SVG.
 *   * Telegram bot profile photos are uploaded as raster images.
 *
 * So the PNGs are a build output, generated from the SVG rather than drawn.
 * Regenerating them cannot make them disagree with the source, which is the
 * only property that matters for a derived asset.
 *
 * Rendered through the Chromium that is already installed for Playwright, so
 * this adds no dependency and no credential. 512px because Slack downscales
 * and a 256px source looks soft on a retina sidebar.
 */
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ROLE_SLUGS } from '../../src/agents/router.ts'

const SVG_DIR = 'assets/avatars'
const PNG_DIR = 'assets/avatars/png'
const SIZE = 512

const chromium = async (): Promise<string> => {
  const roots = await readdir('/opt/pw-browsers')
  const dir = roots.find((d) => d.startsWith('chromium-'))
  if (dir === undefined) throw new Error('no chromium under /opt/pw-browsers')
  return join('/opt/pw-browsers', dir, 'chrome-linux', 'chrome')
}

const shot = (browser: string, html: string, out: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const p = spawn(browser, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      // A transparent ground, so the avatar's own circle is the shape rather
      // than a white square with a circle painted on it.
      '--default-background-color=00000000',
      `--window-size=${String(SIZE)},${String(SIZE)}`,
      `--screenshot=${out}`,
      `file://${html}`,
    ])
    p.on('error', reject)
    p.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`chromium exited ${String(code)}`))
    })
  })

await mkdir(PNG_DIR, { recursive: true })
const browser = await chromium()
const written: string[] = []

for (const slug of ROLE_SLUGS) {
  const svg = await readFile(join(SVG_DIR, `${slug}.svg`), 'utf8')
  // The SVG is embedded rather than linked so the page needs no second fetch,
  // and sized to fill exactly, so the screenshot has no margin to trim.
  const page = join(PNG_DIR, `.${slug}.html`)
  await writeFile(
    page,
    `<!doctype html><meta charset="utf-8"><style>
       html,body{margin:0;padding:0;background:transparent;width:100%;height:100%}
       /* 100vw/100vh, not a pixel size. Set in px, headless Chromium rendered
          the SVG at about 84% of the window and left a transparent margin -
          invisible at thumbnail size and obvious at 512. Filling the viewport
          makes the output size the window size by construction. */
       svg{display:block;width:100vw;height:100vh}
     </style>${svg}`,
    'utf8',
  )
  const out = join(process.cwd(), PNG_DIR, `${slug}.png`)
  await shot(browser, join(process.cwd(), page), out)
  written.push(`${slug}.png`)
}

// The scratch HTML is not an output. Left behind, it would be committed, and a
// build artefact in the repository is how the source stops being the source.
for (const slug of ROLE_SLUGS) {
  await writeFile(join(PNG_DIR, `.${slug}.html`), '', 'utf8')
}
const { unlink } = await import('node:fs/promises')
for (const slug of ROLE_SLUGS) await unlink(join(PNG_DIR, `.${slug}.html`))

console.log(`rendered ${String(written.length)} PNG(s) at ${String(SIZE)}px into ${PNG_DIR}/`)
console.log(written.join(', '))
