/**
 * Two lists, one truth (#259, Phase 2) — against a REAL Vikunja.
 *
 * Not a fake provider and not a recorded fixture: `npm run vikunja:dev` starts
 * the released Vikunja binary with SQLite behind it, and everything below goes
 * over HTTP to it. The brief is explicit that the integration must be proved,
 * and CLAUDE.md is explicit about what a suite made only of refusals is worth.
 *
 *   export VIKUNJA_URL=http://127.0.0.1:3456
 *   export VIKUNJA_TOKEN_FILE=/tmp/vikunja-dev/.apitok
 *   npm run verify:vikunja
 *
 * ## Why this is not in the readiness gate
 *
 * It needs a server the gate has no way to start, and a gate entry that
 * silently skips is the found-nothing shape this repository keeps paying for.
 * It is run deliberately, and the ledger records what it returned.
 *
 * ## THE SUBJECTS ARE REAL TASKS, AND THAT IS NOT A SHORTCUT
 *
 * The first version named them so that `tasks.is_fixture` came out true, and
 * every push check failed — because `app.tasks_to_push` EXCLUDES fixtures, so
 * the only tasks on the list that could not sync were this suite's. #45's rule
 * in its sharpest form: a suite testing something that filters fixtures cannot
 * name its subjects the way the filter matches.
 *
 * They are ordinary tasks called `fixture-vik-<run> …`, removed by title in
 * teardown, which asserts they are gone.
 *
 * ## AND A SYNC ROUND IS GLOBAL, WHICH THIS SUITE DOES NOT HIDE
 *
 * `tasks_to_push` takes no scope and should not get one: the office runs it
 * for the whole list and a scope added for a test's convenience would be a
 * path nobody runs — #184's lesson about the duty dispatcher. So a round here
 * really does push Grant's own tasks into the local, disposable Vikunja, and
 * `task_provider_forget` in teardown removes every link it made.
 *
 * That is turned into the most valuable check in the file rather than
 * apologised for: the revision of every task this suite did not touch is
 * snapshotted before and compared after, so a sync round that alters something
 * it had no business altering fails here.
 */
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { tasksSyncHandler } from '../../src/handlers/tasks-sync.ts'
import { ProviderDownError, type TaskProvider } from '../../src/tasks/provider.ts'
import { permitEverything, syncOnce } from '../../src/tasks/sync.ts'
import { VikunjaProvider } from '../../src/tasks/vikunja.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const url = process.env.VIKUNJA_URL ?? ''
const tokenFile = process.env.VIKUNJA_TOKEN_FILE ?? ''
const token =
  process.env.VIKUNJA_TOKEN ?? (tokenFile === '' ? '' : readFileSync(tokenFile, 'utf8').trim())
if (url === '' || token === '') {
  console.error(
    'this suite needs a real Vikunja.\n\n' +
      '  npm run vikunja:dev\n' +
      '  export VIKUNJA_URL=http://127.0.0.1:3456\n' +
      '  export VIKUNJA_TOKEN_FILE=/tmp/vikunja-dev/.apitok\n' +
      '  npm run verify:vikunja\n',
  )
  process.exit(2)
}

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>
const j = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

const checks: { what: string; said: string; ok: boolean }[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push({ what, said, ok })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}

const run = Math.random().toString(36).slice(2, 10)
const PROVIDER = 'vikunja'
const NAME = (s: string): string => `fixture-vik-${run} ${s}`
console.log(`two lists, one truth (#259 Phase 2) — against ${url}\n`)

/* The office's own Vikunja project, made through the API like anything else. */
const api = `${url.replace(/\/+$/, '')}/api/v1`
const raw = async (method: string, path: string, body?: unknown): Promise<Response> =>
  await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const madeProject = await raw('PUT', '/projects', { title: `Agentic Team ${run}` })
const projectId = Number(((await madeProject.json()) as { id?: number }).id ?? 0)
check(
  'a project for this office can be created at the provider',
  `http ${String(madeProject.status)} · project ${String(projectId)}`,
  madeProject.ok && projectId > 0,
)
if (projectId <= 0) process.exit(1)

