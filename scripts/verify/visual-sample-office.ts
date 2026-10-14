// biome-ignore-all format: dense probe strings and the colour table kept as written, as the other verification probes are
// The read-only gate comes first: this reads the production Sample Office, and it must refuse without ALLOW_PRODUCTION_CHECKS=1.
import '../../src/safety/require-production-checks.ts'
/**
 * Signed-in Sample Office, read-only: the real office as the Sample Person, at desktop and phone width, in light and dark,
 * from ONE sign-in. It opens pages and takes screenshots. It presses no control that writes, creates nothing, and changes
 * nothing in production. The appearance is set in this browser only (localStorage), and the Sample's stored appearance row
 * is read before and after to prove that nothing was written to it.
 *
 * The project is discovered from the database at run time (the most recently updated active project of the Sample office),
 * never hard-coded. Every project screen is checked to be the screen it claims: the route must be the one requested, the
 * project's name must be on the page, and the content must differ from the home screen's. A screen that fails any of those
 * is reported as a FAIL, never as a capture.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/verify/visual-sample-office.ts <tag> [light|dark] [screen,screen]
 *   ALLOW_PRODUCTION_CHECKS=1 STUDIO_BASE=https://ai-team-hq.vercel.app npx tsx scripts/verify/visual-sample-office.ts <tag>
 *
 * STUDIO_BASE points the same read-only capture at the deployed site instead of the local copy of web/studio.
 * Output: .out/redesign/<tag>/sample-<mode>-<device>-<screen>.png, a colour scan and an axe-core run per screen.
 */
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { newPage, settle, signIn, startStudio } from '../sample/browser.ts'
import { rows, sampleOffice, session } from '../sample/lib.ts'

const tag = process.argv[2] ?? 'sample'
const dir = `.out/redesign/${tag}`
mkdirSync(dir, { recursive: true })
const AXE = await readFile(join('node_modules', 'axe-core', 'axe.min.js'), 'utf8')

/* The project is read from the Sample office now, never typed in: the most recently updated active project that is not a fixture. */
const office = await sampleOffice()
const found = await rows(
  `select slug, name from public.projects where office_id = '${office.officeId}' and status = 'active' and not is_fixture order by updated_at desc nulls last limit 1`,
)
const project = found[0]
if (project === undefined) throw new Error('the Sample Office has no active project to capture')
const SLUG = String(project.slug)
const PROJECT_NAME = String(project.name)
console.log(`discovered project: ${PROJECT_NAME} (route /p/${SLUG})`)

// Pauses before retrying a screen whose office read did not answer: bounded at three retries, so a sick backend is not hammered.
const BACKEND_RETRY_MS = [15000, 30000, 60000]
const SCREENS: [string, string][] = [
  ['home', '/'],
  ['overview', `/p/${SLUG}`],
  ['tasks', `/p/${SLUG}/tasks`],
  ['documents', `/p/${SLUG}/documents`],
  ['chat', `/p/${SLUG}/chat`],
  ['schedule', `/p/${SLUG}/schedule`],
  ['team', `/p/${SLUG}/team`],
  ['activity', `/p/${SLUG}/activity`],
]
const DEVICES: [string, number, number][] = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
]
const MODES: ['light' | 'dark', string][] = [
  ['light', JSON.stringify({ v: 3, scheme: 'light', palette: 'slate', look: 'porcelain', texture: 'none', density: 'comfortable', glass: 'soft', depth: 'soft' })],
  ['dark', JSON.stringify({ v: 3, scheme: 'dark', palette: 'slate', look: 'porcelain', texture: 'none', density: 'comfortable', glass: 'soft', depth: 'soft' })],
]

