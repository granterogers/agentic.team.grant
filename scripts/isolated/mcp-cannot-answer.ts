/**
 * Deep-systems audit D1 (second wave): an external assistant's typed "yes" must not answer the owner's
 * approval question.
 *
 *   npx tsx scripts/isolated/mcp-cannot-answer.ts <replica-db>
 *
 * The path, against the LATEST effective definitions on the replica:
 *   owner has exactly one open question on a dashboard turn
 *   -> a connected assistant calls app.mcp_ask_team('yes')
 *   -> the command is origin 'unknown' (command_origin), actor = the owner
 *   -> app.open_questions_for_reply asks what that reply may bind to
 *   -> the handler would call app.hq_answer_blocker as app.command_principal(...)
 *
 * The property: a turn whose origin is not 'trusted' binds NOTHING, so the question stays open. Controls: a
 * trusted dashboard turn still binds the one open question (the guard did not buy safety by refusing everything),
 * and answering as the owner through hq_answer_blocker still works (the answer door itself is untouched).
 * Asserts the QUESTION'S STATE and the rows returned, never a sentence.
 */
import { createHash } from 'node:crypto'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const all = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const DOOR = "set local application_name = 'PostgREST 14.5';"

const office = String((await one(`select app.operator_office()::text as o`)).o)
const project = String((await one(`select app.unnamed_project(${lit(office)}::uuid)::text as p`)).p)
const slug = String((await one(`select slug from public.projects where project_id = ${lit(project)}::uuid`)).slug)
const client = `d1-proof-${run}`
await db.execute(`insert into public.mcp_clients (client_id, display_name, token_sha256, scopes, kind, office_id)
  values (${lit(client)}, 'D1 proof assistant', ${lit(createHash('sha256').update(run).digest('hex'))}, array['read','write'], 'claude', ${lit(office)}::uuid)`)

