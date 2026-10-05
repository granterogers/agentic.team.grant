/**
 * Establish, populate, inspect and reset the Sample Person's office.
 *
 *   npx tsx scripts/sample/sample.ts status    # what the office holds now, and whether it matches the baseline
 *   npx tsx scripts/sample/sample.ts seed      # converge the office to the baseline (idempotent)
 *   npx tsx scripts/sample/sample.ts reset     # remove what is not baseline, then converge to the baseline
 *
 * Content is written AS the Sample Person, through the same gateway a browser uses, so every row has the provenance a real
 * one would and the office's own authorisation is exercised on the way in. Only what has no door (lessons, tool
 * requests) is written by the product's own SQL writers, with the office id taken from the proven Sample office.
 *
 * Reset deletes nothing from any other office: the office is resolved from the login and refused unless it is
 * structurally the Sample's (see guard.ts). Append-only ledgers are left alone, as they must be; reset converges the
 * MUTABLE state (tasks, contacts, documents, projects, settings) to the baseline. Every seed and reset fingerprints every
 * OTHER office before and after, and says so if one moved.
 *
 * The baseline is plan.ts (a function of BASELINE_VERSION). Dates are relative to today so the overdue/today/tomorrow
 * states are always true. Everything is fictional; `.invalid` addresses cannot receive mail. Nothing here contacts a
 * person: there is no send, no booking and no external call, and the Sample has no Slack, Telegram or Google binding.
 */
import '../../src/safety/require-production-writes.ts'
import { diffFingerprints, otherOffices } from './fingerprint.ts'
import { gateway, lit, PERSONA, result, rows, sampleOffice, session } from './lib.ts'
import {
  APPEARANCE,
  AUTONOMY,
  BASELINE_VERSION,
  baselineContactNames,
  baselineDocNames,
  baselineProjectNames,
  baselineTitles,
  driftOf,
  type Have,
  LESSONS,
  PERSONAL_TASKS,
  type PlanDoc,
  type PlanTask,
  PROJECTS,
  TOOL_REQUESTS,
  type Wanted,
  wantedOf,
} from './plan.ts'

export { BASELINE_VERSION }

const cmd = process.argv[2] ?? 'status'
if (!['status', 'seed', 'reset'].includes(cmd)) {
  console.error('usage: sample.ts status | seed | reset')
  process.exit(2)
}

const today = new Date()
const office = await sampleOffice()
const O = lit(office.officeId)
console.log(
  `Sample Person: ${PERSONA.name} / ${PERSONA.business}   office ${office.officeId.slice(0, 8)}   baseline ${BASELINE_VERSION}`,
)

const CANARY = /^P4 canary note/
const pool = async <T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> => {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++] as T)
    }),
  )
}

type TaskRow = Have & { id: string; project: string }

const state = async () => ({
  projects: await rows(
    `select name, slug, project_id::text id from public.projects where office_id = ${O}::uuid and not is_fixture and status <> 'archived' order by name`,
  ),
  tasks: (
    await rows(
      `select t.task_id::text id, t.title, t.state::text state, t.due_on::text due, t.starts_on::text start, t.priority,
              t.labels, t.blocked_on, s.slug agent, pt.title parent, coalesce(p.name, '') project
         from public.tasks t
         left join public.staff s on s.staff_id = t.assignee_staff
         left join public.tasks pt on pt.task_id = t.parent_task_id
         left join public.projects p on p.project_id = t.project_id
        where t.office_id = ${O}::uuid and t.state <> 'cancelled'
        order by t.title`,
    )
  ).map(
    (r): TaskRow => ({
      id: String(r.id),
      title: String(r.title),
      state: String(r.state),
      due: r.due === null ? null : String(r.due),
      start: r.start === null ? null : String(r.start),
      priority: Number(r.priority),
      labels: Array.isArray(r.labels) ? r.labels.map(String) : [],
      blockedOn: String(r.blocked_on ?? ''),
      agent: r.agent === null ? null : String(r.agent),
      parent: r.parent === null ? null : String(r.parent),
      project: String(r.project),
    }),
  ),
  contacts: await rows(
    `select c.contact_id::text id, c.name from public.contacts c join public.projects p on p.project_id = c.project_id
      where p.office_id = ${O}::uuid and c.archived_at is null`,
  ),
  docs: await rows(
    `select document_id::text id, title, state, pinned, tags from public.documents where office_id = ${O}::uuid and state <> 'archived'`,
  ),
})
type State = Awaited<ReturnType<typeof state>>