// The colours the old look painted with (charcoal faces and the burnt-orange accents), by their computed rgb value.
const OLD_RGB = [
  'rgb(19, 17, 16)', 'rgb(38, 34, 32)', // graphite charcoal, dark canvas and face
  'rgb(162, 80, 47)', 'rgb(143, 66, 32)', 'rgb(251, 189, 168)', 'rgb(90, 74, 0)', // clay burnt orange, state, peach, brown
  'rgb(13, 17, 20)', 'rgb(28, 34, 39)', // silver dark canvas and face
  'rgb(217, 212, 205)', 'rgb(242, 239, 234)', // graphite light canvas and face
]
const SCAN = `(() => {
  const OLD = ${JSON.stringify(OLD_RGB)};
  const rgb = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const p = m[1].split(',').map((v) => parseFloat(v)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; };
  const exact = {}; const warm = {}; let scanned = 0;
  for (const el of document.querySelectorAll('body *')) {
    const box = el.getBoundingClientRect(); if (box.width === 0 || box.height === 0) continue;
    const cs = getComputedStyle(el); scanned++;
    for (const [prop, val] of [['bg', cs.backgroundColor], ['text', cs.color]]) {
      const c = rgb(val); if (!c || c.a === 0) continue;
      const key = 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')';
      if (OLD.includes(key)) exact[prop + ' ' + key] = (exact[prop + ' ' + key] || 0) + 1;
      const x = hsl(c.r, c.g, c.b);
      if (x.s > 0.35 && x.l > 0.12 && x.l < 0.6 && x.h >= 8 && x.h <= 34) warm[prop + ' ' + key] = (warm[prop + ' ' + key] || 0) + 1;
    }
  }
  const primary = document.querySelector('.bcbtn--primary');
  const body = getComputedStyle(document.body);
  return JSON.stringify({ scanned, exactOldColours: exact, warmHueColours: warm, bodyBg: body.backgroundColor, primaryBg: primary ? getComputedStyle(primary).backgroundColor : null, scheme: document.documentElement.dataset.scheme || 'system', look: document.documentElement.dataset.look || null, palette: document.documentElement.dataset.palette || null, version: (document.querySelector('.bcver') || { textContent: null }).textContent, chars: (document.querySelector('main') || document.body).innerText.trim().length });
})()`

/* Where the page actually is: the route, the main text (for the fallback comparison) and whether the project's name is on it. */
const WHERE = `(() => { const main = document.querySelector('main') || document.body; return JSON.stringify({ path: location.pathname, text: main.innerText.trim(), hasName: document.body.innerText.includes(${JSON.stringify(PROJECT_NAME)}), backendFailed: document.body.innerText.includes('The office did not answer'), transportFailed: document.body.innerText.includes('upstream request failed') }) })()`

/* Structural checks on the rendered screen: the activity keyboard fix, the version label's place in the bar, the bar's
   touch targets, and the document-thumbnail text contrast (WCAG 2.x relative luminance, AA needs 4.5:1 for text). */
const CHECKS = `(() => {
  const out = {};
  const bodies = [...document.querySelectorAll('.bcmodbody')];
  out.scrollableUnfocusable = bodies.filter((el) => el.scrollHeight > el.clientHeight + 1 && el.tabIndex < 0).length;
  const tray = document.querySelector('.bctray');
  const ver = document.querySelector('.bcver--tray');
  if (tray && ver && getComputedStyle(ver).display !== 'none') {
    const t = tray.getBoundingClientRect(); const v = ver.getBoundingClientRect();
    out.versionInsideTray = v.top >= t.top - 0.5 && v.bottom <= t.bottom + 0.5 && v.left >= t.left - 0.5 && v.right <= t.right + 0.5;
    // The label may not sit on any destination in the bar (a version drawn over the Activity icon was the defect).
    out.versionClearOfButtons = [...tray.querySelectorAll('a,button')].every((b) => { const r = b.getBoundingClientRect(); return v.right <= r.left || v.left >= r.right || v.bottom <= r.top || v.top >= r.bottom; });
    // Text the label covers: any text-bearing leaf whose box overlaps the label's box, other than the label and the bar.
    // Only a label drawn ABOVE the bar can cover content; content scrolled beneath the opaque bar is hidden by the bar, not by the label.
    out.versionCoversContent = v.top < t.top - 0.5 && [...document.querySelectorAll('main *')].some((el) => {
      if (el.childElementCount !== 0 || el.textContent.trim() === '' || ver.contains(el) || tray.contains(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !(v.right <= r.left || v.left >= r.right || v.bottom <= r.top || v.top >= r.bottom);
    });
  } else { out.versionInsideTray = null; out.versionClearOfButtons = null; }
  const targets = tray ? [...tray.querySelectorAll('a,button')].map((b) => b.getBoundingClientRect()) : [];
  out.trayMinTarget = targets.length ? Math.round(Math.min(...targets.map((r) => Math.min(r.width, r.height)))) : null;
  const lum = (c) => { const p = /rgba?\\(([^)]+)\\)/.exec(c)[1].split(',').map(parseFloat); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const paintOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const m = /rgba?\\(([^)]+)\\)/.exec(c); if (m && (m[1].split(',')[3] === undefined || parseFloat(m[1].split(',')[3]) > 0.5)) return c; } return 'rgb(255, 255, 255)'; };
  const thumbs = [...document.querySelectorAll('.bcxpagetext')].filter((el) => el.getClientRects().length > 0);
  out.thumbCount = thumbs.length;
  if (thumbs.length) {
    const ratios = thumbs.map((el) => { const a = lum(getComputedStyle(el).color); const b = lum(paintOf(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
    out.thumbMinRatio = Math.round(Math.min(...ratios) * 100) / 100;
  } else out.thumbMinRatio = null;
  return JSON.stringify(out);
})()`

