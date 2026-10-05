/*
 * CONTACTS, EDITED RATHER THAN READ.
 *
 * Grant, 22 September: "Expand Contacts from a mostly static display into an
 * editable contact-management component... Existing contacts must be editable
 * ... change existing data; add missing data; replace/remove the image; add or
 * update website/social information; edit notes; correct details later...
 * Notes must not be read-only decoration. They should be genuinely editable
 * and persisted... Use appropriate validation for URLs/email/etc. without
 * making the interface cumbersome."
 *
 * "Genuinely editable and persisted" is asserted by RELOADING after every
 * change, because an interface that writes nowhere passes any assertion made
 * before a reload. "Without making the interface cumbersome" is asserted too,
 * in the one way a test can: a bare domain is accepted and corrected rather
 * than refused.
 *
 * Browser code travels as a STRING. tsconfig has no DOM lib on purpose.
 */
import '../../src/safety/arm.ts'
import { chromium } from 'playwright'
import { serveStudio } from './serve-studio.ts'

const inPage = (body: string): string => `(() => { ${body} })()`

const PORT = 4681
const server = await serveStudio(PORT)
const url = (p: string): string => `http://127.0.0.1:${String(PORT)}${p}`

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
  BACK TO THE PAGE, which is now more than one press (§21).

  Dismissal steps exactly one level: a record inside a sheet closes to the
  sheet, and the sheet closes to the page. A single Escape used to do both, so
  a tidy-up like this one left a sheet open whose backdrop swallowed the next
  click -- and that reports as a timeout on a control that is perfectly fine,
  sometimes several sections later. Bounded, so a surface that will not close
  fails as a test rather than hanging.
