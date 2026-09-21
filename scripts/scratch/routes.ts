import { chromium } from 'playwright'
import { serveStudio } from '../verify/serve-studio.ts'
const PORT = 4671
const server = await serveStudio(PORT)
const inPage = (b: string): string => `(() => { ${b} })()`
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errs: string[] = []
page.on('pageerror', (e) => errs.push(e.message))

const paths = [
  '/basecamp',
  '/basecamp/',
  '/basecamp/tasks',
  '/basecamp/activity',
  '/basecamp/search',
  '/basecamp/p/legacy-coaching-course',
  '/basecamp/p/legacy-coaching-course/overview',
  '/basecamp/p/legacy-coaching-course/tasks',
  '/basecamp/p/legacy-coaching-course/team',
  '/basecamp/p/legacy-coaching-course/documents',
  '/basecamp/p/legacy-coaching-course/activity',
  '/basecamp/p/legacy-coaching-course/contacts',
  '/basecamp/p/legacy-coaching-course/sources',
  '/basecamp/p/legacy-coaching-course/settings',
  '/basecamp/p/legacy-coaching-course/board',
  '/basecamp/p/legacy-coaching-course/nonsense',
  '/basecamp/p/no-such-project',
  '/basecamp/nonsense',
]
console.log('path'.padEnd(52), 'H1'.padEnd(26), 'crumb'.padEnd(34), 'url after')
for (const p of paths) {
  await page.goto(`http://127.0.0.1:${String(PORT)}${p}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.bcmain').catch(() => undefined)
  await page.waitForTimeout(350)
  const r = (await page.evaluate(
    inPage(`const h1 = document.querySelector('.bcmain h1')
      const c = document.querySelector('.bccrumb')
      return JSON.stringify({
        h1: h1 === null ? '(none)' : (h1.textContent ?? '').trim(),
        crumb: c === null ? '(none)' : (c.textContent ?? '').replace(/\\s+/g, ' ').trim(),
        url: location.pathname,
      })`),
  )) as string
  const o = JSON.parse(r) as { h1: string; crumb: string; url: string }
  console.log(p.padEnd(52), o.h1.slice(0, 25).padEnd(26), o.crumb.slice(0, 33).padEnd(34), o.url)
}
if (errs.length > 0) console.log('\nPAGE ERRORS:', [...new Set(errs)].join(' | '))
await browser.close()
server.close()
