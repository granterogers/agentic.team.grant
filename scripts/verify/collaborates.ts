/**
 * Does more than one person actually work on anything?
 *
 *   npm run verify:collaborates
 *
 * Issue #233. Grant asked directly whether the sub-agents are being used. The
 * measurement said no, and said it in three columns at once:
 *
 *   - `routing_decisions.delegation_depth` was **0 on every real row in the
 *     system's history**.
 *   - `consultations` held 13 real rows and every one of them was Claire
 *     choosing who answers — a routing decision, not a hand-off.
 *   - `jobs.parent_job_id` was set on 247 jobs and not one of them came from an
 *     agent: they were plan steps and notebook mechanics.
 *
 * Three separate causes, none of which is "the mechanism is missing":
 *
 *   1. `pickRoster` returns up to five names and `handlers/instruction.ts`
 *      took `roster[0]` and threw the rest away.
 *   2. `recordDecision`'s `delegationDepth` argument had never been passed by
 *      any caller, so the column was 0 by construction whatever happened.
 *   3. The decision recorded `[who.slug]` — one name — however many were
 *      convened, so even the record was narrower than the decision.
 *
 * ## What this proves
 *
 * That a request genuinely belonging to two specialists produces a second
 * agent doing real work, through the canonical inbound path, on the deployed
 * worker. Not that the mechanism exists — `app.enqueue_child` has existed for
 * months and CLAUDE.md is full of features that existed and were never
 * reached.
 *
 * ## And that it stays bounded
 *
 * The expensive failure here is not under-delegation, it is a job multiplier.
 * So the suite asserts the three properties that keep it safe as hard as it
 * asserts that it happens at all: the child cannot message Grant, the chain
 * terminates rather than recursing, and the depth cap refuses a fourth level.
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
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

let pass = 0
let fail = 0
const ok = (what: string, good: boolean, note = ''): void => {
  if (good) {
    pass++
    console.log(`  ok   ${what}${note === '' ? '' : ` — ${note}`}`)
  } else {
    fail++
    console.error(`  FAIL ${what}${note === '' ? '' : ` — ${note}`}`)
  }
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

console.log('\nverify:collaborates — does a second specialist actually do anything\n')

const run = Math.random().toString(36).slice(2, 10)
/*
  `verify-` is what makes every job this writes harness traffic.

  `enqueue_inbound` composes `requested_by` as `<origin_channel>:<actor>` and
  `jobs.is_fixture` has a `%:verify-%` branch (0342). The CHILD inherits
  `requested_by` from its parent verbatim, so the whole tree is fixture — which
  matters more here than in most suites, because these jobs run for real and
  would otherwise land in Grant's health readings. CLAUDE.md records three
  occasions when harness traffic was about to be reported to him as the office
  collapsing, and a suite whose entire point is to make agents do work is the
  likeliest place for a fourth.
*/
const ACTOR = `verify-collab-${run}`

const project = String(
  (
    await one(`
      insert into public.projects (name, slug, status)
      values (${lit(`Fixture collab ${run}`)}, ${lit(`fixture-collab-${run}`)}, 'paused')
      returning project_id::text as id`)
  ).id,
)

/*
  A request that genuinely belongs to two people.

  Not a contrivance: what a price change costs and how it is announced are two
  different jobs for two different specialists, and answering only half of it is
  the actual failure Grant would notice.

  The four words at the front are load-bearing and were learned by getting it
  wrong. Without them `classifyIntent` recognises nothing, the classification
  is `thought`/unconfident, and #232's unrecognised branch caps the roster at
  ONE — correctly, and not merely as a preference:
  `routing_decisions_unconfident_stays_small` refuses a wider roster on an
  unconfident row. So a suite phrased that way would be asserting against a
  safety rule rather than against the feature, and it would fail while the
  office was behaving exactly as designed. Verified before relying on it:
  "I need you to …" classifies as a confident `assignment` and the roster comes
  back [finance-director, communications-director].
*/
const ASK =
  'I need you to model the margin impact of the fifteen percent price cut and ' +
  'draft the announcement email that goes with it.'

const key = `teamhq:collab_probe:${run}`
const parent = String(
  (
    await one(`
      begin;
      insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at, project_id)
      values ('teamhq', ${lit(`collab-${run}`)}, ${lit(ACTOR)}, ${lit(ASK)},
              ${lit(key)}, app.now_utc(), ${lit(project)}::uuid);
      create temp table _j as
        select (app.enqueue_inbound(
                  (select command_id from public.inbound_commands where dedupe_key = ${lit(key)})
                ) ->> 'job_id')::uuid as id;
      /*
        Closed in the SAME transaction as the enqueue.

        The announce column DEFAULTS TO TRUE and the worker ticks every
        minute, so a separate UPDATE is a race against a message to his phone.
      */
      update public.jobs set announce = false where job_id = (select id from _j);
      select (select id from _j)::text as id;
      commit;`)
  ).id,
)