const analyse = (st: State) => {
  const wantTitles = baselineTitles()
  const have = new Map(st.tasks.map((t) => [t.title, t]))
  const extraTasks = st.tasks.filter((t) => !wantTitles.has(t.title))
  const missingTasks = [...wantTitles].filter((t) => !have.has(t))
  const wanted = new Map<string, Wanted>(
    [...PROJECTS.flatMap((p) => p.tasks), ...PERSONAL_TASKS].map((t) => [
      t.title,
      wantedOf(t, today),
    ]),
  )
  const drifted = st.tasks
    .filter((t) => wanted.has(t.title) && driftOf(t, wanted.get(t.title) as Wanted).length > 0)
    .map((t) => `${t.title.slice(0, 40)} [${driftOf(t, wanted.get(t.title) as Wanted).join(',')}]`)
  const extraProjects = st.projects.filter((p) => !baselineProjectNames().has(String(p.name)))
  const missingProjects = PROJECTS.filter((p) => !st.projects.some((x) => x.name === p.name))
  const extraContacts = st.contacts.filter((c) => !baselineContactNames().has(String(c.name)))
  const haveContacts = new Set(st.contacts.map((c) => String(c.name)))
  const missingContacts = [...baselineContactNames()].filter((n) => !haveContacts.has(n))
  const extraDocs = st.docs.filter(
    (d) => !baselineDocNames().has(String(d.title)) && !CANARY.test(String(d.title)),
  )
  const haveDocs = new Set(st.docs.map((d) => String(d.title)))
  const missingDocs = [...baselineDocNames()].filter((n) => !haveDocs.has(n))
  return {
    extraTasks,
    missingTasks,
    drifted,
    extraProjects,
    missingProjects,
    extraContacts,
    missingContacts,
    extraDocs,
    missingDocs,
    wanted,
  }
}

const report = async () => {
  const st = await state()
  const a = analyse(st)
  console.log(
    `  projects ${st.projects.length}   tasks ${st.tasks.length}   contacts ${st.contacts.length}   documents ${st.docs.length}`,
  )
  // Reset is SEMANTIC, not row-identical: work a job made is the team's and cannot be deleted from here, so reset cancels it and the
  // row stays. A digest over every task row therefore differs after any reset that had debris to remove; this is the figure that
  // explains it, and the baseline comparison above (which excludes cancelled work) is the proof of equivalence.
  const cancelled = Number(
    (
      await rows(
        `select count(*) n from public.tasks where office_id = ${O}::uuid and state = 'cancelled'`,
      )
    )[0]?.n ?? 0,
  )
  console.log(
    `  cancelled rows kept (not counted above; job-made work cannot be deleted): ${cancelled}`,
  )
  console.log(
    `  not baseline: ${a.extraTasks.length} task(s), ${a.extraProjects.length} project(s), ${a.extraContacts.length} contact(s), ${a.extraDocs.length} document(s)`,
  )
  const gaps =
    a.missingTasks.length +
    a.missingProjects.length +
    a.missingContacts.length +
    a.missingDocs.length
  console.log(
    `  missing from baseline: ${gaps}   drifted from baseline: ${a.drifted.length}${a.drifted.length > 0 ? `  (${a.drifted.slice(0, 4).join('; ')})` : ''}`,
  )
  return {
    st,
    a,
    clean:
      a.extraTasks.length +
        a.extraProjects.length +
        a.extraContacts.length +
        a.extraDocs.length +
        gaps +
        a.drifted.length ===
      0,
  }
}

if (cmd === 'status') {
  const r = await report()
  console.log(
    r.clean ? '  the office matches the baseline' : '  the office differs from the baseline',
  )
  process.exit(r.clean ? 0 : 1)
}

// ---- seed and reset need the Sample's own session ---------------------------------------------------------------------
const s = await session()
const g = gateway(s)
const before = await otherOffices(office.officeId)

