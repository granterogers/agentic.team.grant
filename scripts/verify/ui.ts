/**
 * The product's layout, in a real browser, at a desktop and a phone size: the screens a person reaches, measured.
 *
 *   npm run verify:ui
 *
 * Asserts, per screen and per device:
 *   - no horizontal overflow (the page is no wider than its viewport);
 *   - no visible text below the 12px floor;
 *   - on the phone (touch emulation on), no visible control below the 44px touch floor, except the named exceptions below;
 *   - no uncaught page error.
 *
 * Replaces the earlier version, which drove the retired studio at /classic/ and captured Sample rows from production through
 * the Management API (a write-classified path this check does not need). This one runs locally against the prototype, which
 * is the product's own rendering with invented data, so it contacts nothing.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { chromium, devices } from 'playwright'

const PORT = Number(process.env.UI_VERIFY_PORT ?? 8971)
const T: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}
const srv = createServer((q, r) => {
  let p = join('web/studio', decodeURIComponent((q.url ?? '/').split('?')[0] ?? '/'))
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
  if (!existsSync(p) && extname(p) === '') p = join('web/studio', 'index.html')
  if (!existsSync(p)) {
    r.writeHead(404)
    r.end('no')
    return
  }
  r.writeHead(200, { 'content-type': T[extname(p)] ?? 'application/octet-stream' })
  r.end(readFileSync(p))
})
await new Promise<void>((ok) => srv.listen(PORT, '127.0.0.1', ok))

/*
  Controls below 44px that are excused, by the selector that names them and the reason. Empty: the phone floor holds for
  every control the screens draw. An entry here is a known defect the release has not fixed, and each run prints it.
*/
const EXCUSED: Array<{ selector: string; reason: string }> = []

/* The screens a person reaches: routes the product draws. */
const SCREENS = [
  { name: 'home', path: '/' },
  { name: 'project', path: '/p/legacy-coaching-course' },
  { name: 'to-dos', path: '/p/legacy-coaching-course/tasks' },
  { name: 'card table', path: '/p/legacy-coaching-course/board' },
  { name: 'chat', path: '/p/legacy-coaching-course/chat' },
  { name: 'schedule', path: '/p/legacy-coaching-course/schedule' },
  { name: 'team', path: '/p/legacy-coaching-course/team' },
  { name: 'documents', path: '/p/legacy-coaching-course/documents' },
  { name: 'activity', path: '/p/legacy-coaching-course/activity' },
  { name: 'contacts', path: '/p/legacy-coaching-course/contacts' },
  { name: 'sources', path: '/p/legacy-coaching-course/sources' },
  { name: 'project settings', path: '/p/legacy-coaching-course/settings' },
]

/*
  The measurement runs in the page as plain JavaScript. It is a string, not a function, because a function compiled by
  tsx carries a helper the page does not have.
*/
const MEASURE = `(() => {
  const excused = ${JSON.stringify(EXCUSED.map((e) => e.selector))};
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };
  const out = { overflow: 0, smallText: [], smallTargets: [], chars: 0 };
  out.overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // A blank screen raises no page error and no overflow, so the audit must say how much text the screen actually drew.
  out.chars = ((document.querySelector('main') || document.body).innerText || '').trim().length;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim() !== '');
    if (!own) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 12) out.smallText.push(el.tagName.toLowerCase() + ' ' + String(size) + 'px "' + (el.textContent || '').trim().slice(0, 28) + '"');
  }
  if (matchMedia('(pointer: coarse)').matches) {
    for (const el of Array.from(document.querySelectorAll('button, a[href], [role="button"], input, select, textarea'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 44 && r.height >= 44) continue;
      if (excused.some((sel) => el.matches(sel))) continue;
      const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
      out.smallTargets.push(el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 28) + ' ' + String(Math.round(r.width)) + 'x' + String(Math.round(r.height)) + ' "' + label + '"');
    }
  }
  return out;
})()`

type Finding = { screen: string; device: string; kind: string; detail: string }
const findings: Finding[] = []
const browser = await chromium.launch()
let measured = 0

const measure = async (
  device: string,
  opts: Parameters<typeof browser.newContext>[0],
  path: string,
  screen: string,
) => {
  const context = await browser.newContext(opts)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)))
  await page.goto(`http://127.0.0.1:${String(PORT)}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForTimeout(1300)
  measured++
  const result = (await page.evaluate(MEASURE)) as {
    overflow: number
    smallText: string[]
    smallTargets: string[]
    chars: number
  }
  // The floor is a control as well as a check: a screen that draws only its chrome is reported, not passed.
  if (result.chars < 60)
    findings.push({
      screen,
      device,
      kind: 'drew almost nothing',
      detail: `${String(result.chars)} visible characters in main`,
    })
  if (result.overflow > 1)
    findings.push({
      screen,
      device,
      kind: 'overflow',
      detail: `${String(result.overflow)}px wider than the viewport`,
    })
  for (const t of result.smallText.slice(0, 6))
    findings.push({ screen, device, kind: 'text below 12px', detail: t })
  for (const t of result.smallTargets.slice(0, 8))
    findings.push({ screen, device, kind: 'control below 44px', detail: t })
  for (const e of errors) findings.push({ screen, device, kind: 'page error', detail: e })
  await context.close()
}

try {
  for (const s of SCREENS) {
    await measure('desktop 1440', { viewport: { width: 1440, height: 900 } }, s.path, s.name)
    await measure(
      'phone 390',
      { ...devices['iPhone 14'], viewport: { width: 390, height: 844 } },
      s.path,
      s.name,
    )
  }
} finally {
  await browser.close()
  srv.close()
}

console.log(
  `verify:ui — ${String(measured)} screen measurements (${String(SCREENS.length)} screens × 2 devices)`,
)
for (const e of EXCUSED) console.log(`  excused: ${e.selector} — ${e.reason}`)
if (findings.length === 0) {
  console.log(
    'every screen clears the overflow, text and touch floors, and no page error was raised',
  )
  process.exit(0)
}
console.log(`${String(findings.length)} finding(s):`)
for (const f of findings) console.log(`  [${f.device}] ${f.screen}: ${f.kind} — ${f.detail}`)
process.exit(1)
