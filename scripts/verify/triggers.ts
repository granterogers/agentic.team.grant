/**
 * Does something happening start the right work, and refuse to start the
 * wrong work?
 *
 *   npm run verify:triggers
 *
 * Issue #264. Most of this suite is about the REFUSALS, because an event
 * system fails by doing too much: a duplicate webhook, a burst of a hundred,
 * a trigger whose action produces another matching event, a reconnect
 * replaying last week. Each of those has a rule in 0438 and a check here.
 *
 * Driven at the database inside `begin … rollback`. The thing under test is a
 * decision, and every input to it is a row.
 *
 * No backticks in any comment inside a template literal below.
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let pass = 0
let fail = 0
let section = '(before the first section)'
const ok = (what: string, good: boolean, note = '') => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> => {
  try {
    return ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
  } catch (error) {
    ok(`${section} could not run at all`, false, String((error as Error).message).slice(0, 170))
    return {}
  }
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const asJson = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {}
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
}
const run = Math.random().toString(36).slice(2, 10)

console.log('\nverify:triggers — something happens, and the office starts the right work\n')

const SLUG = `fixture-triggers-${run}`
const PROJECT = `(select project_id from public.projects where slug = ${lit(SLUG)})`

/**
 * A trigger and a project, with whatever limits the case needs.
 *
 * Takes the extra columns as a plain object rather than as a string the helper
 * splits on an arrow, which is what the first version did and which esbuild
 * refused at the first case that needed a quoted JSON filter.
 */
const SETUP = (extra: Readonly<Record<string, string>> = {}): string => {
  const cols = Object.keys(extra)
  return `
  insert into public.projects (name, slug, status)
  values (${lit(`Fixture triggers ${run}`)}, ${lit(SLUG)}, 'paused');
  insert into public.event_triggers
    (name, source, event_type, project_id, job_kind, recipient_agent, created_by${cols
      .map((c) => `, ${c}`)
      .join('')})
  values (${lit(`fixture-trigger-${run}`)}, 'office', 'document.added', ${PROJECT},
          'office.instruction', 'research-director', 'verify'${cols
            .map((c) => `, ${extra[c] ?? 'null'}`)
            .join('')});
`
}

const SIGNAL = (ref: string, extra = 'null, null'): string => `
  app.record_signal('office', 'document.added', ${lit(ref)}, ${PROJECT},
                    'A document called something', '{"connector": "drive"}'::jsonb, ${extra})`

