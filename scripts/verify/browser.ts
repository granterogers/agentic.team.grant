/**
 * Can the office browse without being able to act, and without polluting what
 * Grant sees?
 *
 *   npm run verify:browser
 *
 * Issues #135 and #16. Three properties, and the first is the one the whole
 * tier rests on:
 *
 *   1. **Gather only.** The ledger refuses an acting verb. Not because a
 *      handler is careful, but because the column will not hold one.
 *   2. **A suite cannot pollute the Browser tab.** 0443, and the sixth time
 *      this repository has had to say it.
 *   3. **Stop is a column.** A job asked to stop ends between steps, and the
 *      steps it already finished stay finished.
 *
 * Everything is driven inside begin and rollback, on a FIXTURE project --
 * which is the right side of #45's question here, because the readers filter
 * harness traffic and property 2 is precisely that they do.
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
const refused = async (sql: string): Promise<string> => {
  try {
    await db.execute(sql)
    return ''
  } catch (error) {
    return String((error as Error).message)
  }
}
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const asJson = (v: unknown): Record<string, unknown> => {
  if (v === null || v === undefined) return {}
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
}
const list = (v: unknown): Record<string, unknown>[] => {
  if (v === null || v === undefined) return []
  return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>[]
}

const run = Math.random().toString(36).slice(2, 8)
const PROJECT = `fixture-browser-${run}`
const REAL = `browser-proof-${run}`

/*
  A fixture project for everything about visibility, and a REAL one for the one
  check that must prove a real row IS shown. #45 asks the question about the
  column the reader filters, and here the reader filters both.
*/
const MAKE = (name: string) => `
  insert into public.projects (slug, name, status)
  values (${lit(name)}, ${lit(name)}, 'active');`
/*
  Referenced by slug in a LATER statement, never by a CTE in the same one.

  A data-modifying CTE's rows are not visible to the rest of its own
  statement, so the first draft of this suite opened a session against a
  project that did not exist yet and read the result back as empty -- which
  looks exactly like a reader that returns nothing.
*/
const ID = (name: string) => `(select project_id from public.projects where slug = ${lit(name)})`
/** The office that project is in: these functions take an office, and the suite's subjects live wherever the bridge put them. */
const OFFICE = (name: string) => `(select office_id from public.projects where slug = ${lit(name)})`
/*
  A scratch table, because a section often needs a writer's ANSWER and a
  reader's answer from the same transaction, and only the last select comes
  back.
*/
const SCRATCH = `create temp table t (k text primary key, v jsonb) on commit drop;`
const KEEP = (key: string, expr: string) => `insert into t values (${lit(key)}, ${expr});`
const GET = (key: string) => `(select v from t where k = ${lit(key)})`

console.log('\nverify:browser — a browser that gathers, and cannot act\n')

