// biome-ignore-all lint/suspicious/noExplicitAny: browser objects inside page.evaluate
// biome-ignore-all format: a long assertion table, one check per line reads better than the formatter's wrapping
/**
 * The canvas background library, in real Chromium (#445).
 *   npx tsx scripts/verify/canvas-background.ts
 *
 * Runs against the working tree's page served locally (the prototype office: no network, no production). It drives the
 * picker in "How this project looks" and checks the REAL board: computed styles, decoded images, stored documents and the
 * browser's own database, not thumbnails. Captures go to .out/backgrounds/.
 *
 * Each assertion is pass, fail, or n/a (with the reason). Only pass counts as passing.
 */
import '../../src/safety/arm.ts'
import { mkdir } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import { serveStudio } from './serve-studio.ts'

declare const document: any
declare const window: any
declare const localStorage: any
declare const indexedDB: any

const PORT = 4695
const OUT = '.out/backgrounds'
await mkdir(OUT, { recursive: true })
const server = await serveStudio(PORT)
const browser = await chromium.launch()
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

type Verdict = 'pass' | 'fail' | 'n/a'
const results: { name: string; v: Verdict; detail: string }[] = []
const rec = (name: string, v: Verdict, detail = ''): void => {
  results.push({ name, v, detail })
  if (process.env.LIVE === '1')
    console.log(`${v === 'pass' ? 'pass' : v === 'fail' ? 'FAIL' : 'n/a '}  ${name}${detail === '' ? '' : ` - ${detail}`}`.slice(0, 220))
}
const check = (name: string, ok: boolean, detail = ''): void => rec(name, ok ? 'pass' : 'fail', detail)

const LIB = (await import('../../web/studio/textures/bg/library.json', { with: { type: 'json' } }))
  .default as { id: string; average: string; tone: string; tile: { w: number; h: number } }[]
const SOLIDS = 5

const newPage = async (w = 1440, h = 900, touch = false) => {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    hasTouch: touch,
    isMobile: touch,
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => requests.push(r.url()))
  page.on('load', () => console.log(`  [load] ${page.url().replace(/^https?:\/\/[^/]+/, '')}`))
  page.on('crash', () => console.log('  [CRASH]'))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) console.log(`  [console] ${m.text().slice(0, 160)}`)
  })
  return { ctx, page, errors, requests }
}
const pickProject = async (page: Page, nth: number): Promise<string> => {
  await page.click('[data-bc-menu]')
  await page.locator('.bcmenulist .bcmenuitem').nth(nth).click()
  await page.waitForSelector('[data-bc-board]')
  await page.waitForTimeout(700)
  return new URL(page.url()).pathname
}
const openLook = async (page: Page): Promise<void> => {
  await page.locator('[data-bc-pagemenu]').click({ force: true })
  await page.locator('[data-bc-look]').click({ force: true })
  await page.waitForSelector('.bdgrid', { timeout: 10000 })
  await page.waitForTimeout(400)
}
const closeLook = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('viewer')?.hidden === true, null, {
    timeout: 5000,
  })
  await page.waitForTimeout(300)
}
const pick = async (page: Page, id: string): Promise<void> => {
  await page.locator(`[data-bd-pick="${id}"]`).click({ force: true })
  await page.waitForTimeout(250)
}
const board = (page: Page): Promise<any> =>
  page.evaluate(() => {
    const b = document.querySelector('[data-bc-board]')
    const cs = window.getComputedStyle(b)
    return {
      bg: b.getAttribute('data-bg'),
      mode: b.getAttribute('data-bg-mode'),
      tone: b.getAttribute('data-bg-tone'),
      image: cs.backgroundImage,
      size: cs.backgroundSize,
      position: cs.backgroundPosition,
      repeat: cs.backgroundRepeat,
      color: cs.backgroundColor,
      why: b.getAttribute('data-bg-why'),
    }
  })
const doc = (page: Page, slug: string): Promise<any> =>
  page.evaluate(`JSON.parse(localStorage.getItem('bc.stage.${slug}') || 'null')`)
const say = (page: Page): Promise<string> =>
  page.locator('[data-bd-say]').first().innerText().catch(() => '') as Promise<string>
