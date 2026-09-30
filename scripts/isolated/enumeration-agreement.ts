/**
 * V7 / D16 - the lists written twice agree, on the replica and so in the gate.
 *
 *   npx tsx scripts/isolated/enumeration-agreement.ts <replica-db>
 *
 * Two enumerations exist in both SQL and TypeScript: the job state machine and the channel vocabulary. The state
 * half had `verify:transitions`, which needs the production token and so never ran in the isolated gate; the channel
 * half had nothing. Both are compared here from the database's own catalog, by PROPERTY: every CHECK that lists
 * channels (found by content, not by name, so a new table is covered the day it is written) must be exactly the
 * channel vocabulary, bar the named exceptions. A detector that cannot fail proves nothing, so a constraint that
 * disagrees is planted inside a rolled-back statement and must be reported.
 */
import { CHANNELS } from '../../src/channels/preferences.ts'
import { ALLOWED_TRANSITIONS, JOB_STATES } from '../../src/jobs/states.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'enum')
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

// ---- job states ---------------------------------------------------------------------------------------------
const enumStates = (
  await db.execute(
    `select e.enumlabel::text as l from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'job_state' order by e.enumsortorder`,
  )
).rows.map((r) => String((r as { l: string }).l))
check(
  'the job_state enum is exactly JOB_STATES, in order',
  enumStates.length === JOB_STATES.length && enumStates.every((s, i) => s === JOB_STATES[i]),
  `${enumStates.length} vs ${JOB_STATES.length}`,
)
const dbEdges = new Set(
  (
    await db.execute(
      `select from_state::text as f, to_state::text as t from app.job_transitions_allowed`,
    )
  ).rows.map((r) => `${String((r as { f: string }).f)}->${String((r as { t: string }).t)}`),
)
const tsEdges = new Set(
  Object.entries(ALLOWED_TRANSITIONS).flatMap(([f, ts]) => ts.map((t) => `${f}->${t}`)),
)
const onlyDb = [...dbEdges].filter((e) => !tsEdges.has(e))
const onlyTs = [...tsEdges].filter((e) => !dbEdges.has(e))
check(
  'the transition allow-list is the same in SQL and TypeScript',
  onlyDb.length === 0 && onlyTs.length === 0 && dbEdges.size > 0,
  `${dbEdges.size} edges; only SQL ${JSON.stringify(onlyDb)}, only TS ${JSON.stringify(onlyTs)}`,
)

// ---- channels -----------------------------------------------------------------------------------------------
/** Named exceptions, each with its reason: a list allowed to differ from the vocabulary, and how. */
const EXCEPTIONS: Record<string, { extra: string[]; why: string; swap?: [string, string] }> = {
  feedback_channel_known: { extra: ['email'], why: 'a thumbs-up can arrive from a mail reply' },
  subject_identities_channel_known: {
    extra: [],
    swap: ['teamhq', 'web'],
    why: 'a sender identity is proven through a web sign-in, which is its own namespace (D21, bounded naming)',
  },
  test_origins_channel_check: {
    extra: ['mcp'],
    why: 'a test can declare an MCP client conversation',
  },
}
const channelLists = async (exec: { execute: typeof db.execute }) =>
  (
    await exec.execute(
      `select conrelid::regclass::text as t, conname::text as n, pg_get_constraintdef(oid) as d
         from pg_constraint
        where contype = 'c' and conname ~ '(channel|origin)' and pg_get_constraintdef(oid) ~ 'slack'
          and pg_get_constraintdef(oid) ~ 'telegram'`,
    )
  ).rows.map((r) => {
    const row = r as { t: string; n: string; d: string }
    return {
      table: row.t,
      name: row.n,
      words: [...row.d.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1] as string),
    }
  })
const disagreements = (lists: Awaited<ReturnType<typeof channelLists>>) =>
  lists.filter((l) => {
    const ex = EXCEPTIONS[l.name]
    const base =
      ex?.swap === undefined
        ? [...CHANNELS]
        : CHANNELS.map((c) => (c === ex.swap?.[0] ? ex.swap[1] : c))
    const want = new Set<string>([...base, ...(ex?.extra ?? [])])
    const got = new Set(l.words)
    return want.size !== got.size || [...want].some((w) => !got.has(w))
  })
const lists = await channelLists(db)
check(
  'control: the detector finds the channel lists at all (a found-nothing guard)',
  lists.length >= 6 && lists.some((l) => l.name === 'inbound_origin_channel_known'),
  `${lists.length} constraint(s) list channels`,
)
const bad = disagreements(lists)
check(
  'every constraint that lists channels is exactly CHANNELS (bar the named exceptions)',
  bad.length === 0,
  bad.length === 0
    ? `${lists.length} agree`
    : JSON.stringify(bad.map((b) => `${b.table}.${b.name}`)),
)
// Sabotage, inside a statement that never commits: a list that drifted ("dashboard" for "teamhq").
const planted = await db
  .execute(`do $$ declare n int; begin
    create table public.zz_enum_probe (c text);
    alter table public.zz_enum_probe add constraint zz_enum_probe_known check (c in ('slack','telegram','voice','dashboard'));
    select count(*) into n from pg_constraint where conname = 'zz_enum_probe_known' and pg_get_constraintdef(oid) ~ 'dashboard';
    raise exception 'PLANTED %', n;
  end $$`)
  .then(() => -1)
  .catch((e: Error) => Number(/PLANTED (\d+)/.exec(String(e.message))?.[1] ?? -2))
check(
  'control: the planting works (the drifted constraint existed inside its transaction)',
  planted === 1,
  `${planted} constraint(s) seen before the rollback`,
)
const drifted = disagreements([
  {
    table: 'public.zz_enum_probe',
    name: 'zz_enum_probe_known',
    words: ['slack', 'telegram', 'voice', 'dashboard'],
  },
])
check(
  'control: a list that says "dashboard" for "teamhq" IS reported as a disagreement',
  drifted.length === 1,
  JSON.stringify(drifted.map((d) => d.name)),
)
check(
  'nothing of the probe survived',
  Number(
    (
      (await db.execute(`select count(*)::int as c from pg_class where relname = 'zz_enum_probe'`))
        .rows[0] as { c: number }
    ).c,
  ) === 0,
  'gone',
)

// ---- the two states nothing writes (D9 / invariant 29) ------------------------------------------------------------
/*
  `waiting_user` and `waiting_external` are legal states with no recovery of their own: a job there is released only by
  `let_job_go` on a blocker answer. That is bounded ONLY while no product function puts a job there, so the property
  is asserted: no function in `app` or `public` assigns or moves to either. A reader may name them; a writer may not.
*/
const writers = async (exec: { execute: typeof db.execute }) =>
  (
    await exec.execute(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prokind = 'f' and n.nspname in ('app', 'public')
          and pg_get_functiondef(p.oid) ~* $re$set[[:space:]]+state[[:space:]]*=[[:space:]]*'waiting_(user|external)'$re$`,
    )
  ).rows.map((r) => String((r as { f: string }).f))
const found = await writers(db)
check(
  'no product function moves a job to waiting_user or waiting_external',
  found.length === 0,
  JSON.stringify(found),
)
await db.execute(
  `create or replace function public.zz_waiting_probe() returns void language sql as $$ update public.jobs set state = 'waiting_user' where false $$`,
)
const probe = await writers(db)
check(
  'control: a function that does so IS found (the detector can fail)',
  probe.includes('public.zz_waiting_probe'),
  JSON.stringify(probe),
)
await db.execute(`drop function public.zz_waiting_probe()`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
await db.end?.()
process.exitCode = failed === 0 ? 0 : 1
