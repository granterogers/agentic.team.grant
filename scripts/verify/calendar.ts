/**
 * The calendar reader, against a fake Google and a real database.
 *
 *   npm run verify:calendar
 *
 * Phase 9 waits on Grant creating an OAuth client in a project he owns, and
 * that is exactly the wrong reason to leave the reader unverified: the whole
 * point is that it works the moment he presses Connect, and finding out then is
 * finding out in front of him.
 *
 * So Google is faked and Postgres is real. That split is deliberate — the
 * interesting behaviour is what gets STORED (the upsert, the all-day case, the
 * disappearance sweep) and none of it can be checked against a stub database.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { refreshCalendar } from '../../src/google/calendar.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const one = async (sql: string): Promise<Record<string, unknown> | undefined> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown> | undefined

const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? '✅' : '❌'} ${what} — ${outcome}`)
}

/** A calendar id nothing real uses, so this cannot touch Grant's own cache. */
const CAL = `fixture-calendar-${run}`
const soon = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString()

/**
 * A credential, only if there is not a real one.
 *
 * The storing checks are the valuable half of this suite and they were being
 * skipped, because `googleAccess` reads the vault and the vault is empty until
 * Grant connects. A suite whose interesting checks only run once the feature is
 * live is a suite that reports green on the day it is least informative.
 *
 * So a fixture credential is installed WHEN AND ONLY WHEN there is no real one.
 * If Grant has connected, his is used and nothing here writes to the vault at
 * all — a verification run must never be able to overwrite a credential a human
 * granted.
 *
 * The fixture is never sent to Google: every fetch in this file is faked.
 */
const already = (await one(`
    select
      coalesce((select value #>> '{}' from public.system_config
                 where key = 'google.client_id'), '') <> '' as has_id,
      exists (select 1 from vault.secrets where name = 'google.client_secret') as has_secret,
      exists (select 1 from vault.secrets where name = 'google.refresh_token') as has_refresh
  `)) as { has_id: boolean; has_secret: boolean; has_refresh: boolean }
const injected = !(already.has_id && already.has_secret && already.has_refresh)
if (injected && (already.has_id || already.has_secret || already.has_refresh)) {
  // Half-connected. Refusing beats filling in the gaps: the missing half might
  // be a step Grant is in the middle of, and a fixture written over it would
  // look like his.
  console.error(
    'Google is half-configured — some of the credential exists and some does not.\n' +
      'Refusing to fill in the rest with a fixture: finish or clear it in Settings first.',
  )
  process.exit(2)
}

const wasEnabled = (
  await one(`select coalesce((select value::text::boolean from public.system_config
                               where key = 'calendar.enabled'), false) as on`)
)?.on
const wasCalendarId = (
  await one(`select coalesce((select value #>> '{}' from public.system_config
                               where key = 'calendar.calendar_id'), 'primary') as id`)
)?.id

/**
 * Restored at the end, whatever happens.
 *
 * "A test that changes real configuration must restore it" is a rule this
 * project has paid for twice, and this one changes two keys.
 */
const restore = async (): Promise<void> => {
  await db.execute(`
    update public.system_config set value = to_jsonb(${String(wasEnabled === true)})
     where key = 'calendar.enabled';
    update public.system_config set value = to_jsonb(${lit(String(wasCalendarId))}::text)
     where key = 'calendar.calendar_id';
    delete from public.calendar_events where calendar_id = ${lit(CAL)};
  `)
  if (!injected) return
  // Exactly what was installed, and only if it was installed here.
  await db.execute(`
    update public.system_config set value = to_jsonb(''::text) where key = 'google.client_id';
    delete from vault.secrets where name in ('google.client_secret', 'google.refresh_token');
  `)
}

if (injected) {
  await db.execute(`
    insert into public.system_config (key, value, description)
    values ('google.client_id', to_jsonb('fixture.apps.googleusercontent.com'::text), 'fixture')
    on conflict (key) do update set value = excluded.value;
    select app.store_secret('google.client_secret', 'GOCSPX-fixture',
      'verify:calendar fixture; removed at the end of the run');
    select app.store_secret('google.refresh_token', '1//fixture-refresh',
      'verify:calendar fixture; removed at the end of the run');
  `)
}

