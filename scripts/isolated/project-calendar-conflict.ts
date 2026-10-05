/**
 * Project calendars, optimistic concurrency (0980) - the real sync functions driven on a LOCAL replica, with Google
 * replaced by a stateful fake that models etags, If-Match and 412 (tests/helpers/fake-google-calendar.ts).
 *
 *   npx tsx scripts/isolated/project-calendar-conflict.ts <replica-db>      (default: cand_svc2)
 *
 * Real: app.hq_event_*, app.project_events_sync_work, app.project_event_sync_done / _gone / _take_remote /
 * _conflict_note, syncProjectEvents. Fake: Google. One transaction, rolled back. Refuses any database that is not a marked
 * replica on a Unix socket. Nothing here makes an outbound call.
 */
import { syncProjectEvents, type WorkRow } from '../../src/handlers/calendar-events.ts'
import { FakeGoogle } from '../../tests/helpers/fake-google-calendar.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'cand_svc2')
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
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
  const slug = `cal-${run}-conflict`
  await one(
    `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, 'Conflict proof', 'active', ${lit(A)}::uuid) returning 1`,
  )
  const rpc = async (fn: string, args: string): Promise<Record<string, unknown>> =>
    J((await one(`select app.${fn}(${args}) as r`)).r)
  const g = new FakeGoogle()
  const row = async (id: string): Promise<Record<string, unknown>> =>
    (await one(`select * from public.project_events where event_id = ${lit(id)}::uuid`)) as Record<
      string,
      unknown
    >
  const gone = async (id: string): Promise<boolean> =>
    (
      await one(
        `select count(*)::int n from public.project_events where event_id = ${lit(id)}::uuid`,
      )
    ).n === 0
  const work = async (): Promise<WorkRow[]> =>
    (J(await one(`select app.project_events_sync_work(${lit(A)}::uuid, 50) as w`)).w ??
      []) as unknown as WorkRow[]
  const syncRows = (rows: WorkRow[]) =>
    syncProjectEvents(db, A, 'fake-token-value-123456', rows, {
      fetchImpl: g.fetch,
      calendarId: 'primary',
    })
  const sync = async (id: string) => syncRows((await work()).filter((w) => w.event_id === id))
  const backdate = (id: string, iso: string) =>
    db.execute(
      `update public.project_events set updated_at = ${lit(iso)}::timestamptz where event_id = ${lit(id)}::uuid`,
    )
  const activity = async (id: string): Promise<Record<string, unknown>[]> =>
    (
      await db.execute(
        `select after_state from public.events where office_id = ${lit(A)}::uuid and after_state ->> 'event_id' = ${lit(id)} and after_state ->> 'channel' = 'google_sync' order by occurred_at`,
      )
    ).rows.map((r) => J((r as { after_state: unknown }).after_state))
  const make = async (title: string): Promise<string> => {
    const id = String(
      (
        await rpc(
          'hq_event_add',
          `${lit(A)}::uuid, ${lit(slug)}, ${lit(title)}, now() + interval '3 days', null, false, null, null, 'teamhq'`,
        )
      ).id,
    )
    await db.execute(
      `update public.project_events set sync_state = 'pending' where event_id = ${lit(id)}::uuid`,
    )
    await sync(id)
    return id
  }
  const edit = (id: string, title: string) =>
    rpc('hq_event_update', `${lit(A)}::uuid, ${lit(id)}::uuid, ${lit(title)}`)

  // ---- 1. a normal edit ------------------------------------------------------------------------------------------------
  const e1 = await make('Normal edit')
  const r1 = await row(e1)
  const g1 = g.events.get(String(r1.external_event_id))
  check(
    'a create records the etag Google returned',
    r1.sync_state === 'synced' && r1.external_etag === g1?.etag,
    `${String(r1.external_etag)}`,
  )
  check('the Google stamp is recorded for the next comparison', r1.external_updated_at !== null)
  await edit(e1, 'Normal edit, renamed')
  g.log.length = 0
  const out1 = await sync(e1)
  const r1b = await row(e1)
  check(
    'the edit went out with If-Match = the stored etag',
    g.log[0]?.method === 'PATCH' && g.log[0]?.ifMatch === r1.external_etag,
    JSON.stringify(g.log[0]),
  )
  check(
    'Google holds the edit, the row is synced and carries the NEW etag, no conflict text',
    g1?.summary === 'Normal edit, renamed' &&
      r1b.sync_state === 'synced' &&
      r1b.external_etag === g.events.get(String(r1.external_event_id))?.etag &&
      r1b.external_etag !== r1.external_etag &&
      r1b.sync_error === null &&
      out1.notes.length === 0,
  )

  // ---- 2. Google changed it, and Google's change is the later one ------------------------------------------------------
  const e2 = await make('Google later')
  const ext2 = String((await row(e2)).external_event_id)
  g.remoteEdit(ext2, { summary: 'Renamed in Google', location: 'Gate 2' })
  await edit(e2, 'Local edit made earlier')
  await backdate(e2, '2020-01-01T00:00:00Z') // the local edit predates Google's change
  g.log.length = 0
  const out2 = await sync(e2)
  const r2 = await row(e2)
  check(
    'the refused PATCH was the only write: Google was NOT overwritten',
    g.log.filter((l) => l.method === 'PATCH').length === 1 &&
      g.events.get(ext2)?.summary === 'Renamed in Google',
  )
  check(
    "Google's content was applied to the project event (title and place)",
    r2.title === 'Renamed in Google' && r2.location === 'Gate 2',
    `${String(r2.title)} / ${String(r2.location)}`,
  )
  check(
    "the row is synced with Google's etag and says it was a conflict",
    r2.sync_state === 'synced' &&
      r2.external_etag === g.events.get(ext2)?.etag &&
      String(r2.sync_error).startsWith('conflict:') &&
      String(r2.sync_error).includes('overridden by a newer change in Google'),
    String(r2.sync_error),
  )
  const act2 = await activity(e2)
  check(
    'Activity records the winner as google on the google_sync channel',
    act2.some((a) => a.winner === 'google'),
    JSON.stringify(act2.map((a) => a.winner)),
  )
  check(
    'the pass reports it (so it is announced)',
    out2.notes.some((n) => n.includes('overridden by a newer change in Google')) &&
      out2.failed === 0,
  )

  // ---- 3. Google changed it, and the local edit is the later one -------------------------------------------------------
  const e3 = await make('Local later')
  const ext3 = String((await row(e3)).external_event_id)
  g.remoteEdit(ext3, { summary: 'Renamed in Google' })
  await edit(e3, 'Local edit, later')
  await backdate(e3, '2099-01-01T00:00:00Z')
  const fresh3 = g.events.get(ext3)?.etag
  g.log.length = 0
  await sync(e3)
  const r3 = await row(e3)
  const patches3 = g.log.filter((l) => l.method === 'PATCH')
  check(
    're-sent exactly once, the second time with the FRESH etag',
    patches3.length === 2 &&
      patches3[1]?.ifMatch === fresh3 &&
      patches3[0]?.ifMatch !== patches3[1]?.ifMatch,
  )
  check(
    'Google holds the local edit; the row is synced with a conflict note naming the later edit',
    g.events.get(ext3)?.summary === 'Local edit, later' &&
      r3.sync_state === 'synced' &&
      String(r3.sync_error).startsWith('conflict:') &&
      String(r3.sync_error).includes('later edit'),
    String(r3.sync_error),
  )
  check(
    'Activity records the winner as team_hq',
    (await activity(e3)).some((a) => a.winner === 'team_hq'),
  )

  // ---- 4. a merely stale etag ------------------------------------------------------------------------------------------
  const e4 = await make('Stale etag')
  const ext4 = String((await row(e4)).external_event_id)
  g.remoteEdit(ext4, { summary: 'Edited in Google' })
  // the pull absorbed it (external_updated_at moved) but the etag on the row is the old one
  await db.execute(
    `update public.project_events set external_updated_at = ${lit(String(g.events.get(ext4)?.updated))}::timestamptz where event_id = ${lit(e4)}::uuid`,
  )
  await edit(e4, 'Local edit after the pull')
  await backdate(e4, '2020-01-01T00:00:00Z')
  await sync(e4)
  const r4 = await row(e4)
  check(
    'a stale etag with nothing newer in Google is re-sent, with NO conflict recorded',
    g.events.get(ext4)?.summary === 'Local edit after the pull' &&
      r4.sync_state === 'synced' &&
      r4.sync_error === null,
    String(r4.sync_error),
  )

  // ---- 5. delete with a stale etag -------------------------------------------------------------------------------------
  const e5 = await make('Delete loses')
  const ext5 = String((await row(e5)).external_event_id)
  await rpc('hq_event_delete', `${lit(A)}::uuid, ${lit(e5)}::uuid`)
  g.remoteEdit(ext5, { summary: 'Still in use' })
  await backdate(e5, '2020-01-01T00:00:00Z')
  const out5 = await sync(e5)
  const r5 = await row(e5)
  check(
    'Google edited after the delete: the event is still in Google',
    g.events.has(ext5) && g.events.get(ext5)?.summary === 'Still in use',
  )
  check(
    "the tombstone is lifted, Google's content is back, and the row says why",
    r5.deleted_at === null &&
      r5.title === 'Still in use' &&
      r5.sync_state === 'synced' &&
      String(r5.sync_error).includes('so it is back'),
    String(r5.sync_error),
  )
  check(
    'the pass reports it',
    out5.notes.some((n) => n.includes('so it is back')),
  )
  // and now the delete is later than Google's last change: it is paid, with the fresh etag
  await rpc('hq_event_delete', `${lit(A)}::uuid, ${lit(e5)}::uuid`)
  g.log.length = 0
  await sync(e5)
  check(
    'a delete with the current etag goes through: event gone in Google and the row purged',
    !g.events.has(ext5) && (await gone(e5)),
  )
  const e5b = await make('Delete wins')
  const ext5b = String((await row(e5b)).external_event_id)
  await rpc('hq_event_delete', `${lit(A)}::uuid, ${lit(e5b)}::uuid`)
  g.remoteEdit(ext5b, { summary: 'Edited long ago' })
  await backdate(e5b, '2099-01-01T00:00:00Z')
  await sync(e5b)
  check(
    "a delete LATER than Google's edit is re-sent with the fresh etag and wins",
    !g.events.has(ext5b) && (await gone(e5b)),
  )

  // ---- 6. Google deleted it meanwhile ----------------------------------------------------------------------------------
  const e6 = await make('Deleted in Google')
  const ext6 = String((await row(e6)).external_event_id)
  g.remoteDelete(ext6)
  await edit(e6, 'Edit of a vanished event')
  await sync(e6)
  const r6 = await row(e6)
  check(
    'an update of an event Google deleted: its deletion wins and is recorded',
    r6.deleted_at !== null && String(r6.sync_error).includes('deleted in Google'),
    String(r6.sync_error),
  )

  // ---- 7. a person edits again mid-sync --------------------------------------------------------------------------------
  const e7 = await make('Raced')
  const ext7 = String((await row(e7)).external_event_id)
  g.remoteEdit(ext7, { summary: 'Google first' })
  await edit(e7, 'Edit one')
  await backdate(e7, '2020-01-01T00:00:00Z')
  const seen = (await work()).filter((w) => w.event_id === e7)
  await edit(e7, 'Edit two, typed during the sync') // after the work was read
  await syncRows(seen)
  const r7 = await row(e7)
  check(
    "an edit made after the work was read is never overwritten by Google's content and stays pending",
    r7.title === 'Edit two, typed during the sync' && r7.sync_state === 'pending',
    `${String(r7.title)} ${String(r7.sync_state)}`,
  )

  // ---- 8. idempotent: nothing pending, nothing sent --------------------------------------------------------------------
  g.log.length = 0
  const idle = await syncRows((await work()).filter((w) => [e1, e2, e3, e4].includes(w.event_id)))
  check('a pass with nothing pending sends nothing', g.log.length === 0 && idle.pushed === 0)

  // ---- containment of the new writers ----------------------------------------------------------------------------------
  const denied = await db
    .execute(
      `set local role anon; select app.project_event_conflict_note(${lit(A)}::uuid, ${lit(e1)}::uuid, 'x')`,
    )
    .then(() => 'ran')
    .catch((e: Error) => e.message)
  check(
    'the new writers refuse a non-owner role, saying permission was denied',
    /permission denied/i.test(denied),
    denied.slice(0, 80),
  )
} finally {
  await db.execute('rollback')
  await db.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
