/**
 * Decision 1 - Vikunja: create and update are automatic, delete needs Grant's approval, one task at a time.
 *
 *   npx tsx scripts/isolated/policy-vikunja.ts <replica-db>
 *
 * The REAL `tasksSyncHandler` runs against the replica with a recording stand-in for Vikunja (every call it makes is
 * visible), the REAL gateway connects the board as a verified person, and the DATABASE is asked what happened. Each
 * group has its positive control: a suite of refusals passes against a system that refuses everything.
 */
import { tasksSyncHandler } from '../../src/handlers/tasks-sync.ts'
import type {
  CanonicalTask,
  RemoteTask,
  TaskProvider,
  UpsertResult,
} from '../../src/tasks/provider.ts'
import { json, lit, policyWorld } from './policy-lib.ts'

const w = await policyWorld('pvk')
const { db, one, rows, check } = w

class Remote implements TaskProvider {
  readonly name = 'vikunja'
  readonly calls: { verb: string; id: string; title: string }[] = []
  private readonly held = new Map<string, CanonicalTask>()
  private n = 0
  async upsert(task: CanonicalTask): Promise<UpsertResult> {
    this.n += 1
    const id = task.externalId ?? `r${String(this.n)}`
    this.calls.push({ verb: task.externalId === null ? 'create' : 'update', id, title: task.title })
    this.held.set(id, { ...task, externalId: id })
    return { externalId: id, externalRevision: `v${String(this.n)}`, externalProjectId: '7' }
  }
  async remove(id: string): Promise<void> {
    this.calls.push({ verb: 'delete', id, title: this.held.get(id)?.title ?? '' })
    this.held.delete(id)
  }
  async list(): Promise<RemoteTask[]> {
    return [...this.held.values()].map((t) => ({
      externalId: String(t.externalId),
      externalRevision: `v${String(t.revision)}`,
      title: t.title,
      detail: t.detail,
      done: t.done,
      priority: t.priority,
      dueOn: t.dueOn,
      externalProjectId: '7',
    }))
  }
  async reachable(): Promise<boolean> {
    return true
  }
  count(verb: string, title = ''): number {
    return this.calls.filter((c) => c.verb === verb && c.title.includes(title)).length
  }
}
const remote = new Remote()
const handler = tasksSyncHandler(db, { provider: () => remote })
const tick = async () => await handler.handle(await w.dutyJob('tasks.sync'), db)

const BOARD = 'https://tasks.example.test'
const TOK = `tk_${'a'.repeat(32)}`
const addTask = async (title: string): Promise<string> => {
  const r = json(
    (
      await one(
        `select app.my_task_add(p_office => app.test_office(), p_title => ${lit(title)}) as r`,
      )
    ).r,
  )
  return String(r.id ?? r.task_id)
}

// ---- 0. the connection IS the yes, and only a person's connecting counts ----------------------------------------
const byKey = await w.asKey('vikunja_connect', {
  p_base_url: BOARD,
  p_project_id: 7,
  p_api_token: TOK,
})
check(
  'the office key cannot connect a board at all',
  byKey.status === 403,
  `http ${String(byKey.status)}`,
)
const byTest = await w.asTest('vikunja_connect', {
  p_base_url: BOARD,
  p_project_id: 7,
  p_api_token: TOK,
})
// P1.3 made connecting a board an operator-only act, so the gateway refuses a test member at the door (403, operator_required
// or person_required) instead of answering 200 with an error inside the result. Any of them is a refusal; what must hold
// is that it WAS refused and that nothing was minted.
check(
  'a TEST member cannot connect one either, and mints no authorization',
  (byTest.status === 403
    ? ['operator_required', 'person_required'].includes(
        String((byTest.body as { error?: unknown }).error),
      )
    : typeof json(byTest.body.result).error === 'string') &&
    Number(
      (
        await one(
          `select count(*)::int as n from public.standing_authorizations where tool = 'task.board.write'`,
        )
      ).n,
    ) === 0,
  `http ${String(byTest.status)}`,
)
const first = await tick()
check(
  'control: a board that is not connected does nothing and says nothing',
  remote.calls.length === 0 && first.announce === false,
  first.body.slice(0, 60),
)
const connected = await w.asPerson('vikunja_connect', {
  p_base_url: BOARD,
  p_project_id: 7,
  p_api_token: TOK,
})
check(
  'a person connecting the board is authorised, for THAT board',
  connected.status === 200 && connected.body.result !== undefined,
  `http ${String(connected.status)} ${JSON.stringify(connected.body).slice(0, 120)}`,
)
const standing = await rows(
  `select scope_ref, granted_by, revoked_at is null as live from public.standing_authorizations where tool = 'task.board.write'`,
)
check(
  'and the yes is a row that names the board and the person, nothing wider',
  standing.length === 1 &&
    standing[0]?.scope_ref === `vikunja:${BOARD}#7` &&
    standing[0]?.live === true &&
    standing[0]?.granted_by === 'grant',
  JSON.stringify(standing),
)

