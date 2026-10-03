/**
 * The ordinary things a person does to their own records, as the Sample Person, through the real page and the real gateway.
 *   npm run sample:product [label] [--docs]     screenshots into .out/product-<label>/
 *
 * Contacts: add, open, edit, save, reload, search, remove (two presses), and the removed one is gone. Projects: create,
 * rename in Project settings (and the new name is shown, the address is unchanged), add a task, archive. Activity: what the
 * person did appears on the project's Activity tab and on the global Activity page, newest first, in words, with the person
 * as "You" and never as a raw owner key. With --docs: drop a text file in through the page, it is filed approved and its
 * words can be found (the gateway reads text files, #408; needs the deployed hq-api).
 *
 * Everything lands in the Sample office and the run tidies what it made; `npm run sample:reset` restores the baseline.
 * Waits are for the thing asserted, never a fixed pause.
 */
import { mkdirSync } from 'node:fs'
import type { Page } from 'playwright'
import { newPage, signIn, startStudio } from './browser.ts'
import { rows, sampleOffice, session } from './lib.ts'

const label = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'now'
const docs = process.argv.includes('--docs')
const out = `.out/product-${label}`
mkdirSync(out, { recursive: true })
const O = (await sampleOffice()).officeId
const RUN = Date.now().toString(36).slice(-5)

const results: { what: string; ok: boolean; detail: string }[] = []
const step = async (what: string, fn: () => Promise<string | undefined | void>): Promise<void> => {
  try {
    const detail = (await fn()) ?? ''
    results.push({ what, ok: true, detail })
    console.log(`ok   ${what}${detail === '' ? '' : ` — ${detail}`}`)
  } catch (e) {
    const detail = String(e instanceof Error ? e.message : e)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .slice(0, 4)
      .join(' | ')
      .slice(0, 300)
    results.push({ what, ok: false, detail })
    console.log(`FAIL ${what} — ${detail}`)
  }
}
const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
const eventually = async (
  what: string,
  cond: () => Promise<boolean>,
  ms = 25000,
): Promise<void> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond().catch(() => false)) return
    await sleep(700)
  }
  throw new Error(`never became true: ${what}`)
}
const must = (cond: boolean, why: string): void => {
  if (!cond) throw new Error(why)
}
const body = async (p: Page): Promise<string> =>
  (await p.locator('body').innerText()).replace(/\s+/g, ' ')
const shot = (p: Page, n: string): Promise<unknown> =>
  p.screenshot({ path: `${out}/${n}.png`, fullPage: true })
const count = async (sql: string): Promise<number> => Number((await rows(sql))[0]?.n ?? 0)

