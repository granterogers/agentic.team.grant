/**
 * The worker-side functions that were still unscoped (multi-user P3, cluster k-worker-internal, migrations 0850-0852).
 *
 * Four kinds of claim, each proved as Person A against Person B's ids and rows:
 *
 *   A. CONVERTED (they take the office first): enqueue_child, enqueue_child_once, job_plan_set, step_begin, step_done,
 *      job_trace_add, skill_used, command_account, command_principal, approval_for_delivery, request_undo / claim_undo,
 *      approve_tool, decline_tool, revoke_tool, withdraw_tool_request, hq_appearance. A foreign id and a nonexistent id
 *      give the same answer; nothing of B's moves; a null or unknown office is no_office; no browser role can execute.
 *   B. JOB-BOUND (the id IS the claim; the office is the job's): service-only; every other row they touch is reached
 *      through that job's office, so an id written into the job's data (a command, a duty) that belongs to ANOTHER
 *      office reads exactly as one that does not exist.
 *   C. DEPLOYMENT SCANS (global by design, each row keeps its own office): service-only; the row they act on keeps its office;
 *      an office that is not active is not swept and runs nothing.
 *   D. RESOLVERS: they take no office; service-only.
 *
 * Every proof title that conversion-overrides.json names appears here as a string literal, and the override is honoured only
 * while no browser role (anon, authenticated, public) can execute the function.
 */