const vikunja = new VikunjaProvider({ baseUrl: url, token, projectId })

/*
  The canonical ids of everything this run makes, so teardown can be asserted
  rather than hoped for. CLAUDE.md: a teardown that matches nothing looks
  exactly like a teardown that worked.
*/
const mine: string[] = []
const add = async (title: string, extra = ''): Promise<string> => {
  const v = j(
    (
      await one(`
    select app.my_task_add(p_title => ${lit(title)}${extra}) as v`)
    ).v,
  )
  const id = String(v.id ?? '')
  if (id !== '') mine.push(id)
  return id
}

/*
  Every page, because Grant's own list travels with the suite's and one page of
  50 stopped covering it the moment the round became global. A `find` over a
  truncated list answers "it is not there" about a task that is.
*/
const there = async (): Promise<Record<string, unknown>[]> => {
  const out: Record<string, unknown>[] = []
  for (let page = 1; page <= 20; page += 1) {
    const r = await raw(
      'GET',
      `/projects/${String(projectId)}/tasks?per_page=50&page=${String(page)}`,
    )
    const got = (await r.json()) as Record<string, unknown>[] | null
    if (!Array.isArray(got) || got.length === 0) break
    out.push(...got)
    if (got.length < 50) break
  }
  return out
}

/** Only this run's, which is what every count below is about. */
const ours = async (): Promise<Record<string, unknown>[]> =>
  (await there()).filter((t) => String(t.title ?? '').startsWith(`fixture-vik-${run}`))
const here = async (id: string): Promise<Record<string, unknown>> =>
  await one(`
    select t.title, t.state, t.detail, t.priority, t.due_on::text as due, t.revision,
           l.external_id, l.sync_state, l.sync_error, l.synced_revision
      from public.tasks t
      left join public.task_links l on l.task_id = t.task_id and l.provider = ${lit(PROVIDER)}
     where t.task_id = ${lit(id)}::uuid`)

/*
  WHAT THE ROUND MUST NOT TOUCH.

  Every personal task that is not this run's, with its revision — the column
  that moves on any material change. Taken before the first round and compared
  after the last one. A sync engine that rewrites a task nobody asked it to is
  the worst thing this integration could do to Grant's list, and it is the one
  failure that would otherwise look like nothing at all.
*/
const untouched = async (): Promise<Record<string, string>> => {
  const rows = (
    await db.execute(`
      select task_id::text as id, revision::text as r
        from public.tasks
       where assigned_to_human
         and not coalesce(is_fixture, false)
         and title not like ${lit(`fixture-vik-${run}%`)}`)
  ).rows as { id?: string; r?: string }[]
  return Object.fromEntries(rows.map((x) => [String(x.id), String(x.r)]))
}
const wasBefore = await untouched()
check(
  'CONTROL: there is something to protect, so the comparison is not vacuous',
  `${String(Object.keys(wasBefore).length)} of Grant's own task(s) watched`,
  Object.keys(wasBefore).length > 0,
)

