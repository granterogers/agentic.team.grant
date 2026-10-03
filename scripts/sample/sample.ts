/**
 * Establish, populate, inspect and reset the Sample Person's office.
 *
 *   npx tsx scripts/sample/sample.ts status    # what the office holds now, and whether it matches the baseline
 *   npx tsx scripts/sample/sample.ts seed      # converge the office to the baseline (idempotent)
 *   npx tsx scripts/sample/sample.ts reset     # remove what is not baseline, restore baseline states, then seed
 *
 * Content is written AS the Sample Person, through the same gateway a browser uses, so every row has the provenance a real
 * one would and the office's own authorisation is exercised on the way in. Only what has no door (lessons, tool
 * requests) is written by the product's own SQL writers, with the office id taken from the proven Sample office.
 *
 * Reset deletes nothing from any other office: the office is resolved from the login and refused unless it is
 * structurally the Sample's (see lib.ts). Append-only ledgers are left alone, as they must be; reset converges the
 * MUTABLE state (tasks, contacts, projects, settings) to the baseline.
 *
 * The baseline is a function of BASELINE_VERSION. Dates are relative to today so the overdue/today/upcoming states are
 * always true. Everything is fictional; `.invalid` addresses cannot receive mail.
 */
import { gateway, lit, PERSONA, result, rows, sampleOffice, session } from './lib.ts'

export const BASELINE_VERSION = 'sample-baseline-1'

const day = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

type Task = {
  title: string
  detail?: string
  due?: number
  done?: boolean
  assignee?: string
  milestone?: boolean
}
export const PROJECTS: {
  name: string
  ref: string
  tasks: Task[]
  contacts: Contact[]
  docs: Doc[]
}[] = [
  {
    name: 'Second Location Launch',
    ref: 'sample-second-location',
    tasks: [
      {
        title: 'Sign the lease for the Harbour Street unit',
        due: -3,
        detail: 'Landlord wants it back by the end of the week.',
      },
      { title: 'Order the espresso machine', due: 0, assignee: 'operations-director' },
      { title: 'Confirm the builder start date', due: 2 },
      { title: 'Compare two equipment quotes', due: 5, assignee: 'finance-director' },
      {
        title: 'Draft the opening-week announcement',
        due: 12,
        assignee: 'communications-director',
      },
      { title: 'Opening day', due: 28, milestone: true },
      { title: 'Choose the shopfront signage', done: true },
      { title: 'Apply for the food premises licence', done: true },
      {
        title:
          'Reconcile the fit-out budget against the three contractor estimates and the landlord contribution before the board meeting',
        due: 7,
      },
    ],
    contacts: [
      {
        name: 'Mara Okonkwo',
        role: 'Landlord',
        org: 'Harbourside Properties (fictional)',
        email: 'mara@harbourside.invalid',
        note: 'Prefers a call before noon.',
      },
      {
        name: 'Felix Brandt',
        role: 'Account manager',
        org: 'Brewline Equipment (fictional)',
        email: 'felix@brewline.invalid',
      },
      {
        name: 'Tess Alderman',
        role: 'Site contractor',
        org: 'Alderman Build (fictional)',
        email: 'tess@alderman.invalid',
        note: 'On site Tuesdays and Thursdays.',
      },
    ],
    docs: [
      {
        name: 'lease-summary.md',
        mime: 'text/markdown',
        text: '# Lease summary (fictional)\n\nTerm: five years from opening.\nRent: fictional figures only.\nBreak clause at year three.\n',
      },
      {
        name: 'fit-out-budget.csv',
        mime: 'text/csv',
        text: 'item,estimate\nCounter,4200\nEspresso machine,6800\nSeating,3100\nSignage,950\n',
      },
      {
        name: 'site-visit-notes-harbour-street-unit-measurements-and-photographs-of-the-existing-plumbing-and-electrics.txt',
        mime: 'text/plain',
        text: 'Site visit notes (fictional).\nPlumbing runs along the north wall.\n',
      },
    ],
  },
  {
    name: 'Seasonal Menu Research',
    ref: 'sample-seasonal-menu',
    tasks: [
      { title: 'List five autumn drinks worth testing', due: 4, assignee: 'research-director' },
      { title: 'Ask the bakery about a pumpkin loaf', due: 6 },
      { title: 'Short one' },
      { title: 'Tasting afternoon', due: 14, milestone: true },
    ],
    contacts: [
      {
        name: 'Priyanka Salt',
        role: 'Baker',
        org: 'Rye & Rise (fictional)',
        email: 'bakery@ryerise.invalid',
      },
    ],
    docs: [
      {
        name: 'autumn-flavours.md',
        mime: 'text/markdown',
        text: '# Autumn flavours (fictional)\n\n- Spiced pear\n- Maple oat\n- Cardamom bun\n',
      },
    ],
  },
  {
    name: 'Winter Pop-up',
    ref: 'sample-winter-popup',
    tasks: [
      { title: 'Book the market stall', done: true },
      { title: 'Print the menu cards', done: true },
      { title: 'Thank the volunteers', done: true },
      { title: 'File the stall receipts', done: true },
    ],
    contacts: [],
    docs: [
      { name: 'popup-takings.csv', mime: 'text/csv', text: 'day,takings\nSat,610\nSun,540\n' },
    ],
  },
]
type Contact = { name: string; role?: string; org?: string; email?: string; note?: string }
type Doc = { name: string; mime: string; text: string }

