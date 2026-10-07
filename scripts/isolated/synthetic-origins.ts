/**
 * #379 — work whose origin no production component could have produced may
 * not reach the outside world.
 *
 *   npx tsx scripts/isolated/synthetic-origins.ts <replica-db>
 *
 * Every command goes in THROUGH A PRODUCTION DOOR (PostgREST application
 * name), so 0576 does not mark it synthetic, and none carries a harness label,
 * so app.harness_job calls it real. That is exactly the shape of
 * `telegram:artifact_demo:02jzde`, which delivered to Grant's Slack and
 * Telegram on 17 September. The cases are chosen to be ARCHITECTURAL, not that
 * one string: a kind no adapter writes, an adapter kind with a body it cannot
 * produce, an adapter key naming a bot the office does not have, the retired
 * key format written today, a dashboard key the server never minted, and root
 * jobs no internal creator makes.
 *
 * Both boundaries are asked, as for legit-origins.ts: a delivery claim to a
 * real destination must be SUPPRESSED, and an external-writing child must be
 * REFUSED at the worker gate.
 */
import { containmentRefusal } from '../../src/jobs/containment.ts'
import { scopeOf } from './fixtures-jobs.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'syn379')
const run = Date.now().toString(36)
const n = () => String(Math.floor(Math.random() * 900000) + 100000)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const DOOR = "set local application_name = 'PostgREST 14.5';"
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const jsonOf = (v: unknown) =>
  (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const CHAT = '1386648496'

const turn = async (channel: string, key: string, ref: string): Promise<string | null> => {
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (${scopeOf('real').cols}, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${scopeOf('real').vals}, ${lit(channel)}, ${lit(ref)}, ${lit(CHAT)}, ${lit(`Synthetic ${run}`)}, ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = jsonOf(
    (await one(`${DOOR} select public.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v,
  )
  return typeof enq.job_id === 'string' ? enq.job_id : null
}
const rootJob = async (requestedBy: string, kind: string): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (office_id, correlation_id, idempotency_key, kind, requested_by)
        values (app.operator_office(), gen_random_uuid(), ${lit(`syn:${run}:${n()}`)}, ${lit(kind)}, ${lit(requestedBy)})
        returning job_id::text as v`)
    ).v,
  )

const contained = async (what: string, job: string | null) => {
  if (job === null) {
    check(`${what}: made no work at all`, true, 'nothing enqueued, so nothing can leave')
    return
  }
  const pre = await one(`select app.harness_job(${lit(job)}::uuid) as h`)
  const claim = await one(`select outcome from app.claim_delivery(app.job_office(${lit(job)}::uuid),
      'telegram', ${lit(`syn:${job}`)}, 'acct', ${lit(CHAT)},
      'result', null, null, null, ${lit(job)}::uuid)`)
  const why = String(
    (
      await one(
        `select coalesce(suppressed_reason, '') as r from public.deliveries where dedupe_key = ${lit(`syn:${job}`)}`,
      )
    ).r ?? '',
  )
  check(
    `${what}: its message never reaches Grant`,
    claim.outcome === 'suppressed',
    `${String(claim.outcome)} ${why}${pre.h === true ? ' (harness_job already says harness)' : ''}`,
  )
  const child =
    String(
      (
        await one(`select app.enqueue_child(p_office => app.job_office(${lit(job)}::uuid), p_parent => ${lit(job)}::uuid, p_kind => 'office.notion_import',
      p_payload => '{}'::jsonb)::text as v`)
      ).v,
    ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
  const gate = await containmentRefusal(db, { jobId: child, kind: 'office.notion_import' })
  check(`${what}: its delegated writer never runs`, gate !== null, gate ?? 'ALLOWED')
}

// --- turns through a production door that no adapter produces ------------------
await contained(
  'the 17 September key (telegram:artifact_demo)',
  await turn('telegram', `telegram:artifact_demo:${run}`, `${CHAT}:1`),
)
await contained(
  'a kind no adapter writes (telegram:ctx)',
  await turn('telegram', `telegram:ctx:${run}_m`, `${CHAT}:2`),
)
await contained(
  'an adapter kind with a body it cannot produce (telegram:message:<words>)',
  await turn('telegram', `telegram:message:escapes-${run}-real`, `${CHAT}:3`),
)
await contained(
  'a Telegram key naming a bot the office does not have',
  await turn('telegram', `telegram:message:1111111111:${CHAT}:${n()}`, `${CHAT}:4`),
)
await contained(
  'the retired four-part Telegram key, written today',
  await turn('telegram', `telegram:message:${CHAT}:${n()}`, `${CHAT}:5`),
)
await contained(
  'a Slack message key with no Slack channel or timestamp',
  await turn('slack', `slack:message:artifact-slack-${run}`, `C0C2DAPDN02:1`),
)
await contained(
  'a Slack reaction from a user id Slack never issues',
  await turn(
    'slack',
    `slack:reaction:C0BUWK34SP6:1788448699.000100:U_GATE4_GRANT:useful`,
    `C0BUWK34SP6:1788448699.000100`,
  ),
)
await contained(
  'a voice kind no door writes (voice:message)',
  await turn('voice', `voice:message:anchors-${run}-x-voice`, `anchors-${run}:1`),
)
await contained(
  'a dashboard key the server never minted (teamhq:<anything>)',
  await turn('teamhq', `teamhq:artifact_report:${run}`, `teamhq-${run}`),
)
await contained(
  'a dashboard message key that is not a server uuid',
  await turn('teamhq', `teamhq:message:${run}`, `teamhq-${run}-2`),
)
await contained(
  'a key on one door claiming another (slack key on telegram)',
  await turn('telegram', `slack:message:C0C2DAPDN02:1790000000.123456`, `${CHAT}:6`),
)

// --- root jobs that no internal creator makes -----------------------------------
await contained(
  'a root instruction requested as telegram:grant with no turn',
  await rootJob('telegram:grant', 'office.instruction'),
)
await contained(
  "a root job requested by 'grant' that is not the Google revoke",
  await rootJob('grant', 'office.ask'),
)
await contained(
  'a duty that no responsibility defines',
  await rootJob(`duty:no-such-duty-${run}`, 'office.notion_sync'),
)
await contained(
  "'hq' asking for a kind hq never asks for",
  await rootJob('hq', 'office.instruction'),
)
await contained(
  'a trigger that does not exist',
  await rootJob(`trigger:no-such-trigger-${run}`, 'office.chores'),
)
await contained(
  'an MCP client the office never registered',
  await rootJob(`mcp:nobody-${run}`, 'office.instruction'),
)
{
  // A child of unknown work, two levels down, is still unknown.
  const root = await rootJob('telegram:grant', 'office.instruction')
  const mid =
    String(
      (
        await one(
          `select app.enqueue_child(p_office => app.job_office(${lit(root)}::uuid), p_parent => ${lit(root)}::uuid, p_kind => 'office.synthesise', p_payload => '{}'::jsonb)::text as v`,
        )
      ).v,
    ).match(/[0-9a-f-]{36}/)?.[0] ?? ''
  await contained('a grandchild of unknown work', mid)
}

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