// ---- 1. create and update proceed -------------------------------------------------------------------------------
const t1 = await addTask(`Pay the printer ${w.run}`)
await tick()
check(
  'CREATE proceeds with no question',
  remote.count('create', 'Pay the printer') === 1 &&
    Number(
      (
        await one(
          `select count(*)::int as n from public.blockers where state = 'open' and requested_action like '%Vikunja%'`,
        )
      ).n,
    ) === 0,
  `${String(remote.count('create', 'Pay the printer'))} create(s)`,
)
await one(
  `select app.my_task_set(p_office => app.test_office(), p_task_id => ${lit(t1)}, p_title => ${lit(`Pay the printer, urgently ${w.run}`)}) as r`,
)
await tick()
check(
  'UPDATE proceeds with no question',
  remote.count('update') >= 1,
  `${String(remote.count('update'))} update(s)`,
)

// ---- 2. delete asks ---------------------------------------------------------------------------------------------
await one(`select app.my_task_delete(${lit(t1)}, 'proof') as r`)
const askedAt = await tick()
const open = await rows(
  `select blocker_id::text as id, requested_action, approval_options, decline_option, action_fingerprint, on_answer
     from public.blockers where state = 'open' and requested_action like '%Vikunja%'`,
)
check(
  'DELETE does not happen: nothing is removed at Vikunja',
  remote.count('delete') === 0,
  `${String(remote.count('delete'))} delete(s)`,
)
check(
  'and it asks, once, exactly: a fingerprint, a named No, and a yes that starts the work',
  open.length === 1 &&
    typeof open[0]?.action_fingerprint === 'string' &&
    open[0]?.decline_option === 'No, leave it there' &&
    json(open[0]?.on_answer).kind === 'tasks.sync',
  `${String(open.length)} question(s)`,
)
void askedAt
await tick()
await tick()
check(
  'it is not asked again on the next ticks (an open question is not repeated)',
  Number(
    (
      await one(
        `select count(*)::int as n from public.blockers where requested_action like '%Vikunja%'`,
      )
    ).n,
  ) === 1,
  'still one question',
)

// ---- 3. create authority cannot delete --------------------------------------------------------------------------
const deleteJob = (await w.dutyJob('tasks.sync')).jobId
const decision = json(
  (
    await one(
      `select app.authorize_effect(p_office => app.job_office(${lit(deleteJob)}::uuid), p_project => null, p_tool => 'task.board.delete', p_job => ${lit(deleteJob)}::uuid,
         p_fingerprint => 'x', p_scope => ${lit(`vikunja:${BOARD}#7`)}) as d`,
    )
  ).d,
)
check(
  'the standing yes for writing the board does not cover deleting from it, scope and all',
  decision.verdict === 'ask',
  `verdict ${String(decision.verdict)}`,
)
const grantDelete = json(
  (
    await one(
      `select app.grant_standing('task.board.delete', null, 'proof', 'grant', null, ${lit(`vikunja:${BOARD}#7`)}) as r`,
    )
  ).r,
)
check(
  'and no standing yes for delete can be made, with a scope or without (level 3)',
  grantDelete.ok === false &&
    json(
      (await one(`select app.grant_standing('task.board.delete', null, 'proof', 'grant') as r`)).r,
    ).ok === false,
  String(grantDelete.error).slice(0, 80),
)
const viaGateway = await w.asPerson('grant_standing', {
  p_tool: 'task.board.delete',
  p_reason: 'proof',
})
check(
  'not even a person pressing "from now on" through the gateway',
  JSON.stringify(viaGateway.body).includes('level-3') || json(viaGateway.body.result).ok === false,
  JSON.stringify(viaGateway.body).slice(0, 100),
)

// ---- 4. an approved delete proceeds, exactly once ---------------------------------------------------------------
const q1 = String(open[0]?.id)
const said = await w.answer(q1, 'Yes, delete it in Vikunja')
check(
  'answering yes (as the verified person) starts one child of the asking run',
  said.ok === true && Number(said.started) === 1,
  JSON.stringify(said).slice(0, 100),
)
const child = await rows(
  `select job_id::text as id, kind from public.jobs where parent_job_id = (select job_id from public.blockers where blocker_id = ${lit(q1)}::uuid)`,
)
check(
  'it is a tasks.sync run, a child of the job that asked',
  child.length === 1 && child[0]?.kind === 'tasks.sync',
  JSON.stringify(child),
)
const childJob = await w.jobOf(String(child[0]?.id))
await handler.handle(childJob, db)
check(
  'that run removes the task at Vikunja, once',
  remote.count('delete') === 1,
  `${String(remote.count('delete'))}`,
)
await tick()
check(
  'and the approval is spent: a later ordinary run deletes nothing more and asks nothing',
  remote.count('delete') === 1 &&
    Number(
      (
        await one(
          `select count(*)::int as n from public.blockers where state = 'open' and requested_action like '%Vikunja%'`,
        )
      ).n,
    ) === 0,
  `${String(remote.count('delete'))} delete(s)`,
)

