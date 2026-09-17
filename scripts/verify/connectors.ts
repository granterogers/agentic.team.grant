/**
 * Does discovering what a provider can do let anybody do it?
 *
 *   npm run verify:connectors
 *
 * Issue #265, and the whole suite is one sentence of it:
 *
 *   > *"A provider may advertise `mail.read`, `mail.send`, `contacts.delete`.
 *   > The office may discover all three. That does NOT grant any agent
 *   > authority to use them."*
 *
 * So the happy path is two checks and the rest is the gap between discovery
 * and permission, examined from both sides: nothing reachable after
 * discovery, nothing reachable after OFFERING, and `app.staff_may_use` — the
 * authority — saying no at every stage until somebody switches it on.
 *
 * Driven inside `begin … rollback`. The provider is fictional and no network
 * call is made: the client is unit-tested against a fake server, and what this
 * tests is the governance, which is all rows.
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
const run = Math.random().toString(36).slice(2, 8)
const NAME = `probe${run}`

console.log('\nverify:connectors — discovering what a provider can do is not letting it\n')

/** Three tools, one of each reach, which is the Issue's own example. */
const ADVERTISED = `jsonb_build_array(
  jsonb_build_object('name', 'search_messages',
    'description', 'Search the mailbox and return matching messages'),
  jsonb_build_object('name', 'send_message',
    'description', 'Send an email on the user behalf'),
  jsonb_build_object('name', 'delete_contact',
    'description', 'Permanently remove a contact'),
  jsonb_build_object('name', 'frobnicate',
    'description', 'Frobnicates the widget'))`

const PROVIDER = `(select provider_id from public.mcp_providers where name = ${lit(NAME)})`
const REGISTER = `
  select app.register_mcp_provider(${lit(NAME)}, 'https://example.test/mcp',
                                   'A Probe Provider', 'none', null, 'fixture');`

// ---------------------------------------------------------------------------
console.log('registering and discovering')
section = 'registering and discovering'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'reg', app.register_mcp_provider(${lit(NAME)},
      'https://example.test/mcp', 'A Probe Provider', 'none', null, 'fixture');
    insert into r select 'again', app.register_mcp_provider(${lit(NAME)},
      'https://example.test/mcp', 'A Probe Provider', 'none', null, 'fixture');
    insert into r select 'plain', app.register_mcp_provider('plain${run}',
      'http://example.test/mcp', '', 'bearer', null, '');
    insert into r select 'rec', app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});

    select (select v from r where k = 'reg') ->> 'ok' as registered,
           (select v from r where k = 'again') ->> 'error' as twice,
           (select v from r where k = 'plain') ->> 'error' as plain,
           (select v from r where k = 'rec') ->> 'seen' as seen,
           (select count(*) from public.mcp_discovered_tools
             where provider_id = ${PROVIDER}) as rows,
           (select count(*) from public.tool_permissions
             where delivered_by = ${lit(`mcp:${NAME}`)}) as granted;
    rollback;`)

  ok('a provider can be registered', got.registered === 'true', String(got.registered))
  ok(
    'CONTROL: and not twice under the same name',
    String(got.twice ?? '').includes('already registered'),
    String(got.twice ?? '').slice(0, 50),
  )
  ok(
    'CONTROL: and never over plain http, which would put a token on the wire',
    String(got.plain ?? '').includes('https'),
    String(got.plain ?? '').slice(0, 50),
  )
  ok(
    'what it advertises is written down',
    Number(got.seen) === 4 && Number(got.rows) === 4,
    `${String(got.seen)} seen, ${String(got.rows)} row(s)`,
  )
  /*
    THE invariant. Four tools discovered, one of them a delete, and the office
    has gained nothing at all.
  */
  ok(
    'CONTROL: and NOTHING is granted by discovering it',
    Number(got.granted) === 0,
    `${String(got.granted)} capability row(s) after discovering 4 tools`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nwhat the office thinks each one does')
section = 'what the office thinks each one does'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    select jsonb_object_agg(external_name, reach) as reaches,
           (select why_that_reach from public.mcp_discovered_tools
             where provider_id = ${PROVIDER} and external_name = 'delete_contact') as why
      from public.mcp_discovered_tools where provider_id = ${PROVIDER};
    rollback;`)

  const reaches = asJson(got.reaches)
  ok(
    'a search is read, a send is write, a delete is destructive',
    reaches.search_messages === 'read' &&
      reaches.send_message === 'write' &&
      reaches.delete_contact === 'destructive',
    JSON.stringify(reaches),
  )
  ok(
    'and something nobody can classify is UNKNOWN rather than assumed harmless',
    reaches.frobnicate === 'unknown',
    `frobnicate = ${String(reaches.frobnicate)}`,
  )
  ok(
    'the guess says why, so a person can disagree with it',
    String(got.why ?? '').includes('removes something'),
    String(got.why ?? '').slice(0, 60),
  )
}

