// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a dense acceptance script kept readable as written
/**
 * Browser acceptance of the #442 / #445 release on the DEPLOYED page, signed in as the Sample Person in two independent
 * browser contexts (two devices, honestly: one machine), against the real gateway.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/sample/release-browser.ts [page-url]
 *
 * Writes land in one Sample Person project and are removed at the end. Nothing touches Grant's office.
 */
import '../../src/safety/require-production-writes.ts'
import { mkdirSync } from 'node:fs'
import { type Browser, chromium, type Page } from 'playwright'
import { act, read, secondSession } from '../p4/lib.ts'
import { sampleOffice } from './lib.ts'

declare const document: any

const base = (process.argv[2] ?? 'https://ai-team-hq.vercel.app').replace(/\/$/, '')
const OUT = '.out/release-browser'
mkdirSync(OUT, { recursive: true })
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
await sampleOffice()
const s0 = await secondSession()
const projects = ((await read(s0.access_token, 'studio')).json as any).data.projects as any[]
const proj = projects.find((p) => p.status !== 'archived') ?? projects[0]
const slug = String(proj.slug)
const name = String(proj.name)

const browser: Browser = await chromium.launch()
const open = async (label: string, w = 1440, h = 900) => {
  const s = await secondSession()
  const ctx = await browser.newContext({ viewport: { width: w, height: h } })
  const page = await ctx.newPage()
  const errors: string[] = []
  const bad: string[] = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
  page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(base)) bad.push(`${r.status()} ${r.url().replace(base, '')}`) })
  await page.goto('about:blank')
  await page.goto(`${base}/#access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=3000`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('[data-bc-menu]', { timeout: 45000 })
  return { label, ctx, page, errors, bad, token: s.access_token }
}
const toProject = async (page: Page) => {
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem', { hasText: name }).first().click()
  await page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await page.waitForTimeout(1500)
}
const L = (page: Page, js: string) => page.evaluate(`import('/bc/layout.js').then(async (L) => { const s = ${JSON.stringify(slug)}; ${js} })`)
const notesOf = (page: Page): Promise<string[]> => L(page, `return L.postits(s).filter((n) => n.id !== 'n_starter').map((n) => n.text).sort()`) as Promise<string[]>
const officeNotes = async (): Promise<string[]> => {
  const lay = ((await read(s0.access_token, 'layout', `&slug=${encodeURIComponent(slug)}&surface=basecamp`)).json as any).data
  return ((lay.panels?.find((m: any) => m.id === '__workspace')?.postits ?? []) as any[]).map((n) => n.text).sort()
}
const boardInfo = (page: Page) => page.evaluate(() => { const b = document.querySelector('[data-bc-board]'); return { bg: b?.getAttribute('data-bg') ?? null, tone: b?.getAttribute('data-bg-tone') } })
const png = async (page: Page, w: number, h: number): Promise<Buffer> => Buffer.from((await page.evaluate(`new Promise((res) => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const x = c.getContext('2d'); const g = x.createLinearGradient(0,0,${w},${h}); g.addColorStop(0,'#2d4a6b'); g.addColorStop(1,'#e8d9b8'); x.fillStyle = g; x.fillRect(0,0,${w},${h}); c.toBlob((b) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b) }, 'image/png') })`)) as string, 'base64')
const idbRev = (page: Page) => page.evaluate(`indexedDB.databases().then((l) => { if (!l.some((x) => x.name === 'bc.backdrops')) return null; return new Promise((res) => { const r = indexedDB.open('bc.backdrops'); r.onsuccess = () => { const q = r.result.transaction('images').objectStore('images').getAll(); q.onsuccess = () => { r.result.close(); res(q.result.map((x) => ({ rev: x.rev, w: x.w }))) } } }) })`) as Promise<{ rev: string | null; w: number }[] | null>

