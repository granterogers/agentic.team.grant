/**
 * A delivery gets its office from durable provenance, and missing provenance is never the operator (migration 0883).
 *   npm run verify:delivery-office
 *
 * Everything runs inside ONE block that ends in a deliberate exception, so nothing is committed: the fixtures (a test
 * destination, a Telegram chat and a Slack channel that belong to the Sample office) are written and rolled back, and the
 * answers come back in the error text. No message is sent: app.claim_delivery records an attempt, it does not send.
 *
 * What is asserted, and why each has a control beside it:
 *   - a job's delivery is the job's office, for the operator, the Sample and a third person alike;
 *   - an UNKNOWN job, or no job and no registered sender, is the SYSTEM office and is refused (the old answer was Grant);
 *   - a registered operator sender with no job is still the operator's (the legitimate case keeps working);
 *   - a registered test destination is still the test office;
 *   - a caller cannot pair its own office with another office's job: the claim treats that job as not existing;
 *   - an operator sender may not address a destination that belongs to another office (Telegram and Slack), while the same
 *     sender to an unregistered destination is still allowed (so the refusal is about ownership, not about everything).
 */
import { db, lit, rows, sampleOffice } from '../sample/lib.ts'

let failed = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}

const sample = (await sampleOffice()).officeId
const run = Math.random().toString(36).slice(2, 8)
// A Telegram target must be numeric (deliveries_target_shaped), so the destinations carry digits only.
const digits = String(Date.now()).slice(-8)

const script = `
declare
  v_op uuid := app.operator_office();
  v_sys uuid := app.system_office();
  v_test uuid := app.test_office();
  v_sample uuid := ${lit(sample)}::uuid;
  v_sjob uuid; v_gjob uuid; v_third uuid; v_tjob uuid;
  v_proj uuid;
  v_out jsonb := '{}'::jsonb;
  v_claim record;
  v_chat text := '8${digits}';
  v_ch text := 'CZZ${run.toUpperCase()}';
begin
  select job_id into v_sjob from public.jobs where office_id = v_sample limit 1;
  select job_id into v_gjob from public.jobs where office_id = v_op and not app.harness_job(job_id) limit 1;
  select j.job_id, j.office_id into v_tjob, v_third from public.jobs j join public.offices o on o.office_id = j.office_id
   where o.kind = 'person' and j.office_id not in (v_op, v_sample) limit 1;
  v_out := v_out || jsonb_build_object('op', v_op, 'sys', v_sys, 'test', v_test, 'sample', v_sample, 'third', v_third,
    'have_sjob', v_sjob is not null, 'have_gjob', v_gjob is not null, 'have_tjob', v_tjob is not null);

  v_out := v_out || jsonb_build_object(
    'job_sample', app.delivery_office(v_sjob, 'telegram', '1', 'reply:a'),
    'job_grant', app.delivery_office(v_gjob, 'telegram', '1', 'reply:b'),
    'job_third', case when v_tjob is null then null else app.delivery_office(v_tjob, 'telegram', '1', 'reply:c') end,
    'unknown_job', app.delivery_office(gen_random_uuid(), 'telegram', '1', 'reply:d'),
    'jobless_ordinary', app.delivery_office(null, 'telegram', '1', 'random:' || ${lit(run)}),
    'jobless_no_key', app.delivery_office(null, 'telegram', '1'),
    'jobless_operator', app.delivery_office(null, 'telegram', '1', 'build:notify:x'));

  -- A registered test destination, written here and rolled back.
  insert into public.test_destinations (channel, target_ref, why) values ('telegram', '7${digits}', 'verify:delivery-office');
  v_out := v_out || jsonb_build_object('test_destination', app.delivery_office(null, 'telegram', '7${digits}', 'random:x'));

  -- A caller cannot pair its own office with another office's job.
  select * into v_claim from app.claim_delivery(v_sample, 'telegram', 'reply:mismatch-${run}', 'acct', '1', 'result',
                                               null, null, null, v_gjob);
  v_out := v_out || jsonb_build_object('mismatch_outcome', v_claim.outcome);

  -- A job-less ordinary delivery is recorded under the SYSTEM office, and refused.
  select * into v_claim from app.claim_delivery(
    app.delivery_office(null, 'telegram', '1', 'random:${run}-1'), 'telegram', 'random:${run}-1', 'acct', '1', 'notice');
  v_out := v_out || jsonb_build_object('ordinary_outcome', v_claim.outcome,
    'ordinary_office', (select office_id from public.deliveries where dedupe_key = 'random:${run}-1'));

  -- An operator sender to an unregistered destination still works (the legitimate case).
  select * into v_claim from app.claim_delivery(
    app.delivery_office(null, 'telegram', '6${digits}', 'build:${run}-ok'), 'telegram', 'build:${run}-ok', 'acct', '6${digits}', 'notice');
  v_out := v_out || jsonb_build_object('operator_unregistered_outcome', v_claim.outcome,
    'operator_unregistered_office', (select office_id from public.deliveries where dedupe_key = 'build:${run}-ok'));

  -- ... but not to a Telegram chat that belongs to the Sample office, nor a Slack channel of the Sample's project.
  insert into public.telegram_chats (chat_id, chat_type, bot_id, office_id) values (v_chat, 'private', 'verify', v_sample);
  select * into v_claim from app.claim_delivery(
    app.delivery_office(null, 'telegram', v_chat, 'build:${run}-foreign'), 'telegram', 'build:${run}-foreign', 'acct', v_chat, 'notice');
  v_out := v_out || jsonb_build_object('operator_foreign_tg_outcome', v_claim.outcome,
    'operator_foreign_tg_reason', (select suppressed_reason from public.deliveries where dedupe_key = 'build:${run}-foreign'));

  -- A Slack channel's office is its WORKSPACE's. A workspace of the Sample's, with a channel that has no project at all.
  insert into public.slack_workspaces (team_id, team_name, bot_user_id, office_id) values ('T${run.toUpperCase()}', 'zz verify', 'U${run.toUpperCase()}', v_sample);
  insert into public.slack_channel_map (channel_id, team_id, channel_name, purpose) values (v_ch, 'T${run.toUpperCase()}', 'zz-verify-${run}', 'general');
  select * into v_claim from app.claim_delivery(
    app.delivery_office(null, 'slack', v_ch, 'build:${run}-slack'), 'slack', 'build:${run}-slack', 'acct', v_ch, 'notice');
  v_out := v_out || jsonb_build_object('operator_foreign_slack_outcome', v_claim.outcome);

  raise exception 'RESULT %', v_out::text;
end`