import { type Ctx, lit } from '../p3-app-lib.ts'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const norm = (s: string): string => s.replace(UUID, '<id>')

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const W = 'p2_worker'
  const run = Math.random().toString(36).slice(2, 8)
  const nobody = c.nobody()
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const one = async (sql: string) => (await q(sql))[0] as Record<string, unknown>
  const wq = async (sql: string) => c.exec(W, sql)
  const bridge = async () =>
    Number((await one(`select coalesce(sum(n), 0)::int as n from public.office_bridge_use`)).n ?? 0)
  /** No browser role (anon, authenticated, public) can execute it. */
  const sealed = async (sig: string): Promise<boolean> => {
    const r = await one(
      `select has_function_privilege('anon', '${sig}', 'execute') as a,
              has_function_privilege('authenticated', '${sig}', 'execute') as u,
              has_function_privilege('public', '${sig}', 'execute') as p`,
    )
    return r.a === false && r.u === false && r.p === false
  }
  /** What a call gives back or is refused with, normalised, to compare a foreign id with a nonexistent one. */
  const outcome = async (sql: string): Promise<string> => norm(c.json(await c.try_(W, sql)))
  const alike = async (mk: (id: string) => string, foreign: string): Promise<boolean> =>
    (await outcome(mk(foreign))) === (await outcome(mk(nobody)))
  const noOffice = async (sql: string): Promise<boolean> =>
    (await c.refusal(W, sql)).includes('no_office')

  // ---- the world -------------------------------------------------------------------------------------------------------
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
  const pa = await proj(A, `k-${run}`)
  const pb = await proj(B, `k-${run}`)
  let n = 0
  type JobOpts = {
    state?: string
    kind?: string
    parent?: string
    pinned?: Record<string, unknown>
    requestedBy?: string
    key?: string
    cols?: Record<string, string>
  }
  const job = async (
    office: string,
    project: string | null,
    tag: string,
    extra: JobOpts = {},
  ): Promise<string> => {
    n += 1
    const key = extra.key ?? `k-${run}-${tag}-${String(n)}`
    const done = ['complete', 'failed', 'cancelled'].includes(extra.state ?? 'queued')
    const cols: Record<string, string> = {
      job_id: 'gen_random_uuid()',
      correlation_id: 'gen_random_uuid()',
      idempotency_key: lit(key),
      kind: lit(extra.kind ?? 'probe'),
      requested_by: lit(extra.requestedBy ?? 'verify:p3'),
      project_id: project === null ? 'null' : lit(project),
      office_id: `'${office}'`,
      parent_job_id: extra.parent === undefined ? 'null' : lit(extra.parent),
      state: `${lit(extra.state ?? 'queued')}::job_state`,
      pinned_config: `${lit(JSON.stringify(extra.pinned ?? {}))}::jsonb`,
      finished_at: done ? 'app.now_utc()' : 'null',
      ...(extra.cols ?? {}),
    }
    await c.db.execute(
      `insert into public.jobs (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`,
    )
    return String(
      (await one(`select job_id from public.jobs where idempotency_key = ${lit(key)}`)).job_id,
    )
  }
  const command = async (
    office: string,
    project: string,
    tag: string,
    opts: {
      channel?: string
      key?: string
      context?: Record<string, unknown>
      subject?: string
    } = {},
  ): Promise<string> => {
    n += 1
    const key = opts.key ?? `verify:k_worker:${run}-${tag}-${String(n)}`
    await c.db.execute(
      `insert into public.inbound_commands (office_id, project_id, origin_channel, origin_ref, actor, subject, instruction, dedupe_key, context, received_at)
       values ('${office}', ${lit(project)}, ${lit(opts.channel ?? 'teamhq')}, ${lit(`${run}${String(n)}:${String(n)}`)}, ${lit(opts.subject ?? `k-person-${run}`)}, ${lit(opts.subject ?? `k-person-${run}`)},
               ${lit(`k ${tag} ${run}`)}, ${lit(key)}, ${lit(JSON.stringify(opts.context ?? {}))}::jsonb, app.now_utc() - interval '10 minutes')`,
    )
    return String(
      (await one(`select command_id from public.inbound_commands where dedupe_key = ${lit(key)}`))
        .command_id,
    )
  }
  const stateOf = async (id: string): Promise<string> =>
    String((await one(`select state::text as s from public.jobs where job_id = '${id}'`)).s)
  /** A digest of the rows a job leaves in the DERIVED tables (no office column), for one office. */
  const derivedSnap = async (office: string): Promise<string> => {
    const parts: string[] = []
    for (const [t, key] of [
      ['job_plans', 'job_id'],
      ['job_steps', 'job_id'],
      ['job_traces', 'job_id'],
      ['job_impediments', 'job_id'],
      ['job_child_slots', 'job_id'],
      ['skill_uses', 'job_id'],
      ['job_pauses', 'job_id'],
    ] as const) {
      const r = await one(
        `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h from public.${t} x join public.jobs j on j.job_id = x.${key} where j.office_id = '${office}'`,
      )
      parts.push(`${t}=${String(r.h)}`)
    }
    return parts.join(',')
  }

  const jobA = await job(A, pa, 'a-running', { state: 'running' })
  const jobB = await job(B, pb, 'b-running', { state: 'running' })
  const bridge0 = await bridge()

  // ======================================================================================================================
  // A. enqueue_child / enqueue_child_once
  // ======================================================================================================================
  const snapBefore = await c.snapshot(B, ['jobs'])
  const dBefore = await derivedSnap(B)
  const kid = String(
    await wq(
      `select app.enqueue_child('${A}', '${jobA}', 'probe', '{"k":1}'::jsonb, '0'::interval, false)`,
    ),
  )
  const kidRow = await one(
    `select office_id::text as o, parent_job_id::text as p, project_id::text as pr from public.jobs where job_id = '${kid}'`,
  )
  c.check(
    kidRow.o === A && kidRow.p === jobA && kidRow.pr === pa,
    "enqueue_child: the child is the parent's office and inherits its project (the positive control)",
    c.json(kidRow),
  )
  c.check(
    await alike((id) => `select app.enqueue_child('${A}', '${id}', 'probe')`, jobB),
    "enqueue_child: B's job as the parent and a nonexistent parent are refused with the same sentence",
    await outcome(`select app.enqueue_child('${A}', '${jobB}', 'probe')`),
  )
  c.check(
    await alike((id) => `select app.enqueue_child('${B}', '${id}', 'probe')`, jobA),
    "enqueue_child: claiming B's office for A's job is refused exactly as claiming it for a job that does not exist",
    await outcome(`select app.enqueue_child('${B}', '${jobA}', 'probe')`),
  )
  c.check(
    await alike(
      (id) =>
        `select app.enqueue_child('${A}', '${jobA}', 'probe', '{}'::jsonb, '0'::interval, false, '${id}')`,
      pb,
    ),
    "enqueue_child: B's project and a nonexistent project are refused with the same sentence",
    await outcome(
      `select app.enqueue_child('${A}', '${jobA}', 'probe', '{}'::jsonb, '0'::interval, false, '${pb}')`,
    ),
  )
  c.check(
    await alike(
      (id) =>
        `select app.enqueue_child('${A}', '${jobA}', 'probe', '{}'::jsonb, '0'::interval, false, null, '${id}', 'w', 1)`,
      jobB,
    ),
    "enqueue_child: B's job as the caller and a nonexistent caller are refused with the same sentence",
    await outcome(
      `select app.enqueue_child('${A}', '${jobA}', 'probe', '{}'::jsonb, '0'::interval, false, null, '${jobB}', 'w', 1)`,
    ),
  )
  const once = (await wq(
    `select app.enqueue_child_once('${A}', '${jobA}', 'probe', 'ask once ${run}', '{}'::jsonb, false)`,
  )) as { job_id: string; created: boolean }
  const onceAgain = (await wq(
    `select app.enqueue_child_once('${A}', '${jobA}', 'probe', 'ask once ${run}', '{}'::jsonb, false)`,
  )) as { job_id: string; created: boolean }
  c.check(
    once.created === true &&
      onceAgain.created === false &&
      onceAgain.job_id === once.job_id &&
      (await one(`select office_id::text as o from public.jobs where job_id = '${once.job_id}'`))
        .o === A,
    "enqueue_child_once: the first request makes the child in the parent's office and the same request again reuses it",
    c.json(onceAgain),
  )
  c.check(
    (await alike((id) => `select app.enqueue_child_once('${A}', '${id}', 'probe', 'x')`, jobB)) &&
      (await alike(
        (id) =>
          `select app.enqueue_child_once('${A}', '${jobA}', 'probe', 'y', '{}'::jsonb, false, '${id}')`,
        pb,
      )) &&
      (await alike(
        (id) =>
          `select app.enqueue_child_once('${A}', '${jobA}', 'probe', 'z', '{}'::jsonb, false, null, '${id}', 'w', 1)`,
        jobB,
      )),
    'enqueue_child_once: a foreign parent, project or caller is refused exactly as a nonexistent one is',
    '',
  )
  c.check(
    (await c.snapshot(B, ['jobs'])) === snapBefore &&
      (await derivedSnap(B)) === dBefore &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.jobs where parent_job_id = '${jobA}' and office_id <> '${A}'`,
          )
        ).n,
      ) === 0,
    "enqueue_child and enqueue_child_once left B's jobs and slots untouched and hung nothing of B's on A's parent",
    '',
  )
  c.check(
    (await noOffice(`select app.enqueue_child(null::uuid, '${jobA}', 'probe')`)) &&
      (await noOffice(`select app.enqueue_child('${nobody}', '${jobA}', 'probe')`)) &&
      (await noOffice(`select app.enqueue_child_once(null::uuid, '${jobA}', 'probe', 'x')`)) &&
      (await noOffice(`select app.enqueue_child_once('${nobody}', '${jobA}', 'probe', 'x')`)),
    'enqueue_child / enqueue_child_once: a null office and a nonexistent office are no_office',
    '',
  )
  c.check(
    (await sealed(
      'app.enqueue_child(uuid,uuid,text,jsonb,interval,boolean,uuid,uuid,text,bigint)',
    )) &&
      (await sealed(
        'app.enqueue_child_once(uuid,uuid,text,text,jsonb,boolean,uuid,uuid,text,bigint)',
      )),
    'enqueue_child / enqueue_child_once: no browser role can execute them',
    '',
  )

  // ======================================================================================================================
  // A. job_plan_set, step_begin, step_done, job_trace_add, skill_used
  // ======================================================================================================================
  const steps = `'[{"verb":"create","what":"a page","where":"notion","writes":1}]'::jsonb`
  const dB1 = await derivedSnap(B)
  const planA = (await wq(
    `select app.job_plan_set('${A}', '${jobA}', 'notion.write', array['notion'], ${steps}, ${lit(`a plan ${c.canary.A}`)}, 1)`,
  )) as { ok?: boolean }
  const planBack = await wq(`select app.job_plan('${jobA}')`)
  c.check(
    planA.ok === true &&
      c.json(planBack).includes(c.canary.A) &&
      !c.json(planBack).includes(c.canary.B),
    "job_plan_set: A's plan is recorded under A's job and read back (the positive control)",
    c.json(planBack).slice(0, 80),
  )
  c.check(
    await alike(
      (id) =>
        `select app.job_plan_set('${A}', '${id}', 'notion.write', array['notion'], ${steps}, 'x', 1)`,
      jobB,
    ),
    "job_plan_set: B's job and a nonexistent job both answer 'no such job'",
    await outcome(
      `select app.job_plan_set('${A}', '${jobB}', 'notion.write', array['notion'], ${steps}, 'x', 1)`,
    ),
  )
  const trace = await wq(
    `select app.job_trace_add('${A}', '${jobA}', 'note', ${lit(JSON.stringify({ canary: c.canary.A }))}::jsonb, 1, 2, 0.5, 3)`,
  )
  const traceRow = await one(
    `select trace_steps, trace_tokens from public.jobs where job_id = '${jobA}'`,
  )
  c.check(
    trace === 1 && Number(traceRow.trace_steps) === 1 && Number(traceRow.trace_tokens) === 3,
    "job_trace_add: a line is written under A's job and the job's rollup moves (the positive control)",
    c.json(traceRow),
  )
  c.check(
    (await alike((id) => `select app.job_trace_add('${A}', '${id}', 'note')`, jobB)) &&
      (await outcome(`select app.job_trace_add('${A}', '${jobB}', 'note')`)).includes('null'),
    "job_trace_add: B's job and a nonexistent job both record nothing and answer null",
    await outcome(`select app.job_trace_add('${A}', '${jobB}', 'note')`),
  )
  const sb = (await wq(
    `select app.step_begin('${A}', '${jobA}', 'k-step', 1, 'none', 1, 'v1')`,
  )) as { do?: boolean }
  const sd = (await wq(`select app.step_done('${A}', '${jobA}', 'k-step', '{"x":1}'::jsonb)`)) as {
    ok?: boolean
  }
  const sBack = (await wq(
    `select app.step_begin('${A}', '${jobA}', 'k-step', 1, 'none', 1, 'v1')`,
  )) as { skip?: boolean }
  c.check(
    sb.do === true && sd.ok === true && sBack.skip === true,
    'step_begin / step_done: a step is begun, finished and then skipped on the next ask (the positive control)',
    c.json([sb, sd, sBack]),
  )
  // B really has a step of its own, so "never begun" is not just an empty table
  await wq(`select app.step_begin('${B}', '${jobB}', 'k-step-b', 1, 'none', 1, 'v1')`)
  c.check(
    (await alike(
      (id) => `select app.step_begin('${A}', '${id}', 'k-step', 1, 'none', 1, 'v1')`,
      jobB,
    )) && (await alike((id) => `select app.step_done('${A}', '${id}', 'k-step-b')`, jobB)),
    "step_begin / step_done: B's job (and B's own step) read exactly as a job that does not exist",
    await outcome(`select app.step_done('${A}', '${jobB}', 'k-step-b')`),
  )
  const skillRows = async (office: string, tag: string): Promise<string> => {
    await c.db.execute(
      `insert into public.skills (office_id, scope, name, when_to_use, procedure, authored_by)
       values ('${office}', 'global', ${lit(`k skill ${tag} ${run}`)}, 'when a probe needs a skill', ${lit(`Step one: do the probe thing for ${tag}. Step two: report what it showed, in plain words.`)}, 'k-worker')`,
    )
    return String(
      (
        await one(
          `select skill_id from public.skills where office_id = '${office}' and name = ${lit(`k skill ${tag} ${run}`)}`,
        )
      ).skill_id,
    )
  }
  const skillA = await skillRows(A, 'a')
  const skillB = await skillRows(B, 'b')
  await wq(`select app.skill_used('${A}', '${skillA}', '${jobA}')`)
  const usedA = Number(
    (
      await one(
        `select count(*)::int as n from public.skill_uses where job_id = '${jobA}' and skill_id = '${skillA}'`,
      )
    ).n,
  )
  const foreignSkill = await outcome(`select app.skill_used('${A}', '${skillB}', '${jobA}')`)
  const missingSkill = await outcome(`select app.skill_used('${A}', '${nobody}', '${jobA}')`)
  const foreignSkillJob = await outcome(`select app.skill_used('${A}', '${skillA}', '${jobB}')`)
  const missingSkillJob = await outcome(`select app.skill_used('${A}', '${skillA}', '${nobody}')`)
  c.check(
    usedA === 1 &&
      foreignSkill === missingSkill &&
      foreignSkillJob === missingSkillJob &&
      Number(
        (await one(`select count(*)::int as n from public.skill_uses where skill_id = '${skillB}'`))
          .n,
      ) === 0 &&
      Number(
        (await one(`select count(*)::int as n from public.skill_uses where job_id = '${jobB}'`)).n,
      ) === 0,
    "skill_used: A's own skill is recorded against A's job; B's skill or B's job record nothing, exactly as a missing one",
    `${foreignSkill} / ${missingSkill}`,
  )
  c.check(
    (await derivedSnap(B)) !== dB1 /* B's own k-step-b moved it: the point is the rest did not */ &&
      Number(
        (await one(`select count(*)::int as n from public.job_plans where job_id = '${jobB}'`)).n,
      ) === 0 &&
      Number(
        (await one(`select count(*)::int as n from public.job_traces where job_id = '${jobB}'`)).n,
      ) === 0 &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.job_steps where job_id = '${jobB}' and step = 'k-step'`,
          )
        ).n,
      ) === 0,
    "the five job writers wrote nothing under B's job: no plan, no trace, no step of A's",
    '',
  )
  c.check(
    (await noOffice(
      `select app.job_plan_set(null::uuid, '${jobA}', 'x', array[]::text[], ${steps}, 's', 1)`,
    )) &&
      (await noOffice(`select app.step_begin('${nobody}', '${jobA}', 's', 1, 'none', 1, 'v')`)) &&
      (await noOffice(`select app.step_done(null::uuid, '${jobA}', 's')`)) &&
      (await noOffice(`select app.job_trace_add('${nobody}', '${jobA}', 'note')`)) &&
      (await noOffice(`select app.skill_used(null::uuid, '${skillA}', '${jobA}')`)),
    'the five job writers: a null office and a nonexistent office are no_office',
    '',
  )
  c.check(
    (await sealed('app.job_plan_set(uuid,uuid,text,text[],jsonb,text,integer)')) &&
      (await sealed('app.step_begin(uuid,uuid,text,integer,text,integer,text)')) &&
      (await sealed('app.step_done(uuid,uuid,text,jsonb,text)')) &&
      (await sealed('app.job_trace_add(uuid,uuid,text,jsonb,integer,integer,numeric,integer)')) &&
      (await sealed('app.skill_used(uuid,uuid,uuid)')),
    'the five job writers: no browser role can execute them',
    '',
  )

  // ======================================================================================================================
  // A. the decisions about reach: approve_tool, decline_tool, revoke_tool, withdraw_tool_request
  // ======================================================================================================================
  const actorA = String((await one(`select app.office_actor('${A}') as a`)).a)
  const staffSlug = String(
    (await one(`select slug from public.staff where active order by slug limit 1`)).slug,
  )
  const unheld = await q(
    `select t.tool from public.tool_permissions t
      where t.enabled and not exists (select 1 from public.staff_tools x where x.staff_slug = '${staffSlug}' and x.tool = t.tool)
      order by t.tool limit 4`,
  )
  const tools = unheld.map((r) => String(r.tool))
  const toolWanted = `kw.wanted_${run}`
  const request = async (office: string, tool: string): Promise<string> => {
    await c.db.execute(
      `insert into public.tool_requests (office_id, tool, asked_by, what_for) values ('${office}', ${lit(tool)}, '${staffSlug}', ${lit(`k request ${run} ${tool}`)})`,
    )
    return String(
      (
        await one(
          `select request_id from public.tool_requests where office_id = '${office}' and tool = ${lit(tool)} and state = 'open'`,
        )
      ).request_id,
    )
  }
  c.check(
    tools.length >= 3,
    'the tool decisions have unheld (staff, tool) pairs to work with',
    String(tools.length),
  )
  const reqB = await request(B, tools[0] as string)
  const reqA = await request(A, tools[1] as string)
  const reqAwanted = await request(A, toolWanted)
  const decB = await request(B, tools[2] as string)
  const toolSnapB = await c.snapshot(B, ['tool_requests', 'events'])
  c.check(
    await alike((id) => `select app.approve_tool('${A}', '${id}', ${lit(actorA)}, null)`, reqB),
    "approve_tool: B's request and a nonexistent request give the same answer",
    await outcome(`select app.approve_tool('${A}', '${reqB}', ${lit(actorA)}, null)`),
  )
  c.check(
    await alike(
      (id) =>
        `select app.decline_tool('${A}', '${id}', ${lit(actorA)}, 'not one that should be granted')`,
      decB,
    ),
    "decline_tool: B's request and a nonexistent request give the same answer",
    await outcome(
      `select app.decline_tool('${A}', '${decB}', ${lit(actorA)}, 'not one that should be granted')`,
    ),
  )
  c.check(
    await alike((id) => `select app.withdraw_tool_request('${A}', '${id}', ${lit(actorA)})`, reqB),
    "withdraw_tool_request: B's request and a nonexistent request give the same answer",
    await outcome(`select app.withdraw_tool_request('${A}', '${reqB}', ${lit(actorA)})`),
  )
  // B holds a tool; A's revoke of it reads as a revoke of something nobody holds
  await c.db.execute(
    `insert into public.staff_tools (office_id, staff_slug, tool, granted_by) values ('${B}', '${staffSlug}', ${lit(tools[3] as string)}, 'k-worker')`,
  )
  const revokeForeign = await outcome(
    `select app.revoke_tool('${A}', '${staffSlug}', ${lit(tools[3] as string)}, ${lit(actorA)})`,
  )
  const revokeMissing = await outcome(
    `select app.revoke_tool('${A}', 'chief-of-staff', ${lit(tools[3] as string)}, ${lit(actorA)})`,
  )
  c.check(
    revokeForeign.includes('does not hold') &&
      revokeMissing.includes('does not hold') &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.staff_tools where office_id = '${B}' and tool = ${lit(tools[3] as string)}`,
          )
        ).n,
      ) === 1,
    'revoke_tool: a tool B holds reads as a tool A does not hold, and B still holds it',
    revokeForeign,
  )
  c.check(
    (await c.snapshot(B, ['tool_requests', 'events'])) === toolSnapB,
    "none of those decisions changed B's requests or B's ledger",
    '',
  )
  const wrongActor = await outcome(
    `select app.approve_tool('${A}', '${reqA}', 'someone-else', null)`,
  )
  c.check(
    wrongActor.includes('only the person this office belongs to') &&
      (await alike((id) => `select app.approve_tool('${A}', '${id}', 'someone-else', null)`, reqB)),
    "approve_tool: only the office's own person decides, and a stranger is told the same thing about any request",
    wrongActor,
  )
  const approved = (await wq(
    `select app.approve_tool('${A}', '${reqA}', ${lit(actorA)}, null)`,
  )) as {
    approved?: boolean
    granted?: boolean
  }
  const wanted = (await wq(
    `select app.approve_tool('${A}', '${reqAwanted}', ${lit(actorA)}, null)`,
  )) as {
    needs_building?: boolean
  }
  const granted = await one(
    `select office_id::text as o from public.staff_tools where staff_slug = '${staffSlug}' and tool = ${lit(tools[1] as string)}`,
  )
  const ledger = await one(
    `select count(*)::int as n, count(distinct office_id)::int as offices, min(office_id::text) as o from public.events where action_type in ('tool.granted', 'tool.wanted') and (after_state ->> 'request_id') in ('${reqA}', '${reqAwanted}')`,
  )
  c.check(
    approved.approved === true &&
      approved.granted === true &&
      wanted.needs_building === true &&
      granted.o === A &&
      Number(ledger.n) === 2 &&
      ledger.o === A &&
      Number(ledger.offices) === 1,
    "approve_tool: A's own request is granted in A's office and the ledger entries are A's (the positive control)",
    c.json([approved, wanted, granted, ledger]),
  )
  const declined = (await wq(
    `select app.decline_tool('${A}', '${await request(A, `kw.decline_${run}`)}', ${lit(actorA)}, 'a reason that is long enough')`,
  )) as { declined?: boolean }
  const thinDecline = await outcome(
    `select app.decline_tool('${A}', '${decB}', ${lit(actorA)}, 'no')`,
  )
  const revoked = (await wq(
    `select app.revoke_tool('${A}', '${staffSlug}', ${lit(tools[1] as string)}, ${lit(actorA)})`,
  )) as { revoked?: string }
  const withdrawn = (await wq(
    `select app.withdraw_tool_request('${A}', '${await request(A, `kw.withdraw_${run}`)}', ${lit(actorA)})`,
  )) as { withdrawn?: string }
  c.check(
    declined.declined === true &&
      thinDecline.includes('needs a reason') &&
      revoked.revoked === tools[1] &&
      withdrawn.withdrawn !== undefined &&
      (await one(`select state from public.tool_requests where request_id = '${decB}'`)).state ===
        'open',
    "decline_tool, revoke_tool, withdraw_tool_request: each works on A's own, a decline still needs a reason, and B's open request stayed open",
    c.json([declined, revoked, withdrawn]),
  )
  c.check(
    (await noOffice(`select app.approve_tool(null::uuid, '${reqA}', 'x', null)`)) &&
      (await noOffice(
        `select app.decline_tool('${nobody}', '${reqA}', 'x', 'a reason long enough')`,
      )) &&
      (await noOffice(`select app.revoke_tool(null::uuid, 'chief-of-staff', 'x', 'x')`)) &&
      (await noOffice(`select app.withdraw_tool_request('${nobody}', '${reqA}', 'x')`)),
    'the four tool decisions: a null office and a nonexistent office are no_office',
    '',
  )
  c.check(
    (await sealed('app.approve_tool(uuid,uuid,text,jsonb)')) &&
      (await sealed('app.decline_tool(uuid,uuid,text,text)')) &&
      (await sealed('app.revoke_tool(uuid,text,text,text)')) &&
      (await sealed('app.withdraw_tool_request(uuid,uuid,text)')),
    'the four tool decisions: no browser role can execute them',
    '',
  )
  const oldTools = await one(
    `select to_regprocedure('app.approve_tool(uuid,text,jsonb)') is null as a,
            to_regprocedure('app.decline_tool(uuid,text,text)') is null as d,
            to_regprocedure('app.revoke_tool(text,text,text)') is null as r,
            to_regprocedure('app.withdraw_tool_request(uuid,text)') is null as w`,
  )
  c.check(
    oldTools.a === true && oldTools.d === true && oldTools.r === true && oldTools.w === true,
    'the one-argument-fewer decisions about reach no longer exist (a second overload would be a legacy door)',
    c.json(oldTools),
  )

  // ======================================================================================================================
  // A. the resolvers that took a bare id: command_account, command_principal, approval_for_delivery, request_undo, hq_appearance
  // ======================================================================================================================
  const acct = `${String(7 + Number.parseInt(run.replace(/[^0-9]/g, '0') || '1', 10))}00${String(n)}`
  const cmdA = await command(A, pa, 'tg-a', {
    channel: 'telegram',
    key: `telegram:message:${acct}:k-${run}-a`,
    subject: `k-person-a-${run}`,
  })
  const cmdB = await command(B, pb, 'tg-b', {
    channel: 'telegram',
    key: `telegram:message:${acct}9:k-${run}-b`,
    subject: `k-person-b-${run}`,
  })
  const acctA = await wq(`select app.command_account('${A}', '${cmdA}')`)
  c.check(
    acctA === acct &&
      (await alike((id) => `select app.command_account('${A}', '${id}')`, cmdB)) &&
      (await outcome(`select app.command_account('${A}', '${cmdB}')`)).includes('"value":null'),
    "command_account: A's command gives A's bot account; B's command and a nonexistent command both give nothing",
    String(acctA),
  )
  const whoA = await wq(`select app.command_principal('${A}', '${cmdA}')`)
  c.check(
    whoA === `k-person-a-${run}` &&
      (await alike((id) => `select app.command_principal('${A}', '${id}')`, cmdB)) &&
      (await outcome(`select app.command_principal('${A}', '${cmdB}')`)).includes('"value":null'),
    "command_principal: A's command names A's person; B's command and a nonexistent command both give nothing",
    String(whoA),
  )
  c.check(
    (await noOffice(`select app.command_account(null::uuid, '${cmdA}')`)) &&
      (await noOffice(`select app.command_principal('${nobody}', '${cmdA}')`)) &&
      (await sealed('app.command_account(uuid,uuid)')) &&
      (await sealed('app.command_principal(uuid,uuid)')),
    'command_account / command_principal: a null or unknown office is no_office, and no browser role can execute them',
    '',
  )
  // approval_for_delivery: a delivery bound to its question
  const ask = async (office: string, j: string): Promise<string> =>
    String(
      await wq(
        `select app.request_approval('${office}', '${j}', 'k bind probe ${run}', 'the question this message asks', 'office.execute_plan')`,
      ),
    )
  const askA = await ask(A, jobA)
  const askB = await ask(B, jobB)
  const delivery = async (
    office: string,
    j: string,
    blocker: string,
    tag: string,
  ): Promise<string> => {
    n += 1
    await c.db.execute(
      `insert into public.deliveries (office_id, channel, dedupe_key, account_ref, target_ref, purpose, job_id, state, blocker_id, lease_expires_at, sent_at, message_ref)
       values ('${office}', 'telegram', ${lit(`k-${run}-${tag}-${String(n)}`)}, 'k', ${lit(String(900000 + n))}, 'blocker', '${j}', 'sent', '${blocker}', app.now_utc() + interval '1 hour', app.now_utc(), ${lit(String(n))})`,
    )
    return String(
      (
        await one(
          `select delivery_id from public.deliveries where dedupe_key = ${lit(`k-${run}-${tag}-${String(n)}`)}`,
        )
      ).delivery_id,
    )
  }
  const dA = await delivery(A, jobA, askA, 'da')
  const dB = await delivery(B, jobB, askB, 'db')
  c.check(
    (await wq(`select app.approval_for_delivery('${A}', '${dA}')`)) === askA &&
      (await alike((id) => `select app.approval_for_delivery('${A}', '${id}')`, dB)) &&
      (await outcome(`select app.approval_for_delivery('${A}', '${dB}')`)).includes('"value":null'),
    "approval_for_delivery: A's message names A's question; B's message and a nonexistent one name nothing",
    '',
  )
  c.check(
    (await noOffice(`select app.approval_for_delivery(null::uuid, '${dA}')`)) &&
      (await sealed('app.approval_for_delivery(uuid,uuid)')),
    'approval_for_delivery: a null office is no_office, and no browser role can execute it',
    '',
  )
  // undo: an action is claimed for its own office only
  const action = async (office: string, tag: string): Promise<string> => {
    n += 1
    await c.db.execute(
      `insert into public.undoable_actions (office_id, correlation_id, kind, description, reversal, undo_deadline)
       values ('${office}', gen_random_uuid(), 'k.probe', ${lit(`k undo ${tag} ${run} ${String(n)}`)}, '{"action":"noop"}'::jsonb, app.now_utc() + interval '1 hour')`,
    )
    return String(
      (
        await one(
          `select action_id from public.undoable_actions where description = ${lit(`k undo ${tag} ${run} ${String(n)}`)}`,
        )
      ).action_id,
    )
  }
  const actA = await action(A, 'a')
  const actB = await action(B, 'b')
  const undoSnapB = await c.snapshot(B, ['undoable_actions'])
  const undoReqB = Number(
    (await one(`select count(*)::int as n from public.undo_requests where action_id = '${actB}'`))
      .n,
  )
  c.check(
    (await alike((id) => `select app.request_undo('${A}', '${id}', ${lit(actorA)}, 'k')`, actB)) &&
      (await outcome(`select app.request_undo('${A}', '${actB}', ${lit(actorA)}, 'k')`)).includes(
        'no undoable action',
      ) &&
      (await c.snapshot(B, ['undoable_actions'])) === undoSnapB &&
      Number(
        (
          await one(
            `select count(*)::int as n from public.undo_requests where action_id = '${actB}'`,
          )
        ).n,
      ) === undoReqB,
    "request_undo: B's action and a nonexistent action are refused with the same sentence, and B's action is not claimed",
    await outcome(`select app.request_undo('${A}', '${actB}', ${lit(actorA)}, 'k')`),
  )
  c.check(
    (await wq(`select app.request_undo('${A}', '${actA}', ${lit(actorA)}, 'k')`)) === 'undone' &&
      (
        await one(
          `select status::text as s from public.undoable_actions where action_id = '${actA}'`,
        )
      ).s === 'undone' &&
      (await noOffice(`select app.request_undo(null::uuid, '${actA}', 'x')`)) &&
      (await sealed('app.request_undo(uuid,uuid,text,text)')) &&
      (await sealed('app.claim_undo(uuid,uuid,text,text)')),
    "request_undo: A's own action is claimed and undone (the positive control); a null office is no_office; no browser role can execute it",
    '',
  )
  // hq_appearance: read by office
  await c.db.execute(
    `insert into public.appearance_settings (owner, settings, office_id) values (${lit(`k-owner-a-${run}`)}, ${lit(JSON.stringify({ look: c.canary.A }))}::jsonb, '${A}'),
                                                                                (${lit(`k-owner-b-${run}`)}, ${lit(JSON.stringify({ look: c.canary.B }))}::jsonb, '${B}')`,
  )
  const lookA = await wq(`select app.hq_appearance('${A}')`)
  c.check(
    c.json(lookA).includes(c.canary.A) &&
      !c.json(lookA).includes(c.canary.B) &&
      (await noOffice(`select app.hq_appearance(null::uuid)`)) &&
      (await sealed('app.hq_appearance(uuid)')),
    "hq_appearance: A reads A's appearance and never B's, a null office is no_office, and no browser role can execute it",
    c.json(lookA).slice(0, 60),
  )

  c.check(
    (await bridge()) === bridge0,
    'none of the converted writers leaned on the compatibility bridge: the meter did not move',
    `${String(bridge0)} -> ${String(await bridge())}`,
  )

  // the remaining sections are in the second half of this file
  await jobBound(c, {
    A,
    B,
    W,
    run,
    nobody,
    one,
    q,
    wq,
    sealed,
    outcome,
    alike,
    job,
    command,
    stateOf,
    derivedSnap,
    pa,
    pb,
    jobA,
    jobB,
    ask,
    actorA,
  })
}

type Env = {
  A: string
  B: string
  W: string
  run: string
  nobody: string
  one: (sql: string) => Promise<Record<string, unknown>>
  q: (sql: string) => Promise<Record<string, unknown>[]>
  wq: (sql: string) => Promise<unknown>
  sealed: (sig: string) => Promise<boolean>
  outcome: (sql: string) => Promise<string>
  alike: (mk: (id: string) => string, foreign: string) => Promise<boolean>
  job: (
    office: string,
    project: string | null,
    tag: string,
    extra?: {
      state?: string
      kind?: string
      parent?: string
      pinned?: Record<string, unknown>
      requestedBy?: string
      key?: string
      cols?: Record<string, string>
    },
  ) => Promise<string>
  command: (
    office: string,
    project: string,
    tag: string,
    opts?: { channel?: string; key?: string; context?: Record<string, unknown>; subject?: string },
  ) => Promise<string>
  stateOf: (id: string) => Promise<string>
  derivedSnap: (office: string) => Promise<string>
  pa: string
  pb: string
  jobA: string
  jobB: string
  ask: (office: string, j: string) => Promise<string>
  actorA: string
}

// ==========================================================================================================================
// B. JOB-BOUND, then C. DEPLOYMENT SCANS, then D. RESOLVERS
// ==========================================================================================================================
async function jobBound(c: Ctx, e: Env): Promise<void> {
  const {
    A,
    B,
    W,
    run,
    nobody,
    one,
    q,
    wq,
    sealed,
    outcome,
    job,
    command,
    stateOf,
    pa,
    pb,
    jobA,
    jobB,
  } = e
  const gone = (s: string): boolean => s.includes('"value":null') || s.includes('"value":false')
  // a person's job: not a fixture, not harness traffic, so the origin and delivery rules read it as an ordinary turn
  const REAL = `teamhq:k-person-${run}`
  const cmdB = await command(B, pb, 'ob', { context: { forwarded: true } })
  const cmdA = await command(A, pa, 'oa', { context: { forwarded: true } })

  // ---- job_depth ---------------------------------------------------------------------------------------------------------
  const d1 = await job(A, pa, 'd1', { parent: jobA })
  const d2 = await job(A, pa, 'd2', { parent: d1 })
  c.check(
    (await sealed('app.job_depth(uuid)')) &&
      (await wq(`select app.job_depth('${d2}')`)) === 2 &&
      (await wq(`select app.job_depth('${jobA}')`)) === 0 &&
      (await wq(`select app.job_depth('${nobody}')`)) === 0,
    'k-proof: app.job_depth is job-bound: service-only, the depth of the held job, and a job that does not exist is depth 0',
    '',
  )

  // ---- job_origin, job_forwarded, owed_a_word: the command a job points at is DATA ----------------------------------------------
  const ownF = await job(A, pa, 'of-own', {
    state: 'failed',
    requestedBy: REAL,
    pinned: { command_id: cmdA },
  })
  const forF = await job(A, pa, 'of-for', {
    state: 'failed',
    requestedBy: REAL,
    pinned: { command_id: cmdB },
  })
  const misF = await job(A, pa, 'of-mis', {
    state: 'failed',
    requestedBy: REAL,
    pinned: { command_id: nobody },
  })
  const owed = async (id: string): Promise<string> =>
    norm(
      c.json(
        await wq(
          `select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) from app.owed_a_word('${id}') o`,
        ),
      ),
    )
  const [owedOwn, owedFor, owedMis] = [await owed(ownF), await owed(forF), await owed(misF)]
  c.check(
    (await sealed('app.owed_a_word(uuid)')) &&
      owedOwn.includes('teamhq') &&
      owedFor === owedMis &&
      owedFor === '[]' &&
      (await owed(nobody)) === '[]',
    "k-proof: app.owed_a_word is job-bound: a command of B's that A's job points at is owed nothing, exactly as a command that does not exist",
    `${owedOwn.slice(0, 60)} | ${owedFor}`,
  )
  const originFor = await outcome(`select app.job_origin('${forF}')`)
  const originMis = await outcome(`select app.job_origin('${misF}')`)
  c.check(
    (await sealed('app.job_origin(uuid)')) &&
      originFor === originMis &&
      (await outcome(`select app.job_origin('${nobody}')`)).includes('unknown'),
    "k-proof: app.job_origin is job-bound: a pinned command of B's reads as no command, exactly as a missing one, and a missing job is unknown",
    originFor,
  )
  // the origin trigger finds the command an inbound key names by id alone (reported, not part of this cluster), so a job of A
  // CAN be stamped with B's forwarded command; the reader must not count it
  const subj = `teamhq:k-person-${run}`
  const fwdOwnJob = await job(A, pa, 'fwd-own', { requestedBy: subj, key: `inbound-${cmdA}` })
  const fwdForeignJob = await job(A, pa, 'fwd-foreign', {
    requestedBy: subj,
    key: `inbound-${cmdB}`,
  })
  const fwdNoneJob = await job(A, pa, 'fwd-none', { requestedBy: REAL })
  const stampedForeign = await one(
    `select origin_command_id::text as c, origin_class from public.jobs where job_id = '${fwdForeignJob}'`,
  )
  c.check(
    stampedForeign.c === null && stampedForeign.origin_class === 'unknown',
    "the origin trigger does not stamp a job of A with B's command: an inbound key naming a command of another office is an inbound turn the office cannot find, and unknown",
    c.json(stampedForeign),
  )
  const fwdOwn = await wq(`select app.job_forwarded('${fwdOwnJob}')`)
  const fwdForeign = await wq(`select app.job_forwarded('${fwdForeignJob}')`)
  const fwdNone = await wq(`select app.job_forwarded('${fwdNoneJob}')`)
  c.check(
    (await sealed('app.job_forwarded(uuid)')) &&
      fwdOwn === true &&
      fwdForeign === false &&
      fwdNone === false &&
      gone(await outcome(`select app.job_forwarded('${nobody}')`)),
    "k-proof: app.job_forwarded is job-bound: only the job's own office's command can be what it was forwarded from, B's reads as none, and a missing job is not forwarded",
    c.json([fwdOwn, fwdForeign, fwdNone]),
  )

  // ---- stop_requested ----------------------------------------------------------------------------------------------------
  const stopped = await job(A, pa, 'stop', {
    state: 'running',
    cols: { stop_requested_at: 'app.now_utc()' },
  })
  c.check(
    (await sealed('app.stop_requested(uuid)')) &&
      (await wq(`select app.stop_requested('${stopped}')`)) === true &&
      (await wq(`select app.stop_requested('${jobA}')`)) === false &&
      (await wq(`select app.stop_requested('${nobody}')`)) === false,
    'k-proof: app.stop_requested is job-bound: true for the held job that was asked to stop, false for one that was not and for one that does not exist',
    '',
  )

  // ---- open_approval_for_job ---------------------------------------------------------------------------------------------
  const asked = await e.ask(A, jobA)
  const lone = await job(A, pa, 'noask', { state: 'running' })
  const askedB = await e.ask(B, jobB)
  c.check(
    (await sealed('app.open_approval_for_job(uuid)')) &&
      (await wq(`select app.open_approval_for_job('${jobA}')`)) === asked &&
      (await wq(`select app.open_approval_for_job('${lone}')`)) === null &&
      (await wq(`select app.open_approval_for_job('${nobody}')`)) === null &&
      (await wq(`select app.open_approval_for_job('${jobA}')`)) !== askedB,
    "k-proof: app.open_approval_for_job is job-bound: the held job's own open question, nothing for a job with none or none at all, never B's",
    '',
  )

  // ---- job_plan ----------------------------------------------------------------------------------------------------------
  const planJob = await job(A, pa, 'plan', { state: 'running' })
  await wq(
    `select app.job_plan_set('${A}', '${planJob}', 'notion.write', array['notion'], '[{"verb":"create","what":"a page","where":"notion","writes":1}]'::jsonb, ${lit(`plan ${c.canary.A}`)}, 1)`,
  )
  const planRead = c.json(await wq(`select app.job_plan('${planJob}')`))
  c.check(
    (await sealed('app.job_plan(uuid)')) &&
      planRead.includes(c.canary.A) &&
      !planRead.includes(c.canary.B) &&
      c.json(await wq(`select app.job_plan('${nobody}')`)).includes('"none":true'),
    "k-proof: app.job_plan is job-bound: the held job's own plan, and a job that does not exist has none",
    planRead.slice(0, 60),
  )

  // ---- cannot, understood ------------------------------------------------------------------------------------------------
  const dB0 = await e.derivedSnap(B)
  const can = (await wq(
    `select app.cannot('${jobA}', 'not_capable', ${lit(`a probe thing ${run}`)}, 'k-worker', 'detail')`,
  )) as { impediment_id?: string }
  const canRow = await one(
    `select project_id::text as p, (select office_id::text from public.jobs where job_id = '${jobA}') as o from public.job_impediments where impediment_id = '${can.impediment_id ?? nobody}'`,
  )
  c.check(
    (await sealed('app.cannot(uuid,impediment_kind,text,text,text,text)')) &&
      can.impediment_id !== undefined &&
      canRow.p === pa &&
      (await outcome(`select app.cannot('${nobody}', 'not_capable', 'x', 'k-worker')`)).includes(
        'no such job',
      ) &&
      (await e.derivedSnap(B)) === dB0,
    "k-proof: app.cannot is job-bound: it records under the held job's own project, a job that does not exist is 'no such job', and B's rows do not move",
    c.json(canRow),
  )
  const uj = await job(A, pa, 'understood', { state: 'running' })
  const u1 = c.json(await wq(`select app.understood('${uj}', 'You want the probe to run.')`))
  const u2 = c.json(await wq(`select app.understood('${uj}', 'You want something else entirely.')`))
  c.check(
    (await sealed('app.understood(uuid,text)')) &&
      u1.includes('"ok":true') &&
      u2.includes('"already"') &&
      (await outcome(`select app.understood('${nobody}', 'You want the probe to run.')`)).includes(
        'no such job',
      ),
    "k-proof: app.understood is job-bound: the held job's own restatement is stored once, a job that does not exist is 'no such job'",
    u2.slice(0, 60),
  )

  // ---- staff_behind_job: a duty is found by slug, and slugs repeat across offices ---------------------------------------------
  const staffs = await q(
    `select staff_id::text as id, slug from public.staff where active order by slug limit 2`,
  )
  const dutyB = `k-duty-b-${run}`
  const dutyA = `k-duty-a-${run}`
  const duty = async (office: string, slug: string, staffId: string): Promise<void> => {
    await c.db.execute(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled)
       values ('${office}', ${lit(slug)}, '${staffId}', 'a probe duty that exists only to be found by its slug', 'probe', 60, false)`,
    )
  }
  await duty(B, dutyB, String(staffs[0]?.id))
  await duty(A, dutyA, String(staffs[1]?.id))
  const sbA = await job(A, pa, 'duty-a', { requestedBy: `duty:${dutyA}` })
  const sbForeign = await job(A, pa, 'duty-foreign', { requestedBy: `duty:${dutyB}` })
  const sbB = await job(B, pb, 'duty-b', { requestedBy: `duty:${dutyB}` })
  c.check(
    (await sealed('app.staff_behind_job(uuid)')) &&
      (await wq(`select app.staff_behind_job('${sbA}')`)) === staffs[1]?.slug &&
      (await wq(`select app.staff_behind_job('${sbB}')`)) === staffs[0]?.slug &&
      (await wq(`select app.staff_behind_job('${sbForeign}')`)) === null &&
      (await wq(`select app.staff_behind_job('${nobody}')`)) === null,
    "k-proof: app.staff_behind_job is job-bound: a duty is the job's own office's, so a slug only B has names nobody for A's job, and a missing job names nobody",
    '',
  )

  // ---- approval_binds ----------------------------------------------------------------------------------------------------
  const fp = 'a'.repeat(64)
  const bound = await job(A, pa, 'binds', { state: 'running' })
  await c.db.execute(
    `insert into public.job_pauses (job_id, reason, detail, resume_when, resumable, binds_to) values ('${bound}', 'awaiting_approval', 'a probe approval', 'when answered', false, '${fp}')`,
  )
  c.check(
    (await sealed('app.approval_binds(uuid,text)')) &&
      c
        .json(await wq(`select app.approval_binds('${bound}', '${fp}')`))
        .includes('"matched":true') &&
      c
        .json(await wq(`select app.approval_binds('${bound}', '${'b'.repeat(64)}')`))
        .includes('"approved_anything":true') &&
      c
        .json(await wq(`select app.approval_binds('${nobody}', '${fp}')`))
        .includes('nothing was ever approved') &&
      c.json(await wq(`select app.approval_binds('${lone}', '${fp}')`)) ===
        c.json(await wq(`select app.approval_binds('${nobody}', '${fp}')`)),
    "k-proof: app.approval_binds is job-bound: the held job's own approval matches only the action it bound, and a job with none reads as one that does not exist",
    '',
  )

  // ---- the claim fence: pause_job, resume_job, renew_lease, job_held ---------------------------------------------------------
  const leased = await job(A, pa, 'lease', {
    state: 'running',
    cols: {
      leased_by: "'w-real'",
      leased_until: "app.now_utc() + interval '1 minute'",
      attempt: '1',
      claim_gen: '3',
    },
  })
  const staleGen = await wq(`select app.renew_lease('${leased}', 'w-real', 1, 2)`)
  const staleWorker = await wq(`select app.renew_lease('${leased}', 'w-zombie', 1, 3)`)
  const heldLease = await wq(`select app.renew_lease('${leased}', 'w-real', 1, 3)`)
  const heldNow = await wq(`select app.job_held('${leased}', 'w-real', 1, 3)`)
  const staleHeld = await wq(`select app.job_held('${leased}', 'w-real', 1, 2)`)
  const heldMissing = await wq(`select app.job_held('${nobody}', 'w-real', 1, 3)`)
  c.check(
    (await sealed('app.renew_lease(uuid,text,integer,bigint)')) &&
      (await sealed('app.job_held(uuid,text,integer,bigint)')) &&
      staleGen === false &&
      staleWorker === false &&
      heldLease === true &&
      heldNow === true &&
      staleHeld === false &&
      heldMissing === false &&
      (await wq(`select app.renew_lease('${nobody}', 'w-real', 1, 3)`)) === false,
    'k-proof: app.renew_lease and app.job_held are the claim fence: a stale claim, a stale worker and a missing job hold nothing, the real claim holds',
    c.json([staleGen, staleWorker, heldLease, heldNow, staleHeld, heldMissing]),
  )
  const zombie = await c.refusal(
    W,
    `select app.pause_job('${leased}', 'scheduled_wait', 'k', 'later', true, null, null, null, 'w-zombie', 3)`,
  )
  const paused = c.json(
    await wq(
      `select app.pause_job('${leased}', 'scheduled_wait', 'k', 'later', true, null, null, null, 'w-real', 3)`,
    ),
  )
  const woke = c.json(await wq(`select app.resume_job('${leased}', 'k')`))
  c.check(
    (await sealed(
      'app.pause_job(uuid,text,text,text,boolean,timestamp with time zone,timestamp with time zone,text,text,bigint)',
    )) &&
      zombie.includes('stale caller') &&
      paused.includes('"ok":true') &&
      woke.includes('"ok":true') &&
      (await stateOf(leased)) === 'queued' &&
      (await outcome(`select app.pause_job('${nobody}', 'scheduled_wait', 'k', 'later')`)).includes(
        'no such job',
      ),
    'k-proof: app.pause_job is job-bound: a worker that does not hold the claim cannot park the job, the holder can, and a missing job is no such job',
    zombie.slice(0, 60),
  )
  c.check(
    (await sealed('app.resume_job(uuid,text)')) &&
      woke.includes('"ok":true') &&
      (await outcome(`select app.resume_job('${nobody}', 'k')`)).includes('no such job') &&
      c.json(await wq(`select app.resume_job('${jobA}', 'k')`)).includes('not paused'),
    'k-proof: app.resume_job is job-bound: it wakes a parked job, refuses one that is not parked, and a missing job is no such job',
    woke,
  )

  await scans(c, e)
}