// ---------------------------------------------------------------------------
console.log('the session')
section = 'the session'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(PROJECT)}
    ${KEEP('opened', `app.browser_session_open(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'Supplier.Example.COM', 'Read the supplier price list every Monday morning.', null, 'grant')`)}
    ${KEEP('bad', `app.browser_session_open(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'not-a-site', 'Read the supplier price list every Monday morning.', null, 'grant')`)}
    ${KEEP('thin', `app.browser_session_open(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'supplier.example.com', 'stuff', null, 'grant')`)}
    select ${GET('opened')} as opened, ${GET('bad')} as bad_site, ${GET('thin')} as thin,
           app.browser_sessions_for(${OFFICE(PROJECT)}, ${ID(PROJECT)}) as sessions;
    rollback;`)

  const opened = asJson(got.opened)
  ok('a session opens against a host', opened.ok === true, String(opened.site ?? ''))
  ok(
    'and the host is lower-cased rather than taken as typed',
    opened.site === 'supplier.example.com',
  )
  ok(
    'something that is not a host is refused by name',
    String(asJson(got.bad_site).error ?? '').includes('does not look like a site'),
    String(asJson(got.bad_site).error ?? '(nothing was refused)').slice(0, 80),
  )
  ok(
    'a session with no stated purpose is refused, because nobody could audit it',
    String(asJson(got.thin).error ?? '').includes('nobody can audit'),
    String(asJson(got.thin).error ?? '(nothing was refused)').slice(0, 60),
  )
  const sessions = list(got.sessions)
  ok(
    'and it reads back as needing a sign-in, since no jar was stored',
    sessions.length === 1 && sessions[0]?.state === 'needs_sign_in',
    String(sessions[0]?.state ?? 'no session came back'),
  )
  ok(
    'the reader never says whether there is a credential beyond yes or no',
    sessions.length === 1 &&
      sessions[0]?.has_credential === false &&
      !JSON.stringify(sessions[0]).includes('credential_ref'),
  )
}

// ---------------------------------------------------------------------------
console.log('establishing and forgetting')
section = 'establishing and forgetting'
// ---------------------------------------------------------------------------

{
  const JAR = '[{"name":"s","value":"probe-not-a-real-cookie","domain":"supplier.example.com"}]'
  const SESS = `(select session_id from public.browser_sessions
                  where project_id = ${ID(PROJECT)} limit 1)`
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(PROJECT)}
    ${KEEP('junk', `app.browser_session_establish(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'supplier.example.com', 'Read the trade price list every Monday.', 'paste me somewhere else', 'grant')`)}
    ${KEEP('empty', `app.browser_session_establish(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'supplier.example.com', 'Read the trade price list every Monday.', '', 'grant')`)}
    ${KEEP('made', `app.browser_session_establish(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'supplier.example.com', 'Read the trade price list every Monday.', ${lit(JAR)}, 'grant')`)}
    ${KEEP('live', `app.browser_sessions_for(${OFFICE(PROJECT)}, ${ID(PROJECT)})`)}
    ${KEEP(
      'held',
      `to_jsonb((select app.resolve_secret(credential_ref) is not null
                                from public.browser_sessions where session_id = ${SESS}))`,
    )}
    ${KEEP('forgot', `app.browser_session_forget(${OFFICE(PROJECT)}, ${SESS})`)}
    ${KEEP('twice', `app.browser_session_forget(${OFFICE(PROJECT)}, ${SESS})`)}
    select ${GET('junk')} as junk, ${GET('empty')} as empty, ${GET('made')} as made,
           ${GET('live')} as live, ${GET('held')} as held, ${GET('forgot')} as forgot,
           ${GET('twice')} as twice,
           app.browser_sessions_for(${OFFICE(PROJECT)}, ${ID(PROJECT)}) as after;
    rollback;`)

  ok(
    'something that is not browser state is refused by name',
    String(asJson(got.junk).error ?? '').includes('does not look like browser session state'),
    String(asJson(got.junk).error ?? '(it was stored)').slice(0, 70),
  )
  ok(
    'and an empty paste is refused before anything is stored',
    String(asJson(got.empty).error ?? '').includes('signed-in browser state'),
    String(asJson(got.empty).error ?? '(it was stored)').slice(0, 70),
  )
  ok('a real jar establishes the session', asJson(got.made).ok === true)
  ok(
    'and it then reads as live',
    (list(got.live)[0] ?? {}).state === 'live',
    String((list(got.live)[0] ?? {}).state),
  )
  /*
    The control for the refusals above. Without it they would both pass against
    a function that stored nothing whatever it was given.
  */
  ok(
    'because the jar really did reach the Vault',
    got.held === true || got.held === 'true',
    String(got.held),
  )
  ok('forgetting works', asJson(got.forgot).ok === true)
  ok(
    'and pressing Forget twice is not an error — a person may press it again',
    asJson(got.twice).ok === true,
    String(asJson(got.twice).error ?? 'accepted'),
  )
  ok(
    'the session reads as revoked afterwards, with no credential',
    (list(got.after)[0] ?? {}).state === 'revoked' &&
      (list(got.after)[0] ?? {}).has_credential === false,
    String((list(got.after)[0] ?? {}).state),
  )
  ok(
    'and the reader never carries the jar itself, at any point',
    !JSON.stringify(got).includes('probe-not-a-real-cookie'),
  )
}

// ---------------------------------------------------------------------------
console.log('gather only')
section = 'gather only'
// ---------------------------------------------------------------------------

