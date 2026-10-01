/**
 * The inline SQL of the TypeScript engine is confined to an office (multi-user P3, inline SQL).
 *
 * The function conversions fixed database functions. The engine ALSO ran SQL written as strings, and each of those
 * statements read or wrote an owned table with no mention of an office. Here the REAL exported functions are called
 * against the clone, as Person A's job or office, with Person B holding rows that the old statements would have read,
 * overwritten, swept or counted:
 *
 *   google      refreshCalendar / refreshMail / recordGoogleHealth   a global key, a sweep by window, a health row
 *   notebook    enqueue / attempt / reconcile / recordProbe          a fingerprint, a sync id, a row to reconcile
 *   projects    runSync (ensureProject, upsertSource, budget,        a same-named notebook, a global exclusion, a
 *               exclusions, reconcileVanished) / brief / context     newer probe, a shared remote notebook
 *   notion      upsertDocument / registerAuthored / syncNotion       a page id another office holds
 *   jobs        lastWord                                             a pinned command that is another office's
 *   simulation  provisionWorld / assertContained / sweep / effects   the world lives in the TEST office, nowhere else
 *
 * Each section says what the old statement would have done. Nothing here reads a canary out of an error message: the
 * answers for a foreign id and a nonexistent id are compared byte for byte.
 */
import type { NotebookAdapter } from '../../../src/notebook/adapter.ts'
import { AmbiguousWriteError, type Capability } from '../../../src/notebook/adapter.ts'
import { type OfficeId, trustedOffice } from '../../../src/office/context.ts'
import { type Ctx, lit } from '../p3-app-lib.ts'

const iso = (ms: number): string => new Date(ms).toISOString()
const DAY = 86_400_000

