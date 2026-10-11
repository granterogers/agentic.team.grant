// biome-ignore-all format: a list of pairs
/**
 * Before-and-after sheets from two surface-lab output directories (same file names), for the surfaces that changed.
 *
 *   npx tsx scripts/verify/lab-compare.ts .out/before-sprint .out/after-sprint .out/sprint-compare
 */
import '../../src/safety/arm.ts'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const BEFORE = process.argv[2] ?? '.out/before-sprint'
const AFTER = process.argv[3] ?? '.out/after-sprint'
const OUT = process.argv[4] ?? '.out/sprint-compare'
await mkdir(OUT, { recursive: true })
const PAIRS: [string, string][] = [
  ['page-menu__desktop1440-dark-slate', 'The page menu: 18px plain list, now the menu system'],
  ['project-board__desktop1440-light-slate', 'Light board: document pages were near-black slabs, now paper'],
  ['chat-dock__desktop1440-dark-slate', 'Chat open: the To-dos switch was cut mid-word, the speaker line was 10.5px'],
  ['background-picker__phone390-dark-slate', 'Phone picker: 24px swatches, 36px chips, a strip with no sign there is more'],
  ['event-editor__phone390-dark-slate', 'Phone event editor: 36px fields at 14px type'],
  ['module-maximised-schedule__phone390-dark-slate', 'Phone schedule: 30px Day / Week / Month'],
  ['jump-overlay__desktop1440-dark-slate', 'Command bar: the label sat on the input'],
  ['project-board__phone390-light-slate', 'Phone board, light'],
]
const uri = async (p: string): Promise<string> => `data:image/png;base64,${(await readFile(p)).toString('base64')}`
const browser = await chromium.launch()
for (const [name, caption] of PAIRS) {
  const b = await uri(`${BEFORE}/${name}.png`).catch(() => '')
  const a = await uri(`${AFTER}/${name}.png`).catch(() => '')
  if (b === '' || a === '') { console.log(`skipped ${name}: a side is missing`); continue }
  const phone = name.includes('phone')
  const page = await browser.newPage({ viewport: { width: phone ? 900 : 1700, height: 400 } })
  await page.setContent(`<body style="margin:0;background:#111;color:#ddd;font:600 15px system-ui"><div style="padding:8px 10px">${caption}</div><div style="display:flex;gap:10px;padding:0 10px 10px;justify-content:center"><figure style="margin:0;flex:1;max-width:${phone ? '420px' : '830px'}"><figcaption style="padding:2px 0;color:#f99">before</figcaption><img src="${b}" style="width:100%"></figure><figure style="margin:0;flex:1;max-width:${phone ? '420px' : '830px'}"><figcaption style="padding:2px 0;color:#9f9">after</figcaption><img src="${a}" style="width:100%"></figure></div></body>`)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await page.close()
}
await browser.close()
