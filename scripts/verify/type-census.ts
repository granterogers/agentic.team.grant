// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: an audit script
/**
 * Typography census (aesthetic sprint, 9 October 2026): how many distinct sizes, weights and line heights do the surfaces use?
 * It counts text by rendered size on the board, the open menu, the chat, a maximised module and every Settings tab, and
 * prints the distribution. It does not fail on a count by default; TYPE_BUDGET=n fails when more than n distinct sizes carry
 * more than 1% of the text, so a scale that drifts can be held.
 *
 *   npx tsx scripts/verify/type-census.ts
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const PORT = 4718
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const COUNT = `(() => { const out = {}; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.textContent.trim(); if (!t) continue; const e = n.parentElement; if (!e || e.closest('script, style, .bcvh, .aonly, [hidden], #gallery')) continue; const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') continue; const k = parseFloat(s.fontSize).toFixed(1); out[k] = (out[k] || 0) + t.length } return out })()`
const tally: Record<string, number> = {}
const add = (o: Record<string, number>): void => { for (const [k, v] of Object.entries(o)) tally[k] = (tally[k] ?? 0) + v }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(`localStorage.setItem('studio.appearance', JSON.stringify({ palette: 'slate', texture: 'concrete', scheme: 'dark', density: 'comfortable' }))`)
const page = await ctx.newPage()
await page.goto(`http://127.0.0.1:${String(PORT)}/basecamp`); await page.waitForTimeout(600)
const slug = (await page.evaluate(`document.querySelector('[data-bc-go^="/p/"]').dataset.bcGo`)) as string
const go = async (p: string): Promise<void> => { await page.goto(`http://127.0.0.1:${String(PORT)}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(700) }
const press = async (sel: string): Promise<void> => { await page.locator(sel).first().click({ force: true }).catch(() => null); await page.waitForTimeout(450) }
await go(slug); add((await page.evaluate(COUNT)) as any)
await press('[data-bc-menu]'); add((await page.evaluate(COUNT)) as any); await page.keyboard.press('Escape')
await go(slug); await press('[data-bc-dock]'); add((await page.evaluate(COUNT)) as any)
for (const m of ['tasks', 'board', 'documents', 'schedule', 'contacts', 'activity']) { await go(slug); await press(`.bcstage [data-mod="${m}"] [data-bc-expand], .bcstage [data-mod="${m}"] [data-expand]`); add((await page.evaluate(COUNT)) as any) }
await go(slug); await press('[data-bc-settings]')
for (const t of ['team', 'behaviour', 'requests', 'memory', 'connections', 'channels', 'appearance', 'models', 'help']) { await press(`#settings [data-setting="${t}"]`); add((await page.evaluate(COUNT)) as any) }
for (const p of ['/search', '/tasks', '/activity', `${slug}/settings`]) { await go(p); add((await page.evaluate(COUNT)) as any) }
await browser.close(); server.close()

const total = Object.values(tally).reduce((a, b) => a + b, 0)
const rows = Object.entries(tally).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0])
console.log('size  share   characters')
for (const [k, v] of rows) console.log(`${k.toFixed(1).padStart(5)}  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${String(v)}`)
const carrying = rows.filter(([, v]) => v / total > 0.01).length
console.log(`\n${String(rows.length)} distinct sizes, ${String(carrying)} carry more than 1% of the text`)
const budget = Number(process.env.TYPE_BUDGET ?? 0)
process.exit(budget > 0 && carrying > budget ? 1 : 0)