const ok = (r: { status: number; json: unknown }, what: string): boolean => {
  // the gateway answers 200 with the function's own refusal inside `result`, so read that too
  const j = r.json as { error?: string; result?: { error?: string; ok?: boolean } } | null
  const e = j?.error ?? j?.result?.error
  if (r.status === 200 && e === undefined && j?.result?.ok !== false) return true
  console.log(`  ! ${what}: http ${r.status} ${String(e ?? '').slice(0, 140)}`)
  failures += 1
  return false
}
let failures = 0
let changes = 0
const changed = (what: string): void => {
  changes += 1
  console.log(`  + ${what}`)
}

if (cmd === 'reset') {
  const { st, a } = await report()
  // anything that is not baseline goes, through the product's own deleters
  // a personal task is deleted; work that belongs to the team is not deletable from here, so it is cancelled
  await pool(a.extraTasks, 4, async (t) => {
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
    changed(`removed task ${t.title.slice(0, 50)}`)
  })
  for (const c of a.extraContacts) {
    ok(
      await g.act('contact_archive', { p_contact_id: c.id, p_put_away: true }),
      `archive contact ${c.name}`,
    )
    changed(`archived contact ${c.name}`)
  }
  for (const d of a.extraDocs) {
    ok(await g.act('document_discard', { p_document: d.id }), `discard document ${d.title}`)
    changed(`discarded document ${d.title}`)
  }
  for (const p of a.extraProjects) {
    ok(await g.act('project_archive', { p_slug: p.slug }), `archive project ${p.name}`)
    changed(`archived project ${p.name}`)
  }
  void st
}

// ---- seed: converge to the baseline ---------------------------------------------------------------------------------
const have = await state()
const projectBy = new Map(have.projects.map((p) => [String(p.name), p]))
const taskBy = new Map(have.tasks.map((t) => [t.title, t]))
const idOf = new Map(have.tasks.map((t) => [t.title, t.id]))
const wanted = analyse(have).wanted

/** Bring one task the office holds to what the baseline wants: only the fields that differ are written. */
const converge = async (id: string, h: Have, w: Wanted): Promise<void> => {
  const drift = driftOf(h, w)
  if (drift.length === 0) return
  const upd: Record<string, unknown> = {}
  const clear: string[] = []
  if (drift.includes('due')) {
    if (w.due === null) clear.push('due_on')
    else upd.p_due_on = w.due
  }
  if (drift.includes('start')) {
    if (w.start === null) clear.push('starts_on')
    else upd.p_starts_on = w.start
  }
  if (drift.includes('priority')) upd.p_priority = w.priority
  if (drift.includes('agent')) {
    if (w.agent === null) clear.push('assignee')
    else upd.p_assignee = w.agent
  }
  if (drift.includes('parent')) {
    const pid = w.parent === null ? null : idOf.get(w.parent)
    if (w.parent === null) clear.push('parent')
    else if (pid !== undefined) upd.p_parent = pid
  }
  if (Object.keys(upd).length > 0 || clear.length > 0)
    ok(await g.act('task_update', { p_task_id: id, ...upd, p_clear: clear }), `update ${w.title}`)
  if (drift.includes('labels'))
    ok(
      await g.act(
        'my_task_set',
        w.labels.length > 0
          ? { p_task_id: id, p_labels: w.labels }
          : { p_task_id: id, p_clear: ['labels'] },
      ),
      `labels ${w.title}`,
    )
  if (drift.includes('state') || drift.includes('blockedOn'))
    ok(
      await g.act('task_state', {
        p_task_id: id,
        p_state: w.state,
        ...(w.state === 'blocked' ? { p_reason: w.blockedOn } : {}),
      }),
      `state ${w.title}`,
    )
  changed(`converged ${w.title.slice(0, 48)} [${drift.join(',')}]`)
}