let failedAt = ''
try {
  // =========================================================================
  console.log('\ncreate here, appear there')
  // =========================================================================
  const a = await add(NAME('ring the venue'), ", p_due_on => '2026-10-01'::date, p_priority => 20")
  const r1 = await syncOnce(db, vikunja, permitEverything)
  check(
    'one round pushes it, and says how many of what it did',
    JSON.stringify(r1),
    r1.down === null && r1.pushed >= 1,
  )
  const seen = (await there()).find((t) => String(t.title ?? '').includes(NAME('ring the venue')))
  check(
    'the task Grant made here is at the provider, with its date and priority',
    seen === undefined
      ? 'IT IS NOT THERE'
      : `due ${String(seen.due_date)} · priority ${String(seen.priority)}`,
    seen !== undefined &&
      String(seen.due_date).startsWith('2026-10-01') &&
      Number(seen.priority) === 3,
  )
  const linked = await here(a)
  check(
    'and the office knows where it put it, without that reaching the task row',
    `external ${String(linked.external_id)} · state ${String(linked.sync_state)}`,
    String(linked.external_id ?? '') !== '' && linked.sync_state === 'ok',
  )

  // =========================================================================
  console.log('\nand a second round does nothing, which is the whole of idempotency')
  // =========================================================================
  const before = (await ours()).length
  const r2 = await syncOnce(db, vikunja, permitEverything)
  const after = (await ours()).length
  check(
    'running the same round again creates nothing and pushes nothing',
    `${String(before)} → ${String(after)} there · pushed ${String(r2.pushed)}`,
    before === after && r2.pushed === 0,
  )
  check(
    'CONTROL: it still READ the provider, so "pushed 0" is not "did nothing"',
    `pulled ${String(r2.pulled)}`,
    r2.pulled >= 1,
  )

  // =========================================================================
  console.log('\nedit here, update there')
  // =========================================================================
  await one(`select app.my_task_set(${lit(a)}, p_title => ${lit(NAME('ring the venue back'))})`)
  await syncOnce(db, vikunja, permitEverything)
  const renamed = (await there()).find((t) => String(t.title ?? '') === NAME('ring the venue back'))
  check(
    'a rename here reaches the provider, and does not make a second task',
    `${String((await ours()).length)} of this run's task(s) there`,
    renamed !== undefined &&
      (await ours()).filter((t) => String(t.title ?? '').includes('ring the venue')).length === 1,
  )

  // =========================================================================
  console.log('\ncomplete and reopen here, reflected there')
  // =========================================================================
  await one(`select app.hq_task_state(${lit(a)}, 'done', 'verify:vikunja')`)
  await syncOnce(db, vikunja, permitEverything)
  const done = (await there()).find((t) => String(t.title ?? '') === NAME('ring the venue back'))
  check('ticking it here ticks it there', `done=${String(done?.done)}`, done?.done === true)
  await one(`select app.hq_task_state(${lit(a)}, 'todo', 'verify:vikunja')`)
  await syncOnce(db, vikunja, permitEverything)
  const back = (await there()).find((t) => String(t.title ?? '') === NAME('ring the venue back'))
  check('and reopening it reopens it there', `done=${String(back?.done)}`, back?.done === false)

  // =========================================================================
  console.log('\ncreate there, arrive here')
  // =========================================================================
  const madeThere = await raw('PUT', `/projects/${String(projectId)}/tasks`, {
    title: NAME('posted a letter'),
    due_date: '2026-10-05T00:00:00Z',
    priority: 4,
  })
  check(
    'a task made at the provider is accepted there',
    `http ${String(madeThere.status)}`,
    madeThere.ok,
  )
  const r3 = await syncOnce(db, vikunja, permitEverything)
  const arrived = await one(`
    select task_id::text as id, due_on::text as due, priority, added_by
      from public.tasks where title = ${lit(NAME('posted a letter'))}`)
  if (String(arrived.id ?? '') !== '') mine.push(String(arrived.id))
  check(
    'it arrives on Grant’s list, with the date and priority mapped back',
    `${String(arrived.due ?? 'no date')} · priority ${String(arrived.priority)} · created ${String(r3.created)}`,
    String(arrived.id ?? '') !== '' &&
      arrived.due === '2026-10-05' &&
      Number(arrived.priority) === 10,
  )
  check(
    'CONTROL: the priority scales did not invert on the way back',
    `Vikunja 4 (urgent) → ${String(arrived.priority)} (10 is urgent here)`,
    Number(arrived.priority) === 10,
  )

  // =========================================================================
  console.log('\nedit and complete there, reconciled here')
  // =========================================================================
  const extId = String(
    (await there()).find((t) => String(t.title ?? '') === NAME('posted a letter'))?.id ?? '',
  )
  await raw('POST', `/tasks/${extId}`, { title: NAME('posted two letters'), done: true })
  await syncOnce(db, vikunja, permitEverything)
  const reconciled = await here(String(arrived.id))
  check(
    'a rename and a tick at the provider both reconcile here',
    `"${String(reconciled.title)}" · ${String(reconciled.state)}`,
    reconciled.title === NAME('posted two letters') && reconciled.state === 'done',
  )
  await raw('POST', `/tasks/${extId}`, { done: false })
  await syncOnce(db, vikunja, permitEverything)
  check(
    'and reopening it there reopens it here',
    String((await here(String(arrived.id))).state),
    (await here(String(arrived.id))).state === 'todo',
  )

  // =========================================================================
  console.log('\nboth sides at once — the conflict policy, not a coin toss')
  // =========================================================================
  const c = await add(NAME('the contested one'))
  await syncOnce(db, vikunja, permitEverything)
  const cExt = String(
    (await ours()).find((t) => String(t.title ?? '') === NAME('the contested one'))?.id ?? '',
  )
  await one(`select app.my_task_set(${lit(c)}, p_title => ${lit(NAME('changed HERE'))})`)

  /*
    THE CONFLICT IS DRIVEN THROUGH `task_pulled` DIRECTLY, and the first
    version of this section was worthless because it was not.

    It changed both sides and then ran a whole round — which pushes BEFORE it
    pulls, so the canonical value reached the provider first and the pull read
    its own change back. Canonical survived every time, for the right reason
    and not the one under test: disabling the conflict branch in
    `app.task_pulled` entirely left this section GREEN.

    A conflict is what happens when a provider change arrives while the
    canonical side is ahead and no push has closed the gap — a webhook, or a
    round whose push failed for that one task. That is this call.
  */
  await raw('POST', `/tasks/${cExt}`, { title: NAME('changed THERE') })
  const clash = j(
    (
      await one(`
    select app.task_pulled(${lit(PROVIDER)}, ${lit(cExt)},
      jsonb_build_object('title', ${lit(NAME('changed THERE'))})) as v`)
    ).v,
  )
  check(
    'a provider change arriving while the office is ahead is a CONFLICT',
    `conflict=${String(clash.conflict)}`,
    clash.conflict === true,
  )
  const settled = await here(c)
  check(
    'the canonical value is the one that survives it',
    `"${String(settled.title)}"`,
    settled.title === NAME('changed HERE'),
  )
  check(
    'and the disagreement is RECORDED rather than swallowed',
    `${String(settled.sync_state)} — ${String(settled.sync_error ?? '')}`.slice(0, 70),
    settled.sync_state === 'conflict',
  )
  check(
    'and it is visible to the reader built for it, not only true in a column',
    String(
      (
        await one(`
      select count(*)::int as n from jsonb_array_elements(app.task_sync_trouble(${lit(PROVIDER)})) e
       where e ->> 'task_id' = ${lit(c)}`)
      ).n,
    ),
    Number(
      (
        await one(`
      select count(*)::int as n from jsonb_array_elements(app.task_sync_trouble(${lit(PROVIDER)})) e
       where e ->> 'task_id' = ${lit(c)}`)
      ).n,
    ) === 1,
  )
  await syncOnce(db, vikunja, permitEverything)
  const resolved = (await ours()).find((t) => String(t.id) === cExt)
  check(
    'the next round resolves it in the direction the invariant requires',
    `"${String(resolved?.title)}"`,
    String(resolved?.title) === NAME('changed HERE'),
  )
  check(
    'and the link is clean again once the two agree',
    String((await here(c)).sync_state),
    (await here(c)).sync_state === 'ok',
  )

  // =========================================================================
  console.log('\ndelete here, gone there — and never resurrected')
  // =========================================================================
  const d = await add(NAME('the doomed one'))
  await syncOnce(db, vikunja, permitEverything)
  const dExt = String(
    (await there()).find((t) => String(t.title ?? '') === NAME('the doomed one'))?.id ?? '',
  )
  check('the doomed task reached the provider first', `external ${dExt}`, dExt !== '')
  /*
    DELETED WHILE THE PROVIDER IS DOWN, which is the only moment a
    resurrection is possible and the moment the tombstone exists for.

    `app.task_delete_pushed` removes the provider from the tombstone's `links`
    and clears the tombstone once nobody is owed the news — so the guard in
    0518 protects exactly while the deletion is OUTSTANDING. The first version
    of this section proved nothing because it asked afterwards, when the debt
    was already settled and the office had correctly stopped caring.
  */
  const down: TaskProvider = {
    name: PROVIDER,
    upsert: async () => {
      throw new ProviderDownError(PROVIDER, 'injected outage')
    },
    remove: async () => {
      throw new ProviderDownError(PROVIDER, 'injected outage')
    },
    list: async () => {
      throw new ProviderDownError(PROVIDER, 'injected outage')
    },
    reachable: async () => false,
  }
  const gone = j((await one(`select app.my_task_delete(${lit(d)}, 'verify:vikunja') as v`)).v)
  check(
    'deleting it here really removes the row, and says what it removed',
    String(gone.deleted ?? gone.error ?? 'nothing'),
    gone.ok === true,
  )
  const owed = await syncOnce(db, down, permitEverything)
  check(
    'a deletion that could not be delivered stays owed rather than being forgotten',
    `down=${String(owed.down)} · deleted ${String(owed.deleted)}`,
    owed.down !== null && owed.deleted === 0,
  )
  const offeredBack = j(
    (
      await one(`
    select app.task_pulled(${lit(PROVIDER)}, ${lit(dExt)},
      jsonb_build_object('title', ${lit(NAME('the doomed one'))})) as v`)
    ).v,
  )
  check(
    'and while it is owed, the provider offering that task back is REFUSED',
    `${String(offeredBack.deleted)} — ${String(offeredBack.note ?? '')}`.slice(0, 70),
    offeredBack.deleted === true &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.tasks where title = ${lit(NAME('the doomed one'))}`,
          )
        ).n,
      ) === 0,
  )
  await syncOnce(db, vikunja, permitEverything)
  check(
    'and once the provider is back, the deletion is delivered',
    `${String((await ours()).filter((t) => String(t.id) === dExt).length)} left there`,
    (await ours()).filter((t) => String(t.id) === dExt).length === 0,
  )
  /*
    AND THE BOUNDARY, stated rather than left to be discovered.

    Once every provider has been told, the tombstone is cleared: "Grant
    deleted this" has become history and the office stops arguing about it. A
    task the provider presents AFTERWARDS — restored from its own trash, or
    typed again by a person — is a new task and is accepted.

    The alternative is matching tombstones on TITLE for ever, which is the
    fuzzy match this seam refuses everywhere else: titles normalise, collide,
    and one Grant has since edited is missed while an identical one he typed
    himself is caught. This suite asserted the stronger claim first and was
    wrong to; the cost of the real rule is that one task reappears, once.
  */
  await raw('PUT', `/projects/${String(projectId)}/tasks`, { title: NAME('the doomed one') })
  await syncOnce(db, vikunja, permitEverything)
  const readded = Number(
    (
      await one(
        `select count(*)::int as n from public.tasks where title = ${lit(NAME('the doomed one'))}`,
      )
    ).n,
  )
  check(
    'but a task the provider presents AFTERWARDS is a new one, on purpose',
    `${String(readded)} on the list here`,
    readded === 1,
  )

  // =========================================================================
  console.log('\nthe provider goes away, and the office does not')
  // =========================================================================
  const o = await add(NAME('made during the outage'))
  const r5 = await syncOnce(db, down, permitEverything)
  check(
    'a round against a dead provider reports the outage rather than throwing',
    JSON.stringify({ down: r5.down, pushed: r5.pushed }),
    r5.down !== null && r5.pushed === 0,
  )
  const survived = await one(`
    select count(*)::int as n from jsonb_array_elements(app.my_tasks('all', 200)) e
     where e ->> 'title' = ${lit(NAME('made during the outage'))}`)
  check(
    'and the task is on Grant’s list anyway — Vikunja is not a dependency',
    `${String(survived.n)} found`,
    Number(survived.n) === 1,
  )
  check(
    'nothing was marked as synced while the provider was unreachable',
    String((await here(o)).external_id ?? 'not linked'),
    String((await here(o)).external_id ?? '') === '',
  )
  const r6 = await syncOnce(db, vikunja, permitEverything)
  check(
    'and reconnecting CATCHES UP rather than reconciling from nothing',
    `pushed ${String(r6.pushed)} on the first round back`,
    r6.down === null && r6.pushed >= 1,
  )
  check(
    'the task made during the outage is now at the provider',
    `${String((await ours()).filter((t) => String(t.title ?? '') === NAME('made during the outage')).length)} there`,
    (await ours()).filter((t) => String(t.title ?? '') === NAME('made during the outage'))
      .length === 1,
  )

  // =========================================================================
  console.log('\nand it is GRANT’s to connect, not a script’s')
  // =========================================================================
  /*
    The same engine, reached the way a person reaches it: an address and a
    token he supplies, a duty that starts when he does, and a handler that is
    silent when nothing moved. CLAUDE.md's long-range rule — a capability that
    exists only as a script an agent runs is a capability Grant does not have.

    Configured and then FORGOTTEN inside this suite, because pointing the real
    office at a server that lives in this container would leave it trying every
    quarter of an hour after the container is gone.
  */
  const refused = j(
    (
      await one(`
    select app.hq_set_vikunja(${lit(token)}, 1, ${lit(token)}) as v`)
    ).v,
  )
  check(
    'CONTROL: a token pasted into the address box is refused, by class not by characters',
    String(refused.error ?? 'IT WAS ACCEPTED').slice(0, 60),
    String(refused.error ?? '').includes('credential rather than an address'),
  )
  const wired = j(
    (
      await one(`
    select app.hq_set_vikunja(${lit(url)}, ${String(projectId)}, ${lit(token)}) as v`)
    ).v,
  )
  check(
    'Grant can connect it with an address and a token, and nothing else',
    String(wired.error ?? wired.note ?? ''),
    wired.ok === true,
  )
  check(
    'and connecting it starts the duty that was waiting for it',
    String(
      (
        await one(
          `select enabled::text as v from public.responsibilities where job_kind = 'tasks.sync'`,
        )
      ).v,
    ),
    String(
      (
        await one(
          `select enabled::text as v from public.responsibilities where job_kind = 'tasks.sync'`,
        )
      ).v,
    ) === 'true',
  )
  const settings = j((await one('select app.vikunja_settings() as v')).v)
  check(
    'the settings reader says it is configured and does NOT carry the token',
    JSON.stringify(settings),
    settings.configured === true && !JSON.stringify(settings).includes(token),
  )

  const changedForDuty = await add(NAME('for the duty to find'))
  const outcome = await tasksSyncHandler(db).handle(
    {
      jobId: '00000000-0000-0000-0000-000000000000',
      kind: 'tasks.sync',
      correlationId: '00000000-0000-0000-0000-000000000000',
      projectId: null,
      idempotencyKey: `verify-vikunja-${run}`,
      attempt: 1,
    },
    db,
  )

  check(
    'the DUTY does the same round, and says what moved in a sentence',
    `${outcome.body} · announce=${String(outcome.announce)}`,
    outcome.body.includes('sent 1') && outcome.announce === true,
  )
  check(
    'and the task it found is at the provider',
    `${String((await ours()).filter((t) => String(t.title ?? '') === NAME('for the duty to find')).length)} there`,
    (await ours()).filter((t) => String(t.title ?? '') === NAME('for the duty to find')).length ===
      1,
  )
  const quiet = await tasksSyncHandler(db).handle(
    {
      jobId: '00000000-0000-0000-0000-000000000000',
      kind: 'tasks.sync',
      correlationId: '00000000-0000-0000-0000-000000000000',
      projectId: null,
      idempotencyKey: `verify-vikunja-${run}b`,
      attempt: 1,
    },
    db,
  )
  check(
    'and a tick with nothing to do says nothing at all',
    `${quiet.body} · announce=${String(quiet.announce)}`,
    quiet.announce === false,
  )
  void changedForDuty

  // =========================================================================
  console.log('\ndisconnecting it leaves the list intact — the final proof')
  // =========================================================================
  const beforeForget = Number(
    (
      await one(`
      select count(*)::int as n from public.tasks
       where title like ${lit(`fixture-vik-${run}%`)} and state <> 'done'`)
    ).n,
  )
  const forgot = j((await one('select app.hq_forget_vikunja() as v')).v)
  const afterForget = Number(
    (
      await one(`
      select count(*)::int as n from public.tasks
       where title like ${lit(`fixture-vik-${run}%`)} and state <> 'done'`)
    ).n,
  )
  check(
    'disconnecting the provider loses no native task',
    `${String(beforeForget)} before · ${String(afterForget)} after`,
    beforeForget > 0 && beforeForget === afterForget,
  )
  check(
    'and the credential goes with it, rather than being left to rot',
    JSON.stringify({
      credential: forgot.credential_removed,
      links: forgot.links_removed,
      kept: forgot.tasks_kept,
    }),
    forgot.credential_removed === true && Number(forgot.links_removed) > 0,
  )
  check(
    'and the duty stops, so the office is not calling a server it forgot',
    String(
      (
        await one(
          `select enabled::text as v from public.responsibilities where job_kind = 'tasks.sync'`,
        )
      ).v,
    ),
    String(
      (
        await one(
          `select enabled::text as v from public.responsibilities where job_kind = 'tasks.sync'`,
        )
      ).v,
    ) === 'false',
  )
  check(
    'and every link to it is gone, so nothing still claims to be in step',
    `${String((await one(`select count(*)::int as n from public.task_links where provider = ${lit(PROVIDER)}`)).n)} link(s)`,
    Number(
      (
        await one(
          `select count(*)::int as n from public.task_links where provider = ${lit(PROVIDER)}`,
        )
      ).n,
    ) === 0,
  )
  // =========================================================================
  console.log('\nand nothing else on the list moved')
  // =========================================================================
  const nowIs = await untouched()
  const moved = Object.keys(wasBefore).filter((id) => nowIs[id] !== wasBefore[id])
  check(
    'no task this run did not create was altered by any of it',
    moved.length === 0
      ? `${String(Object.keys(wasBefore).length)} unchanged`
      : `MOVED: ${moved.join(', ')}`,
    moved.length === 0,
  )
  const vanished = Object.keys(wasBefore).filter((id) => nowIs[id] === undefined)
  check(
    'and none of them disappeared',
    vanished.length === 0 ? 'all still there' : `GONE: ${vanished.join(', ')}`,
    vanished.length === 0,
  )
} catch (error) {
  failedAt = String((error as Error).message).slice(0, 300)
  console.log(`\n  the run stopped: ${failedAt}`)
} finally {
  // ==========================================================================
  console.log('\nteardown')
  // ==========================================================================
  /*
    Whatever happened above, the office must not be left pointing at a server
    that lives in this container. Run unconditionally, so a crash halfway
    through cannot leave a quarter-hourly duty calling a dead address.
  */
  await db.execute('select app.hq_forget_vikunja()').catch(() => undefined)
  await db
    .execute(`delete from public.task_links where provider = ${lit(PROVIDER)}`)
    .catch(() => undefined)
  await db
    .execute(`delete from public.tasks where title like ${lit(`fixture-vik-${run}%`)}`)
    .catch(() => undefined)
  const left = Number(
    (
      await one(
        `select count(*)::int as n from public.tasks where title like ${lit(`fixture-vik-${run}%`)}`,
      )
    ).n,
  )
  check('teardown — no task of this run is left here', `${String(left)} left`, left === 0)
  /*
    And the tombstones this run made. A tombstone is history and stays — for a
    task GRANT deleted. One this suite deleted is debris, and leaving it would
    make `task_pulled` refuse a future run's identical title for ever.
  */
  await db
    .execute(`
      delete from public.task_tombstones
       where title like ${lit(`fixture-vik-${run}%`)}`)
    .catch(() => undefined)
  await raw('DELETE', `/projects/${String(projectId)}`).catch(() => undefined)
  const gone = await raw('GET', `/projects/${String(projectId)}`)
  check(
    'teardown — and the provider project this run made is gone',
    `http ${String(gone.status)}`,
    gone.status === 404 || gone.status === 403,
  )
}

const passed = checks.filter((c) => c.ok).length
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
process.exit(passed === checks.length && failedAt === '' ? 0 : 1)
