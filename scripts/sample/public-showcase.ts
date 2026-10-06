/**
 * The showcase layer of the PUBLIC Sample Office: real team work inside the café's world (see public-showcase-plan.ts).
 *
 *   npx tsx scripts/sample/public-showcase.ts status                  # read-only: what the team has done here
 *   npx tsx scripts/sample/public-showcase.ts seed --only=<step>      # open, do one step, seal again
 *   steps: setup (lessons, personal tasks, request, automation, file types), then one per turn key
 *
 * Turns are REAL: a message to the team through the same voice door a browser uses, as the office's owner while the office is
 * open for seeding, answered by the deployed worker. Nothing here writes an answer. Each turn waits for its whole job tree
 * (Claire's hand-off and the specialist's answer) and prints what came back, so the result is read before it is kept: outputs
 * are append-only, so a bad answer is not something this can take back.
 *
 * WHILE IT IS OPEN nobody can enter (app.sample_login says no). `seed` always ends sealed, even after a failure.
 * Nothing prints a credential.
 */
import { act, db, REF } from '../p4/lib.ts'
import { apiKeys } from '../p4/provision-second-person.ts'
import { lit, rows } from './lib.ts'
import { isoDay } from './plan.ts'
import { PROJECTS, SAMPLE_KEY } from './public-plan.ts'
import {
  AUTOMATION,
  DECISIONS,
  HIDDEN_TURNS,
  IMPORT_TURNS,
  MORE_PERSONAL_TASKS,
  NEW_LESSONS,
  REDATE_PERSONAL,
  RETIRE_LESSONS_STARTING,
  SHOW_REPORT_OF,
  TOOL_REQUEST,
  TURNS,
} from './public-showcase-plan.ts'

const cmd = process.argv[2] ?? 'status'
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const today = new Date()
void db

const office = async () =>
  (
    await rows(
      `select o.office_id::text id, lower(u.email) email from public.offices o join auth.users u on u.id = o.auth_user_id where o.kind = 'sample' order by o.created_at desc limit 1`,
    )
  )[0] as { id: string; email: string }
const sample = await office()
const O = lit(sample.id)

if (cmd === 'status') {
  const r = async (q: string) => (await rows(q))[0] ?? {}
  console.log(
    JSON.stringify(
      {
        seeded_turns: (
          await r(
            `select count(*) n from public.inbound_commands where office_id = ${O}::uuid and context ->> 'visitor' is null`,
          )
        ).n,
        team_outputs: (
          await r(
            `select count(*) n from public.outputs o join public.jobs j on j.job_id = o.job_id where j.office_id = ${O}::uuid and not app.harness_job(j.job_id)`,
          )
        ).n,
        made_documents: (
          await r(
            `select count(*) n from public.documents where office_id = ${O}::uuid and origin = 'made'`,
          )
        ).n,
        awaiting_review: (
          await r(
            `select count(*) n from public.documents where office_id = ${O}::uuid and origin = 'made' and state = 'draft'`,
          )
        ).n,
        open_tool_requests: (
          await r(
            `select count(*) n from public.tool_requests where office_id = ${O}::uuid and state = 'open'`,
          )
        ).n,
        automations: (
          await r(`select count(*) n from public.responsibilities where office_id = ${O}::uuid`)
        ).n,
      },
      null,
      1,
    ),
  )
  process.exit(0)
}
if (cmd !== 'seed' || only === undefined) {
  console.error('usage: public-showcase.ts status | seed --only=setup|<turn key>')
  process.exit(2)
}

const projects = new Map(
  (
    await rows(
      `select slug, project_id::text id, name from public.projects where office_id = ${O}::uuid and status = 'active'`,
    )
  ).map((p) => [String(p.slug), p]),
)
const staffSlug = async (name: string): Promise<string> =>
  String(
    (await rows(`select slug from public.staff where name = ${lit(name)} and active limit 1`))[0]
      ?.slug ?? '',
  )

let failures = 0
const note = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}

