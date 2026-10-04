/**
 * The phone header of a project page, as the Sample Person (P5): is the project's NAME shown?
 *   npm run sample:phone-header
 *
 * On a 390px screen the header must say which project the person is in, in words. Measures the header's text and the
 * box the name sits in (an element that exists but is clipped to nothing is not a name), on several project routes, and
 * writes a capture of each so the result is looked at, not only counted.
 */
import { mkdirSync } from 'node:fs'
import { newPage, signIn, startStudio } from './browser.ts'
import { lit, rows, sampleOffice, session } from './lib.ts'

mkdirSync('.out/phone-header', { recursive: true })
const O = (await sampleOffice()).officeId
const s = await session()
const projects = (await rows(
  `select slug, name from public.projects where office_id = ${lit(O)}::uuid and status = 'active' and name <> 'Unnamed' order by name`,
)) as { slug: string; name: string }[]
const studio = await startStudio(4782)
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
try {
  for (const width of [320, 360, 390, 430]) {
    const { ctx, page } = await newPage(studio, { width, height: 844 }, true)
    await signIn(studio, page, s)
    for (const p of projects.slice(0, 3)) {
      for (const tab of ['overview', 'tasks', 'documents']) {
        await page.goto(`${studio.base}/p/${p.slug}/${tab}`, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => null)
        await page.waitForTimeout(1500)
        const seen = await page.evaluate((name) => {
          const header = document.querySelector(
            'header, .topbar, [class*="topbar"], [class*="mobilebar"]',
          )
          const hits = [...document.querySelectorAll('body *')].filter(
            (el) =>
              el.children.length === 0 &&
              (el.textContent ?? '').trim() === name &&
              (el as HTMLElement).offsetParent !== null,
          )
          const inTop = hits.filter((el) => el.getBoundingClientRect().top < 120)
          const box = inTop[0]?.getBoundingClientRect()
          return {
            headerText: (header?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
            visibleTop: inTop.length,
            box:
              box === undefined
                ? null
                : { w: Math.round(box.width), h: Math.round(box.height), top: Math.round(box.top) },
          }
        }, p.name)
        check(
          `${String(width)}px ${p.name} / ${tab}: the project name is shown in the top 120px, at least 40px wide`,
          seen.visibleTop > 0 && (seen.box?.w ?? 0) >= 40,
          JSON.stringify(seen.box),
        )
        if (tab === 'overview' && p.slug === 'wellness-studio-launch')
          await page.screenshot({
            path: `.out/phone-header/${String(width)}.png`,
            clip: { x: 0, y: 0, width, height: 120 },
          })
      }
    }
    await ctx.close()
  }
} finally {
  await studio.close()
}
console.log(failed === 0 ? '\nall passed' : `\n${String(failed)} FAILED`)
process.exit(failed === 0 ? 0 : 1)