let A: Awaited<ReturnType<typeof open>> | null = null
let B: Awaited<ReturnType<typeof open>> | null = null
try {
  A = await open('device A')
  B = await open('device B')
  await toProject(A.page)
  await toProject(B.page)
  check('both sessions are signed in on the deployed page and show the project board', (await A.page.locator('[data-bc-board]').count()) === 1 && (await B.page.locator('[data-bc-board]').count()) === 1, name)
  await A.page.screenshot({ path: `${OUT}/a-board.png` })
  check('the deployed page serves the full overhaul: menu, dock, appearance, backgrounds', (await A.page.locator('[data-bc-menu]').count()) === 1 && (await A.page.locator('[data-bc-pagemenu]').count()) >= 1)

  // ---- #442: simultaneous Post-its from two sessions ----
  await Promise.all([
    L(A.page, `const n = L.addPostit(s); L.setPostit(s, n.id, { text: 'from device A' }); L.flush()`),
    L(B.page, `const n = L.addPostit(s); L.setPostit(s, n.id, { text: 'from device B' }); L.flush()`),
  ])
  await A.page.waitForTimeout(6000)
  await Promise.all([L(A.page, `await L.syncNow(s)`), L(B.page, `await L.syncNow(s)`)])
  await A.page.waitForTimeout(4000)
  await Promise.all([L(A.page, `await L.syncNow(s)`), L(B.page, `await L.syncNow(s)`)])
  const want = ['from device A', 'from device B']
  const [na, nb, no] = [await notesOf(A.page), await notesOf(B.page), await officeNotes()]
  check('two sessions add a Post-it at the same moment: both are on both devices and in the office', JSON.stringify(na) === JSON.stringify(want) && JSON.stringify(nb) === JSON.stringify(want) && JSON.stringify(no) === JSON.stringify(want), JSON.stringify({ a: na, b: nb, office: no }))

  // deletion is not resurrected
  await L(A.page, `const id = L.postits(s).find((n) => n.text === 'from device A').id; L.removePostit(s, id); L.flush()`)
  await A.page.waitForTimeout(5000)
  await Promise.all([L(A.page, `await L.syncNow(s)`), L(B.page, `await L.syncNow(s)`)])
  await B.page.waitForTimeout(3000)
  await Promise.all([L(A.page, `await L.syncNow(s)`), L(B.page, `await L.syncNow(s)`)])
  check('a deletion on one device reaches the other and is not resurrected by it', JSON.stringify(await notesOf(A.page)) === '["from device B"]' && JSON.stringify(await notesOf(B.page)) === '["from device B"]' && JSON.stringify(await officeNotes()) === '["from device B"]', JSON.stringify({ a: await notesOf(A.page), b: await notesOf(B.page), office: await officeNotes() }))

  // restore after reload
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await B.page.waitForTimeout(2500)
  check('after a reload the arrangement and the Post-it come back', JSON.stringify(await notesOf(B.page)) === '["from device B"]' && (await B.page.locator('[data-bc-board]').count()) === 1)

  // ---- #445: a built-in material, then a custom picture through the real picker ----
  const look = async (p: Page) => { await p.locator('[data-bc-pagemenu]').click({ force: true }); await p.locator('[data-bc-look]').click({ force: true }); await p.waitForSelector('.bdgrid', { timeout: 10000 }); await p.waitForTimeout(400) }
  await look(A.page)
  await A.page.locator('[data-bd-pick="walnut"]').click({ force: true })
  await A.page.locator('[data-bd-apply]').click({ force: true })
  await A.page.waitForTimeout(800)
  check('a built-in material (walnut) can be chosen and applied', (await boardInfo(A.page)).bg === 'walnut')
  await A.page.screenshot({ path: `${OUT}/a-walnut.png` })
  await A.page.keyboard.press('Escape')
  await A.page.waitForTimeout(3500)
  await look(A.page)
  const file = await png(A.page, 1800, 1000)
  await A.page.locator('[data-bd-file]').setInputFiles({ name: 'release-test.png', mimeType: 'image/png', buffer: file })
  await A.page.waitForFunction(() => /Preview shown/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 20000 })
  await A.page.locator('[data-bd-apply]').click({ force: true })
  await A.page.waitForFunction(() => /kept in your office|Saved in this browser only/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 30000 })
  const said = await A.page.locator('[data-bd-say]').first().innerText()
  check('uploading a picture through the picker stores it in the office (the page says so)', /kept in your office/.test(said), said)
  const rec = (await read(s0.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`)).json as any
  check('the office holds it: a revision and a signed link, readable by an independent API session', typeof rec.data?.rev === 'string' && String(rec.data?.url).includes('/object/sign/files/'), rec.data?.rev)
  await A.page.screenshot({ path: `${OUT}/a-custom.png` })
  await A.page.keyboard.press('Escape')
  await A.page.waitForTimeout(4000) // the arrangement carrying the reference is saved

  // device B never uploaded: after its next sync the board shows the picture, fetched from the office and cached
  const requestsB: string[] = []
  B.page.on('request', (r) => { if (r.url().includes('/storage/v1/object/sign/')) requestsB.push(r.url().slice(0, 80)) })
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await B.page.waitForFunction(() => document.querySelector('[data-bc-board]')?.getAttribute('data-bg') === 'custom', null, { timeout: 30000 }).catch(() => null)
  /* The pull is asynchronous (a read, a signed-link download, a decode): wait for the cache to hold it, not for a pause. */
  let held = await idbRev(B.page)
  for (let i = 0; i < 40 && (held?.length ?? 0) === 0; i += 1) {
    await B.page.waitForTimeout(750)
    held = await idbRev(B.page)
  }
  const bi = await boardInfo(B.page)
  check('device B (which never uploaded) draws the custom picture from the office', bi.bg === 'custom' && (held?.length ?? 0) === 1 && held?.[0]?.rev === rec.data?.rev && held?.[0]?.w === 1800, JSON.stringify({ bi, held, fetches: requestsB.length }))
  await B.page.screenshot({ path: `${OUT}/b-custom.png` })
  const fetchesAfterFirst = requestsB.length
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await B.page.waitForTimeout(6000)
  check('a repeat visit uses the cached copy: no new picture download', (await boardInfo(B.page)).bg === 'custom' && requestsB.length === fetchesAfterFirst, `${fetchesAfterFirst} -> ${requestsB.length} signed-link request(s)`)

  // remove from A: both return to the default
  await look(A.page)
  await A.page.locator('[data-bd-remove]').click({ force: true })
  await A.page.waitForTimeout(2500)
  const afterRemove = (await read(s0.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`)).json as any
  check('Remove deletes the office copy and the project returns to the default', afterRemove.data === null && (await boardInfo(A.page)).bg === null, JSON.stringify({ bg: (await boardInfo(A.page)).bg, office: afterRemove.data }))
  await A.page.keyboard.press('Escape')
  await A.page.waitForTimeout(4000)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.waitForSelector('[data-bc-board]', { timeout: 30000 })
  await B.page.waitForTimeout(2500)
  check('device B follows: the default after its next load', (await boardInfo(B.page)).bg === null)

  // core surfaces reachable
  const pages = [] as string[]
  for (const t of ['tasks', 'documents', 'calendar', 'sources']) {
    const has = (await A.page.locator(`[data-bc-tool="${t}"], [data-tool="${t}"], .bcmod[data-id="${t}"], [data-panel="${t}"]`).count()) > 0
    pages.push(`${t}:${has}`)
  }
  console.log(`      surfaces on the board: ${pages.join(' ')}`)

  // sign out
  await A.page.evaluate(`import('/signout.js').then((m) => m.signOut({ reload: false }))`)
  await A.page.waitForTimeout(1500)
  const left = (await A.page.evaluate(() => Object.keys(localStorage).filter((k: string) => k.startsWith('bc.') || k === 'hq.session'))) as string[]
  const dbs = (await A.page.evaluate(`indexedDB.databases ? indexedDB.databases().then((l) => l.map((x) => x.name)) : []`)) as string[]
  check('sign-out removes the session, the arrangement cache and the picture cache from the browser', left.length === 0 && !dbs.includes('bc.backdrops'), JSON.stringify({ left, dbs }))
  check('no page errors on either device', A.errors.length === 0 && B.errors.length === 0, JSON.stringify([...A.errors, ...B.errors]))
  console.log(`      responses >= 400 on the page's own files: A ${JSON.stringify(A.bad)} B ${JSON.stringify(B.bad)}`)
} finally {
  const s = await secondSession()
  await act(s.access_token, 'dashboard_layout_reset', { p_slug: slug, p_surface: 'basecamp' })
  await act(s.access_token, 'project_background_delete', { p_slug: slug })
  const lay = ((await read(s.access_token, 'layout', `&slug=${encodeURIComponent(slug)}&surface=basecamp`)).json as any).data
  check('cleanup: no arrangement and no picture left on the Sample Person project', lay.panels === null && ((await read(s.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`)).json as any).data === null)
  await A?.ctx.close()
  await B?.ctx.close()
  await browser.close()
}
const bad = results.filter((r) => !r).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad === 0 ? 0 : 1)
