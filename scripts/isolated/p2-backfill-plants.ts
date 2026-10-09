/**
 * Does the ownership backfill ABORT on data it cannot prove? (multi-user P2)
 *
 *   npx tsx scripts/isolated/p2-backfill-plants.ts
 *
 * A backfill that has only ever run on clean data has not shown it refuses anything. For each plant below this builds a
 * fresh database from the replica, applies 0654..0656, plants ONE adversarial row the rules cannot classify, applies the
 * next waves, and requires the wave that owns that row to stop - naming the thing - and to leave NOTHING stamped. A
 * control run with no plant must apply every wave, otherwise "it aborted" proves nothing.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const SOCK = process.env.ISOLATED_PG_SOCKET ?? '/tmp/pgs'
const PORT = process.env.ISOLATED_PG_PORT ?? '55432'
const psql = (db: string, args: string[], input?: string): { ok: boolean; out: string } => {
  try {
    const out = execFileSync(
      'psql',
      [
        '-h',
        SOCK,
        '-p',
        PORT,
        '-U',
        'postgres',
        '-d',
        db,
        '-qtA',
        '-v',
        'ON_ERROR_STOP=1',
        ...args,
      ],
      {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(input === undefined ? {} : { input }),
      },
    )
    return { ok: true, out }
  } catch (e) {
    const x = e as { stderr?: string; stdout?: string }
    return { ok: false, out: `${x.stderr ?? ''}${x.stdout ?? ''}` }
  }
}
const file = (n: string) => `${new URL('../../migrations/', import.meta.url).pathname}${n}.sql`
const WAVES = [
  '0654_offices',
  '0655_every_carrier_gets_an_office_column',
  '0656_the_compatibility_bridge',
  '0657_wave_1_projects_duties_and_jobs_have_an_owner',
  '0658_wave_2_everything_that_hangs_off_a_project_or_a_job',
  '0659_wave_3_account_level_carriers_have_an_owner',
]

// The plants are applied to the schema AS IT WAS BEFORE 0654, because the proof replays 0654..0659 itself. `post` is the
// whole candidate (it already holds those waves, so replaying them fails on "offices already exists" and the proof
// can never reach a plant). The template is therefore `pre` plus every migration below 0654, built once and reused;
// P2_PLANT_TEMPLATE names an existing one, P2_PLANT_DB the working clone (parallel runs).
const TEMPLATE = process.env.P2_PLANT_TEMPLATE ?? 'p2_plant_template'
const WORK_DB = process.env.P2_PLANT_DB ?? 'p2_plant'
const ensureTemplate = () => {
  const have = psql('postgres', ['-c', `select 1 from pg_database where datname = '${TEMPLATE}'`])
  if (have.ok && have.out.trim() === '1') return
  const c = psql('postgres', ['-c', `create database ${TEMPLATE} template pre`])
  if (!c.ok) throw new Error(c.out)
  const names = readdirSync(new URL('../../migrations/', import.meta.url))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) > '0598' && f.slice(0, 4) < '0654')
    .sort()
  for (const f of names) {
    const r = psql(TEMPLATE, ['-1', '-f', file(f.replace(/\.sql$/, ''))])
    if (!r.ok) throw new Error(`building ${TEMPLATE}: ${f}: ${r.out.slice(0, 200)}`)
  }
}

const fresh = (db: string) => {
  ensureTemplate()
  psql('postgres', ['-c', `drop database if exists ${db}`])
  const c = psql('postgres', ['-c', `create database ${db} template ${TEMPLATE}`])
  if (!c.ok) throw new Error(c.out)
  psql(db, [
    '-c',
    `insert into auth.users(id,email) select gen_random_uuid(), e from (values ('grant.e.rogers@gmail.com'),('verify.operator@example.com')) v(e) where not exists (select 1 from auth.users u where lower(u.email) = v.e)`,
  ])
}

const staffId = '(select staff_id from public.staff limit 1)'
type Plant = { name: string; sql: string; stopsAt: string; mustName: string }
const plants: Plant[] = [
  {
    name: 'a duty nobody classified as system or the person',
    sql: `insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes) values ('rogue-duty', ${staffId}, 'a duty the backfill has never heard of', 'office.sync', 60)`,
    stopsAt: '0657',
    mustName: 'rogue-duty',
  },
  {
    name: 'a retired project with no job, no fixture name and no run token',
    sql: `insert into public.projects (slug, name, status) values ('orphan-thing', 'Orphan thing', 'archived')`,
    stopsAt: '0657',
    mustName: 'orphan-thing',
  },
  {
    name: 'a job tree whose child sits in a fixture project and whose parent sits in a real one',
    sql: `insert into public.projects (project_id, slug, name, status) values ('00000000-0000-4000-8000-0000000000a2','fixture-two','Fixture two','paused');
          insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id) values ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b1','plant-key-b1','probe','duty:morning-briefing',(select project_id from public.projects where status = 'active' limit 1));
          insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, parent_job_id) values ('00000000-0000-4000-8000-0000000000b2','00000000-0000-4000-8000-0000000000b2','plant-key-b2','probe','duty:morning-briefing','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000b1')`,
    stopsAt: '0657',
    mustName: 'different offices',
  },
  {
    name: 'a root job from a requester that is neither a duty, a harness nor a known person',
    sql: `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by) values ('00000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c1','plant-key-c1','probe','telegram:555123456')`,
    stopsAt: '0657',
    mustName: 'telegram:555123456',
  },
  {
    name: 'a ledger event no link, principal, pointer or suite name explains',
    sql: `insert into public.events (correlation_id, actor_kind, actor, trigger, action_type, reversible) values (gen_random_uuid(), 'agent', 'wandering-agent', 'whim', 'office.wandered', false)`,
    stopsAt: '0658',
    mustName: 'events: unresolved',
  },
  {
    name: 'a feedback row from an actor the identity registry does not know',
    sql: `insert into public.feedback (subject_kind, subject_ref, signal, origin_channel, given_by) values ('notification', null, 'positive', 'telegram', '987654321')`,
    stopsAt: '0659',
    mustName: 'feedback: unresolved',
  },
]

let failed = 0
const say = (ok: boolean, what: string, detail: string) => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

for (const run of [
  { name: 'CONTROL: no plant at all', sql: '', stopsAt: '', mustName: '' } as Plant,
  ...plants,
]) {
  const db = WORK_DB
  fresh(db)
  for (const w of WAVES.slice(0, 3)) psql(db, ['-f', file(w)])
  if (run.sql !== '') {
    const planted = psql(db, ['-c', run.sql])
    say(planted.ok, `planted: ${run.name}`, planted.ok ? 'row written' : planted.out.slice(0, 160))
    if (!planted.ok) continue
  }
  let stopped = ''
  let message = ''
  for (const w of WAVES.slice(3)) {
    const r = psql(db, ['-f', file(w)])
    if (!r.ok) {
      stopped = w.slice(0, 4)
      message = r.out
      break
    }
  }
  if (run.stopsAt === '') {
    say(
      stopped === '',
      'the control applied every wave',
      stopped === '' ? 'all applied' : `stopped at ${stopped}: ${message.slice(0, 160)}`,
    )
    continue
  }
  say(
    stopped === run.stopsAt,
    `the wave that owns it stopped (${run.stopsAt})`,
    stopped === ''
      ? 'NOTHING STOPPED - the backfill accepted data it cannot prove'
      : `stopped at ${stopped}`,
  )
  say(
    message.includes(run.mustName),
    'and the refusal names the thing',
    message.split('\n').find((l) => l.includes('ERROR')) ?? message.slice(0, 150),
  )
  const stamped = psql(db, [
    '-c',
    `select (select count(*) from public.projects where office_id is not null) + (select count(*) from public.jobs where office_id is not null) + (select count(*) from public.events where office_id is not null)`,
  ])
  const expect = run.stopsAt === '0657' ? '0' : null
  if (expect !== null)
    say(
      stamped.out.trim() === '0',
      'and left nothing stamped (the wave rolled back whole)',
      `stamped rows: ${stamped.out.trim()}`,
    )
}
psql('postgres', ['-c', `drop database if exists ${WORK_DB}`])
console.log(
  failed === 0
    ? '\nevery plant was refused, and the control passed'
    : `\n${String(failed)} check(s) failed`,
)
process.exitCode = failed === 0 ? 0 : 1
