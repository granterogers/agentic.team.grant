/**
 * Is there a recent backup, and has a restore actually been proven?
 *
 *   npm run verify:backups
 *
 * ## The failure this exists for
 *
 * Invariant 13 of this run's brief: *backup health requires a recent backup
 * AND a proven restore.* Before 0537 neither half was measurable.
 *
 * `app.office_health()` reported finished, failed, in-flight, stalled,
 * waiting, open provider breakers and budget holds, and had **no idea whether
 * a backup existed**. So on 17 September, when the nightly backup died and
 * there is no copy of the database from that date, the reading said
 * `failed: 1` for twenty-four hours in a window nobody was watching, and then
 * said nothing at all — which is what it said before this run started, and
 * what it would say tonight if backups stopped for good.
 *
 * And `npm run backup:rehearse` printed a report and exited, so "when did a
 * restore last work" had no answer anywhere. It has one now, in
 * `public.events` as `backup.rehearsed` — the office's own ledger of what it
 * did, rather than a new table holding a fact that belongs in an existing one.
 *
 * ## What is asserted, and what is deliberately only printed
 *
 * The MECHANISMS are asserted: the reading exists, it distinguishes a
 * finished run from a half-finished upload, the chore raises exactly once and
 * clears when the condition clears, the writer refuses a verdict that is
 * neither pass nor fail, and `office_health` actually carries both readings.
 *
 * The AGES are printed, not asserted. `backup_overdue` going true is a real
 * finding and it is what the CHORE is for; a suite that failed on it would go
 * red for the one reason Grant most needs a calm, actionable message instead
 * — and CLAUDE.md is emphatic that a check which cries wolf is one somebody
 * starts overriding. The one exception is that a reading which cannot see any
 * backup at all fails here, because that means the reading itself is broken.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

let failures = 0
const check = (ok: boolean, label: string, detail = ''): void => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures += 1
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const jsonOf = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

// ── 1. The reading exists and can see a backup at all ──────────────────────
const health = jsonOf((await one(`select app.backup_health() as r`)).r)
check(
  health.newest_backup_at !== null && health.newest_backup_at !== undefined,
  'the reading can see a finished backup',
  `${String(health.newest_backup_objects)} object(s), ${String(health.newest_backup_age_hours)}h old`,
)

/*
  A FINISHED run, not just an object in the bucket.

  `src/backup/portable.ts` writes the manifest last, so a run folder holding
  one is a run that completed. Asserted as an identity rather than a count:
  every run folder is either finished or partial, so the two must add up to
  the number of folders. A count would go red the night a backup legitimately
  lands.
*/
const folders = await one(`
  select
    (select count(distinct split_part(name, '/', 1)) from storage.objects
      where bucket_id = 'backups' and name like 'run-%')::int as all_runs,
    (select count(*) from (
       select split_part(name, '/', 1) as r from storage.objects
        where bucket_id = 'backups' and name like '%manifest.json.gz'
        group by 1) x)::int as with_manifest`)
const allRuns = Number(folders.all_runs ?? -1)
const finished = Number(health.finished_backups_kept ?? -1)
const partial = Number(health.partial_uploads ?? -1)
check(
  finished === Number(folders.with_manifest) && finished + partial === allRuns,
  'a finished run and a half-finished upload are told apart',
  `${String(finished)} finished + ${String(partial)} partial = ${String(allRuns)} folder(s)`,
)

// ── 2. The gaps it must state rather than let a real recovery discover ─────
check(
  health.offsite === false && String(health.offsite_note ?? '').length > 80,
  'the reading states the offsite gap in words rather than omitting it',
  `offsite = ${String(health.offsite)}`,
)
check(
  'vault_exported' in health,
  'and the empty-vault gap, which is the dominant term in real RTO',
  `vault_exported = ${String(health.vault_exported)}`,
)

// ── 3. The writer refuses a verdict that is neither ────────────────────────
let refused = ''
try {
  await db.execute(`select app.record_rehearsal('probably')`)
  refused = '(it accepted "probably")'
} catch (error) {
  refused = (error as Error).message
}
check(
  refused.includes('either passed or failed'),
  'a rehearsal verdict is pass or fail, and anything else is refused by name',
  refused.slice(0, 90),
)

