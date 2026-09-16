/**
 * Every representative screen on one wall.
 *
 *   npm run board            # build it, and render it to .out/board.png
 *   npm run board -- --open  # build only, and print the file to open
 *
 * §15 of the UX QA v2 standard. Its purpose is stated there and it is not
 * regression: *"DO THESE SCREENS LOOK LIKE ONE PRODUCT?"*
 *
 * `npm run shots` already renders about a hundred PNGs and they are useless for
 * that question, because you can only hold one at a time and the answer lives
 * in the comparison. This lays the representative ones out side by side, dark
 * beside light, desktop beside phone, so the eye can do what no assertion can.
 *
 * ## Representative, and it stays that way on purpose
 *
 * §15's own warning: *"Do not build a huge screenshot system nobody maintains.
 * Keep it representative."* So the wall names the screens it wants, and a
 * capture that is missing is drawn as a gap with its name on it rather than
 * skipped — a wall that quietly shrinks is a wall that stops answering the
 * question.
 *
 * ## It asserts nothing
 *
 * Like `space` and `system`, this is for reading. The judgement it feeds is
 * §22's, which is a person deciding whether the product looks like one product,
 * and §22 is explicit that a technically correct screen may still fail.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const OUT = '.out'

/*
  The wall, in the order a person meets the product.

  Eight rows, each a screen that answers a different question, plus the states
  that are easy to leave broken because nobody looks at them twice.
*/
const WALL: [string, string, string][] = [
  ['Home', 'portfolio', 'the global dashboard, the first thing anybody sees'],
  ['A project', 'project', 'the board, and the shell everything else lives in'],
  ['AI Team', 'team', 'who is on it, and what they are doing'],
  ['Chat', 'chat', 'the conversation, which is first-class'],
  ['Documents', 'documents', 'the gallery'],
  ['Tasks', 'tasks', 'a list'],
  ['Contacts', 'contacts', 'people'],
  ['Global settings', 'settings-connections', 'the densest form in the product'],
  ['Project Settings', 'settings-project-project', 'the other scope'],
  ['Governance', 'settings-governance', 'a reading surface'],
  ['Empty documents', 'empty-documents', 'the state that is easiest to leave ugly'],
  ['Empty tasks', 'empty-tasks', 'and its neighbour'],
  ['The call', 'talk-about-a-document', 'a sheet over the shell'],
  ['Command bar', 'command-bar', 'the fastest route to anything'],
]

const shot = (slug: string, size: 'desktop' | 'phone', theme: 'dark' | 'light') =>
  `${slug}-${size}-${theme}.png`

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

let missing = 0
const cell = (slug: string, size: 'desktop' | 'phone', theme: 'dark' | 'light') => {
  const file = shot(slug, size, theme)
  if (!existsSync(join(OUT, file))) {
    missing += 1
    return `<div class="gap"><span>${esc(file)}</span><b>not captured</b></div>`
  }
  return `<figure class="${size}"><img src="${esc(file)}" alt="${esc(file)}" loading="lazy">
    <figcaption>${esc(size)} · ${esc(theme)}</figcaption></figure>`
}

const rows = WALL.map(
  ([name, slug, why]) => `
  <section class="row">
    <header><h2>${esc(name)}</h2><p>${esc(why)}</p></header>
    <div class="shots">
      ${cell(slug, 'desktop', 'dark')}
      ${cell(slug, 'desktop', 'light')}
      ${cell(slug, 'phone', 'dark')}
      ${cell(slug, 'phone', 'light')}
    </div>
  </section>`,
).join('')

/*
  Deliberately plain.

  The wall is a neutral backdrop for judging a product's colour and weight, so
  it has almost no design of its own: a mid grey that flatters neither theme, a
  system face, and nothing rounded. A board styled in the product's own tokens
  would be marking its own homework.
*/
const page = `<!doctype html>
<html lang="en"><meta charset="utf-8">
<title>Agentic Team — the wall</title>
<style>
  :root { color-scheme: dark }
  body { margin: 0; padding: 28px; background: #6b6b6b; color: #111;
         font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #fff; }
  .lede { margin: 0 0 26px; color: #e8e8e8; max-width: 70ch; }
  .row { margin-bottom: 30px; }
  .row > header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
  .row h2 { font-size: 15px; margin: 0; color: #fff; }
  .row p { margin: 0; color: #dcdcdc; font-size: 12.5px; }
  .shots { display: flex; gap: 14px; align-items: flex-start; }
  figure { margin: 0; }
  figure img { display: block; border: 1px solid #3a3a3a; }
  figure.desktop img { width: 520px; }
  figure.phone img { width: 168px; }
  figcaption { color: #eaeaea; font-size: 11.5px; padding-top: 4px; }
  .gap { width: 200px; min-height: 120px; display: grid; place-items: center; gap: 4px;
         border: 1px dashed #3a3a3a; color: #eee; font-size: 11.5px; text-align: center; }
  .gap b { color: #ffd9a0; }
</style>
<h1>Agentic Team — every representative screen on one wall</h1>
<p class="lede">§15. Not regression: the question is whether these look like one
product. Dark beside light, desktop beside phone, in the order a person meets
them.</p>
${rows}
</html>`

await writeFile(join(OUT, 'board.html'), page)
console.log(
  `  wrote ${join(OUT, 'board.html')} — ${String(WALL.length)} screens, ${String(missing)} capture(s) missing`,
)
if (missing > 0)
  console.log('  (run npm run shots first; a gap is drawn where a capture should be)')

if (process.argv.includes('--open')) {
  console.log(`  open: file://${resolve(OUT, 'board.html')}`)
  process.exit(0)
}

/*
  And a single tall PNG of the whole wall.

  Because the point of a wall is that it is ONE image: a page of a hundred
  separate files is the thing this replaces, and a board you have to scroll in
  a browser you do not have is not a board Grant can look at. The PNG is what
  gets attached to a build step and linked in the reply.
*/
const PORT = 4667
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const file = join(OUT, path === '/' ? 'board.html' : basename(path))
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png',
    })
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

const browser = await chromium.launch()
const page2 = await (
  await browser.newContext({ viewport: { width: 1640, height: 1200 } })
).newPage()
await page2.goto(`http://127.0.0.1:${String(PORT)}/`, { waitUntil: 'networkidle' })
await page2.waitForTimeout(900)
await page2.screenshot({ path: join(OUT, 'board.png'), fullPage: true })
await browser.close()
server.close()
console.log(`  wrote ${join(OUT, 'board.png')}`)
