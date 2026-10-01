/**
 * Decision 4 - every Slack token rotation needs Grant's explicit approval, and nothing is ever standing.
 *
 *   npx tsx scripts/isolated/policy-slack-rotation.ts <replica-db>
 *
 * The REAL `slackRotationHandler` runs against the replica with `fetch` replaced by a recorder standing in for
 * Slack's `tooling.tokens.rotate`, so "it rotated" is a call that reached the provider and "it did not" is a count of
 * zero. The vault is read back to prove the pre-rotation copy survives a failure.
 */
import { slackRotationHandler } from '../../src/handlers/slack-rotation.ts'
import { json, lit, policyWorld } from './policy-lib.ts'

const w = await policyWorld('psr')
const { db, one, rows, check } = w

let rotations = 0
let mode: 'ok' | 'consumed' = 'ok'
const withSlack = async <T>(fn: () => Promise<T>): Promise<T> => {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('tooling.tokens.rotate')) {
      rotations += 1
      const body =
        mode === 'ok'
          ? {
              ok: true,
              token: `new-access-${String(rotations)}`,
              refresh_token: `new-refresh-${String(rotations)}`,
              exp: Math.floor(Date.now() / 1000) + 43_200,
            }
          : { ok: false, error: 'invalid_refresh_token' }
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    }
    return await real(input as never, init)
  }) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = real
  }
}
const handler = slackRotationHandler({ db, appId: 'A0PROOF9X', router: null })
const run = async (job: Awaited<ReturnType<typeof w.dutyJob>>) => {
  const before = rotations
  const out = await withSlack(() => handler.handle(job, db)).catch((e: Error) => ({
    body: `threw: ${e.message}`,
    announce: false,
  }))
  return { rotated: rotations - before, body: String(out.body), announce: out.announce }
}
const vault = async (name: string) =>
  String(
    (
      await one(
        `select decrypted_secret as v from vault.decrypted_secrets where name = ${lit(name)}`,
      )
    )?.v ?? '',
  )
const setExpiry = (hours: number) =>
  one(
    `update public.slack_app_credentials set config_token_expires_at = now() + make_interval(secs => ${String(hours * 3600)}) where slack_app_id = 'A0PROOF9X' returning 1 as x`,
  )
const openQuestions = async () =>
  rows(
    `select blocker_id::text as id, action_fingerprint, approval_options, decline_option from public.blockers where state = 'open' and requested_action like '%Slack configuration token%'`,
  )

await db.execute(
  `insert into public.slack_workspaces (team_id, team_name, bot_user_id) values ('TISOLATED1', 'isolated', 'U0ISOLATED') on conflict do nothing`,
)
await db.execute(
  `insert into public.slack_app_credentials (slack_app_id, team_id, app_name) values ('A0PROOF9X', 'TISOLATED1', 'proof') on conflict do nothing`,
)
await one(
  `select app.store_secret('slack.config_refresh_token', 'the-pre-rotation-refresh-token', 'proof') as r`,
)

// ---- 1. not near expiry: nothing is asked, nothing rotates ---------------------------------------------------
await setExpiry(10)
const far = await run(await w.dutyJob('office.slack_rotate'))
check(
  'control: with ten hours left it is left alone, and nobody is asked',
  far.rotated === 0 && (await openQuestions()).length === 0,
  far.body.slice(0, 70),
)

// ---- 2. near expiry: a duty asks, and does not rotate --------------------------------------------------------------
await setExpiry(3)
const asked = await run(await w.dutyJob('office.slack_rotate'))
const q = await openQuestions()
check(
  'a duty with three hours left does NOT rotate',
  asked.rotated === 0,
  `${String(asked.rotated)} rotation(s)`,
)
check(
  'it asks one exact question, with a named No, and the expiry is part of what is asked',
  q.length === 1 &&
    typeof q[0]?.action_fingerprint === 'string' &&
    q[0]?.decline_option === 'No, leave it',
  `${String(q.length)} question(s)`,
)
await run(await w.dutyJob('office.slack_rotate'))
await run(await w.dutyJob('office.slack_rotate'))
check(
  'and it is not asked again on later ticks',
  (await openQuestions()).length === 1,
  `${String((await openQuestions()).length)}`,
)