// ---------------------------------------------------------------------------
console.log('something happens and work starts')
section = 'something happens and work starts'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP()}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'sig', ${SIGNAL('doc-1')};
    insert into r select 'fire', app.fire_triggers_for(
      ((select v from r where k = 'sig') ->> 'signal')::uuid);
    select (select v from r where k = 'fire') -> 'triggers' -> 0 as decided,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs,
           (select pinned_config -> 'event' ->> 'summary' from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as carried,
           (select recipient_agent from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as who;
    rollback;`)

  const decided = asJson(got.decided)
  ok(
    'a matching signal starts a real job on the ordinary queue',
    decided.decision === 'fired' && Number(got.jobs) === 1,
    `${String(decided.decision)}, ${String(got.jobs)} job(s)`,
  )
  ok(
    'the job carries what happened, so the handler does not have to go and ask',
    String(got.carried ?? '').includes('A document called'),
    String(got.carried ?? ''),
  )
  ok(
    'and it goes to the specialist the trigger names',
    got.who === 'research-director',
    String(got.who),
  )
}

// ---------------------------------------------------------------------------
console.log('\nand the ways it must refuse')
section = 'the ways it must refuse'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP()}
    create temp table r (k text, v jsonb) on commit drop;
    -- The same webhook delivered twice is one signal.
    insert into r select 'a', ${SIGNAL('doc-same')};
    insert into r select 'b', ${SIGNAL('doc-same')};
    select (select v from r where k = 'b') ->> 'duplicate' as dupe,
           ((select v from r where k = 'a') ->> 'signal')
             = ((select v from r where k = 'b') ->> 'signal') as same,
           (select count(*) from public.signals where external_ref = 'doc-same') as rows;
    rollback;`)

  ok(
    'a duplicate delivery is the same signal, not a second one',
    got.dupe === 'true' && got.same === true && Number(got.rows) === 1,
    `duplicate=${String(got.dupe)} rows=${String(got.rows)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP({ filters: `'{"detail.connector": "notion"}'::jsonb` })}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'sig', ${SIGNAL('doc-2')};
    insert into r select 'fire', app.fire_triggers_for(
      ((select v from r where k = 'sig') ->> 'signal')::uuid);
    select (select v from r where k = 'fire') -> 'triggers' -> 0 as decided,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs;
    rollback;`)

  const decided = asJson(got.decided)
  ok(
    'a filter that does not match starts nothing, and says which filter',
    decided.decision === 'filtered_out' && Number(got.jobs) === 0,
    `${String(decided.decision)}: ${String(decided.why)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP({ cooldown_seconds: '3600' })}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'one', app.fire_triggers_for((${SIGNAL('doc-3')} ->> 'signal')::uuid);
    insert into r select 'two', app.fire_triggers_for((${SIGNAL('doc-4')} ->> 'signal')::uuid);
    select (select v from r where k = 'one') -> 'triggers' -> 0 ->> 'decision' as first,
           (select v from r where k = 'two') -> 'triggers' -> 0 as second,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs;
    rollback;`)

  const second = asJson(got.second)
  ok(
    'a second event inside the cooldown starts nothing, and says how long is left',
    got.first === 'fired' && second.decision === 'cooling_down' && Number(got.jobs) === 1,
    `${String(second.why)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP({ max_per_hour: '2' })}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'a', app.fire_triggers_for((${SIGNAL('doc-a')} ->> 'signal')::uuid);
    insert into r select 'b', app.fire_triggers_for((${SIGNAL('doc-b')} ->> 'signal')::uuid);
    insert into r select 'c', app.fire_triggers_for((${SIGNAL('doc-c')} ->> 'signal')::uuid);
    insert into r select 'd', app.fire_triggers_for((${SIGNAL('doc-d')} ->> 'signal')::uuid);
    select (select v from r where k = 'c') -> 'triggers' -> 0 ->> 'decision' as third,
           (select v from r where k = 'd') -> 'triggers' -> 0 ->> 'why' as fourth_why,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs;
    rollback;`)

  ok(
    'a burst is capped at the rate limit rather than starting a hundred jobs',
    got.third === 'rate_limited' && Number(got.jobs) === 2,
    `${String(got.jobs)} job(s) from 4 events — ${String(got.fourth_why)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP()}
    create temp table r (k text, v jsonb) on commit drop;
    -- One event fires and makes a job. That job then causes another event.
    insert into r select 'one', app.fire_triggers_for((${SIGNAL('doc-loop-1')} ->> 'signal')::uuid);
    insert into r select 'two', app.fire_triggers_for((
      app.record_signal('office', 'document.added', 'doc-loop-2', ${PROJECT},
        'Something the job itself made', '{"connector": "drive"}'::jsonb,
        ((select v from r where k = 'one') -> 'triggers' -> 0 ->> 'job')::uuid, null)
      ->> 'signal')::uuid);
    select (select v from r where k = 'two') -> 'triggers' -> 0 as second,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs;
    rollback;`)

  const second = asJson(got.second)
  ok(
    'a trigger whose own job caused the next event does not fire again',
    second.decision === 'would_have_looped' && Number(got.jobs) === 1,
    `${String(second.decision)}: ${String(second.why)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP({ not_before_event_at: 'app.now_utc()' })}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'old', app.fire_triggers_for((
      app.record_signal('office', 'document.added', 'doc-old', ${PROJECT},
        'Something from last week', '{"connector": "drive"}'::jsonb, null,
        app.now_utc() - interval '7 days') ->> 'signal')::uuid);
    select (select v from r where k = 'old') -> 'triggers' -> 0 ->> 'decision' as decided,
           (select count(*) from public.jobs
             where requested_by = ${lit(`trigger:fixture-trigger-${run}`)}) as jobs;
    rollback;`)

  ok(
    'reconnecting after downtime does not act on last week',
    got.decided === 'too_old' && Number(got.jobs) === 0,
    `${String(got.decided)}`,
  )
}