export const PERSONAL_TASKS = [
  { title: 'Renew the van insurance', due: -1, priority: 20 },
  { title: 'Call the accountant about quarter-end', due: 1, priority: 50 },
  { title: 'Book a dentist appointment', due: 9, priority: 100 },
  { title: 'Water the office plants', due: 0, priority: 100 },
]
export const LESSONS = [
  { scope: 'global', body: 'Keep answers short and put the decision first.' },
  { scope: 'global', body: 'Ask before spending money on anything.' },
]
export const TOOL_REQUESTS = [
  {
    tool: 'drive.ingest',
    by: 'research-director',
    why: 'Read the supplier price lists you keep in a shared folder.',
  },
  {
    tool: 'calendar.write',
    by: 'operations-director',
    why: 'Put the builder visits straight into your calendar.',
  },
]
export const AUTONOMY = 'act_with_review'
export const APPEARANCE = { palette: 'clay' }

const cmd = process.argv[2] ?? 'status'
if (!['status', 'seed', 'reset'].includes(cmd)) {
  console.error('usage: sample.ts status | seed | reset')
  process.exit(2)
}

const office = await sampleOffice()
const O = lit(office.officeId)
console.log(
  `Sample Person: ${PERSONA.name} / ${PERSONA.business}   office ${office.officeId.slice(0, 8)}   baseline ${BASELINE_VERSION}`,
)
const s = await session()
const g = gateway(s)

const baselineTaskTitles = new Set([
  ...PROJECTS.flatMap((p) => p.tasks.map((t) => t.title)),
  ...PERSONAL_TASKS.map((t) => t.title),
])
const baselineProjectNames = new Set(['Unnamed', ...PROJECTS.map((p) => p.name)])

const state = async () => ({
  projects: await rows(
    `select name, slug, project_id::text id, status::text status from public.projects where office_id = ${O}::uuid and not is_fixture and status <> 'archived' order by name`,
  ),
  tasks: await rows(
    `select task_id::text id, title, state::text state, due_on::text due from public.tasks where office_id = ${O}::uuid and state <> 'cancelled' order by title`,
  ),
  contacts: await rows(
    `select c.contact_id::text id, c.name from public.contacts c join public.projects p on p.project_id = c.project_id
      where p.office_id = ${O}::uuid and c.archived_at is null`,
  ),
  docs: await rows(
    `select title from public.documents where office_id = ${O}::uuid and state <> 'archived'`,
  ),
})

const report = async () => {
  const st = await state()
  const extraTasks = st.tasks.filter((t) => !baselineTaskTitles.has(String(t.title)))
  const extraProjects = st.projects.filter((p) => !baselineProjectNames.has(String(p.name)))
  console.log(
    `  projects ${st.projects.length}   tasks ${st.tasks.length}   contacts ${st.contacts.length}   documents ${st.docs.length}`,
  )
  console.log(`  not baseline: ${extraTasks.length} task(s), ${extraProjects.length} project(s)`)
  return { st, extraTasks, extraProjects }
}

const ok = (r: { status: number; json: unknown }, what: string): boolean => {
  // the gateway answers 200 with the function's own refusal inside `result`, so read that too
  const j = r.json as { error?: string; result?: { error?: string; ok?: boolean } } | null
  const e = j?.error ?? j?.result?.error
  if (r.status === 200 && e === undefined && j?.result?.ok !== false) return true
  console.log(`  ! ${what}: http ${r.status} ${String(e ?? '').slice(0, 140)}`)
  return false
}

if (cmd === 'status') {
  await report()
  process.exit(0)
}