// ---- 3. nothing standing, nothing implied ------------------------------------------------------------------------
const standing = json(
  (await one(`select app.grant_standing('slack.rotate', null, 'always', 'grant') as r`)).r,
)
const viaGateway = await w.asPerson('grant_standing', {
  p_tool: 'slack.rotate',
  p_reason: 'always',
})
check(
  'no standing yes for rotation can be made, by a function or by a person through the gateway',
  standing.ok === false && json(viaGateway.body.result).ok === false,
  String(standing.error).slice(0, 80),
)
for (const dial of ['act', 'act_with_review', 'suggest']) {
  await one(`select app.hq_autonomy_set(${lit(dial)}, null, 'grant') as r`)
  await run(await w.dutyJob('office.slack_rotate'))
}
const rotationJob1 = (await w.dutyJob('office.slack_rotate')).jobId
const decisionAtAct = json(
  (
    await one(
      `select app.authorize_effect(p_office => app.job_office(${lit(rotationJob1)}::uuid), p_project => null, p_tool => 'slack.rotate', p_job => ${lit(rotationJob1)}::uuid, p_fingerprint => 'x') as d`,
    )
  ).d,
)
await one(`select app.hq_autonomy_set('act', null, 'grant') as r`)
const rotationJob2 = (await w.dutyJob('office.slack_rotate')).jobId
const atAct = json(
  (
    await one(
      `select app.authorize_effect(p_office => app.job_office(${lit(rotationJob2)}::uuid), p_project => null, p_tool => 'slack.rotate', p_job => ${lit(rotationJob2)}::uuid, p_fingerprint => 'x') as d`,
    )
  ).d,
)
check(
  'even at the most permissive dial, and with Slack connected, rotation still asks',
  atAct.verdict === 'ask' && decisionAtAct.verdict === 'ask' && rotations === 0,
  `act -> ${String(atAct.verdict)}`,
)
await one(`select app.hq_autonomy_set('suggest', null, 'grant') as r`)

// ---- 4. nothing a job carries is an approval -------------------------------------------------------------------------
const forged = await w.dutyJob('office.slack_rotate')
await one(
  `update public.jobs set pinned_config = pinned_config || '{"approved_by":"grant","approved":true,"approval":"yes"}'::jsonb where job_id = ${lit(forged.jobId)}::uuid returning 1 as x`,
)
const f = await run(await w.jobOf(forged.jobId))
check('a job that claims it was approved does not rotate', f.rotated === 0, `${String(f.rotated)}`)
// a yes to a DIFFERENT question on the same parent
const parent = await w.dutyJob('office.slack_rotate')
const other = String(
  (
    await one(
      `select app.request_generation_approval(app.job_office(${lit(parent.jobId)}::uuid), ${lit(parent.jobId)}::uuid, 'notebook.generate', 'a deck', 'proof') as id`,
    )
  ).id,
)
await w.answer(other, 'Yes')
const wrongKid = await w.childOf(parent.jobId, 'office.slack_rotate')
const wrong = await run(wrongKid)
check(
  'a yes to a different question on the parent job does not rotate',
  wrong.rotated === 0,
  `${String(wrong.rotated)}`,
)
const realQ = String(q[0]?.id)
const byTest = await w.answer(realQ, 'Yes, rotate it', 'verify-operator')
check(
  'a test member cannot approve a real rotation',
  typeof byTest.error === 'string' && (await openQuestions()).length === 1,
  String(byTest.error).slice(0, 80),
)
const wrongWords = await w.answer(realQ, 'Sure, whatever')
check(
  'an answer that is not one of the options is refused, and the question stays open',
  typeof wrongWords.error === 'string' && (await openQuestions()).length === 1,
  String(wrongWords.error).slice(0, 80),
)