/* axe-core, WCAG 2.0/2.1/2.2 A and AA, on the rendered signed-in page. Read-only: it inspects the DOM and changes nothing. */
const AXE_RUN = `(async () => { const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }); return JSON.stringify(r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: (v.nodes[0] && v.nodes[0].target.join(' ')) || '', help: v.help }))) })()`

/* Read the Sample's stored appearance row, so a write from this capture would show as a changed timestamp. Read-only. */
const APPEARANCE_ROW = `select owner || ' updated ' || updated_at::text from public.appearance_settings where owner = 'p4-second-person'`
const { execFileSync } = await import('node:child_process')
const readRow = (): string => {
  try {
    return execFileSync('npm', ['run', '-s', 'qq', '--', APPEARANCE_ROW], { encoding: 'utf8', env: { ...process.env, ALLOW_PRODUCTION_CHECKS: '1' } }).trim().split('\n').filter((l) => l.includes('updated')).join(' ') || 'no row'
  } catch (e) {
    return `row read failed: ${String(e).slice(0, 120)}`
  }
}
const rowBefore = readRow()
console.log('appearance row before:', rowBefore)

const s = await session()
// The deployed site when STUDIO_BASE names it; otherwise a local server over web/studio (the same bytes, served from disk).
const studio = process.env.STUDIO_BASE
  ? { base: process.env.STUDIO_BASE, browser: await chromium.launch(), close: async () => undefined }
  : await startStudio(4885)