ok(
  'the probe cannot reach Grant',
  Number(
    (
      await one(
        `select count(*)::int as n from public.jobs where job_id = ${lit(parent)}::uuid and announce`,
      )
    ).n,
  ) === 0,
  'announce is false on the parent',
)

process.stdout.write('       waiting for the office')
const deadline = Date.now() + 9 * 60 * 1000
let children: Record<string, unknown>[] = []
while (Date.now() < deadline) {
  children = await all(`
    select j.job_id::text as job_id, j.state::text as state, j.announce,
           coalesce(j.recipient_agent, '') as recipient,
           j.pinned_config ->> 'addressed_to' as addressed_to,
           j.pinned_config ->> 'handed_off_by' as handed_off_by,
           app.job_depth(j.job_id)::int as depth
      from public.jobs j
     where j.parent_job_id = ${lit(parent)}::uuid`)
  /*
    Wait for the CHILDREN to finish, not merely for the parent.

    The first version broke as soon as the parent was terminal and a child
    existed, and then asserted on the child's routing decision — which that
    child writes near the end of its own run. It reported "no routing decision
    was recorded for any child" about a child that was still `running`, which
    reads exactly like the column never being written. Assert after the thing
    you are asserting about has happened.
  */
  const settled = (x: unknown): boolean => ['complete', 'failed', 'cancelled'].includes(String(x))
  const done = String(
    (await one(`select state::text as s from public.jobs where job_id = ${lit(parent)}::uuid`)).s,
  )
  if (settled(done) && children.length > 0 && children.every((c) => settled(c.state))) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 15_000))
}
console.log('')

const parentRow = await one(`
  select state::text as state, coalesce(recipient_agent, '') as recipient
    from public.jobs where job_id = ${lit(parent)}::uuid`)
const decision = await one(`
  select coalesce(array_to_string(roster, ','), '') as roster, delegation_depth::int as depth,
         confident, coalesce(roster_reason, '') as why
    from public.routing_decisions where job_id = ${lit(parent)}::uuid`)

console.log(
  `       parent ${String(parentRow.state)}, answered by ${String(parentRow.recipient) || '(nobody)'}, ` +
    `roster [${String(decision.roster)}]`,
)

ok(
  'the office convened more than one person',
  String(decision.roster).split(',').filter(Boolean).length > 1,
  `roster was [${String(decision.roster) || 'empty'}] — ${String(decision.why).slice(0, 90)}`,
)

ok(
  'and handed the rest of it to them as real work',
  children.length > 0,
  children.length === 0
    ? 'no child job was created'
    : `${String(children.length)} child job(s): ${children.map((c) => `${String(c.addressed_to)} (${String(c.state)})`).join(', ')}`,
)

/*
  The bound that matters most.

  Grant hears from the Chief of Staff and nobody else
  (`telegram.only_chief_speaks`). A hand-off that announced would break that in
  the loudest possible way — one request becoming two notifications — and it is
  the failure he would notice first.
*/
ok(
  'no handed-off job can message Grant',
  children.every((c) => c.announce === false),
  `${String(children.filter((c) => c.announce !== false).length)} of ${String(children.length)} announcing`,
)

ok(
  'the hand-off names who asked for it, so it is a hand-off and not a routing decision',
  children.every((c) => String(c.handed_off_by ?? '') !== ''),
  children.map((c) => `${String(c.handed_off_by)} -> ${String(c.addressed_to)}`).join(', '),
)

/*
  The chain terminates by CONSTRUCTION, not merely by the cap.

  A child carries `addressed_to`, so it takes the addressed-directly branch of
  `speaker` and convenes nobody further. The depth trigger would stop it at
  three regardless; this asserts it stops at one, which is the difference
  between a bounded feature and one that merely cannot run away.
*/
const grandchildren = Number(
  (
    await one(`
      select count(*)::int as n from public.jobs
       where parent_job_id in (select job_id from public.jobs where parent_job_id = ${lit(parent)}::uuid)`)
  ).n,
)
ok(
  'the chain terminates at one level',
  grandchildren === 0,
  `${String(grandchildren)} grandchildren`,
)