// ── 4. The chore: raises once, does not storm, clears when fixed ───────────
/*
  One statement ending in a raise, so it rolls back. `public.tasks` is Grant's
  real My Tasks list and `app.chores_for_backups` writes to it — a drive that
  committed would leave a chore about a condition the drive invented.
*/
const DRIVE = `
do $drive$
declare
  r1 jsonb; r2 jsonb; r3 jsonb; open1 int; open2 int;
begin
  -- Make the condition true whatever today's real state is, by moving the
  -- threshold rather than by deleting evidence. An append-only ledger cannot
  -- be un-written, and a suite that tried would be asserting against the
  -- ledger's own safety rule.
  update public.system_config set value = '0'::jsonb
   where key = 'backup.rehearsal_max_age_hours';

  r1 := app.chores_for_backups();
  select count(*) into open1 from public.tasks
   where chore_key = 'backup:unproven' and state <> 'done';

  r2 := app.chores_for_backups();
  select count(*) into open2 from public.tasks
   where chore_key = 'backup:unproven' and state <> 'done';

  update public.system_config set value = '192'::jsonb
   where key = 'backup.rehearsal_max_age_hours';
  r3 := app.chores_for_backups();

  if open1 <> 1 then
    raise exception 'BACKUP-FAIL an unproven restore raised % chores, expected 1', open1; end if;
  if open2 <> 1 or (r2->>'raised')::int <> 0 then
    raise exception 'BACKUP-FAIL a second pass made % open / % raised — it would alert-storm',
      open2, r2->>'raised'; end if;
  if (r3->>'cleared')::int < 1 then
    raise exception 'BACKUP-FAIL the chore did not clear when the condition cleared — the list never empties'; end if;

  raise exception 'BACKUP-DRIVE PASS raised=% second_pass_raised=% cleared=% open_after_two=%',
    r1->>'raised', r2->>'raised', r3->>'cleared', open2;
end
$drive$;`

let said = ''
try {
  await db.execute(DRIVE)
  said = 'the drive returned without raising, which it cannot do'
} catch (error) {
  said = (error as Error).message.replace(/\s+/g, ' ')
}
const drove = said.includes('BACKUP-DRIVE PASS')
check(
  drove,
  'the chore raises once, does not repeat itself, and clears when the backup is healthy',
  drove ? said.slice(said.indexOf('BACKUP-DRIVE')).slice(0, 150) : said.slice(0, 300),
)

const debris = await one(
  `select count(*)::int as n from public.tasks where chore_key like 'backup:%'`,
)
check(Number(debris.n ?? -1) === 0, 'the drive left no chore behind', `${String(debris.n)} task(s)`)

const threshold = await one(
  `select value::text as v from public.system_config where key = 'backup.rehearsal_max_age_hours'`,
)
check(
  String(threshold.v) === '192',
  'and put the threshold back',
  `backup.rehearsal_max_age_hours = ${String(threshold.v)}`,
)

// ── 5. It is in the reading Grant's dashboard actually asks for ────────────
const office = jsonOf((await one(`select app.office_health(24) as r`)).r)
check(
  'backup' in office && 'progress' in office,
  'office_health carries the backup and the progress readings',
  `keys: ${Object.keys(office).length}`,
)

/*
  And it must stay cheap enough to be consulted.

  `last_progress()` takes three `max(occurred_at)` by `to_state`; each was a
  1,227 ms sequential scan before 0538's index, on a table growing about six
  thousand rows a day. A reading that takes four seconds is a reading somebody
  stops asking for, which is how it stops being a reading at all.
*/
const plan = (
  await db.execute(
    `explain (format json) select max(occurred_at) from public.job_state_transitions
      where to_state = 'running'`,
  )
).rows
const planText = JSON.stringify(plan)
check(
  planText.includes('job_transitions_state_time_idx'),
  'and the progress reading uses its index rather than scanning the transition log',
  planText.includes('Seq Scan') ? 'SEQUENTIAL SCAN' : 'index scan',
)

// ── What the state actually is. Printed, deliberately not asserted. ────────
console.log('\nbackup posture right now:')
console.log(`  newest finished backup     ${String(health.newest_backup_age_hours)}h ago`)
console.log(`  overdue?                   ${String(health.backup_overdue)}`)
console.log(
  `  last restore PROVEN        ${String(health.last_passing_rehearsal_at ?? 'never')}${
    health.last_rehearsal_outcome === undefined ? '' : ` (${String(health.last_rehearsal_outcome)})`
  }`,
)
console.log(`  rehearsal overdue?         ${String(health.rehearsal_overdue)}`)
console.log(`  copies kept                ${String(finished)} finished, ${String(partial)} partial`)
console.log(`  offsite copy               ${health.offsite === true ? 'yes' : 'NO'}`)
console.log(
  `  vault exported             ${health.vault_exported === true ? 'yes' : 'NO — a restore yields an empty vault'}`,
)

if (failures > 0) {
  console.error(`\n${String(failures)} check(s) failed.`)
  process.exit(1)
}
console.log('\nThe backup is visible, and a proven restore is a thing the office can know.')
