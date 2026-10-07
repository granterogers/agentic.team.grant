/**
 * Project calendars (migration 0906, written as 0897) - every function driven with real rows, on a LOCAL replica only.
 *
 *   npx tsx scripts/isolated/project-calendar.ts <replica-db>      (default: cand_cal)
 *
 * "A migration that applies cleanly is not a function that works." This drives the reader, the five writers, the sync
 * helpers and the real handler (with Google replaced by a recording fake) against a marked local replica, inside ONE
 * transaction that is rolled back at the end, so nothing is left behind. It refuses to run anywhere that is not a marked
 * replica on a Unix socket (`isolated()`), and it never touches a network: Google is a function in this file.
 *
 * Each negative control asserts the REASON it was refused, never merely that something was.
 */
import { calendarEventsHandler } from '../../src/handlers/calendar-events.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_cal')
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null): string => (v === null ? 'null' : lit(v))
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const J = (x: unknown): Record<string, unknown> =>
  (typeof x === 'string' ? JSON.parse(x) : x) as Record<string, unknown>
const run = Date.now().toString(36)

await db.execute('begin')
try {
  const A = String(
    (
      await one(
        `select office_id::text o from public.offices where kind = 'person' order by created_at limit 1`,
      )
    ).o,
  )
  const B = String((await one(`select app.test_office()::text o`)).o)
  check('two different offices', A !== B)

  const project = async (office: string, slug: string, status = 'active'): Promise<string> =>
    String(
      (
        await one(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(`Name ${slug}`)}, ${lit(status)}, ${lit(office)}::uuid) returning project_id::text id`,
        )
      ).id,
    )
  const alpha = `cal-${run}-alpha`
  const beta = `cal-${run}-beta`
  const fix = `fixture-cal-${run}`
  const arch = `cal-${run}-arch`
  const foreign = `cal-${run}-foreign`
  const PA = await project(A, alpha)
  await project(A, beta)
  await project(A, fix)
  await project(A, arch)
  await project(B, foreign)
  await db.execute(
    `update public.projects set status = 'archived' where slug = ${lit(arch)} and office_id = ${lit(A)}::uuid`,
  )

  const rpc = async (fn: string, args: string): Promise<Record<string, unknown>> =>
    J((await one(`select app.${fn}(${args}) as r`)).r)
  const add = (
    office: string,
    slug: string,
    title: string,
    starts: string,
    rest = "null, false, null, null, 'teamhq'",
  ): Promise<Record<string, unknown>> =>
    rpc(
      'hq_event_add',
      `${lit(office)}::uuid, ${lit(slug)}, ${lit(title)}, ${lit(starts)}::timestamptz, ${rest}`,
    )
  const read = async (
    office: string,
    slug: string | null,
    scope: string,
    from = '2026-10-01',
    to = '2026-11-30',
  ): Promise<Record<string, unknown>[]> => {
    const r = await rpc(
      'hq_project_events',
      `${lit(office)}::uuid, ${nul(slug)}, ${lit(from)}, ${lit(to)}, ${lit(scope)}`,
    )
    return (r.events ?? []) as Record<string, unknown>[]
  }
  const titles = (es: Record<string, unknown>[]): string[] => es.map((e) => String(e.title)).sort()
  const refusal = async (sql: string): Promise<string> => {
    await db.execute('savepoint s1')
    try {
      await db.execute(sql)
      await db.execute('release savepoint s1')
      return ''
    } catch (e) {
      await db.execute('rollback to savepoint s1')
      return String((e as Error).message)
    }
  }

  // ---- adding: validation, each refusal says why --------------------------------------------------------------
  const e1 = await add(A, alpha, 'Site walk', '2026-10-12T09:00:00Z')
  check(
    'a timed event is added, ending an hour later by default',
    e1.ok === true && String(e1.ends_at).startsWith('2026-10-12T10:00:00'),
    JSON.stringify(e1),
  )
  check('with Google not connected it stays local', e1.sync === 'local', String(e1.sync))
  const e2 = await add(
    A,
    alpha,
    'Retreat',
    '2026-10-20T15:30:00Z',
    `null, true, 'bring boots', 'Lake House', 'chatgpt'`,
  )
  check(
    'an all-day event is normalised to whole UTC days, exclusive end',
    e2.ok === true &&
      String(e2.starts_at).startsWith('2026-10-20T00:00:00') &&
      String(e2.ends_at).startsWith('2026-10-21T00:00:00'),
    JSON.stringify(e2),
  )
  check(
    'an empty title is refused, saying so',
    String((await add(A, alpha, '   ', '2026-10-12T09:00:00Z')).error).includes('title'),
  )
  check(
    'an end before the start is refused, saying so',
    String(
      (
        await add(
          A,
          alpha,
          'x',
          '2026-10-12T09:00:00Z',
          `'2026-10-12T08:00:00Z', false, null, null, 'teamhq'`,
        )
      ).error,
    ).includes('ends before it starts'),
  )
  check(
    'an all-day event that ends before it starts is refused',
    String(
      (
        await add(
          A,
          alpha,
          'x',
          '2026-10-12T09:00:00Z',
          `'2026-10-11T09:00:00Z', true, null, null, 'teamhq'`,
        )
      ).error,
    ).includes('must end after'),
  )
  check(
    'a channel with a space is refused, saying so',
    String(
      (await add(A, alpha, 'x', '2026-10-12T09:00:00Z', `null, false, null, null, 'Tele gram'`))
        .error,
    ).includes('channel name'),
  )
  check(
    'an unknown project is refused',
    String((await add(A, 'no-such', 'x', '2026-10-12T09:00:00Z')).error).includes(
      'no active project',
    ),
  )
  check(
    'an archived project takes no new event',
    String((await add(A, arch, 'x', '2026-10-12T09:00:00Z')).error).includes('no active project'),
  )
  check(
    "another office's project is the same sentence as a missing one",
    String((await add(A, foreign, 'x', '2026-10-12T09:00:00Z')).error).includes(
      'no active project',
    ),
  )
  const refused = await refusal(
    `select app.hq_event_add(${lit('00000000-0000-0000-0000-000000000000')}::uuid, ${lit(alpha)}, 'x', now())`,
  )
  check(
    'no office is refused outright (no_office), never defaulted',
    refused.includes('no_office'),
    refused,
  )
  check(
    'an authority that is not person or agent is refused',
    String(
      (
        await rpc(
          'hq_event_add',
          `${lit(A)}::uuid, ${lit(alpha)}, 'x', now(), null, false, null, null, 'teamhq', 'root'`,
        )
      ).error,
    ).includes('authority'),
  )

  // ---- Google connects: new events are pending, and local ones are promoted ---------------------------------------
  await db.execute(`insert into public.connection_health (service, credential, state, detail, owner, office_id)
    values ('google_calendar', 'oauth_client', 'ok', 'connected', 'x', ${lit(A)}::uuid)
    on conflict (office_id, service, credential) do update set state = 'ok'`)
  const e3 = await add(A, alpha, 'Kickoff call', '2026-10-13T14:00:00Z')
  check('with Google connected a new event is pending', e3.sync === 'pending', String(e3.sync))
  const promoted = Number(
    (await one(`select app.project_events_promote_local(${lit(A)}::uuid) as n`)).n,
  )
  check(
    'the events made before it connected are promoted to pending',
    promoted === 2,
    String(promoted),
  )
  const betaEvent = await add(A, beta, 'Beta review', '2026-10-14T10:00:00Z')
  await add(A, fix, 'Fixture meeting', '2026-10-14T11:00:00Z')
  await add(B, foreign, 'Other office event', '2026-10-14T12:00:00Z')

  // ---- the three scopes ---------------------------------------------------------------------------------------
  const cache = async (
    office: string,
    id: string,
    summary: string,
    starts: string,
    status = 'confirmed',
    cal = 'primary',
  ): Promise<void> => {
    await db.execute(`insert into public.calendar_events (event_id, calendar_id, summary, starts_at, ends_at, status, html_link, remote_updated_at, office_id)
      values (${lit(id)}, ${lit(cal)}, ${lit(summary)}, ${lit(starts)}::timestamptz, ${lit(starts)}::timestamptz + interval '1 hour', ${lit(status)}, ${lit(`https://calendar.google.com/${id}`)}, now(), ${lit(office)}::uuid)`)
  }
  await cache(A, `ga-${run}`, 'Dentist (unassigned)', '2026-10-15T08:00:00Z')
  await cache(A, `gb-${run}`, 'Board meeting (assigned)', '2026-10-16T08:00:00Z')
  await cache(A, `gc-${run}`, 'Cancelled thing', '2026-10-17T08:00:00Z', 'cancelled')
  await cache(A, `gf-${run}`, 'Fixture-assigned', '2026-10-18T08:00:00Z')
  await cache(
    B,
    `gx-${run}`,
    'Other office google',
    '2026-10-15T08:00:00Z',
    'confirmed',
    'primary-b',
  )
  const asg = await rpc(
    'hq_event_assign',
    `${lit(A)}::uuid, 'primary', ${lit(`gb-${run}`)}, ${lit(alpha)}, 'claude'`,
  )
  check(
    'a Google event is assigned to a project',
    asg.ok === true && asg.changed === true,
    JSON.stringify(asg),
  )
  await rpc('hq_event_assign', `${lit(A)}::uuid, 'primary', ${lit(`gf-${run}`)}, ${lit(fix)}`)

  const inAlpha = await read(A, alpha, 'project')
  check(
    'project scope: this project native events + its assigned Google events',
    JSON.stringify(titles(inAlpha)) ===
      JSON.stringify(['Board meeting (assigned)', 'Kickoff call', 'Retreat', 'Site walk']),
    JSON.stringify(titles(inAlpha)),
  )
  check(
    "project isolation: beta's event is not in alpha's calendar, and alpha's are not in beta's",
    !titles(inAlpha).includes('Beta review') &&
      JSON.stringify(titles(await read(A, beta, 'project'))) === JSON.stringify(['Beta review']),
  )
  const gEvent = inAlpha.find((e) => e.source === 'google')
  check(
    'an assigned Google event is external, read-only, id-shaped and carries its link',
    gEvent?.id === `g:primary:gb-${run}` &&
      gEvent.editable === false &&
      gEvent.sync === 'external' &&
      gEvent.project_slug === alpha &&
      String(gEvent.external_url).includes('calendar.google.com'),
    JSON.stringify(gEvent),
  )
  const nEvent = inAlpha.find((e) => e.title === 'Retreat')
  check(
    'a native event carries every contract field',
    nEvent !== undefined &&
      nEvent.source === 'team_hq' &&
      nEvent.all_day === true &&
      nEvent.notes === 'bring boots' &&
      nEvent.location === 'Lake House' &&
      nEvent.project_slug === alpha &&
      nEvent.project_name === `Name ${alpha}` &&
      nEvent.origin_channel === 'chatgpt' &&
      nEvent.editable === true &&
      nEvent.sync === 'pending',
    JSON.stringify(nEvent),
  )
  const all = await read(A, null, 'all')
  check(
    "all scope: every project's native events and every assigned Google event",
    ['Beta review', 'Board meeting (assigned)', 'Kickoff call', 'Retreat', 'Site walk'].every((t) =>
      titles(all).includes(t),
    ),
    JSON.stringify(titles(all)),
  )
  check(
    'all scope: never a fixture project, never unassigned or cancelled Google events, never another office',
    !titles(all).some((t) =>
      [
        'Fixture meeting',
        'Fixture-assigned',
        'Dentist (unassigned)',
        'Cancelled thing',
        'Other office event',
        'Other office google',
      ].includes(t),
    ),
    JSON.stringify(titles(all)),
  )
  const google = await read(A, null, 'google')
  check(
    'google scope: the cache incl. unassigned, plus native events that live in Google; no cancelled, no other office',
    JSON.stringify(titles(google)) ===
      JSON.stringify([
        'Beta review',
        'Board meeting (assigned)',
        'Dentist (unassigned)',
        'Fixture-assigned',
        'Kickoff call',
        'Retreat',
        'Site walk',
      ]),
    JSON.stringify(titles(google)),
  )
  check(
    'google scope: an unassigned event has no project, a fixture assignment is not disclosed',
    google.find((e) => e.title === 'Dentist (unassigned)')?.project_slug === null &&
      google.find((e) => e.title === 'Fixture-assigned')?.project_slug === null,
  )
  const bAll = await read(B, null, 'all')
  const bGoogle = await read(B, null, 'google')
  check(
    'tenant isolation: office B reads only its own native and cached events',
    JSON.stringify(titles(bAll)) === JSON.stringify(['Other office event']) &&
      JSON.stringify(titles(bGoogle)) === JSON.stringify(['Other office google']),
    `${JSON.stringify(titles(bAll))} ${JSON.stringify(titles(bGoogle))}`,
  )
  check(
    "tenant isolation: office B cannot name office A's project",
    String(
      (
        await rpc(
          'hq_project_events',
          `${lit(B)}::uuid, ${lit(alpha)}, '2026-10-01', '2026-11-30', 'project'`,
        )
      ).error,
    ).includes('no project called'),
  )
  check(
    'a window outside the events is empty',
    (await read(A, alpha, 'project', '2027-01-01', '2027-02-01')).length === 0,
  )
  check(
    'a bad scope is refused, saying why',
    String(
      (await rpc('hq_project_events', `${lit(A)}::uuid, ${lit(alpha)}, null, null, 'everything'`))
        .error,
    ).includes('is not a scope'),
  )
  check(
    'a bad date is refused, saying why',
    String(
      (
        await rpc(
          'hq_project_events',
          `${lit(A)}::uuid, ${lit(alpha)}, 'next tuesday', null, 'project'`,
        )
      ).error,
    ).includes('dates or timestamps'),
  )
  check(
    'a window over 400 days is refused',
    String(
      (
        await rpc(
          'hq_project_events',
          `${lit(A)}::uuid, ${lit(alpha)}, '2026-01-01', '2028-01-01', 'project'`,
        )
      ).error,
    ).includes('400 days'),
  )

  // ---- assignment rules --------------------------------------------------------------------------------------
  check(
    "office B cannot assign office A's Google event",
    String(
      (
        await rpc(
          'hq_event_assign',
          `${lit(B)}::uuid, 'primary', ${lit(`ga-${run}`)}, ${lit(foreign)}`,
        )
      ).error,
    ).includes('no such Google event'),
  )
  check(
    'an archived project takes no assignment',
    String(
      (
        await rpc(
          'hq_event_assign',
          `${lit(A)}::uuid, 'primary', ${lit(`ga-${run}`)}, ${lit(arch)}`,
        )
      ).error,
    ).includes('no active project'),
  )
  const move = await rpc(
    'hq_event_assign',
    `${lit(A)}::uuid, 'primary', ${lit(`gb-${run}`)}, ${lit(beta)}`,
  )
  check(
    're-assigning moves the event to the other project',
    move.changed === true &&
      titles(await read(A, beta, 'project')).includes('Board meeting (assigned)') &&
      !titles(await read(A, alpha, 'project')).includes('Board meeting (assigned)'),
  )
  check(
    'assigning to the same project again changes nothing',
    (await rpc('hq_event_assign', `${lit(A)}::uuid, 'primary', ${lit(`gb-${run}`)}, ${lit(beta)}`))
      .changed === false,
  )
  const un = await rpc(
    'hq_event_unassign',
    `${lit(A)}::uuid, 'primary', ${lit(`gb-${run}`)}, 'slack'`,
  )
  check(
    'unassign returns the event to Google-only',
    un.ok === true &&
      !titles(await read(A, null, 'all')).includes('Board meeting (assigned)') &&
      titles(await read(A, null, 'google')).includes('Board meeting (assigned)'),
  )
  check(
    'unassigning what is not assigned says so',
    String(
      (await rpc('hq_event_unassign', `${lit(A)}::uuid, 'primary', ${lit(`gb-${run}`)}`)).error,
    ).includes('not assigned'),
  )

  // ---- update ------------------------------------------------------------------------------------------------
  const id1 = String(e1.id)
  const u1 = await rpc(
    'hq_event_update',
    `${lit(A)}::uuid, ${lit(id1)}::uuid, 'Site walk (moved)', ${lit('2026-10-12T13:00:00Z')}::timestamptz`,
  )
  const after = (await read(A, alpha, 'project')).find((e) => e.id === id1)
  check(
    'moving the start keeps the length and the new title shows',
    u1.changed === true &&
      after?.title === 'Site walk (moved)' &&
      String(after.ends_at).startsWith('2026-10-12T14:00:00'),
    JSON.stringify(after),
  )
  check(
    'an update that changes nothing says so and writes nothing',
    (await rpc('hq_event_update', `${lit(A)}::uuid, ${lit(id1)}::uuid, 'Site walk (moved)'`))
      .changed === false,
  )
  check(
    'an update ending before the start is refused',
    String(
      (
        await rpc(
          'hq_event_update',
          `${lit(A)}::uuid, ${lit(id1)}::uuid, null, null, ${lit('2026-10-12T01:00:00Z')}::timestamptz`,
        )
      ).error,
    ).includes('ends before it starts'),
  )
  check(
    'an empty title is refused on update',
    String(
      (await rpc('hq_event_update', `${lit(A)}::uuid, ${lit(id1)}::uuid, ' '`)).error,
    ).includes('title'),
  )
  check(
    "office B cannot edit office A's event",
    String((await rpc('hq_event_update', `${lit(B)}::uuid, ${lit(id1)}::uuid, 'hijack'`)).error) ===
      'no such event',
  )
  check(
    'updating a missing event says so',
    String(
      (
        await rpc(
          'hq_event_update',
          `${lit(A)}::uuid, ${lit('11111111-1111-1111-1111-111111111111')}::uuid, 'x'`,
        )
      ).error,
    ) === 'no such event',
  )

  // ---- delete: hard when never in Google, tombstone when it was ------------------------------------------------
  const hard = await rpc(
    'hq_event_delete',
    `${lit(A)}::uuid, ${lit(String(betaEvent.id))}::uuid, 'telegram'`,
  )
  check(
    'an event that never reached Google is deleted outright',
    hard.mode === 'deleted' &&
      Number(
        (
          await one(
            `select count(*)::int n from public.project_events where event_id = ${lit(String(betaEvent.id))}::uuid`,
          )
        ).n,
      ) === 0,
    JSON.stringify(hard),
  )
  await db.execute(
    `update public.project_events set external_calendar_id = 'primary', external_event_id = ${lit(`ext-${run}-1`)}, sync_state = 'synced', external_updated_at = now() - interval '1 day', last_synced_at = now() - interval '1 hour' where event_id = ${lit(id1)}::uuid`,
  )
  await cache(A, `ext-${run}-1`, 'Site walk (moved)', '2026-10-12T13:00:00Z')
  check(
    "a linked event's cache twin is shown once, as the native",
    (await read(A, null, 'google')).filter((e) => e.title === 'Site walk (moved)').length === 1 &&
      (await read(A, null, 'google')).find((e) => e.title === 'Site walk (moved)')?.source ===
        'team_hq',
  )
  const tomb = await rpc('hq_event_delete', `${lit(A)}::uuid, ${lit(id1)}::uuid, 'claude', 'agent'`)
  const row = await one(
    `select deleted_at is not null as gone, sync_state, authority from public.project_events where event_id = ${lit(id1)}::uuid`,
  )
  check(
    'a linked event is tombstoned and pending, so the deletion reaches Google first',
    tomb.mode === 'tombstoned' &&
      row.gone === true &&
      row.sync_state === 'pending' &&
      row.authority === 'agent',
    JSON.stringify(row),
  )
  check(
    'a tombstoned event is gone from every scope, and its Google twin does not come back',
    !titles(await read(A, alpha, 'project')).includes('Site walk (moved)') &&
      !titles(await read(A, null, 'google')).includes('Site walk (moved)'),
  )
  check(
    'deleting it twice says no such event',
    String((await rpc('hq_event_delete', `${lit(A)}::uuid, ${lit(id1)}::uuid`)).error) ===
      'no such event',
  )
  check(
    'a tombstone cannot be edited',
    String((await rpc('hq_event_update', `${lit(A)}::uuid, ${lit(id1)}::uuid, 'zombie'`)).error) ===
      'no such event',
  )

  // ---- audit trail with the channel -------------------------------------------------------------------------
  const evs = (
    await db.execute(
      `select action_type, trigger, after_state ->> 'channel' as ch, actor_kind from public.events where office_id = ${lit(A)}::uuid and occurred_at >= now() - interval '5 minutes' and action_type like 'event.%' order by occurred_at`,
    )
  ).rows as { action_type: string; trigger: string; ch: string | null; actor_kind: string }[]
  const types = new Set(evs.map((e) => e.action_type))
  check(
    'Activity records created, updated, deleted, assigned and unassigned',
    ['event.created', 'event.updated', 'event.deleted', 'event.assigned', 'event.unassigned'].every(
      (t) => types.has(t),
    ),
    [...types].join(','),
  )
  check(
    'the channel is on the event (ChatGPT, Claude, Telegram and Slack writes keep theirs)',
    ['chatgpt', 'claude', 'telegram', 'slack'].every((c) =>
      evs.some((e) => e.ch === c || e.trigger === c),
    ) &&
      evs.find((e) => e.ch === 'claude' && e.action_type === 'event.deleted')?.actor_kind ===
        'agent',
  )

  // ---- the pull: last writer wins, deletions and absences, all recorded ------------------------------------------------
  const linked = async (
    title: string,
    ext: string,
    state: string,
    startsOffset: string,
    synced = "now() - interval '1 hour'",
  ): Promise<string> => {
    const r = await add(A, alpha, title, new Date(Date.now() + 3 * 86400000).toISOString())
    const id = String(r.id)
    await db.execute(
      `update public.project_events set external_calendar_id = 'primary', external_event_id = ${lit(ext)}, sync_state = ${lit(state)}, external_updated_at = now() - interval '1 day', last_synced_at = ${synced}, starts_at = now() + ${lit(startsOffset)}::interval, ends_at = now() + ${lit(startsOffset)}::interval + interval '1 hour' where event_id = ${lit(id)}::uuid`,
    )
    return id
  }
  const cacheLive = async (
    ext: string,
    summary: string,
    remote: string,
    status = 'confirmed',
  ): Promise<void> => {
    await db.execute(
      `insert into public.calendar_events (event_id, calendar_id, summary, starts_at, ends_at, status, remote_updated_at, office_id) values (${lit(ext)}, 'primary', ${lit(summary)}, now() + interval '3 days 2 hours', now() + interval '3 days 3 hours', ${lit(status)}, ${remote}, ${lit(A)}::uuid)`,
    )
  }
  const gWins = await linked('Google edits me', `pw-${run}-1`, 'synced', '3 days')
  await cacheLive(`pw-${run}-1`, 'Renamed in Google', 'now()')
  const lWins = await linked('Local edits me', `pw-${run}-2`, 'pending', '3 days')
  await db.execute(
    `update public.project_events set title = 'Local edits me (later)' where event_id = ${lit(lWins)}::uuid`,
  )
  await cacheLive(`pw-${run}-2`, 'Older Google title', "now() - interval '1 hour'")
  const lLoses = await linked('Local pending, older', `pw-${run}-3`, 'pending', '3 days')
  await db.execute(
    `update public.project_events set updated_at = now() - interval '2 hours' where event_id = ${lit(lLoses)}::uuid`,
  )
  await cacheLive(`pw-${run}-3`, 'Google is newer', 'now()')
  const gDel = await linked('Cancelled in Google', `pw-${run}-4`, 'synced', '3 days')
  await cacheLive(`pw-${run}-4`, 'Cancelled in Google', 'now()', 'cancelled')
  const absent = await linked('Vanished from Google', `pw-${run}-5`, 'synced', '3 days')
  const farAbsent = await linked('Far future, not in window', `pw-${run}-6`, 'synced', '60 days')
  const stale = await pull(false)
  async function pull(fresh: boolean): Promise<Record<string, unknown>> {
    return await rpc('project_events_pull', `${lit(A)}::uuid, 'primary', ${String(fresh)}`)
  }
  const st = async (id: string): Promise<Record<string, unknown>> =>
    await one(
      `select title, sync_state, sync_error, deleted_at is not null as gone, external_updated_at > now() - interval '1 minute' as touched from public.project_events where event_id = ${lit(id)}::uuid`,
    )
  check(
    'google newer than a synced row: Google wins and the row is synced',
    (await st(gWins)).title === 'Renamed in Google' && (await st(gWins)).sync_state === 'synced',
    JSON.stringify(await st(gWins)),
  )
  check(
    'a later local edit beats an older Google change, and says so',
    (await st(lWins)).title === 'Local edits me (later)' &&
      String((await st(lWins)).sync_error).includes('overridden by this later local edit'),
    JSON.stringify(await st(lWins)),
  )
  check(
    'a newer Google change beats an older pending local edit, and says so',
    (await st(lLoses)).title === 'Google is newer' &&
      String((await st(lLoses)).sync_error).includes('pending local edit was overridden'),
    JSON.stringify(await st(lLoses)),
  )
  check(
    'cancelled in Google tombstones the native event as already-paid',
    (await st(gDel)).gone === true &&
      (await st(gDel)).sync_state === 'synced' &&
      String((await st(gDel)).sync_error).includes('deleted in Google'),
  )
  check(
    'with a stale cache an absence is NOT read as a deletion',
    (await st(absent)).gone === false && stale.deleted === 1,
  )
  await pull(true)
  check(
    'with a fresh cache an absence inside the window IS a deletion',
    (await st(absent)).gone === true,
  )
  check(
    'an event outside the cache window is never judged absent',
    (await st(farAbsent)).gone === false,
  )
  const g = await one(
    `select count(*)::int n from public.events where office_id = ${lit(A)}::uuid and trigger = 'google_sync' and occurred_at >= now() - interval '5 minutes'`,
  )
  check(
    'every Google-side change and override is in Activity under google_sync',
    Number(g.n) >= 5,
    String(g.n),
  )
  const purged = Number((await one(`select app.project_events_purge(${lit(A)}::uuid) as n`)).n)
  check(
    'purge removes only finished tombstones (synced), never pending ones',
    purged >= 2 && (await st(id1)).sync_state === 'pending',
  )

  // ---- the handler, with Google replaced by a recording fake ------------------------------------------------------------
  await db.execute(
    `update public.project_events set sync_state = 'synced' where office_id = ${lit(A)}::uuid and sync_state = 'pending' and event_id <> ${lit(id1)}::uuid`,
  )
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = []
  let existing = false
  let serial = 0
  const fake = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    calls.push({
      method,
      url,
      ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }),
    })
    const reply = (status: number, body: unknown): Response =>
      new Response(status === 204 ? null : JSON.stringify(body), { status })
    if (method === 'GET' && url.includes('privateExtendedProperty'))
      return reply(200, { items: existing ? [{ id: 'adopted-1' }] : [] })
    if (method === 'GET')
      return reply(200, { id: 'ext-d', extendedProperties: { private: { agenticEventId: id1 } } })
    if (method === 'POST')
      return reply(200, {
        id: `new-${String(++serial)}`,
        etag: '"e1"',
        updated: '2026-10-04T10:00:00.000Z',
      })
    if (method === 'PATCH')
      return reply(200, {
        id: url.split('/').pop(),
        etag: '"e2"',
        updated: '2026-10-04T10:05:00.000Z',
      })
    return reply(204, {})
  }) as unknown as typeof fetch
  const makeJob = async (): Promise<Job> => {
    const jid = String(
      (
        await one(
          `insert into public.jobs (kind, requested_by, project_id, office_id, idempotency_key, correlation_id) values ('calendar.sync_events', 'duty:calendar-event-sync', ${lit(PA)}::uuid, ${lit(A)}::uuid, 'pc-' || gen_random_uuid(), gen_random_uuid()) returning job_id::text id`,
        )
      ).id,
    )
    return {
      jobId: jid,
      kind: 'calendar.sync_events',
      correlationId: jid,
      projectId: PA,
      idempotencyKey: jid,
      attempt: 1,
    }
  }
  const handler = calendarEventsHandler(db, {
    fetchImpl: fake,
    access: async () => ({
      ok: true,
      accessToken: 'fake-token-value-123456',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      expiresInSeconds: 3600,
    }),
    refresh: async () => ({ ok: true, note: 'stub', seen: 0, stored: 0, removed: 0 }),
  })
  const fresh = String(
    (await add(A, alpha, 'Handler create', new Date(Date.now() + 5 * 86400000).toISOString())).id,
  )
  await db.execute(
    `update public.project_events set sync_state = 'pending' where event_id = ${lit(fresh)}::uuid`,
  )
  const out1 = await handler.handle(await makeJob(), db)
  const posted = calls.filter((c) => c.method === 'POST')
  check(
    'a pending create asks Google first, then POSTs once with the private tag',
    posted.length === 1 &&
      calls.some((c) => c.method === 'GET' && c.url.includes('agenticEventId')) &&
      (posted[0]?.body?.extendedProperties as { private: Record<string, string> } | undefined)
        ?.private.agenticEventId === fresh,
  )
  const s1 = await one(
    `select sync_state, external_event_id, external_etag from public.project_events where event_id = ${lit(fresh)}::uuid`,
  )
  check(
    'the Google ids and etag are recorded and the row is synced',
    s1.sync_state === 'synced' &&
      String(s1.external_event_id).startsWith('new-') &&
      s1.external_etag === '"e1"',
    JSON.stringify(s1),
  )
  check(
    'the tombstoned linked event was DELETEd in Google (after reading it back) and purged',
    calls.some((c) => c.method === 'DELETE') &&
      Number(
        (
          await one(
            `select count(*)::int n from public.project_events where event_id = ${lit(id1)}::uuid`,
          )
        ).n,
      ) === 0,
  )
  check(
    'the handler output is a string, never carries the token',
    !JSON.stringify(out1).includes('fake-token-value-123456') && typeof out1.body === 'string',
  )
  calls.length = 0
  const out2 = await handler.handle(await makeJob(), db)
  check(
    'running it again sends nothing (idempotent)',
    calls.filter((c) => c.method !== 'GET').length === 0,
    JSON.stringify(calls.map((c) => c.method)),
  )
  check('a quiet pass is not announced', out2.announce === false, String(out2.announce))
  // adoption of a created-but-unrecorded event
  const crashed = String(
    (await add(A, alpha, 'Crashed after create', new Date(Date.now() + 6 * 86400000).toISOString()))
      .id,
  )
  existing = true
  calls.length = 0
  await handler.handle(await makeJob(), db)
  check(
    'an event Google already holds (crash between create and record) is adopted, not duplicated',
    calls.every((c) => c.method !== 'POST') &&
      calls.some((c) => c.method === 'PATCH') &&
      (
        await one(
          `select external_event_id from public.project_events where event_id = ${lit(crashed)}::uuid`,
        )
      ).external_event_id === 'adopted-1',
  )
  existing = false
  // an edit made, then pushed as a patch
  await rpc('hq_event_update', `${lit(A)}::uuid, ${lit(fresh)}::uuid, 'Handler create (edited)'`)
  calls.length = 0
  await handler.handle(await makeJob(), db)
  check(
    'an edit goes to Google as a PATCH of the linked event',
    calls.filter((c) => c.method === 'PATCH').length === 1 &&
      calls.find((c) => c.method === 'PATCH')?.body?.summary === 'Handler create (edited)',
  )
  // an agent's row asks the approval policy. Grant's office holds a standing yes for calendar.write (0424), so it goes;
  // with that yes revoked it is held, and a question is raised instead of a write.
  const agentAdd = async (title: string, days: number): Promise<string> =>
    String(
      (
        await rpc(
          'hq_event_add',
          `${lit(A)}::uuid, ${lit(alpha)}, ${lit(title)}, ${lit(new Date(Date.now() + days * 86400000).toISOString())}::timestamptz, null, false, null, null, 'claude', 'agent'`,
        )
      ).id,
    )
  const allowed = await agentAdd('Agent proposal (standing yes)', 7)
  calls.length = 0
  await handler.handle(await makeJob(), db)
  check(
    'an agent event goes to Google when the standing yes for calendar.write holds',
    calls.filter((c) => c.method === 'POST').length === 1 &&
      (
        await one(
          `select sync_state from public.project_events where event_id = ${lit(allowed)}::uuid`,
        )
      ).sync_state === 'synced',
  )
  const sa = await refusal(
    `update public.standing_authorizations set revoked_at = now(), revoked_reason = 'proof' where tool = 'calendar.write' and revoked_at is null and office_id = ${lit(A)}::uuid`,
  )
  check('(the standing yes could be revoked inside the proof)', sa === '', sa)
  const agentRow = await agentAdd('Agent proposal (held)', 9)
  const personRow = String(
    (
      await add(
        A,
        alpha,
        'Person event beside it',
        new Date(Date.now() + 9 * 86400000).toISOString(),
      )
    ).id,
  )
  calls.length = 0
  const out3 = await handler.handle(await makeJob(), db)
  const held = await one(
    `select sync_state, external_event_id from public.project_events where event_id = ${lit(agentRow)}::uuid`,
  )
  const mine = await one(
    `select sync_state, external_event_id from public.project_events where event_id = ${lit(personRow)}::uuid`,
  )
  check(
    "an agent's event is NOT written to Google without the policy's yes (held, still pending)",
    held.external_event_id === null && held.sync_state === 'pending',
    JSON.stringify({ held, out: out3.body }),
  )
  check(
    "a person's own event in the same pass is still sent (an open question does not hold his edits)",
    mine.sync_state === 'synced' && mine.external_event_id !== null,
    JSON.stringify(mine),
  )
  check(
    'and the held pass says so, and is announced',
    String(out3.body).includes('waiting for your say-so') && out3.announce === true,
    String(out3.body),
  )
  // failure is recorded, retry or park
  const failing = (async (_url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET') === 'GET')
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    return new Response(
      JSON.stringify({
        error: {
          message: 'Forbidden for fake-token-value-123456',
          errors: [{ reason: 'forbiddenForNonOrganizer' }],
        },
      }),
      { status: 403 },
    )
  }) as unknown as typeof fetch
  const person = String(
    (await add(A, alpha, 'Will be refused', new Date(Date.now() + 8 * 86400000).toISOString())).id,
  )
  await calendarEventsHandler(db, {
    fetchImpl: failing,
    access: async () => ({
      ok: true,
      accessToken: 'fake-token-value-123456',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      expiresInSeconds: 3600,
    }),
    refresh: async () => ({ ok: true, note: 'stub', seen: 0, stored: 0, removed: 0 }),
  }).handle(await makeJob(), db)
  const bad = await one(
    `select sync_state, sync_error from public.project_events where event_id = ${lit(person)}::uuid`,
  )
  check(
    'a permanent refusal parks the row at error with the reason, and no token in it',
    bad.sync_state === 'error' &&
      String(bad.sync_error).includes('403') &&
      !String(bad.sync_error).includes('fake-token-value-123456'),
    JSON.stringify(bad),
  )
  await rpc('hq_event_update', `${lit(A)}::uuid, ${lit(person)}::uuid, 'Will be refused (edited)'`)
  check(
    'an edit puts an errored event back to pending',
    (
      await one(
        `select sync_state from public.project_events where event_id = ${lit(person)}::uuid`,
      )
    ).sync_state === 'pending',
  )
} finally {
  await db.execute('rollback')
  const left = await one(
    `select count(*)::int n from public.project_events where title like 'Handler%' or title like 'Site walk%'`,
  )
  check('the proof left nothing behind (rolled back)', Number(left.n) === 0, String(left.n))
  await db.end()
}
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${String(failed)} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
