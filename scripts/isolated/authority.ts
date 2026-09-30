/**
 * Run 2: an effect is authorised once, an ask is bound to the exact action, and a No is remembered.
 *
 *   npx tsx scripts/isolated/authority.ts <replica-db>
 *
 * The REAL `mayAct` (-> `app.authorize_effect`), `governOutward`, `compile`, the blocker functions and the
 * to-do trigger, against an isolated replica carrying migration 0611. Each property has its NEGATIVE
 * control (a grant that exists, an action that differs, a window that has passed, a principal that is known)
 * so a boundary that refuses everything cannot pass. Effects are read from canonical state.
 */

import { readFileSync } from 'node:fs'
import { governOutward, mayAct } from '../../src/agents/approval.ts'
import { compile } from '../../src/agents/perform.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
import { fingerprint, pauseJob } from '../../src/jobs/checkpoint.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'authority')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>
const project = async (label: string, dial = 'suggest'): Promise<string> => {
  const id = String(
    json(
      (
        await one(`select app.hq_create_project(${lit(`Authority ${label} ${run}`)}, 'upload', ${lit(`authority-${label}-${run}`)},
          ${lit(`Authority ${label} ${run}`)}, true) as v`)
      ).v,
    ).project_id,
  )
  await db.execute(
    `insert into public.autonomy_settings (project_id, level, set_by, reason) values (${lit(id)}::uuid, ${lit(dial)}, 'grant', 'authority proof')`,
  )
  return id
}
const job = async (p: string, by: string, kind = 'office.instruction'): Promise<string> =>
  String(
    (
      await one(`insert into public.jobs (kind, requested_by, project_id, idempotency_key, correlation_id)
        values (${lit(kind)}, ${lit(by)}, ${lit(p)}::uuid, 'au-' || gen_random_uuid(), gen_random_uuid())
        returning job_id::text as id`)
    ).id,
  )
