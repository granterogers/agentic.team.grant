/**
 * R37 / R41 — synthetic traffic is refused before a real side effect; genuine
 * traffic is not; and the witness that does not ask the guard catches what the
 * guard misses.
 *
 *   npx tsx scripts/isolated/containment.ts <replica-db>
 *
 * Every case goes through the REAL `app.claim_delivery` for a production
 * destination (Grant's chat id, a real Slack channel id). Nothing is sent:
 * this file never constructs a transport. The witnesses are the SQL that
 * `npm run check:leaks` runs, imported, not copied.
 */
import { harnessDocSql, offShapeSql } from '../leak-witness.ts'
import { isolated } from './guard.ts'
import { registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'r37')
await registerBot(db)
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

/** A command in through a door. `door` true means a production door (PostgREST). */
const turn = async (
  channel: string,
  key: string,
  actor: string,
  door: boolean,
): Promise<string> => {
  const cmd = await one(`
    ${door ? "set local application_name = 'PostgREST 14.5';" : ''}
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${lit(channel)}, ${lit(`${run}-${key.slice(-12)}:1`)}, ${lit(actor)}, 'containment proof', ${lit(key)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v
  return String((v as { job_id: string }).job_id)
}
const claim = async (
  jobId: string,
  channel = 'telegram',
  target = '1386648496',
): Promise<string> => {
  const r = await one(`
    select outcome from app.claim_delivery(app.job_office(${lit(jobId)}::uuid),
      ${lit(channel)}, ${lit(`${run}:${jobId}:${channel}`)}, 'acct', ${lit(target)},
      'result', null, null, null, ${lit(jobId)}::uuid, interval '1 minute')`)
  return String(r.outcome)
}
const markSent = (jobId: string, channel = 'telegram') =>
  db.execute(
    `select app.record_delivery_sent(app.job_office(${lit(jobId)}::uuid), (select delivery_id from public.deliveries where dedupe_key = ${lit(`${run}:${jobId}:${channel}`)}), 'm-${run}', null)`,
  )

const synthetic: [string, () => Promise<string>][] = [
  [
    'voice: verify:scenario-a session (0598)',
    () => turn('voice', `voice:turn:scenario-a-${run}.1`, 'grant', true),
  ],
  [
    'voice: deploy probe session (0598)',
    () => turn('voice', `voice:turn:deploy${String(Date.now())}.1`, 'grant', true),
  ],
  [
    'voice: renamed deploy probe (verify-)',
    () => turn('voice', `voice:turn:verify-deploy-${run}.1`, 'grant', true),
  ],
  [
    'a Grant-looking command that did not come through a door',
    () =>
      turn(
        'telegram',
        `telegram:message:1:1386648496:${String(Date.now() % 100000)}`,
        'grant',
        false,
      ),
  ],
]
for (const [what, make] of synthetic) {
  const j = await make()
  check(`SYNTHETIC ${what} is refused`, (await claim(j)) === 'suppressed', `job ${j.slice(0, 8)}`)
}

// Nested, retried and delayed work inherits the refusal.
{
  const parent = await turn('voice', `voice:turn:verify-nested-${run}.1`, 'grant', true)
  const child = String(
    (
      await one(
        `select app.enqueue_child(p_office => app.job_office(${lit(parent)}::uuid), p_parent => ${lit(parent)}::uuid, p_kind => 'office.synthesise', p_payload => '{}'::jsonb)::text as v`,
      )
    ).v,
  )
  const childId = child.match(/[0-9a-f-]{36}/)?.[0] ?? ''
  check(
    'SYNTHETIC a child of harness work is refused',
    (await claim(childId)) === 'suppressed',
    `child ${childId.slice(0, 8)}`,
  )
  await db.execute(`update public.jobs set attempt = 2 where job_id = ${lit(parent)}::uuid`)
  check(
    'SYNTHETIC a retried harness job is still refused',
    (await claim(parent, 'slack', 'C0C276SFM7D')) === 'suppressed',
    'attempt 2',
  )
  const delayed = await turn('voice', `voice:turn:verify-delayed-${run}.1`, 'grant', true)
  await db.execute(
    `update public.jobs set not_before = now() + interval '1 day' where job_id = ${lit(delayed)}::uuid`,
  )
  check(
    'SYNTHETIC a delayed harness job is still refused',
    (await claim(delayed)) === 'suppressed',
    'not_before +1 day',
  )
}

// Genuine traffic must remain deliverable.
const genuine: [string, () => Promise<string>, string, string][] = [
  [
    'the dashboard page session',
    () => turn('voice', `voice:turn:s${run.slice(0, 9)}.1`, 'grant', true),
    'telegram',
    '1386648496',
  ],
  [
    'a Telegram message from his chat',
    () =>
      turn(
        'telegram',
        `telegram:message:8967954396:1386648496:${String(Date.now() % 100000)}`,
        '1386648496',
        true,
      ),
    'telegram',
    '1386648496',
  ],
  [
    'a Slack message in his channel',
    () =>
      turn(
        'slack',
        `slack:message:C0C2DAPDN02:${String(Math.floor(Date.now() / 1000))}.${String(Date.now() % 1000000).padStart(6, '0')}`,
        'U0REAL',
        true,
      ),
    'slack',
    'C0C2DAPDN02',
  ],
]
for (const [what, make, channel, target] of genuine) {
  const j = await make()
  const outcome = await claim(j, channel, target)
  check(`GENUINE ${what} stays deliverable`, outcome === 'claimed', outcome)
}

// Document-triggered work.
// The new-source trigger needs content over its floor and a project that already
// has material, so a fixture document is given both.
const BODY = 'containment proof material. '.repeat(40)
await db.execute(`insert into public.documents (project_id, connector, external_ref, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
  values (app.unnamed_project(app.test_office()), 'upload', ${lit(`seed-${run}`)}, 'seed', 'source', ${lit(BODY)}, encode(extensions.digest(${lit(BODY)}, 'sha256'), 'hex'), ${String(BODY.length)}, now(), 'grant')`)
const doc = async (added: string, ref: string): Promise<string> => {
  const d = await one(`
    insert into public.documents (project_id, connector, external_ref, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (app.unnamed_project(app.test_office()), 'notebooklm', ${lit(ref)}, ${lit(`containment ${run} ${ref.slice(-6)}`)}, 'source', ${lit(BODY + ref)}, encode(extensions.digest(${lit(BODY + ref)}, 'sha256'), 'hex'), ${String(BODY.length)}, now(), ${lit(added)})
    returning document_id::text as id`)
  const j = await one(
    `select job_id::text as id from public.jobs where pinned_config ->> 'document_id' = ${lit(String(d.id))} limit 1`,
  )
  return String(j?.id ?? '')
}
{
  const labelled = await doc('verify:scenario-a', `src:verify-scenario-a-${run}`)
  check(
    'SYNTHETIC a harness document labelled :verify- is refused',
    labelled !== '' && (await claim(labelled, 'slack', 'C0BV7ULTCJ1')) === 'suppressed',
    labelled === '' ? 'no job was started' : 'suppressed',
  )
  const real = await doc('grant', `src-real-${run}`)
  check(
    'GENUINE a document he added stays deliverable',
    real !== '' && (await claim(real, 'slack', 'C0BV7ULTCJ1')) === 'claimed',
    real === '' ? 'no job' : 'claimed',
  )
}

// #379: the two shapes the guard USED to miss are now refused by it.
const missDoor = await turn('telegram', `telegram:message:escapes-${run}-real`, '1386648496', true)
const missDoc = await doc('verify:scenario-a', `src#scenario-a-${run}`)
check(
  'the guard refuses a production-door impersonation (#379, was a known miss)',
  (await claim(missDoor)) === 'suppressed',
  'suppressed',
)
check(
  'the guard refuses work a harness-added document started (#379, was a known miss)',
  (await claim(missDoc, 'slack', 'C0BV7ULTCJ1')) === 'suppressed',
  'suppressed',
)
// THE SABOTAGE: break the guard's origin question, send both, and the witnesses must see them.
await db.execute(`create or replace function app.job_origin(p_job_id uuid) returns text
  language sql stable as $f$ select 'trusted'::text $f$`)
await db.execute(
  `delete from public.deliveries where dedupe_key in (${lit(`${run}:${missDoor}:telegram`)}, ${lit(`${run}:${missDoc}:slack`)})`,
)
const missDoorOutcome = await claim(missDoor)
const missDocOutcome = await claim(missDoc, 'slack', 'C0BV7ULTCJ1')
check(
  'SABOTAGE with the origin question broken, the impersonation gets through',
  missDoorOutcome === 'claimed',
  missDoorOutcome,
)
check('SABOTAGE and so does the harness document', missDocOutcome === 'claimed', missDocOutcome)
await markSent(missDoor)
await markSent(missDoc, 'slack')
const shape = (await db.execute(offShapeSql)).rows as { key: string }[]
const docs = (await db.execute(harnessDocSql)).rows as { key: string }[]
check(
  'the shape witness catches the impersonation the guard let through',
  shape.some((r) => r.key === `telegram:message:escapes-${run}-real`),
  `${String(shape.length)} off-shape`,
)
check(
  'the document witness catches the child the guard let through',
  docs.length === 1,
  `${String(docs.length)} flagged`,
)
// Restore: remove the sabotage, and both witnesses read clean with the genuine traffic still there.
await db.execute(
  `delete from public.deliveries where dedupe_key in (${lit(`${run}:${missDoor}:telegram`)}, ${lit(`${run}:${missDoc}:slack`)})`,
)
const shape2 = (await db.execute(offShapeSql)).rows.length
const docs2 = (await db.execute(harnessDocSql)).rows.length
check(
  'RESTORED both witnesses clean, and no genuine turn is flagged',
  shape2 === 0 && docs2 === 0,
  `off-shape ${String(shape2)}, documents ${String(docs2)}`,
)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
