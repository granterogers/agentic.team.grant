/**
 * The worker's internal functions (migrations 0780-0784, cluster h-jobs): the conversation memory a model is shown,
 * approvals and standing authorizations, deliveries, consultations, the duty's voice, the failure tally, proposals,
 * fan-in, the job-bound readers and the deployment scans.
 *
 * Person A and Person B each have a project with the SAME slug, and - the case that matters for the memory - their
 * people talk in the SAME chat (same origin channel, same chat reference, same speaker name). Everything is driven as
 * the worker (`p2_worker`, which stands in for the postgres role the worker connects as) with A's office and B's ids.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const norm = (s: string): string => s.replace(UUID, '<id>')

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const W = 'p2_worker'
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] as Record<string, unknown>
  const wq = async (sql: string) => c.exec(W, sql)
  const nobody = c.nobody()

  // ---- a digest of what an office owns in the DERIVED tables, which have no office column ----------------------------
  const derivedSnap = async (office: string): Promise<string> => {
    const parts: string[] = []
    for (const [t, key] of [
      ['job_pauses', 'job_id'],
      ['job_steps', 'job_id'],
      ['job_traces', 'job_id'],
      ['job_plans', 'job_id'],
      ['job_impediments', 'job_id'],
      ['consultations', 'job_id'],
      ['outputs', 'job_id'],
    ] as const) {
      const r = await one(
        `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from public.${t} x join public.jobs j on j.job_id = x.${key} where j.office_id = '${office}'`,
      )
      parts.push(`${t}=${String(r.h)}`)
    }
    return parts.join(',')
  }
  const jobsSnap = async (office: string): Promise<string> =>
    String(
      (
        await one(
          `select coalesce(md5(string_agg((j.job_id, j.state, j.kind, j.office_id, j.project_id, j.pinned_config, j.not_before, j.understood_as)::text, '|' order by j.job_id)), '-') as h from public.jobs j where j.office_id = '${office}' and j.idempotency_key like ${lit(`h-${run}-%`)}`,
        )
      ).h,
    )

  // ---- the world: a project, a chat and a few jobs in each office -----------------------------------------------------
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'paused', '${office}') on conflict do nothing`,
    )
    return String(
      (
        await one(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`,
        )
      ).project_id,
    )
  }
  const pa = await proj(A, `h-${run}`)
  const pb = await proj(B, `h-${run}`)
  let n = 0
  const job = async (
    office: string,
    project: string | null,
    tag: string,
    extra: {
      kind?: string
      parent?: string
      state?: string
      pinned?: Record<string, unknown>
      requestedBy?: string
    } = {},
  ): Promise<string> => {
    n += 1
    const key = `h-${run}-${tag}-${String(n)}`
    await c.db.execute(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, parent_job_id, state, pinned_config, finished_at)
       values (gen_random_uuid(), gen_random_uuid(), ${lit(key)}, ${lit(extra.kind ?? 'probe')}, ${lit(extra.requestedBy ?? 'verify:p3')},
               ${project === null ? 'null' : lit(project)}, '${office}', ${extra.parent === undefined ? 'null' : lit(extra.parent)},
               ${lit(extra.state ?? 'queued')}::job_state, ${lit(JSON.stringify(extra.pinned ?? {}))}::jsonb,
               ${['complete', 'failed', 'cancelled'].includes(extra.state ?? 'queued') ? 'app.now_utc()' : 'null'})`,
    )
    return String(
      (await one(`select job_id from public.jobs where idempotency_key = ${lit(key)}`)).job_id,
    )
  }
  const output = async (jobId: string, body: string): Promise<void> => {
    await c.db.execute(
      `insert into public.outputs (job_id, body, confidence, evidence, deterministic) values (${lit(jobId)}, ${lit(body)}, 'high', 'verified', true)`,
    )
  }
  // The SAME channel, the SAME chat and the SAME speaker in both offices: two people who happen to be reached through
  // one bot account, or two Slack threads that carry one reference.
  const CHAT = `7${run.replace(/[^0-9]/g, '0')}00`
  const WHO = `shared-person-${run}`
  const command = async (
    office: string,
    project: string,
    tag: string,
    text: string,
    opts: { job?: string; ago?: number; channel?: string; context?: Record<string, unknown> } = {},
  ): Promise<string> => {
    n += 1
    const key = `verify:h_jobs:${run}-${tag}-${String(n)}`
    await c.db.execute(
      `insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, subject, instruction, dedupe_key, context, job_id, received_at)
       values ('${office}', ${lit(project)}, ${lit(opts.channel ?? 'teamhq')}, ${lit(`${CHAT}:${String(n)}`)}, ${lit(WHO)}, ${lit(WHO)}, ${lit(text)}, ${lit(key)},
               ${lit(JSON.stringify(opts.context ?? {}))}::jsonb, ${opts.job === undefined ? 'null' : lit(opts.job)},
               app.now_utc() - interval '${String(opts.ago ?? 0)} minutes')`,
    )
    return String(
      (await one(`select command_id from public.inbound_commands where dedupe_key = ${lit(key)}`))
        .command_id,
    )
  }
  const hasA = (v: unknown) => c.json(v).includes(c.canary.A)
  const hasB = (v: unknown) => c.json(v).includes(c.canary.B)
  const sameAnswer = async (
    what: string,
    mk: (id: string) => string,
    foreignId: string,
    shown = 90,
  ) => {
    const foreign = norm(c.json(await wq(mk(foreignId))))
    const missing = norm(c.json(await wq(mk(nobody))))
    c.check(
      foreign === missing,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, shown)
        : `${foreign.slice(0, 60)} vs ${missing.slice(0, 60)}`,
    )
  }
  const refusedAlike = async (what: string, mk: (id: string) => string, foreignId: string) => {
    const foreign = norm(await c.refusal(W, mk(foreignId)))
    const missing = norm(await c.refusal(W, mk(nobody)))
    c.check(
      foreign !== '' && foreign === missing,
      `${what}: B's id and a nonexistent id are refused with the same sentence`,
      foreign.slice(0, 90),
    )
  }

  // each office has a job per turn and a child still running from the first turn, all in ONE chat
  const turnA1 = await job(A, pa, 'turn')
  const turnB1 = await job(B, pb, 'turn')
  const kidA = await job(A, pa, 'kid', {
    parent: turnA1,
    kind: 'office.instruction',
    pinned: { request: `${c.canary.A} the child still running` },
  })
  const kidB = await job(B, pb, 'kid', {
    parent: turnB1,
    kind: 'office.instruction',
    pinned: { request: `${c.canary.B} the child still running` },
  })
  await output(turnA1, `${c.canary.A} answer to the first A turn`)
  await output(turnB1, `${c.canary.B} answer to the first B turn`)
  await command(A, pa, 'a1', `${c.canary.A} pelican first thing A said`, { job: turnA1, ago: 3 })
  const b1 = await command(B, pb, 'b1', `${c.canary.B} pelican first thing B said`, {
    job: turnB1,
    ago: 3,
  })
  const turnA2 = await job(A, pa, 'turn2')
  const turnB2 = await job(B, pb, 'turn2')
  const a2 = await command(A, pa, 'a2', 'what is happening with that', { job: turnA2, ago: 1 })
  const b2 = await command(B, pb, 'b2', 'what is happening with that', { job: turnB2, ago: 1 })
  // older than the thirty-minute window, for recall
  const turnA0 = await job(A, pa, 'old')
  const turnB0 = await job(B, pb, 'old')
  await output(turnA0, `${c.canary.A} heron long ago A answer`)
  await output(turnB0, `${c.canary.B} heron long ago B answer`)
  await command(A, pa, 'a0', `${c.canary.A} heron said by A long ago`, { job: turnA0, ago: 4000 })
  await command(B, pb, 'b0', `${c.canary.B} heron said by B long ago`, { job: turnB0, ago: 4000 })

  // ======================================================================================================================
  // 1. THE CONVERSATION MEMORY: the same chat in two offices is two conversations
  // ======================================================================================================================
  const cbA = await wq(`select app.conversation_before('${A}', '${a2}')`)
  c.check(
    hasA(cbA) && !hasB(cbA),
    "conversation_before: A's earlier turn is in A's memory and B's, in the SAME chat, is not",
    c.json(cbA).slice(0, 100),
  )
  const cbB = await wq(`select app.conversation_before('${B}', '${b2}')`)
  c.check(hasB(cbB) && !hasA(cbB), 'and the same the other way round', c.json(cbB).slice(0, 100))
  await sameAnswer(
    'conversation_before',
    (id) => `select app.conversation_before('${A}', '${id}')`,
    b2,
  )
  c.check(
    c.json(await wq(`select app.conversation_before('${A}', '${b2}')`)) === '[]',
    "conversation_before(A, B's command) is the empty conversation",
    '',
  )
  const ext = (await wq(`select app.conversation_extent('${A}', '${a2}')`)) as {
    turns_total: number
  }
  c.check(
    ext.turns_total === 3,
    "conversation_extent counts A's three turns in the chat and none of B's three",
    c.json(ext),
  )
  await sameAnswer(
    'conversation_extent',
    (id) => `select app.conversation_extent('${A}', '${id}')`,
    b2,
  )
  const recall = await wq(`select app.recall_conversation('${A}', '${a2}', 'heron', 5)`)
  c.check(
    hasA(recall) && !hasB(recall),
    "recall_conversation finds A's old turn and never B's",
    c.json(recall).slice(0, 100),
  )
  await sameAnswer(
    'recall_conversation',
    (id) => `select app.recall_conversation('${A}', '${id}', 'heron', 5)`,
    b2,
  )
  const ex = await wq(`select app.recent_exchange('${A}', '${a2}', 90, 20)`)
  c.check(
    hasA(ex) && !hasB(ex),
    "recent_exchange shows A's words and A's answers and none of B's",
    c.json(ex).slice(0, 100),
  )
  await sameAnswer(
    'recent_exchange',
    (id) => `select app.recent_exchange('${A}', '${id}', 90, 20)`,
    b2,
  )
  c.check(
    (ex as { who: string }[]).every((t) => t.who !== 'grant') ||
      c.json(await q(`select app.office_actor('${A}') as a`)).includes('grant'),
    "the speaker of A's turns is A's person, not a literal 'grant'",
    '',
  )

  const work = await wq(
    `select app.conversation_work('${A}', '${a2}', interval '24 hours', null, interval '24 hours')`,
  )
  c.check(
    hasA(work) && !hasB(work),
    "conversation_work: A's running child is in A's work; B's, in the same chat, is not",
    c.json(work).slice(0, 100),
  )
  await sameAnswer(
    'conversation_work',
    (id) =>
      `select app.conversation_work('${A}', '${id}', interval '24 hours', null, interval '24 hours')`,
    b2,
  )
  const eyes = (await wq(`select app.another_pair_of_eyes('${A}', '${a2}')`)) as {
    about?: string
    ok: boolean
  }
  c.check(
    eyes.ok === true && String(eyes.about).includes(c.canary.A) && !hasB(eyes),
    "another_pair_of_eyes works from A's work only",
    c.json(eyes).slice(0, 100),
  )
  await sameAnswer(
    'another_pair_of_eyes',
    (id) => `select app.another_pair_of_eyes('${A}', '${id}')`,
    b2,
  )

  // stopping the conversation's work: A's call cancels A's child and cannot reach B's
  const beforeB = await jobsSnap(B)
  const stopForeign = c.json(
    await wq(`select app.stop_conversation_work('${A}', '${b2}', 'p3 probe')`),
  )
  const stopMissing = c.json(
    await wq(`select app.stop_conversation_work('${A}', '${nobody}', 'p3 probe')`),
  )
  c.check(
    stopForeign === stopMissing &&
      (await jobsSnap(B)) === beforeB &&
      (await one(`select state::text from public.jobs where job_id = '${kidB}'`)).state ===
        'queued',
    "stop_conversation_work(A, B's command) stops nothing, says what it says for a command that does not exist, and B's child is untouched",
    stopForeign.slice(0, 80),
  )
  const stopped = (await wq(`select app.stop_conversation_work('${A}', '${a2}', 'p3 probe')`)) as {
    stopped: number
  }
  c.check(
    stopped.stopped === 1 &&
      (await one(`select state::text from public.jobs where job_id = '${kidA}'`)).state ===
        'cancelled' &&
      (await jobsSnap(B)) === beforeB,
    "and as A, on A's command, it cancels A's child and B's child is still running",
    c.json(stopped),
  )

  // the referent of "that task"
  await c.db.execute(
    `insert into public.tasks (title, added_by, assigned_to_human, job_id, project_id, office_id)
     values (${lit(`${c.canary.A} the task A's turn made`)}, 'the office', true, '${turnA1}', '${pa}', '${A}'),
            (${lit(`${c.canary.B} the task B's turn made`)}, 'the office', true, '${turnB1}', '${pb}', '${B}')`,
  )
  const refA = await wq(`select app.my_task_referent('${A}', '${a2}', interval '2 hours', true)`)
  c.check(
    hasA(refA) && !hasB(refA),
    "my_task_referent offers the task A's conversation made and never the one B's made",
    c.json(refA).slice(0, 100),
  )
  await sameAnswer(
    'my_task_referent',
    (id) => `select app.my_task_referent('${A}', '${id}', interval '2 hours', true)`,
    b2,
  )

  // the question he was shown, bound by a typed yes: both offices have an open question delivered to the same chat
  const qj = async (office: string, project: string, who: string) => {
    const tj = await job(office, project, `ask-${who}`)
    const cmdBefore = await command(office, project, `q${who}0`, 'please do it', {
      job: tj,
      ago: 2,
      channel: 'telegram',
    })
    const bl = String(
      (
        await one(
          `insert into public.blockers (office_id, project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option)
           values ('${office}', '${project}', '${tj}', ${lit(`${who === 'A' ? c.canary.A : c.canary.B} may I`)}, 'a probe question so a typed yes has something to bind to', 'nothing happens until it is answered', array['Go ahead','Not now'], 'chief-of-staff', false, 'Not now')
           returning blocker_id::text as id`,
        )
      ).id,
    )
    await c.db.execute(
      `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, blocker_id, state, lease_expires_at, sent_at, message_ref)
       values ('${office}', 'telegram', ${lit(`h-${run}-del-${who}`)}, ${lit(`acct-${run}`)}, ${lit(CHAT)}, 'blocker', '${tj}', '${bl}', 'sent', app.now_utc() + interval '1 hour', app.now_utc(), ${lit(`${run}-${who}`)})`,
    )
    const yes = await command(office, project, `q${who}1`, 'yes', { channel: 'telegram' })
    return { tj, bl, yes, cmdBefore }
  }
  const qa = await qj(A, pa, 'A')
  const qb = await qj(B, pb, 'B')
  const openA = (await wq(
    `select coalesce(jsonb_agg(to_jsonb(r)), '[]') from app.open_questions_for_reply('${A}', '${qa.yes}') r`,
  )) as { id: string; what: string; bindable: boolean }[]
  c.check(
    openA.length === 1 && openA[0]?.id === qa.bl && openA[0]?.bindable === true && !hasB(openA),
    "open_questions_for_reply: a bare yes in A's chat binds to A's question, though B's was delivered to the same chat",
    c.json(openA).slice(0, 100),
  )
  const openForeign = c.json(
    await wq(
      `select coalesce(jsonb_agg(to_jsonb(r)), '[]') from app.open_questions_for_reply('${A}', '${qb.yes}') r`,
    ),
  )
  const openMissing = c.json(
    await wq(
      `select coalesce(jsonb_agg(to_jsonb(r)), '[]') from app.open_questions_for_reply('${A}', '${nobody}') r`,
    ),
  )
  c.check(
    openForeign === openMissing && openForeign === '[]',
    "open_questions_for_reply(A, B's yes) is empty, exactly as for a command that does not exist",
    openForeign,
  )

  // a null office and an unknown office are refused, even for a command that does not exist
  for (const [fn, args] of [
    ['conversation_before', `'${a2}'`],
    ['conversation_extent', `'${a2}'`],
    ['recall_conversation', `'${a2}', 'x', 3`],
    ['recent_exchange', `'${a2}', 90, 12`],
    ['conversation_work', `'${a2}'`],
    ['another_pair_of_eyes', `'${a2}'`],
    ['stop_conversation_work', `'${a2}', 'x'`],
    ['my_task_referent', `'${a2}'`],
  ] as const) {
    const nullOffice = await c.refusal(W, `select app.${fn}(null::uuid, ${args})`)
    const ghostOffice = await c.refusal(W, `select app.${fn}('${nobody}', ${args})`)
    c.check(
      nullOffice.includes('no_office') && ghostOffice.includes('no_office'),
      `${fn}: a null office and an unknown office are no_office`,
      `${nullOffice.slice(0, 40)} / ${ghostOffice.slice(0, 40)}`,
    )
  }
  const nullQ = await c.refusal(
    W,
    `select * from app.open_questions_for_reply(null::uuid, '${a2}')`,
  )
  c.check(
    nullQ.includes('no_office'),
    'open_questions_for_reply: a null office is no_office',
    nullQ.slice(0, 60),
  )

  void [b1, turnB0, turnA0, qb.cmdBefore, qa.cmdBefore]
  await rest(c, {
    A,
    B,
    W,
    run,
    q,
    one,
    wq,
    nobody,
    job,
    output,
    command,
    proj,
    pa,
    pb,
    derivedSnap,
    jobsSnap,
    sameAnswer,
    refusedAlike,
    hasA,
    hasB,
    CHAT,
  })
}

type Env = {
  A: string
  B: string
  W: string
  run: string
  q: (sql: string) => Promise<Record<string, unknown>[]>
  one: (sql: string) => Promise<Record<string, unknown>>
  wq: (sql: string) => Promise<unknown>
  nobody: string
  job: (
    office: string,
    project: string | null,
    tag: string,
    extra?: {
      kind?: string
      parent?: string
      state?: string
      pinned?: Record<string, unknown>
      requestedBy?: string
    },
  ) => Promise<string>
  output: (jobId: string, body: string) => Promise<void>
  command: (
    office: string,
    project: string,
    tag: string,
    text: string,
    opts?: { job?: string; ago?: number; channel?: string; context?: Record<string, unknown> },
  ) => Promise<string>
  proj: (office: string, slug: string) => Promise<string>
  pa: string
  pb: string
  derivedSnap: (office: string) => Promise<string>
  jobsSnap: (office: string) => Promise<string>
  sameAnswer: (
    what: string,
    mk: (id: string) => string,
    foreignId: string,
    shown?: number,
  ) => Promise<void>
  refusedAlike: (what: string, mk: (id: string) => string, foreignId: string) => Promise<void>
  hasA: (v: unknown) => boolean
  hasB: (v: unknown) => boolean
  CHAT: string
}

async function rest(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, q, one, wq, nobody, job, output, command, derivedSnap, jobsSnap, pa, pb } =
    e
  const { sameAnswer, refusedAlike, hasA, hasB } = e
  const bridgeBefore = Number(
    (await one(`select coalesce(sum(n), 0)::int as n from public.office_bridge_use`)).n,
  )
  await approvals(c, e)
  await deliveries(c, e)
  await bookkeeping(c, e)
  await proposalsAndFanIn(c, e)
  await jobBound(c, e)
  await scans(c, e)
  await doors(c, e, bridgeBefore)
  void [A, B, W, run, q, one, wq, nobody, job, output, command, derivedSnap, jobsSnap, pa, pb]
  void [sameAnswer, refusedAlike, hasA, hasB]
}

// ==========================================================================================================================
// 8. THE DOORS: who can execute what, and nothing was written through the compatibility bridge
// ==========================================================================================================================
async function doors(c: Ctx, e: Env, bridgeBefore: number): Promise<void> {
  const { q, one } = e
  const converted = [
    'another_pair_of_eyes',
    'approval_verdict',
    'authorize_effect',
    'bind_delivery',
    'branch_outputs',
    'claim_delivery',
    'conversation_before',
    'conversation_extent',
    'conversation_work',
    'failure_seen',
    'fan_in_over',
    'fan_in_ready',
    'my_task_referent',
    'open_questions_for_reply',
    'proposals_sent',
    'proposals_to_send',
    'raise_proposals',
    'recall_conversation',
    'recent_exchange',
    'record_consultation',
    'record_delivery_failure',
    'record_delivery_sent',
    'request_approval',
    'request_generation_approval',
    'resolve_indeterminate_delivery',
    'say_once',
    'stop_conversation_work',
    'unrouted_live_jobs',
    'may_act_in',
    'autonomy_for_in',
    'impediments_tally_in',
    'harness_proposal_in',
    'delivery_office',
  ]
  const rows = await q(
    `select p.oid::regprocedure::text as sig, p.proname, n.nspname,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as auth,
            has_function_privilege('service_role', p.oid, 'execute') as svc,
            pg_get_function_arguments(p.oid) like 'p_office uuid%' as office_first
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname = any(array[${converted.map(lit).join(', ')}]) and n.nspname in ('app', 'public')`,
  )
  c.check(
    rows.length >= converted.length &&
      rows.every((r) => r.nspname === 'app' && !r.anon && !r.auth && !r.svc),
    'every converted function is an app function that anon, authenticated and service_role cannot execute - and no public door is left',
    `${String(rows.length)} overloads`,
  )
  c.check(
    rows.filter((r) => r.proname !== 'delivery_office').every((r) => r.office_first === true),
    'and every overload takes p_office first (no second, legacy overload survives)',
    c.json(rows.filter((r) => r.office_first !== true).map((r) => r.sig)),
  )
  const bridgeAfter = Number(
    (await one(`select coalesce(sum(n), 0)::int as n from public.office_bridge_use`)).n,
  )
  c.check(
    bridgeAfter === bridgeBefore,
    'nothing in this file reached the compatibility bridge: every writer named its office (office_bridge_use did not move)',
    `${String(bridgeBefore)} -> ${String(bridgeAfter)}`,
  )
}

const stateOf = async (e: Env, id: string): Promise<string> =>
  String((await e.one(`select state::text as s from public.jobs where job_id = '${id}'`)).s)

// ==========================================================================================================================
// 2. APPROVALS AND STANDING AUTHORIZATIONS: minted and consumed inside the office
// ==========================================================================================================================
async function approvals(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, wq, nobody, job, pa, pb, sameAnswer, refusedAlike } = e
  const jobA = await job(A, pa, 'approve')
  const jobB = await job(B, pb, 'approve')
  const beforeB = await c.snapshot(B, [
    'blockers',
    'deliveries',
    'standing_authorizations',
    'autonomy_settings',
  ])

  // ---- request_approval / request_generation_approval mint the question in the job's office -------------------------
  const asked = String(
    await wq(
      `select app.request_approval('${A}', '${jobA}', 'p3 probe action', 'because it is a probe', 'office.execute_plan')`,
    ),
  )
  const askedRow = await one(
    `select b.office_id, b.job_id, (select pinned_config ->> 'approval_next' from public.jobs where job_id = '${jobA}') as next from public.blockers b where b.blocker_id = '${asked}'`,
  )
  c.check(
    askedRow.office_id === A && askedRow.job_id === jobA && askedRow.next === 'office.execute_plan',
    "request_approval mints the question in A's office, on A's job, and records what the yes starts",
    '',
  )
  const again = String(
    await wq(
      `select app.request_approval('${A}', '${jobA}', 'p3 probe action', 'because it is a probe', 'office.execute_plan')`,
    ),
  )
  c.check(again === asked, 'asking twice returns the question already open, not a second one', '')
  await refusedAlike(
    'request_approval',
    (id) =>
      `select app.request_approval('${A}', '${id}', 'x probe', 'y probe', 'office.execute_plan')`,
    jobB,
  )
  await refusedAlike(
    'request_generation_approval',
    (id) =>
      `select app.request_generation_approval('${A}', '${id}', 'notebook.generate', 'a deck', 'proof')`,
    jobB,
  )
  const gen = String(
    await wq(
      `select app.request_generation_approval('${B}', '${jobB}', 'notebook.generate', 'a deck for B', 'proof')`,
    ),
  )
  c.check(
    (await one(`select office_id from public.blockers where blocker_id = '${gen}'`)).office_id ===
      B,
    "request_generation_approval as B mints B's question in B (the positive control)",
    '',
  )
  const noOffice = await c.refusal(
    W,
    `select app.request_approval(null::uuid, '${jobA}', 'x probe', 'y probe', 'office.execute_plan')`,
  )
  c.check(
    noOffice.includes('no_office'),
    'request_approval: a null office is no_office',
    noOffice.slice(0, 50),
  )

  // ---- approval_verdict: the question a job NAMES is data, and data can name another office's question ----------------
  const bQuestion = String(
    (await one(`select blocker_id from public.blockers where blocker_id = '${gen}'`)).blocker_id,
  )
  const namesForeign = await job(A, pa, 'names-foreign', { pinned: { approval: bQuestion } })
  const namesNothing = await job(A, pa, 'names-nothing', { pinned: { approval: nobody } })
  const namesOwn = await job(A, pa, 'names-own', { pinned: { approval: asked } })
  const vForeign = c.json(await wq(`select app.approval_verdict('${A}', '${namesForeign}')`))
  const vNothing = c.json(await wq(`select app.approval_verdict('${A}', '${namesNothing}')`))
  const vOwn = c.json(await wq(`select app.approval_verdict('${A}', '${namesOwn}')`))
  c.check(
    vForeign === vNothing && vForeign.includes('does not exist'),
    "approval_verdict: a job of A naming B's question reads exactly as one naming a question that does not exist",
    vForeign.slice(0, 90),
  )
  c.check(
    vOwn !== vNothing && vOwn.includes('not answered yes'),
    "and naming A's own (open) question finds it (the positive control)",
    vOwn.slice(0, 90),
  )
  await sameAnswer('approval_verdict', (id) => `select app.approval_verdict('${A}', '${id}')`, jobB)

  // ---- authorize_effect: the dial, the standing yes and the recorded answers are THIS office's ---------------------------
  const tool = 'calendar.write' // level 2, unscoped: at the default dial it asks
  await c.db.execute(
    `insert into public.standing_authorizations (office_id, project_id, tool, reason, granted_by) values ('${B}', null, '${tool}', 'p3 probe: B said do not ask again', 'grant')`,
  )
  const askA = (await wq(`select app.authorize_effect('${A}', '${pa}', '${tool}')`)) as {
    verdict: string
  }
  const askB = (await wq(`select app.authorize_effect('${B}', '${pb}', '${tool}')`)) as {
    verdict: string
  }
  c.check(
    askB.verdict === 'proceed' && askA.verdict === 'ask',
    "B's standing yes lets B proceed and does NOT let A (A is still asked)",
    `A ${askA.verdict}, B ${askB.verdict}`,
  )
  await c.db.execute(
    `insert into public.standing_authorizations (office_id, project_id, tool, reason, granted_by) values ('${A}', '${pa}', '${tool}', 'p3 probe: A said do not ask again here', 'grant')`,
  )
  const nowA = (await wq(`select app.authorize_effect('${A}', '${pa}', '${tool}')`)) as {
    verdict: string
  }
  c.check(
    nowA.verdict === 'proceed',
    "and A's own standing yes lets A proceed (the positive control)",
    nowA.verdict,
  )

  // the dial: B set to Act, A left at the default
  await c.db.execute(
    `insert into public.autonomy_settings (office_id, project_id, level, set_by, reason) values ('${B}', null, 'act', 'p3', 'p3 probe')`,
  )
  const dialA = (await wq(`select app.authorize_effect('${A}', '${pa}', 'notebook.write')`)) as {
    verdict: string
  }
  const dialB = (await wq(`select app.authorize_effect('${B}', '${pb}', 'notebook.write')`)) as {
    verdict: string
  }
  c.check(
    dialB.verdict === 'proceed' && dialA.verdict === 'ask',
    "B's dial at Act lets B's level-2 work proceed and leaves A's dial where it was (ask)",
    `A ${dialA.verdict}, B ${dialB.verdict}`,
  )

  // a No B gave to a fingerprint is not A's No
  const FP = `p3-fp-${run}`
  await c.db.execute(
    `insert into public.blockers (office_id, project_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option, state, resolved_at, resolution, answered_option, answered_by, action_fingerprint)
     values ('${B}', '${pb}', 'a probe no', 'a probe no that B once gave', 'nothing', array['Go ahead','Not now'], 'chief-of-staff', false, 'Not now', 'resolved', app.now_utc(), 'declined', 'Not now', 'grant', ${lit(FP)})`,
  )
  const noB = (await wq(
    `select app.authorize_effect('${B}', '${pb}', 'slack.post', null, null, null, ${lit(FP)})`,
  )) as { verdict: string; reason?: string }
  const noA = (await wq(
    `select app.authorize_effect('${A}', '${pa}', 'slack.post', null, null, null, ${lit(FP)})`,
  )) as { verdict: string; reason?: string }
  c.check(
    noB.verdict === 'refuse' &&
      noB.reason === 'declined_before' &&
      noA.reason !== 'declined_before',
    "a No recorded in B is remembered for B and is not A's",
    `B ${noB.reason ?? noB.verdict}, A ${noA.reason ?? noA.verdict}`,
  )

  await sameAnswer(
    'authorize_effect (project)',
    (id) => `select app.authorize_effect('${A}', '${id}', '${tool}')`,
    pb,
  )
  // B's No is recorded AGAINST B's JOB. If A may name that job, the recorded answer speaks in A's mouth.
  const FPJ = `p3-fpjob-${run}`
  await c.db.execute(
    `insert into public.blockers (office_id, job_id, project_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, decline_option, state, resolved_at, resolution, answered_option, answered_by, action_fingerprint)
     values ('${B}', '${jobB}', '${pb}', 'a probe no on a job', 'a probe no that B once gave on its own job', 'nothing', array['Go ahead','Not now'], 'chief-of-staff', false, 'Not now', 'resolved', app.now_utc(), 'declined', 'Not now', 'grant', ${lit(FPJ)})`,
  )
  const noOwnJob = (await wq(
    `select app.authorize_effect('${B}', '${pb}', '${tool}', null, null, null, ${lit(FPJ)}, '${jobB}')`,
  )) as { verdict: string; reason?: string }
  c.check(
    noOwnJob.verdict === 'refuse' && noOwnJob.reason === 'declined',
    "positive control: B's recorded No on B's own job is honoured for B",
    `${noOwnJob.verdict} ${noOwnJob.reason ?? ''}`,
  )
  await sameAnswer(
    'authorize_effect (a No recorded on the other office’s job)',
    (id) =>
      `select app.authorize_effect('${A}', '${pa}', '${tool}', null, null, null, ${lit(FPJ)}, '${id}')`,
    jobB,
  )
  await sameAnswer(
    'authorize_effect (job)',
    (id) =>
      `select app.authorize_effect('${A}', '${pa}', '${tool}', null, null, null, ${lit(FP)}, '${id}')`,
    jobB,
  )
  await sameAnswer(
    'authorize_effect (asking job)',
    (id) => `select app.authorize_effect('${A}', '${pa}', '${tool}', '${id}')`,
    jobB,
  )
  await sameAnswer(
    'may_act_in (project)',
    (id) => `select app.may_act_in('${A}', '${id}', '${tool}')`,
    pb,
  )
  const nullOffice = await c.refusal(
    W,
    `select app.authorize_effect(null::uuid, '${pa}', '${tool}')`,
  )
  const ghostOffice = await c.refusal(
    W,
    `select app.authorize_effect('${nobody}', '${pa}', '${tool}')`,
  )
  c.check(
    nullOffice.includes('no_office') && ghostOffice.includes('no_office'),
    'authorize_effect: a null office and an unknown office are no_office',
    nullOffice.slice(0, 40),
  )
  const afterB = await c.snapshot(B, [
    'blockers',
    'deliveries',
    'standing_authorizations',
    'autonomy_settings',
  ])
  void [beforeB, afterB]
  // B's rows are B's own: the only B writes in this section are the ones B's own calls and fixtures made
  c.check(
    (
      await one(
        `select count(*)::int as n from public.blockers where office_id = '${B}' and job_id = '${jobB}'`,
      )
    ).n === 2,
    "A's refused requests wrote nothing on B's job (two questions there, both B's own: the open one and the recorded No)",
    '',
  )
}

// ==========================================================================================================================
// 3. DELIVERIES: claimed, sent and recorded for ONE office
// ==========================================================================================================================
async function deliveries(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, q, wq, nobody, job, pa, pb, sameAnswer, refusedAlike } = e
  const digits = run.replace(/[^0-9]/g, '1')
  const TD = `-1009${digits}${String(Date.now()).slice(-6)}` // a registered test destination
  const PROD = `-1002${digits}${String(Date.now()).slice(-5)}` // a destination nobody registered
  await c.db.execute(
    `insert into public.test_destinations (channel, target_ref, why) values ('telegram', ${lit(TD)}, 'p3 probe test destination') on conflict do nothing`,
  )
  const jobA = await job(A, pa, 'deliver')
  const jobB = await job(B, pb, 'deliver')
  const claim = async (office: string, key: string, target: string, jobId: string | null) =>
    (await one(
      `select delivery_id::text as id, outcome, message_ref, attempt from app.claim_delivery('${office}', 'telegram', ${lit(key)}, 'acct-${run}', ${lit(target)}, 'result', null, null, null, ${jobId === null ? 'null' : `'${jobId}'`}, interval '1 minute')`,
    )) as { id: string | null; outcome: string; message_ref: string | null; attempt: number }
  const rowOf = async (key: string) =>
    (await one(
      `select delivery_id::text as id, office_id, job_id, state::text as state, suppressed_reason, message_ref from public.deliveries where dedupe_key = ${lit(key)}`,
    )) as {
      id: string
      office_id: string
      job_id: string | null
      state: string
      suppressed_reason: string | null
      message_ref: string | null
    }

  // the office is written EXPLICITLY, so the claim does not depend on what the compatibility bridge would have guessed
  const kA = `h-${run}-dA`
  const cA = await claim(A, kA, TD, jobA)
  c.check(
    cA.outcome === 'claimed' &&
      (await rowOf(kA)).office_id === A &&
      (await rowOf(kA)).job_id === jobA,
    "claim_delivery as A, for A's job, to a registered destination: claimed, and the row is A's",
    cA.outcome,
  )
  const kAj = `h-${run}-dAj`
  const cAj = await claim(A, kAj, TD, null)
  c.check(
    cAj.outcome === 'claimed' && (await rowOf(kAj)).office_id === A,
    'a job-less claim to a test destination is recorded in the office that made it, not in the one the bridge would guess',
    `${cAj.outcome} ${(await rowOf(kAj)).office_id === A ? 'A' : 'other'}`,
  )
  const kB = `h-${run}-dB`
  const cB = await claim(B, kB, TD, jobB)
  c.check(
    cB.outcome === 'claimed' && (await rowOf(kB)).office_id === B,
    "and B's own claim is B's (the positive control)",
    cB.outcome,
  )

  // a dedupe key B already holds is not shown to A as sent, held or anything of B's
  const beforeB = await c.snapshot(B, ['deliveries'])
  const clash = await claim(A, kB, TD, jobA)
  c.check(
    clash.outcome === 'held' &&
      clash.id === null &&
      clash.message_ref === null &&
      (await c.snapshot(B, ['deliveries'])) === beforeB,
    "claim_delivery(A, a key B holds): held, no delivery id, no message ref of B's - and B's row is unchanged",
    c.json(clash),
  )

  // a job of another office is a job that does not exist - the same refusal, the same recorded row
  const kF = `h-${run}-foreignjob`
  const kN = `h-${run}-nojob`
  const fj = await claim(A, kF, PROD, jobB)
  const nj = await claim(A, kN, PROD, nobody)
  const rf = await rowOf(kF)
  const rn = await rowOf(kN)
  c.check(
    fj.outcome === 'suppressed' &&
      nj.outcome === 'suppressed' &&
      rf.suppressed_reason === rn.suppressed_reason &&
      String(rf.suppressed_reason).includes('does not exist') &&
      rf.job_id === null &&
      rn.job_id === null &&
      rf.office_id === A,
    "claim_delivery(A, B's job) is suppressed exactly as for a job that does not exist, and records no job",
    String(rf.suppressed_reason).slice(0, 80),
  )
  const fjTd = await claim(A, `h-${run}-foreignjob-td`, TD, jobB)
  c.check(
    fjTd.outcome === 'claimed' && (await rowOf(`h-${run}-foreignjob-td`)).job_id === null,
    "even to a registered destination, B's job is not attached to A's delivery",
    c.json(fjTd),
  )

  // every protection claim_delivery had is still there
  const harnessJob = await job(A, pa, 'harness', { pinned: { origin_namespace: 'verify' } })
  const hk = `h-${run}-harness`
  const hc = await claim(A, hk, PROD, harnessJob)
  c.check(
    hc.outcome === 'suppressed' &&
      String((await rowOf(hk)).suppressed_reason).includes('harness traffic'),
    'harness traffic still may not reach a production destination',
    String((await rowOf(hk)).suppressed_reason).slice(0, 70),
  )
  const uk = `h-${run}-unknown`
  const unknownJob = await job(A, pa, 'unknown-origin', { requestedBy: `p3actor:${run}` })
  const uc = await claim(A, uk, PROD, unknownJob)
  c.check(
    uc.outcome === 'suppressed' &&
      String((await rowOf(uk)).suppressed_reason).includes('unknown origin'),
    'and work of unknown origin still reaches nobody (default deny)',
    String((await rowOf(uk)).suppressed_reason).slice(0, 70),
  )
  const nj2 = await c.refusal(
    W,
    `select * from app.claim_delivery(null::uuid, 'telegram', 'h-${run}-n', 'a', ${lit(TD)}, 'result')`,
  )
  c.check(nj2.includes('no_office'), 'claim_delivery: a null office is no_office', nj2.slice(0, 50))
  const dOffice = await one(`select app.delivery_office('${jobA}', 'telegram', ${lit(PROD)}) as o`)
  const dOfficeTd = await one(`select app.delivery_office(null, 'telegram', ${lit(TD)}) as o`)
  c.check(
    dOffice.o === A && dOfficeTd.o === (await one(`select app.test_office() as t`)).t,
    "delivery_office is the job's office, and a registered test destination's is the test office",
    '',
  )

  // recording what happened: only the delivery's own office can
  const dA = (await rowOf(kA)).id
  const dBid = (await rowOf(kB)).id
  const beforeBd = await c.snapshot(B, ['deliveries'])
  await refusedAlike(
    'record_delivery_sent',
    (id) => `select app.record_delivery_sent('${A}', '${id}', 'm-1', null)`,
    dBid,
  )
  await refusedAlike(
    'record_delivery_failure',
    (id) => `select app.record_delivery_failure('${A}', '${id}', 'timeout', true)`,
    dBid,
  )
  await refusedAlike(
    'resolve_indeterminate_delivery',
    (id) => `select app.resolve_indeterminate_delivery('${A}', '${id}', 'm-9')`,
    dBid,
  )
  c.check(
    (await c.snapshot(B, ['deliveries'])) === beforeBd,
    "and none of those changed B's deliveries",
    '',
  )
  const sent = await wq(`select app.record_delivery_sent('${A}', '${dA}', 'msg-${run}', null)`)
  const sentAgain = await wq(`select app.record_delivery_failure('${A}', '${dA}', 'late', true)`)
  c.check(
    sent === 'sent' &&
      sentAgain === 'already_sent' &&
      (await rowOf(kA)).message_ref === `msg-${run}`,
    "record_delivery_sent as A marks A's delivery sent, and a later failure does not undo it",
    `${String(sent)} / ${String(sentAgain)}`,
  )
  const nullRec = await c.refusal(
    W,
    `select app.record_delivery_sent(null::uuid, '${dA}', 'm', null)`,
  )
  c.check(
    nullRec.includes('no_office'),
    'record_delivery_sent: a null office is no_office',
    nullRec.slice(0, 50),
  )

  // binding a message to the question it asks
  const askA = String(
    await wq(
      `select app.request_approval('${A}', '${jobA}', 'p3 bind probe', 'the question this message asks', 'office.execute_plan')`,
    ),
  )
  const askB = String(
    await wq(
      `select app.request_approval('${B}', '${jobB}', 'p3 bind probe', 'the question this message asks', 'office.execute_plan')`,
    ),
  )
  const kBind = `h-${run}-bind`
  const cBind = await claim(A, kBind, TD, jobA)
  const dBind = (await rowOf(kBind)).id
  void cBind
  const foreignBlocker = await wq(`select app.bind_delivery('${A}', '${dBind}', '${askB}')`)
  const missingBlocker = await wq(`select app.bind_delivery('${A}', '${dBind}', '${nobody}')`)
  const foreignDelivery = await wq(`select app.bind_delivery('${A}', '${dBid}', '${askA}')`)
  const missingDelivery = await wq(`select app.bind_delivery('${A}', '${nobody}', '${askA}')`)
  c.check(
    foreignBlocker === false &&
      missingBlocker === false &&
      foreignDelivery === false &&
      missingDelivery === false,
    "bind_delivery refuses B's question and B's delivery exactly as it refuses ones that do not exist (false, not an error)",
    c.json([foreignBlocker, missingBlocker, foreignDelivery, missingDelivery]),
  )
  const bound = await wq(`select app.bind_delivery('${A}', '${dBind}', '${askA}')`)
  c.check(
    bound === true &&
      (await one(`select blocker_id from public.deliveries where delivery_id = '${dBind}'`))
        .blocker_id === askA,
    "and A's delivery binds to A's own question (the positive control)",
    c.json(bound),
  )
  const legacy = await one(`select app.approval_for_delivery('${A}', '${dBind}') as b`)
  c.check(legacy.b === askA, 'approval_for_delivery answers the question the message named', '')
  void q
  void sameAnswer
}

// ==========================================================================================================================
// 4. CONSULTATIONS, THE DUTY'S VOICE, THE FAILURE TALLY
// ==========================================================================================================================
async function bookkeeping(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, wq, nobody, job, pa, pb, derivedSnap, sameAnswer } = e
  const jobA = await job(A, pa, 'consult')
  const jobB = await job(B, pb, 'consult')

  // ---- record_consultation ------------------------------------------------------------------------------------------------
  const beforeB = await derivedSnap(B)
  const made = (await wq(
    `select app.record_consultation('${A}', '${jobA}', 'research-director', 'chief-of-staff', 'p3 probe: it is a research question')`,
  )) as { ok?: boolean }
  c.check(
    made.ok === true &&
      Number(
        (await one(`select count(*)::int as n from public.consultations where job_id = '${jobA}'`))
          .n,
      ) === 1,
    "record_consultation as A on A's job records it",
    c.json(made),
  )
  await sameAnswer(
    'record_consultation',
    (id) =>
      `select app.record_consultation('${A}', '${id}', 'research-director', 'chief-of-staff', 'p3 probe')`,
    jobB,
  )
  c.check((await derivedSnap(B)) === beforeB, "and nothing was recorded against B's job", '')
  const noRequester = await c.refusal(
    W,
    `select app.record_consultation('${A}', '${jobA}', 'research-director')`,
  )
  c.check(
    noRequester.includes('does not exist'),
    "there is no ambient requester: the requester is a required argument (it defaulted to 'chief-of-staff')",
    noRequester.slice(0, 80),
  )
  const nullC = await c.refusal(
    W,
    `select app.record_consultation(null::uuid, '${jobA}', 'research-director', 'chief-of-staff')`,
  )
  c.check(
    nullC.includes('no_office'),
    'record_consultation: a null office is no_office',
    nullC.slice(0, 50),
  )

  // ---- say_once: the duty's memory is the office's ------------------------------------------------------------------
  const staff = String(
    (await one(`select staff_id from public.staff where active order by slug limit 1`)).staff_id,
  )
  const KIND = `h_duty.${run}`
  for (const office of [A, B]) {
    await c.db.execute(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled, project_id)
       values ('${office}', ${lit(`h-duty-${run}`)}, '${staff}', 'a probe duty that exists only to prove two offices keep separate memories of what they said', ${lit(KIND)}, 60, false, null)`,
    )
  }
  const dutyA = await job(A, null, 'duty', { kind: KIND, requestedBy: `duty:h-duty-${run}` })
  const dutyB = await job(B, null, 'duty', { kind: KIND, requestedBy: `duty:h-duty-${run}` })
  const sA1 = await wq(`select app.say_once('${A}', '${dutyA}', 'the same news')`)
  const sA2 = await wq(`select app.say_once('${A}', '${dutyA}', 'the same news')`)
  const sB1 = await wq(`select app.say_once('${B}', '${dutyB}', 'the same news')`)
  const sB2 = await wq(`select app.say_once('${B}', '${dutyB}', 'the same news')`)
  c.check(
    sA1 === true && sA2 === false,
    "say_once: A's duty says it, then keeps quiet about the identical news",
    c.json([sA1, sA2]),
  )
  c.check(
    sB1 === true && sB2 === false,
    "and B's duty of the same kind, with no project, still says it ONCE - A having said it silenced nobody",
    c.json([sB1, sB2]),
  )
  const mem = await e.q(
    `select count(distinct d.project_id)::int as n, count(distinct p.office_id)::int as offices from public.duty_said d join public.projects p on p.project_id = d.project_id where d.job_kind = ${lit(KIND)}`,
  )
  c.check(
    mem[0]?.n === 2 && mem[0]?.offices === 2,
    "the memory is keyed by each office's own Unnamed project (two rows, two offices)",
    c.json(mem[0]),
  )
  const foreignSay = await wq(`select app.say_once('${A}', '${dutyB}', 'whatever')`)
  const missingSay = await wq(`select app.say_once('${A}', '${nobody}', 'whatever')`)
  c.check(
    foreignSay === true && missingSay === true,
    "say_once(A, B's job) speaks, exactly as for a job that does not exist (it fails open)",
    c.json([foreignSay, missingSay]),
  )
  const nullS = await c.refusal(W, `select app.say_once(null::uuid, '${dutyA}', 'x')`)
  c.check(nullS.includes('no_office'), 'say_once: a null office is no_office', nullS.slice(0, 50))

  // ---- failure_seen --------------------------------------------------------------------------------------------------------
  // real (not harness) jobs: a harness job's failure is deliberately not counted
  const realA = await job(A, pa, 'fail', { requestedBy: `p3actor:${run}` })
  const realB = await job(B, pb, 'fail', { requestedBy: `p3actor:${run}` })
  const kindA = `h_fail_a.${run}`
  const f1 = (await wq(
    `select app.failure_seen('${A}', ${lit(kindA)}, 'Request timed out', null, '${realA}')`,
  )) as { seen: number }
  const f2 = (await wq(
    `select app.failure_seen('${A}', ${lit(kindA)}, 'Request timed out', null, '${realA}')`,
  )) as { seen: number }
  const frow = await one(
    `select office_id, seen, last_job_id from public.failure_signatures where job_kind = ${lit(kindA)}`,
  )
  c.check(
    f1.seen === 1 && f2.seen === 2 && frow.office_id === A && frow.last_job_id === realA,
    "failure_seen as A counts A's failure in A's office",
    c.json([f1, f2]),
  )
  const kF1 = `h_fail_f.${run}`
  const kF2 = `h_fail_n.${run}`
  const ff = norm(
    c
      .json(
        await wq(
          `select app.failure_seen('${A}', ${lit(kF1)}, 'Request timed out', null, '${realB}')`,
        ),
      )
      .replaceAll(kF1, 'KIND'),
  )
  const fn = norm(
    c
      .json(
        await wq(
          `select app.failure_seen('${A}', ${lit(kF2)}, 'Request timed out', null, '${nobody}')`,
        ),
      )
      .replaceAll(kF2, 'KIND'),
  )
  const lastF = await e.q(
    `select last_job_id from public.failure_signatures where job_kind in (${lit(kF1)}, ${lit(kF2)})`,
  )
  c.check(
    ff.replace(/"first_seen":"[^"]*"/, '') === fn.replace(/"first_seen":"[^"]*"/, '') &&
      lastF.every((r) => r.last_job_id === null),
    "failure_seen(A, B's job) reads as a job that does not exist: counted, and pointing at no job",
    ff.slice(0, 80),
  )
  // the key is global until the P2 follow-up: B holds it first, A must not touch B's row
  const kS = `h_fail_s.${run}`
  await wq(`select app.failure_seen('${B}', ${lit(kS)}, 'Request timed out', null, '${realB}')`)
  const beforeFB = await c.snapshot(B, ['failure_signatures'])
  const clash = (await wq(
    `select app.failure_seen('${A}', ${lit(kS)}, 'Request timed out', null, '${realA}')`,
  )) as { seen: number; note: string }
  c.check(
    clash.seen === 0 &&
      clash.note.includes('another record') &&
      (await c.snapshot(B, ['failure_signatures'])) === beforeFB,
    "a failure shape B already tracks is not counted for A and B's row does not move (the key is global: reported)",
    clash.note,
  )
  const hJob = await job(A, pa, 'harness-fail', { pinned: { origin_namespace: 'verify' } })
  const hf = (await wq(
    `select app.failure_seen('${A}', ${lit(`h_fail_h.${run}`)}, 'boom', null, '${hJob}')`,
  )) as { harness?: boolean }
  c.check(hf.harness === true, "a harness job's failure is still not counted", c.json(hf))
  const nullF = await c.refusal(W, `select app.failure_seen(null::uuid, 'k', 'm')`)
  c.check(
    nullF.includes('no_office'),
    'failure_seen: a null office is no_office',
    nullF.slice(0, 50),
  )
}

// ==========================================================================================================================
// 5. PROPOSALS AND FAN-IN
// ==========================================================================================================================
async function proposalsAndFanIn(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, q, wq, nobody, job, output, pa, pb, sameAnswer, refusedAlike } = e

  // ---- proposals: raised from this office's impediments only ------------------------------------------------------------
  // `needed` is stored lower-case (it is a normalised phrase), so the probes are written that way
  const needA = `h probe need a ${run}`
  const needB = `h probe need b ${run}`
  const needS = `h probe need shared ${run}`
  const cannot = async (office: string, project: string, need: string, times: number) => {
    for (let i = 0; i < times; i += 1) {
      const j = await job(office, project, 'cannot')
      // the impediment is the SPECIALIST'S: it takes its staff slug from the job's recipient
      await c.db.execute(
        `update public.jobs set recipient_agent = 'growth-director' where job_id = '${j}'`,
      )
      await wq(
        `select app.cannot('${j}', 'missing_tool', ${lit(need)}, 'growth-director', 'p3 probe detail', 'a probe')`,
      )
    }
  }
  await cannot(A, pa, needA, 3)
  await cannot(B, pb, needB, 3)
  await cannot(A, pa, needS, 3)
  await cannot(B, pb, needS, 3)
  const tallyA = (await q(`select needed from app.impediments_tally_in('${A}', 30, 3, true)`)).map(
    (r) => String(r.needed),
  )
  c.check(
    tallyA.includes(needA) && !tallyA.includes(needB),
    "impediments_tally_in(A) counts A's impediments and none of B's",
    c.json(tallyA.slice(0, 4)),
  )
  const rB = (await wq(`select app.raise_proposals('${B}', 30, 3, true)`)) as { raised: number }
  const sharedB = await one(
    `select proposal_id, office_id, times_seen, argument from public.proposals where needed = ${lit(needS)}`,
  )
  const beforePB = await c.snapshot(B, ['proposals'])
  const rA = (await wq(`select app.raise_proposals('${A}', 30, 3, true)`)) as {
    raised: number
    held_elsewhere: number
  }
  const aRows = await q(
    `select needed, office_id from public.proposals where office_id = '${A}' and needed in (${lit(needA)}, ${lit(needB)}, ${lit(needS)})`,
  )
  c.check(
    rB.raised >= 2 &&
      aRows.some((r) => r.needed === needA) &&
      !aRows.some((r) => r.needed === needB),
    "raise_proposals as A raises A's own need and never B's; as B, B's (the positive control)",
    c.json(rA),
  )
  c.check(
    sharedB.office_id === B &&
      rA.held_elsewhere === 1 &&
      !aRows.some((r) => r.needed === needS) &&
      (await c.snapshot(B, ['proposals'])) === beforePB,
    "a need B already raised is not rewritten by A: B's proposal does not move and A reports it as held elsewhere (the key is global: reported)",
    c.json(rA),
  )
  const nullR = await c.refusal(W, `select app.raise_proposals(null::uuid)`)
  c.check(
    nullR.includes('no_office'),
    'raise_proposals: a null office is no_office',
    nullR.slice(0, 50),
  )

  // ---- proposals_to_send / proposals_sent / proposals_undeliver -------------------------------------------------------
  const mk = async (office: string, need: string): Promise<string> =>
    String(
      (
        await one(
          `insert into public.proposals (office_id, staff_slug, kind, needed, title, remedy, argument, times_seen)
           values ('${office}', 'growth-director', 'not_capable', ${lit(need)}, 'a probe', 'a probe', 'a probe', 3) returning proposal_id::text as id`,
        )
      ).id,
    )
  const pA = await mk(A, `h send A ${run} ${c.canary.A}`)
  const pBid = await mk(B, `h send B ${run} ${c.canary.B}`)
  const sendA = await wq(`select app.proposals_to_send('${A}', 500)`)
  c.check(
    hasText(sendA, c.canary.A) && !hasText(sendA, c.canary.B),
    "proposals_to_send(A) offers A's proposals and none of B's",
    '',
  )
  const jobA = await job(A, pa, 'sender')
  const marked = await wq(
    `select app.proposals_sent('${A}', array['${pBid}', '${nobody}']::uuid[], '${jobA}')`,
  )
  const bRow = await one(`select delivered_at from public.proposals where proposal_id = '${pBid}'`)
  c.check(
    marked === 0 && bRow.delivered_at === null,
    "proposals_sent(A, [B's proposal]) marks nothing and B's proposal is still waiting",
    c.json(marked),
  )
  const markedOwn = await wq(`select app.proposals_sent('${A}', array['${pA}']::uuid[], '${jobA}')`)
  c.check(
    markedOwn === 1,
    "and A's own proposal is marked (the positive control)",
    c.json(markedOwn),
  )

  // a proposal whose delivering job FINISHED without sending is put back - each in its own office, none moved
  const doneA = await job(A, pa, 'done', { state: 'complete' })
  const doneB = await job(B, pb, 'done', { state: 'complete' })
  const sentB = await job(B, pb, 'sentjob', { state: 'complete' })
  const uA = await mk(A, `h undeliver A ${run}`)
  const uB = await mk(B, `h undeliver B ${run}`)
  const uBsent = await mk(B, `h undeliver B sent ${run}`)
  await c.db.execute(
    `update public.proposals set delivered_at = app.now_utc(), delivered_by_job = '${doneA}' where proposal_id = '${uA}'`,
  )
  await c.db.execute(
    `update public.proposals set delivered_at = app.now_utc(), delivered_by_job = '${doneB}' where proposal_id = '${uB}'`,
  )
  await c.db.execute(
    `update public.proposals set delivered_at = app.now_utc(), delivered_by_job = '${sentB}' where proposal_id = '${uBsent}'`,
  )
  await c.db.execute(
    `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, lease_expires_at, sent_at, message_ref)
     values ('${B}', 'telegram', ${lit(`h-${run}-undeliver`)}, 'acct', '1234567', 'notice', '${sentB}', 'sent', app.now_utc() + interval '1 hour', app.now_utc(), 'm-${run}')`,
  )
  await wq(`select app.proposals_undeliver()`)
  const after = await q(
    `select proposal_id::text as id, office_id, delivered_at from public.proposals where proposal_id in ('${uA}', '${uB}', '${uBsent}')`,
  )
  const byId = new Map(after.map((r) => [String(r.id), r]))
  c.check(
    byId.get(uA)?.delivered_at === null &&
      byId.get(uB)?.delivered_at === null &&
      byId.get(uBsent)?.delivered_at !== null &&
      byId.get(uA)?.office_id === A &&
      byId.get(uB)?.office_id === B,
    'proposals_undeliver restores what a finished job never sent - in A and in B - leaves what was sent, and moves no proposal between offices',
    '',
  )

  // ---- fan-in: a group is its parent's office's ---------------------------------------------------------------------------
  const parentA = await job(A, pa, 'fan-parent')
  const parentB = await job(B, pb, 'fan-parent')
  const kidA = await job(A, pa, 'fan-kid', { parent: parentA, kind: 'office.instruction' })
  const kidB = await job(B, pb, 'fan-kid', { parent: parentB, kind: 'office.instruction' })
  await output(kidA, `${c.canary.A} the branch answer from A`)
  await output(kidB, `${c.canary.B} the branch answer from B`)
  const branch = (j: string) =>
    JSON.stringify([{ agent: 'research-director', job_id: j, purpose: 'p3 probe' }])
  const fanA = (await wq(
    `select app.fan_in_over('${A}', '${parentA}', 'the probe objective', ${lit(branch(kidA))}::jsonb)`,
  )) as { ok?: boolean; group?: string; synthesis?: string }
  const fanB = (await wq(
    `select app.fan_in_over('${B}', '${parentB}', 'the probe objective', ${lit(branch(kidB))}::jsonb)`,
  )) as { ok?: boolean; group?: string }
  const gOffice = await one(
    `select j.office_id, (select office_id from public.jobs where job_id = '${fanA.synthesis}') as synth_office from public.branch_groups g join public.jobs j on j.job_id = g.parent_job_id where g.group_id = '${fanA.group}'`,
  )
  c.check(
    fanA.ok === true && fanB.ok === true && gOffice.office_id === A && gOffice.synth_office === A,
    "fan_in_over as A opens A's group and its synthesis job is A's",
    c.json(fanA).slice(0, 80),
  )
  await sameAnswer(
    'fan_in_over (parent)',
    (id) => `select app.fan_in_over('${A}', '${id}', 'x', ${lit(branch(kidA))}::jsonb)`,
    parentB,
  )
  const parentA2 = await job(A, pa, 'fan-parent2')
  await sameAnswer(
    'fan_in_over (branch)',
    (id) => `select app.fan_in_over('${A}', '${parentA2}', 'x', ${lit(branch(id))}::jsonb)`,
    kidB,
  )
  await refusedAlike(
    'fan_in_over (caller)',
    (id) =>
      `select app.fan_in_over('${A}', '${parentA2}', 'x', ${lit(branch(kidA))}::jsonb, 'office.synthesise', null, '${id}', 'w1', 1)`,
    kidB,
  )
  const noG = await one(
    `select count(*)::int as n from public.branch_groups where parent_job_id = '${parentA2}'`,
  )
  c.check(noG.n === 0, 'and a refused fan-in left no group behind', '')
  const readyA = await wq(`select app.fan_in_ready('${A}', '${fanA.group}')`)
  c.check(
    c.json(readyA).includes('"total":1'),
    "fan_in_ready(A, A's group) reads A's branches (the positive control)",
    c.json(readyA).slice(0, 60),
  )
  await sameAnswer(
    'fan_in_ready',
    (id) => `select app.fan_in_ready('${A}', '${id}')`,
    String(fanB.group),
  )
  const outA = await wq(`select app.branch_outputs('${A}', '${fanA.group}')`)
  c.check(
    hasText(outA, c.canary.A) && !hasText(outA, c.canary.B),
    "branch_outputs(A, A's group) holds A's answer and not B's",
    '',
  )
  await sameAnswer(
    'branch_outputs',
    (id) => `select app.branch_outputs('${A}', '${id}')`,
    String(fanB.group),
  )
  const nullFan = await c.refusal(W, `select app.fan_in_ready(null::uuid, '${fanA.group}')`)
  c.check(
    nullFan.includes('no_office'),
    'fan_in_ready: a null office is no_office',
    nullFan.slice(0, 50),
  )
  const unr = (await one(
    `select app.unrouted_live_jobs('${A}') as a, app.unrouted_live_jobs('${B}') as b`,
  )) as { a: number; b: number }
  const total = (await one(
    `select count(*)::int as n from public.jobs j where j.state not in ('complete','cancelled','failed') and not exists (select 1 from public.routing_decisions r where r.job_id = j.job_id)`,
  )) as { n: number }
  c.check(
    unr.a + unr.b <= total.n && unr.a < total.n && unr.b < total.n,
    "unrouted_live_jobs counts one office's jobs, not the deployment's",
    c.json(unr),
  )
}

const hasText = (v: unknown, canary: string): boolean => JSON.stringify(v).includes(canary)

// ==========================================================================================================================
// 6. THE JOB-BOUND READERS AND WRITERS (the office is the job's), AND THE FENCE
// ==========================================================================================================================
async function jobBound(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, q, wq, nobody, job, command, derivedSnap, pa, pb } = e

  // ---- writers: they write under the held job and nowhere else ------------------------------------------------------
  const jobA = await job(A, pa, 'bound')
  await job(B, pb, 'bound')
  const beforeB = await derivedSnap(B)
  const cant = (await wq(
    `select app.cannot('${jobA}', 'missing_tool', 'a probe thing ${run}', 'the handler', 'p3 probe', 'a probe')`,
  )) as { impediment_id?: string }
  const missing = c.json(
    await wq(`select app.cannot('${nobody}', 'missing_tool', 'a probe thing', 'the handler')`),
  )
  c.check(
    cant.impediment_id !== undefined &&
      missing.includes('no such job') &&
      (await derivedSnap(B)) === beforeB,
    "cannot writes under the held job; a job that does not exist is 'no such job'; B's rows do not move",
    missing,
  )
  const counted = await q(
    `select needed from app.impediments_tally_in('${A}', 30, 1, true) where needed = 'a probe thing ${run}'`,
  )
  const notB = await q(
    `select needed from app.impediments_tally_in('${B}', 30, 1, true) where needed = 'a probe thing ${run}'`,
  )
  c.check(
    counted.length === 1 && notB.length === 0,
    "and the impediment is counted in A's tally and not in B's",
    '',
  )
  const plan = await wq(
    `select app.job_plan_set('${A}', '${jobA}', 'notion.write', array['notion'], '[{"verb":"create","what":"a page","where":"notion","writes":1}]'::jsonb, 'a probe plan', 1)`,
  )
  const planBack = await wq(`select app.job_plan('${jobA}')`)
  c.check(
    c.json(plan).includes('"ok":true') &&
      c.json(planBack).includes('a probe plan') &&
      (await derivedSnap(B)) === beforeB,
    "job_plan_set / job_plan are the held job's own",
    '',
  )
  const understood = await wq(`select app.understood('${jobA}', 'You want the probe to run.')`)
  c.check(c.json(understood).includes('"ok":true'), 'understood restates the held job', '')
  const trace = await wq(
    `select app.job_trace_add('${A}', '${jobA}', 'note', '{}'::jsonb, 1, 1, 0.1, 1)`,
  )
  const step = (await wq(
    `select app.step_begin('${A}', '${jobA}', 'probe-step', 1, 'none', 1, 'v1')`,
  )) as {
    do?: boolean
  }
  const done = await wq(`select app.step_done('${A}', '${jobA}', 'probe-step', '{}'::jsonb)`)
  c.check(
    trace === 1 &&
      step.do === true &&
      c.json(done).includes('"ok":true') &&
      (await derivedSnap(B)) === beforeB,
    "job_trace_add / step_begin / step_done write under the held job and leave B's untouched",
    '',
  )

  // ---- the fence is untouched: a stale worker or claim can do nothing -------------------------------------------------
  const leased = await job(A, pa, 'leased', { state: 'running' })
  await c.db.execute(
    `update public.jobs set leased_by = 'w-real', leased_until = app.now_utc() + interval '1 minute', attempt = 1, claim_gen = 3 where job_id = '${leased}'`,
  )
  const staleGen = await wq(`select app.renew_lease('${leased}', 'w-real', 1, 2)`)
  const staleWorker = await wq(`select app.renew_lease('${leased}', 'w-zombie', 1, 3)`)
  const held = await wq(`select app.renew_lease('${leased}', 'w-real', 1, 3)`)
  const heldNow = await wq(`select app.job_held('${leased}', 'w-real', 1, 3)`)
  const staleHeld = await wq(`select app.job_held('${leased}', 'w-real', 1, 2)`)
  c.check(
    staleGen === false &&
      staleWorker === false &&
      held === true &&
      heldNow === true &&
      staleHeld === false,
    'renew_lease and job_held still refuse a stale claim and a stranger, and accept the holder',
    c.json([staleGen, staleWorker, held, heldNow, staleHeld]),
  )
  const zombie = await c.refusal(
    W,
    `select app.pause_job('${leased}', 'scheduled_wait', 'p3', 'later', true, null, null, null, 'w-zombie', 3)`,
  )
  c.check(
    zombie.includes('stale caller'),
    'pause_job refuses a worker that no longer holds the claim',
    zombie.slice(0, 60),
  )
  const parked = await wq(
    `select app.pause_job('${leased}', 'scheduled_wait', 'p3', 'later', true, null, null, null, 'w-real', 3)`,
  )
  c.check(
    c.json(parked).includes('"ok":true') && (await stateOf(e, leased)) === 'paused',
    'and the holder parks it',
    c.json(parked),
  )
  const resumable = (await wq(`select app.resumable_now()`)) as { job_id: string }[]
  c.check(
    resumable.some((r) => r.job_id === leased),
    'resumable_now lists the parked job (a deployment scan)',
    '',
  )
  const woke = await wq(`select app.resume_job('${leased}', 'p3')`)
  c.check(
    c.json(woke).includes('"ok":true') && (await stateOf(e, leased)) === 'queued',
    'and resume_job wakes it',
    c.json(woke),
  )

  // ---- second ids a job points at must be the job's own office's ---------------------------------------------------------
  // owed_a_word: a failed turn is owed a word on the command it points at - never on another office's
  const cmdA = await command(A, pa, 'owed-a', 'please do the probe', {})
  const cmdB = await command(B, pb, 'owed-b', 'please do the other probe', {})
  const owedOwn = await job(A, pa, 'owed-own', { state: 'failed', pinned: { command_id: cmdA } })
  const owedForeign = await job(A, pa, 'owed-foreign', {
    state: 'failed',
    pinned: { command_id: cmdB },
  })
  const owedMissing = await job(A, pa, 'owed-missing', {
    state: 'failed',
    pinned: { command_id: nobody },
  })
  const rowsOf = async (j: string) => (await q(`select * from app.owed_a_word('${j}')`)).length
  c.check(
    (await rowsOf(owedOwn)) === 1 &&
      (await rowsOf(owedForeign)) === 0 &&
      (await rowsOf(owedMissing)) === 0,
    "owed_a_word: a failed job is owed a word on its own office's command, and a command of another office owes it nothing (as for one that does not exist)",
    `${String(await rowsOf(owedOwn))}/${String(await rowsOf(owedForeign))}/${String(await rowsOf(owedMissing))}`,
  )

  // staff_behind_job: a duty slug repeats across offices; the owner is the job's office's
  const staff = (await q(
    `select staff_id::text as id, slug from public.staff where active order by slug limit 2`,
  )) as { id: string; slug: string }[]
  const slug = `h-owner-${run}`
  const KIND = `h_owner.${run}`
  for (const [office, s] of [
    [A, staff[0]],
    [B, staff[1]],
  ] as const) {
    await c.db.execute(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled, project_id)
       values ('${office}', ${lit(slug)}, '${s?.id}', 'a probe duty that exists only to prove an owner is looked up inside an office', ${lit(KIND)}, 60, false, null)`,
    )
  }
  const ownA = await job(A, pa, 'owner', { kind: KIND, requestedBy: `duty:${slug}` })
  const ownB = await job(B, pb, 'owner', { kind: KIND, requestedBy: `duty:${slug}` })
  const behindA = await one(`select app.staff_behind_job('${ownA}') as s`)
  const behindB = await one(`select app.staff_behind_job('${ownB}') as s`)
  c.check(
    behindA.s === staff[0]?.slug && behindB.s === staff[1]?.slug,
    "staff_behind_job: each office's duty job is owned by that office's specialist, though the two duties share a slug",
    `${String(behindA.s)} / ${String(behindB.s)}`,
  )

  // job_origin / internal_root_ok: a duty only another office has does not make this office's job "internal"
  const slugB = `h-only-b-${run}`
  const KIND_B = `h_onlyb.${run}`
  await c.db.execute(
    `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled, project_id)
     values ('${B}', ${lit(slugB)}, '${staff[0]?.id}', 'a probe duty that only B has, so A cannot be trusted through it', ${lit(KIND_B)}, 60, false, null)`,
  )
  const innerB = await one(
    `select app.internal_root_ok((select job_id from public.jobs where job_id = '${await job(B, pb, 'inner-b', { kind: KIND_B, requestedBy: `duty:${slugB}` })}')) as ok`,
  )
  const innerA = await one(
    `select app.internal_root_ok('${await job(A, pa, 'inner-a', { kind: KIND_B, requestedBy: `duty:${slugB}` })}') as ok`,
  )
  c.check(
    innerB.ok === true && innerA.ok === false,
    "internal_root_ok: B's own duty makes B's job internal and does not make an A job that merely carries the same name internal",
    `${String(innerB.ok)} / ${String(innerA.ok)}`,
  )

  const approvalOwn = await one(`select app.open_approval_for_job('${jobA}') as b`)
  c.check(
    approvalOwn.b === null || typeof approvalOwn.b === 'string',
    'open_approval_for_job answers for the held job',
    '',
  )
}

// ==========================================================================================================================
// 7. THE DEPLOYMENT SCANS: global by design, and none moves a job or a row to another office
// ==========================================================================================================================
async function scans(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, one, q, wq, job, command, pa, pb } = e
  const officeOf = async (id: string): Promise<string> =>
    String((await one(`select office_id from public.jobs where job_id = '${id}'`)).office_id)

  // retrying -> queued, one row at a time, each keeping its own office
  const rA = await job(A, pa, 'retry', { state: 'retrying' })
  const rB = await job(B, pb, 'retry', { state: 'retrying' })
  // (requeue_retrying, recover_stalled_* and claim_pending_notification are SECURITY INVOKER: the worker runs them as the
  // database owner, which is the superuser connection here, not the limited stand-in role)
  await c.db.execute(`select app.requeue_retrying()`)
  c.check(
    (await stateOf(e, rA)) === 'queued' &&
      (await stateOf(e, rB)) === 'queued' &&
      (await officeOf(rA)) === A &&
      (await officeOf(rB)) === B,
    "requeue_retrying requeues A's and B's retrying jobs and each stays in its own office",
    '',
  )

  // a job that ran out its attempts is settled - in its own office
  const xA = await job(A, pa, 'exhausted')
  const xB = await job(B, pb, 'exhausted')
  await c.db.execute(
    `update public.jobs set attempt = max_attempts where job_id in ('${xA}', '${xB}')`,
  )
  // settle_exhausted_jobs wants the job to have been quiet for five minutes
  await c.db.execute(`alter table public.jobs disable trigger jobs_touch_updated_at`)
  await c.db.execute(
    `update public.jobs set updated_at = app.now_utc() - interval '10 minutes' where job_id in ('${xA}', '${xB}')`,
  )
  await c.db.execute(`alter table public.jobs enable trigger jobs_touch_updated_at`)
  await wq(`select * from app.settle_exhausted_jobs()`)
  c.check(
    (await stateOf(e, xA)) === 'failed' &&
      (await stateOf(e, xB)) === 'failed' &&
      (await officeOf(xA)) === A &&
      (await officeOf(xB)) === B,
    "settle_exhausted_jobs fails both offices' exhausted jobs and moves neither",
    '',
  )

  // a worker that died holding a job: recovered, per row, in its own office
  const sA = await job(A, pa, 'stalled', { state: 'running' })
  const sB = await job(B, pb, 'stalled', { state: 'running' })
  await c.db.execute(
    `update public.jobs set leased_by = 'w-dead', leased_until = now() - interval '1 hour', attempt = 1 where job_id in ('${sA}', '${sB}')`,
  )
  await c.db.execute(`select * from app.recover_stalled_jobs()`)
  c.check(
    (await stateOf(e, sA)) === 'retrying' &&
      (await stateOf(e, sB)) === 'retrying' &&
      (await officeOf(sA)) === A &&
      (await officeOf(sB)) === B,
    "recover_stalled_jobs recovers both offices' stalled jobs and each stays where it was",
    '',
  )

  // jobs parked because no handler knew their kind are put back by kind
  const KIND = `h_nohandler.${run}`
  const nA = await job(A, pa, 'nohandler', { state: 'paused', kind: KIND })
  const nB = await job(B, pb, 'nohandler', { state: 'paused', kind: KIND })
  await c.db
    .execute(
      `update public.jobs set state_reason = 'no handler for kind ${KIND}' where job_id in ('${nA}', '${nB}')`,
    )
    .catch(() => undefined)
  await wq(`select app.resume_paused(array['${KIND}']::text[])`)
  c.check(
    (await officeOf(nA)) === A && (await officeOf(nB)) === B,
    'resume_paused wakes parked jobs by kind and moves none of them',
    `${await stateOf(e, nA)} / ${await stateOf(e, nB)}`,
  )

  // a command nobody enqueued is enqueued INSIDE its own office
  const oa = await command(A, pa, 'orphan-a', 'an orphan command from A that nobody enqueued', {
    ago: 5,
  })
  const ob = await command(B, pb, 'orphan-b', 'an orphan command from B that nobody enqueued', {
    ago: 5,
  })
  await wq(`select app.enqueue_orphans()`)
  const orphans = await q(
    `select c.command_id::text as id, c.office_id as c_office, j.office_id as j_office from public.inbound_commands c left join public.jobs j on j.job_id = c.job_id where c.command_id in ('${oa}', '${ob}')`,
  )
  c.check(
    orphans.length === 2 && orphans.every((r) => r.j_office !== null && r.j_office === r.c_office),
    "enqueue_orphans gives each orphan command a job in the command's own office",
    c.json(orphans.map((r) => [r.c_office === A ? 'A' : 'B', r.j_office === r.c_office])),
  )

  // old trace rows are pruned across the deployment; nothing else is touched
  const tA = await job(A, pa, 'trace')
  const tB = await job(B, pb, 'trace')
  for (const t of [tA, tB]) {
    await c.db.execute(
      `insert into public.job_traces (job_id, step, at, kind) values ('${t}', 1, app.now_utc() - interval '90 days', 'note'), ('${t}', 2, app.now_utc(), 'note')`,
    )
  }
  await wq(`select app.job_trace_prune(30, 5000)`)
  const left = await q(
    `select job_id::text as id, count(*)::int as n from public.job_traces where job_id in ('${tA}', '${tB}') group by 1`,
  )
  c.check(
    left.length === 2 && left.every((r) => r.n === 1),
    "job_trace_prune drops each office's old steps and keeps the recent ones",
    c.json(left),
  )

  // undo offers and syncs lapse in place
  await c.db.execute(
    `insert into public.undoable_actions (office_id, correlation_id, kind, description, reversal, status, undo_deadline)
     values ('${A}', gen_random_uuid(), 'probe.thing', 'a probe action that lapsed an hour ago', '{"action":"x"}'::jsonb, 'available', app.now_utc() - interval '1 hour'),
            ('${B}', gen_random_uuid(), 'probe.thing', 'a probe action that lapsed an hour ago', '{"action":"x"}'::jsonb, 'available', app.now_utc() - interval '1 hour')`,
  )
  await wq(`select app.expire_undo_offers()`)
  const lapsed = await q(
    `select office_id, status::text as s from public.undoable_actions where description = 'a probe action that lapsed an hour ago' and office_id in ('${A}', '${B}')`,
  )
  c.check(
    lapsed.length === 2 && lapsed.every((r) => r.s === 'expired'),
    "expire_undo_offers lapses both offices' offers in place",
    '',
  )
  // (sync_runs_one_at_a_time is a unique index on `true`: ONE running sync for the whole deployment - a P2 follow-up that
  // keys it by office. Until then each office's stalled sync is proved in its own turn.)
  for (const office of [A, B]) {
    await c.db.execute(
      `insert into public.sync_runs (office_id, state, leased_by, leased_until) values ('${office}', 'running', 'w-dead-${run}', now() - interval '1 hour')`,
    )
    await c.db.execute(`select app.recover_stalled_syncs()`)
  }
  const syncs = await q(
    `select office_id, state::text as s from public.sync_runs where detail like '%the worker died mid-sync%' and office_id in ('${A}', '${B}') and started_at > now() - interval '5 minutes'`,
  )
  c.check(
    new Set(syncs.map((r) => r.office_id)).size === 2 && syncs.every((r) => r.s === 'abandoned'),
    "recover_stalled_syncs abandons each office's stalled sync in place",
    '',
  )

  // the budget is a deployment limit: it may delay a queued job and never moves it
  const bA = await job(A, pa, 'budget')
  const bB = await job(B, pb, 'budget')
  await wq(`select app.defer_over_budget()`)
  c.check(
    (await officeOf(bA)) === A && (await officeOf(bB)) === B,
    'defer_over_budget delays jobs where they are and moves none',
    '',
  )

  // a disabled office's finished work is not claimed for delivery
  const authX = `e5555555-5555-4555-8555-${Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)}`
  await c.db.execute(
    `insert into auth.users (id, email) values ('${authX}', ${lit(`gone-h-${run}@example.invalid`)}) on conflict do nothing`,
  )
  await c.db.execute(
    `insert into public.offices (auth_user_id, kind, name) values ('${authX}', 'person', ${lit(`Gone H ${run}`)})`,
  )
  const gone = String(
    (await one(`select office_id from public.offices where auth_user_id = '${authX}'`)).office_id,
  )
  const pg = await e.proj(gone, `gone-h-${run}`)
  const nGone = await job(gone, pg, 'notifying', { state: 'notifying' })
  const nLive = await job(A, pa, 'notifying', { state: 'notifying' })
  await c.db.execute(`update public.jobs set priority = 1 where job_id in ('${nGone}', '${nLive}')`)
  await c.db.execute(`alter table public.jobs disable trigger jobs_touch_updated_at`)
  await c.db.execute(
    `update public.jobs set updated_at = app.now_utc() - interval '1 year' where job_id = '${nGone}'`,
  )
  await c.db.execute(`alter table public.jobs enable trigger jobs_touch_updated_at`)
  await c.db.execute(
    `update public.offices set state = 'disabled', disabled_at = now() where office_id = '${gone}'`,
  )
  const claimed: string[] = []
  for (let i = 0; i < 40; i += 1) {
    const r = await q(
      `select job_id::text as id from app.claim_pending_notification('h-worker-${run}', 60)`,
    )
    if (r.length === 0) break
    claimed.push(String(r[0]?.id))
    if (claimed.includes(nLive)) break
  }
  const goneRow = await one(`select leased_by from public.jobs where job_id = '${nGone}'`)
  c.check(
    claimed.includes(nLive) && !claimed.includes(nGone) && goneRow.leased_by === null,
    "claim_pending_notification hands out an active office's finished job and never a disabled office's",
    `${String(claimed.length)} claimed`,
  )
  await c.db
    .execute(
      `update public.offices set state = 'active', disabled_at = null where office_id = '${gone}'`,
    )
    .catch(() => undefined)
  void W
}