const OPTS = ['Yes, do it', 'No, leave it']
/** A question about one exact action, as a plan step raises it. */
const ask = async (p: string, j: string, fp: string, tool = 'notion.write') =>
  String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay,
          approval_options, originating_agent, work_can_continue, action_fingerprint, decline_option)
        values (${lit(p)}::uuid, ${lit(j)}::uuid, ${lit(`Do the thing for ${tool}`)}, 'authority proof',
          'Nothing happens until somebody answers this question.', array[${OPTS.map(lit).join(',')}],
          'chief-of-staff', true, ${lit(fp)}, 'No, leave it') returning blocker_id::text as id`)
    ).id,
  )
const answer = async (b: string, a: string, by = 'grant') =>
  json(
    (await one(`select app.hq_answer_blocker(${lit(b)}::uuid, ${lit(a)}, ${lit(by)})::text as r`))
      .r,
  )

// ---- 1. a specialist's grant is a runtime input ----------------------------
{
  const p = await project('staff', 'act')
  const [holder, bare] = (
    await db.execute(`select slug from public.staff order by slug limit 2`)
  ).rows.map((r) => String((r as { slug: string }).slug))
  await db.execute(
    `insert into public.staff_tools (staff_slug, tool) values (${lit(String(holder))}, 'task.create') on conflict do nothing`,
  )
  await db.execute(
    `delete from public.staff_tools where staff_slug = ${lit(String(bare))} and tool = 'task.create'`,
  )
  const yes = await mayAct(db as never, { projectId: p, tool: 'task.create', staff: holder })
  const no = await mayAct(db as never, { projectId: p, tool: 'task.create', staff: bare })
  const nobody = await mayAct(db as never, { projectId: p, tool: 'task.create' })
  check('a specialist who holds the tool may (control)', yes.verdict === 'proceed', yes.verdict)
  check(
    'a specialist who does NOT hold it is refused, and the sentence names them',
    no.verdict === 'refuse' &&
      no.reason === 'specialist_not_granted' &&
      no.because.includes(String(bare)),
    `${no.verdict} - ${no.because.slice(0, 70)}`,
  )
  check(
    'no specialist named is the office acting as itself, unchanged',
    nobody.verdict === 'proceed',
    nobody.verdict,
  )
  const off = await mayAct(db as never, { projectId: p, tool: 'gmail.send', staff: holder })
  check(
    'a grant cannot lift a tool the registry has switched off',
    off.verdict === 'refuse',
    off.verdict,
  )
}

// ---- 2. an outside audience never proceeds on its own ----------------------
{
  const p = await project('outside', 'act')
  const person = await job(p, 'telegram:grant-out')
  await db.execute(
    `select app.grant_standing('slack.post', ${lit(p)}::uuid, 'authority proof', 'grant', null)`,
  )
  const inside = await mayAct(db as never, { projectId: p, tool: 'slack.post', audience: 'office' })
  const out = await mayAct(db as never, {
    projectId: p,
    tool: 'slack.post',
    audience: 'outside',
    jobAskedFor: person,
  })
  check(
    'control: the same tool for the office at act proceeds',
    inside.verdict === 'proceed',
    inside.verdict,
  )
  check(
    'an outside audience asks even at act, with a standing row and a person having asked',
    out.verdict === 'ask' && out.reason === 'outside_audience',
    `${out.verdict}/${String(out.reason)}`,
  )
  const j = await job(p, 'telegram:grant-out2')
  const fp = await fingerprint({ tool: 'slack.post', to: 'the supplier', text: run })
  const b = await ask(p, j, fp, 'slack.post')
  await answer(b, 'Yes, do it')
  const said = await mayAct(db as never, {
    projectId: p,
    tool: 'slack.post',
    audience: 'outside',
    fingerprint: fp,
    job: j,
  })
  check(
    'and his yes to exactly that message proceeds',
    said.verdict === 'proceed' && said.approved,
    said.verdict,
  )
}

// ---- 3. an approval binds the exact action ---------------------------------
{
  const p = await project('exact')
  const j = await job(p, 'telegram:grant-exact')
  const fp1 = await fingerprint({ step: 's1', why: `file ${run}` })
  const fp2 = await fingerprint({ step: 's1', why: `file something else ${run}` })
  const b = await ask(p, j, fp1)
  const before = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp1,
    job: j,
  })
  check('unanswered: asks', before.verdict === 'ask', before.verdict)
  await answer(b, 'Yes, do it')
  const same = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp1,
    job: j,
  })
  const changed = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp2,
    job: j,
  })
  const other = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp1,
    job: await job(p, 'telegram:grant-exact2'),
  })
  check('yes to THIS action proceeds', same.verdict === 'proceed' && same.approved, same.verdict)
  check('the same yes does not cover a changed action', changed.verdict === 'ask', changed.verdict)
  check("and is not another job's yes", other.verdict === 'ask', other.verdict)
}

// ---- 4. a No is durable, specific, and expires ------------------------------
{
  const p = await project('declined')
  const j = await job(p, 'telegram:grant-no')
  const fp = await fingerprint({ step: 's2', why: `send ${run}` })
  const fpOther = await fingerprint({ step: 's2', why: `send a different thing ${run}` })
  const b = await ask(p, j, fp)
  const r = await answer(b, 'No, leave it')
  const same = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: j,
  })
  check(
    'the No is recorded as a column and by whom',
    String(
      (
        await one(
          `select answered_option || ' / ' || answered_by as v from public.blockers where blocker_id = ${lit(b)}::uuid`,
        )
      ).v,
    ) === 'No, leave it / grant',
    JSON.stringify(r).slice(0, 60),
  )
  check(
    'this job: the declined action is refused, not asked',
    same.verdict === 'refuse' && same.declined,
    same.verdict,
  )
  const later = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: await job(p, 'telegram:grant-no2'),
  })
  check(
    'a later job proposing the SAME action is refused and told why, not asked',
    later.verdict === 'refuse' && later.remembered,
    `${later.verdict} - ${later.because.slice(0, 60)}`,
  )
  const diff = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fpOther,
    job: await job(p, 'telegram:grant-no3'),
  })
  check(
    'a different action is asked afresh (the No is specific)',
    diff.verdict === 'ask',
    diff.verdict,
  )
  await db.execute(
    `update public.blockers set resolved_at = resolved_at - interval '31 days' where blocker_id = ${lit(b)}::uuid`,
  )
  const expired = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: await job(p, 'telegram:grant-no4'),
  })
  check('past the window it may be asked again', expired.verdict === 'ask', expired.verdict)
  // cancelling the job is NOT a refusal of the action
  const j2 = await job(p, 'telegram:grant-cancel')
  const fp3 = await fingerprint({ step: 's3', why: `cancel ${run}` })
  await ask(p, j2, fp3)
  await db.execute(`update public.jobs set state = 'cancelled' where job_id = ${lit(j2)}::uuid`)
  const cancelled = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp3,
    job: await job(p, 'telegram:grant-cancel2'),
  })
  check(
    'cancelling the objective is not a refusal of the action',
    cancelled.verdict === 'ask',
    cancelled.verdict,
  )
}

// ---- 5. a duty does not ask again after a No --------------------------------
{
  const p = await project('duty')
  const ask2 = async () => {
    const j = await job(p, 'duty:authority-proof', 'google.write_calendar_tasks')
    return {
      j,
      g: await governOutward(db as never, {
        jobId: j,
        projectId: p,
        tool: 'notion.write',
        summary: 'The copy is behind',
        detail: '1. A',
        empty: false,
        agent: 'operations-director',
      }),
    }
  }
  const first = await ask2()
  await answer(String(first.g.blocker), 'No, leave it')
  const blockersBefore = Number(
    (await one(`select count(*)::int as n from public.blockers where project_id = ${lit(p)}::uuid`))
      .n,
  )
  const second = await ask2()
  const blockersAfter = Number(
    (await one(`select count(*)::int as n from public.blockers where project_id = ${lit(p)}::uuid`))
      .n,
  )
  const impediments = Number(
    (
      await one(
        `select count(*)::int as n from public.job_impediments where job_id = ${lit(second.j)}::uuid`,
      )
    ).n,
  )
  check(
    'after "No, leave it" the next run raises nothing, announces nothing and records no fault, with a body the outputs table accepts',
    !second.g.go &&
      second.g.blocker === null &&
      second.g.said !== '' &&
      second.g.quiet &&
      blockersAfter === blockersBefore &&
      impediments === 0,
    `blockers ${String(blockersBefore)}->${String(blockersAfter)}, impediments ${String(impediments)}`,
  )
  await db.execute(
    `select app.grant_standing('notion.write', ${lit(p)}::uuid, 'he changed his mind', 'grant', null)`,
  )
  const third = await ask2()
  check(
    'and a standing yes he gives later reopens it (control)',
    third.g.go,
    `go=${String(third.g.go)}`,
  )
}

// ---- 6. the to-do tick is an answer through the one door --------------------
{
  const p = await project('tick')
  const makeAsk = async (label: string) => {
    const j = await job(p, `telegram:grant-tick-${label}`)
    const b = String(
      (
        await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay,
            approval_options, originating_agent, work_can_continue, standing_tool, standing_option, decline_option)
          values (${lit(p)}::uuid, ${lit(j)}::uuid, ${lit(`Keep it in step ${label}`)}, 'authority proof',
            'Nothing happens until somebody answers this question.',
            array['Yes, keep doing it without asking me', 'No, leave it'], 'chief-of-staff', false,
            'notion.write', 'Yes, keep doing it without asking me', 'No, leave it') returning blocker_id::text as id`)
      ).id,
    )
    const t = String(
      (
        await one(
          `select task_id::text as id from public.tasks where satisfies_blocker = ${lit(b)}::uuid`,
        )
      ).id,
    )
    return { b, t }
  }
  const nobody = await makeAsk('nobody')
  await db.execute(
    `update public.tasks set state = 'done', done_at = now() where task_id = ${lit(nobody.t)}::uuid`,
  )
  const stillOpen = await one(
    `select b.state::text as bs, t.state::text as ts from public.blockers b, public.tasks t where b.blocker_id = ${lit(nobody.b)}::uuid and t.task_id = ${lit(nobody.t)}::uuid`,
  )
  check(
    'a tick from nobody the office can name reopens the to-do and leaves the question open',
    stillOpen.bs === 'open' && stillOpen.ts === 'todo',
    `${String(stillOpen.bs)}/${String(stillOpen.ts)}`,
  )
  const stranger = await makeAsk('stranger')
  await db.execute(`select app.hq_task_state(${lit(stranger.t)}, 'done', null, 'somebody-unknown')`)
  const s2 = await one(
    `select b.state::text as bs, t.state::text as ts from public.blockers b, public.tasks t where b.blocker_id = ${lit(stranger.b)}::uuid and t.task_id = ${lit(stranger.t)}::uuid`,
  )
  check(
    'and so does an unknown principal',
    s2.bs === 'open' && s2.ts === 'todo',
    `${String(s2.bs)}/${String(s2.ts)}`,
  )
  const known = await makeAsk('grant')
  await db.execute(`select app.hq_task_state(${lit(known.t)}, 'done', null, 'grant')`)
  const k = await one(
    `select b.state::text as bs, b.answered_by as by, b.answered_option as opt, (select count(*)::int from public.standing_authorizations where tool = 'notion.write' and project_id = ${lit(p)}::uuid and revoked_at is null) as standing from public.blockers b where b.blocker_id = ${lit(known.b)}::uuid`,
  )
  check(
    'a tick by a known principal answers through hq_answer_blocker: who, which option, and what it promised',
    k.bs === 'resolved' &&
      k.by === 'grant' &&
      k.opt === 'Yes, keep doing it without asking me' &&
      Number(k.standing) === 1,
    JSON.stringify(k),
  )
}