{
  const got = await one(`
    begin;
    ${SETUP({ enabled: 'false' })}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'off', app.fire_triggers_for((${SIGNAL('doc-off')} ->> 'signal')::uuid);
    select (select v from r where k = 'off') -> 'triggers' -> 0 ->> 'decision' as decided,
           (select count(*) from public.trigger_firings) > 0 as recorded;
    rollback;`)

  ok(
    'a switched-off trigger starts nothing AND records that it declined',
    got.decided === 'disabled' && got.recorded === true,
    `${String(got.decided)}, recorded=${String(got.recorded)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nwhat the office notices by itself')
section = 'what the office notices by itself'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    insert into public.projects (name, slug, status)
    values (${lit(`Triggers real ${run}`)}, ${lit(`triggers-real-${run}`)}, 'active');
    insert into public.documents
      (project_id, title, doc_type, connector, content, origin, state,
       content_fingerprint, content_chars, fetched_at)
    values ((select project_id from public.projects where slug = ${lit(`triggers-real-${run}`)}),
            'An arriving document', 'note', 'drive', 'words', 'yours', 'draft', encode(extensions.digest('words', 'sha256'), 'hex'), 5, app.now_utc());
    select (select count(*) from public.signals
             where source = 'office' and event_type = 'document.added'
               and project_id = (select project_id from public.projects
                                  where slug = ${lit(`triggers-real-${run}`)})) as noticed,
           (select detail ->> 'connector' from public.signals
             where project_id = (select project_id from public.projects
                                  where slug = ${lit(`triggers-real-${run}`)})) as connector;
    rollback;`)

  ok(
    'a document arriving is noticed, with no adapter and no webhook',
    Number(got.noticed) === 1 && got.connector === 'drive',
    `${String(got.noticed)} signal(s), connector=${String(got.connector)}`,
  )
}

{
  const got = await one(`
    begin;
    insert into public.projects (name, slug, status)
    values (${lit(`Fixture notnews ${run}`)}, ${lit(`fixture-notnews-${run}`)}, 'paused');
    insert into public.documents
      (project_id, title, doc_type, connector, content, origin, state,
       content_fingerprint, content_chars, fetched_at)
    values ((select project_id from public.projects where slug = ${lit(`fixture-notnews-${run}`)}),
            'A fixture document', 'note', 'drive', 'words', 'yours', 'draft', encode(extensions.digest('words', 'sha256'), 'hex'), 5, app.now_utc());
    select (select count(*) from public.signals
             where project_id = (select project_id from public.projects
                                  where slug = ${lit(`fixture-notnews-${run}`)})) as noticed;
    rollback;`)

  ok(
    'CONTROL: a document arriving on a FIXTURE project is not news',
    Number(got.noticed) === 0,
    `${String(got.noticed)} signal(s)`,
  )
}

{
  /*
    The consumer, and the CONTROL that it is bounded by age.

    A signal from before a restart is not news, and firing it is the
    replay-after-downtime failure. It stays undecided rather than firing, which
    is also why the row is left behind: it happened, and the record should say
    so.
  */
  const got = await one(`
    begin;
    ${SETUP()}
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'now', ${SIGNAL('doc-fresh')};
    insert into r select 'old', ${SIGNAL('doc-stale')};
    update public.signals set received_at = app.now_utc() - interval '3 hours'
     where external_ref = 'doc-stale';
    insert into r select 'swept', app.fire_pending_signals(20);
    select (select count(*) from public.trigger_firings f
             join public.signals s using (signal_id) where s.external_ref = 'doc-fresh') as fresh,
           (select count(*) from public.trigger_firings f
             join public.signals s using (signal_id) where s.external_ref = 'doc-stale') as stale;
    rollback;`)

  ok(
    'the tick decides about a signal nobody has looked at',
    Number(got.fresh) === 1,
    `${String(got.fresh)} decision(s) on the fresh one`,
  )
  ok(
    'CONTROL: and leaves a signal from three hours ago alone',
    Number(got.stale) === 0,
    `${String(got.stale)} decision(s) on the stale one`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nand a person can see what every trigger is doing')
section = 'a person can see what every trigger is doing'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SETUP({ cooldown_seconds: '3600' })}
    select app.fire_triggers_for((${SIGNAL('doc-h1')} ->> 'signal')::uuid);
    select app.fire_triggers_for((${SIGNAL('doc-h2')} ->> 'signal')::uuid);
    select x as health from jsonb_array_elements(app.trigger_health()) x
     where x ->> 'name' = ${lit(`fixture-trigger-${run}`)};
    rollback;`)

  const health = asJson(got.health)
  ok(
    'the health shows what fired AND what was declined, which is the only way to tell',
    Number(health.fired) === 1 && Number(health.declined) === 1,
    `fired=${String(health.fired)} declined=${String(health.declined)}`,
  )
  ok(
    'and says why the last one was declined, in words',
    String(asJson(health.last_declined).why ?? '').includes('cooldown'),
    String(asJson(health.last_declined).why ?? '').slice(0, 70),
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