if (cmd === 'reset') {
  const { st, extraTasks, extraProjects } = await report()
  // 1. anything that is not baseline goes, through the product's own deleters
  // a personal task is deleted; work that belongs to the team is not deletable from here, so it is cancelled
  for (const t of extraTasks) {
    const gone = await g.act('my_task_delete', { p_task_id: t.id, p_reason: 'sample reset' })
    const refused = (gone.json as { result?: { ok?: boolean } } | null)?.result?.ok === false
    if (refused)
      ok(
        await g.act('task_state', {
          p_task_id: t.id,
          p_state: 'cancelled',
          p_reason: 'sample reset',
        }),
        `cancel ${t.title}`,
      )
  }
  for (const c of st.contacts) void c // contacts are matched by name in seed; extras archived below
  const wantNames = new Set(PROJECTS.flatMap((p) => p.contacts.map((c) => c.name)))
  for (const c of st.contacts)
    if (!wantNames.has(String(c.name)))
      ok(
        await g.act('contact_archive', { p_contact_id: c.id, p_put_away: true }),
        `archive contact ${c.name}`,
      )
  for (const p of extraProjects)
    ok(await g.act('project_archive', { p_slug: p.slug }), `archive project ${p.name}`)
  // 2. baseline tasks go back to their baseline state
  const want = new Map<string, boolean>()
  for (const p of PROJECTS) for (const t of p.tasks) want.set(t.title, t.done === true)
  for (const t of PERSONAL_TASKS) want.set(t.title, false)
  for (const t of st.tasks) {
    if (!want.has(String(t.title))) continue
    const should = want.get(String(t.title)) ? 'done' : 'todo'
    if (String(t.state) !== should)
      ok(await g.act('task_state', { p_task_id: t.id, p_state: should }), `restore ${t.title}`)
  }
  console.log('  extras removed, baseline states restored')
}

// ---- seed: converge to the baseline ---------------------------------------------------------------------------------
const have = await state()
const projectBy = new Map(have.projects.map((p) => [String(p.name), p]))
for (const p of PROJECTS) {
  let row = projectBy.get(p.name)
  if (row === undefined) {
    const r = await g.act('create_project', { p_name: p.name, p_connector: 'upload', p_ref: p.ref })
    if (!ok(r, `create ${p.name}`)) continue
    const res = result(r)
    row = { name: p.name, slug: String(res.slug ?? ''), id: String(res.project_id ?? '') }
    console.log(`  + project ${p.name}`)
  }
  const slug = String(row.slug)
  const haveTasks = new Set(have.tasks.map((t) => String(t.title)))
  for (const t of p.tasks) {
    if (haveTasks.has(t.title)) continue
    const r = await g.act('task_add', {
      p_project: slug,
      p_title: t.title,
      p_detail: t.detail ?? '',
      p_due_on: t.due === undefined ? null : day(t.due),
      p_assignee: t.assignee ?? null,
      p_milestone: t.milestone === true,
    })
    if (!ok(r, `task ${t.title}`)) continue
    const id = String(result(r).id ?? '')
    if (t.done && id !== '')
      ok(await g.act('task_state', { p_task_id: id, p_state: 'done' }), `done ${t.title}`)
  }
  const haveContacts = new Set(have.contacts.map((c) => String(c.name)))
  for (const c of p.contacts) {
    if (haveContacts.has(c.name)) continue
    ok(
      await g.act('contact_add', {
        p_project: slug,
        p_name: c.name,
        p_role: c.role,
        p_org: c.org,
        p_email: c.email,
        p_note: c.note ?? null,
      }),
      `contact ${c.name}`,
    )
  }
  const haveDocs = new Set(have.docs.map((d) => String(d.title)))
  for (const d of p.docs) {
    if (haveDocs.has(d.name)) continue
    ok(
      await g.act('document_upload', {
        p_project_id: String(row.id),
        p_name: d.name,
        p_mime: d.mime,
        p_base64: `data:${d.mime};base64,${Buffer.from(d.text).toString('base64')}`,
      }),
      `document ${d.name}`,
    )
  }
}
const haveTitles = new Set((await state()).tasks.map((t) => String(t.title)))
for (const t of PERSONAL_TASKS) {
  if (haveTitles.has(t.title)) continue
  ok(
    await g.act('my_task_add', { p_title: t.title, p_due_on: day(t.due), p_priority: t.priority }),
    `personal ${t.title}`,
  )
}
ok(await g.act('autonomy_set', { p_level: AUTONOMY }), 'autonomy')
ok(await g.act('appearance_set', { p_settings: APPEARANCE }), 'appearance')

// ---- what has no door: the product's own SQL writers, for THIS office only ------------------------------------------
const by = lit('p4-second-person')
const lessonHave = new Set(
  (await rows(`select body from public.lessons where office_id = ${O}::uuid`)).map((r) =>
    String(r.body),
  ),
)
for (const l of LESSONS)
  if (!lessonHave.has(l.body))
    await rows(
      `select app.learn(${O}::uuid, ${lit(l.scope)}::public.lesson_scope, ${lit(l.body)}, ${by}) as r`,
    )
const reqHave = new Set(
  (
    await rows(
      `select tool from public.tool_requests where office_id = ${O}::uuid and state = 'open'`,
    )
  ).map((r) => String(r.tool)),
)
for (const r of TOOL_REQUESTS)
  if (!reqHave.has(r.tool))
    await rows(
      `select app.request_tool(${O}::uuid, ${lit(r.tool)}, ${lit(r.by)}, ${lit(r.why)}, '{}'::jsonb, null) as r`,
    ).catch((e) => console.log(`  ! request ${r.tool}: ${String(e).slice(0, 120)}`))

console.log('seeded')
await report()