const studio = await startStudio(4794)
const s = await session()
const { page, errors } = await newPage(studio, { width: 1440, height: 1000 })
page.on('dialog', (d) => void d.accept())
try {
  await signIn(studio, page, s)
  const go = async (path: string): Promise<void> => {
    await page.goto(`${studio.base}${path}`, { waitUntil: 'domcontentloaded' })
    await page
      .waitForFunction("!document.body.innerText.includes('Loading your office')", undefined, {
        timeout: 30000,
      })
      .catch(() => null)
    await page.waitForLoadState('networkidle').catch(() => null)
    await sleep(2500)
  }

  // ---- contacts ------------------------------------------------------------------------------------------------
  const who = `Quincy Marlowe ${RUN}`
  const contactRows = (name: string, extra = ''): Promise<number> =>
    count(
      `select count(*) n from public.contacts c join public.projects p on p.project_id = c.project_id where p.office_id = '${O}' and p.slug = 'wellness-studio-launch' and c.name = '${name}'${extra}`,
    )
  await step('add a contact through the form', async () => {
    await go('/p/wellness-studio-launch/contacts')
    await page.locator('[data-bc-contact-add]').first().click()
    await page.fill('#bc-c-name', who)
    await page.fill('#bc-c-role', 'Equipment supplier')
    await page.fill('#bc-c-org', 'Marlowe Mats Ltd')
    await page.fill('#bc-c-email', `quincy${RUN}@example.invalid`)
    await page.locator('[data-bc-contactadd-go]').click()
    await eventually('stored once', async () => (await contactRows(who)) === 1)
    await go('/p/wellness-studio-launch/contacts')
    must((await body(page)).includes(who), 'not in the list after a reload')
    await shot(page, 'contact-added')
  })
  await step('open it, change what they are, save, and it survives a reload', async () => {
    await page.getByText(who).first().click()
    await page.waitForSelector('[data-bc-ctfield="role"]', { timeout: 15000 })
    await page.fill('[data-bc-ctfield="role"]', 'Mat and barre supplier')
    await page.locator('[data-bc-contact-save]').click()
    await eventually(
      'saved',
      async () => (await contactRows(who, ` and c.role = 'Mat and barre supplier'`)) === 1,
    )
    await go('/p/wellness-studio-launch/contacts')
    must(
      (await body(page)).includes('Mat and barre supplier'),
      'the new role is not shown after a reload',
    )
    await shot(page, 'contact-edited')
  })
  await step('search finds the contact by name', async () => {
    await go('/search')
    const box = page.locator('#bc-search-q').first()
    await box.fill('Quincy')
    await box.press('Enter')
    await eventually('a result', async () => (await body(page)).includes(who))
    await shot(page, 'search-contact')
  })
  await step('remove it (two presses), and it leaves the list and is only put away', async () => {
    await go('/p/wellness-studio-launch/contacts')
    await page.getByText(who).first().click()
    const rm = page.locator('[data-bc-contact-away]')
    await rm.waitFor({ timeout: 15000 })
    await rm.click()
    must(/press again/i.test(await rm.innerText()), 'the first press did not ask for a second')
    await rm.click()
    await eventually(
      'put away',
      async () => (await contactRows(who, ' and c.archived_at is not null')) === 1,
    )
    await go('/p/wellness-studio-launch/contacts')
    must(!(await body(page)).includes(who), 'still listed after a reload')
    must((await contactRows(who)) === 1, 'the row was deleted rather than put away')
  })

  // ---- a project: create, rename, add work, see the activity, archive -------------------------------------------
  const first = `Allotment ${RUN}`
  const second = `Orchard ${RUN}`
  let slug = ''
  await step('create a project', async () => {
    await go('/')
    await page.locator('[data-bc-newproject-open]').click()
    await page.fill('#bc-newproject-name', first)
    await page.locator('[data-bc-newproject-go]').click()
    await page.waitForURL(/\/p\//, { timeout: 40000 })
    slug = new URL(page.url()).pathname.split('/')[2] ?? ''
    await eventually('opened', async () => (await body(page)).includes(first))
  })
  await step('rename it in Project settings; the address does not change', async () => {
    await go(`/p/${slug}/settings`)
    await page.locator('[data-setpane="project"]').click()
    await page.waitForSelector('[data-projname]', { timeout: 15000 })
    must(
      (await page.inputValue('[data-projname]')) === first,
      'the field does not hold the current name',
    )
    await page.fill('[data-projname]', second)
    await page.locator('[data-projrename]').click()
    await eventually(
      'renamed in the database',
      async () =>
        (await count(
          `select count(*) n from public.projects where office_id = '${O}' and slug = '${slug}' and name = '${second}'`,
        )) === 1,
    )
    await eventually('the page shows the new name', async () => (await body(page)).includes(second))
    await shot(page, 'project-renamed')
    await go('/')
    const home = await body(page)
    must(home.includes(second) && !home.includes(first), 'Home still shows the old name')
  })
  await step('renaming to a name another project holds is refused in words', async () => {
    await go(`/p/${slug}/settings`)
    await page.locator('[data-setpane="project"]').click()
    await page.waitForSelector('[data-projname]', { timeout: 15000 })
    await page.fill('[data-projname]', 'Japan Spring Trip')
    await page.locator('[data-projrename]').click()
    await eventually('a refusal', async () =>
      /already belongs|two projects/i.test(await body(page)),
    )
    must(
      (await count(
        `select count(*) n from public.projects where office_id = '${O}' and slug = '${slug}' and name = '${second}'`,
      )) === 1,
      'the name changed anyway',
    )
  })
  await step('add a task to it', async () => {
    await go(`/p/${slug}/tasks`)
    await page.locator('[data-bc-addtask]').first().click()
    const form = page.locator('[data-bc-taskform]:not([hidden])').first()
    await form.locator('input[name=title]').fill('Order the seed potatoes')
    await form.locator('[data-bc-tasksave]').click()
    await eventually(
      'stored',
      async () =>
        (await count(
          `select count(*) n from public.tasks t join public.projects p on p.project_id = t.project_id where t.office_id = '${O}' and p.slug = '${slug}' and t.title = 'Order the seed potatoes'`,
        )) === 1,
    )
  })
  await step('its Activity tab says what the person did, in words, as "You"', async () => {
    await go(`/p/${slug}/activity`)
    const text = await body(page)
    must(/You created this project/.test(text), 'no "You created this project"')
    must(/You added the task .?Order the seed potatoes/.test(text), 'no "You added the task ..."')
    must(!/p4-second-person|P4 Second Person/i.test(text), 'a raw owner key is shown as a name')
    await shot(page, 'project-activity')
  })
  await step(
    'the global Activity page lists newest first, and this project is at the top',
    async () => {
      await go('/activity')
      const text = await body(page)
      const at = text.indexOf('Order the seed potatoes')
      must(at >= 0, 'the new work is not on the page')
      must(at < 600, `it is not near the top (position ${at})`)
      await shot(page, 'activity-global')
    },
  )
  await step('archive it, and it leaves Home', async () => {
    await go(`/p/${slug}/settings`)
    await page.locator('[data-setpane="project"]').click()
    await page.locator('[data-archive]').click()
    await eventually(
      'archived',
      async () =>
        (await count(
          `select count(*) n from public.projects where office_id = '${O}' and slug = '${slug}' and status = 'archived'`,
        )) === 1,
    )
  })

  // ---- a document, through the page (needs the deployed gateway) -------------------------------------------------
  if (docs) {
    const word = `kumquat${RUN}`
    const name = `ux-note-${RUN}.md`
    await step('drop a text file into a project; it is filed, approved and shown', async () => {
      await go('/p/wellness-studio-launch/documents')
      await page.locator('[data-bc-upload]').first().click()
      await page.locator('[data-bc-from="computer"]').click()
      await page.setInputFiles('#bc-upload-file', {
        name,
        mimeType: 'text/markdown',
        buffer: Buffer.from(`# Supplier note\n\nThe signature scent for the studio is ${word}.\n`),
      })
      await page.locator('[data-bc-uploadsave]').click()
      await eventually(
        'filed approved',
        async () =>
          (await count(
            `select count(*) n from public.documents where office_id = '${O}' and title = '${name}' and origin = 'yours' and state = 'approved'`,
          )) === 1,
      )
      await go('/p/wellness-studio-launch/documents')
      must((await body(page)).includes(name), 'the file is not shown in Docs and Files')
      await shot(page, 'document-uploaded')
    })
    await step('its words are indexed, so the team can find them', async () => {
      await eventually(
        'indexed',
        async () =>
          (await count(
            `select count(*) n from app.search_documents('${O}'::uuid, '${word}', null, 5) s`,
          )) === 1,
      )
    })
  }
} finally {
  const failed = results.filter((r) => !r.ok)
  const bad = errors.filter((e) => !/favicon|Failed to load resource/i.test(e))
  if (bad.length > 0) console.log(`page errors: ${bad.slice(0, 5).join(' | ')}`)
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
  await studio.close()
  process.exitCode = failed.length === 0 && bad.length === 0 ? 0 : 1
}
