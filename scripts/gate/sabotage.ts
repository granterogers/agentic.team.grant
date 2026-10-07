/**
 * Shows the critical gate can FAIL: break one control on a CLONE DATABASE, run the whole critical tier against that clone,
 * and require it to go red naming the proof; then throw the clone away and show the clean candidate is as it was.
 *
 *   npm run verify:gate-sabotage                       every sabotage, one after another (about a minute each)
 *   npx tsx scripts/gate/sabotage.ts --only harness-false,operator-open
 *   npx tsx scripts/gate/sabotage.ts --list
 *
 * A gate that has only ever been green is a gate nobody has seen fail. Rules this file keeps, each one learned here the hard way:
 *   - NEVER `post`, never the candidate itself, never a repository file: each sabotage lands on its own clone of the
 *     candidate (`<prefix>_sab_<id>`), which is dropped afterwards, so a crash cannot leave the real candidate broken.
 *   - A SABOTAGE THAT DID NOT APPLY IS NOT A PASSING CONTROL. Every edit asserts its anchor exists in the live definition,
 *     executes, then reads the definition back and prints the md5 before and after. If the break did not land, the run says
 *     so and counts as an error, never as "the gate did not notice".
 *   - What the gate does after the sabotage is compared with what it did before it (the BASELINE), because other work in
 *     the tree can make a proof red for reasons that have nothing to do with the break.
 *   - A sabotage the gate does NOT catch is a COVERAGE FINDING and is reported as one, loudly, with the exit code to match.
 *
 * No production contact. Edits are made from the LIVE function definition (`pg_get_functiondef`), never rewritten from memory.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  cleanEnv,
  dropDb,
  ensureCandidate,
  ensureReplica,
  GateRefusal,
  PREFIX,
  sql,
} from './lib.ts'

interface Sabotage {
  readonly id: string
  readonly title: string
  /** Proofs of which AT LEAST ONE must go red (and was green at baseline) for the sabotage to count as caught as intended. */
  readonly expect: readonly string[]
  /** Applies the break to the clone and returns the lines that PROVE it landed. Throws if it did not. */
  readonly apply: (db: string) => string[]
}

const md5 = (s: string): string => createHash('md5').update(s).digest('hex').slice(0, 10)

/** Replaces text in a function's LIVE definition. Every anchor must exist; the definition read back must have changed. */
function edit(
  db: string,
  signature: string,
  edits: readonly (readonly [string, string])[],
): string[] {
  const before = sql(db, `select pg_get_functiondef('${signature}'::regprocedure)`)
  let after = before
  for (const [from, to] of edits) {
    if (!after.includes(from))
      throw new Error(
        `SABOTAGE ANCHOR MISSING in ${signature}: ${JSON.stringify(from.slice(0, 80))}`,
      )
    after = after.replace(from, () => to)
  }
  sql(db, after)
  const live = sql(db, `select pg_get_functiondef('${signature}'::regprocedure)`)
  const landed = live !== before && edits.every(([, to]) => live.includes(to))
  if (!landed) throw new Error(`SABOTAGE DID NOT LAND in ${signature}`)
  return [
    `${signature}: definition md5 ${md5(before)} -> ${md5(live)}; ${String(edits.length)} edit(s) read back in the live definition`,
  ]
}

/** Replaces a whole function (same signature) and proves the live definition changed. */
function replaceFn(db: string, signature: string, definition: string): string[] {
  const before = sql(db, `select pg_get_functiondef('${signature}'::regprocedure)`)
  sql(db, definition)
  const live = sql(db, `select pg_get_functiondef('${signature}'::regprocedure)`)
  if (live === before) throw new Error(`SABOTAGE DID NOT LAND in ${signature}`)
  return [`${signature}: definition md5 ${md5(before)} -> ${md5(live)}`]
}

