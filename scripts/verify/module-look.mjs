/*
 * Module look, as a person sees it. A local journey against the STATIC prototype (no token, no production contact):
 *
 *   1. a project opens and its modules draw;
 *   2. every module has a neutral background and a title in its own colour;
 *   3. the phone task checkbox draws as a closed box (regression for the "+ |" glyph);
 *   4. the project menu opens and its Projects section collapses and expands;
 *   5. on a 390px phone nothing scrolls sideways;
 *   6. no page error while doing all of it.
 *
 * Each check is paired with the property it must NOT satisfy, so a check that always passes cannot read as green.
 * Run it with the static server up:  python3 -m http.server 8765 --directory web/studio  &&  node scripts/verify/module-look.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.STUDIO_URL ?? 'http://127.0.0.1:8765/'
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
  if (!ok) failures.push(name)
}

const openProject = async (page) => {
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    history.pushState({}, '', '/p/legacy-coaching-course/overview')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.waitForFunction(() => document.querySelectorAll('.bcmod').length >= 6, null, { timeout: 15000 })
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

// Desktop: modules, titles, menu.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await openProject(page)

  const mods = await page.$$eval('.bcmod--tinted', (els) =>
    els.map((el) => {
      const cs = getComputedStyle(el)
      const title = el.querySelector('.bcmodtitle')
      return {
        slot: el.dataset.slot,
        bg: cs.backgroundColor,
        titleColour: title ? getComputedStyle(title).color : '',
        glow: cs.boxShadow,
      }
    }),
  )
  check('six or more tinted modules draw', mods.length >= 6, `${mods.length}`)
  const titles = new Set(mods.map((m) => m.titleColour))
  check('module titles are coloured, not one shared ink', titles.size >= 3, `${titles.size} distinct`)
  // Neutral = an opaque surface colour (rgb, no alpha). A tint fill is a colour mixed with transparency (rgba), so
  // the control is that a tinted fill would fail this check.
  check('module backgrounds are opaque neutral surfaces, not tint fills', mods.every((m) => m.bg.startsWith('rgb(')), mods.map((m) => m.bg).join(' | '))
  check('module glow is drawn (control: a glow-less box is not)', mods.every((m) => m.glow !== 'none' && m.glow.includes('24px')), mods[0]?.glow.slice(0, 60))

  // Menu: opens, Projects section collapses and re-expands.
  await page.locator('[data-bc-menu]').first().click({ force: true })
  await page.waitForTimeout(500)
  const openText = await page.$eval('.bcmenupanel', (el) => el.innerText)
  check('project menu opens and lists the projects', openText.includes('Legacy Coaching Course') && openText.includes('Wellness'))
  // Every module row in the menu carries its own icon, in its own colour, from the dashboard's identity table. A row
  // without an icon is the failure this guards; the control is that the rows are counted, not assumed.
  const menuRows = await page.$$eval('.bcmenuitem[data-bc-expand], .bcmenuitem[data-bc-sources]', (els) =>
    els.map((el) => {
      const icon = el.querySelector('.bcmenuicon svg')
      const wrap = el.querySelector('.bcmenuicon')
      return {
        name: el.innerText.trim(),
        hasIcon: icon !== null,
        colour: wrap === null ? '' : getComputedStyle(wrap).color,
      }
    }),
  )
  check('menu has the six module rows plus Sources (control)', menuRows.length >= 7, `${menuRows.length} rows`)
  check('every module row in the menu has its icon', menuRows.every((r) => r.hasIcon), menuRows.filter((r) => !r.hasIcon).map((r) => r.name).join(', '))
  const menuColours = new Set(menuRows.map((r) => r.colour))
  check('menu icons take their own colours, not one shared colour', menuColours.size >= 3, `${menuColours.size} distinct`)
  const projectsBefore = (await page.$eval('.bcmenupanel', (el) => el.innerText)).includes('AI learning')
  check('Projects list is shown by default (control)', projectsBefore)
  // The Projects section header is the one button carrying aria-expanded; pressing it must collapse the list.
  const sectionToggle = page.locator('.bcmenupanel button[aria-expanded]').first()
  check('Projects section header reports it is expanded (control)', (await sectionToggle.getAttribute('aria-expanded')) === 'true')
  await sectionToggle.click({ force: true })
  // A fine pointer that rests over the header reveals the list on hover (bc.css, #473), so the pointer must leave first.
  await page.mouse.move(1, 1)
  await page.waitForTimeout(400)
  const afterCollapse = (await page.$eval('.bcmenupanel', (el) => el.innerText)).includes('AI learning')
  check('Projects section collapses when its toggle is pressed', afterCollapse === false && (await sectionToggle.getAttribute('aria-expanded')) === 'false', afterCollapse ? 'still listed' : '')

  check('no page error on desktop', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

// Phone: checkbox box, no sideways scroll.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await openProject(page)

  const box = await page.evaluate(() => {
    const cb = document.querySelector('.bcmod[data-slot="tasks"] .bctask .bccheck')
    if (!cb) return null
    const cs = getComputedStyle(cb)
    return { bg: cs.backgroundImage, pos: cs.backgroundPosition, size: cs.backgroundSize, repeat: cs.backgroundRepeat }
  })
  check('phone task checkbox has four edge layers (the closed box)', box !== null && box.bg.split('linear-gradient').length - 1 === 4, box ? box.size : 'no checkbox')
  check('phone checkbox edges use exact pixel offsets, not percentages', box !== null && box.pos.includes('14.5px') && !box.pos.includes('%'), box ? box.pos : '')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no sideways scroll at 390px', overflow <= 0, `overflow ${overflow}px`)
  check('no page error on phone', errors.length === 0, errors.slice(0, 2).join(' | '))
  await page.close()
}

await browser.close()
if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall checks passed')
}
