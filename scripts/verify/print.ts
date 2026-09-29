/**
 * The project on paper (#125).
 *
 *   npm run verify:print
 *
 * Grant asked for a print stylesheet and named the thing that goes wrong with
 * one: *"Print is a real layout, not a hidden-nav hack. Capture it — Chromium
 * can screenshot with media: 'print' — and look at it, per the visual standard.
 * A print sheet nobody has looked at is a print sheet with a heading orphaned
 * on page two."*
 *
 * So this emulates print media, captures it, and asserts the three properties a
 * capture cannot: that the briefing is actually there, that the controls are
 * not, and that **nothing appears on paper that is hidden on screen** — which
 * is the issue's own constraint and the only one with a consequence worse than
 * an ugly page.
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const ROOT = 'web/studio'
const PORT = 4653
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
}
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  const wants = path === '/' || !path.includes('.') ? 'index.html' : path.replace(/^\//, '')
  try {
    const body = await readFile(join(ROOT, wants))
    res.writeHead(200, { 'content-type': TYPES[extname(wants)] ?? 'application/octet-stream' })
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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1200, height: 1600 } })).newPage()
await page.goto(`http://127.0.0.1:${String(PORT)}/classic/`)
await page.waitForSelector('.rail', { timeout: 20_000 })
await page.waitForTimeout(2200)
await page.locator('.homego[data-open], .project[data-open]').first().click({ force: true })
await page.waitForTimeout(1500)

console.log('#125 — a project as one page you can hand to someone\n')

/*
  What the STUDIO shows for this project, across its tabs.

  Not the Overview alone, which is what a first draft used: a contact's role and
  a source's description are on the Contacts and Sources tabs, so the check
  reported the briefing's own contents as paper-only and the finding was about
  which screen the suite happened to be on. "Hidden on screen" means the studio
  does not show it anywhere, and the only way to ask that is to look everywhere.
*/
/*
  `textContent`, not `innerText`, and the difference is the whole point.

  The question is whether a word can reach paper without the screen holding it
  — a token the MCP tab does not render is not in the DOM at all. `innerText`
  answers a different question, "is it visible right now", and a first run
  reported the waiting ribbon's own copy as paper-only because that detail is
  collapsed behind a disclosure.
*/
let onScreen = ''
for (const tab of ['overview', 'documents', 'tasks', 'contacts', 'sources']) {
  const t = page.locator(`[data-tab="${tab}"]`).first()
  if ((await t.count()) === 0) continue
  await t.click({ force: true })
  await page.waitForTimeout(700)
  onScreen += ` ${String(await page.evaluate(`document.body.textContent ?? ''`))}`
}
await page.locator('[data-tab="overview"]').first().click({ force: true })
await page.waitForTimeout(900)

await page.emulateMedia({ media: 'print' })
await page.waitForTimeout(600)

{
  const brief = await page.locator('.printonly').first()
  const shown = await brief.isVisible()
  check('the briefing appears on paper', shown ? 'it is there' : 'NOTHING TO PRINT', shown)
  const parts = await page.locator('.printpart h3').allTextContents()
  check(
    'and it carries the sections the issue asks for',
    parts.join(', ') || '(none)',
    parts.length >= 2,
  )
}

{
  const controls = (await page.evaluate(`(() => {
    const gone = ['.rail', '.planeport', '.mapbar', '.segmented', '.dock', '.filters']
    const still = []
    for (const sel of gone) {
      for (const el of document.querySelectorAll(sel)) {
        const box = el.getBoundingClientRect()
        if (box.width > 0 && box.height > 0) { still.push(sel); break }
      }
    }
    return still
  })()`)) as string[]
  check(
    'and the ways to do something are not on it',
    controls.length === 0
      ? 'rail, map, filters and dock all gone'
      : `STILL PRINTED: ${controls.join(', ')}`,
    controls.length === 0,
  )
}

{
  /*
    The constraint with a real consequence.

    Every line of the briefing is assembled from the project payload the tabs
    already render, so nothing should appear on paper that the screen withholds.
    Asserted rather than asserted-in-a-comment: the words on paper that are not
    anywhere on the screen, with the ones the sheet adds itself excluded by
    name.
  */
  const onPaper = String(
    await page.evaluate(`document.querySelector('.printonly')?.innerText ?? ''`),
  )
  /*
    Case-insensitively, because the sheet uppercases its own section headings —
    a first run reported "WAITING ON YOU" as words the screen does not have,
    about a heading this file writes three lines above.
  */
  const ours = new Set([
    'waiting',
    'on',
    'you',
    'open',
    'tasks',
    'recent',
    'documents',
    'people',
    'what',
    'it',
    'reads',
    'from',
    'where',
    'stands',
    'due',
    '—',
  ])
  const screenWords = new Set(
    onScreen
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== ''),
  )
  const strangers = onPaper
    .split(/\s+/)
    .filter((w) => w !== '' && !ours.has(w.toLowerCase()) && !screenWords.has(w.toLowerCase()))
    .filter(
      (w) =>
        !/^\d/.test(w) &&
        !/^(January|February|March|April|May|June|July|August|September|October|November|December)$/.test(
          w,
        ),
    )
  check(
    'nothing is on paper that is not on the screen',
    strangers.length === 0
      ? 'every word appears on screen too'
      : `ONLY ON PAPER: ${strangers.slice(0, 6).join(' ')}`,
    strangers.length === 0,
  )
}

await page.screenshot({ path: '.out/print-project.png', fullPage: true })
console.log('\n  wrote .out/print-project.png — open it, per the visual standard')

await browser.close()
server.close()
const passed = checks.filter(Boolean).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length ? 0 : 1)