// ---- 7. duplicate answers ---------------------------------------------------
{
  const p = await project('dup')
  const j = await job(p, 'telegram:grant-dup')
  const b = await ask(p, j, await fingerprint({ dup: run }))
  const first = await answer(b, 'Yes, do it')
  const second = await answer(b, 'No, leave it')
  check(
    'a second answer does not overwrite the first',
    first.ok === true &&
      second.already === true &&
      String(
        (
          await one(
            `select answered_option as o from public.blockers where blocker_id = ${lit(b)}::uuid`,
          )
        ).o,
      ) === 'Yes, do it',
    JSON.stringify(second).slice(0, 80),
  )
}

// ---- 8. the plan executor asks the same boundary, per step -------------------
{
  const p = await project('steps', 'act')
  const [holder, bare] = (
    await db.execute(`select slug from public.staff order by slug limit 2`)
  ).rows.map((r) => String((r as { slug: string }).slug))
  await db.execute(
    `insert into public.staff_tools (staff_slug, tool) values (${lit(String(holder))}, 'task.create') on conflict do nothing`,
  )
  await db.execute(
    `delete from public.staff_tools where staff_slug = ${lit(String(bare))} and tool = 'task.create'`,
  )
  const step = (id: string, specialist: string | null, audience: 'office' | 'outside') => ({
    goal: 'authority proof',
    steps: [
      { id, capability: 'task.create', why: `AUTH ${id} ${run}`, needs: [], specialist, audience },
    ],
    unreachable: [],
    refused: [],
    how: 'fallback',
  })
  const perform = async (id: string, specialist: string | null, audience: 'office' | 'outside') => {
    const j = await job(p, 'telegram:grant-steps', 'office.pursue')
    const [s] = compile(
      step(id, specialist, audience) as never,
      db as never,
      j,
      p,
      'authority proof',
    )
    return { j, done: await s?.run({}) }
  }
  const tasks = async (id: string) =>
    Number(
      (
        await one(
          `select count(*)::int as n from public.tasks where title like ${lit(`%AUTH ${id} ${run}%`)} and satisfies_blocker is null`,
        )
      ).n,
    )
  const ok = await perform('held', holder ?? null, 'office')
  check(
    'a step naming a specialist who holds the tool performs it',
    ok.done?.outcome !== undefined && (await tasks('held')) === 1,
    `tasks ${String(await tasks('held'))}`,
  )
  const denied = await perform('bare', bare ?? null, 'office')
  check(
    'a step naming a specialist who does NOT hold it performs nothing and says why',
    (await tasks('bare')) === 0 &&
      String(
        (denied.done?.outcome as { impediment?: string } | undefined)?.impediment ?? '',
      ).includes('not been given'),
    String((denied.done?.outcome as { impediment?: string } | undefined)?.impediment ?? '').slice(
      0,
      80,
    ),
  )
  const outside = await perform('outside', null, 'outside')
  check(
    'a step reaching outside the office pauses for approval even at act, and performs nothing',
    outside.done?.pause?.reason === 'awaiting_approval' && (await tasks('outside')) === 0,
    String(outside.done?.pause?.reason),
  )
  const q = await one(
    `select blocker_id::text as id, action_fingerprint as fp, decline_option as d from public.blockers where job_id = ${lit(outside.j)}::uuid`,
  )
  check(
    'the question it raised names the exact action and which option is the No',
    typeof q.fp === 'string' && q.d === 'No, leave it',
    `${String(q.fp).slice(0, 10)}... / ${String(q.d)}`,
  )
  await answer(String(q.id), 'No, leave it')
  const again = await perform('outside', null, 'outside')
  check(
    'after that No a fresh run of the same step is declined without asking',
    (again.done?.outcome as { declined?: boolean } | undefined)?.declined === true &&
      (await tasks('outside')) === 0,
    JSON.stringify(again.done?.outcome ?? {}).slice(0, 80),
  )
}