// ---------------------------------------------------------------------------
console.log('\noffering one, which still grants nothing')
section = 'offering one'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'offer', app.offer_mcp_tool(
      (select discovered_id from public.mcp_discovered_tools
        where provider_id = ${PROVIDER} and external_name = 'delete_contact'));
    insert into r select 'again', app.offer_mcp_tool(
      (select discovered_id from public.mcp_discovered_tools
        where provider_id = ${PROVIDER} and external_name = 'delete_contact'));
    insert into r select 'unknown', app.offer_mcp_tool(
      (select discovered_id from public.mcp_discovered_tools
        where provider_id = ${PROVIDER} and external_name = 'frobnicate'));

    select (select v from r where k = 'offer') as offered,
           (select v from r where k = 'again') ->> 'already' as twice,
           (select v from r where k = 'unknown') ->> 'level' as unknown_level,
           (select enabled from public.tool_permissions
             where tool = ((select v from r where k = 'offer') ->> 'tool')) as enabled,
           (select disabled_reason from public.tool_permissions
             where tool = ((select v from r where k = 'offer') ->> 'tool')) as why,
           (select delivered_by from public.tool_permissions
             where tool = ((select v from r where k = 'offer') ->> 'tool')) as delivered_by,
           (select count(*) from public.tool_permissions
             where delivered_by = ${lit(`mcp:${NAME}`)} and enabled) as usable;
    rollback;`)

  const offered = asJson(got.offered)
  ok(
    'a discovered tool becomes a capability the office has a name for',
    offered.tool === `${NAME}.delete_contact` && Number(offered.level) === 3,
    `${String(offered.tool)} at level ${String(offered.level)}`,
  )
  ok(
    'CONTROL: and it is DISABLED, with a reason naming where it came from',
    got.enabled === false && String(got.why ?? '').includes(NAME),
    `enabled=${String(got.enabled)} — ${String(got.why ?? '').slice(0, 60)}`,
  )
  ok(
    'CONTROL: so nothing from this provider is usable even after offering it',
    Number(got.usable) === 0,
    `${String(got.usable)} usable`,
  )
  ok(
    'what delivers it is recorded, so the claim is checkable (0298)',
    got.delivered_by === `mcp:${NAME}`,
    String(got.delivered_by),
  )
  ok(
    'CONTROL: offering the same tool twice is idempotent',
    got.twice === 'true',
    `already=${String(got.twice)}`,
  )
  ok(
    'CONTROL: an UNKNOWN reach is offered as a write, not as a read',
    Number(got.unknown_level) === 2,
    `level ${String(got.unknown_level)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\nthe authority still says no')
section = 'the authority still says no'
// ---------------------------------------------------------------------------

{
  /*
    The other side of the invariant, asked of the thing that actually decides.

    `app.staff_may_use` is the authority, and it must refuse a discovered tool
    at every stage: before it is offered (there is no such tool), and after it
    is offered (there is, and it is off).
  */
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    create temp table r (k text, v text) on commit drop;
    insert into r select 'before', app.staff_may_use('chief-of-staff',
      ${lit(`${NAME}.delete_contact`)})::text;
    select app.offer_mcp_tool((select discovered_id from public.mcp_discovered_tools
      where provider_id = ${PROVIDER} and external_name = 'delete_contact'));
    insert into r select 'after', app.staff_may_use('chief-of-staff',
      ${lit(`${NAME}.delete_contact`)})::text;
    select (select v from r where k = 'before') as before,
           (select v from r where k = 'after') as after;
    rollback;`)

  ok(
    'the authority refuses a discovered tool before it is offered',
    String(got.before ?? '').includes('false'),
    String(got.before ?? '').slice(0, 60),
  )
  ok(
    'CONTROL: and still refuses it after it is offered, because offering is not granting',
    String(got.after ?? '').includes('false'),
    String(got.after ?? '').slice(0, 60),
  )
}

// ---------------------------------------------------------------------------
console.log('\ndisappearing, and disconnecting')
section = 'disappearing and disconnecting'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    -- A second discovery in which the delete is no longer offered.
    select app.record_mcp_tools(${PROVIDER}, jsonb_build_array(
      jsonb_build_object('name', 'search_messages', 'description', 'Search the mailbox')));
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'gone_offer', app.offer_mcp_tool(
      (select discovered_id from public.mcp_discovered_tools
        where provider_id = ${PROVIDER} and external_name = 'delete_contact'));
    select (select count(*) from public.mcp_discovered_tools
             where provider_id = ${PROVIDER} and vanished_at is not null) as vanished,
           (select count(*) from public.mcp_discovered_tools
             where provider_id = ${PROVIDER}) as still_recorded,
           (select v from r where k = 'gone_offer') ->> 'error' as refused;
    rollback;`)

  ok(
    'a tool the provider stopped offering is marked gone, not deleted',
    Number(got.vanished) === 3 && Number(got.still_recorded) === 4,
    `${String(got.vanished)} gone of ${String(got.still_recorded)} recorded`,
  )
  ok(
    'CONTROL: and a tool that is gone cannot be offered',
    String(got.refused ?? '').includes('no longer offered'),
    String(got.refused ?? '').slice(0, 60),
  )
}