const SABOTAGES: readonly Sabotage[] = [
  {
    id: 'harness-false',
    title: 'app.harness_job always answers false: harness traffic is no longer recognised',
    expect: [
      'chat-containment',
      'containment',
      'test-origins',
      'synthetic-origins',
      'external-containment',
    ],
    apply: (db) => [
      ...replaceFn(
        db,
        'app.harness_job(uuid)',
        `create or replace function app.harness_job(p_job_id uuid) returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog' as $f$ select false $f$`,
      ),
      `probe: harness_job(any) = ${sql(db, 'select app.harness_job(gen_random_uuid())')}`,
    ],
  },
  {
    id: 'operator-open',
    title: 'public.deployment_operator is true for anybody: a second person becomes an operator',
    expect: ['p1-operator'],
    apply: (db) => [
      ...edit(db, 'public.deployment_operator(text)', [
        ['select exists (', 'select true or exists ('],
      ]),
      `probe: deployment_operator('nobody-at-all') = ${sql(db, `select public.deployment_operator('nobody-at-all')`)}`,
    ],
  },
  {
    id: 'level3-proceeds',
    title:
      'the approval-level matrix lets a level-3 (destructive) action PROCEED on every dial (constraint dropped, rows set to proceed)',
    expect: ['authority', 'e2e-boundary'],
    apply: (db) => {
      sql(
        db,
        'alter table public.autonomy_policy drop constraint autonomy_policy_level_three_always_asks',
      )
      const n = sql(
        db,
        `with u as (update public.autonomy_policy set verdict = 'proceed' where action_level = 3 returning 1) select count(*) from u`,
      )
      if (Number(n) < 1) throw new Error('SABOTAGE DID NOT LAND: no level-3 row was set to proceed')
      return [
        `autonomy_policy: CHECK dropped, ${n} level-3 row(s) now proceed; probe: ${sql(db, `select count(*) from public.autonomy_policy where action_level = 3 and verdict = 'proceed'`)} proceeding`,
      ]
    },
  },
  {
    id: 'suggest2-proceeds',
    title: 'a level-2 write on the suggest dial proceeds unasked (a single matrix cell flipped)',
    expect: ['authority', 'e2e-boundary'],
    apply: (db) => {
      const n = sql(
        db,
        `with u as (update public.autonomy_policy set verdict = 'proceed' where autonomy = 'suggest' and action_level = 2 and verdict <> 'proceed' returning 1) select count(*) from u`,
      )
      if (Number(n) !== 1)
        throw new Error('SABOTAGE DID NOT LAND: the suggest/2 cell was not changed')
      return [`autonomy_policy suggest/2 changed to proceed (${n} row)`]
    },
  },
  {
    id: 'retrieval-office-join',
    title:
      "app.search_documents loses its office predicate: a search reads every office's documents",
    expect: ['p3-app-attack', 'office-ownership', 'e2e-documents', 'e2e-mcp'],
    apply: (db) =>
      edit(db, 'app.search_documents(uuid,text,uuid,integer,text)', [
        ['where d.office_id = p_office\n     and q.tsq is not null', 'where q.tsq is not null'],
      ]),
  },
  {
    id: 'claim-fence-removed',
    title:
      'app.job_held no longer compares the attempt or the claim: a stale worker still holds the job',
    expect: ['job-fence', 'job-lifecycle', 'exactly-once'],
    apply: (db) =>
      edit(db, 'app.job_held(uuid,text,integer,bigint)', [
        ['and j.attempt = p_attempt\n', '\n'],
        ['and (p_gen is null or j.claim_gen = p_gen)\n', '\n'],
      ]),
  },
  {
    id: 'delivery-containment-removed',
    title:
      'app.claim_delivery stops acting on a refusal: a harness job can claim a real destination',
    expect: [
      'containment',
      'external-containment',
      'test-origins',
      'synthetic-origins',
      'chat-containment',
      'approval-delivery',
    ],
    apply: (db) =>
      edit(db, 'app.claim_delivery(uuid,text,text,text,text,text,text,uuid,uuid,uuid,interval)', [
        ['  if v_refusal is not null then\n', '  if false and v_refusal is not null then\n'],
      ]),
  },
  {
    id: 'reminder-harness-filter-removed',
    title:
      'app.reminders_due stops excluding harness tasks: a test task can be reminded to a real person',
    expect: ['reminder-harness', 'e2e-tasks', 'e2e-duties-budget', 'tk-reminders'],
    apply: (db) =>
      edit(db, 'app.reminders_due(uuid,interval)', [
        ['     and not app.harness_task(t.is_fixture, t.job_id)\n', '\n'],
      ]),
  },
  {
    id: 'origin-trusts-everything',
    title: 'app.job_origin classes every job as trusted: provenance of who asked is gone',
    expect: ['job-origin', 'synthetic-origins', 'audit-closure', 'project-provenance'],
    apply: (db) =>
      replaceFn(
        db,
        'app.job_origin(uuid)',
        `create or replace function app.job_origin(p_job_id uuid) returns text language sql stable security definer set search_path to '' as $f$ select 'trusted'::text $f$`,
      ),
  },
  {
    id: 'may-act-ignores-origin',
    title:
      'app.may_act treats every job as asked-for by a person: an office-made root acts unasked',
    expect: ['audit-closure', 'authority', 'e2e-boundary'],
    apply: (db) =>
      edit(db, 'app.may_act(uuid,text,uuid)', [
        ["and app.job_origin(p_job) in ('trusted', 'harness');", 'and true;'],
      ]),
  },
  {
    id: 'authority-refusal-null',
    title:
      'app.authority_refusal never refuses: a test principal, a guest and a stranger may decide real things',
    expect: ['audit-closure', 'approver-identity', 'principals', 'sender-authorization'],
    apply: (db) =>
      replaceFn(
        db,
        'app.authority_refusal(text,uuid,uuid)',
        `create or replace function app.authority_refusal(p_by text, p_job uuid default null, p_project uuid default null) returns text language sql stable security definer set search_path to '' as $f$ select null::text $f$`,
      ),
  },
  {
    id: 'one-live-job-per-key-dropped',
    title: 'the unique index that makes a duplicate job impossible is dropped',
    expect: ['exactly-once', 'job-fence', 'job-lifecycle', 'e2e-convergence'],
    apply: (db) => {
      sql(db, 'drop index public.jobs_one_live_per_idempotency_key')
      const gone = sql(db, `select to_regclass('public.jobs_one_live_per_idempotency_key') is null`)
      if (gone !== 't') throw new Error('SABOTAGE DID NOT LAND: the index still exists')
      return ['index jobs_one_live_per_idempotency_key dropped; to_regclass is now null']
    },
  },
  {
    id: 'office-key-dropped',
    title: 'the composite foreign key that keeps a job and its project in ONE office is dropped',
    expect: ['office-ownership', 'p3-app-attack', 'office-ownership-sabotage'],
    apply: (db) => {
      sql(db, 'alter table public.jobs drop constraint jobs_project_same_office')
      const gone = sql(
        db,
        `select count(*) from pg_constraint where conrelid = 'public.jobs'::regclass and conname = 'jobs_project_same_office'`,
      )
      if (gone !== '0') throw new Error('SABOTAGE DID NOT LAND: the constraint still exists')
      return ['constraint jobs_project_same_office dropped; pg_constraint rows: 0']
    },
  },
  {
    id: 'anon-can-answer',
    title:
      'the public anon key is granted EXECUTE on the PostgREST-visible approval answerer (public.hq_answer_blocker)',
    expect: ['anon-surface', 'p3-app-attack'],
    apply: (db) => {
      // The wrapper in `public`, not the function in `app`: anon has no USAGE on schema app, so a grant on an app.* function
      // reaches nothing and is not an exposure (an earlier version of this sabotage did that and was rightly not caught).
      sql(db, 'grant execute on function public.hq_answer_blocker(uuid,uuid,text,text) to anon')
      const g = sql(
        db,
        `select has_function_privilege('anon', 'public.hq_answer_blocker(uuid,uuid,text,text)', 'execute')`,
      )
      const usage = sql(db, `select has_schema_privilege('anon', 'public', 'usage')`)
      if (g !== 't' || usage !== 't')
        throw new Error('SABOTAGE DID NOT LAND: anon cannot reach the function')
      return [
        `anon now has execute on public.hq_answer_blocker: ${g} (and usage on schema public: ${usage})`,
      ]
    },
  },
  {
    id: 'schema-drift',
    title:
      'the candidate gains a table no migration creates (the replica drifts from the migration history)',
    expect: ['replay-parity'],
    apply: (db) => {
      sql(db, 'create table public.zz_sabotage_drift (x int)')
      return [
        `table created: ${sql(db, `select to_regclass('public.zz_sabotage_drift') is not null`)}`,
      ]
    },
  },
]