// ---- 9. a question already open when 0611 lands still finds its answer -------
{
  const p = await project('backfill')
  const j = await job(p, 'telegram:grant-backfill', 'office.pursue')
  await db
    .execute(
      `update public.jobs set state = 'running', started_at = now(), leased_until = now() + interval '5 minutes', lease_owner = 'authority' where job_id = ${lit(j)}::uuid`,
    )
    .catch(() => undefined)
  const binds = { step: 's1:task.create', why: `backfill ${run}` }
  await pauseJob(db as never, j, {
    reason: 'awaiting_approval',
    detail: 'authority proof',
    resumeWhen: 'an answer',
    resumable: false,
    binds,
  })
  const b = String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
      values (${lit(p)}::uuid, ${lit(j)}::uuid, 'Backfill proof', 'authority proof', 'Nothing happens until somebody answers this question.', array['Yes, do it','No, leave it'], 'chief-of-staff', false) returning blocker_id::text as id`)
    ).id,
  )
  const sql = readFileSync(
    'migrations/0611_authorization_is_asked_once_and_a_no_is_remembered.sql',
    'utf8',
  )
  const block = /-- BACKFILL-BEGIN([\s\S]*?)-- BACKFILL-END/.exec(sql)?.[1] ?? ''
  check(
    'the backfill statement was found in the migration',
    block.includes('update public.blockers'),
    `${String(block.length)} chars`,
  )
  await db.execute(block)
  const fp = await fingerprint(binds)
  const row = await one(
    `select action_fingerprint as fp, decline_option as d from public.blockers where blocker_id = ${lit(b)}::uuid`,
  )
  check(
    'an open question gets the fingerprint of the pause it waits on, and its No',
    row.fp === fp && row.d === 'No, leave it',
    `${String(row.fp).slice(0, 10)}... / ${String(row.d)}`,
  )
  await answer(b, 'Yes, do it')
  const seen = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: j,
  })
  check(
    'so his answer after the deploy is found by the resumed step',
    seen.verdict === 'proceed' && seen.approved,
    seen.verdict,
  )
}

// ---- 11. internal office work proceeds at suggest; outward effects still ask (0612) --------
{
  const p = await project('internal', 'suggest')
  const INTERNAL = ['task.create', 'task.extract', 'draft.create', 'document.create']
  for (const tool of INTERNAL) {
    const d = await mayAct(db as never, { projectId: p, tool })
    check(`internal ${tool} proceeds at suggest, unasked`, d.verdict === 'proceed', d.verdict)
  }
  for (const tool of INTERNAL) {
    const d = await mayAct(db as never, { projectId: p, tool, audience: 'outside' })
    check(
      `the SAME ${tool} asks when its audience is outside (the floor holds at level 1)`,
      d.verdict === 'ask' && d.reason === 'outside_audience',
      `${d.verdict}/${String(d.reason)}`,
    )
  }
  // calendar.write is not listed: migration 0424 seeds a standing authorization for the diary duty, so it proceeds by that row.
  for (const tool of ['notion.write', 'slack.post', 'notebook.write']) {
    const d = await mayAct(db as never, { projectId: p, tool })
    check(`outward ${tool} (level 2) still asks at suggest`, d.verdict === 'ask', d.verdict)
  }
  const ingest = await mayAct(db as never, { projectId: p, tool: 'drive.ingest' })
  check(
    "drive.ingest (material from somebody else's system) still asks at suggest: it is not internal work",
    ingest.verdict === 'ask' && ingest.actionLevel === 2,
    `${ingest.verdict} level ${String(ingest.actionLevel)}`,
  )
  for (const tool of ['note.create', 'gmail.draft', 'gmail.send']) {
    const d = await mayAct(db as never, { projectId: p, tool })
    check(
      `${tool} stays refused (switched off), whatever the dial says`,
      d.verdict === 'refuse',
      d.verdict,
    )
  }
  const watch = await project('observe', 'observe')
  const obs = await mayAct(db as never, { projectId: watch, tool: 'task.create' })
  check('observe still refuses even an internal write', obs.verdict === 'refuse', obs.verdict)
  // a specialist without the grant is still refused an internal write
  const bare = String((await one(`select slug from public.staff order by slug limit 1`)).slug)
  await db.execute(
    `delete from public.staff_tools where staff_slug = ${lit(bare)} and tool = 'task.create'`,
  )
  const refused = await mayAct(db as never, { projectId: p, tool: 'task.create', staff: bare })
  check(
    'an internal write by a specialist who lacks the grant is still refused',
    refused.verdict === 'refuse' && refused.reason === 'specialist_not_granted',
    refused.verdict,
  )
  // the change is DATA: the boundary carries no special case for a tool or a dial setting
  const body = String(
    (
      await one(
        `select pg_get_functiondef('app.authorize_effect(uuid, text, uuid, text, text, text, uuid)'::regprocedure) as d`,
      )
    ).d,
  )
  check(
    'the boundary names no tool and no dial setting (the rule is a row, not a branch)',
    !/task\.create|draft\.create|suggest|observe/.test(body),
    'authorize_effect body scanned',
  )
  const may = String(
    (await one(`select pg_get_functiondef('app.may_act(uuid, text, uuid)'::regprocedure) as d`)).d,
  )
  check(
    'and neither does may_act',
    !/task\.create|draft\.create|'suggest'/.test(may),
    'may_act body scanned',
  )
  const cell = await one(
    `select verdict::text as v, (select level from public.tool_permissions where tool = 'drive.ingest') as di from public.autonomy_policy where autonomy = 'suggest' and action_level = 1`,
  )
  check(
    'what changed is exactly one matrix cell and one tool level',
    cell.v === 'proceed' && Number(cell.di) === 2,
    JSON.stringify(cell),
  )
}

// ---- 10. review findings, each with the state it would have corrupted --------
{
  const p = await project('review')
  // (a) a refused tick must not report success or offer an undo for it
  const j = await job(p, 'telegram:grant-review')
  const b = String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue)
      values (${lit(p)}::uuid, ${lit(j)}::uuid, 'Review tick', 'authority proof', 'Nothing happens until somebody answers this question.', array['Yes, do it','No, leave it'], 'chief-of-staff', false) returning blocker_id::text as id`)
    ).id,
  )
  const t = String(
    (
      await one(
        `select task_id::text as id from public.tasks where satisfies_blocker = ${lit(b)}::uuid`,
      )
    ).id,
  )
  const undosBefore = Number((await one(`select count(*)::int as n from public.undo_offers`)).n)
  const reply = json(
    (await one(`select app.hq_task_state(${lit(t)}, 'done', null, null)::text as r`)).r,
  )
  const undosAfter = Number((await one(`select count(*)::int as n from public.undo_offers`)).n)
  const stored = String(
    (await one(`select state::text as s from public.tasks where task_id = ${lit(t)}::uuid`)).s,
  )
  check(
    'a refused tick is reported as not taken, matches the stored task, and offers no undo',
    typeof reply.error === 'string' && stored === 'todo' && undosAfter === undosBefore,
    `${String(reply.error).slice(0, 50)} / ${stored} / undo ${String(undosBefore)}->${String(undosAfter)}`,
  )

  // (b) an answer by the button path is a column too
  const j2 = await job(p, 'telegram:grant-button')
  const fp = await fingerprint({ button: run })
  const b2 = await ask(p, j2, fp)
  await db.execute(`select app.answer_generation_approval(${lit(b2)}::uuid, false, 'grant')`)
  const viaButton = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: j2,
  })
  check(
    'a No given by the approve/decline button is seen by the boundary',
    viaButton.verdict === 'refuse' && viaButton.declined,
    viaButton.verdict,
  )

  // (c) an answered question whose job has not finished is backfilled from its sentence, once
  const j3 = await job(p, 'telegram:grant-live', 'office.pursue')
  await db
    .execute(
      `update public.jobs set state = 'running', started_at = now(), leased_until = now() + interval '5 minutes', lease_owner = 'authority' where job_id = ${lit(j3)}::uuid`,
    )
    .catch(() => undefined)
  const b3 = String(
    (
      await one(`insert into public.blockers (project_id, job_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, state, resolved_at, resolution)
      values (${lit(p)}::uuid, ${lit(j3)}::uuid, 'Live proof', 'authority proof', 'Nothing happens until somebody answers this question.', array['Yes, do it','No, leave it'], 'chief-of-staff', true, 'resolved', now(), 'Yes, do it — answered by grant') returning blocker_id::text as id`)
    ).id,
  )
  const sql = readFileSync(
    'migrations/0611_authorization_is_asked_once_and_a_no_is_remembered.sql',
    'utf8',
  )
  await db.execute(/-- BACKFILL-BEGIN([\s\S]*?)-- BACKFILL-END/.exec(sql)?.[1] ?? 'select 1')
  const filled = String(
    (
      await one(
        `select answered_option as o from public.blockers where blocker_id = ${lit(b3)}::uuid`,
      )
    ).o,
  )
  check(
    'a question answered before the deploy, on a job still live, gets its answer as a column',
    filled === 'Yes, do it',
    filled,
  )

  // (d) the boundary and the question writer still work on a database without 0611 (a worker that ships first)
  await db.execute(
    `alter table public.blockers drop column action_fingerprint, drop column decline_option`,
  )
  await db.execute(`drop function app.authorize_effect(uuid, text, uuid, text, text, text, uuid)`)
  const old = await mayAct(db as never, {
    projectId: p,
    tool: 'notion.write',
    fingerprint: fp,
    job: j2,
  })
  check(
    'without app.authorize_effect the policy it wraps still answers (a worker that ships before the migration)',
    old.verdict === 'ask' || old.verdict === 'proceed' || old.verdict === 'refuse',
    old.verdict,
  )
  const raised = await raiseBlocker(
    db as never,
    {
      jobId: j2,
      projectId: p,
      requestedAction: 'Fallback proof',
      whyNeeded: 'authority proof',
      consequencesOfDelay: 'Nothing happens until somebody answers this question.',
      approvalOptions: OPTS,
      originatingAgent: 'chief-of-staff',
      workCanContinue: true,
      actionFingerprint: fp,
      declineOption: 'No, leave it',
    } as never,
  )
  check(
    'and a question is still written without the new columns',
    typeof raised === 'string' && raised.length > 10,
    String(raised).slice(0, 8),
  )
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
