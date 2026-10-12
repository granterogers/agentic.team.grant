/**
 * Design audit of Team HQ's standard chrome. Reads the COMPUTED background of every visible element on the main surfaces,
 * in Light and Dark, and reports each gradient whose colour stops are warm (orange, brown, bronze). Intentional
 * exceptions are excluded by name: the semantic warning colour, the Post-it paper, and the background textures. The point
 * is a measured list, not a judgement from source.
 *
 *   npx tsx scripts/verify/probe-chrome-audit.ts
 *
 * Read-only; serves web/studio locally. Writes .out/probe/chrome-audit-<scheme>.json with every finding.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Page } from 'playwright'
import { serve } from './probe-lib.ts'

const OUT = join(process.cwd(), '.out', 'probe')

// Excluded by design: a warning is a semantic colour, a Post-it is paper, a texture is an intentional background.
const EXCLUDED = [
  'bcpostit',
  'bcwarn',
  'bctchip--high',
  'badge--warn',
  'bcbgtex',
  'bcbg-texture',
  'probe-control-none',
]

type Finding = { surface: string; selector: string; gradient: string; warmStops: string[] }

// The in-page code is a plain string: the compiler's helper wrappers must not reach the browser (see probe-activity-state).
const SCAN = [
  `var excluded = ${JSON.stringify(EXCLUDED)};`,
  'function warm(r, g, b) {',
  '  var R = r / 255, G = g / 255, B = b / 255;',
  '  var M = Math.max(R, G, B), m = Math.min(R, G, B), d = M - m;',
  '  if (d === 0) return false;',
  '  var h = 0;',
  '  if (M === R) h = ((G - B) / d) % 6; else if (M === G) h = (B - R) / d + 2; else h = (R - G) / d + 4;',
  '  h *= 60; if (h < 0) h += 360;',
  '  var l = (M + m) / 2, s = d / (1 - Math.abs(2 * l - 1));',
  '  return h >= 15 && h <= 55 && s > 0.25 && l < 0.7;',
  '}',
  'var seen = {}, out = [];',
  'var all = Array.prototype.slice.call(document.querySelectorAll("body *"));',
  'for (var i = 0; i < all.length; i++) {',
  '  var el = all[i];',
  '  var cs = getComputedStyle(el);',
  '  if (cs.display === "none" || cs.visibility === "hidden") continue;',
  '  var bg = cs.backgroundImage;',
  '  if (bg.indexOf("gradient") < 0) continue;',
  '  var rect = el.getBoundingClientRect();',
  '  if (rect.width < 4 || rect.height < 4) continue;',
  '  var cls = String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".");',
  '  var label = el.tagName.toLowerCase() + "." + cls;',
  '  var skip = false;',
  '  for (var k = 0; k < excluded.length; k++) { if (label.indexOf(excluded[k]) >= 0) skip = true; }',
  '  if (skip) continue;',
  '  var stops = bg.match(/rgba?\\([^)]*\\)|color\\([^)]*\\)/g) || [];',
  '  var warmStops = [];',
  '  for (var j = 0; j < stops.length; j++) {',
  '    var mm = stops[j].match(/rgba?\\(\\s*([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)/);',
  '    var cm = stops[j].match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);',
  '    var rgb = mm ? [Number(mm[1]), Number(mm[2]), Number(mm[3])] : (cm ? [255 * Number(cm[1]), 255 * Number(cm[2]), 255 * Number(cm[3])] : null);',
  '    if (rgb && warm(rgb[0], rgb[1], rgb[2])) warmStops.push(stops[j]);',
  '  }',
  '  if (warmStops.length > 0 && !seen[label]) { seen[label] = true; out.push({ selector: label, gradient: bg.slice(0, 160), warmStops: warmStops.slice(0, 3) }); }',
  '}',
  // Solid colours: text, background and border of each visible element, warm hue, excluding the same named exceptions.
  'var solids = {};',
  'var solidOut = [];',
  'for (var q = 0; q < all.length; q++) {',
  '  var se = all[q];',
  '  var scs = getComputedStyle(se);',
  '  if (scs.display === "none" || scs.visibility === "hidden") continue;',
  '  var srect = se.getBoundingClientRect();',
  '  if (srect.width < 4 || srect.height < 4) continue;',
  '  var sl = se.tagName.toLowerCase() + "." + String(se.className).split(" ").filter(Boolean).slice(0, 2).join(".");',
  '  var sskip = false;',
  '  for (var kk = 0; kk < excluded.length; kk++) { if (sl.indexOf(excluded[kk]) >= 0) sskip = true; }',
  '  if (sskip) continue;',
  '  var props = { text: scs.color, fill: scs.backgroundColor, edge: scs.borderTopColor };',
  '  for (var pname in props) {',
  '    var pv = props[pname];',
  '    if (!pv || pv === "rgba(0, 0, 0, 0)" || pv.indexOf("transparent") >= 0) continue;',
  '    var pm = pv.match(/rgba?\\(\\s*([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)/);',
  '    var pc = pv.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);',
  '    var prgb = pm ? [Number(pm[1]), Number(pm[2]), Number(pm[3])] : (pc ? [255 * Number(pc[1]), 255 * Number(pc[2]), 255 * Number(pc[3])] : null);',
  '    if (prgb && warm(prgb[0], prgb[1], prgb[2])) {',
  '      var key = sl + ":" + pname;',
  '      if (!solids[key]) { solids[key] = true; solidOut.push({ selector: sl + " (" + pname + ")", gradient: pv, warmStops: [pv] }); }',
  '    }',
  '  }',
  '}',
  'return out.concat(solidOut);',
].join('\n')

const scan = async (page: Page) =>
  (await page.evaluate(`(function () {\n${SCAN}\n})()`)) as Array<{
    selector: string
    gradient: string
    warmStops: string[]
  }>

const { port, close } = await serve()
const browser = await chromium.launch()
const findings: Finding[] = []
const controlFound: boolean[] = []
try {
  await mkdir(OUT, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
    })
    await context.addInitScript((s) => {
      localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
    }, scheme)
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    await page.locator('[data-bc-menu-open]').first().click({ force: true })
    await page.waitForTimeout(400)
    await page.locator('[data-bc-go*="/p/"]').first().click({ force: true })
    await page.waitForTimeout(1500)
    // Positive control: a known warm gradient is injected, and the scan must find it, or the scan proves nothing.
    await page.evaluate(() => {
      const d = document.createElement('div')
      d.className = 'probe-control'
      d.style.cssText =
        'width:100px;height:100px;background:linear-gradient(#a2502f,#7a4a05);position:fixed;left:0;top:0;z-index:1'
      document.body.appendChild(d)
    })
    const overview = await scan(page)
    controlFound.push(overview.some((f) => f.selector.startsWith('div.probe-control')))
    await page.evaluate(() => document.querySelector('.probe-control')?.remove())
    for (const f of overview) findings.push({ surface: `${scheme}:overview`, ...f })
    const chatToggle = page.getByRole('button', { name: /chat with team/i }).first()
    await chatToggle.click({ force: true })
    await page.waitForTimeout(700)
    for (const f of await scan(page)) findings.push({ surface: `${scheme}:chat`, ...f })
    await chatToggle.click({ force: true })
    await page.waitForTimeout(500)
    await page.locator('[data-bc-settings]').first().click({ force: true })
    await page.waitForTimeout(900)
    for (const f of await scan(page)) findings.push({ surface: `${scheme}:settings`, ...f })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await context.close()
    const mine = findings.filter((f) => f.surface.startsWith(scheme))
    await writeFile(join(OUT, `chrome-audit-${scheme}.json`), JSON.stringify(mine, null, 2))
  }
} finally {
  await browser.close()
  close()
}

const bySelector = new Map<string, Finding>()
for (const f of findings) if (!bySelector.has(f.selector)) bySelector.set(f.selector, f)
for (const f of bySelector.values())
  console.log(JSON.stringify({ selector: f.selector, surface: f.surface, warm: f.warmStops }))
console.log(
  `warm gradients on chrome: ${String(bySelector.size)} distinct selectors across ${String(findings.length)} findings`,
)
const controlOk = controlFound.length > 0 && controlFound.every(Boolean)
console.log(
  `positive control (injected warm gradient detected in each scheme): ${controlOk ? 'PASS' : 'FAIL'}`,
)
if (!controlOk) process.exitCode = 1
