/**
 * #378 — the new check:leaks witness finds an escape the guard cannot see.
 *
 *   npx tsx scripts/isolated/witness-independence.ts <replica-db>
 *
 * The guard's predicate is broken on purpose (app.harness_job made to say
 * "real" for everything), then the shapes that escaped in production are
 * written as sent deliveries. A witness that shares the guard's predicate
 * reports none of them; this one must report each, and must stay quiet about
 * Grant's own traffic and the operator's own notices.
 */
import { provenanceSql } from '../leak-witness.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'wit378')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const turn = async (channel: string, key: string, ref: string): Promise<string> => {
  const cmd = await one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(channel)}, ${lit(ref)}, 'grant', ${lit(`Witness proof ${run}`)}, ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  return String(
    ((typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }).job_id,
  )
}
const harness = await turn('voice', `voice:turn:verify-378w-${run}.1`, `verify-378w-${run}/x:1`)
const child =
  String(
    (
      await one(`select app.enqueue_child(p_parent => ${lit(harness)}::uuid, p_kind => 'office.synthesise',
    p_payload => '{}'::jsonb)::text as v`)
    ).v,
  ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
const real = await turn(
  'telegram',
  `telegram:message:1386648496:${String(Date.now() % 100000)}`,
  `1386648496:${String(Date.now() % 1000)}`,
)

/* The guard's predicate, broken: everything is real. */
await db.execute(`create or replace function app.harness_job(p_job_id uuid) returns boolean
  language sql stable as $f$ select false $f$`)
const broken = await one(`select app.harness_job(${lit(harness)}::uuid) as h`)
check(
  'sabotage landed: the guard now calls the harness job real',
  broken.h === false,
  `harness_job ${String(broken.h)}`,
)

const since = String((await one(`select app.now_utc()::text as t`)).t)
const sent = (key: string, job: string | null, target = 'C0FLOOR0001', channel = 'slack') =>
  db.execute(`insert into public.deliveries (channel, dedupe_key, account_ref, target_ref, job_id, purpose, state, message_ref, sent_at, lease_expires_at)
    values (${lit(channel)}, ${lit(key)}, 'acct', ${lit(target)}, ${job === null ? 'null' : `${lit(job)}::uuid`}, 'notice', 'sent', ${lit(`m-${key}`)}, app.now_utc(), app.now_utc())`)
await sent(`narration:${harness}`, null) //            #378 exactly: no job on the row
await sent(`result:${run}:${harness}`, harness) //     the row names a harness job
await sent(`outcome:${child}`, child) //               a child of harness work
await sent(`mystery:${run}`, null) //                  traceable to nothing
await sent(`narration:${real}`, real) //               control: Grant's own
await sent(`build:${run}`, null, '1386648496', 'telegram') // control: an operator notice

const rows = (await db.execute(provenanceSql(lit(since) + '::timestamptz'))).rows as {
  key: string
  breach: string | null
  guard_says_harness: boolean
}[]
const breachOf = (prefix: string) =>
  rows.find((r) => r.key.startsWith(prefix))?.breach ?? 'not seen'
check(
  'a harness narration with no job on the row is caught (job from its key)',
  breachOf('narration:' + harness.slice(0, 8)) === 'HARNESS_SENT',
  breachOf('narration:' + harness.slice(0, 8)),
)
check(
  'a sent message naming a harness job is caught',
  breachOf(`result:${run}`) === 'HARNESS_SENT',
  breachOf(`result:${run}`),
)
check(
  "a harness job's child is caught (lineage)",
  breachOf(`outcome:${child.slice(0, 8)}`) === 'HARNESS_SENT',
  breachOf(`outcome:${child.slice(0, 8)}`),
)
check(
  'a message traceable to nothing is caught',
  breachOf(`mystery:${run}`) === 'UNPROVENANCED',
  breachOf(`mystery:${run}`),
)
check(
  "control: Grant's own narration is not a breach",
  breachOf(`narration:${real.slice(0, 8)}`) === 'null' ||
    rows.find((r) => r.key.startsWith(`narration:${real.slice(0, 8)}`))?.breach === null,
  String(rows.find((r) => r.key.startsWith(`narration:${real.slice(0, 8)}`))?.breach),
)
check(
  "control: an operator's notice is not a breach",
  rows.find((r) => r.key.startsWith(`build:${run}`))?.breach === null,
  String(rows.find((r) => r.key.startsWith(`build:${run}`))?.breach),
)
check(
  'and it names the disagreement: the guard called every harness row real',
  rows.filter((r) => r.breach === 'HARNESS_SENT').every((r) => r.guard_says_harness === false),
  `${String(rows.filter((r) => r.breach === 'HARNESS_SENT' && !r.guard_says_harness).length)} disagreement(s)`,
)
const before = (await db.execute(provenanceSql(`${lit(since)}::timestamptz + interval '1 hour'`)))
  .rows
check(
  'the cutoff separates new from historical',
  before.length === 0,
  `${String(before.length)} row(s) after a later cutoff`,
)

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
