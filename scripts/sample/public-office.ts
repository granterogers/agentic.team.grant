/**
 * Establish, populate, seal and inspect the PUBLIC Sample Office (migration 0897).
 *
 *   npx tsx scripts/sample/public-office.ts status      # read-only: what exists, whether it is sealed, what it holds
 *   npx tsx scripts/sample/public-office.ts provision   # create the login (once) and the office, left OPEN for seeding
 *   npx tsx scripts/sample/public-office.ts seed        # open it, write the story through the gateway, seal it again
 *   npx tsx scripts/sample/public-office.ts verify      # the deployed visitor path, over HTTPS, as a visitor does it
 *
 * This is NOT the Sample Person (`sample.ts`): that is the authenticated UX-testing account. This office is the
 * demonstration a visitor explores with no account, and it is written exactly once, here, from `public-plan.ts`.
 *
 * WHILE IT IS OPEN nobody can enter it (`app.sample_login` answers no), because its member is a person so that the
 * content can be written through the same gateway a browser uses. SEALING makes the member a guest, which the gateway
 * lets read and ask a question and nothing else. `seed` always ends sealed, and says so; a crash leaves it open, which
 * is closed to visitors, and `seed` run again finishes the job.
 *
 * Nothing here prints a credential. The login has a random password nobody keeps: visitors are never given it, they are
 * given a session minted by the `signin` function, and the service key is read from the Management API per run.
 */
import { randomBytes } from 'node:crypto'
import { act, db, ENDPOINT, REF, read } from '../p4/lib.ts'
import { apiKeys } from '../p4/provision-second-person.ts'
import { diffFingerprints, otherOffices } from './fingerprint.ts'
import { lit, rows } from './lib.ts'
import { isoDay, type PlanTask } from './plan.ts'
import {
  APPEARANCE,
  AUTONOMY,
  LESSONS,
  OFFICE_NAME,
  PERSONAL_TASKS,
  PROJECTS,
  PUBLIC_VERSION,
  SAMPLE_EMAIL,
  SAMPLE_KEY,
} from './public-plan.ts'

const cmd = process.argv[2] ?? 'status'
if (!['status', 'provision', 'seed', 'verify'].includes(cmd)) {
  console.error('usage: public-office.ts status | provision | seed | verify')
  process.exit(2)
}
const today = new Date()
const SIGNIN = `https://${REF}.supabase.co/functions/v1/signin`
const PAGE_ORIGIN = process.env.PAGE_ORIGIN ?? 'https://ai-team-hq.vercel.app'

const office = async () =>
  (
    await rows(
      `select o.office_id::text id, o.state, o.kind, u.id::text auth, lower(u.email) email,
              (select m.kind from public.office_members m where lower(m.email) = lower(u.email) limit 1) member_kind
         from public.offices o join auth.users u on u.id = o.auth_user_id
        where o.kind = 'sample' order by o.created_at desc limit 1`,
    )
  )[0] as
    | { id: string; state: string; kind: string; auth: string; email: string; member_kind: string }
    | undefined

const report = async (): Promise<void> => {
  const o = await office()
  if (o === undefined) {
    console.log('there is no sample office yet (run provision)')
    return
  }
  const q = async (sql: string) => Number(((await rows(sql))[0] as { n: number }).n)
  const O = lit(o.id)
  console.log(
    `sample office ${o.id.slice(0, 8)}  state ${o.state}  member ${o.member_kind}  (${o.member_kind === 'guest' ? 'SEALED: visitors can enter' : 'OPEN: nobody can enter'})`,
  )
  console.log(
    `  projects ${await q(`select count(*) n from public.projects where office_id = ${O}::uuid and status = 'active' and slug <> 'unnamed'`)}` +
      `  tasks ${await q(`select count(*) n from public.tasks where office_id = ${O}::uuid and state <> 'cancelled'`)}` +
      `  contacts ${await q(`select count(*) n from public.contacts c join public.projects p on p.project_id = c.project_id where p.office_id = ${O}::uuid and c.archived_at is null`)}` +
      `  documents ${await q(`select count(*) n from public.documents where office_id = ${O}::uuid and state <> 'archived'`)}` +
      `  (with text ${await q(`select count(*) n from public.documents where office_id = ${O}::uuid and content is not null`)})`,
  )
  console.log(
    `  tool grants ${await q(`select count(*) n from public.staff_tools where office_id = ${O}::uuid`)}` +
      ` (db.read only: ${await q(`select count(*) n from public.staff_tools where office_id = ${O}::uuid and tool <> 'db.read'`)} others)` +
      `  lessons ${await q(`select count(*) n from public.lessons where office_id = ${O}::uuid`)}` +
      `  jobs ${await q(`select count(*) n from public.jobs where office_id = ${O}::uuid`)}`,
  )
}