/** A dashboard turn exactly as app.say_in_project writes it. */
const dashboardTurn = async (text: string) => {
  const key = `teamhq:message:${crypto.randomUUID().replace(/-/g, '')}`
  const cmd = await one(`${DOOR}
    insert into public.inbound_commands (office_id, origin_channel, origin_ref, actor, instruction, dedupe_key, project_id, context)
    values (${lit(office)}::uuid, 'teamhq', ${lit(key)}, app.office_actor(${lit(office)}::uuid), ${lit(text)}, ${lit(key)}, ${lit(project)}::uuid, '{}'::jsonb)
    returning command_id::text as id`)
  const enq = json((await one(`${DOOR} select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)).v)
  return { command: String(cmd.id), job: String(enq.job_id) }
}
const ask = async (job: string) =>
  String(
    (
      await one(`insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
        values (${lit(office)}::uuid, ${lit(project)}::uuid, ${lit(job)}::uuid, ${lit(`D1 proof ${run} ${crypto.randomUUID().slice(0, 6)}`)}, 'isolated', 'nothing happens until answered', array['Yes','No'], 'chief-of-staff', false)
        returning blocker_id::text as id`)
    ).id,
  )
const stateOf = async (id: string) =>
  String((await one(`select state::text as s from public.blockers where blocker_id = ${lit(id)}::uuid`)).s)
const settle = (id: string) =>
  db.execute(`select app.hq_answer_blocker(${lit(office)}::uuid, ${lit(id)}::uuid, 'No', app.office_actor(${lit(office)}::uuid))`)

/** What an assistant's "yes" would bind to: the rows the handler asks for, and the principal it would answer as. */
const mcpYes = async (text: string, to?: string) => {
  const r = json(
    (
      await one(`${DOOR} select app.mcp_ask_team(${lit(office)}::uuid, ${lit(client)}, ${lit(slug)}, ${lit(text)}, ${to ? lit(to) : 'null'}) as v`)
    ).v,
  )
  const job = String(r.job_id ?? '')
  const command = String(
    (await one(`select command_id::text as c from public.jobs j join public.inbound_commands c on c.job_id = j.job_id where j.job_id = ${lit(job)}::uuid limit 1`)).c,
  )
  const rows = await all(
    `select id, bindable from app.open_questions_for_reply(${lit(office)}::uuid, ${lit(command)}::uuid)`,
  )
  const origin = String((await one(`select app.command_origin(${lit(command)}::uuid) as o`)).o)
  const principal = String((await one(`select app.command_principal(${lit(office)}::uuid, ${lit(command)}::uuid) as p`)).p)
  return { command, rows, origin, principal }
}

// ---- the attack -------------------------------------------------------------------------------------------------
{
  const prev = await dashboardTurn('start something that needs a go-ahead')
  const q = await ask(prev.job)
  const got = await mcpYes('yes')
  const bound = got.rows.filter((r) => r.bindable === true).map((r) => String(r.id))
  check('the assistant turn is not trusted (the door says so)', got.origin !== 'trusted', `origin ${got.origin}`)
  check(
    'an assistant "yes" binds NO open question of the owner (D1)',
    !bound.includes(q),
    `${String(bound.length)} bindable, includes the owner's question: ${String(bound.includes(q))}`,
  )
  // What the handler does next when a row is bindable: answer as the principal the command carries.
  if (bound.includes(q)) {
    const res = json(
      (
        await one(
          `select app.hq_answer_blocker(${lit(office)}::uuid, ${lit(q)}::uuid, 'Yes', ${lit(got.principal)}) as r`,
        )
      ).r,
    )
    check('(exploit trace) the owner question was answered by the assistant turn', false, JSON.stringify(res).slice(0, 80))
  }
  check('the owner question is still open after the assistant turn', (await stateOf(q)) === 'open', await stateOf(q))
  await settle(q)
}
// ---- variants ---------------------------------------------------------------------------------------------------
{
  const prev = await dashboardTurn('another thing that needs a go-ahead')
  const q = await ask(prev.job)
  const got = await mcpYes('Yes, go ahead', 'chief-of-staff')
  check(
    'addressing a specialist does not change it',
    !got.rows.some((r) => r.bindable === true && String(r.id) === q),
    `${String(got.rows.length)} row(s)`,
  )
  // The 'awaiting_answer' pin: the previous turn said it was waiting on exactly this question.
  await db.execute(
    `update public.jobs set pinned_config = coalesce(pinned_config, '{}'::jsonb) || jsonb_build_object('awaiting_answer', ${lit(q)}::text) where job_id = ${lit(prev.job)}::uuid`,
  )
  const pinned = await mcpYes('yes')
  check(
    'a question the previous turn pinned as awaited is still not answerable by an assistant',
    !pinned.rows.some((r) => r.bindable === true && String(r.id) === q),
    `${String(pinned.rows.length)} row(s)`,
  )
  await settle(q)
}
{
  // Two assistant turns in a row: the second one's "previous turn" is the assistant's own command.
  const prev = await dashboardTurn('a third thing that needs a go-ahead')
  const q = await ask(prev.job)
  await mcpYes('hello')
  const second = await mcpYes('yes')
  check(
    'the assistant cannot reach the owner question by chaining turns',
    !second.rows.some((r) => r.bindable === true && String(r.id) === q),
    `${String(second.rows.length)} row(s)`,
  )
  await settle(q)
}
// ---- controls: the guard did not buy safety by refusing everything -----------------------------------------------
{
  const prev = await dashboardTurn('a fourth thing that needs a go-ahead')
  const q = await ask(prev.job)
  const next = await dashboardTurn('yes')
  const rows = await all(
    `select id, bindable from app.open_questions_for_reply(${lit(office)}::uuid, ${lit(next.command)}::uuid) where bindable`,
  )
  check(
    'CONTROL: a trusted dashboard "yes" still binds the one open question',
    rows.length === 1 && String(rows[0]?.id) === q,
    `${String(rows.length)} bindable`,
  )
  const res = json(
    (
      await one(
        `select app.hq_answer_blocker(${lit(office)}::uuid, ${lit(q)}::uuid, 'Yes', app.command_principal(${lit(office)}::uuid, ${lit(next.command)}::uuid)) as r`,
      )
    ).r,
  )
  check('CONTROL: answering as the owner through the answer door still works', (await stateOf(q)) !== 'open', JSON.stringify(res).slice(0, 80))
}

await db.execute(`delete from public.mcp_clients where client_id = ${lit(client)}`).catch(() => undefined)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} ok`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