// ---- 5. an approved rotation rotates once, and the approval is for THAT expiry ---------------------------------------
const yes = await w.answer(realQ, 'Yes, rotate it')
check(
  'a yes starts one child of the asking job',
  yes.ok === true && Number(yes.started) === 1,
  JSON.stringify(yes).slice(0, 80),
)
const kid = await rows(
  `select job_id::text as id from public.jobs where parent_job_id = (select job_id from public.blockers where blocker_id = ${lit(realQ)}::uuid)`,
)
const kidJob = await w.jobOf(String(kid[0]?.id))
const ok = await run(kidJob)
check(
  'the child rotates, once',
  ok.rotated === 1,
  `${String(ok.rotated)} rotation(s); ${ok.body.slice(0, 60)}`,
)
check(
  'and the new pair is in the vault',
  (await vault('slack.config_refresh_token')) === 'new-refresh-1',
  'refresh replaced',
)
const row = await one(
  `select config_token_expires_at > now() + interval '10 hours' as later, rotation_failures from public.slack_app_credentials where slack_app_id = 'A0PROOF9X'`,
)
check(
  'and the recorded expiry moved, so the next rotation is not thought due at once',
  row.later === true && Number(row.rotation_failures) === 0,
  JSON.stringify(row),
)
const again = await run(kidJob)
check(
  'running the same approved child again does not rotate a second time (the pair it approved replacing is gone)',
  again.rotated === 0,
  `${String(again.rotated)}`,
)
await setExpiry(3)
const next = await run(await w.dutyJob('office.slack_rotate'))
check(
  'the next window asks a NEW question: the old yes is not a yes to this rotation',
  next.rotated === 0 && (await openQuestions()).length === 1,
  `${String(next.rotated)} rotation(s), ${String((await openQuestions()).length)} question(s)`,
)
const staleKid = await w.childOf(
  kidJob.jobId === '' ? parent.jobId : String(kid[0]?.id),
  'office.slack_rotate',
)
const stale = await run(staleKid)
check(
  'a child started from the old approval, in the new window, does not rotate',
  stale.rotated === 0,
  `${String(stale.rotated)}`,
)

// ---- 6. a No stands -----------------------------------------------------------------------------------------------
const q2 = String((await openQuestions())[0]?.id)
await w.answer(q2, 'No, leave it')
await run(await w.dutyJob('office.slack_rotate'))
await run(await w.dutyJob('office.slack_rotate'))
check(
  'a No means no rotation and no new question',
  rotations === 1 && (await openQuestions()).length === 0,
  `${String(rotations)} rotation(s) in all`,
)

// ---- 7. a failure after the provider consumed the token keeps the recovery copy ------------------------------------
await one(`delete from public.blockers where blocker_id = ${lit(q2)}::uuid returning 1 as x`).catch(
  () => undefined,
)
await one(
  `update public.blockers set refusal_withdrawn_at = now() where blocker_id = ${lit(q2)}::uuid returning 1 as x`,
)
await db.execute(
  `create or replace function pg_temp.noop() returns void language sql as 'select 1'`,
)
await setExpiry(2)
await db.execute(`
  create or replace function app.zz_refuse_new_access() returns trigger language plpgsql as $f$
  begin if new.name = 'slack.config_token' then raise exception 'injected: the vault refused the new access token'; end if; return new; end $f$;
  drop trigger if exists zz_refuse_new_access on vault.secrets;
  create trigger zz_refuse_new_access before insert or update on vault.secrets for each row execute function app.zz_refuse_new_access()`)
const grantQ = await w.dutyJob('office.slack_rotate')
const q3 = await openQuestions()
let failedRun = { rotated: 0, body: '' }
if (q3[0] !== undefined) {
  await w.answer(String(q3[0].id), 'Yes, rotate it')
  const k3 = await rows(
    `select job_id::text as id from public.jobs where parent_job_id = (select job_id from public.blockers where blocker_id = ${lit(String(q3[0].id))}::uuid)`,
  )
  failedRun = await run(await w.jobOf(String(k3[0]?.id)))
} else {
  await run(grantQ)
  const q4 = await openQuestions()
  if (q4[0] !== undefined) {
    await w.answer(String(q4[0].id), 'Yes, rotate it')
    const k4 = await rows(
      `select job_id::text as id from public.jobs where parent_job_id = (select job_id from public.blockers where blocker_id = ${lit(String(q4[0].id))}::uuid)`,
    )
    failedRun = await run(await w.jobOf(String(k4[0]?.id)))
  }
}
await db.execute(`drop trigger if exists zz_refuse_new_access on vault.secrets`)
check(
  'a failure between the provider accepting the rotation and the vault taking the new pair loses nothing: the pre-rotation copy is still stored',
  failedRun.rotated === 1 && (await vault('slack.config_refresh_token')) === 'new-refresh-1',
  `rotated ${String(failedRun.rotated)}; ${failedRun.body.slice(0, 80)}`,
)
mode = 'consumed'
await w.finish()