const idbRecords = (page: Page): Promise<number> =>
  page.evaluate(
    /* Looks first: opening a database that does not exist CREATES it (empty), which would make the page's own first open skip its upgrade. */
    `indexedDB.databases().then((l) => { if (!l.some((x) => x.name === 'bc.backdrops')) return 0; return new Promise((res) => { const r = indexedDB.open('bc.backdrops'); r.onerror = () => res(-1); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('images')) { db.close(); res(0); return } const q = db.transaction('images').objectStore('images').count(); q.onsuccess = () => { db.close(); res(q.result) } } }) })`,
  ) as Promise<number>
const png = async (page: Page, w: number, h: number, type = 'image/png'): Promise<Buffer> => {
  const b64 = (await page.evaluate(
    `new Promise((res) => { const c = document.createElement('canvas'); c.width = ${String(w)}; c.height = ${String(h)}; const x = c.getContext('2d'); const g = x.createLinearGradient(0,0,${String(w)},${String(h)}); g.addColorStop(0,'#2d4a6b'); g.addColorStop(1,'#e8d9b8'); x.fillStyle = g; x.fillRect(0,0,${String(w)},${String(h)}); x.fillStyle='rgba(255,255,255,.35)'; for (let i=0;i<40;i++) x.fillRect((i*97)%${String(w)}, (i*53)%${String(h)}, 60, 6); c.toBlob((b) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b) }, '${type}', 0.9) })`,
  )) as string
  return Buffer.from(b64, 'base64')
}
const bombPng = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  b[24] = 8
  b[25] = 2
  return b
}

/* ======================= desktop session ======================= */
const d = await newPage()
const { page } = d
await page.goto(url('/'), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-menu]')
const pathA = await pickProject(page, 0)
const slugA = pathA.split('/')[2] ?? ''
const pathB = await pickProject(page, 1)
const slugB = pathB.split('/')[2] ?? ''
const pathC = await pickProject(page, 2)
const slugC = pathC.split('/')[2] ?? ''
check('three different projects to test with', new Set([slugA, slugB, slugC]).size === 3, `${slugA} ${slugB} ${slugC}`)

