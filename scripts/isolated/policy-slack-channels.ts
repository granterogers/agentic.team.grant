/**
 * Decision 2 - a project Grant made carries its normal Slack channel; nothing unprompted does.
 *
 *   npx tsx scripts/isolated/policy-slack-channels.ts <replica-db>
 *
 * The REAL gateway creates the projects, the REAL `channelsHandler` provisions them against a recording stand-in for
 * Slack (every call it makes is visible), and the DATABASE says why each channel was or was not made. Provenance is
 * read from the database; a payload, a job's config and a machine's say-so are each tried and each refused.
 */
import { channelsHandler } from '../../src/handlers/channels.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { json, lit, policyWorld } from './policy-lib.ts'

const w = await policyWorld('psc')
const { db, one, rows, check } = w

await db.execute(`insert into public.slack_workspaces (office_id, team_id, team_name, bot_user_id)
  values (app.operator_office(), 'T-ISOLATED', 'isolated', 'U0ISOLATED') on conflict do nothing`)
const created: string[] = []
let n = 0
const stub: typeof fetch = async (input) => {
  const url = String(input)
  const method = url.split('/').pop()?.split('?')[0] ?? ''
  if (method === 'conversations.create') {
    n += 1
    created.push(`C0${String(n).padStart(8, '0')}`)
    return new Response(
      JSON.stringify({
        ok: true,
        channel: { id: `C0${String(n).padStart(8, '0')}`, name: `chan-${String(n)}` },
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    )
  }
  return new Response(JSON.stringify({ ok: true, channels: [] }), {
    headers: { 'content-type': 'application/json' },
  })
}
const slack = new SlackClient('isolated bot token placeholder', {
  fetchImpl: stub,
  sleep: async () => undefined,
})
const handler = (kind = 'office.provision_channels') =>
  channelsHandler(
    { db, botToken: 'isolated bot token placeholder', teamId: 'T-ISOLATED', slack },
    kind,
  )

const mk = async (label: string, by: 'person' | 'sql'): Promise<string> => {
  const name = `Channel proof ${label} ${w.run}`
  if (by === 'person') {
    const r = await w.asPerson('create_project', {
      p_name: name,
      p_connector: 'upload',
      p_ref: `r-${label}-${w.run}`,
      p_force: true,
    })
    if (r.status !== 200) throw new Error(`create failed ${JSON.stringify(r.body)}`)
  } else {
    await one(
      `select app.hq_create_project(app.operator_office(), ${lit(name)}, 'upload', ${lit(`r-${label}-${w.run}`)}, ${lit(name)}, true) as r`,
    )
  }
  return String(
    (await one(`select project_id::text as id from public.projects where name = ${lit(name)}`)).id,
  )
}
const sweepJob = async (project: string) =>
  w.jobOf(
    String(
      (
        await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id)
          values ((select p.office_id from public.projects p where p.project_id = ${lit(project)}::uuid), 'office.provision_channels', 'hq', ${lit(project)}::uuid, 'prov-' || gen_random_uuid(), gen_random_uuid())
          returning job_id::text as id`)
      ).id,
    ),
  )
const channelsFor = async (p: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.slack_channel_map where project_id = ${lit(p)}::uuid and active`,
      )
    ).n,
  )
const questionsFor = async (p: string) =>
  Number(
    (
      await one(
        `select count(*)::int as n from public.blockers where project_id = ${lit(p)}::uuid and requested_action like '%Slack channel%'`,
      )
    ).n,
  )
const authority = async (p: string) =>
  (
    await rows(
      `select authorized_by, authorized_via, consumed_at is not null as consumed from public.slack_channel_authority where project_id = ${lit(p)}::uuid`,
    )
  )[0]

// ---- 1. Grant makes a project: its channel is made, with the reason on record ------------------------------------
const A = await mk('a', 'person')
const row = await authority(A)
check(
  'a project a verified person made records WHO, as the gateway knew them',
  row?.authorized_by === 'grant' &&
    row?.authorized_via === 'project_creation' &&
    row?.consumed === false,
  JSON.stringify(row),
)
const out = await handler().handle(await sweepJob(A), db)
check(
  'its channel is made without a question, and the answer says why',
  (await channelsFor(A)) === 1 &&
    created.length === 1 &&
    (await questionsFor(A)) === 0 &&
    /created the project/.test(out.body),
  out.body.slice(0, 120),
)
check(
  'the authority is spent',
  (await authority(A))?.consumed === true,
  JSON.stringify(await authority(A)),
)
await handler().handle(await sweepJob(A), db)
await handler('office.rename_channels').handle(await sweepJob(A), db)
check(
  'a retry, a second sweep and a rename job make no second channel',
  (await channelsFor(A)) === 1 && created.length === 1,
  `${String(created.length)} created`,
)
await one(
  `update public.slack_channel_map set active = false, archived_at = now() where project_id = ${lit(A)}::uuid returning 1 as x`,
)
await w.asPerson('create_project', {
  p_name: `Channel proof a ${w.run}`,
  p_connector: 'upload',
  p_ref: `again-${w.run}`,
  p_force: true,
})
await handler().handle(await sweepJob(A), db)
check(
  'a channel that is gone is NOT remade on the strength of the old creation: it asks',
  (await channelsFor(A)) === 0 && created.length === 1 && (await questionsFor(A)) === 1,
  `${String(created.length)} created, ${String(await questionsFor(A))} question(s)`,
)

// ---- 2. unprompted provisioning asks, and a yes makes it once --------------------------------------------------
const B = await mk('b', 'sql')
check(
  'a project nobody asked a person for has no authority row',
  (await authority(B)) === undefined,
  'none',
)
const askedOut = await handler().handle(await sweepJob(B), db)
const asked = await rows(
  `select blocker_id::text as id, approval_options, decline_option, action_fingerprint, on_answer from public.blockers
    where project_id = ${lit(B)}::uuid and state = 'open'`,
)
check(
  'the sweep finding it asks one exact question and makes nothing',
  (await channelsFor(B)) === 0 &&
    asked.length === 1 &&
    typeof asked[0]?.action_fingerprint === 'string' &&
    created.length === 1,
  askedOut.body.slice(0, 100),
)
await handler().handle(await sweepJob(B), db)
check(
  'and asks only once while it is open',
  (await questionsFor(B)) === 1,
  `${String(await questionsFor(B))}`,
)
const yes = await w.answer(
  String(asked[0]?.id),
  String(((asked[0]?.approval_options ?? []) as string[])[0]),
)
check(
  'a yes starts one child of the asking job',
  yes.ok === true && Number(yes.started) === 1,
  JSON.stringify(yes).slice(0, 90),
)
const kid = await rows(
  `select job_id::text as id, kind from public.jobs where parent_job_id = (select job_id from public.blockers where blocker_id = ${lit(String(asked[0]?.id))}::uuid)`,
)
await handler(String(kid[0]?.kind)).handle(await w.jobOf(String(kid[0]?.id)), db)
check(
  'the child makes the channel, once',
  (await channelsFor(B)) === 1 && created.length === 2,
  `${String(created.length)} created in all`,
)
await handler(String(kid[0]?.kind)).handle(await w.jobOf(String(kid[0]?.id)), db)
check('and running it again makes no second', created.length === 2, `${String(created.length)}`)

// ---- 3. a No stands -------------------------------------------------------------------------------------------
const C = await mk('c', 'sql')
await handler().handle(await sweepJob(C), db)
const qc = String(
  (
    await one(
      `select blocker_id::text as id from public.blockers where project_id = ${lit(C)}::uuid and state = 'open'`,
    )
  ).id,
)
await w.answer(qc, 'No, not now')
await handler().handle(await sweepJob(C), db)
await handler().handle(await sweepJob(C), db)
check(
  'a No makes nothing and is not asked again',
  (await channelsFor(C)) === 0 && (await questionsFor(C)) === 1,
  `${String(await questionsFor(C))} question(s)`,
)

// ---- 4. nothing a job, a machine or a payload says is provenance --------------------------------------------------
const D = await mk('d', 'sql')
const dJob = await sweepJob(D)
await one(
  `update public.jobs set pinned_config = pinned_config || '{"authorized_by":"grant","channel_authority":true,"project_creation":true}'::jsonb where job_id = ${lit(dJob.jobId)}::uuid returning 1 as x`,
)
await handler().handle(await w.jobOf(dJob.jobId), db)
check(
  'a job whose config claims Grant made the project is still asked about',
  (await channelsFor(D)) === 0 && (await questionsFor(D)) === 1,
  `${String(await questionsFor(D))} question(s)`,
)
// The authority is recorded inside the office that holds the project (migration 0804).
const dOffice = `(select office_id from public.projects where project_id = ${lit(D)}::uuid)`
const dutyTry = json(
  (
    await one(
      `select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, null, ${lit((await w.dutyJob('office.provision_channels', D)).jobId)}::uuid) as r`,
    )
  ).r,
)
const machineTry = json(
  (
    await one(
      `select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, 'verify-operator', null) as r`,
    )
  ).r,
)
const strangerTry = json(
  (
    await one(
      `select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, 'mallory', null) as r`,
    )
  ).r,
)
const nobodyTry = json(
  (await one(`select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, null, null) as r`))
    .r,
)
check(
  'a duty job, a test member, a stranger and nobody each produce no authority',
  [dutyTry, machineTry, strangerTry, nobodyTry].every((r) => r.ok === false) &&
    (await authority(D)) === undefined,
  JSON.stringify([dutyTry.error, machineTry.error, strangerTry.error, nobodyTry.error]),
)
const personTurn = await w.personTurn()
const planTry = json(
  (
    await one(
      `select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, null, ${lit(personTurn)}::uuid) as r`,
    )
  ).r,
)
check(
  "control: a job that IS a person's own turn does produce it (the chat path)",
  planTry.ok === true && (await authority(D))?.authorized_via === 'project_creation',
  JSON.stringify(planTry),
)
await one(
  `delete from public.slack_channel_authority where project_id = ${lit(D)}::uuid returning 1 as x`,
)
const forwardedTurn = await w.personTurn()
await one(
  `update public.inbound_commands set context = coalesce(context, '{}'::jsonb) || '{"forwarded":"true"}'::jsonb
    where command_id = (select origin_command_id from public.jobs where job_id = ${lit(forwardedTurn)}::uuid) returning 1 as x`,
)
const forwardedNow =
  (await one(`select app.job_forwarded(${lit(forwardedTurn)}::uuid) as f`)).f === true
const forwardedTry = json(
  (
    await one(
      `select app.record_channel_authority(${dOffice}, ${lit(D)}::uuid, null, ${lit(forwardedTurn)}::uuid) as r`,
    )
  ).r,
)
check(
  'a turn made of forwarded words authorises nothing (and the turn really is forwarded)',
  forwardedNow && forwardedTry.ok === false,
  JSON.stringify(forwardedTry),
)
// the gateway overwrites a principal the page tried to name
const spoof = await w.asPerson('create_project', {
  p_name: `Channel proof e ${w.run}`,
  p_connector: 'upload',
  p_ref: `e-${w.run}`,
  p_force: true,
  p_by: 'mallory',
})
const E = String(
  (
    await one(
      `select project_id::text as id from public.projects where name = ${lit(`Channel proof e ${w.run}`)}`,
    )
  ).id,
)
check(
  "a page naming somebody else as the creator is overwritten by the gateway's own knowledge",
  spoof.status === 200 && (await authority(E))?.authorized_by === 'grant',
  JSON.stringify(await authority(E)),
)
const viaKey = await w.asKey('create_project', {
  p_name: `fixture machine ${w.run}`,
  p_connector: 'upload',
  p_ref: `m-${w.run}`,
  p_force: true,
  p_by: 'grant',
})
const M = await one(
  `select project_id::text as id from public.projects where name = ${lit(`fixture machine ${w.run}`)}`,
)
check(
  'the office key may make a TEST project, and it records no authority however it names itself',
  viaKey.status === 200 && M?.id !== undefined && (await authority(String(M.id))) === undefined,
  `http ${String(viaKey.status)}`,
)
const viaKeyReal = await w.asKey('create_project', {
  p_name: `A real one ${w.run}`,
  p_connector: 'upload',
  p_ref: `k-${w.run}`,
  p_force: true,
})
check('and not a real one', viaKeyReal.status === 403, `http ${String(viaKeyReal.status)}`)

// ---- 5. a fixture project never gets a channel, whoever made it ----------------------------------------------
const F = String(M?.id)
const fixtureOut = await handler().handle(await sweepJob(F), db)
check(
  'a fixture project gets no channel and no question',
  (await channelsFor(F)) === 0 && (await questionsFor(F)) === 0 && /fixture/.test(fixtureOut.body),
  fixtureOut.body.slice(0, 80),
)

// ---- 6. review findings: the most permissive dial does not make an unprompted channel, nothing broad is standing,
//         and a stale reason lapses --------------------------------------------------------------------------------
await one(`select app.hq_autonomy_set(app.owner_office('grant'), 'act', null, 'grant') as r`)
const U = await mk('unprompted-act', 'sql')
const atAct = await handler().handle(await sweepJob(U), db)
await one(`select app.hq_autonomy_set(app.owner_office('grant'), 'suggest', null, 'grant') as r`)
check(
  'dial at "Act", nobody asked: still no channel, and a question is raised (a channel cannot be deleted)',
  (await channelsFor(U)) === 0 &&
    (await questionsFor(U)) === 1 &&
    !/said yes|created it/.test(atAct.body),
  atAct.body.slice(0, 90),
)
const broad = json(
  (
    await one(
      `select app.grant_standing(app.operator_office(), 'slack.channel', null, 'anywhere', 'grant') as r`,
    )
  ).r,
)
const broadProject = json(
  (
    await one(
      `select app.grant_standing(app.operator_office(), 'slack.channel', ${lit(U)}::uuid, 'anywhere', 'grant') as r`,
    )
  ).r,
)
check(
  'no standing yes can cover slack.channel, tool-wide or per project',
  broad.ok === false && broadProject.ok === false,
  String(broad.error).slice(0, 80),
)
const L = await mk('lapsed', 'person')
await one(
  `update public.slack_channel_authority set created_at = created_at - interval '10 days' where project_id = ${lit(L)}::uuid returning 1 as x`,
)
const lapsed = await handler().handle(await sweepJob(L), db)
check(
  'a creation reason ten days old has lapsed: the channel asks instead of being made',
  (await channelsFor(L)) === 0 && (await questionsFor(L)) === 1,
  lapsed.body.slice(0, 90),
)
await w.finish()
