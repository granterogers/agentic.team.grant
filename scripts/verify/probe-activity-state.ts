/**
 * The Activity Log's waiting and warning styles keep their semantic warning colour in both colour modes.
 * They read `--bc-state`, not the neutral section accent, so the review's regression cannot return silently.
 *
 *   npx tsx scripts/verify/probe-activity-state.ts
 *
 * Read-only; serves web/studio locally. It renders representative elements with the Activity classes into the page
 * (no Activity data is written), reads their computed colours, and reports the contrast of the warning text.
 */
import { chromium } from 'playwright'
import { serve } from './probe-lib.ts'

const parse = (s: string): [number, number, number] | null => {
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b] = m[1].split(',').map((v) => Number.parseFloat(v))
  return [r, g, b]
}
const luminance = ([r, g, b]: [number, number, number]): number => {
  const [R, G, B] = [r, g, b].map((v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}
const contrast = (a: string, b: string): number | null => {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  const [hi, lo] = [luminance(pa), luminance(pb)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

const { port, close } = await serve()
const browser = await chromium.launch()
let failed = 0
try {
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((s) => {
      localStorage.setItem('studio.appearance', JSON.stringify({ scheme: s, look: 'silver' }))
    }, scheme)
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${String(port)}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    // Passed as a string so the compiler's helper wrappers cannot reach the browser.
    const measure = [
      'var cs = getComputedStyle(document.documentElement);',
      'function token(name) { return cs.getPropertyValue(name).trim(); }',
      'function probeNode(cls) {',
      '  var el = document.createElement("span");',
      '  el.className = cls; el.textContent = "Probe"; el.setAttribute("data-probe-activity", "");',
      '  document.body.appendChild(el);',
      '  var c = getComputedStyle(el);',
      '  return { color: c.color, background: c.backgroundColor };',
      '}',
      'function resolved(value) {',
      '  var el = document.createElement("span");',
      '  el.setAttribute("data-probe-activity", "");',
      '  el.style.color = value; document.body.appendChild(el);',
      '  var c = getComputedStyle(el).color; el.remove(); return c;',
      '}',
      'function resolvedBg(value) {',
      '  var el = document.createElement("span");',
      '  el.setAttribute("data-probe-activity", "");',
      '  el.style.backgroundColor = value; document.body.appendChild(el);',
      '  var c = getComputedStyle(el).backgroundColor; el.remove(); return c;',
      '}',
      'var wait = probeNode("bcact-mark--wait");',
      'var note = probeNode("bcact-note--warn");',
      'var result = probeNode("bcact-result--wait");',
      'document.querySelectorAll("[data-probe-activity]").forEach(function (n) { n.remove(); });',
      'return {',
      '  stateColour: resolved("var(--bc-state)"), sectionColour: resolved("var(--bc-section-accent)"),',
      '  canvas: resolvedBg("var(--bc-canvas)"),',
      '  waitColor: wait.color, resultWash: result.background, noteBackground: note.background',
      '};',
    ].join('\n')
    const report = (await page.evaluate(`(function () {\n${measure}\n})()`)) as {
      stateColour: string
      sectionColour: string
      canvas: string
      waitColor: string
      resultWash: string
      noteBackground: string
    }
    // The waiting mark IS the warning colour, and that colour is not the neutral section accent.
    const markIsWarning =
      report.waitColor === report.stateColour && report.stateColour !== report.sectionColour
    // The warning washes are drawn (the result's wash and the note's background are not transparent).
    const washesDrawn =
      report.resultWash !== '' &&
      report.resultWash !== 'rgba(0, 0, 0, 0)' &&
      report.noteBackground !== 'rgba(0, 0, 0, 0)'
    // Small warning text reads at WCAG AA (4.5:1) on the canvas in both modes.
    const ratio = contrast(report.waitColor, report.canvas)
    const contrastOk = ratio !== null && ratio >= 4.5
    const ok = markIsWarning && washesDrawn && contrastOk
    if (!ok) failed += 1
    console.log(
      JSON.stringify({
        scheme,
        markColour: report.waitColor,
        warningColour: report.stateColour,
        neutralAccent: report.sectionColour,
        resultWash: report.resultWash,
        noteBackground: report.noteBackground,
        contrastOnCanvas: contrast(report.waitColor, report.canvas),
      }),
    )
    console.log(
      `${ok ? 'PASS' : 'FAIL'}: Activity waiting and warning styles use the warning token (${scheme})`,
    )
    await context.close()
  }
} finally {
  await browser.close()
  close()
}
process.exitCode = failed === 0 ? 0 : 1