const createTask = async (t: PlanTask, projectSlug: string | null): Promise<void> => {
  const w = wanted.get(t.title) as Wanted
  let id = ''
  let made: Have
  if (t.owner === 'person') {
    const r = await g.act('my_task_add', {
      p_title: t.title,
      p_detail: t.detail ?? '',
      p_due_on: w.due,
      p_priority: w.priority,
      ...(projectSlug === null ? {} : { p_project: projectSlug }),
      ...(w.labels.length > 0 ? { p_labels: w.labels } : {}),
    })
    if (!ok(r, `task ${t.title}`)) return
    id = String(result(r).id ?? '')
    // The parent is set afterwards, through the project-task door: the person's own door only accepts a parent that is
    // itself a person's task, and the milestones a project's work hangs under are the team's.
    made = { ...w, state: 'todo', start: null, blockedOn: '', agent: null, parent: null }
  } else {
    const r = await g.act('task_add', {
      p_project: projectSlug,
      p_title: t.title,
      p_detail: t.detail ?? '',
      p_due_on: w.due,
      p_assignee: w.agent,
      p_milestone: t.milestone === true,
    })
    if (!ok(r, `task ${t.title}`)) return
    id = String(result(r).id ?? '')
    made = {
      ...w,
      state: 'todo',
      start: null,
      priority: 100,
      labels: [],
      blockedOn: '',
      parent: null,
    }
  }
  if (id === '') return
  idOf.set(t.title, id)
  changed(`task ${t.title.slice(0, 56)}`)
  const noDrift = (): Have => made
  await converge(id, noDrift(), w)
  changes -= 1 // a creation is one change, not two
}

const depthOf = (t: PlanTask, all: PlanTask[]): number =>
  t.parent === undefined ? 0 : 1 + depthOf(all.find((x) => x.title === t.parent) as PlanTask, all)

for (const p of PROJECTS) {
  let row = projectBy.get(p.name)
  if (row === undefined) {
    const r = await g.act('create_project', { p_name: p.name, p_connector: 'upload', p_ref: p.ref })
    if (!ok(r, `create ${p.name}`)) continue
    const res = result(r)
    row = { name: p.name, slug: String(res.slug ?? ''), id: String(res.project_id ?? '') }
    changed(`project ${p.name}`)
  }
  const slug = String(row.slug)
  // tasks: parents before children, independent work in parallel
  const levels = [...new Set(p.tasks.map((t) => depthOf(t, p.tasks)))].sort()
  for (const level of levels) {
    const here = p.tasks.filter((t) => depthOf(t, p.tasks) === level)
    await pool(here, 4, async (t) => {
      const h = taskBy.get(t.title)
      if (h === undefined) await createTask(t, slug)
      else await converge(h.id, h, wanted.get(t.title) as Wanted)
    })
  }
  // contacts
  const haveContacts = new Set(have.contacts.map((c) => String(c.name)))
  for (const c of p.contacts) {
    if (haveContacts.has(c.name)) continue
    if (
      ok(
        await g.act('contact_add', {
          p_project: slug,
          p_name: c.name,
          p_role: c.role,
          p_org: c.org,
          p_email: c.email,
          p_phone: c.phone,
          p_website: c.website ?? '',
          p_note: c.note ?? null,
        }),
        `contact ${c.name}`,
      )
    )
      changed(`contact ${c.name}`)
  }
  // documents: upload what is missing, then approve, tag and pin what the baseline says
  const haveDocs = new Map(have.docs.map((d) => [String(d.title), d]))
  const uploaded: PlanDoc[] = []
  await pool(
    p.docs.filter((d) => !haveDocs.has(d.name)),
    3,
    async (d) => {
      if (
        ok(
          await g.act('document_upload', {
            p_project_id: String(row?.id),
            p_name: d.name,
            p_mime: d.mime,
            p_base64: `data:${d.mime};base64,${Buffer.from(d.text).toString('base64')}`,
          }),
          `document ${d.name}`,
        )
      ) {
        uploaded.push(d)
        changed(`document ${d.name.slice(0, 56)}`)
      }
    },
  )
  const now = new Map(
    (
      await rows(
        `select document_id::text id, title, state, pinned, tags, (content is not null) as read from public.documents where office_id = ${O}::uuid and project_id = ${lit(String(row.id))}::uuid and state <> 'archived'`,
      )
    ).map((r) => [String(r.title), r]),
  )
  for (const d of p.docs) {
    const cur = now.get(d.name)
    if (cur === undefined) continue
    const id = String(cur.id)
    // A file stored before the gateway read text files has no text, so no agent can find what it says (#408).
    // The same writer the gateway calls, with the proven Sample office; a no-op once the text is there.
    if (cur.read !== true) {
      await rows(`select app.index_file_text(${O}::uuid, ${lit(id)}::uuid, ${lit(d.text)}) as r`)
      changed(`indexed ${d.name.slice(0, 48)}`)
    }
    const tags = Array.isArray(cur.tags) ? cur.tags.map(String) : []
    const wantTags = [...(d.tags ?? [])].sort()
    if (d.approve === true && String(cur.state) !== 'approved') {
      ok(await g.act('document_approve', { p_document: id, p_tags: wantTags }), `approve ${d.name}`)
      changed(`approved ${d.name.slice(0, 48)}`)
    } else if (wantTags.join('|') !== [...tags].sort().join('|')) {
      for (const tag of wantTags.filter((x) => !tags.includes(x)))
        ok(await g.act('document_tag', { p_document: id, p_tag: tag }), `tag ${d.name}`)
      changed(`tagged ${d.name.slice(0, 48)}`)
    }
    if ((d.pinned === true) !== (cur.pinned === true)) {
      ok(
        await g.act('document_pin', { p_document_id: id, p_pinned: d.pinned === true }),
        `pin ${d.name}`,
      )
      changed(`pinned ${d.name.slice(0, 48)}`)
    }
  }
  void uploaded
}