try {
  // --- switched off -------------------------------------------------------
  await db.execute(
    `update public.system_config set value = to_jsonb(false) where key = 'calendar.enabled'`,
  )
  let asked = false
  const offOutcome = await refreshCalendar(db, {
    fetchImpl: (async () => {
      asked = true
      return new Response('{}')
    }) as unknown as typeof fetch,
  })
  record(
    'switched off in Settings, it reads nothing and does not call Google (§17)',
    `${offOutcome.note} · called Google: ${String(asked)}`,
    offOutcome.ok && !asked,
  )

  // --- on, but the credential is not there --------------------------------
  await db.execute(`
    update public.system_config set value = to_jsonb(true) where key = 'calendar.enabled';
    update public.system_config set value = to_jsonb(${lit(CAL)}::text)
     where key = 'calendar.calendar_id';
  `)

  // --- a real fetch, faked ------------------------------------------------
  //
  // `googleAccess` reads the vault, and there is no refresh token until Grant
  // connects. So the token exchange is faked alongside the calendar call: one
  // `fetchImpl` that answers both by URL, which is what the real pair looks
  // like from this function's point of view.
  const fakeGoogle = (events: unknown[]): typeof fetch =>
    (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input)
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(
          JSON.stringify({
            access_token: 'ya29.fixture',
            expires_in: 3599,
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ items: events }), {
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

  const noCredential = await refreshCalendar(db, { fetchImpl: fakeGoogle([]) })
  const connected = noCredential.ok
  if (!connected) {
    record(
      'with no credential it names the step outstanding rather than throwing (§18)',
      noCredential.note,
      noCredential.note.includes('step') || noCredential.note.includes('Connect'),
    )
    record(
      'SKIPPED: the storing checks need a credential, and Google is not connected yet',
      'the reader is exercised by tests/google/auth.test.ts until then',
      true,
    )
  } else {
    const TIMED = {
      id: `evt-timed-${run}`,
      status: 'confirmed',
      summary: 'Supplier call',
      description: 'x'.repeat(900),
      location: 'Zoom',
      start: { dateTime: soon(3) },
      end: { dateTime: soon(4) },
      attendees: [{}, {}, {}],
    }
    const ALLDAY = {
      id: `evt-allday-${run}`,
      status: 'confirmed',
      summary: 'Quarter ends',
      start: { date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
      end: { date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) },
    }

    const first = await refreshCalendar(db, { fetchImpl: fakeGoogle([TIMED, ALLDAY]) })
    record('it stores what Google returned', first.note, first.ok && first.stored === 2)

    const timed = await one(`
      select summary, all_day, attendees, length(excerpt) as excerpt_len, location
        from public.calendar_events
       where calendar_id = ${lit(CAL)} and event_id = ${lit(TIMED.id)}
    `)
    record(
      'a timed event keeps its time, its place and a COUNT of people — never their names',
      `all_day=${String(timed?.all_day)} attendees=${String(timed?.attendees)} excerpt=${String(timed?.excerpt_len)} chars`,
      timed?.all_day === false &&
        Number(timed?.attendees) === 3 &&
        Number(timed?.excerpt_len) <= 300,
    )

    const allday = await one(`
      select all_day from public.calendar_events
       where calendar_id = ${lit(CAL)} and event_id = ${lit(ALLDAY.id)}
    `)
    record(
      'an all-day event is marked as one, so a birthday is not rendered as a midnight meeting',
      `all_day=${String(allday?.all_day)}`,
      allday?.all_day === true,
    )

    // Idempotence: the same pass twice stores the same two events, not four.
    const again = await refreshCalendar(db, { fetchImpl: fakeGoogle([TIMED, ALLDAY]) })
    const count = await one(
      `select count(*)::int as n from public.calendar_events where calendar_id = ${lit(CAL)}`,
    )
    record(
      'refreshing again upserts rather than duplicating',
      `stored=${String(again.stored)} rows=${String(count?.n)}`,
      Number(count?.n) === 2,
    )

    // The disappearance sweep: an event deleted in Google stops coming back,
    // and a diary that keeps meetings nobody is having is worse than an empty
    // one.
    const swept = await refreshCalendar(db, { fetchImpl: fakeGoogle([ALLDAY]) })
    const left = await one(
      `select count(*)::int as n from public.calendar_events where calendar_id = ${lit(CAL)}`,
    )
    record(
      'an event that stopped coming back is removed, not left behind',
      `removed=${String(swept.removed)} rows=${String(left?.n)}`,
      swept.removed === 1 && Number(left?.n) === 1,
    )

    // CONTROL. Without it the sweep above would pass on a reader that deleted
    // everything every pass and re-inserted it.
    record(
      'CONTROL: and the one that DID come back survived, so the sweep is not just a wipe',
      `${String(left?.n)} row(s) left`,
      Number(left?.n) === 1,
    )
  }
} finally {
  await restore()
}

console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)
console.log('configuration restored.')
if (failed.length > 0) process.exit(1)