export async function cases(c: Ctx): Promise<void> {
  const { A, B, T } = c
  const OA = trustedOffice(A)
  const OB = trustedOffice(B)
  const run = Math.random().toString(36).slice(2, 8)
  const rows = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const n = async (sql: string): Promise<number> => Number((await rows(sql))[0]?.n ?? 0)
  const norm = (s: string): string =>
    s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
  const thrown = async (f: () => Promise<unknown>): Promise<string> => {
    try {
      await f()
      return ''
    } catch (e) {
      return (e as Error).message
    }
  }
  const meterTables = [
    'calendar_events',
    'mail_messages',
    'connection_health',
    'notebook_sync_queue',
    'notebook_capability_probes',
    'sync_runs',
    'documents',
    'projects',
    'project_switches',
    'inbound_commands',
    'outputs',
    'jobs',
  ]
  const meter = (): Promise<number> =>
    n(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in (${meterTables.map(lit).join(',')})`,
    )
  const bridgeBefore = await meter()

  // ---- fixtures: a project and a job in each office, the same slug ---------------------------------------------------------------
  const slug = `rawsql-${run}`
  const proj = async (office: string, name: string): Promise<string> => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(name)}, 'paused', '${office}')`,
    )
    return String(
      (
        await rows(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`,
        )
      )[0]?.project_id,
    )
  }
  const pa = await proj(A, `Alpha ${run} ${c.canary.A}`)
  const pb = await proj(B, `Beta ${run} ${c.canary.B}`)
  const job = async (
    office: string,
    project: string | null,
    key: string,
    over: { state?: string; requestedBy?: string; pinned?: string; correlation?: string } = {},
  ): Promise<string> => {
    const failed = over.state === 'failed'
    await c.db.execute(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state, finished_at, pinned_config)
       values (gen_random_uuid(), ${over.correlation === undefined ? 'gen_random_uuid()' : `'${over.correlation}'::uuid`}, ${lit(key)}, 'probe',
               ${lit(over.requestedBy ?? 'verify:p3')}, ${project === null ? 'null' : `'${project}'`}, '${office}',
               ${lit(over.state ?? 'queued')}::public.job_state, ${failed ? 'now()' : 'null'}, ${lit(over.pinned ?? '{}')}::jsonb)`,
    )
    return String(
      (
        await rows(
          `select job_id from public.jobs where office_id = '${office}' and idempotency_key = ${lit(key)}`,
        )
      )[0]?.job_id,
    )
  }
  const ja = await job(A, pa, `rawsql-${run}-a`)
  const jb = await job(B, pb, `rawsql-${run}-b`)

  // ======================================================================================================================
  // 1. GOOGLE: the diary, the inbox and the health row. Keys that are still global must not let A touch B.
  // ======================================================================================================================
  const cfg = async (key: string): Promise<string | undefined> =>
    (await rows(`select value::text as v from public.system_config where key = ${lit(key)}`))[0]
      ?.v as string | undefined
  const prior = {
    cal: await cfg('calendar.enabled'),
    gm: await cfg('gmail.enabled'),
    cid: await cfg('google.client_id'),
  }
  const hadSecrets = await n(
    `select count(*)::int as n from vault.secrets where name in ('google.client_secret','google.refresh_token')`,
  )
  await c.db.execute(
    `update public.system_config set value = 'true'::jsonb where key in ('calendar.enabled','gmail.enabled');
     update public.system_config set value = to_jsonb('p3.apps.googleusercontent.com'::text) where key = 'google.client_id'`,
  )
  if (hadSecrets === 0) {
    await c.db.execute(
      `select app.store_secret('google.client_secret', 'p3-fake-secret', 'p3 raw sql case; removed at the end');
       select app.store_secret('google.refresh_token', 'p3-fake-refresh', 'p3 raw sql case; removed at the end')`,
    )
  }
  const restoreGoogle = async (): Promise<void> => {
    await c.db.execute(
      `update public.system_config set value = ${lit(prior.cal ?? 'false')}::jsonb where key = 'calendar.enabled';
       update public.system_config set value = ${lit(prior.gm ?? 'false')}::jsonb where key = 'gmail.enabled';
       update public.system_config set value = ${lit(prior.cid ?? '""')}::jsonb where key = 'google.client_id'`,
    )
    if (hadSecrets === 0) {
      await c.db.execute(
        `delete from vault.secrets where name in ('google.client_secret','google.refresh_token')`,
      )
    }
  }
  try {
    const { recordGoogleHealth } = await import('../../../src/google/auth.ts')
    const { refreshCalendar } = await import('../../../src/google/calendar.ts')
    const { refreshMail } = await import('../../../src/google/mail.ts')

    // -- the health row: B writes first, then A's refresh must not overwrite it -------------------------------------------------
    await c.db.execute(
      `delete from public.connection_health where service = 'google_calendar' and credential = 'oauth_client'`,
    )
    await recordGoogleHealth(c.db, { ok: false, reason: `${c.canary.B} is not connected` }, OB)
    const health = (
      await rows(
        `select office_id, owner, detail from public.connection_health where service = 'google_calendar' and credential = 'oauth_client'`,
      )
    )[0] as { office_id: string; owner: string; detail: string }
    c.check(
      health?.office_id === B && health.owner !== 'grant' && health.detail.includes(c.canary.B),
      "a health row is filed under the office that wrote it, owned by that office's actor and not by a literal",
      `office ${health?.office_id === B ? 'B' : health?.office_id} owner ${health?.owner}`,
    )

    // -- the diary --------------------------------------------------------------------------------------------------------------
    const evB1 = `p3-b1-${run}`
    const evB2 = `p3-b2-${run}`
    const evA = `p3-a-${run}`
    for (const [id, d] of [
      [evB1, 1],
      [evB2, 2],
    ] as const) {
      await c.db.execute(
        `insert into public.calendar_events (event_id, calendar_id, summary, starts_at, ends_at, office_id)
         values (${lit(id)}, 'primary', ${lit(`${c.canary.B} meeting`)}, ${lit(iso(Date.now() + d * DAY))}, ${lit(iso(Date.now() + d * DAY + 3_600_000))}, '${B}')`,
      )
    }
    const calEvent = (id: string, summary: string, d: number) => ({
      id,
      status: 'confirmed',
      summary,
      start: { dateTime: iso(Date.now() + d * DAY) },
      end: { dateTime: iso(Date.now() + d * DAY + 3_600_000) },
      updated: iso(Date.now()),
    })
    const fakeCalendar = (items: unknown[]): typeof fetch =>
      (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com')) {
          return new Response(
            JSON.stringify({
              access_token: 't',
              expires_in: 3600,
              scope: 'https://www.googleapis.com/auth/calendar.readonly',
            }),
          )
        }
        return new Response(JSON.stringify({ items }))
      }) as unknown as typeof fetch
    const calBefore = await c.snapshot(B, ['calendar_events', 'connection_health'])
    const cal = await refreshCalendar(c.db, {
      officeId: OA,
      fetchImpl: fakeCalendar([
        calEvent(evA, `${c.canary.A} planning`, 3),
        // an id that office B already holds: the global key must not let A write over it
        calEvent(evB1, `${c.canary.A} hijack`, 1),
      ]),
    })
    c.check(
      cal.ok === true && cal.stored === 2,
      "A's diary refresh runs",
      `ok ${String(cal.ok)} stored ${String(cal.stored)} ${cal.note}`,
    )
    c.check(
      (await c.snapshot(B, ['calendar_events', 'connection_health'])) === calBefore,
      "B's diary and B's health row are byte-identical after A's refresh (no overwrite by id, no sweep, no health write)",
      '',
    )
    c.check(
      (await n(
        `select count(*)::int as n from public.calendar_events where office_id = '${A}' and event_id = ${lit(evA)} and summary like ${lit(`%${c.canary.A}%`)}`,
      )) === 1 &&
        (await n(
          `select count(*)::int as n from public.calendar_events where event_id = ${lit(evB1)} and office_id = '${B}' and summary like ${lit(`%${c.canary.B}%`)}`,
        )) === 1,
      "A's event is filed under A; the event A named with B's id is still B's, with B's words",
      '',
    )
    c.check(
      (await n(
        `select count(*)::int as n from public.calendar_events where event_id = ${lit(evB2)} and office_id = '${B}'`,
      )) === 1,
      "an event of B's that A's feed does not mention is NOT swept away by A's window sweep",
      '',
    )

    // -- the inbox --------------------------------------------------------------------------------------------------------------
    const msB1 = `p3-mb1-${run}`
    const msB2 = `p3-mb2-${run}`
    const msA = `p3-ma-${run}`
    for (const id of [msB1, msB2]) {
      await c.db.execute(
        `insert into public.mail_messages (message_id, thread_id, subject, sent_at, labels, last_seen_at, office_id)
         values (${lit(id)}, ${lit(id)}, ${lit(`${c.canary.B} subject`)}, ${lit(iso(Date.now() - 3_600_000))}, '{INBOX}', ${lit(iso(Date.now()))}, '${B}')`,
      )
    }
    const message = (id: string, subject: string) => ({
      id,
      threadId: id,
      labelIds: ['INBOX'],
      snippet: `${subject} preview`,
      internalDate: String(Date.now() - 1_800_000),
      payload: {
        headers: [
          { name: 'From', value: 'Someone <someone@example.invalid>' },
          { name: 'To', value: 'me@example.invalid' },
          { name: 'Subject', value: subject },
        ],
      },
    })
    const fakeMail = (messages: ReturnType<typeof message>[]): typeof fetch =>
      (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('oauth2.googleapis.com')) {
          return new Response(
            JSON.stringify({
              access_token: 't',
              expires_in: 3600,
              scope: 'https://www.googleapis.com/auth/gmail.readonly',
            }),
          )
        }
        if (/\/messages\?/.test(url)) {
          return new Response(JSON.stringify({ messages: messages.map((m) => ({ id: m.id })) }))
        }
        const found = messages.find((m) => m.id === /\/messages\/([^?]+)/.exec(url)?.[1])
        return new Response(JSON.stringify(found ?? { error: { message: 'not found' } }))
      }) as unknown as typeof fetch
    const mailBefore = await c.snapshot(B, ['mail_messages'])
    const mail = await refreshMail(c.db, {
      officeId: OA,
      fetchImpl: fakeMail([
        message(msA, `${c.canary.A} hello`),
        message(msB1, `${c.canary.A} hijack`),
      ]),
    })
    c.check(
      mail.ok === true && mail.stored === 2,
      "A's inbox refresh runs",
      `ok ${String(mail.ok)} stored ${String(mail.stored)} ${mail.note}`,
    )
    c.check(
      (await c.snapshot(B, ['mail_messages'])) === mailBefore,
      "B's mail is byte-identical after A's refresh: not overwritten by id, and not marked vanished by A's sweep",
      '',
    )
    c.check(
      (await n(
        `select count(*)::int as n from public.mail_messages where message_id = ${lit(msA)} and office_id = '${A}' and subject like ${lit(`%${c.canary.A}%`)}`,
      )) === 1 &&
        (await n(
          `select count(*)::int as n from public.mail_messages where message_id = ${lit(msB2)} and office_id = '${B}' and vanished_at is null`,
        )) === 1,
      "A's message is filed under A; B's unmentioned message is still present (not marked vanished)",
      '',
    )
  } finally {
    await restoreGoogle()
  }

  // ======================================================================================================================
  // 2. THE NOTEBOOK QUEUE: the writes waiting for Notebook, a global fingerprint, a row to reconcile.
  // ======================================================================================================================
  const { attempt, enqueue, reconcile, recordProbe } = await import(
    '../../../src/notebook/sync-queue.ts'
  )
  const adapter = {
    addNote: async () => 'remote-note',
    addSource: async () => 'remote-source',
  } as unknown as NotebookAdapter
  const ambiguous = {
    addNote: async () => {
      throw new AmbiguousWriteError('add_note', 'f'.repeat(64))
    },
    addSource: async () => {
      throw new AmbiguousWriteError('add_source', 'f'.repeat(64))
    },
  } as unknown as NotebookAdapter
  const note = (who: string, extra = ''): Record<string, unknown> => ({
    notebook_id: `nb-${who}-${run}`,
    title: `${who} ${run} ${extra}`,
    body: `${who === 'a' ? c.canary.A : c.canary.B} body`,
  })
  const queued = async (office: OfficeId, who: string, project: string, jobId: string) =>
    enqueue(c.db, {
      office,
      operation: 'add_note',
      payload: note(who),
      projectId: project,
      jobId,
    })
  const qa = await queued(OA, 'a', pa, ja)
  const qb = await queued(OB, 'b', pb, jb)
  const qOffice = async (id: string) =>
    (await rows(`select office_id from public.notebook_sync_queue where sync_id = '${id}'`))[0]
      ?.office_id
  c.check(
    (await qOffice(qa.syncId)) === A && (await qOffice(qb.syncId)) === B,
    'each office queues its own write under its own office',
    '',
  )
  const queueBefore = await c.snapshot(B, ['notebook_sync_queue'])

  // a foreign project and a nonexistent one are refused in the same words, and nothing is written
  const foreignProject = await thrown(() =>
    enqueue(c.db, { office: OA, operation: 'add_note', payload: note('a', 'fp'), projectId: pb }),
  )
  const missingProject = await thrown(() =>
    enqueue(c.db, {
      office: OA,
      operation: 'add_note',
      payload: note('a', 'mp'),
      projectId: c.nobody(),
    }),
  )
  c.check(
    foreignProject !== '' && norm(foreignProject) === norm(missingProject),
    "a write cannot be queued against another office's project; the refusal is the one a missing project gets",
    norm(foreignProject).slice(0, 90),
  )
  const foreignJob = await thrown(() =>
    enqueue(c.db, { office: OA, operation: 'add_note', payload: note('a', 'fj'), jobId: jb }),
  )
  const missingJob = await thrown(() =>
    enqueue(c.db, {
      office: OA,
      operation: 'add_note',
      payload: note('a', 'mj'),
      jobId: c.nobody(),
    }),
  )
  c.check(
    foreignJob !== '' && norm(foreignJob) === norm(missingJob),
    "nor against another office's job, in the same words as a missing one",
    norm(foreignJob).slice(0, 90),
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.notebook_sync_queue where payload->>'title' like ${lit(`a ${run} f%`)} or payload->>'title' like ${lit(`a ${run} m%`)}`,
    )) === 0,
    'none of the refused writes left a row behind',
    '',
  )
  // identical content: the fingerprint index is global; A must not see B's row to dedupe against it
  const collide = await thrown(() =>
    enqueue(c.db, { office: OA, operation: 'add_note', payload: note('b') }),
  )
  c.check(
    collide !== '' && !collide.includes(qb.syncId),
    "content B has already queued cannot be queued by A, and the refusal does not hand A B's sync id",
    norm(collide).slice(0, 90),
  )
  // attempt / reconcile on B's row
  const noSuchB = await thrown(() => attempt(c.db, adapter, qb.syncId, OA))
  const noSuchNone = await thrown(() => attempt(c.db, adapter, c.nobody(), OA))
  c.check(
    noSuchB.includes('no such sync row') &&
      norm(noSuchB).replace(qb.syncId, '<id>') === norm(noSuchNone),
    "A cannot attempt B's queued write: it is 'no such sync row', exactly as a nonexistent id is",
    norm(noSuchB).slice(0, 90),
  )
  c.check(
    (await c.snapshot(B, ['notebook_sync_queue'])) === queueBefore,
    "B's queue is byte-identical after A's refused attempts",
    '',
  )
  c.check(
    (await attempt(c.db, adapter, qa.syncId, OA)) === 'applied' &&
      (await n(
        `select count(*)::int as n from public.notebook_sync_queue where sync_id = '${qa.syncId}' and state = 'applied'`,
      )) === 1,
    'the positive control: A attempts its own write and it is applied',
    '',
  )
  // reconcile: park one write of each office as uncertain, then A tries to reconcile B's
  const ua = await enqueue(c.db, { office: OA, operation: 'add_note', payload: note('a', 'u') })
  const ub = await enqueue(c.db, { office: OB, operation: 'add_note', payload: note('b', 'u') })
  const uncertain = async (id: string, office: OfficeId) => attempt(c.db, ambiguous, id, office)
  c.check(
    (await uncertain(ua.syncId, OA)) === 'uncertain' &&
      (await uncertain(ub.syncId, OB)) === 'uncertain',
    'both offices have a write parked as uncertain',
    '',
  )
  const parkedBefore = await c.snapshot(B, ['notebook_sync_queue'])
  await reconcile(c.db, ub.syncId, null, OA)
  c.check(
    (await c.snapshot(B, ['notebook_sync_queue'])) === parkedBefore,
    "A cannot reconcile B's uncertain write: it stays uncertain, byte for byte",
    '',
  )
  await reconcile(c.db, ua.syncId, null, OA)
  c.check(
    (await n(
      `select count(*)::int as n from public.notebook_sync_queue where sync_id = '${ua.syncId}' and state = 'pending'`,
    )) === 1,
    'the positive control: A reconciles its own uncertain write back to pending',
    '',
  )
  // capability probes
  const cap = (extra: Partial<Capability> = {}): Capability => ({
    state: 'available',
    capabilities: ['list_notebooks'],
    adapter: 'p3-fake',
    adapterVersion: null,
    detectedTier: 1,
    notebookLimit: 100,
    sourceLimit: 50,
    detail: 'p3 raw sql case',
    latencyMs: 1,
    ...extra,
  })
  const probesB = await c.snapshot(B, ['notebook_capability_probes'])
  await recordProbe(c.db, cap({ detail: `${run} probe for A` }), OA)
  c.check(
    (await n(
      `select count(*)::int as n from public.notebook_capability_probes where office_id = '${A}' and detail = ${lit(`${run} probe for A`)}`,
    )) === 1 && (await c.snapshot(B, ['notebook_capability_probes'])) === probesB,
    "a probe is filed under the office it was run for, and B's probes are untouched",
    '',
  )

  // ======================================================================================================================
  // 3. THE NOTEBOOK DISCOVERY CYCLE (runSync). B holds a project for the SAME remote notebook, has excluded it, has a
  //    newer probe, and holds a source of the shared notebook that A's listing does not mention.
  // ======================================================================================================================
  const { runSync } = await import('../../../src/projects/sync.ts')
  const NB = `p3-notebook-${run}`
  await recordProbe(c.db, cap({ detail: `${run} sync probe A` }), OA)
  await recordProbe(c.db, cap({ detail: `${run} sync probe B` }), OB) // B's is the NEWEST probe in the deployment
  await c.db.execute(
    `insert into public.projects (slug, name, status, notebook_ref, office_id)
     values (${lit(`nb-b-${run}`)}, ${lit(`Beta notebook ${run}`)}, 'paused', ${lit(NB)}, '${B}');
     insert into public.notebook_exclusions (remote_notebook_id, reason, office_id)
     values (${lit(NB)}, 'p3 case: office B does not want this notebook', '${B}')`,
  )
  const projB = String(
    (
      await rows(
        `select project_id from public.projects where office_id = '${B}' and notebook_ref = ${lit(NB)}`,
      )
    )[0]?.project_id,
  )
  const sha = async (s: string): Promise<string> => {
    const { createHash } = await import('node:crypto')
    return createHash('sha256').update(s).digest('hex')
  }
  // B's own source of the shared notebook: same parent, a source id A's listing never names
  const bContent = `${c.canary.B} the content of the source B holds`
  await c.db.execute(
    `insert into public.documents (project_id, connector, external_parent_ref, external_ref, title, content, content_fingerprint, content_chars, fetched_at, office_id)
     values ('${projB}', 'notebooklm', ${lit(NB)}, ${lit(`b-only-${run}`)}, 'B source', ${lit(bContent)}, '${await sha(bContent)}', ${String(bContent.length)}, now(), '${B}')`,
  )
  const syncBefore = await c.snapshot(B, [
    'projects',
    'notebook_exclusions',
    'sync_runs',
    'notebook_capability_probes',
  ])
  const budgetsBefore = await n(`select count(*)::int as n from public.notebook_budgets`)
  const aContent = `${c.canary.A} the content of the source A holds`
  class Listing implements NotebookAdapter {
    async probe(): Promise<Capability> {
      return cap()
    }
    async listSources() {
      return [
        {
          remoteNotebookId: NB,
          remoteSourceId: `a-only-${run}`,
          title: 'A source',
          content: aContent,
          remoteUpdatedAt: null,
        },
      ]
    }
    async fetchSourceText(): Promise<never> {
      throw new Error('not used')
    }
    async addSource(): Promise<string> {
      throw new Error('not used')
    }
    async addNote(): Promise<string> {
      throw new Error('not used')
    }
  }
  await c.db.execute(
    `update public.sync_runs set state = 'abandoned', finished_at = now(), leased_by = null, leased_until = null where state = 'running'`,
  )
  const runBefore = await n(
    `select count(*)::int as n from public.sync_runs where office_id = '${A}' and state = 'complete'`,
  )
  const cycle = await runSync({
    db: c.db,
    adapter: new Listing(),
    listNotebooks: async () => [{ id: NB, title: `Alpha notebook ${run}` }],
    workerId: `p3-${run}`,
    officeId: OA,
  })
  c.check(
    cycle.state === 'complete' && cycle.sourcesAdded === 1,
    "A's discovery cycle completes and adds its source",
    `${cycle.state} added ${String(cycle.sourcesAdded)} ${cycle.detail}`,
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.projects where office_id = '${A}' and notebook_ref = ${lit(NB)}`,
    )) === 1 &&
      (await n(
        `select count(*)::int as n from public.documents d join public.projects p on p.project_id = d.project_id where p.office_id = '${A}' and p.notebook_ref = ${lit(NB)} and d.office_id = '${A}' and d.external_ref = ${lit(`a-only-${run}`)}`,
      )) === 1,
    "A gets its OWN project for a notebook B already holds a project for, and the source is cached under it (the old lookup found B's project by notebook ref alone)",
    '',
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.documents where project_id = '${projB}' and external_ref = ${lit(`a-only-${run}`)}`,
    )) === 0,
    "no source of A's lands in B's project",
    '',
  )
  c.check(
    (await c.snapshot(B, [
      'projects',
      'notebook_exclusions',
      'sync_runs',
      'notebook_capability_probes',
    ])) === syncBefore,
    "B's projects, exclusions, runs and probes are byte-identical after A's cycle",
    '',
  )
  // The shared notebook's source that only B holds must be neither marked nor archived by A's cycle.
  const bDoc = (
    await rows(
      `select missing_since, state from public.documents where external_ref = ${lit(`b-only-${run}`)}`,
    )
  )[0] as { missing_since: string | null; state: string | null }
  c.check(
    bDoc?.missing_since === null && bDoc?.state !== 'archived',
    "A's cycle does not mark B's source of the shared notebook as missing (the reconciler used to match the parent notebook alone)",
    `missing_since ${String(bDoc?.missing_since)} state ${String(bDoc?.state)}`,
  )
  const second = await runSync({
    db: c.db,
    adapter: new Listing(),
    listNotebooks: async () => [{ id: NB, title: `Alpha notebook ${run}` }],
    workerId: `p3-${run}-2`,
    officeId: OA,
  })
  const bDoc2 = (
    await rows(
      `select missing_since, state from public.documents where external_ref = ${lit(`b-only-${run}`)}`,
    )
  )[0] as { missing_since: string | null; state: string | null }
  c.check(
    second.state === 'complete' && bDoc2?.missing_since === null && bDoc2?.state !== 'archived',
    'and a second cycle (the second strike) does not archive it either',
    `missing_since ${String(bDoc2?.missing_since)} state ${String(bDoc2?.state)}`,
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.notebook_exclusions where remote_notebook_id = ${lit(NB)} and office_id = '${B}'`,
    )) === 1,
    "B's exclusion is B's own: it neither hid the notebook from A nor was touched",
    '',
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.sync_runs where office_id = '${A}' and state = 'complete'`,
    )) ===
      runBefore + 2,
    "A's two cycles are recorded under A, and settled",
    '',
  )
  const budgetProbe = (
    await rows(
      `select pr.office_id from public.notebook_budgets b join public.notebook_capability_probes pr on pr.probe_id = b.probe_id order by b.computed_at desc limit 1`,
    )
  )[0]?.office_id
  c.check(
    (await n(`select count(*)::int as n from public.notebook_budgets`)) > budgetsBefore &&
      budgetProbe === A,
    "A's budget is derived from A's own probe, not from the newest probe in the deployment (which is B's)",
    `latest budget's probe office ${budgetProbe === A ? 'A' : budgetProbe === B ? 'B' : String(budgetProbe)}`,
  )

  // ======================================================================================================================
  // 4. NOTION: a page id that another office already holds.
  // ======================================================================================================================
  const { registerAuthored, syncNotion, upsertDocument } = await import(
    '../../../src/notion/sync.ts'
  )
  const page = `p3-page-${run}`
  const notionBContent = `${c.canary.B} Notion page B holds`
  await c.db.execute(
    `insert into public.documents (project_id, connector, external_parent_ref, external_ref, title, content, content_fingerprint, content_chars, fetched_at, office_id)
     values ('${pb}', 'notion', 'page', ${lit(page)}, 'B page', ${lit(notionBContent)}, '${await sha(notionBContent)}', ${String(notionBContent.length)}, now(), '${B}')`,
  )
  const notionBefore = await c.snapshot(B, ['documents'])
  const object = {
    id: page,
    object: 'page' as const,
    title: 'A takes the same page',
    lastEdited: null,
    url: null,
  }
  const refusedUpsert = await thrown(() =>
    upsertDocument(c.db, pa, object, `${c.canary.A} A's words`),
  )
  c.check(
    refusedUpsert.includes('already in use') &&
      !refusedUpsert.includes(B) &&
      !refusedUpsert.includes(c.canary.B),
    'A cannot overwrite or move a Notion page B holds; the pass is told, in words that name no office',
    refusedUpsert.slice(0, 90),
  )
  const refusedAuthored = await thrown(() =>
    registerAuthored(c.db, pa, { id: page, title: 'A authored' }, `${c.canary.A} body`, 'p3'),
  )
  c.check(
    refusedAuthored.includes('already in use'),
    'nor can A record a page of its own over it',
    refusedAuthored.slice(0, 90),
  )
  c.check(
    (await c.snapshot(B, ['documents'])) === notionBefore,
    "B's documents are byte-identical after both refusals",
    '',
  )
  const stub = {
    async *paginate(endpoint: string): AsyncGenerator<Record<string, unknown>> {
      if (endpoint === '/search') {
        yield { id: page, object: 'page', properties: {} }
        yield { id: `${page}-own`, object: 'page', properties: {} }
        return
      }
      if (endpoint.startsWith('/blocks/')) {
        yield {
          id: `${run}-blk`,
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: `${c.canary.A} text` }] },
        }
      }
    },
  } as unknown as Parameters<typeof syncNotion>[2]
  const synced = await syncNotion(c.db, { officeId: OA }, stub, pa)
  c.check(
    synced.added === 1 &&
      synced.skipped.length === 1 &&
      !synced.skipped.join(' ').includes(c.canary.B),
    "syncNotion files A's own page, and lists the page B holds as skipped",
    `added ${String(synced.added)} skipped ${synced.skipped.join('; ')}`,
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.documents where office_id = '${A}' and external_ref = ${lit(`${page}-own`)} and project_id = '${pa}'`,
    )) === 1 && (await c.snapshot(B, ['documents'])) === notionBefore,
    "A's page is under A's project; B's page is unchanged",
    '',
  )
  const changedAgain = await upsertDocument(
    c.db,
    pa,
    { ...object, id: `${page}-own` },
    `${c.canary.A} edited`,
  )
  c.check(
    changedAgain === 'changed',
    "the positive control: A edits its own page and it is 'changed'",
    changedAgain,
  )

  // ======================================================================================================================
  // 5. BRIEFS AND PROJECT CONTEXT.
  // ======================================================================================================================
  const { briefIsStale, cachedSources, generateBrief, NoSourcesError } = await import(
    '../../../src/projects/brief.ts'
  )
  const { matchProject, switchTo } = await import('../../../src/projects/context.ts')
  const contentB = `${c.canary.B} what project B's sources say, long enough to be a source`
  const fpB = await sha(contentB)
  await c.db.execute(
    `insert into public.documents (project_id, connector, external_parent_ref, external_ref, title, content, content_fingerprint, content_chars, fetched_at, office_id)
     values ('${pb}', 'upload', null, null, 'B upload', ${lit(contentB)}, '${fpB}', ${String(contentB.length)}, now(), '${B}')`,
  )
  const foreignSources = await cachedSources(c.db, OA, pb)
  const nobodySources = await cachedSources(c.db, OA, c.nobody())
  c.check(
    foreignSources.length === 0 && c.json(foreignSources) === c.json(nobodySources),
    "A reads no cached sources of B's project, and the answer is the one a nonexistent project gets",
    '',
  )
  const ownSources = await cachedSources(c.db, OB, pb)
  c.check(
    ownSources.some((s) => s.excerpt.includes(c.canary.B)),
    'the positive control: B reads its own source',
    `${String(ownSources.length)} source(s)`,
  )
  await c.db.execute(
    `insert into public.project_briefs (project_id, body, sources_used, source_fingerprints, model, confidence)
     values ('${pb}', ${lit(`${c.canary.B} an existing brief of B that is comfortably over fifty characters long`)}, 1, array[${lit(fpB)}], 'p3', 'inferred')`,
  )
  c.check(
    (await briefIsStale(c.db, OA, pb, [fpB])) ===
      (await briefIsStale(c.db, OA, c.nobody(), [fpB])) &&
      (await briefIsStale(c.db, OA, pb, [fpB])) === true &&
      (await briefIsStale(c.db, OB, pb, [fpB])) === false,
    "A is told nothing about B's brief (stale, as for a missing project); B's own brief is current",
    '',
  )
  let routed = 0
  const router = {
    complete: async () => {
      routed += 1
      return { content: `${'A brief written by the stub model. '.repeat(4)}`, model: 'stub' }
    },
  } as unknown as Parameters<typeof generateBrief>[1]
  const foreignBrief = await thrown(() => generateBrief(c.db, router, OA, pb, { force: true }))
  const missingBrief = await thrown(() =>
    generateBrief(c.db, router, OA, c.nobody(), { force: true }),
  )
  c.check(
    foreignBrief.includes('has no cached sources') &&
      norm(foreignBrief).replace(pb, '<id>') === norm(missingBrief) &&
      routed === 0,
    "A cannot brief B's project: the refusal is the missing-project one and no model was spent",
    norm(foreignBrief).slice(0, 80),
  )
  void NoSourcesError
  const briefsOfB = await n(
    `select count(*)::int as n from public.project_briefs where project_id = '${pb}'`,
  )
  const made = await generateBrief(c.db, router, OB, pb, { force: true })
  c.check(
    made.skipped === null &&
      (await n(
        `select count(*)::int as n from public.project_briefs where project_id = '${pb}'`,
      )) ===
        briefsOfB + 1 &&
      routed === 1,
    'the positive control: B briefs its own project',
    '',
  )
  // matching and switching only reach ACTIVE projects, which must hold an attachment: project and attachment in one go
  const active = async (office: string, name: string): Promise<string> => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${lit(`act-${run}`)}, ${lit(name)}, 'active', '${office}');
       insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
       select project_id, 'upload', ${lit(`act-${run}-source`)}, 'uploads', 'source', true
         from public.projects where office_id = '${office}' and slug = ${lit(`act-${run}`)}`,
    )
    return String(
      (
        await rows(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(`act-${run}`)}`,
        )
      )[0]?.project_id,
    )
  }
  const nameA = `Quillfeather ${run} ${c.canary.A}`
  const nameB = `Thistledown ${run} ${c.canary.B}`
  const actA = await active(A, nameA)
  const actB = await active(B, nameB)
  const seenByA = await matchProject(c.db, OA, nameB)
  const none = await matchProject(c.db, OA, `Nothing called this ${run}`)
  c.check(
    (await matchProject(c.db, OB, nameB)).kind === 'matched',
    "the control: the name matches in B's own office, so the refusal below is the office's doing",
    '',
  )
  c.check(
    seenByA.kind === 'not_found' &&
      none.kind === 'not_found' &&
      !JSON.stringify(seenByA).includes(B),
    "a name spoken in A's office never matches B's project",
    seenByA.kind,
  )
  const own = await matchProject(c.db, OA, nameA)
  c.check(
    own.kind === 'matched' && own.project.projectId === actA,
    "the positive control: A's own name matches A's project",
    own.kind,
  )
  const switchesB = await c.snapshot(B, ['project_switches'])
  const sw = (ref: string) => ({ kind: 'telegram_chat' as const, ref })
  const foreignSwitch = await thrown(() =>
    switchTo(c.db, OA, sw(`chat-${run}`), actB, 'p3', 'a foreign project'),
  )
  const missingSwitch = await thrown(() =>
    switchTo(c.db, OA, sw(`chat-${run}`), c.nobody(), 'p3', 'a missing project'),
  )
  c.check(
    foreignSwitch === 'no_such_project' && foreignSwitch === missingSwitch,
    "A cannot point a chat at B's project; the refusal is the one a missing project gets",
    foreignSwitch,
  )
  c.check(
    (await c.snapshot(B, ['project_switches'])) === switchesB,
    "B's switch log is unchanged",
    '',
  )
  const okSwitch = await switchTo(c.db, OA, sw(`chat-${run}`), actA, 'p3', 'its own project')
  c.check(
    (await n(
      `select count(*)::int as n from public.project_switches where switch_id = '${okSwitch}' and office_id = '${A}' and project_id = '${actA}'`,
    )) === 1,
    'the positive control: A switches to its own project',
    '',
  )

  // ======================================================================================================================
  // 6. THE LAST WORD: a failed job whose pinned command is ANOTHER office's. The old join took the command by its id
  //    alone and read B's voice note as A's.
  // ======================================================================================================================
  const { lastWord } = await import('../../../src/jobs/lastword.ts')
  const command = async (office: string, who: string, voice: boolean): Promise<string> => {
    await c.db.execute(
      `insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, voice_file_id, synthetic, office_id)
       values ('teamhq', ${lit(`chat-${who}-${run}:1`)}, ${lit(`verify-p3-${who}`)}, ${lit(voice ? '' : 'hello')}, ${lit(`verify:rawsql:${who}-${run}`)}, now(), ${voice ? lit(`voice-${who}`) : 'null'}, true, '${office}')`,
    )
    return String(
      (
        await rows(
          `select command_id from public.inbound_commands where dedupe_key = ${lit(`verify:rawsql:${who}-${run}`)}`,
        )
      )[0]?.command_id,
    )
  }
  const cmdB = await command(B, 'b', true)
  const cmdAVoice = await command(A, 'av', true)
  const sayings: string[] = []
  const notify = (async (_j: unknown, output: { body: string }) => {
    sayings.push(output.body)
    return { note: 'ok' }
  }) as unknown as Parameters<typeof lastWord>[2]
  const failedJob = async (key: string, cmd: string) => {
    const id = await job(A, pa, key, {
      state: 'failed',
      pinned: JSON.stringify({ command_id: cmd }),
    })
    return {
      jobId: id,
      kind: 'probe',
      correlationId: id,
      projectId: pa,
      idempotencyKey: key,
      attempt: 0,
    }
  }
  const outputsB = await c.snapshot(B, ['inbound_commands'])
  const pointed = await failedJob(`rawsql-${run}-lw1`, cmdB)
  const o1 = await lastWord(c.db, pointed, notify)
  const ownJob = await failedJob(`rawsql-${run}-lw2`, cmdAVoice)
  const o2 = await lastWord(c.db, ownJob, notify)
  c.check(
    o1 === 'told' && o2 === 'told' && sayings.length === 2,
    'both failed turns are answered',
    `${o1}/${o2} ${String(sayings.length)}`,
  )
  c.check(
    sayings[0]?.includes('what you asked me') === true,
    "a turn that points at B's voice note is NOT told it was spoken (B's command is not A's to read)",
    String(sayings[0]).slice(0, 60),
  )
  c.check(
    sayings[1]?.includes('what you sent me') === true,
    "the positive control: A's own voice note is recognised as spoken",
    String(sayings[1]).slice(0, 60),
  )
  c.check(
    (await c.snapshot(B, ['inbound_commands'])) === outputsB,
    "B's commands are unchanged",
    '',
  )

  // ======================================================================================================================
  // 7. THE SIMULATION: harness traffic belongs to the TEST office, said out loud.
  // ======================================================================================================================
  const { assertContained, provisionWorld, sweepHarnessWork, WORLD_PREFIX } = await import(
    '../../../src/simulation/provision.ts'
  )
  const { readEffects } = await import('../../../src/simulation/effects.ts')
  const worldBefore = await n(
    `select count(*)::int as n from public.projects where slug like ${lit(`${WORLD_PREFIX}%`)}`,
  )
  void worldBefore
  const person = { A: await c.snapshot(A, ['projects']), B: await c.snapshot(B, ['projects']) }
  const report = await provisionWorld(c.db)
  c.check(
    report.projects > 0 && report.created.length + report.already.length > 0,
    'the simulated world is provisioned',
    `${String(report.projects)} projects`,
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.projects where slug like ${lit(`${WORLD_PREFIX}%`)} and office_id <> '${T}'`,
    )) === 0 &&
      (await n(
        `select count(*)::int as n from public.projects where slug like ${lit(`${WORLD_PREFIX}%`)} and office_id = '${T}'`,
      )) === report.projects,
    'every world project is in the TEST office, none in a person office',
    '',
  )
  c.check(
    (await c.snapshot(A, ['projects'])) === person.A &&
      (await c.snapshot(B, ['projects'])) === person.B,
    "provisioning left A's and B's projects byte-identical",
    '',
  )
  const again = await provisionWorld(c.db)
  c.check(
    again.created.length === 0 && again.projects === report.projects,
    'provisioning twice is idempotent in the test office',
    '',
  )
  const problems = await assertContained(c.db).catch((e: Error) => [`threw: ${e.message}`])
  c.check(
    !problems.some((p) => p.includes('OUTSIDE the test office')),
    'the containment assertion finds no world project outside the test office',
    problems.join('; ').slice(0, 120),
  )
  // the leak detector can FAIL: plant a world-named project in A
  const leakSlug = `${WORLD_PREFIX}leak-${run}`
  await c.db.execute(
    `insert into public.projects (slug, name, status, office_id) values (${lit(leakSlug)}, 'simgrant leak', 'paused', '${A}')`,
  )
  const leaked = await assertContained(c.db).catch((e: Error) => [`threw: ${e.message}`])
  await c.db.execute(
    `delete from public.projects where slug = ${lit(leakSlug)} and office_id = '${A}'`,
  )
  c.check(
    leaked.some((p) => p.includes('OUTSIDE the test office')),
    'the control: a world project planted in a person office IS reported',
    leaked.join('; ').slice(0, 120),
  )
  // the sweep takes back the test office's work and only that
  const token = `teamhq:verify-shadow-p3${run}`
  const jt = await job(T, null, `rawsql-${run}-t`, { requestedBy: `${token}-t` })
  const jaSweep = await job(A, pa, `rawsql-${run}-sweepA`, { requestedBy: `${token}-a` })
  const jbSweep = await job(B, pb, `rawsql-${run}-sweepB`, { requestedBy: `${token}-b` })
  for (const [office, id] of [
    [T, jt],
    [A, jaSweep],
    [B, jbSweep],
  ] as const) {
    await c.db.execute(
      `insert into public.tasks (title, added_by, job_id, office_id) values (${lit(`task ${run}`)}, 'verify:p3', '${id}', '${office}')`,
    )
  }
  const sweepB = await c.snapshot(B, ['tasks', 'suggestions'])
  const tasksA = await c.snapshot(A, ['tasks'])
  for (const [office, id] of [
    [T, jt],
    [A, jaSweep],
  ] as const) {
    await c.db.execute(
      `insert into public.suggestions (kind, subject_ref, body, because, offer_args, office_id) values ('standing_rule', ${lit(`${run}-${office}`)}, ${lit(`offer ${run}`)}, '{}'::jsonb, ${lit(JSON.stringify({ from_job: id }))}::jsonb, '${office}')`,
    )
  }
  const swept = await sweepHarnessWork(c.db, `${token}-%`)
  c.check(
    swept.tasksBefore === 1 && swept.tasksAfter === 0,
    "the sweep takes back the TEST office's task",
    `${String(swept.tasksBefore)} -> ${String(swept.tasksAfter)}`,
  )
  c.check(
    (await c.snapshot(A, ['tasks'])) === tasksA &&
      (await c.snapshot(B, ['tasks', 'suggestions'])) === sweepB,
    "and leaves A's task (a job with the same requested_by) and B's tasks and suggestions byte-identical",
    '',
  )
  c.check(
    (await n(
      `select count(*)::int as n from public.suggestions where office_id = '${A}' and body = ${lit(`offer ${run}`)}`,
    )) === 1 &&
      (await n(
        `select count(*)::int as n from public.suggestions where office_id = '${T}' and body = ${lit(`offer ${run}`)}`,
      )) === 0,
    "the harness-offer sweep removes the test office's offer and A's remains",
    '',
  )
  // readEffects: a correlation id shared with B's job must not pull B's family into A's counts
  const corr = crypto.randomUUID()
  const ea = await job(A, pa, `rawsql-${run}-ea`, { correlation: corr })
  const eb = await job(B, pb, `rawsql-${run}-eb`, { correlation: corr })
  await c.db.execute(
    `insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
     values ('${eb}', ${lit(`${c.canary.B} output`)}, 'high', 'inferred', '[]'::jsonb, false)`,
  )
  const effects = await readEffects(c.db, ea, iso(Date.now() - 3_600_000))
  c.check(
    effects.jobs === 1 && effects.outputs === 0,
    "an A turn's effects do not include B's job that shares its correlation id",
    `jobs ${String(effects.jobs)} outputs ${String(effects.outputs)}`,
  )
  // the live shadow door cannot be driven (it needs a running worker): assert the PROPERTY on the statement itself
  const { readFile } = await import('node:fs/promises')
  const canonical = await readFile(
    new URL('../../../src/simulation/canonical.ts', import.meta.url),
    'utf8',
  )
  const insertAt = canonical.indexOf('insert into public.inbound_commands')
  const insertEnd = canonical.indexOf('on conflict (dedupe_key)', insertAt)
  const stmt = canonical.slice(insertAt, insertEnd)
  c.check(
    insertAt > 0 &&
      insertEnd > insertAt &&
      /office_id/.test(stmt) &&
      /app\.test_office\(\)/.test(stmt),
    'the shadow door files its command under the TEST office explicitly (source property: could not be driven without a live worker)',
    '',
  )
  // The poll holds announce = false across the correlation family, and reads whether the family has settled. Both
  // reach jobs by correlation id, which is not an office boundary: each statement must carry the turn's office.
  const holdAt = canonical.indexOf('update public.jobs set announce = false\n')
  const holdEnd = canonical.indexOf(';', holdAt)
  const hold = canonical.slice(holdAt, holdEnd)
  const familyAt = canonical.indexOf('from public.jobs k')
  const familyEnd = canonical.indexOf('as family_settled', familyAt)
  const family = canonical.slice(familyAt, familyEnd)
  c.check(
    holdAt > 0 &&
      /office_id\s*=\s*app\.job_office\(/.test(hold) &&
      familyAt > 0 &&
      /k\.office_id\s*=\s*j\.office_id/.test(family),
    "the shadow door's poll keeps its announce hold and its settled-family read inside the turn's office (source property)",
    '',
  )

  // ======================================================================================================================
  // 8. NOTHING RELIED ON THE BRIDGE
  // ======================================================================================================================
  const bridgeAfter = await meter()
  c.check(
    bridgeAfter === bridgeBefore,
    'none of these writers leaned on the compatibility bridge: the meter did not move',
    `${String(bridgeBefore)} -> ${String(bridgeAfter)}`,
  )
}