await rows(`select app.sample_office_open(${O}::uuid, true)`)
console.log(
  `opened the sample office ${sample.id.slice(0, 8)} for seeding (visitors cannot enter while it is open)`,
)
try {
  const { anon, service } = await apiKeys()
  const gen = await fetch(`https://${REF}.supabase.co/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: sample.email }),
  })
  const link = (await gen.json()) as { hashed_token?: string }
  const verified = await fetch(`https://${REF}.supabase.co/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  })
  const token = ((await verified.json()) as { access_token?: string }).access_token
  if (token === undefined)
    throw new Error('no session for the sample owner while the office was open')

  if (only === 'setup') {
    // 1. the lessons a visitor reads on "What it has learned": retire the first wording, learn the plain one.
    for (const start of RETIRE_LESSONS_STARTING) {
      const live = await rows(
        `select l.lesson_id::text id from public.lessons l where l.office_id = ${O}::uuid and l.body like ${lit(`${start}%`)} and l.row_kind = 'lesson' and not exists (select 1 from public.lessons r where r.supersedes = l.lesson_id)`,
      )
      for (const l of live) {
        await rows(
          `select app.retract_lesson(${O}::uuid, ${lit(String(l.id))}::uuid, 'Reworded so it reads as a rule the team follows', ${lit(SAMPLE_KEY)})`,
        )
        note(true, `retired the first wording of "${start.slice(0, 40)}…"`)
      }
    }
    const have = new Set(
      (await rows(`select body from public.lessons where office_id = ${O}::uuid`)).map((r) =>
        String(r.body),
      ),
    )
    for (const l of NEW_LESSONS)
      if (!have.has(l.body)) {
        await rows(
          `select app.learn(${O}::uuid, ${lit(l.scope)}::public.lesson_scope, ${lit(l.body)}, ${lit(SAMPLE_KEY)})`,
        )
        note(true, `learned: ${l.body.slice(0, 60)}…`)
      }

    // 2. the personal list, shaped for the view Team HQ has (today and overdue).
    const mine = new Map(
      (
        await rows(
          `select title, task_id::text id from public.tasks where office_id = ${O}::uuid and project_id is null and state <> 'cancelled'`,
        )
      ).map((t) => [String(t.title), String(t.id)]),
    )
    for (const r of REDATE_PERSONAL) {
      const id = mine.get(r.title)
      if (id !== undefined)
        note(
          (await act(token, 'my_task_set', { p_task_id: id, p_due_on: isoDay(today, r.due) }))
            .status === 200,
          `moved "${r.title.slice(0, 40)}…" to today`,
        )
    }
    for (const t of MORE_PERSONAL_TASKS)
      if (!mine.has(t.title))
        note(
          (
            await act(token, 'my_task_add', {
              p_title: t.title,
              p_due_on: isoDay(today, t.due ?? 0),
              p_labels: t.labels ?? [],
            })
          ).status === 200,
          `added "${t.title}"`,
        )

    // 3. an agent's request for a tool it does not hold, with the product's own writer.
    const asker = await staffSlug(TOOL_REQUEST.staff)
    const open = Number(
      (
        await rows(
          `select count(*) n from public.tool_requests where office_id = ${O}::uuid and tool = ${lit(TOOL_REQUEST.tool)} and asked_by = ${lit(asker)}`,
        )
      )[0]?.n,
    )
    if (open === 0) {
      const r = (
        await rows(
          `select app.request_tool(${O}::uuid, ${lit(TOOL_REQUEST.tool)}, ${lit(asker)}, ${lit(TOOL_REQUEST.whatFor)}) as r`,
        )
      )[0]?.r
      note(
        r !== undefined && !/error|already_held/.test(JSON.stringify(r)),
        `${TOOL_REQUEST.staff} asked for ${TOOL_REQUEST.tool}: ${JSON.stringify(r).slice(0, 90)}`,
      )
    }

    // 4. a standing instruction on a schedule, with the product's own writer.
    const have2 = Number(
      (await rows(`select count(*) n from public.responsibilities where office_id = ${O}::uuid`))[0]
        ?.n,
    )
    if (have2 === 0) {
      const r = (
        await rows(
          `select app.create_automation(${O}::uuid, ${lit(AUTOMATION.project)}, ${lit(AUTOMATION.instruction)}, ${String(AUTOMATION.everyMinutes)}, ${lit(AUTOMATION.atTime)}, ${lit(await staffSlug(AUTOMATION.who))}, ${lit(SAMPLE_KEY)}) as r`,
        )
      )[0]?.r
      note(
        JSON.stringify(r).includes('"ok": true') || JSON.stringify(r).includes('"ok":true'),
        `automation: ${JSON.stringify(r).slice(0, 110)}`,
      )
    }

    // 5. files are served with the type the text is in: UTF-8, and a spreadsheet as text so it OPENS rather than downloads.
    for (const p of PROJECTS)
      for (const d of p.docs) {
        const row = (
          await rows(
            `select storage_path p from public.documents where office_id = ${O}::uuid and title = ${lit(d.name)} limit 1`,
          )
        )[0]
        const path = String(row?.p ?? '')
        if (path === '') continue
        const type =
          d.mime === 'text/csv' ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8'
        const put = await fetch(`https://${REF}.supabase.co/storage/v1/object/files/${path}`, {
          method: 'PUT',
          headers: {
            apikey: service,
            Authorization: `Bearer ${service}`,
            'x-upsert': 'true',
            'content-type': type,
          },
          body: d.text,
        })
        note(put.ok, `served ${d.name} as ${type} (http ${String(put.status)})`)
      }
  } else if (only === 'curate') {
    // Leave out real turns that demonstrated nothing: flagged, never deleted (migration 0903).
    for (const said of HIDDEN_TURNS) {
      const r = await rows(
        `update public.inbound_commands set context = coalesce(context, '{}'::jsonb) || '{"showcase_hidden": true}'::jsonb where office_id = ${O}::uuid and instruction = ${lit(said)} and context ->> 'visitor' is null returning command_id::text id`,
      )
      note(
        true,
        `left out of the demonstration: ${String(r.length)} turn(s) saying "${said.slice(0, 50)}…"`,
      )
    }
    // The report itself is real and is what the Needs You example is about, so it stays in the Agentic Team tool although its
    // thread is left out (migration 0905): the report-making job of each such turn is marked to be shown.
    for (const said of SHOW_REPORT_OF) {
      const r = await rows(
        `update public.jobs j set pinned_config = coalesce(j.pinned_config, '{}'::jsonb) || '{"showcase_shown": true}'::jsonb where j.office_id = ${O}::uuid and j.kind = 'artifact.report' and j.state = 'complete' and j.root_job_id in (select c.job_id from public.inbound_commands c where c.office_id = ${O}::uuid and c.instruction = ${lit(said)} and c.context ->> 'visitor' is null) returning j.job_id::text id`,
      )
      note(
        r.length > 0,
        `the report made by "${said.slice(0, 50)}…" is shown in the Agentic Team tool (${String(r.length)} job(s))`,
      )
    }
    // Decisions Jordan has made, with the product's own writer, once each.
    for (const d of DECISIONS) {
      const have = Number(
        (
          await rows(
            `select count(*) n from public.decisions where office_id = ${O}::uuid and question = ${lit(d.question)}`,
          )
        )[0]?.n,
      )
      if (have > 0) continue
      const p = projects.get(d.project)
      const ruled = `array[${d.ruledOut.map((x) => lit(x)).join(', ')}]::text[]`
      const r = (
        await rows(
          `select app.record_decision_made(${O}::uuid, ${lit(d.question)}, ${lit(d.chose)}, ${ruled}, ${lit(d.because)}, 'Jordan Reyes', ${lit(String(p?.id ?? ''))}::uuid, null, null) as r`,
        )
      )[0]?.r
      note(JSON.stringify(r).includes('true'), `decision: ${d.question} -> ${d.chose}`)
    }
  } else if (only === 'import') {
    // The team's own conclusions, filed in the project the way a person presses "Add to project": so they are documents the
    // team can retrieve ("what did Daniel conclude") and not only lines in a chat thread a visitor cannot see.
    for (const key of IMPORT_TURNS) {
      const turn = TURNS.find((t) => t.key === key)
      const project = turn === undefined ? undefined : projects.get(turn.project)
      if (turn === undefined || project === undefined) throw new Error(`no turn ${key}`)
      const outs = await rows(
        `select o.output_id::text id, coalesce(s.name, '') who, left(o.body, 70) head from public.outputs o join public.jobs j on j.job_id = o.job_id left join public.staff s on s.staff_id = o.staff_id join public.inbound_commands c on c.job_id = coalesce(j.root_job_id, j.job_id) where c.office_id = ${O}::uuid and c.context ->> 'visitor' is null and c.instruction = ${lit(turn.said)} and j.state = 'complete' and not exists (select 1 from public.documents d where d.office_id = ${O}::uuid and d.external_ref = 'output:' || o.output_id::text) order by o.created_at desc`,
      )
      // The last answer of the tree is the synthesis the person reads; earlier ones are the specialists' working.
      const last = outs[0]
      if (last === undefined) {
        console.log(`nothing new to file for ${key}`)
        continue
      }
      const res = await act(token, 'output_import', { p_output: String(last.id) })
      note(
        res.status === 200,
        `filed ${String(last.who)}'s answer to "${turn.said.slice(0, 40)}…" as a document (${String(last.head).replace(/\s+/g, ' ')})`,
      )
    }
  } else {
    const turn = TURNS.find((t) => t.key === only)
    if (turn === undefined) throw new Error(`no step called ${only}`)
    const project = projects.get(turn.project)
    if (project === undefined) throw new Error(`no project ${turn.project}`)
    // An attempt whose job failed or was called off does not count as asked: asking again is exactly what its apology invites.
    const notFailed = `and not exists (select 1 from public.jobs fj where fj.job_id = inbound_commands.job_id and fj.state in ('failed', 'cancelled'))`
    const said = (
      await rows(
        `select count(*) n from public.inbound_commands where office_id = ${O}::uuid and project_id = ${lit(String(project.id))}::uuid and instruction = ${lit(turn.said)} ${notFailed}`,
      )
    )[0]?.n
    if (Number(said) > 0) {
      console.log(`already asked: "${turn.said.slice(0, 60)}…" (nothing sent; following it)`)
    } else {
      const res = await fetch(`https://${REF}.supabase.co/functions/v1/voice/turn`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          said: turn.said,
          session: `showcase-${turn.thread ?? turn.key}`,
          project: project.id,
        }),
      })
      const body = (await res.json()) as { speak?: string; error?: string }
      console.log(
        `sent to the team: http ${String(res.status)} ${JSON.stringify(body).slice(0, 160)}`,
      )
      if (!res.ok) throw new Error('the team did not take the message')
    }
    {
      // The job is the one the stored command started: read it back rather than trusting the shape of a reply.
      let job = ''
      for (let i = 0; i < 12 && job === ''; i += 1) {
        job = String(
          (
            await rows(
              `select job_id::text id from public.inbound_commands where office_id = ${O}::uuid and project_id = ${lit(String(project.id))}::uuid and instruction = ${lit(turn.said)} and job_id is not null ${notFailed} order by received_at desc limit 1`,
            )
          )[0]?.id ?? '',
        )
        if (job === '') await new Promise((r) => setTimeout(r, 5000))
      }
      if (job === '') throw new Error('the message was stored but started no job')
      const deadline = Date.now() + 8 * 60 * 1000
      let last = ''
      while (Date.now() < deadline) {
        const tree = await rows(
          `select state, kind, coalesce(recipient_agent, '-') who from public.jobs where office_id = ${O}::uuid and (job_id = ${lit(job)}::uuid or root_job_id = ${lit(job)}::uuid) order by created_at`,
        )
        const sig = tree.map((j) => `${String(j.who)}:${String(j.state)}`).join(' ')
        if (sig !== last) console.log(`  ${new Date().toISOString().slice(11, 19)} ${sig}`)
        last = sig
        const settled =
          tree.length > 0 &&
          tree.every((j) =>
            ['complete', 'failed', 'cancelled', 'paused', 'waiting_user'].includes(String(j.state)),
          )
        if (settled) break
        await new Promise((r) => setTimeout(r, 10000))
      }
      const out = await rows(
        `select coalesce(s.name, 'the office') who, left(o.body, 700) body from public.outputs o join public.jobs j on j.job_id = o.job_id left join public.staff s on s.staff_id = o.staff_id where j.office_id = ${O}::uuid and (j.job_id = ${lit(job)}::uuid or j.root_job_id = ${lit(job)}::uuid) order by o.created_at`,
      )
      for (const o of out) console.log(`\n[${String(o.who)}]\n${String(o.body)}`)
      note(out.length > 0, `${String(out.length)} answer(s) came back`)
      if (turn.grounded !== undefined) {
        const all = out.map((o) => String(o.body)).join(' ')
        note(
          turn.grounded.some((g) => g.test(all)),
          'the answer uses figures from the Sample’s own papers',
        )
      }
      if (turn.approve !== undefined) {
        const docs = await rows(
          `select document_id::text id, title, state from public.documents where office_id = ${O}::uuid and origin = 'made' and produced_by_job in (select job_id from public.jobs where job_id = ${lit(job)}::uuid or root_job_id = ${lit(job)}::uuid)`,
        )
        console.log(
          `made document(s): ${docs.map((d) => `${String(d.title)} [${String(d.state)}]`).join(', ') || 'none'}`,
        )
        note(docs.length > 0, 'the report was made as a document')
        if (turn.approve)
          for (const d of docs)
            if (d.state === 'draft')
              note(
                (await act(token, 'document_approve', { p_document: String(d.id) })).status === 200,
                `approved "${String(d.title)}"`,
              )
      }
    }
  }
} finally {
  const seal = await rows(`select app.sample_office_open(${O}::uuid, false) as r`)
  void seal
  console.log('sealed: visitors can read it and ask the team a question, and nothing else')
}
console.log(`${failures === 0 ? 'done' : `${String(failures)} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