{
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    select app.offer_mcp_tool((select discovered_id from public.mcp_discovered_tools
      where provider_id = ${PROVIDER} and external_name = 'search_messages'));
    -- Approved the ordinary way, so there is something to lose.
    update public.tool_permissions set enabled = true, disabled_reason = null
     where tool = ${lit(`${NAME}.search_messages`)};
    create temp table r (k text, v jsonb) on commit drop;
    insert into r select 'revoke', app.revoke_mcp_provider(${PROVIDER}, 'no longer needed');
    insert into r select 'after', app.offer_mcp_tool(
      (select discovered_id from public.mcp_discovered_tools
        where provider_id = ${PROVIDER} and external_name = 'send_message'));

    select (select v from r where k = 'revoke') ->> 'tools_disabled' as disabled,
           (select enabled from public.tool_permissions
             where tool = ${lit(`${NAME}.search_messages`)}) as still_on,
           (select count(*) from public.tool_permissions
             where tool = ${lit(`${NAME}.search_messages`)}) as still_there,
           (select v from r where k = 'after') ->> 'error' as after;
    rollback;`)

  ok(
    'disconnecting a provider switches off everything it delivered',
    Number(got.disabled) === 1 && got.still_on === false,
    `${String(got.disabled)} disabled, still enabled=${String(got.still_on)}`,
  )
  ok(
    'CONTROL: the rows are kept, because a listed gap can become a proposal (0298)',
    Number(got.still_there) === 1,
    `${String(got.still_there)} row(s) kept`,
  )
  ok(
    'CONTROL: and nothing more can be offered from a disconnected provider',
    String(got.after ?? '').includes('disconnected'),
    String(got.after ?? '').slice(0, 50),
  )
}

// ---------------------------------------------------------------------------
console.log('\nand what a person is shown')
section = 'what a person is shown'
// ---------------------------------------------------------------------------

{
  const got = await one(`
    begin;
    ${REGISTER}
    select app.record_mcp_tools(${PROVIDER}, ${ADVERTISED});
    select app.offer_mcp_tool((select discovered_id from public.mcp_discovered_tools
      where provider_id = ${PROVIDER} and external_name = 'search_messages'));
    select x as inv from jsonb_array_elements(app.mcp_inventory()) x
     where x ->> 'name' = ${lit(NAME)};
    rollback;`)

  const inv = asJson(got.inv)
  ok(
    'the inventory separates what was discovered, what was offered and what is USABLE',
    Number(inv.discovered) === 4 && Number(inv.offered) === 1 && Number(inv.usable) === 0,
    `discovered=${String(inv.discovered)} offered=${String(inv.offered)} usable=${String(inv.usable)}`,
  )
  ok(
    'and lists each tool with the reach the office guessed',
    ((inv.tools ?? []) as { reach: string }[]).filter((t) => t.reach === 'destructive').length ===
      1,
    `${String(((inv.tools ?? []) as unknown[]).length)} tool(s) listed`,
  )
}

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