// personal to-dos with no project
await pool(PERSONAL_TASKS, 3, async (t) => {
  const h = taskBy.get(t.title)
  if (h === undefined) await createTask(t, null)
  else await converge(h.id, h, wanted.get(t.title) as Wanted)
})

// settings: written only when they differ, so a second seed is not a second event in the ledger
const autonomyNow = String(
  (
    await rows(
      `select level::text l from public.autonomy_settings where office_id = ${O}::uuid and project_id is null order by set_at desc, setting_id desc limit 1`,
    )
  )[0]?.l ?? '',
)
if (autonomyNow !== AUTONOMY) {
  ok(await g.act('autonomy_set', { p_level: AUTONOMY }), 'autonomy')
  changed('autonomy')
}
const paletteNow = String(
  (
    await rows(
      `select settings ->> 'palette' p from public.appearance_settings where office_id = ${O}::uuid limit 1`,
    )
  )[0]?.p ?? '',
)
if (paletteNow !== APPEARANCE.palette) {
  ok(await g.act('appearance_set', { p_settings: APPEARANCE }), 'appearance')
  changed('appearance')
}

// ---- what has no door: the product's own SQL writers, for THIS office only ------------------------------------------
const by = lit('p4-second-person')
const lessonHave = new Set(
  (await rows(`select body from public.lessons where office_id = ${O}::uuid`)).map((r) =>
    String(r.body),
  ),
)
for (const l of LESSONS)
  if (!lessonHave.has(l.body)) {
    await rows(
      `select app.learn(${O}::uuid, ${lit(l.scope)}::public.lesson_scope, ${lit(l.body)}, ${by}) as r`,
    )
    changed(`lesson ${l.body.slice(0, 40)}`)
  }
const reqHave = new Set(
  (
    await rows(
      `select tool || '|' || asked_by k from public.tool_requests where office_id = ${O}::uuid and state = 'open'`,
    )
  ).map((r) => String(r.k)),
)
for (const r of TOOL_REQUESTS)
  if (!reqHave.has(`${r.tool}|${r.by}`)) {
    try {
      await rows(
        `select app.request_tool(${O}::uuid, ${lit(r.tool)}, ${lit(r.by)}, ${lit(r.why)}, '{}'::jsonb, null) as r`,
      )
      changed(`tool request ${r.tool}`)
    } catch (e) {
      console.log(`  ! request ${r.tool}: ${String(e).slice(0, 120)}`)
      failures += 1
    }
  }

console.log(`${cmd === 'reset' ? 'reset' : 'seeded'}: ${changes} change(s), ${failures} failure(s)`)
const final = await report()

// ---- every other office, before and after ---------------------------------------------------------------------------
const moved = diffFingerprints(before, await otherOffices(office.officeId))
if (moved.length === 0)
  console.log(`other offices: ${Object.keys(before).length} fingerprinted, none changed`)
else {
  console.log(
    `other offices CHANGED during this run: ${moved.join(', ')} (expected only if that office was in use; this run writes to no office but the Sample's)`,
  )
  process.exitCode = 4
}
if (failures > 0) process.exitCode = process.exitCode ?? 1
if (!final.clean) process.exitCode = process.exitCode ?? 1