{
  const why = await refused(`
    begin;
    ${MAKE(`${PROJECT}-act`)}
    insert into public.browser_actions (project_id, verb, url, ok)
    values (${ID(`${PROJECT}-act`)}, 'click', 'https://supplier.example.com/buy', true);
    rollback;`)
  ok(
    'the ledger refuses an acting verb — the column will not hold one',
    why.includes('browser_actions_verb_check'),
    why === '' ? 'a click was accepted' : why.slice(0, 110),
  )

  /*
    The control for that refusal. A CHECK can be widened until it refuses
    nothing and every run of the check above would go on reading green, so the
    same statement with a permitted verb must SUCCEED. A refusal for the wrong
    reason looks exactly like the rule working.
  */
  const good = await refused(`
    begin;
    ${MAKE(`${PROJECT}-read`)}
    insert into public.browser_actions (project_id, verb, url, ok)
    values (${ID(`${PROJECT}-read`)}, 'read', 'https://supplier.example.com/prices', true);
    rollback;`)
  ok(
    'and accepts a reading verb, so the refusal above is about the verb',
    good === '',
    good.slice(0, 90),
  )

  const capability = await one(`
    select count(*) filter (where reach = 'none')::int as refused,
           count(*) filter (where reach = 'browser_only')::int as offered
      from public.connector_capabilities where connector = 'browser'`)
  ok(
    'and the capability sheet an agent reads says so too, in both directions',
    Number(capability.refused) >= 2 && Number(capability.offered) >= 1,
    `${String(capability.offered)} can, ${String(capability.refused)} cannot`,
  )
}

// ---------------------------------------------------------------------------
console.log('the ledger is append-only')
section = 'the ledger is append-only'
// ---------------------------------------------------------------------------

{
  const why = await refused(`
    begin;
    ${MAKE(`${PROJECT}-ap`)}
    insert into public.browser_actions (project_id, verb, url, ok)
    values (${ID(`${PROJECT}-ap`)}, 'read', 'https://x.example.com/', true);
    update public.browser_actions set detail = 'rewritten'
     where project_id = ${ID(`${PROJECT}-ap`)};
    rollback;`)
  /*
    Asserted on the WORDS. A first draft accepted any throw and reported a
    PASS while the statement was failing on a column that does not exist --
    a refusal for the wrong reason looks exactly like the rule working.
  */
  ok(
    'a browsing row cannot be rewritten afterwards',
    /append|immutable|ledger|cannot be (changed|updated|modified)/i.test(why),
    why === '' ? 'the update was accepted' : why.slice(0, 110),
  )
}