if (cmd === 'status') {
  await report()
  process.exit(0)
}

// ---- verify: the deployed visitor path, over HTTPS ----------------------------------------------------------------------
if (cmd === 'verify') {
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
  }
  const results: boolean[] = []
  const check = (what: string, ok: boolean, detail: string) => {
    results.push(ok)
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
  }
  const entered = await post(SIGNIN, { origin: PAGE_ORIGIN }, { action: 'sample' })
  const token = String(entered.body.access_token ?? '')
  check(
    'a visitor is given a session with no address, link or password',
    entered.status === 200 && token !== '',
    `http ${String(entered.status)} ${String(entered.body.reason ?? '')}`,
  )
  if (token === '') process.exit(1)
  const projects = await read(token, 'projects')
  const names = JSON.stringify(projects.json)
  check(
    'the visitor reads the sample projects',
    projects.status === 200 && PROJECTS.every((p) => names.includes(p.name)),
    `http ${String(projects.status)}`,
  )
  const settings = await read(token, 'studio_settings')
  const viewer = ((
    settings.json as { data?: { viewer?: { guest?: boolean; operator?: boolean } } } | null
  )?.data?.viewer ?? {}) as { guest?: boolean; operator?: boolean }
  check(
    'the gateway says it is a guest, and not an operator',
    viewer.guest === true && viewer.operator === false,
    JSON.stringify(viewer),
  )
  for (const section of ['google', 'build', 'drive']) {
    const r = await read(token, section)
    check(
      `the deployment's own page "${section}" is refused`,
      r.status === 403,
      `http ${String(r.status)}`,
    )
  }
  const write = await act(token, 'task_add', {
    p_project: 'riverside-launch',
    p_title: 'A visitor should not be able to add this',
  })
  check(
    'a write is refused, with the sentence a visitor sees',
    write.status === 403 && (write.json as { error?: string } | null)?.error === 'sample_readonly',
    `http ${String(write.status)}`,
  )
  const written = await rows(
    `select count(*) n from public.tasks where title = 'A visitor should not be able to add this'`,
  )
  // An exact count of the one row that would exist. A text match on "0" would also pass a count of 10.
  check(
    'and nothing was written',
    written.length === 1 && Number((written[0] as { n: unknown }).n) === 0,
    JSON.stringify(written),
  )
  const voice = await fetch(`https://${REF}.supabase.co/functions/v1/voice-token`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: PAGE_ORIGIN,
    },
    body: '{}',
  })
  check(
    'the voice door refuses a visitor (nothing metered)',
    voice.status === 401,
    `http ${String(voice.status)}`,
  )
  const passed = results.filter(Boolean).length
  console.log(`\n${String(passed)}/${String(results.length)} passed`)
  process.exit(passed === results.length ? 0 : 1)
}

