/**
 * A tour of Team HQ as the Sample Person: every project, every tool, at the widths a person uses.
 *   npx tsx scripts/sample/tour.ts <label> [--widths desktop,laptop,tablet,phone] [--tools a,b]
 *
 * Captures into .out/tour-<label>/<width>/<project>-<tool>.png and prints, per capture, the things a screenshot cannot
 * say by itself: page errors, sideways scroll, the number of controls under 44px on touch, text under 12px, and the first
 * line of what the surface says. It judges nothing; it makes the looking cheap and the measuring honest.
 * Signed in through the same hand-off a magic link ends with; writes nothing.
 */
import { mkdirSync } from 'node:fs'
import { closeSettings, newPage, openSettings, settle, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const args = process.argv.slice(2)
const label = args[0] ?? 'now'
const flag = (n: string): string | undefined => {
  const i = args.indexOf(n)
  return i === -1 ? undefined : args[i + 1]
}
const WIDTHS = {
  desktop: { width: 1680, height: 1000, touch: false },
  laptop: { width: 1280, height: 800, touch: false },
  tablet: { width: 820, height: 1100, touch: true },
  phone: { width: 390, height: 844, touch: true },
} as const
const chosen = (flag('--widths') ?? 'desktop,phone').split(',') as (keyof typeof WIDTHS)[]
const TOOLS = (
  flag('--tools') ?? 'overview,tasks,documents,contacts,schedule,activity,team,sources,settings'
).split(',')

const office = await sampleOffice()
const slugs = (
  await rows(
    `select slug from public.projects where office_id = '${office.officeId}' and status = 'active' and slug <> 'unnamed' order by name`,
  )
).map((r) => String(r.slug))

const MEASURE = `(() => {
  const small = [], tiny = []
  const touch = matchMedia('(pointer: coarse)').matches
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], summary')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (touch && r.height < 43.5 && !el.closest('[hidden]')) small.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24) + ' ' + Math.round(r.height))
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  while (walker.nextNode()) {
    const n = walker.currentNode, t = (n.textContent || '').trim()
    if (t.length < 2 || !n.parentElement) continue
    const cs = getComputedStyle(n.parentElement)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    if (parseFloat(cs.fontSize) < 12 && !seen.has(t.slice(0, 20))) { seen.add(t.slice(0, 20)); tiny.push(t.slice(0, 24) + ' ' + cs.fontSize) }
  }
  return {
    wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    small: small.slice(0, 6), smallN: small.length, tiny: tiny.slice(0, 6), tinyN: tiny.length,
    first: (document.querySelector('main')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 90),
  }
})()`

const studio = await startStudio(4793)
const s = await session()
let problems = 0
try {
  for (const w of chosen) {
    const vp = WIDTHS[w]
    mkdirSync(`.out/tour-${label}/${w}`, { recursive: true })
    const { page, errors } = await newPage(studio, { width: vp.width, height: vp.height }, vp.touch)
    await signIn(studio, page, s)
    const cap = async (name: string): Promise<void> => {
      await page.waitForTimeout(900)
      const m = (await page.evaluate(MEASURE)) as {
        wide: number
        small: string[]
        smallN: number
        tiny: string[]
        tinyN: number
        first: string
      }
      await page.screenshot({ path: `.out/tour-${label}/${w}/${name}.png`, fullPage: true })
      const flags = [
        m.wide > 1 ? `SIDEWAYS ${m.wide}px` : '',
        m.smallN > 0 ? `small ${m.smallN} (${m.small.slice(0, 3).join('; ')})` : '',
        m.tinyN > 0 ? `tiny ${m.tinyN} (${m.tiny.slice(0, 3).join('; ')})` : '',
      ].filter(Boolean)
      // A capture of the loading skeleton or the prototype is a capture of nothing, and `clean` over it is the vacuous result.
      if (/Loading your office|Connecting to your office|Legacy Coaching Course/.test(m.first))
        flags.push('NOT SETTLED (skeleton or prototype)')
      if (flags.length > 0) problems += 1
      console.log(
        `${w.padEnd(7)} ${name.padEnd(34)} ${flags.join(' | ') || 'clean'}   «${m.first}»`,
      )
    }
    // --project <slug> captures that one project's tools only (a smaller, lighter run on a host with little headroom)
    const only = flag('--project')
    for (const [name, path] of [
      ['home', '/'],
      ['my-tasks', '/tasks'],
      ['activity', '/activity'],
    ] as const) {
      if (only !== undefined) continue
      await page.goto(`${studio.base}${path}`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      await cap(name)
    }
    for (const slug of slugs) {
      if (only !== undefined && slug !== only) continue
      for (const tool of TOOLS) {
        if (tool === 'settings') continue
        await page.goto(`${studio.base}/p/${slug}${tool === 'overview' ? '' : `/${tool}`}`, {
          waitUntil: 'domcontentloaded',
        })
        await settle(page)
        await cap(`${slug}-${tool}`)
      }
    }
    if (TOOLS.includes('settings')) {
      await page.goto(`${studio.base}/`, { waitUntil: 'domcontentloaded' })
      await settle(page)
      for (const tab of [
        'team',
        'behaviour',
        'requests',
        'memory',
        'connections',
        'channels',
        'appearance',
        'models',
        'health',
        'help',
      ]) {
        await openSettings(page, tab).catch(() => undefined)
        await cap(`settings-${tab}`)
        await closeSettings(page)
      }
    }
    if (errors.length > 0) {
      problems += 1
      console.log(`${w}: PAGE ERRORS ${errors.slice(0, 3).join(' || ')}`)
    }
  }
} finally {
  await studio.close()
}
console.log(
  `\ntour ${label}: ${problems} capture(s) with something to look at; images in .out/tour-${label}/`,
)
void office