// ---------------------------------------------------------------------------
console.log('harness traffic is invisible to the Browser tab')
section = 'harness traffic is invisible'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${MAKE(PROJECT)}
    ${MAKE(REAL)}
    insert into public.browser_actions (project_id, verb, url, ok, ms)
    values (${ID(PROJECT)}, 'read', 'https://x.example.com/fixture', true, 1000),
           (${ID(REAL)}, 'read', 'https://x.example.com/real', true, 2000);
    select (select count(*)::int from public.browser_actions
             where project_id in (${ID(PROJECT)}, ${ID(REAL)})) as written,
           app.browser_lately(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 10) as fixture_side,
           app.browser_lately(${OFFICE(REAL)}, ${ID(REAL)}, 10) as real_side,
           app.browser_budget(${OFFICE(PROJECT)}) as budget;
    rollback;`)

  ok('both rows were written', Number(got.written) === 2)
  ok(
    'a fixture project shows nothing on the Browser tab',
    list(got.fixture_side).length === 0,
    `${String(list(got.fixture_side).length)} row(s)`,
  )
  /*
    The control. Without it, a filter that hid everything would pass the check
    above -- which is the found-nothing shape this repository has been caught
    by three times.
  */
  ok(
    'and a real project shows its row, so the filter is about the harness',
    list(got.real_side).length === 1,
    `${String(list(got.real_side).length)} row(s)`,
  )
  const budget = asJson(got.budget)
  ok(
    'the MINUTE budget counts the harness anyway, because Cloudflare bills for it',
    Number(budget.harness_actions_today) >= 1,
    `${String(budget.harness_actions_today)} harness action(s) counted today`,
  )
  ok(
    'and reports a cap, a spend and what is left',
    Number(budget.cap_minutes) > 0 &&
      Number(budget.left_minutes) <= Number(budget.cap_minutes) &&
      typeof budget.exhausted === 'boolean',
    `cap ${String(budget.cap_minutes)}, left ${String(budget.left_minutes)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('a page the office read is a source')
section = 'a page is a source'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(PROJECT)}
    ${KEEP('first', `app.record_browser_page(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'https://supplier.example.com/prices', 'Prices', 'Widget A costs forty pounds.', null)`)}
    ${KEEP('again', `app.record_browser_page(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'https://supplier.example.com/prices', 'Prices, updated', 'Widget A costs forty five pounds.', null)`)}
    ${KEEP('empty', `app.record_browser_page(${OFFICE(PROJECT)}, ${ID(PROJECT)}, 'https://supplier.example.com/empty', 'Nothing', '   ', null)`)}
    select ${GET('first')} as first, ${GET('again')} as again, ${GET('empty')} as empty,
           (select origin from public.documents
             where document_id = (${GET('first')} ->> 'document_id')::uuid) as origin,
           (select content from public.documents
             where document_id = (${GET('again')} ->> 'document_id')::uuid) as content;
    rollback;`)

  const first = asJson(got.first)
  const again = asJson(got.again)
  ok('the words are kept as a document', first.ok === true)
  ok(
    'reading the same URL again updates it rather than making a second copy',
    first.document_id === again.document_id,
    `${String(first.document_id).slice(0, 8)} vs ${String(again.document_id).slice(0, 8)}`,
  )
  ok('and the second read is what is stored', String(got.content ?? '').includes('forty five'))
  ok(
    "its origin is 'source' — the office looked at it, it did not write it",
    got.origin === 'source',
    String(got.origin),
  )
  ok(
    'a page with no words on it is refused rather than kept as an empty document',
    String(asJson(got.empty).error ?? '').includes('no words'),
    String(asJson(got.empty).error ?? '(it was kept)').slice(0, 60),
  )
}

// ---------------------------------------------------------------------------
console.log('stop is a column')
section = 'stop is a column'
// ---------------------------------------------------------------------------

{
  const JOB = `(select job_id from public.jobs where requested_by = ${lit(`verify:browser-${run}`)} limit 1)`
  const got = await one(`
    begin;
    ${SCRATCH}
    ${MAKE(PROJECT)}
    insert into public.jobs (project_id, correlation_id, idempotency_key, kind,
                             requested_by, state, intent_class)
    values (${ID(PROJECT)}, gen_random_uuid(), ${lit(`verify:browser-${run}`)}, 'browser.gather',
            ${lit(`verify:browser-${run}`)}, 'running', 'direct_command');
    ${KEEP('before', `to_jsonb(app.stop_requested(${JOB}))`)}
    ${KEEP('asked', `app.request_stop(${JOB}, 'grant')`)}
    ${KEEP('after', `to_jsonb(app.stop_requested(${JOB}))`)}
    select ${GET('before')} as before, ${GET('asked')} as asked, ${GET('after')} as after;
    rollback;`)

  ok('a running job is not stopped to begin with', got.before === false || got.before === 'false')
  ok('asking is accepted', asJson(got.asked).ok === true)
  ok('and the job then reads as stop-requested', got.after === true || got.after === 'true')

  const done = await one(`
    begin;
    ${MAKE(PROJECT)}
    insert into public.jobs (project_id, correlation_id, idempotency_key, kind,
                             requested_by, state, intent_class, finished_at)
    values (${ID(PROJECT)}, gen_random_uuid(), ${lit(`verify:browser-done-${run}`)}, 'browser.gather',
            ${lit(`verify:browser-done-${run}`)}, 'complete', 'direct_command', app.now_utc());
    select app.request_stop((select job_id from public.jobs
             where requested_by = ${lit(`verify:browser-done-${run}`)} limit 1), 'grant') as asked;
    rollback;`)
  ok(
    'a job that already finished is told there is nothing to stop, not silently marked',
    asJson(done.asked).ok === false,
    String(asJson(done.asked).note ?? '').slice(0, 70),
  )
}

// ---------------------------------------------------------------------------
console.log('nothing was left behind')
section = 'nothing was left behind'
// ---------------------------------------------------------------------------

{
  const left = await one(`
    select (select count(*) from public.projects where slug like ${lit(`%browser-${run}%`)}
             or slug like ${lit(`%browser-proof-${run}%`)})::int as projects,
           (select count(*) from public.browser_actions a
             join public.projects p on p.project_id = a.project_id
            where p.slug like ${lit(`%browser%${run}%`)})::int as actions`)
  ok(
    'every section rolled back — no project and no permanent ledger row survives',
    Number(left.projects) === 0 && Number(left.actions) === 0,
    `${String(left.projects)} project(s), ${String(left.actions)} action(s)`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