// ---- provision ----------------------------------------------------------------------------------------------------------
let existing = await office()
if (existing === undefined) {
  const { service } = await apiKeys()
  const have = (
    await rows(`select id::text id from auth.users where lower(email) = ${lit(SAMPLE_EMAIL)}`)
  )[0] as { id?: string } | undefined
  if (have?.id === undefined) {
    const made = await fetch(`https://${REF}.supabase.co/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'content-type': 'application/json',
      },
      // A random password nobody keeps: the login is entered only through a session `signin` mints, never by password.
      body: JSON.stringify({
        email: SAMPLE_EMAIL,
        email_confirm: true,
        password: randomBytes(32).toString('base64url'),
      }),
    })
    if (!made.ok) throw new Error(`could not create the sample login: http ${String(made.status)}`)
    console.log('created the sample login (reserved .invalid address; no password is kept)')
  }
  const r = (
    await rows(
      `select app.provision_sample_office(${lit(OFFICE_NAME)}, ${lit(SAMPLE_EMAIL)}, ${lit(SAMPLE_KEY)}) as r`,
    )
  )[0] as { r: unknown }
  console.log(
    `provisioned: ${JSON.stringify(typeof r.r === 'string' ? JSON.parse(r.r) : r.r).slice(0, 120)}`,
  )
  existing = await office()
}
const sample = existing
if (sample === undefined) throw new Error('the sample office was not created')
if (cmd === 'provision') {
  await report()
  process.exit(0)
}

// ---- seed ---------------------------------------------------------------------------------------------------------------
console.log(
  `public Sample Office ${sample.id.slice(0, 8)}  version ${PUBLIC_VERSION}  today ${isoDay(today)}`,
)
const before = await otherOffices(sample.id)
await rows(`select app.sample_office_open(${lit(sample.id)}::uuid, true)`)
console.log('opened for seeding (visitors cannot enter while it is open)')

let failures = 0
let changes = 0
const ok = (r: { status: number; json: unknown }, what: string): boolean => {
  const j = r.json as { error?: string; result?: { error?: string; ok?: boolean } } | null
  const e = j?.error ?? j?.result?.error
  if (r.status === 200 && e === undefined && j?.result?.ok !== false) return true
  console.log(`  ! ${what}: http ${r.status} ${String(e ?? '').slice(0, 140)}`)
  failures += 1
  return false
}
const result = (r: { json: unknown }): Record<string, unknown> =>
  ((r.json as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>

try {
  const { anon, service } = await apiKeys()
  const gen = await fetch(`https://${REF}.supabase.co/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: sample.email }),
  })
  const link = (await gen.json()) as { hashed_token?: string }
  const verified = await fetch(`https://${REF}.supabase.co/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  })
  const session = (await verified.json()) as { access_token?: string }
  if (session.access_token === undefined)
    throw new Error('no session for the sample login while it was open')
  const token = session.access_token
  const O = lit(sample.id)

  const haveProjects = new Map(
    (
      await rows(
        `select name, slug, project_id::text id from public.projects where office_id = ${O}::uuid and status = 'active'`,
      )
    ).map((p) => [String(p.name), p]),
  )
  const haveTasks = new Map(
    (
      await rows(
        `select title, task_id::text id from public.tasks where office_id = ${O}::uuid and state <> 'cancelled'`,
      )
    ).map((t) => [String(t.title), String(t.id)]),
  )
  const idOf = new Map(haveTasks)
  const haveContacts = new Set(
    (
      await rows(
        `select c.name from public.contacts c join public.projects p on p.project_id = c.project_id where p.office_id = ${O}::uuid`,
      )
    ).map((c) => String(c.name)),
  )
  const haveDocs = new Set(
    (await rows(`select title from public.documents where office_id = ${O}::uuid`)).map((d) =>
      String(d.title),
    ),
  )

  const wantedDue = (t: PlanTask) => (t.due === undefined ? null : isoDay(today, t.due))
  const createTask = async (t: PlanTask, slug: string | null): Promise<void> => {
    if (idOf.has(t.title)) return
    let id = ''
    if (t.owner === 'person') {
      const r = await act(token, 'my_task_add', {
        p_title: t.title,
        p_detail: t.detail ?? '',
        p_due_on: wantedDue(t),
        p_priority: t.priority ?? 100,
        ...(slug === null ? {} : { p_project: slug }),
        ...((t.labels ?? []).length > 0 ? { p_labels: t.labels } : {}),
      })
      if (!ok(r, `task ${t.title}`)) return
      id = String(result(r).id ?? '')
    } else {
      const r = await act(token, 'task_add', {
        p_project: slug,
        p_title: t.title,
        p_detail: t.detail ?? '',
        p_due_on: wantedDue(t),
        p_assignee: t.agent ?? null,
        p_milestone: t.milestone === true,
      })
      if (!ok(r, `task ${t.title}`)) return
      id = String(result(r).id ?? '')
      if ((t.labels ?? []).length > 0)
        ok(
          await act(token, 'my_task_set', { p_task_id: id, p_labels: t.labels }),
          `labels ${t.title}`,
        )
    }
    if (id === '') return
    idOf.set(t.title, id)
    changes += 1
    const upd: Record<string, unknown> = {}
    if (t.start !== undefined) upd.p_starts_on = isoDay(today, t.start)
    if ((t.priority ?? 100) !== 100 && t.owner !== 'person') upd.p_priority = t.priority
    if (t.parent !== undefined && idOf.has(t.parent)) upd.p_parent = idOf.get(t.parent)
    if (Object.keys(upd).length > 0)
      ok(
        await act(token, 'task_update', { p_task_id: id, ...upd, p_clear: [] }),
        `update ${t.title}`,
      )
    if ((t.state ?? 'todo') !== 'todo')
      ok(
        await act(token, 'task_state', {
          p_task_id: id,
          p_state: t.state,
          ...(t.state === 'blocked' ? { p_reason: t.blockedOn } : {}),
        }),
        `state ${t.title}`,
      )
  }
  const depth = (t: PlanTask, all: PlanTask[]): number =>
    t.parent === undefined ? 0 : 1 + depth(all.find((x) => x.title === t.parent) as PlanTask, all)

  for (const p of PROJECTS) {
    let row = haveProjects.get(p.name)
    if (row === undefined) {
      const r = await act(token, 'create_project', {
        p_name: p.name,
        p_connector: 'upload',
        p_ref: p.ref,
      })
      if (!ok(r, `create ${p.name}`)) continue
      row = {
        name: p.name,
        slug: String(result(r).slug ?? ''),
        id: String(result(r).project_id ?? ''),
      }
      changes += 1
      console.log(`  project ${p.name}`)
    }
    const slug = String(row.slug)
    for (const level of [...new Set(p.tasks.map((t) => depth(t, p.tasks)))].sort()) {
      for (const t of p.tasks.filter((x) => depth(x, p.tasks) === level)) await createTask(t, slug)
    }
    for (const c of p.contacts) {
      if (haveContacts.has(c.name)) continue
      if (
        ok(
          await act(token, 'contact_add', {
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
        changes += 1
    }
    for (const d of p.docs) {
      if (haveDocs.has(d.name)) continue
      if (
        !ok(
          await act(token, 'document_upload', {
            p_project_id: String(row.id),
            p_name: d.name,
            p_mime: d.mime,
            p_base64: `data:${d.mime};base64,${Buffer.from(d.text).toString('base64')}`,
          }),
          `document ${d.name}`,
        )
      )
        continue
      changes += 1
      const found = (
        await rows(
          `select document_id::text id, state, (content is not null) read from public.documents where office_id = ${O}::uuid and title = ${lit(d.name)} limit 1`,
        )
      )[0] as { id: string; state: string; read: boolean } | undefined
      if (found === undefined) continue
      if (!found.read)
        await rows(
          `select app.index_file_text(${O}::uuid, ${lit(found.id)}::uuid, ${lit(d.text)}) as r`,
        )
      if (found.state !== 'approved')
        ok(
          await act(token, 'document_approve', { p_document: found.id, p_tags: d.tags ?? [] }),
          `approve ${d.name}`,
        )
      else
        for (const tag of d.tags ?? [])
          ok(
            await act(token, 'document_tag', { p_document: found.id, p_tag: tag }),
            `tag ${d.name}`,
          )
      if (d.pinned === true)
        ok(
          await act(token, 'document_pin', { p_document_id: found.id, p_pinned: true }),
          `pin ${d.name}`,
        )
    }
  }
  for (const t of PERSONAL_TASKS) await createTask(t, null)

  // settings and what has no door
  const level = String(
    (
      await rows(
        `select level::text l from public.autonomy_settings where office_id = ${O}::uuid and project_id is null order by set_at desc, setting_id desc limit 1`,
      )
    )[0]?.l ?? '',
  )
  if (level !== AUTONOMY) {
    ok(await act(token, 'autonomy_set', { p_level: AUTONOMY }), 'autonomy')
    changes += 1
  }
  ok(await act(token, 'appearance_set', { p_settings: APPEARANCE }), 'appearance')
  const lessons = new Set(
    (await rows(`select body from public.lessons where office_id = ${O}::uuid`)).map((r) =>
      String(r.body),
    ),
  )
  for (const l of LESSONS)
    if (!lessons.has(l.body)) {
      await rows(
        `select app.learn(${O}::uuid, ${lit(l.scope)}::public.lesson_scope, ${lit(l.body)}, ${lit(SAMPLE_KEY)}) as r`,
      )
      changes += 1
    }
} finally {
  // Always seal, even after a failure: an open office is closed to visitors, but a sealed one is the intended state, and
  // a half-seeded office is better sealed than left with a person's authority on a login nobody holds.
  const seal = process.argv.includes('--leave-open')
    ? null
    : await rows(`select app.sample_office_open(${lit(sample.id)}::uuid, false) as r`)
  console.log(
    seal === null
      ? 'LEFT OPEN (--leave-open): visitors cannot enter'
      : 'sealed: visitors can read it and ask the team a question, and nothing else',
  )
}

console.log(`seeded: ${changes} change(s), ${failures} failure(s)`)
await report()
const moved = diffFingerprints(before, await otherOffices(sample.id))
if (moved.length === 0)
  console.log(`other offices: ${Object.keys(before).length} fingerprinted, none changed`)
else {
  console.log(`other offices CHANGED during this run: ${moved.join(', ')}`)
  process.exitCode = 4
}
void ENDPOINT
void db
if (failures > 0) process.exitCode = process.exitCode ?? 1
