/*
 * ORDERING DOCUMENTS ON THE DEPLOYED PAGE, IN BOTH VIEWS.
 *
 *   npm run verify:basecamp-docorder-live
 *
 * §38's list, driven rather than described:
 *
 *   Name / Date uploaded / Date created  — the order the office's own data says
 *   Custom, in the miniature             — drag, no accidental open, persists
 *   Custom, in the expanded view         — the same
 *   Cross-view                           — reorder one, the other agrees
 *   Sort preservation                    — custom → Name → dates → custom
 *
 * WHAT IT DOES TO GRANT'S DOCUMENTS. Nothing. It arranges, asserts, and puts
 * the office back exactly as it found it — including deleting the order row if
 * there was not one before, because leaving an arrangement behind IS changing
 * his workspace even when every document is untouched.
 *
 * WHY THE DRAG IS DISPATCHED. Headless Chromium will not start a native drag
 * from a synthesised pointer gesture; `page.dragAndDrop` and a button-down
 * with eight intermediate moves were both tried against the Card Table and
 * neither worked. The events are the browser's own and the handlers are the
 * product's, so the routing, the write and the refusal to open are genuinely
 * exercised. A human dragging remains the one unproven step.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */

import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { signIn } from './lib/sign-in.ts'

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

const SITE =
  process.env.BASECAMP_SITE ?? 'https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app'
const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)

const SLUG = 'legacy-coaching-course'

/** The ids on screen, in the order drawn. */
const drawn = (page: Page): Promise<string[]> =>
  page.evaluate(
    inPage(
      "return [...document.querySelectorAll('[data-bc-docdrop] [data-bc-docid]')].map((e) => e.getAttribute('data-bc-docid'))",
    ),
  ) as Promise<string[]>

/** What the office is holding for this person and project. */
const atTheOffice = async (): Promise<string[]> => {
  const { rows } = await db.execute(
    `select o.doc_ids from public.document_orders o
       join public.projects p using (project_id)
      where p.slug = '${SLUG}' and o.owner = 'grant'`,
  )
  const held = (rows[0] as { doc_ids?: unknown } | undefined)?.doc_ids
  const parsed = typeof held === 'string' ? JSON.parse(held) : held
  return Array.isArray(parsed) ? parsed.map(String) : []
}

/*
  WAIT FOR THE OFFICE, do not read once.

  The write is fire-and-forget by design -- an arrangement that stuck on screen
  and is still travelling is better than a gesture that waits for a round trip
  -- so a single read a second later is a race. The first version of this suite
  lost it, reported the office as empty, and then "the office still holds the
  same order" compared two empty lists and passed. A check that races is worse
  than no check, and one that passes vacuously afterwards is worse still.
*/
const officeHas = async (first: string, within = 15000): Promise<string[]> => {
  const until = Date.now() + within
  let held = await atTheOffice()
  while (held[0] !== first && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500))
    held = await atTheOffice()
  }
  return held
}

const choose = async (page: Page, mode: string): Promise<void> => {
  await page.selectOption('[data-bc-docsort]', mode)
  await page.waitForTimeout(700)
}

/** Dispatch the drag the browser would, against one DataTransfer. */
const dragOnto = async (page: Page, moved: string, onto: string): Promise<string> =>
  (await page.evaluate(
    inPage(`
      const from = document.querySelector('[data-bc-docid="${moved}"]')
      const to = document.querySelector('[data-bc-docid="${onto}"]')
      if (from === null || to === null) return 'one end is missing'
      const dt = new DataTransfer()
      from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      if (dt.getData('text/plain') === '') return 'dragstart carried nothing'
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }))
      return 'dragged'
    `),
  )) as string