const { ctx, page, errors } = await newPage(studio, { width: 1440, height: 900 }, false)
await signIn(studio, page, s) // the one sign-in of this capture
const report: string[] = []
const failures: string[] = []
const backendFailures: string[] = []
const axeTotals: Record<string, number> = {}
// A run may cover one scheme (argument 2: light or dark) so that each run fits inside the ten-minute ceiling.
const onlyMode = process.argv[3]
// Argument 3 (optional): a comma-separated list of screens, for re-running only the screens a previous run did not finish.
const onlyScreens = process.argv[4]?.split(',')
for (const [mode, stored] of MODES.filter(([m]) => onlyMode === undefined || m === onlyMode)) {
  await page.evaluate(`localStorage.setItem('studio.appearance', ${JSON.stringify(stored)})`)
  const homeText: Record<string, string> = {}
  for (const [device, width, height] of DEVICES) {
    await page.setViewportSize({ width, height })
    for (const [name, path] of SCREENS.filter(([n]) => onlyScreens === undefined || onlyScreens.includes(n))) {
      const key = `${mode}-${device}`
      // An office read that does not answer is retried with a growing pause, a bounded number of times. Only a persistent
      // failure is reported, and it is reported as a BACKEND failure, never as a visual one.
      let attempts = 0
      let where: { path: string; text: string; hasName: boolean; backendFailed: boolean; transportFailed: boolean }
      for (;;) {
        attempts += 1
        await page.goto(`${studio.base}${path}`, { waitUntil: 'load' })
        await settle(page)
        where = JSON.parse((await page.evaluate(WHERE)) as string) as typeof where
        // A transport failure ("upstream request failed") is the request path answering, not the screen: retried the same way.
        where.backendFailed = where.backendFailed || where.transportFailed
        if (!where.backendFailed || attempts > BACKEND_RETRY_MS.length) break
        console.log(`  backend did not answer: ${mode} ${device} ${name} (attempt ${attempts}), waiting ${BACKEND_RETRY_MS[attempts - 1] / 1000}s`)
        await new Promise((ok) => setTimeout(ok, BACKEND_RETRY_MS[attempts - 1]))
      }
      const scan = JSON.parse((await page.evaluate(SCAN)) as string) as Record<string, unknown>
      if (name === 'home') homeText[key] = where.text
      // The screen is the one it claims: on its route, named after the project, and not the home screen's content.
      const sameAsHome = name !== 'home' && where.text === homeText[key]
      const checks = where.backendFailed ? {} : (JSON.parse((await page.evaluate(CHECKS)) as string) as Record<string, number | boolean | null>)
      const structural = [
        checks.scrollableUnfocusable !== undefined && checks.scrollableUnfocusable !== 0 ? 'scrollable region not focusable' : '',
        checks.versionInsideTray === false ? 'version label outside the tray' : '',
        checks.versionClearOfButtons === false ? 'version label overlaps a destination' : '',
        checks.versionCoversContent === true ? 'version label covers content' : '',
        typeof checks.thumbMinRatio === 'number' && checks.thumbMinRatio < 4.5 ? `thumbnail text ${checks.thumbMinRatio}:1` : '',
      ].filter((s) => s !== '')
      const verdict = where.backendFailed
        ? 'BACKEND'
        : name === 'home'
          ? where.path === '/' ? 'PASS' : 'FAIL'
          : where.path === path && where.hasName && !sameAsHome && structural.length === 0 ? 'PASS' : 'FAIL'
      const exact = Object.keys((scan.exactOldColours as object) ?? {}).length
      const warm = Object.keys((scan.warmHueColours as object) ?? {}).length
      await page.screenshot({ path: `${dir}/sample-${mode}-${device}-${name}.png` })
      await page.addScriptTag({ content: AXE })
      const violations = JSON.parse((await page.evaluate(AXE_RUN)) as string) as { id: string; impact: string; n: number; target: string; help: string }[]
      for (const v of violations) axeTotals[v.impact ?? 'none'] = (axeTotals[v.impact ?? 'none'] ?? 0) + v.n
      report.push(`${verdict} ${mode} ${device} ${name}: attempts=${attempts} route=${where.path} named=${where.hasName} sameAsHome=${sameAsHome} scheme=${String(scan.scheme)} look=${String(scan.look)} palette=${String(scan.palette)} body=${String(scan.bodyBg)} primary=${String(scan.primaryBg)} version=${String(scan.version)} chars=${String(scan.chars)} exactOld=${exact} warmHueKinds=${warm} axe=${violations.length} checks=${JSON.stringify(checks)}${structural.length ? ` STRUCTURAL: ${structural.join('; ')}` : ''}`)
      console.log(report[report.length - 1]) // each screen is printed as it finishes, so a run cut short still reports what it saw
      if (verdict === 'BACKEND') backendFailures.push(`${mode} ${device} ${name}`)
      if (verdict === 'FAIL') failures.push(`${mode} ${device} ${name}`)
      if (exact > 0) report.push(`  EXACT OLD colours: ${JSON.stringify(scan.exactOldColours)}`)
      for (const v of violations) report.push(`  axe ${v.impact} ${v.id} x${v.n} (${v.help}) at ${v.target.slice(0, 90)}`)
    }
  }
}
const rowAfter = readRow()
report.push(`screen verdicts: ${failures.length === 0 ? 'all screens are the intended screen' : `FAILED ${failures.length}: ${failures.join('; ')}`}`)
report.push(`backend failures (reported separately, not visual): ${backendFailures.length === 0 ? 'none' : `${backendFailures.length}: ${backendFailures.join('; ')}`}`)
report.push(`axe affected nodes by impact: ${JSON.stringify(axeTotals)}`)
report.push(`appearance row after: ${rowAfter}`)
report.push(`appearance row unchanged by this capture: ${rowBefore === rowAfter ? 'YES' : 'NO'}`)
report.push(`page errors: ${errors.length === 0 ? 'none' : errors.join(' | ')}`)
console.log(report.join('\n'))
await ctx.close()
await studio.close()
process.exit(0)