*/
const dismissAll = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    if ((await page.locator('[data-bc-expanded]').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
}

const browser = await chromium.launch({ args: ['--lang=en-GB'] })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const thrown: string[] = []
page.on('pageerror', (e) => {
  thrown.push(e.message)
})

const slug = await (async (): Promise<string> => {
  await page.goto(url('/basecamp'), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  return (await page.evaluate(
    inPage(`const el = document.querySelector('[data-bc-go^="/p/"]')
       return el === null ? '' : (el.dataset.bcGo ?? '')`),
  )) as string
})()

const people = async (): Promise<void> => {
  await page.goto(url(`${slug}/contacts`), { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-bc-contact]')
  await page.waitForTimeout(350)
}

await people()
await page.evaluate(
  inPage(`for (const k of Object.keys(localStorage)) {
   if (k.startsWith('bc.contacts.')) localStorage.removeItem(k)
 }
 return true`),
)
await people()

/* --- 1. the list, and opening somebody --------------------------------- */
const listed = await page.locator('[data-bc-contact]').count()
check('the contacts list has people on it', listed > 0, `${String(listed)}`)
const who = (await page.locator('[data-bc-contact]').first().innerText()).trim()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(450)
check(
  'pressing one opens their record',
  (await page.locator('[data-bc-contactedit]').count()) === 1,
)

/* --- 2. it is a form, with every field the port describes --------------- */
const fields = (await page.evaluate(
  inPage(
    `return [...document.querySelectorAll('[data-bc-ctfield]')].map((e) => e.dataset.bcCtfield)`,
  ),
)) as string[]
for (const want of [
  'name',
  'role',
  'org',
  'where',
  'email',
  'phone',
  'website',
  'instagram',
  'note',
]) {
  check(`the record can edit ${want}`, fields.includes(want), fields.join(', '))
}

/* --- 3. notes are editable and persist ---------------------------------- */
const note = `Edited by the audit at ${new Date().toISOString().slice(11, 19)}`
await page.locator('[data-bc-ctfield="note"]').fill(note)
await page.locator('[data-bc-contact-save]').click()
await page.waitForTimeout(700)
await people()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(450)
check(
  'a note survives a reload, so it is not read-only decoration',
  (await page.locator('[data-bc-ctfield="note"]').inputValue()) === note,
  await page.locator('[data-bc-ctfield="note"]').inputValue(),
)

/* --- 4. missing data can be added --------------------------------------- */
await page.locator('[data-bc-ctfield="website"]').fill('innergy.com')
await page.locator('[data-bc-ctfield="instagram"]').fill('@thelegacycourse')
await page.locator('[data-bc-contact-save]').click()
await page.waitForTimeout(700)
await people()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(450)
check(
  'a bare domain is accepted and completed rather than refused',
  (await page.locator('[data-bc-ctfield="website"]').inputValue()) === 'https://innergy.com',
  await page.locator('[data-bc-ctfield="website"]').inputValue(),
)
check(
  'and a social handle is kept as typed',
  (await page.locator('[data-bc-ctfield="instagram"]').inputValue()) === '@thelegacycourse',
)

/* --- 5. validation says what is wrong, and does not save ---------------- */
await page.locator('[data-bc-ctfield="email"]').fill('not an address')
await page.locator('[data-bc-contact-save]').click()
await page.waitForTimeout(500)
const said = (await page.locator('[data-bc-contact-said]').first().innerText()).trim()
check('a bad email is refused with a sentence', /email address/i.test(said), said)
await people()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(450)
check(
  'and nothing was saved when it was refused',
  (await page.locator('[data-bc-ctfield="email"]').inputValue()) !== 'not an address',
  await page.locator('[data-bc-ctfield="email"]').inputValue(),
)

/* --- 6. an image can be added and removed ------------------------------- */
/*
  A REAL FILE THROUGH THE REAL INPUT. Setting the value of a file input is the
  one thing a page cannot do, so this is the browser's own file-chooser path -
  the same one a person uses - with a small PNG made here.
*/
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGP8z8Dwn4GKgImahoEMZDHUmIaBiiZiGDgKRgEA0y0DDbCA0ZwAAAAASUVORK5CYII=',
  'base64',
)
await page.locator('[data-bc-contact-image]').setInputFiles({
  name: 'face.png',
  mimeType: 'image/png',
  buffer: png,
})
await page.waitForTimeout(900)
await people()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(500)
const hasPhoto =
  (await page
    .locator(
      /* the record: its header carries the one face now */ '.bcpersonhead img.bcface--photo, [data-bc-contactedit] img.bcface--photo',
    )
    .count()) > 0
check('an uploaded image appears on the record and survives a reload', hasPhoto)
const shrunk = (await page.evaluate(
  inPage(`const img = document.querySelector(/* the record: its header carries the one face now */ '.bcpersonhead img.bcface--photo, [data-bc-contactedit] img.bcface--photo')
     return img === null ? -1 : img.src.length`),
)) as number
check(
  'and it was downscaled rather than stored whole',
  shrunk > 100 && shrunk < 400_000,
  `${String(shrunk)} characters of data URL`,
)
await page.locator('[data-bc-contact-image-off]').click()
await page.waitForTimeout(700)
await people()
await page.locator('[data-bc-contact]').first().click()
await page.waitForTimeout(450)
check(
  'and it can be removed again',
  (await page
    .locator(
      /* the record: its header carries the one face now */ '.bcpersonhead img.bcface--photo, [data-bc-contactedit] img.bcface--photo',
    )
    .count()) === 0,
)

/* --- 7. adding somebody ------------------------------------------------- */
await people()
await page.locator('[data-bc-contact-add]').first().click()
await page.waitForTimeout(400)
const made = `Audit Person ${String(Date.now()).slice(-5)}`
await page.locator('#bc-c-name').fill(made)
await page.locator('#bc-c-role').fill('Added by the audit')
await page.locator('[data-bc-contactadd-go]').click()
await page.waitForTimeout(800)
await people()
check(
  'a new contact is added and is in the list',
  (await page.locator('.bclist').innerText()).includes(made),
)

/* --- 8. the miniature reflects it too ----------------------------------- */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-mod="contacts"]')
await page.waitForTimeout(500)
check(
  'and the miniature on the project home shows the same people',
  (await page.locator('[data-mod="contacts"]').innerText()).includes(who),
)
check(
  'the Add control on the miniature says Add Contact',
  (await page.locator('[data-mod="contacts"] [data-bc-contact-add]').innerText()).trim() ===
    'Add Contact',
)

/*
 * --- WHAT GRANT REPORTED ON 23 SEPTEMBER ---------------------------------
 *
 * Three things, and each was real:
 *
 *   1. a contact opened full screen jumped back toward the top when scrolled;
 *   2. the miniature showed no photograph;
 *   3. pressing a person in the miniature merely maximised the Contacts panel
 *      instead of opening that person.
 */
await page.goto(url(slug), { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.bcpanes')
await page.waitForTimeout(600)

/* --- the miniature shows faces ------------------------------------------ */
const faces = await page.locator('[data-mod="contacts"] .bcmateface').count()
const rows = await page.locator('[data-mod="contacts"] [data-bc-contact]').count()
check(
  'every contact in the miniature has a face or initials',
  rows > 0 && faces === rows,
  `${String(faces)} face(s) for ${String(rows)} contact(s)`,
)
check(
  'and a contact with no photograph falls back to initials rather than a broken image',
  (
    (await page.evaluate(
      inPage(`const out = []
       for (const el of document.querySelectorAll('[data-mod="contacts"] .bcmateface')) {
         if (el.tagName === 'IMG') {
           out.push(el.complete && el.naturalWidth > 0 ? 'photo' : 'broken')
         } else {
           out.push((el.textContent ?? '').trim() === '' ? 'empty' : 'initials')
         }
       }
       return out`),
    )) as string[]
  ).every((f) => f === 'photo' || f === 'initials'),
  JSON.stringify(
    await page.evaluate(
      inPage(`const out = []
       for (const el of document.querySelectorAll('[data-mod="contacts"] .bcmateface')) out.push(el.tagName)
       return out`),
    ),
  ),
)

/* --- pressing a person opens that person -------------------------------- */
const wanted = (await page.locator('[data-mod="contacts"] .bcmatename').first().innerText()).trim()
await page.locator('[data-mod="contacts"] [data-bc-contact]').first().click()
await page.waitForTimeout(800)
const record = await page.locator('[data-bc-expanded="contacts"]').innerText()
check(
  'pressing a contact in the miniature opens THAT contact, not just the panel',
  record.includes(wanted) &&
    (await page.locator('[data-bc-contactedit], [data-bc-ctfield]').count()) > 0,
  `wanted ${wanted}; the dialog showed: ${record.replace(/\n+/g, ' / ').slice(0, 160)}`,
)
await dismissAll()

/* --- and the header maximises the whole thing --------------------------- */
await page.locator('[data-mod="contacts"] .bcmodhead').click()
await page.waitForTimeout(700)
check(
  'while pressing the panel title maximises the whole Contacts view',
  (await page.locator('[data-bc-expanded="contacts"]').count()) === 1 &&
    (await page.locator('[data-bc-expanded="contacts"] [data-bc-contact]').count()) > 1,
  'the header did not open the list',
)

/* --- a full-screen contact scrolls, and the page behind does not --------- *
 *
 * A SHORT WINDOW, so the record genuinely overflows its dialog. The first
 * version of this scrolled a contact with eight pixels of room and then
 * asserted it had moved 250 - which says nothing about a long contact, which
 * is the case Grant reported. Making the viewport short is deterministic;
 * waiting for a contact to be long enough is not.
 */
await page.setViewportSize({ width: 1200, height: 480 })
await page.waitForTimeout(300)
await page.locator('[data-bc-expanded="contacts"] [data-bc-contact]').first().click()
await page.waitForTimeout(700)
const scrolling = (await page.evaluate(
  inPage(`const box = document.querySelector('.bcexpbox')
     if (box === null) return { ok: false }
     const before = Math.round(window.scrollY)
     box.scrollTop = 250
     return {
       ok: true,
       dialog: Math.round(box.scrollTop),
       room: box.scrollHeight - box.clientHeight,
       pageMovedBy: Math.round(window.scrollY) - before,
       bodyLocked: getComputedStyle(document.body).overflow === 'hidden',
       behindInert: document.querySelector('.bcunder')?.inert === true,
     }`),
)) as Record<string, unknown>
check(
  'a contact opened full screen scrolls inside its own dialog',
  scrolling.dialog === 250,
  JSON.stringify(scrolling),
)
check(
  'and the page behind it cannot scroll, so nothing jumps back to the top',
  scrolling.bodyLocked === true && scrolling.pageMovedBy === 0,
  JSON.stringify(scrolling),
)
/*
  THE DUPLICATE ROWS BEHIND THE DIALOG. With a contact open there were EIGHT
  contact rows in the document - four in the dialog and four on the surface
  behind - so half the presses landed on a copy the backdrop swallowed. They
  are still rendered; what matters is that they are inert.
*/
check(
  'and the surface behind is inert, so its duplicate rows cannot be pressed',
  scrolling.behindInert === true,
  JSON.stringify(scrolling),
)
/*
  AND IT STAYS THERE THROUGH A REDRAW, which is the symptom in Grant's words:
  "scrolling downward currently causes the view to jump back toward the top".

  A beat first: setting `scrollTop` fires the scroll event asynchronously, and
  redrawing in the same tick asks the page to remember something it has not
  been told yet. A person scrolling with a wheel is never that fast; a test is.
*/
await page.waitForTimeout(250)
await page.evaluate('window.__shots.render()')
await page.waitForTimeout(500)
const stillScrolled = (await page.evaluate(
  inPage(`const box = document.querySelector('.bcexpbox')
     return box === null ? -1 : Math.round(box.scrollTop)`),
)) as number
check(
  'and the dialog stays where it was scrolled to, even when the shell redraws',
  stillScrolled >= 60,
  `scrollTop is ${String(stillScrolled)} after a redraw`,
)
await page.setViewportSize({ width: 1400, height: 950 })

check('nothing threw while all of that happened', thrown.length === 0, thrown.join(' | '))

await browser.close()
server.close()
console.log(`\n${String(pass)}/${String(pass + fail)} passed`)
process.exit(fail === 0 ? 0 : 1)
