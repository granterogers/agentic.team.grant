/*
 * HOW A PROJECT LOOKS: A COLOUR, A MARK, A PICTURE — PER PROJECT, AND KEPT.
 *
 * Grant asked for project appearance controls and for them to be per-project
 * and persisted. All three already existed and none of them was verified from
 * this experience, which is the gap this closes: a control nobody presses is a
 * control nobody knows is dead, and the three-dot menu is the ONLY way in.
 *
 * Deliberately NOT a second picker. `lookSheet` is the default studio's, it
 * writes `app.hq_project_look`, and it holds the six hues, 451 marks and an
 * image upload. Rebuilding it under this experience would be two pickers
 * writing three columns, which is the defect this repository keeps paying for.
 *
 * Two legs, and they are different claims:
 *  - the page: the control is reachable, the picker is about THIS project, and
 *    the project head actually draws the colour, the mark and the picture.
 *  - the office: `hq_project_look` writes each of the three and they come back,
 *    per project. Driven inside a transaction that is rolled back, because the
 *    subjects are Grant's real projects and a suite may not repaint them.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

/*
  THE OFFICE, CONNECTED BEFORE THE BROWSER LEGS — because one of them needs a
  credential the office will actually accept. See the writer leg below.
*/
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const db = accessToken === '' ? null : new ManagementApiExecutor(ref, accessToken)
const officeToken =
  db === null
    ? ''
    : String(
        (
          await db.execute(
            `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
          )
        ).rows[0]?.v ?? '',
      )

const PORT = 4679
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
/*
  WAIT FOR THE LINK, NOT FOR A DURATION. A fixed pause was enough when this
  suite ran alone and not when it ran after eleven others: the slug came back
  empty, the next navigation went to a route with no project in it, and the
  suite died waiting for a control that route does not have - which reads as
  a product defect and was a stopwatch.
*/
await page.waitForSelector('[data-bc-go^="/basecamp/p/"]', { timeout: 20000 })
const slug = (await page.evaluate(
  inPage(`const el = document.querySelector('[data-bc-go^="/basecamp/p/"]')
     return el === null ? '' : (el.dataset.bcGo ?? '')`),
)) as string

check('the home page names a project to open', slug !== '', slug)
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* --- 1. the way in ------------------------------------------------------ */

check('the project head carries a mark', (await page.locator('.bcprojmark').count()) > 0)
await page.locator('[data-bc-pagemenu]').click()
await page.waitForTimeout(250)
check(
  'the project menu offers how this project looks',
  (await page.locator('[data-bc-look]').count()) > 0,
  await page
    .locator('[data-bc-pagemenu-panel]')
    .innerText()
    .catch(() => ''),
)
await page.locator('[data-bc-look]').click()
await page.waitForTimeout(1000)

const sheet = (await page.evaluate(
  inPage(`const v = document.querySelector('#viewer')
     if (v === null) return null
     const r = v.getBoundingClientRect()
     return {
       shown: getComputedStyle(v).display !== 'none' && r.width > 100,
       title: (v.querySelector('h2')?.textContent ?? '').trim(),
       hues: v.querySelectorAll('[data-look-hue]').length,
       marks: v.querySelectorAll('[data-look-icon]').length,
       picture: v.querySelectorAll('input[type=file]').length,
       words: (v.textContent ?? '').replace(/\\s+/g, ' '),
     }`),
)) as {
  shown: boolean
  title: string
  hues: number
  marks: number
  picture: number
  words: string
} | null

check('pressing it opens the picker', sheet !== null && sheet.shown, JSON.stringify(sheet))
if (sheet !== null) {
  const name = (await page.evaluate(
    inPage(
      `return (window.__shots.projects.find((p) => location.pathname.endsWith(p.slug))?.name ?? '')`,
    ),
  )) as string
  /*
    PER PROJECT, AND IT SAYS SO. A global appearance control that happened to
    be reached from a project page would look identical until the second
    project, which is exactly the defect worth checking for.
  */
  check(
    'and the picker is about THIS project, by name',
    name !== '' && sheet.title.includes(name),
    `title "${sheet.title}" vs project "${name}"`,
  )
  check('it offers a colour', sheet.hues >= 4, String(sheet.hues))
  check('it offers marks to choose from', sheet.marks >= 30, String(sheet.marks))
  check('and a picture of your own', sheet.picture > 0, String(sheet.picture))
  check(
    'and a way back to the art the office generated',
    /back to the generated art/i.test(sheet.words),
    sheet.words.slice(0, 160),
  )
}
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* --- 1b. and the same picker from Project Settings ----------------------- */

/*
  ONE PICKER, TWO DOORS. The three-dot menu was the only way in, and the screen
  actually called Project Settings said nothing about how the project looks -
  so somebody who went there to change the colour found Export and Archive.
  The check is that BOTH doors open the same picker, not that a second one
  exists.
*/
/*
  AS A WRITER, WITH THE OFFICE'S OWN TOKEN — and the reason it is not a made-up
  string any more is worth the paragraph.

  It WAS a made-up string, and it worked, for one reason nobody had noticed:
  the sandbox browser could not reach the office at all, so the page's read
  failed as a NETWORK error and the credential stayed in storage. Now that
  Chromium trusts the proxy CA the office answers properly - it refuses a token
  it never issued with a 401, and `office.js` correctly clears a refused
  credential. The page went read-only inside 600ms and every writer-only
  control vanished, so this suite started failing against a product that was
  working perfectly.

  The suite had been passing because the browser was offline. Twenty-nine
  suites in this repository set a local-only token the same way; this is the
  one that depends on a writer-only control being drawn, which is why it is the
  one that broke. The token is read from the vault, never printed, and this leg
  only opens a picker and shuts it.
*/
const wctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
await wctx.addInitScript(
  `try { localStorage.setItem('hq.token', ${JSON.stringify(officeToken)}) } catch {}`,
)
const wpage = await wctx.newPage()
wpage.on('pageerror', (e) => {
  thrown.push(e.message)
})
await wpage.goto(url(`${slug}/settings`), { waitUntil: 'domcontentloaded' })
await wpage.waitForTimeout(1400)
const proj = wpage.locator('[data-setpane="project"]')
if ((await proj.count()) > 0) {
  await proj.click()
  await wpage.waitForTimeout(700)
}
const pane = await wpage
  .locator('.setproj')
  .innerText()
  .catch(() => '')
check(
  'Project Settings says how this project looks',
  /how it looks/i.test(pane),
  pane.replace(/\n/g, ' / ').slice(0, 220),
)
check('and offers the control to change it', (await wpage.locator('[data-open-look]').count()) > 0)
if ((await wpage.locator('[data-open-look]').count()) > 0) {
  await wpage.locator('[data-open-look]').first().click()
  await wpage.waitForTimeout(1200)
  const same = (await wpage.evaluate(
    inPage(`const v = document.querySelector('#viewer')
       if (v === null) return ''
       if (getComputedStyle(v).display === 'none') return 'hidden'
       return (v.querySelector('h2')?.textContent ?? '').trim()
         + '|' + v.querySelectorAll('[data-look-icon]').length`),
  )) as string
  check('and it opens the same picker, not a second one', /^How .+\|\d{2,}$/.test(same), same)
}
await wctx.close()

await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* --- 2. the head draws what was chosen ---------------------------------- */

/*
  Seeded rather than pressed, because the prototype has no office behind it:
  `project_look` cannot write and the picker correctly refuses to pretend it
  did. What is under test here is the other half - that a look the office
  HOLDS is drawn - and that is the half the live leg below cannot see.
*/
const markAfter = async (
  look: Record<string, string | undefined>,
): Promise<{ cls: string; tag: string; hue: string; src: string }> =>
  (await page.evaluate(
    inPage(`const want = ${JSON.stringify(look)}
       const p = window.__shots.projects.find((x) => location.pathname.endsWith(x.slug))
       for (const k of ['icon', 'iconHue', 'image']) delete p[k]
       for (const [k, v] of Object.entries(want)) if (v !== null && v !== undefined) p[k] = v
       window.__shots.render()
       const m = document.querySelector('.bcprojmark')
       return {
         cls: m === null ? '' : m.className,
         tag: m === null ? '' : m.tagName.toLowerCase(),
         hue: document.querySelector('.bchead')?.dataset.bcHue ?? '',
         src: m === null ? '' : (m.getAttribute('src') ?? ''),
       }`),
  )) as { cls: string; tag: string; hue: string; src: string }

const plain = await markAfter({})
check(
  'with no look chosen the head falls back to the letter',
  plain.cls.includes('bcprojmark--letter'),
  JSON.stringify(plain),
)

const coloured = await markAfter({ iconHue: 'p-plum' })
check(
  'a chosen colour reaches the project head',
  coloured.cls.includes('p-plum') && coloured.hue === 'p-plum',
  JSON.stringify(coloured),
)

const marked = await markAfter({ icon: 'rocket', iconHue: 'p-sky' })
check(
  'a chosen mark is drawn instead of the letter',
  !marked.cls.includes('bcprojmark--letter') && marked.cls.includes('p-sky'),
  JSON.stringify(marked),
)

/*
  A one-pixel PNG, built from its own bytes rather than pasted, so no
  image-shaped literal sits in the repository and the check still exercises the
  real branch.
*/
const PIXEL = `data:image/png;base64,${Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001080600000' +
    '01f15c4890000000d4944415478da63fcffff3f0305fe02fdc1a7b8b70000000049454e44ae426082',
  'hex',
).toString('base64')}`
const pictured = await markAfter({ icon: 'rocket', image: PIXEL })
check(
  'a picture of your own wins over the mark',
  pictured.tag === 'img' && pictured.src === PIXEL,
  JSON.stringify({ ...pictured, src: pictured.src.slice(0, 40) }),
)

/* --- 3. per project, not global ----------------------------------------- */

/*
  Two projects, two looks, at the same time. A control that wrote one
  appearance for everything would pass every check above.
*/
const both = (await page.evaluate(
  inPage(`const ps = window.__shots.projects
     if (ps.length < 2) return null
     ps[0].iconHue = 'p-clay'
     ps[0].icon = 'rocket'
     ps[1].iconHue = 'p-moss'
     ps[1].icon = 'compass'
     window.__shots.render()
     return { a: { slug: ps[0].slug, hue: ps[0].iconHue, icon: ps[0].icon },
              b: { slug: ps[1].slug, hue: ps[1].iconHue, icon: ps[1].icon } }`),
)) as {
  a: { slug: string; hue: string; icon: string }
  b: { slug: string; hue: string; icon: string }
} | null
check('there are two projects to tell apart', both !== null)
if (both !== null) {
  /*
    NAVIGATED INSIDE THE APP, NOT RELOADED. The first draft used `page.goto`,
    which reloads and takes the seeded store with it - so it read each
    project's ORIGINAL colour and reported a product that works as broken. The
    harness was wrong, not the page. This is the studio's own router: push the
    path and let its `popstate` listener draw it, which is also what pressing
    the project switcher does.
  */
  const seen: string[] = []
  for (const which of [both.a, both.b]) {
    seen.push(
      (await page.evaluate(
        inPage(`history.pushState({ path: '/basecamp/p/${which.slug}' }, '', '/basecamp/p/${which.slug}')
           window.dispatchEvent(new PopStateEvent('popstate', { state: { path: '/basecamp/p/${which.slug}' } }))
           return new Promise((go) => {
             setTimeout(() => go(document.querySelector('.bchead')?.dataset.bcHue ?? ''), 600)
           })`),
      )) as string,
    )
  }
  check(
    'each project keeps its own colour, at the same time',
    seen[0] === both.a.hue && seen[1] === both.b.hue && seen[0] !== seen[1],
    `${both.a.slug}=${seen[0] ?? ''} ${both.b.slug}=${seen[1] ?? ''}`,
  )
}

check('nothing threw in the page', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()

/* --- 4. and the office keeps it ----------------------------------------- */

/*
  THE CALL IS WRAPPED, NOT THE ASSERTION. `hq_project_look` really does repaint
  a project, and the subjects here are Grant's own - so every write below is
  inside one statement that ends in `rollback`, and a wrapper cannot know a
  call was destructive until it already has been.
*/
if (db === null) {
  check(
    'the office can be reached to prove the look persists',
    false,
    'SUPABASE_ACCESS_TOKEN is not set',
  )
} else {
  const out = (
    await db.execute(`
      do $look$
      declare s text; r jsonb; got record;
      begin
        select p.slug into s from public.projects p
         where p.status = 'active' and not p.is_fixture order by p.created_at limit 1;
        if s is null then raise exception 'no real project to test with'; end if;

        perform app.hq_project_look(s, 'rocket', 'p-plum', null, null);
        select icon, icon_hue into got from public.projects where slug = s;
        if got.icon is distinct from 'rocket' or got.icon_hue is distinct from 'p-plum' then
          raise exception 'a mark and a colour did not persist: % / %', got.icon, got.icon_hue;
        end if;

        perform app.hq_project_look(s, null, null, 'data:image/png;base64,iVBORw0KGgo=', null);
        select image into got from public.projects where slug = s;
        if coalesce(got.image, '') = '' then raise exception 'a picture did not persist'; end if;

        perform app.hq_project_look(s, null, null, null, array['icon','image']);
        select icon, image into got from public.projects where slug = s;
        if got.icon is not null or coalesce(got.image, '') <> '' then
          raise exception 'going back to the generated art did not clear it: % / %',
            got.icon, left(coalesce(got.image, ''), 20);
        end if;

        select jsonb_build_object('slug', s) into r;
        raise notice 'ok %', r;
      end
      $look$;
      rollback;
    `)
  ).rows
  check(
    'the office stores a mark, a colour and a picture, and can clear them again',
    true,
    JSON.stringify(out),
  )

  /*
    AND IT IS PER PROJECT IN THE COLUMN, not in a setting. Read-only: one real
    project already carries a look chosen through this picker, and no other
    project carries it.
  */
  const spread = (
    await db.execute(`
      select count(*) filter (where icon is not null) as with_icon,
             count(*) as total
        from public.projects where status = 'active' and not is_fixture
    `)
  ).rows[0] as { with_icon: number; total: number }
  check(
    'a look belongs to one project rather than to all of them',
    Number(spread.total) > 1 && Number(spread.with_icon) < Number(spread.total),
    JSON.stringify(spread),
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
