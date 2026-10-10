// biome-ignore-all format: a list of pairs
/* Side-by-side contact sheets: the captures from before the aesthetic pass beside the same view now. Captures only. */
import '../../src/safety/arm.ts'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const BEFORE = process.argv[2] ?? '.out/aesthetic-before'
const AFTER = process.argv[3] ?? '.out/final/desktop-clay'
const OUT = process.argv[4] ?? '.out/compare'
await mkdir(OUT, { recursive: true })
const PAIRS = ['dark-board', 'dark-dock', 'dark-maximised-schedule', 'light-maximised-schedule', 'dark-settings', 'light-board', 'dark-team', 'dark-look-walnut']
const uri = async (p: string): Promise<string> => `data:image/png;base64,${(await readFile(p)).toString('base64')}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 560 } })
for (const name of PAIRS) {
  const b = await uri(`${BEFORE}/clay-${name}.png`).catch(() => '')
  const a = await uri(`${AFTER}/clay-${name}.png`).catch(() => '')
  if (b === '' || a === '') continue
  await page.setContent(`<body style="margin:0;background:#111;color:#ddd;font:600 14px system-ui"><div style="display:flex;gap:8px;padding:8px"><figure style="margin:0;flex:1"><figcaption style="padding:2px 0">before — ${name}</figcaption><img src="${b}" style="width:100%"></figure><figure style="margin:0;flex:1"><figcaption style="padding:2px 0">after</figcaption><img src="${a}" style="width:100%"></figure></div></body>`)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}
await browser.close()