interface Report {
  readonly green: number
  readonly red: readonly { name: string; label: string; reason: string }[]
  readonly wallSeconds: number
}

/** Runs the whole critical tier against a candidate and reads the result file back. */
function gate(candidate: string, label: string): Report {
  const json = `.out/gate/sabotage-${PREFIX}-${label}.json`
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/gate/run.ts',
      '--tier',
      'critical',
      '--candidate',
      candidate,
      '--json',
      json,
      '--allow-unregistered',
    ],
    { encoding: 'utf8', env: cleanEnv(), maxBuffer: 64 << 20 },
  )
  if (!existsSync(json))
    throw new Error(
      `the gate wrote no result for ${label} (exit ${String(r.status)}): ${`${r.stdout}${r.stderr}`.slice(-600)}`,
    )
  return JSON.parse(readFileSync(json, 'utf8')) as Report
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes('--list')) {
    for (const s of SABOTAGES)
      console.log(
        `${s.id.padEnd(34)} ${s.title}\n${' '.repeat(35)}expected red: ${s.expect.join(', ')}`,
      )
    return 0
  }
  const onlyIdx = args.indexOf('--only')
  const only = onlyIdx >= 0 ? (args[onlyIdx + 1] ?? '').split(',').filter(Boolean) : null
  const chosen = only === null ? SABOTAGES : SABOTAGES.filter((s) => only.includes(s.id))
  if (only !== null && chosen.length !== only.length)
    throw new GateRefusal(`unknown sabotage in ${only.join(',')}; see --list`)

  ensureReplica({ build: false })
  const cand = ensureCandidate({ rebuild: false, given: undefined })
  console.log(`candidate ${cand.name}: ${cand.note}`)
  console.log('\n== BASELINE: the unsabotaged candidate')
  // --reuse-baseline and --no-restore let a long list be split across calls that each fit a shell's ten-minute ceiling; the
  // last call (without --no-restore) shows the clean candidate is as it was. The baseline file is the one the previous call wrote.
  const baselineFile = `.out/gate/sabotage-${PREFIX}-baseline.json`
  const base =
    args.includes('--reuse-baseline') && existsSync(baselineFile)
      ? (JSON.parse(readFileSync(baselineFile, 'utf8')) as Report)
      : gate(cand.name, 'baseline')
  const baseRed = new Set(base.red.map((r) => r.name))
  console.log(
    `baseline: ${String(base.green)} green, ${String(base.red.length)} red${baseRed.size > 0 ? ` (${[...baseRed].join(', ')}: red BEFORE any sabotage, so not counted against a sabotage)` : ''}; ${base.wallSeconds.toFixed(0)}s`,
  )

  const outcomes: {
    id: string
    caught: boolean
    asIntended: boolean
    newlyRed: string[]
    error?: string
  }[] = []
  for (const s of chosen) {
    const sab = `${PREFIX}_sab_${s.id.replace(/[^a-z0-9]/g, '_')}`.slice(0, 60)
    console.log(`\n== SABOTAGE ${s.id}: ${s.title}`)
    dropDb(sab)
    try {
      sql('postgres', `create database "${sab}" template "${cand.name}"`)
      const proof = s.apply(sab)
      for (const l of proof) console.log(`   landed: ${l}`)
      const rep = gate(sab, s.id)
      const allNew = rep.red.map((r) => r.name).filter((n) => !baseRed.has(n))
      // replay-parity goes red for ANY edit made to the candidate, because the candidate then differs from the migration
      // history. That is a true and useful signal about drift, and a vacuous one about a CONTROL: counting it would make every
      // sabotage "caught". It counts only for a sabotage that is about drift.
      const newly = allNew.filter(
        (n) => n !== 'replay-parity' || s.expect.includes('replay-parity'),
      )
      const asIntended = s.expect.some((e) => newly.includes(e))
      console.log(
        `   gate: ${String(rep.green)} green, ${String(rep.red.length)} red; newly red: ${allNew.length === 0 ? 'NONE' : allNew.join(', ')}${allNew.length !== newly.length ? ' (replay-parity ignored for this verdict: it reports any drift)' : ''}`,
      )
      console.log(
        `   ${newly.length > 0 ? 'CAUGHT' : 'NOT CAUGHT'}${newly.length > 0 && !asIntended ? ` (but not by any proof this sabotage was expected to trip: ${s.expect.join(', ')})` : ''}`,
      )
      outcomes.push({ id: s.id, caught: newly.length > 0, asIntended, newlyRed: newly })
    } catch (e) {
      console.log(`   ERROR (counts as not proven): ${(e as Error).message}`)
      outcomes.push({
        id: s.id,
        caught: false,
        asIntended: false,
        newlyRed: [],
        error: (e as Error).message,
      })
    } finally {
      dropDb(sab)
      console.log(`   restored: clone ${sab} dropped; the candidate was never touched`)
    }
  }

  let same = true
  if (!args.includes('--no-restore')) {
    console.log('\n== RESTORE: the clean candidate again')
    const after = gate(cand.name, 'restore')
    const afterRed = new Set(after.red.map((r) => r.name))
    // Nothing may be red now that was not red before any sabotage (a reused baseline may hold a proof that has since been fixed).
    same = [...afterRed].every((n) => baseRed.has(n))
    console.log(
      `restored gate: ${String(after.green)} green, ${String(after.red.length)} red${afterRed.size > 0 ? ` (${[...afterRed].join(', ')})` : ''}; ${same ? 'no proof is red that was not red at the baseline' : 'A PROOF IS RED THAT WAS NOT RED AT THE BASELINE'}`,
    )
  }

  console.log('\n---- sabotage summary')
  for (const o of outcomes)
    console.log(
      `${o.caught ? (o.asIntended ? 'CAUGHT    ' : 'CAUGHT*   ') : o.error !== undefined ? 'ERROR     ' : 'NOT CAUGHT'}  ${o.id.padEnd(34)} ${o.newlyRed.join(', ')}${o.error !== undefined ? o.error : ''}`,
    )
  const uncaught = outcomes.filter((o) => !o.caught)
  console.log(
    `\n${String(outcomes.length - uncaught.length)} of ${String(outcomes.length)} sabotage(s) turned the critical gate red${uncaught.length > 0 ? `; NOT CAUGHT (coverage findings): ${uncaught.map((o) => o.id).join(', ')}` : ''}`,
  )
  return uncaught.length === 0 && same ? 0 : 1
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error(e instanceof GateRefusal ? `\nREFUSED: ${e.message}` : e)
    process.exit(2)
  },
)
