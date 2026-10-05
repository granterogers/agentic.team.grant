/**
 * Capture Global Settings as the signed-in Sample Person, with populated state, at four widths.
 *   npx tsx scripts/sample/settings-shots-live.ts <label> [tab ...]
 * Writes .out/settings-live-<label>/<viewport>-<tab>.png and prints page errors. Reads only.
 */
import { mkdirSync } from 'node:fs'
import { closeSettings, newPage, openSettings, signIn, startStudio } from './browser.ts'
import { session } from './lib.ts'

const label = process.argv[2] ?? 'a'
const only = process.argv.slice(3)
const TABS = [
  'team',
  'behaviour',
  'requests',
  'memory',
  'connections',
  'channels',
  'appearance',
  'models',
  'help',
]
const VPS = [
  { name: 'wide', width: 1680, height: 1000, touch: false },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'tablet', width: 820, height: 1100, touch: true },
  { name: 'phone', width: 390, height: 844, touch: true },
]
const UNCLIP = `
  #settings.page { position: static !important; height: auto !important; overflow: visible !important; }
  #settings .stg { height: auto !important; display: block !important; }
  #settings .stg-body { display: grid !important; height: auto !important; }
  #settings .stg-main, #settings .stg-nav { overflow: visible !important; height: auto !important; }
  html, body { overflow: visible !important; height: auto !important; }
  #root { display: none !important; }`
const out = `.out/settings-live-${label}`
mkdirSync(out, { recursive: true })
const s = await session()
const studio = await startStudio(4811)
const problems: string[] = []
for (const vp of VPS) {
  const { ctx, page, errors } = await newPage(studio, vp, vp.touch)
  await signIn(studio, page, s)
  for (const tab of TABS.filter((t) => only.length === 0 || only.includes(t))) {
    await openSettings(page, tab)
    await page.waitForTimeout(1200)
    const wide = (await page.evaluate(
      `document.documentElement.scrollWidth - innerWidth`,
    )) as number
    if (wide > 1) problems.push(`${vp.name}/${tab}: sideways by ${wide}px`)
    const style = await page.addStyleTag({ content: UNCLIP })
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${out}/${vp.name}-${tab}.png`, fullPage: true })
    await style.evaluate((n) => n.remove())
    await closeSettings(page)
  }
  for (const e of errors) problems.push(`${vp.name}: page error ${e}`)
  await ctx.close()
}
await studio.close()
console.log(`captured to ${out}`)
for (const p of problems) console.log(`  ! ${p}`)