// ---- 5. a refused delete does not happen, and is not asked about again ---------------------------------------
const t2 = await addTask(`Renew the lease ${w.run}`)
await tick()
await one(`select app.my_task_delete(${lit(t2)}, 'proof') as r`)
await tick()
const q2 = String(
  (
    await one(
      `select blocker_id::text as id from public.blockers where state = 'open' and requested_action like '%Vikunja%'`,
    )
  ).id,
)
const no = await w.answer(q2, 'No, leave it there')
check(
  'a No is recorded as a No',
  no.ok === true && Number(no.started ?? 0) === 0,
  JSON.stringify(no).slice(0, 80),
)
const before = remote.count('delete')
await tick()
await tick()
check(
  'the task stays at Vikunja, and the refusal stands on later runs without a new question',
  remote.count('delete') === before &&
    Number(
      (
        await one(
          `select count(*)::int as n from public.blockers where state = 'open' and requested_action like '%Vikunja%'`,
        )
      ).n,
    ) === 0,
  `${String(remote.count('delete') - before)} extra delete(s)`,
)

// ---- 6. nothing the job carries is an approval ------------------------------------------------------------------
const t3 = await addTask(`Cancel the subscription ${w.run}`)
await tick()
await one(`select app.my_task_delete(${lit(t3)}, 'proof') as r`)
const forged = await w.dutyJob('tasks.sync')
await one(
  `update public.jobs set pinned_config = pinned_config || '{"approved_by":"grant","approval":"yes","approved":true}'::jsonb where job_id = ${lit(forged.jobId)}::uuid returning 1 as x`,
)
const beforeForged = remote.count('delete')
await handler.handle(forged, db)
check(
  'a job that CLAIMS it was approved (config says approved_by grant) deletes nothing',
  remote.count('delete') === beforeForged,
  `${String(remote.count('delete') - beforeForged)} delete(s)`,
)
// A child whose parent is a different job, with a yes that was for a different task.
const other = await w.dutyJob('tasks.sync')
const impostor = await w.childOf(other.jobId, 'tasks.sync')
await handler.handle(impostor, db)
check(
  'a child of a job whose question was about something else deletes nothing',
  remote.count('delete') === beforeForged,
  `${String(remote.count('delete') - beforeForged)} delete(s)`,
)
// A test principal answering a REAL question is refused by the database.
const q3 = (
  await rows(
    `select blocker_id::text as id from public.blockers where state = 'open' and requested_action like '%Vikunja%' limit 1`,
  )
)[0]?.id
if (typeof q3 === 'string') {
  const t = await w.answer(q3, 'Yes, delete it in Vikunja', 'verify-operator')
  check(
    'a test member cannot say yes to a real deletion',
    typeof t.error === 'string',
    String(t.error).slice(0, 80),
  )
} else {
  check('a question was open for the impostor checks', false, 'none open')
}

// ---- 7. another board is not this board's yes -------------------------------------------------------------------
await w.asPerson('vikunja_connect', {
  p_base_url: 'https://other.example.test',
  p_project_id: 9,
  p_api_token: TOK,
})
const live = await rows(
  `select scope_ref from public.standing_authorizations where tool = 'task.board.write' and revoked_at is null`,
)
check(
  "reconnecting somewhere else withdraws the old board's yes and makes the new one the only one",
  live.length === 1 && live[0]?.scope_ref === 'vikunja:https://other.example.test#9',
  JSON.stringify(live),
)
const staleJob = (await w.dutyJob('tasks.sync')).jobId
const staleDecision = json(
  (
    await one(
      `select app.authorize_effect(p_office => app.job_office(${lit(staleJob)}::uuid), p_project => null, p_tool => 'task.board.write', p_job => ${lit(staleJob)}::uuid,
         p_scope => ${lit(`vikunja:${BOARD}#7`)}) as d`,
    )
  ).d,
)
check(
  'the first board no longer has a yes',
  staleDecision.verdict !== 'proceed',
  `verdict ${String(staleDecision.verdict)}`,
)

// ---- review finding: a spent question budget must not strand an approval that was already given ------------------
{
  const { governEffect } = await import('../../src/handlers/approval-gate.ts')
  const job = await w.dutyJob('tasks.sync')
  const ask = {
    tool: 'task.board.delete',
    material: { provider: 'vikunja', board: 'budget-proof', externalId: `x${w.run}` },
    summary: 'Delete the budget proof task?',
    agent: 'operations-director',
    onYes: { yes: 'Yes, delete it', no: 'No, leave it' },
  }
  const before = Number(
    (await one(`select count(*)::int as n from public.blockers where state = 'open'`)).n,
  )
  const quiet = await governEffect(db, job, { ...ask, noQuestion: true })
  const after = Number(
    (await one(`select count(*)::int as n from public.blockers where state = 'open'`)).n,
  )
  check(
    'with the question budget spent, the check runs and raises NOTHING (so an approval already given can still be honoured)',
    quiet.ok === false && after === before,
    `${String(before)} -> ${String(after)}`,
  )
}
await w.finish()