// ==========================================================================================================================
// C. DEPLOYMENT SCANS: each row keeps its own office, and an office that is not active runs nothing
// ==========================================================================================================================
async function scans(c: Ctx, e: Env): Promise<void> {
  const { A, B, W, run, nobody, one, q, sealed, job, command, stateOf, pa, pb } = e
  // The sweeps run as the role the worker connects as (the database owner): several are SECURITY INVOKER and write under the
  // job-transition guard, which the harness's stand-in role has no right to read.
  const wq = async (sql: string): Promise<unknown> => {
    const row = await one(sql)
    return row === undefined ? null : Object.values(row)[0]
  }
  const setOffice = async (office: string, state: 'active' | 'disabled'): Promise<void> => {
    await c.db.execute(
      `update public.offices set state = '${state}', disabled_at = ${state === 'disabled' ? 'app.now_utc()' : 'null'} where office_id = '${office}'`,
    )
  }
  const officeOf = async (id: string): Promise<string> =>
    String((await one(`select office_id::text as o from public.jobs where job_id = '${id}'`)).o)
  const pair = async (
    tag: string,
    extra: Parameters<Env['job']>[3] = {},
  ): Promise<{ a: string; b: string }> => ({
    a: await job(A, pa, `${tag}-a`, extra),
    b: await job(B, pb, `${tag}-b`, extra),
  })

  // ---- the fixtures: one row of each kind in each office -------------------------------------------------------------------
  const ret = await pair('ret', { state: 'retrying', cols: { attempt: '1' } })
  const pau = await pair('pau', {
    state: 'paused',
    kind: 'k.paused',
    cols: { state_reason: "'no handler for kind k.paused'" },
  })
  const sch = await pair('sch', { state: 'paused' })
  for (const j of [sch.a, sch.b])
    await c.db.execute(
      `insert into public.job_pauses (job_id, reason, detail, resume_when, resumable) values ('${j}', 'scheduled_wait', 'a probe wait', 'later', true)`,
    )
  const exh = await pair('exh', {
    state: 'queued',
    cols: { attempt: '5', max_attempts: '5', updated_at: "app.now_utc() - interval '1 hour'" },
  })
  const stl = await pair('stl', {
    state: 'running',
    cols: {
      leased_by: "'w-dead'",
      leased_until: "app.now_utc() - interval '5 minutes'",
      attempt: '1',
    },
  })
  const noti = await pair('noti', { state: 'notifying' })
  const orphanA = await command(A, pa, 'orphan-a')
  const orphanB = await command(B, pb, 'orphan-b')
  // a duty that is due in both offices under ONE slug
  const staffId = String(
    (await one(`select staff_id::text as id from public.staff where active order by slug limit 1`))
      .id,
  )
  const dutySlug = `k-due-${run}`
  for (const office of [A, B])
    await c.db.execute(
      `insert into public.responsibilities (office_id, slug, staff_id, description, job_kind, period_minutes, enabled)
       values ('${office}', ${lit(dutySlug)}, '${staffId}', 'a probe duty that is due at once and fires exactly one job', 'k.duty', 10, true)`,
    )
  // a dead credential in each office raises a chore for that office
  for (const [office, tag] of [
    [A, 'a'],
    [B, 'b'],
  ] as const)
    await c.db.execute(
      `insert into public.connection_health (office_id, service, credential, state, detail, owner, action)
       values ('${office}', ${lit(`ks${tag}${run}`)}, 'token', 'dead', 'refused', 'k-person', 'Reconnect it from Settings')`,
    )
  const chore = async (tag: string): Promise<number> =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.tasks where chore_key = ${lit(`credential:ks${tag}${run}:token`)}`,
        )
      ).n,
    )
  // an active project with something attached and old enough to want a channel
  for (const [office, tag] of [
    [A, 'a'],
    [B, 'b'],
  ] as const)
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id, created_at) values (${lit(`k-prov-${tag}-${run}`)}, ${lit(`K prov ${tag} ${run}`)}, 'active', '${office}', app.now_utc() - interval '2 hours');
       insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
       select project_id, 'upload', ${lit(`k-prov-${tag}-${run}`)}, 'a probe attachment', 'source' from public.projects where office_id = '${office}' and slug = ${lit(`k-prov-${tag}-${run}`)}`,
    )
  // queued work to be claimed, scoped so only these two are candidates
  const SCOPE = `verify:k-dq-${run}`
  const dq = await pair('dq', { state: 'queued', requestedBy: SCOPE })
  const dutyJobs = async (office: string): Promise<number> =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.jobs where office_id = '${office}' and requested_by = ${lit(`duty:${dutySlug}`)}`,
        )
      ).n,
    )
  const claims = async (): Promise<string[]> => {
    const got: string[] = []
    for (let i = 0; i < 80; i += 1) {
      const r = (await wq(
        `select to_jsonb(x) from app.claim_pending_notification('k-notify-${run}', 120) x`,
      )) as { job_id?: string } | null
      if (r === null || r === undefined || r.job_id === undefined) break
      got.push(r.job_id)
    }
    return got
  }
  const listed = async (): Promise<string> => c.json(await wq(`select app.resumable_now()`))

  // ---- B is switched off ---------------------------------------------------------------------------------------------------
  await setOffice(B, 'disabled')
  let off: Record<string, unknown> = {}
  try {
    const dqFirst = (await wq(
      `select to_jsonb(d) from app.dequeue_job('k-worker-${run}', true, true, null, ${lit(SCOPE)}) d`,
    )) as { job_id?: string; office_id?: string } | null
    const dqSecond = await wq(
      `select to_jsonb(d) from app.dequeue_job('k-worker-${run}', true, true, null, ${lit(SCOPE)}) d`,
    )
    off = {
      dqFirst,
      dqSecond,
      requeue: await wq(`select app.requeue_retrying()`),
      resumed: await wq(`select app.resume_paused(array['k.paused'])`),
      listed: await listed(),
      settled: c.json(
        await wq(
          `select coalesce(jsonb_agg(job_id), '[]'::jsonb) from app.settle_exhausted_jobs()`,
        ),
      ),
      recovered: c.json(
        await wq(`select coalesce(jsonb_agg(job_id), '[]'::jsonb) from app.recover_stalled_jobs()`),
      ),
      orphans: await wq(`select app.enqueue_orphans()`),
      provisioned: c.json(await wq(`select app.provision_missing_channels()`)),
      chores: await wq(`select app.chores_for_credentials()`),
      dispatched: c.json(
        await wq(
          `select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from app.dispatch_due_responsibilities() d where d.duty_slug = ${lit(dutySlug)}`,
        ),
      ),
      notified: await claims(),
    }
    c.check(
      dqFirst?.office_id === A &&
        dqFirst?.job_id === dq.a &&
        c.json(dqSecond) === 'null' &&
        (await stateOf(dq.b)) === 'queued',
      "k-proof: app.dequeue_job returns the claimed job whole with its office, and a disabled office's queued job is not claimed",
      c.json([dqFirst?.office_id === A, dqSecond]),
    )
    c.check(
      (await stateOf(ret.b)) === 'retrying' && (await stateOf(ret.a)) === 'queued',
      "k-proof: app.requeue_retrying requeues an active office's retrying job and leaves a switched-off office's where it was",
      '',
    )
    c.check(
      (await stateOf(pau.b)) === 'paused' && (await stateOf(pau.a)) === 'queued',
      "k-proof: app.resume_paused resumes an active office's parked job and leaves a switched-off office's parked",
      '',
    )
    c.check(
      (await stateOf(exh.b)) === 'queued' && (await stateOf(exh.a)) === 'failed',
      "k-proof: app.settle_exhausted_jobs fails an active office's job with no attempts left and leaves a switched-off office's alone",
      '',
    )
    c.check(
      (await stateOf(stl.b)) === 'running' &&
        (await stateOf(stl.a)) === 'retrying' &&
        (await stateOf(noti.b)) === 'notifying',
      "k-proof: app.recover_stalled_jobs recovers an active office's stalled job and leaves a switched-off office's where it was",
      '',
    )
    c.check(
      !String(off.listed).includes(sch.b) && String(off.listed).includes(sch.a),
      'k-proof: app.resumable_now lists the wake-ups of an active office and none of a switched-off one',
      '',
    )
    c.check(
      (
        await one(
          `select job_id::text as j from public.inbound_commands where command_id = '${orphanB}'`,
        )
      ).j === null &&
        (
          await one(
            `select job_id::text as j from public.inbound_commands where command_id = '${orphanA}'`,
          )
        ).j !== null,
      "k-proof: app.enqueue_orphans makes a job for an active office's unanswered message and none for a switched-off office's",
      '',
    )
    c.check(
      !String(off.provisioned).includes(`K prov b ${run}`) &&
        String(off.provisioned).includes(`K prov a ${run}`),
      "k-proof: app.provision_missing_channels wants a channel for an active office's project and none for a switched-off office's",
      String(off.provisioned).slice(0, 80),
    )
    c.check(
      (await chore('a')) === 1 && (await chore('b')) === 0,
      "k-proof: app.chores_for_credentials raises a chore for an active office's dead credential and none for a switched-off office's",
      c.json({ a: await chore('a'), b: await chore('b') }),
    )
    c.check(
      (await dutyJobs(A)) === 1 && (await dutyJobs(B)) === 0,
      "k-proof: app.dispatch_due_responsibilities fires an active office's due duty and none of a switched-off office's",
      '',
    )
    const notifiedOff = off.notified as string[]
    c.check(
      notifiedOff.includes(noti.a) && !notifiedOff.includes(noti.b),
      "k-proof: app.claim_pending_notification claims an active office's finished job and never a switched-off office's",
      '',
    )
  } finally {
    await setOffice(B, 'active')
  }

  // ---- B is switched back on: the same scans now move B's rows, and each keeps its own office -----------------------------------
  const dqThird = (await wq(
    `select to_jsonb(d) from app.dequeue_job('k-worker-${run}', true, true, null, ${lit(SCOPE)}) d`,
  )) as { job_id?: string; office_id?: string } | null
  await wq(`select app.requeue_retrying()`)
  await wq(`select app.resume_paused(array['k.paused'])`)
  const listedOn = await listed()
  await wq(`select app.settle_exhausted_jobs()`)
  await wq(`select app.recover_stalled_jobs()`)
  await wq(`select app.enqueue_orphans()`)
  const provOn = c.json(await wq(`select app.provision_missing_channels()`))
  await wq(`select app.chores_for_credentials()`)
  const dispatchedOn = c.json(
    await wq(
      `select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from app.dispatch_due_responsibilities() d where d.duty_slug = ${lit(dutySlug)}`,
    ),
  )
  const notifiedOn = await claims()
  c.check(
    dqThird?.job_id === dq.b &&
      dqThird?.office_id === B &&
      (await stateOf(ret.b)) === 'queued' &&
      (await stateOf(pau.b)) === 'queued' &&
      (await stateOf(exh.b)) === 'failed' &&
      (await stateOf(stl.b)) === 'retrying' &&
      listedOn.includes(sch.b) &&
      (
        await one(
          `select job_id::text as j from public.inbound_commands where command_id = '${orphanB}'`,
        )
      ).j !== null &&
      provOn.includes(`K prov b ${run}`) &&
      (await chore('b')) === 1 &&
      (await dutyJobs(B)) === 1 &&
      dispatchedOn.includes('fired') &&
      notifiedOn.includes(noti.b),
    "switched back on, the same scans move B's rows too (the controls: the scans above can fire)",
    '',
  )
  const keptOffice =
    (await officeOf(ret.b)) === B &&
    (await officeOf(pau.b)) === B &&
    (await officeOf(exh.b)) === B &&
    (await officeOf(stl.b)) === B &&
    (await officeOf(ret.a)) === A &&
    (await officeOf(stl.a)) === A
  const dutyRow = await one(
    `select office_id::text as o from public.jobs where requested_by = ${lit(`duty:${dutySlug}`)} and office_id = '${B}'`,
  )
  const choreRow = await one(
    `select office_id::text as o from public.tasks where chore_key = ${lit(`credential:ksb${run}:token`)}`,
  )
  c.check(
    keptOffice && dutyRow.o === B && choreRow.o === B,
    "k-proof: the scans keep each row's own office: a recovered job, a duty's job and a credential's chore are the office of the row they came from",
    '',
  )
  // the sweeps as a family: no browser role can run any of them
  const SCANS = [
    'app.dequeue_job(text,boolean,boolean,text[],text)',
    'app.recover_stalled_jobs()',
    'app.recover_stalled_syncs()',
    'app.requeue_retrying()',
    'app.resumable_now()',
    'app.resume_paused(text[])',
    'app.settle_exhausted_jobs()',
    'app.enqueue_orphans()',
    'app.dispatch_due_responsibilities()',
    'app.expire_undo_offers()',
    'app.mcp_expire_codes()',
    'app.provision_missing_channels()',
    'app.proposals_undeliver()',
    'app.chores_for_backups()',
    'app.chores_for_credentials()',
    'app.job_trace_prune(integer,integer)',
    'app.defer_over_budget()',
    'app.claim_pending_notification(text,integer)',
    'app.harness_job(uuid)',
    'app.harness_suggestion(jsonb)',
  ]
  const sealedAll = await Promise.all(SCANS.map((s) => sealed(s)))
  c.check(
    sealedAll.every(Boolean),
    'every deployment scan and classification predicate is closed to anon, authenticated and public',
    SCANS.filter((_, i) => !sealedAll[i]).join(', '),
  )
  const wrappers = [
    'public.dequeue_job(text,boolean,boolean,text[],text)',
    'public.dispatch_due_responsibilities()',
    'public.chores_for_credentials()',
  ]
  const wrapperRoles = await Promise.all(
    wrappers.map(async (w) => ({
      w,
      sealed: await sealed(w),
      service: (await one(`select has_function_privilege('service_role', '${w}', 'execute') as s`))
        .s,
    })),
  )
  c.check(
    wrapperRoles.every((r) => r.sealed && r.service === true),
    'the public wrappers of the scans are service_role only',
    c.json(wrapperRoles),
  )

  // ---- the housekeeping scans: each row keeps its office --------------------------------------------------------------------------
  const action = async (office: string, tag: string): Promise<string> => {
    await c.db.execute(
      `insert into public.undoable_actions (office_id, correlation_id, kind, description, reversal, undo_deadline)
       values ('${office}', gen_random_uuid(), 'k.probe', ${lit(`k lapse ${tag} ${run}`)}, '{"action":"noop"}'::jsonb, app.now_utc() - interval '1 minute')`,
    )
    return String(
      (
        await one(
          `select action_id from public.undoable_actions where description = ${lit(`k lapse ${tag} ${run}`)}`,
        )
      ).action_id,
    )
  }
  const lapseA = await action(A, 'a')
  const lapseB = await action(B, 'b')
  await wq(`select app.expire_undo_offers()`)
  const lapsed = await q(
    `select office_id::text as o, status::text as s from public.undoable_actions where action_id in ('${lapseA}', '${lapseB}') order by description`,
  )
  c.check(
    lapsed.length === 2 &&
      lapsed.every((r) => r.s === 'expired') &&
      lapsed[0]?.o === A &&
      lapsed[1]?.o === B,
    'k-proof: app.expire_undo_offers expires lapsed offers by the clock, in every office, and each keeps its office',
    c.json(lapsed),
  )
  await c.db.execute(
    `insert into public.mcp_oauth_clients (client_id, client_name, redirect_uris) values ('k-client-${run}', 'k client', array['https://k.invalid/cb'])`,
  )
  const code = (office: string, tag: string, old: boolean): string =>
    `insert into public.mcp_auth_codes (code_sha256, client_id, redirect_uri, code_challenge, issued_at, expires_at, office_id)
     values (encode(extensions.digest(${lit(`k-${tag}-${run}`)}, 'sha256'), 'hex'), 'k-client-${run}', 'https://k.invalid/cb', 'x',
             app.now_utc() - interval '${old ? '3 hours' : '1 minute'}', app.now_utc() + interval '${old ? '-2 hours' : '5 minutes'}', '${office}')`
  await c.db.execute(
    `${code(A, 'old-a', true)}; ${code(B, 'old-b', true)}; ${code(A, 'new-a', false)}; ${code(B, 'new-b', false)}`,
  )
  const gone = Number((await wq(`select app.mcp_expire_codes()`)) as number)
  const left = await q(
    `select office_id::text as o from public.mcp_auth_codes where client_id = 'k-client-${run}' order by office_id`,
  )
  c.check(
    gone >= 2 && left.length === 2 && left.some((r) => r.o === A) && left.some((r) => r.o === B),
    "k-proof: app.mcp_expire_codes drops codes long past their expiry in every office and leaves each office's live code",
    String(gone),
  )
  // sync_runs_one_at_a_time is a deployment-wide key (reported), so one run is live at a time: insert, recover, next
  for (const [office, tag] of [
    [A, 'a'],
    [B, 'b'],
  ] as const) {
    await c.db.execute(
      `insert into public.sync_runs (office_id, state, leased_by, leased_until, detail) values ('${office}', 'running', ${lit(`k-${tag}-${run}`)}, app.now_utc() - interval '10 minutes', ${lit(`k sync ${tag} ${run}`)})`,
    )
    await wq(`select app.recover_stalled_syncs()`)
  }
  const synced = await q(
    `select office_id::text as o, state::text as s from public.sync_runs where detail like ${lit(`k sync % ${run}%`)} order by detail`,
  )
  c.check(
    synced.length === 2 &&
      synced.every((r) => r.s === 'abandoned') &&
      synced[0]?.o === A &&
      synced[1]?.o === B,
    'k-proof: app.recover_stalled_syncs abandons a lapsed sync run in every office and each keeps its office',
    c.json(synced),
  )
  const traced = await pair('trace', { state: 'running' })
  for (const j of [traced.a, traced.b])
    await c.db.execute(
      `insert into public.job_traces (job_id, step, at, kind) values ('${j}', 1, app.now_utc() - interval '40 days', 'note'), ('${j}', 2, app.now_utc(), 'note')`,
    )
  await wq(`select app.job_trace_prune(30, 100000)`)
  const kept = await q(
    `select job_id::text as j, step from public.job_traces where job_id in ('${traced.a}', '${traced.b}') order by job_id, step`,
  )
  c.check(
    kept.length === 2 &&
      kept.every((r) => Number(r.step) === 2) &&
      (await officeOf(traced.a)) === A &&
      (await officeOf(traced.b)) === B,
    'k-proof: app.job_trace_prune drops traces past the window in every office (retention is deployment-wide), keeps the recent ones, and moves no job',
    c.json(kept),
  )
  const budgetBefore = await q(
    `select job_id::text as j, office_id::text as o from public.jobs where idempotency_key like ${lit(`k-${run}-%`)} order by job_id`,
  )
  await wq(`select app.defer_over_budget()`)
  const budgetAfter = await q(
    `select job_id::text as j, office_id::text as o from public.jobs where idempotency_key like ${lit(`k-${run}-%`)} order by job_id`,
  )
  c.check(
    c.json(budgetBefore) === c.json(budgetAfter),
    'k-proof: app.defer_over_budget only delays queued work: it moved no job from one office to another',
    '',
  )
  // proposals_undeliver: a mark counts only when the delivering job is the proposal's own office's
  const pj = await pair('prop', { state: 'complete' })
  for (const [office, tag, j] of [
    [A, 'a', pj.a],
    [B, 'b', pj.b],
  ] as const)
    await c.db.execute(
      `insert into public.proposals (office_id, staff_slug, kind, needed, title, remedy, argument, delivered_at, delivered_by_job)
       values ('${office}', 'chief-of-staff', 'not_capable', ${lit(`k proposal ${tag} ${run}`)}, 'a probe', 'do the probe', 'because the probe', app.now_utc(), '${j}')`,
    )
  await wq(`select app.proposals_undeliver()`)
  const restored = await q(
    `select office_id::text as o, delivered_at is null as undelivered from public.proposals where needed like ${lit(`k proposal % ${run}`)} order by needed`,
  )
  c.check(
    restored.length === 2 &&
      restored.every((r) => r.undelivered === true) &&
      restored[0]?.o === A &&
      restored[1]?.o === B,
    "k-proof: app.proposals_undeliver puts a proposal back only through its own office's delivering job, and each keeps its office",
    c.json(restored),
  )
  await wq(`select app.chores_for_backups()`)
  c.check(
    Number(
      (
        await one(
          `select count(*)::int as n from public.tasks where chore_key like 'backup:%' and office_id not in (select app.operator_offices())`,
        )
      ).n,
    ) === 0,
    "k-proof: app.chores_for_backups raises its chore for the operator's office only, never for another person's",
    '',
  )

  // ---- the classification predicates -------------------------------------------------------------------------------------------
  const realJ = await job(A, pa, 'real', { requestedBy: `teamhq:k-person-${run}` })
  const harnessJ = await job(A, pa, 'harness', { requestedBy: 'verify:p3' })
  const realB = await job(B, pb, 'realb', { requestedBy: `teamhq:k-person-${run}` })
  const hj = async (id: string): Promise<unknown> => wq(`select app.harness_job('${id}')`)
  const hs = async (id: string | null): Promise<unknown> =>
    wq(
      `select app.harness_suggestion(${id === null ? "'{}'::jsonb" : `jsonb_build_object('from_job', '${id}')`})`,
    )
  c.check(
    (await hj(realJ)) === false &&
      (await hj(harnessJ)) === true &&
      (await hj(realB)) === (await hj(nobody)) &&
      (await hj(nobody)) === false,
    "k-proof: app.harness_job classifies the job's own row: a person's turn is not harness, a suite's is, and another office's real job reads as a missing one",
    '',
  )
  c.check(
    (await hs(harnessJ)) === true &&
      (await hs(realJ)) === false &&
      (await hs(nobody)) === false &&
      (await hs(null)) === false,
    'k-proof: app.harness_suggestion is harness_job of the job a suggestion came from, and false for a suggestion that names none',
    '',
  )
  // the command a job points at counts only in the job's own office (0853): a HARNESS command of B pinned in A's real job
  const hcmdB = await command(B, pb, 'hcmd', { key: `verify:k_worker:foreign-${run}` })
  const pinnedForeign = await job(A, pa, 'pinned', {
    requestedBy: `teamhq:k-person-${run}`,
    pinned: { command_id: hcmdB },
  })
  const pinnedMissing = await job(A, pa, 'pinnedm', {
    requestedBy: `teamhq:k-person-${run}`,
    pinned: { command_id: nobody },
  })
  c.check(
    (await hj(pinnedForeign)) === false && (await hj(pinnedMissing)) === false,
    "harness_job: a harness command of B pinned in A's real job does not make it harness, exactly as a missing command does not",
    '',
  )

  // ---- D. the resolvers: they take no office, and a browser role cannot ask them anything ---------------------------------------
  const noOfficeParam = async (sig: string): Promise<boolean> =>
    (
      await one(
        `select not coalesce('p_office' = any(proargnames), false) as ok from pg_proc where oid = '${sig}'::regprocedure`,
      )
    ).ok === true
  const jo = String(await wq(`select app.job_office('${jobAOf(e)}')`))
  c.check(
    (await sealed('app.job_office(uuid)')) &&
      (await noOfficeParam('app.job_office(uuid)')) &&
      jo === A &&
      (await c.refusal(W, `select app.job_office('${nobody}')`)).includes('no_office'),
    "k-proof: app.job_office is the resolver: it takes no office, answers the claimed job's own office, and a job that does not exist has no office",
    jo,
  )
  const dOfficeJob = await wq(`select app.delivery_office('${jobAOf(e)}', 'telegram', '1')`)
  const dOfficeNone = await wq(`select app.delivery_office(null, 'telegram', '1')`)
  c.check(
    (await sealed('app.delivery_office(uuid,text,text)')) &&
      (await noOfficeParam('app.delivery_office(uuid,text,text)')) &&
      dOfficeJob === A &&
      typeof dOfficeNone === 'string',
    "k-proof: app.delivery_office is the resolver: it takes no office, a delivery for a job is that job's office, and one for no job is the operator's",
    c.json([dOfficeJob === A, dOfficeNone]),
  )
  const chatReturned = await c.try_(W, `select app.operator_chat('k-bot-${run}')`)
  c.check(
    (await sealed('app.operator_chat(text)')) &&
      (await noOfficeParam('app.operator_chat(text)')) &&
      chatReturned.ok === true &&
      chatReturned.ok &&
      (chatReturned.value === null || typeof chatReturned.value === 'string'),
    "k-proof: app.operator_chat is the resolver: it takes no office and answers only for the operator's office, never another person's chat",
    c.json(chatReturned),
  )
  const refusal = await wq(`select app.principal_refusal('')`)
  const refusalUnknown = await wq(`select app.principal_refusal('nobody-knows-me-${run}')`)
  const refusalKnown = await wq(`select app.principal_refusal(app.office_actor('${c.G}'))`)
  c.check(
    (await sealed('app.principal_refusal(text)')) &&
      (await noOfficeParam('app.principal_refusal(text)')) &&
      typeof refusal === 'string' &&
      typeof refusalUnknown === 'string' &&
      refusalKnown === null,
    'k-proof: app.principal_refusal is the resolver: it takes a name and no office, refuses an empty or unknown one with a fixed sentence and says nothing for a person the office knows',
    c.json([refusal, refusalUnknown, refusalKnown]),
  )
}

/** The job the resolver cases ask about: the one running job of A that the first half of this file made. */
const jobAOf = (e: Env): string => e.jobA