const before = await atTheOffice()
const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const errors: string[] = []

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await signIn(page, db, { ref, origin: SITE, back: `${SITE}/basecamp/p/${SLUG}` })
  await page.waitForSelector('[data-bc-docdrop] [data-bc-docid]', { timeout: 30000 })
  await page.waitForTimeout(1500)

  /* --- the control is there, in the miniature ---------------------------- */

  const offered = (await page.evaluate(
    inPage(`
      const pick = document.querySelector('[data-bc-docsort]')
      return {
        there: pick !== null,
        options: pick === null ? [] : [...pick.options].map((o) => o.value),
        labelled: pick === null ? false : document.querySelector('label[for="' + pick.id + '"]') !== null,
      }
    `),
  )) as { there: boolean; options: string[]; labelled: boolean }
  check('the miniature offers an ordering control', offered.there)
  check(
    'with all four modes',
    ['custom', 'name', 'uploaded', 'created'].every((m) => offered.options.includes(m)),
    offered.options.join(','),
  )
  check('and it is labelled for anybody reading the page aloud', offered.labelled)

  /* --- what the office's own data says the orders are -------------------- */

  const truth = (
    await db.execute(
      `select d.document_id::text as id, d.title,
              d.fetched_at as uploaded,
              case when d.origin = 'made' then d.created_at else null end as created
         from public.documents d join public.projects p using (project_id)
        where p.slug = '${SLUG}'`,
    )
  ).rows as { id: string; title: string; uploaded: string | null; created: string | null }[]
  check('the office holds documents to order', truth.length > 2, `${String(truth.length)}`)

  await choose(page, 'name')
  const byName = await drawn(page)
  const wantName = [...truth]
    .sort((a, b) => a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' }))
    .map((t) => t.id)
    .filter((id) => byName.includes(id))
  check(
    'Name puts them in the order their names go',
    byName.join(',') === wantName.join(','),
    `${byName.length} shown`,
  )

  await choose(page, 'uploaded')
  const byUp = await drawn(page)
  const known = new Map(truth.map((t) => [t.id, t.uploaded]))
  const firstMissing = byUp.findIndex((id) => (known.get(id) ?? null) === null)
  const lastKnown = byUp.reduce((n, id, i) => ((known.get(id) ?? null) === null ? n : i), -1)
  check(
    'Date uploaded puts everything it knows before everything it does not',
    firstMissing === -1 || firstMissing > lastKnown,
    `first unknown at ${String(firstMissing)}, last known at ${String(lastKnown)}`,
  )

  await choose(page, 'created')
  const byMade = await drawn(page)
  const madeKnown = new Map(truth.map((t) => [t.id, t.created]))
  const firstUnknown = byMade.findIndex((id) => (madeKnown.get(id) ?? null) === null)
  const lastDated = byMade.reduce((n, id, i) => ((madeKnown.get(id) ?? null) === null ? n : i), -1)
  check(
    'Date created does the same, and does not invent one',
    firstUnknown === -1 || firstUnknown > lastDated,
    `${String(truth.filter((t) => t.created !== null).length)} of ${String(truth.length)} have a real creation date`,
  )

  /* --- custom, in the miniature ------------------------------------------ */

  await choose(page, 'custom')
  const start = await drawn(page)
  check('there are enough to rearrange', start.length > 2, `${String(start.length)}`)
  const moved = start[2] ?? ''
  const onto = start[0] ?? ''

  const opened = (await page.evaluate(
    inPage("return document.querySelectorAll('.bcrecordhead').length"),
  )) as number
  const said = await dragOnto(page, moved, onto)
  check('the drag carried the document it started on', said === 'dragged', said)
  await page.waitForTimeout(1500)

  const afterDrag = await drawn(page)
  check(
    'it lands where it was dropped',
    afterDrag[0] === moved,
    `${afterDrag.slice(0, 3).join(',')}`,
  )
  const openedAfter = (await page.evaluate(
    inPage("return document.querySelectorAll('.bcrecordhead').length"),
  )) as number
  check('and dragging did not open the document', openedAfter === opened)

  const savedMini = await officeHas(moved)
  check(
    'and the OFFICE has the order, not just this browser',
    savedMini.length > 0 && savedMini[0] === moved,
    savedMini.slice(0, 3).join(','),
  )

  /* --- switching modes must not destroy it (§32) ------------------------- */

  await choose(page, 'name')
  await choose(page, 'uploaded')
  await choose(page, 'created')
  await choose(page, 'custom')
  const backToCustom = await drawn(page)
  check(
    'a trip through every other mode leaves the custom order exactly as it was',
    backToCustom.join(',') === afterDrag.join(','),
    `${afterDrag.slice(0, 3).join(',')} against ${backToCustom.slice(0, 3).join(',')}`,
  )
  const unchanged = await atTheOffice()
  check(
    'and the office still holds the same order',
    unchanged.length > 0 && unchanged.join(',') === savedMini.join(','),
    `${String(unchanged.length)} document(s)`,
  )

  /* --- and a refresh ----------------------------------------------------- */

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('[data-bc-docdrop] [data-bc-docid]', { timeout: 30000 })
  await page.waitForTimeout(2000)
  await choose(page, 'custom')
  check(
    'a refresh keeps it',
    (await drawn(page))[0] === moved,
    (await drawn(page)).slice(0, 3).join(','),
  )

  /* --- the expanded view agrees, and can rearrange too (§30) ------------- */

  await page.goto(`${SITE}/basecamp/p/${SLUG}/documents`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  await page.waitForSelector('[data-bc-docdrop] [data-bc-docid]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await choose(page, 'custom')
  const expanded = await drawn(page)
  check(
    'the expanded view opens on the same arrangement',
    expanded[0] === moved,
    expanded.slice(0, 3).join(','),
  )

  const second = expanded[2] ?? ''
  await dragOnto(page, second, expanded[0] ?? '')
  await page.waitForTimeout(1500)
  const afterExpanded = await drawn(page)
  check('and can rearrange it', afterExpanded[0] === second, afterExpanded.slice(0, 3).join(','))

  const savedFull = await officeHas(second)
  check(
    'which also reaches the office',
    savedFull.length > 0 && savedFull[0] === second,
    savedFull.slice(0, 3).join(','),
  )

  /* --- back to the miniature, which must agree --------------------------- */

  await page.goto(`${SITE}/basecamp/p/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForSelector('[data-bc-docdrop] [data-bc-docid]', { timeout: 30000 })
  await page.waitForTimeout(1500)
  await choose(page, 'custom')
  const backInMini = await drawn(page)
  check(
    'and the miniature shows what the expanded view did',
    backInMini[0] === second,
    backInMini.slice(0, 3).join(','),
  )

  /* --- the keyboard alternative (§52) ------------------------------------ */

  const nudged = (await page.evaluate(
    inPage(`
      const cards = [...document.querySelectorAll('[data-bc-docdrop] [data-bc-docid]')]
      const target = cards[1]
      if (target === undefined) return 'nothing to nudge'
      target.focus()
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))
      return target.getAttribute('data-bc-docid')
    `),
  )) as string
  await page.waitForTimeout(1200)
  const afterNudge = await drawn(page)
  check(
    'a document can be moved without dragging at all',
    afterNudge[0] === nudged,
    `${nudged} — ${afterNudge.slice(0, 3).join(',')}`,
  )

  check('nothing threw in the page', errors.length === 0, errors.slice(0, 3).join(' | '))
  await ctx.close()
} finally {
  await browser.close()
  if (before.length === 0) {
    await db.execute(`select app.hq_document_order_reset('${SLUG}')`)
  } else {
    await db.execute(
      `select app.hq_document_order_set('${SLUG}', '${JSON.stringify(before)}'::jsonb)`,
    )
  }
  const now = await atTheOffice()
  console.log(
    `\nteardown: the office is back to ${now.length === 0 ? 'no stored order' : `${String(now.length)} document(s)`}, as found`,
  )
}

console.log(`${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