/* the layout a person already has must survive: arrange A first */
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(700)
if ((await page.locator('.bcpostit').count()) === 0) await page.locator('.bcnoteempty').first().click()
else {
  await page.locator('.bcpostit').first().hover()
  await page.locator('.bcpostit [data-bc-note-add]').first().evaluate((el: any) => el.click())
}
await page.keyboard.type('keep me')
await page.locator('[data-bc-board]').click({ position: { x: 5, y: 5 }, force: true })
await page.waitForTimeout(600)
const head = (await page.evaluate(() => {
  const r = document.querySelector('[data-mod="contacts"] .bcmodhead').getBoundingClientRect()
  return { x: r.x + 20, y: r.y + 8 }
})) as { x: number; y: number }
await page.mouse.move(head.x, head.y)
await page.mouse.down()
await page.mouse.move(head.x + 80, head.y - 50, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(900)
const before = await doc(page, slugA)
check('A has an arrangement and a note before any background', before !== null && before.postits?.length > 0 && before.mods !== null)
check('and no background chosen yet (the microcement default)', (await board(page)).bg === null && before.bg == null)
const defaultShot = await board(page)

/* ---- 1. the gallery ---- */
d.requests.length = 0
await openLook(page)
const ids = (await page.locator('[data-bd-pick]').evaluateAll((els) => els.map((e: any) => e.dataset.bdPick))) as string[]
check(
  'the gallery lists default + every library texture + plain + solids',
  ids.length === 1 + LIB.length + 1 + SOLIDS && LIB.every((e) => ids.includes(e.id)),
  ids.join(','),
)
check('every choice has an accessible name', (await page.locator('[data-bd-pick]:not([aria-label])').count()) === 0)
check('exactly one choice is marked selected', (await page.locator('[data-bd-pick][aria-checked="true"]').count()) === 1)
const lazy = await page.locator('.bdgrid img.bdface').evaluateAll((els) => els.filter((e: any) => e.getAttribute('loading') === 'lazy').length)
check('gallery thumbnails are lazy', lazy >= LIB.length, String(lazy))
const fullFetched = d.requests.filter((u) => /\/textures\/bg\/[a-z0-9-]+\.webp$/.test(u))
check('opening the picker fetches no full-size texture', fullFetched.length === 0, fullFetched.join(' | '))
await page.screenshot({ path: `${OUT}/01-picker.png` })

/* ---- 2. every built-in, on the real board ---- */
for (const e of LIB) {
  await pick(page, e.id)
  const b = await board(page)
  const decoded = (await page.evaluate(
    `new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = '/textures/bg/${e.id}.webp' })`,
  )) as number
  check(
    `${e.id}: previews on the real board with its image decoded`,
    b.bg === e.id && b.image.includes(`/textures/bg/${e.id}.webp`) && decoded === e.tile.w,
    `${JSON.stringify({ bg: b.bg, tone: b.tone })} decoded ${String(decoded)}`,
  )
  await page.screenshot({ path: `${OUT}/mat-${e.id}.png` })
}

/* ---- 3. preview, then Cancel restores ---- */
await pick(page, 'walnut')
check('Apply and Cancel are enabled while previewing', (await page.locator('[data-bd-apply]').isEnabled()) && (await page.locator('[data-bd-cancel]').isEnabled()))
await page.locator('[data-bd-cancel]').click()
await page.waitForTimeout(300)
const afterCancel = await board(page)
check('Cancel puts back the previous background exactly', afterCancel.bg === null && afterCancel.image === defaultShot.image, JSON.stringify(afterCancel.bg))
check('and nothing was stored', (await doc(page, slugA)).bg == null)
/* closing the sheet without Apply cancels too */
await pick(page, 'leather')
await closeLook(page)
check('closing the sheet without Apply restores the previous background', (await board(page)).bg === null)

/* ---- 4. Apply, persistence, 17. layout preserved ---- */
await openLook(page)
await pick(page, 'slate')
await page.locator('[data-bd-apply]').click()
await page.waitForTimeout(500)
const applied = await doc(page, slugA)
check('Apply stores a small reference, not image bytes', applied.bg?.id === 'slate' && JSON.stringify(applied.bg).length < 200, JSON.stringify(applied.bg))
check('the stored document holds no image data', !JSON.stringify(applied).includes('data:image') && JSON.stringify(applied).length < 20000)
check('notes, positions and view are untouched by choosing a background',
  JSON.stringify(applied.postits) === JSON.stringify(before.postits) &&
    JSON.stringify(applied.mods) === JSON.stringify(before.mods) &&
    applied.zoom === before.zoom && JSON.stringify(applied.pan) === JSON.stringify(before.pan))
await closeLook(page)
await page.waitForTimeout(900)
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(800)
check('a reload keeps the background', (await board(page)).bg === 'slate')
check('and the Post-it', (await page.locator('.bcpostit .bcpostittext').evaluateAll((els) => els.map((e: any) => e.value))).includes('keep me'))
await page.screenshot({ path: `${OUT}/applied-slate.png` })

/* ---- 5. projects have their own ---- */
await page.goto(url(pathB), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(600)
check('another project without a choice still has the default', (await board(page)).bg === null)
await openLook(page)
await pick(page, 'walnut')
await page.locator('[data-bd-apply]').click()
await page.waitForTimeout(400)
await closeLook(page)
await page.goto(url(pathC), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(500)
check('a third project is unaffected', (await board(page)).bg === null)
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(500)
const a1 = (await board(page)).bg
await page.goto(url(pathB), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(500)
check('switching projects shows each one its own background', a1 === 'slate' && (await board(page)).bg === 'walnut', `${String(a1)} / ${String((await board(page)).bg)}`)

/* ---- 12/13/14. scale, tile alignment, no distortion, no reloads, grid ---- */
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(600)
const px = (s: string): number[] => (s.match(/-?[\d.]+px/g) ?? []).map((n) => Number.parseFloat(n))
const layer4 = (s: string): number[] => {
  const parts = s.split(/,(?![^(]*\))/)
  return px(parts[3] ?? '')
}
const readView = (): Promise<any> =>
  page.evaluate(() => {
    const b = document.querySelector('[data-bc-board]')
    const t = document.querySelector('.bcstage')
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(t.style.transform)
    const cs = window.getComputedStyle(b)
    return {
      x: Number(m?.[1]),
      y: Number(m?.[2]),
      z: Number(m?.[3]),
      size: cs.backgroundSize,
      pos: cs.backgroundPosition,
    }
  })
const bareAt = (): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const r = document.querySelector('[data-bc-board]').getBoundingClientRect()
    return { x: r.x + r.width * 0.93, y: r.y + r.height * 0.9 }
  }) as Promise<{ x: number; y: number }>
const slate = LIB.find((e) => e.id === 'slate')
const tw = (slate?.tile.w ?? 2048) * 0.5
const th = (slate?.tile.h ?? 1152) * 0.5
d.requests.length = 0
const bp = await bareAt()
await page.mouse.move(bp.x, bp.y)
let alignedAll = true
let distorted = false
const log: string[] = []
for (let step = 0; step < 8; step += 1) {
  await page.mouse.wheel(0, step < 4 ? -200 : 200)
  await page.waitForTimeout(160)
  if (step % 2 === 1) {
    await page.mouse.move(bp.x, bp.y)
    await page.mouse.down()
    await page.mouse.move(bp.x - 70, bp.y - 30, { steps: 4 })
    await page.mouse.up()
  }
  const v = await readView()
  const dotPos = v.pos.split(',')[0]?.trim() ?? ''
  const texPos = v.pos.split(',')[3]?.trim() ?? ''
  const sz = layer4(v.size)
  const okPos = dotPos === texPos
  const okSize = Math.abs((sz[0] ?? 0) - tw * v.z) < 1.5 && Math.abs((sz[1] ?? 0) - th * v.z) < 1.5
  const okRatio = Math.abs((sz[0] ?? 1) / (sz[1] ?? 1) - 2048 / 1152) < 0.01
  if (!okPos || !okSize) alignedAll = false
  if (!okRatio) distorted = true
  log.push(`z${v.z.toFixed(2)} ${okPos ? 'pos=' : 'pos!'} ${okSize ? 'size=' : 'size!'}`)
}
check('while zooming and panning the texture is drawn from the same origin as the grid and at tile x zoom', alignedAll, log.join(' | '))
check('the texture is never stretched out of its aspect ratio at any zoom', !distorted)
const reloads = d.requests.filter((u) => /textures\/bg\/slate\.webp/.test(u))
check('zooming and panning do not reload the image', reloads.length === 0, String(reloads.length))
const seam = (await page.evaluate(
  `new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext('2d'); x.drawImage(i,0,0); const W = c.width, H = c.height; const L = x.getImageData(0,0,1,H).data, R = x.getImageData(W-1,0,1,H).data, T = x.getImageData(0,0,W,1).data, B = x.getImageData(0,H-1,W,1).data; const d = (a,b) => { let m = 0, n = 0; for (let k=0;k<a.length;k+=4) { m += Math.abs(a[k]-b[k]) + Math.abs(a[k+1]-b[k+1]) + Math.abs(a[k+2]-b[k+2]); n += 3 } return m / n }; res(Math.max(d(L,R), d(T,B))) }; i.src = '/textures/bg/slate.webp' })`,
)) as number
check('the tile has no seam: opposite edges are mirror images (mean channel difference, lossy WebP allowed a few levels)', seam <= 4, seam.toFixed(2))
/* scale slider */
await page.click('[data-bc-viewreset]')
await page.waitForTimeout(300)
await openLook(page)
const s1 = layer4((await readView()).size)[0] ?? 0
await page.locator('[data-bd-range="scale"]').evaluate((el: any) => {
  el.value = '2'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(200)
const s2 = layer4((await readView()).size)[0] ?? 0
check('the scale control scales the material', Math.abs(s2 / s1 - 2) < 0.05, `${String(s1)} -> ${String(s2)}`)
await page.locator('[data-bd-range="intensity"]').evaluate((el: any) => {
  el.value = '0.5'
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(150)
const veil = await page.evaluate(`document.querySelector('[data-bc-board]').style.getPropertyValue('--bc-bg-veilp')`)
check('the opacity control changes the veil over the material', String(veil) === '50%', String(veil))
await page.locator('[data-bd-cancel]').click()
await closeLook(page)

/* ---- 15. grid dots visible on every material ---- */
const dotsOk: string[] = []
for (const e of LIB) {
  const dot = e.tone === 'dark' ? [255, 255, 255, 0.5] : [40, 36, 28, 0.34]
  const avg = [1, 3, 5].map((i) => Number.parseInt(e.average.slice(i, i + 2), 16))
  const mix = dot.slice(0, 3).map((c, i) => (c as number) * (dot[3] as number) + (avg[i] as number) * (1 - (dot[3] as number)))
  const lum = (c: number[]): number => {
    const f = (x: number): number => {
      const y = x / 255
      return y <= 0.03928 ? y / 12.92 : ((y + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(c[0] as number) + 0.7152 * f(c[1] as number) + 0.0722 * f(c[2] as number)
  }
  const [hi, lo] = [Math.max(lum(mix), lum(avg)), Math.min(lum(mix), lum(avg))]
  const ratio = (hi + 0.05) / (lo + 0.05)
  if (ratio < 1.35) dotsOk.push(`${e.id} ${ratio.toFixed(2)}`)
}
check('the grid dots keep a visible contrast against every material', dotsOk.length === 0, dotsOk.join(', '))
const dotLayer = await page.evaluate(`getComputedStyle(document.querySelector('[data-bc-board]')).backgroundImage.startsWith('radial-gradient')`)
check('the dotted grid is the top layer of a board with a material', dotLayer === true)

/* ---- 7. upload a valid picture ---- */
await page.goto(url(pathC), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(500)
await openLook(page)
const good = await png(page, 3200, 1800)
await page.locator('[data-bd-file]').setInputFiles({ name: 'my photo.png', mimeType: 'image/png', buffer: good })
await page.waitForFunction(() => /Preview shown/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 15000 })
const previewing = await board(page)
check('an uploaded picture is previewed on the real board before it is applied', previewing.bg === 'custom' && previewing.image.includes('blob:'), JSON.stringify(previewing.bg))
check('nothing is stored until Apply', (await idbRecords(page)) === 0 && (await doc(page, slugC))?.bg == null)
check('the progress/result sentence names the optimised size', /KB/.test(await say(page)), await say(page))
await page.screenshot({ path: `${OUT}/upload-preview.png` })
await page.locator('[data-bd-apply]').click()
await page.waitForTimeout(700)
check('Apply stores the optimised picture in this browser and a reference in the project', (await idbRecords(page)) === 1 && (await doc(page, slugC))?.bg?.id === 'custom')
const rec1 = (await page.evaluate(
  `new Promise((res) => { const r = indexedDB.open('bc.backdrops'); r.onsuccess = () => { const q = r.result.transaction('images').objectStore('images').get('${slugC}'); q.onsuccess = () => { r.result.close(); res({ w: q.result.w, h: q.result.h, bytes: q.result.blob.size, type: q.result.blob.type }) } } })`,
)) as { w: number; h: number; bytes: number; type: string }
check('the stored picture was shrunk to 2560px on the long edge and re-encoded', rec1.w === 2560 && rec1.h === 1440 && /webp|jpeg/.test(rec1.type) && rec1.bytes < 3 * 1024 * 1024, JSON.stringify(rec1))
check('the project document holds no image bytes', !JSON.stringify(await doc(page, slugC)).includes('data:'))
await closeLook(page)
await page.goto(url(pathC), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(1200)
const reCustom = await board(page)
check('after a reload the uploaded picture is drawn again', reCustom.bg === 'custom' && reCustom.image.includes('blob:'), JSON.stringify(reCustom.bg))
await page.screenshot({ path: `${OUT}/custom-applied.png` })
await openLook(page)
check('the chooser shows the custom thumbnail', (await page.locator('[data-bd-pick="custom"]').count()) === 1)
await page.screenshot({ path: `${OUT}/picker-with-custom.png` })

/* ---- 8. invalid files ---- */
const refused = async (name: string, mime: string, buffer: Buffer, expect: RegExp): Promise<void> => {
  const imgBefore = (await board(page)).image
  await page.locator('[data-bd-file]').setInputFiles({ name, mimeType: mime, buffer })
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 15000 })
  const s = await say(page)
  check(`refused: ${name}`, expect.test(s) && (await board(page)).image === imgBefore, s)
}
await refused('notes.png', 'image/png', Buffer.from('this is text pretending to be a picture, long enough to pass the size floor'), /not a JPEG, PNG, WebP or AVIF/)
await refused('logo.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'), /SVG pictures are not accepted/)
await refused('bomb.png', 'image/png', bombPng(60000, 60000), /too large to open safely/)
await refused('empty.png', 'image/png', Buffer.alloc(0), /empty|too small/)
await refused('huge.png', 'image/png', Buffer.concat([bombPng(10, 10), Buffer.alloc(16 * 1024 * 1024)]), /over 15 MB/)
await refused('cut.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xdb, 0, 5, 1, 2, 3, 4, 5, 6, 7, 8]), /damaged|not a JPEG/)
await refused('lies.png', 'image/png', Buffer.concat([bombPng(40, 40), Buffer.from('garbage that decodes to nothing at all, padded out well beyond the floor')]), /could not open|damaged/)

/* ---- 9. failure while saving ---- */
await page.evaluate(() => {
  const real = (window as any).IDBObjectStore.prototype.put
  ;(window as any).__realPut = real
  ;(window as any).IDBObjectStore.prototype.put = () => {
    throw new Error('simulated storage failure')
  }
})
await page.locator('[data-bd-file]').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await png(page, 800, 450) })
await page.waitForFunction(() => /Preview shown/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 15000 })
const docBefore = JSON.stringify(await doc(page, slugC))
await page.locator('[data-bd-apply]').click()
await page.waitForTimeout(600)
check('a storage failure while applying is reported and changes nothing', /simulated|could not be saved/i.test(await say(page)) && JSON.stringify(await doc(page, slugC)) === docBefore, await say(page))
await page.evaluate(() => {
  ;(window as any).IDBObjectStore.prototype.put = (window as any).__realPut
})
await page.locator('[data-bd-cancel]').click()

/* ---- 10. remove, 11. missing image fallback ---- */
await page.locator('[data-bd-remove]').click()
await page.waitForTimeout(600)
check('Remove deletes the picture and returns the project to the default', (await idbRecords(page)) === 0 && (await doc(page, slugC))?.bg?.id === 'default' && (await board(page)).bg === null)
check('and the custom thumbnail is gone', (await page.locator('[data-bd-pick="custom"]').count()) === 0)
await closeLook(page)
/* missing-image fallback: apply custom, then lose the picture */
await openLook(page)
await page.locator('[data-bd-file]').setInputFiles({ name: 'third.png', mimeType: 'image/png', buffer: await png(page, 1200, 700) })
await page.waitForFunction(() => /Preview shown/.test(document.querySelector('[data-bd-say]')?.textContent ?? ''), null, { timeout: 15000 })
await page.locator('[data-bd-apply]').click()
await page.waitForTimeout(500)
await closeLook(page)
await page.evaluate(`new Promise((res) => { const r = indexedDB.open('bc.backdrops'); r.onsuccess = () => { const t = r.result.transaction('images', 'readwrite'); t.objectStore('images').clear(); t.oncomplete = () => { r.result.close(); res(true) } } })`)
await page.goto(url(pathC), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
await page.waitForTimeout(1200)
const missing = await board(page)
check('a project whose picture is not on this device falls back to the default and says why', missing.bg === null && /another device/.test(missing.why ?? ''), JSON.stringify(missing.why))
await openLook(page)
check('and the picker says it too', /another device/.test(await say(page)), await say(page))
await closeLook(page)

/* ---- 6. isolation: signing out removes every choice and picture from the browser ---- */
await page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-bc-board]')
const keysBefore = (await page.evaluate(() => Object.keys(localStorage).filter((k: string) => k.startsWith('bc.stage.')))) as string[]
await page.evaluate(`import('/signout.js').then((m) => m.signOut({ reload: false }))`)
await page.waitForTimeout(900)
const keysAfter = (await page.evaluate(() => Object.keys(localStorage).filter((k: string) => k.startsWith('bc.')))) as string[]
const dbs = (await page.evaluate(`indexedDB.databases ? indexedDB.databases().then((l) => l.map((x) => x.name)) : []`)) as string[]
check('sign-out removes every stored choice and the person’s pictures from the browser', keysBefore.length >= 2 && keysAfter.length === 0 && !dbs.includes('bc.backdrops'), `${keysBefore.join(',')} -> ${keysAfter.join(',')} dbs=${dbs.join(',')}`)
const other = await newPage()
await other.page.goto(url(pathA), { waitUntil: 'domcontentloaded' })
await other.page.waitForSelector('[data-bc-board]')
await other.page.waitForTimeout(500)
check('a different browser profile (another person) starts with the default', (await board(other.page)).bg === null)
await other.ctx.close()
check('no page errors in the desktop session', d.errors.length === 0, d.errors.join(' | '))
await d.ctx.close()

/* ---- keyboard ---- */
{
  const k = await newPage()
  await k.page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await k.page.waitForSelector('[data-bc-menu]')
  await pickProject(k.page, 0)
  await openLook(k.page)
  await k.page.locator('[data-bd-pick="linen"]').focus()
  await k.page.keyboard.press('Enter')
  await k.page.waitForTimeout(300)
  check('keyboard: Enter on a thumbnail previews it and marks it selected', (await board(k.page)).bg === 'linen' && (await k.page.locator('[data-bd-pick="linen"]').getAttribute('aria-checked')) === 'true')
  const focused = await k.page.evaluate(() => document.activeElement?.getAttribute('data-bd-pick'))
  check('keyboard: focus stays on the chosen thumbnail after the redraw', focused === 'linen', String(focused))
  await k.page.keyboard.press('Tab')
  await k.ctx.close()
}

/* ---- 16. phone ---- */
{
  const m = await newPage(390, 844, true)
  await m.page.goto(url('/'), { waitUntil: 'domcontentloaded' })
  await m.page.waitForSelector('[data-bc-menu]')
  await pickProject(m.page, 0)
  await openLook(m.page)
  await pick(m.page, 'paper')
  await m.page.screenshot({ path: `${OUT}/phone-picker.png` })
  const sheetOk = (await m.page.evaluate(() => {
    const s = document.querySelector('#viewer .sheet').getBoundingClientRect()
    return s.width <= window.innerWidth + 1 && document.documentElement.scrollWidth - window.innerWidth <= 1
  })) as boolean
  check('phone: the picker fits the screen with no sideways overflow', sheetOk)
  await m.page.locator('[data-bd-apply]').click()
  await m.page.waitForTimeout(400)
  await closeLook(m.page)
  await m.page.waitForTimeout(400)
  const pb = await board(m.page)
  check('phone: the material is drawn on the stacked board', pb.bg === 'paper' && pb.image.includes('/textures/bg/paper.webp'), JSON.stringify(pb.bg))
  check('phone: no sideways overflow with a material', ((await m.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) as number) <= 1)
  await m.page.screenshot({ path: `${OUT}/phone-board.png` })
  check('phone: no page errors', m.errors.length === 0, m.errors.join(' | '))
  await m.ctx.close()
}

rec('storage authorisation and cross-tenant refusal on a server', 'n/a', 'custom pictures are kept only in the browser (no server storage is used), so there is no server object to authorise; isolation is by browser profile and sign-out, asserted above')
rec('a custom picture on a second device', 'n/a', 'needs a per-person image store on the gateway (backend dependency in the issue); the device without it says so and shows the default')

await browser.close()
server.close()
const tally: Record<Verdict, number> = { pass: 0, fail: 0, 'n/a': 0 }
for (const r of results) {
  tally[r.v] += 1
  console.log(`${r.v === 'pass' ? 'pass' : r.v === 'fail' ? 'FAIL' : 'n/a '}  ${r.name}${r.detail === '' ? '' : ` - ${r.detail}`}`)
}
console.log(`\n${String(tally.pass)} passed, ${String(tally.fail)} failed, ${String(tally['n/a'])} not applicable (of ${String(results.length)}; only "passed" counts)`)
process.exit(tally.fail === 0 ? 0 : 1)