const answer = await db
  .execute(`do $x$ ${script} $x$`)
  .then(() => null)
  .catch(
    (e: Error) => /RESULT (\{.*\})/s.exec(e.message)?.[1] ?? `ERROR ${e.message.slice(0, 400)}`,
  )

if (answer === null || answer.startsWith('ERROR')) {
  check('the block ran and reported', false, answer ?? 'no result')
} else {
  const g = JSON.parse(answer) as Record<string, string | boolean | null>
  check(
    'fixtures exist: a Sample job and an operator job',
    g.have_sjob === true && g.have_gjob === true,
  )
  check(
    'a job of the Sample is delivered for the Sample',
    g.job_sample === g.sample,
    String(g.job_sample),
  )
  check('a job of the operator is delivered for the operator', g.job_grant === g.op)
  if (g.have_tjob === true)
    check('a job of a third person is delivered for that person', g.job_third === g.third)
  else console.log('skip a third person has no job to drive (not a failure)')
  check(
    'an unknown job is the SYSTEM office, never the operator',
    g.unknown_job === g.sys && g.unknown_job !== g.op,
  )
  check(
    'no job and no registered sender is the SYSTEM office',
    g.jobless_ordinary === g.sys && g.jobless_ordinary !== g.op,
  )
  check('no job and no dedupe key is the SYSTEM office', g.jobless_no_key === g.sys)
  check(
    'a registered operator sender with no job is still the operator’s',
    g.jobless_operator === g.op,
  )
  check('a registered test destination is the test office', g.test_destination === g.test)
  check(
    'a caller cannot pair its office with another office’s job',
    g.mismatch_outcome === 'suppressed',
    String(g.mismatch_outcome),
  )
  check(
    'an ordinary job-less delivery is refused and recorded under the SYSTEM office, not the operator',
    g.ordinary_outcome === 'suppressed' && g.ordinary_office === g.sys,
    `${String(g.ordinary_outcome)} in ${String(g.ordinary_office)}`,
  )
  check(
    'CONTROL: an operator sender to an unregistered destination is still claimed, in the operator office',
    g.operator_unregistered_outcome === 'claimed' && g.operator_unregistered_office === g.op,
    `${String(g.operator_unregistered_outcome)} in ${String(g.operator_unregistered_office)}`,
  )
  check(
    'an operator sender may not address another office’s Telegram chat',
    g.operator_foreign_tg_outcome === 'suppressed' &&
      String(g.operator_foreign_tg_reason).startsWith('destination belongs to another office'),
    String(g.operator_foreign_tg_reason),
  )
  check(
    'nor another office’s Slack channel',
    g.operator_foreign_slack_outcome === 'suppressed',
    String(g.operator_foreign_slack_outcome),
  )
}

const left = Number(
  (await rows(`select count(*) n from public.deliveries where dedupe_key like '%${run}%'`))[0]?.n,
)
check('nothing was left behind (the block rolled back)', left === 0, `${left} rows`)
console.log(failed === 0 ? '\nDELIVERY-OFFICE: PASS' : `\nDELIVERY-OFFICE: ${failed} FAILED`)
process.exitCode = failed === 0 ? 0 : 1