const childDecisions = await all(`
  select r.delegation_depth::int as depth, coalesce(array_to_string(r.roster, ','), '') as roster
    from public.routing_decisions r
    join public.jobs j on j.job_id = r.job_id
   where j.parent_job_id = ${lit(parent)}::uuid`)
ok(
  'the depth reaches the column that reports it',
  childDecisions.length > 0 && childDecisions.every((d) => Number(d.depth) > 0),
  childDecisions.length === 0
    ? 'no routing decision was recorded for any child'
    : `depths ${childDecisions.map((d) => String(d.depth)).join(', ')}`,
)

/*
  And the second agent actually produced something.

  A child job that runs and writes nothing is delegation in the same nominal
  sense the office already had — #65's complaint was never that no rows
  existed, it was that the rows described work nobody did. The floor is
  deliberately low (a few hundred characters) because this is not a quality
  check; it is the difference between a second agent working and a second job
  existing.
*/
const produced = await all(`
  select o.output_id::text as id, length(coalesce(o.body, ''))::int as len,
         coalesce(j.recipient_agent, '') as by
    from public.outputs o
    join public.jobs j on j.job_id = o.job_id
   where j.parent_job_id = ${lit(parent)}::uuid`)
ok(
  'the second agent produced real work, not merely a second job',
  produced.length > 0 && produced.every((p) => Number(p.len) > 200),
  produced.length === 0
    ? 'the child job wrote no output at all'
    : produced.map((p) => `${String(p.by)}: ${String(p.len)} chars`).join(', '),
)

/*
  A consultation whose requester is a SPECIALIST.

  `record_consultation` refuses a self-consultation, and the pre-existing
  caller always passes 'chief-of-staff' — so a row whose `requested_by` is
  anybody else can only have come from one specialist reaching for another,
  which is the thing §9's economics table was built to count and had never
  once recorded.
*/
const consults = await all(`
  select by.slug as by, who.slug as who
    from public.consultations c
    join public.staff who on who.staff_id = c.consulted_staff
    left join public.staff by on by.staff_id = c.requested_by
   where c.job_id = ${lit(parent)}::uuid`)
ok(
  'the hand-off is recorded as a consultation between two specialists',
  consults.some((c) => String(c.by ?? '') !== '' && String(c.by) !== 'chief-of-staff'),
  consults.length === 0
    ? 'no consultation recorded'
    : consults.map((c) => `${String(c.by)} -> ${String(c.who)}`).join(', '),
)

/*
  CONTROL: the depth cap still refuses.

  In a transaction that is rolled back, because the assertion is about a
  REFUSAL and there is nothing to keep. CLAUDE.md records what
  `verify:disconnect` cost by wrapping the assertion instead of the call: the
  wrapper cannot know which kind it is until it has already happened.
*/
const cap = await one(`
  select coalesce((value #>> '{}')::int, 3) as m
    from public.system_config where key = 'agents.max_delegation_depth'`)
const refused = await db
  .execute(`
    begin;
    do $$
    declare v_id uuid := ${lit(parent)}::uuid;
    begin
      for i in 1..${String(Number(cap.m ?? 3) + 1)} loop
        v_id := app.enqueue_child(v_id, 'office.instruction', '{}'::jsonb, interval '0', false);
      end loop;
    end $$;
    rollback;`)
  .then(() => '')
  .catch((e: unknown) => (e as Error).message)
ok(
  'CONTROL: delegation deeper than the configured cap is refused',
  refused.includes('delegation depth'),
  refused === ''
    ? `a chain of ${String(Number(cap.m ?? 3) + 1)} was ACCEPTED — the cap is not enforced`
    : `cap is ${String(cap.m)}; refused`,
)

/*
  Teardown.

  A completed job is TERMINAL and `complete -> cancelled` is refused by
  `enforce_job_transition`, which is right — a finished job did not later get
  cancelled. Only what is still queued is cancelled, and the project is left to
  `check:leaks` because a project holding jobs can never be deleted (ADR-0022).
  These are fixture jobs, so they are excluded from every reader that reports
  to Grant.
*/
await db
  .execute(`
    update public.jobs
       set state = 'cancelled', finished_at = app.now_utc(),
           state_reason = 'verify:collaborates, cancelled in teardown'
     where (job_id = ${lit(parent)}::uuid or parent_job_id = ${lit(parent)}::uuid)
       and state in ('queued', 'retrying', 'paused')`)
  .catch(() => undefined)

console.log(`\n${String(pass)}/${String(pass + fail)} checks passed`)
if (fail > 0) process.exit(1)
