/**
 * #408 benchmark: can the team understand and use the three Sample projects?
 *   npx tsx scripts/sample/intelligence.ts [--only W1,F2] [--no-pause]
 *
 * The Sample Person's three seeded projects are a permanent functional benchmark. Each case is a real question put to
 * the REAL handlers (`buildPass`, in-process, so the working tree is what is tested, not what is deployed) as the Sample's
 * own office, filed under one project, as a harness actor so the job is a fixture and nothing is delivered to anybody.
 * `fetch` is wrapped so every request to the model provider is recorded exactly as sent.
 *
 * Two verdicts are kept apart because they are different claims:
 *   RETRIEVAL  - what was put in front of the model. Deterministic: the fact is in the recorded prompt or it is not. This is
 *                what #408 is about and what the suite's exit code is decided on.
 *   ANSWER     - what the model then said. Stochastic by nature (a free model), reported with its count, never the gate.
 *
 * Expected values are READ FROM THE RECORDS at run time (or are fixed strings from `plan.ts`), never from the answer, so
 * nothing here can be satisfied by a canned reply. Negative controls: the other offices' titles are harvested as canaries
 * and must appear in no prompt and no answer; a foreign project id and a foreign document id answer exactly as a missing
 * one does; and a question whose answer lives in its own project must not be padded with another project's material.
 *
 * Bounded: one in-process job per case (about a dozen free-tier model calls). The worker heartbeat is paused for the run
 * so the deployed (older) worker cannot answer a fixture job, and resumed in a finally. Writes nothing but fixture jobs,
 * which are cancelled in teardown; Grant's office is only SELECTed from, for canaries, and fingerprinted before and after.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'
import { buildPass } from '../../src/office/pass.ts'
import { check, results, SECOND_OFFICE } from '../p4/lib.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const projectRef = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(projectRef, token)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const pause = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

const only = (process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '')
  .split(',')
  .filter((x) => x !== '')
const noPause = process.argv.includes('--no-pause')
const run = Math.random().toString(36).slice(2, 8)
const ACTOR = `verify-intel-${run}`
const MINE = `telegram:${ACTOR}`
const WORKER = `intel-${run}`

const sent: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('openrouter.ai') && typeof init?.body === 'string') sent.push(init.body)
  return realFetch(input, init)
}) as typeof fetch

/** Lower-case, thousands separators and pound signs removed, so "5,200" and "£5200" are one thing. */
const flat = (s: string): string =>
  s
    // Models write non-breaking spaces and hyphens ("SAMPLE\u2011RYO\u201107"); a person reads them as plain ones.
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase()
    .replace(/\\n/g, ' ')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/£/g, '')
const has = (hay: string, needle: string): boolean => flat(hay).includes(flat(needle))
/** At least 60% of a title's significant words appear: a model rewords a task title, it rarely drops its subject. */
const mentions = (hay: string, title: string): boolean => {
  const words = [...new Set(flat(title).match(/[a-z0-9-]{4,}/g) ?? [])]
  if (words.length === 0) return true
  const h = flat(hay)
  return words.filter((w) => h.includes(w)).length / words.length >= 0.6
}

interface Case {
  readonly id: string
  /** A specialist the message is addressed to (their own name), instead of the chief of staff */
  readonly to?: string
  readonly project: string | null // by name, in the Sample office; null = filed under no project
  readonly ask: string
  /** Strings that must be in the prompt the model was shown (retrieval) */
  readonly prompt: readonly string[]
  /** Strings that must be in the answer (the model) */
  readonly answer: readonly string[]
  /** The answer must match / must not match (judged on the words, not a canned list) */
  readonly wantAnswer?: RegExp
  readonly forbidAnswer?: RegExp
  /** Strings that must be in NO prompt and NO answer of this case (cross-project mixing) */
  readonly absent?: readonly string[]
  readonly note: string
}

const today = String((await rows(`select (app.now_utc() at time zone 'UTC')::date::text d`))[0]?.d)
const pid = async (name: string): Promise<string> =>
  String(
    (
      await rows(
        `select project_id::text p from public.projects where office_id = ${lit(SECOND_OFFICE)}::uuid and name = ${lit(name)}`,
      )
    )[0]?.p ?? '',
  )
const WELL = 'Wellness Studio Launch'
const FIN = '2027 Financial Plan'
const JAPAN = 'Japan Spring Trip'
const ids = { [WELL]: await pid(WELL), [FIN]: await pid(FIN), [JAPAN]: await pid(JAPAN) }
check(
  'the three benchmark projects exist in the Sample office',
  Object.values(ids).every((v) => v !== ''),
)

const titles = async (project: string, where: string): Promise<string[]> =>
  (
    await rows(
      `select title from public.tasks where office_id = ${lit(SECOND_OFFICE)}::uuid and project_id = ${lit(ids[project as keyof typeof ids] ?? '')}::uuid and ${where} order by due_on nulls last, seq`,
    )
  ).map((r) => String(r.title))
const blockedWell = await titles(WELL, `state = 'blocked'`)
const overdueFin = await titles(
  FIN,
  `state not in ('done','cancelled') and due_on < ${lit(today)}::date`,
)
const overdueJapan = await titles(
  JAPAN,
  `state not in ('done','cancelled') and due_on < ${lit(today)}::date`,
)
const deadlinesJapan = await titles(
  JAPAN,
  `'deadline' = any(labels) and state not in ('done','cancelled')`,
)
const cashflow = String(
  (
    await rows(
      `select content c from public.documents where office_id = ${lit(SECOND_OFFICE)}::uuid and title = 'monthly-cashflow-forecast-2027.csv' and state <> 'archived'`,
    )
  )[0]?.c ?? '',
)
const decClosing = cashflow
  .trim()
  .split('\n')
  .find((l) => l.startsWith('Dec,'))
  ?.split(',')[4]
check(
  'the benchmark documents carry text the search can read (what #408 broke)',
  cashflow !== '' && decClosing !== undefined,
  `December closing ${String(decClosing)}`,
)

const CASES: Case[] = [
  {
    id: 'W1',
    project: WELL,
    ask: 'How much is budgeted for the sprung floor, and what does the whole fit-out budget come to?',
    prompt: ['Sprung floor,5200'],
    answer: ['5200', '11070'],
    absent: ['2027-annual-budget', 'Harbour Mutual', 'SAMPLE-RYO-07'],
    note: 'document in own project; the answer needs a sum',
  },
  {
    id: 'W2',
    project: WELL,
    ask: 'Who is the cheapest instructor on the shortlist and what do they charge per class?',
    prompt: ['Priya Venn,Family classes,38'],
    answer: ['Priya Venn', '38'],
    absent: ['2027-annual-budget', 'Harbour Mutual'],
    note: 'document in own project',
  },
  {
    id: 'W3',
    project: WELL,
    ask: 'Which tasks on this project are blocked, and what are they waiting for?',
    prompt: blockedWell,
    answer: [],
    note: 'project tasks: blocked work, expected read from the records',
  },
  {
    id: 'F1',
    project: FIN,
    ask: 'Which savings account pays the highest interest rate, and what is the rate?',
    prompt: ['Harbour Mutual,One-year fixed,4.6'],
    answer: ['Harbour Mutual', '4.6'],
    absent: ['Sprung floor', 'SAMPLE-RYO-07'],
    note: 'document in own project',
  },
  {
    id: 'F2',
    project: FIN,
    ask: 'In the cashflow forecast, what is the closing balance in December?',
    // The December ROW of the cashflow file. A bare "Dec," also opens the annual budget's header, which is a different
    // document: the first draft of this check passed for the wrong document.
    prompt: [`,${String(decClosing)},`, 'month,opening,income,spending,closing,note'],
    answer: [String(decClosing)],
    absent: ['Sprung floor', 'SAMPLE-RYO-07'],
    note: 'document in own project; a figure read from a row',
  },
  {
    id: 'F3',
    project: FIN,
    ask: 'What is overdue on this project?',
    prompt: overdueFin,
    answer: [],
    absent: ['Sprung floor', 'Ghibli'],
    note: 'project tasks: overdue',
  },
  {
    id: 'D2',
    to: 'finance-director',
    project: FIN,
    ask: 'Which savings account pays the highest interest rate, and what is the rate?',
    prompt: ['Harbour Mutual,One-year fixed,4.6'],
    answer: ['Harbour Mutual', '4.6'],
    absent: ['Sprung floor', 'SAMPLE-RYO-07'],
    note: 'a SPECIALIST, addressed in their own name, is shown the same project material as the chief of staff',
  },
  {
    id: 'D3',
    project: FIN,
    ask: 'Ask the finance specialist to summarise the assumptions in the budget documents in this project.',
    // An imperative goes through plan-and-pursue, whose steps run as later jobs: what is gated here is that the request is not deflected.
    prompt: [],
    answer: [],
    absent: ['Sprung floor', 'SAMPLE-RYO-07'],
    // The request is addressed to the very person who answers; it must reach her as the work, not as an introduction.
    forbidAnswer:
      /which finance specialist|who (?:is|are) the finance|need to know which person|point me to the specific/i,
    wantAnswer: /rent|drawings|savings|pension|grocer|budget|annual/i,
    note: 'a request addressed TO the finance specialist is answered with the work, not with a question about who she is',
  },
  {
    id: 'C-F',
    project: FIN,
    ask: 'Ask the finance director to review the outstanding work in this project and tell me what needs attention first.',
    prompt: [],
    answer: [],
    note: 'Claire-mediated delegation: finance',
  },
  {
    id: 'C-J',
    project: JAPAN,
    ask: 'Have the research specialist review the unresolved travel work and identify the most important next steps.',
    prompt: [],
    answer: [],
    note: 'Claire-mediated delegation: research on travel',
  },
  {
    id: 'C-W',
    project: WELL,
    ask: 'Ask the appropriate person on the team to review our launch preparation and identify anything important that is still unfinished.',
    prompt: [],
    answer: [],
    note: 'Claire-mediated delegation: wellness launch',
  },
  {
    id: 'J1',
    project: JAPAN,
    ask: 'Which rail pass option is cheapest, and which one does not pay back on this route?',
    prompt: ['Seven-day regional pass,7,290', 'Does not pay back'],
    answer: ['290', 'fourteen-day'],
    absent: ['Sprung floor', 'Harbour Mutual'],
    note: 'document in own project',
  },
  {
    id: 'J2',
    project: JAPAN,
    ask: 'What is our booking reference for the Kyoto ryokan?',
    prompt: ['SAMPLE-RYO-07'],
    answer: ['SAMPLE-RYO-07'],
    absent: ['Sprung floor', 'Harbour Mutual'],
    note: 'document in own project; an exact reference',
  },
  {
    id: 'J3',
    project: JAPAN,
    ask: 'What booking deadlines are coming up?',
    prompt: deadlinesJapan,
    answer: [],
    absent: ['Sprung floor', 'Harbour Mutual'],
    note: 'project tasks: dated, labelled work',
  },
  {
    id: 'J4',
    project: JAPAN,
    ask: 'What is overdue on the trip?',
    prompt: overdueJapan,
    answer: [],
    note: 'project tasks: overdue',
  },
  {
    id: 'X1',
    project: WELL,
    ask: 'Over in the Japan Spring Trip project, which rail pass option is cheapest?',
    prompt: ['Seven-day regional pass,7,290'],
    answer: ['290'],
    note: 'a question that NAMES another project widens to it, deliberately and visibly',
  },
  {
    id: 'U1',
    project: null,
    ask: 'What is overdue on the Japan Spring Trip?',
    prompt: overdueJapan,
    answer: [],
    note: 'asked with no project in scope: the named project is enough',
  },
]

// ---- negative controls that need no model --------------------------------------------------------------------------
const grantOffice = String((await rows(`select app.operator_office()::text o`))[0]?.o ?? '')
const grantProject = String(
  (
    await rows(
      `select project_id::text p from public.projects where office_id = ${lit(grantOffice)}::uuid and status = 'active' order by updated_at desc limit 1`,
    )
  )[0]?.p ?? '',
)
const grantDoc = String(
  (
    await rows(
      `select document_id::text d from public.documents where office_id = ${lit(grantOffice)}::uuid limit 1`,
    )
  )[0]?.d ?? '',
)
const asNull = async (sql: string): Promise<boolean> => (await rows(sql))[0]?.v === null
check(
  "NEGATIVE: another office's project id reads as a project that does not exist",
  grantProject !== '' &&
    (await asNull(
      `select app.project_work_brief(${lit(SECOND_OFFICE)}::uuid, ${lit(grantProject)}::uuid) as v`,
    )),
)
check(
  'NEGATIVE: and so does an id that never existed (the two answers are identical, so neither is an oracle)',
  await asNull(
    `select app.project_work_brief(${lit(SECOND_OFFICE)}::uuid, '00000000-0000-4000-8000-000000000000'::uuid) as v`,
  ),
)
const foreignIndex = String(
  (
    await rows(
      `select (app.index_file_text(${lit(SECOND_OFFICE)}::uuid, ${lit(grantDoc)}::uuid, 'planted text'))::text v`,
    )
  )[0]?.v,
)
const missingIndex = String(
  (
    await rows(
      `select (app.index_file_text(${lit(SECOND_OFFICE)}::uuid, '00000000-0000-4000-8000-000000000000'::uuid, 'planted text'))::text v`,
    )
  )[0]?.v,
)
check(
  "NEGATIVE: indexing text onto another office's document is refused, in words identical to a missing one",
  foreignIndex === missingIndex && foreignIndex.includes('"indexed": false'),
  foreignIndex,
)
check(
  "NEGATIVE: and nothing was written onto the other office's document",
  grantDoc !== '' &&
    (
      await rows(
        `select (content ilike '%planted text%') as v from public.documents where document_id = ${lit(grantDoc)}::uuid`,
      )
    )[0]?.v === false,
)

// canaries: titles that belong to other offices and must never appear in what the Sample's team is shown or says
const canaries = [
  ...(
    await rows(
      `select distinct title t from public.tasks where office_id <> ${lit(SECOND_OFFICE)}::uuid and not is_fixture and length(title) between 14 and 90 limit 40`,
    )
  ).map((r) => String(r.t)),
  ...(
    await rows(
      `select distinct title t from public.documents where office_id <> ${lit(SECOND_OFFICE)}::uuid and length(title) between 14 and 90 limit 40`,
    )
  ).map((r) => String(r.t)),
  ...(
    await rows(
      `select distinct name t from public.projects where office_id <> ${lit(SECOND_OFFICE)}::uuid and not is_fixture and length(name) >= 8 limit 20`,
    )
  ).map((r) => String(r.t)),
].filter((t) => !/["\\\n]/.test(t))
const own = new Set(
  (
    await rows(
      `select title t from public.tasks where office_id = ${lit(SECOND_OFFICE)}::uuid union select title from public.documents where office_id = ${lit(SECOND_OFFICE)}::uuid union select name from public.projects where office_id = ${lit(SECOND_OFFICE)}::uuid`,
    )
  ).map((r) => String(r.t).toLowerCase()),
)
const canary = canaries.filter((t) => !own.has(t.toLowerCase()))
check(
  'canaries harvested from the other offices (a control with nothing to find proves nothing)',
  canary.length >= 20,
  `${canary.length}`,
)
const leaked = (text: string): string[] =>
  canary.filter((c) => text.toLowerCase().includes(c.toLowerCase()))
check(
  'CONTROL: the canary detector fires on text that names one, and not on text that does not',
  leaked(`we discussed ${canary[0] ?? 'x'} today`).length === 1 &&
    leaked('we discussed the venue today').length === 0,
)

// fingerprint of the other offices, before
const fingerprint = async (): Promise<string> =>
  String(
    (
      await rows(
        `select md5(string_agg(office_id::text || ':' || n::text, ',' order by office_id)) f from (
           select office_id, (select count(*) from public.tasks t where t.office_id = o.office_id)
                          + (select count(*) from public.documents d where d.office_id = o.office_id)
                          + (select count(*) from public.projects p where p.office_id = o.office_id) as n
             from public.offices o where office_id <> ${lit(SECOND_OFFICE)}::uuid and kind = 'person') x`,
      )
    )[0]?.f,
  )

// ---- the model cases -----------------------------------------------------------------------------------------------
const wanted = CASES.filter((c) => only.length === 0 || only.includes(c.id))
let retrievalOk = 0
let answerOk = 0
let delegated = 'not run'
let paused = false
try {
  if (wanted.length > 0 && !noPause) {
    await db.execute(
      `select cron.alter_job((select jobid from cron.job where jobname = 'worker-heartbeat'), active := false)`,
    )
    paused = true
    for (let i = 0; i < 18; i += 1) {
      const r = (await rows(`select count(*)::int n from public.jobs where state = 'running'`))[0]
      if (Number(r?.n) === 0) break
      await pause(10_000)
    }
  }
  const before = await fingerprint()
  const pass =
    wanted.length === 0
      ? null
      : await buildPass(db, WORKER, {
          max: 1,
          canTranscribe: false,
          canSubprocess: false,
          projectRef,
        })

  const ask = async (c: {
    id: string
    project: string | null
    ask: string
    to?: string
  }): Promise<{
    root: string
    prompts: string
    outputs: string
    tree: { job_id: string; kind: string; s: string; o: string }[]
  } | null> => {
    const projectId = c.project === null ? null : ids[c.project as keyof typeof ids]
    const cmd = (
      await rows(`
        insert into public.inbound_commands (office_id, origin_channel, origin_ref, actor, instruction, dedupe_key${projectId === null ? '' : ', project_id'}${c.to === undefined ? '' : ', addressed_to'})
        values (${lit(SECOND_OFFICE)}::uuid, 'telegram', ${lit(`intel-${run}-${c.id}`)}, ${lit(ACTOR)}, ${lit(c.ask)},
                ${lit(`telegram:message:intel-${run}-${c.id}`)}${projectId === null ? '' : `, ${lit(projectId)}::uuid`}${c.to === undefined ? '' : `, ${lit(c.to)}`})
        returning command_id::text as id`)
    )[0]
    const enq = (await rows(`select app.enqueue_inbound(${lit(String(cmd?.id))}::uuid) as j`))[0]
    const root = String(
      (typeof enq?.j === 'string' ? JSON.parse(enq.j) : (enq?.j ?? {}))?.job_id ?? enq?.j ?? '',
    )
    const attributed = (
      await rows(
        `select is_fixture f, office_id::text o from public.jobs where job_id = ${lit(root)}::uuid`,
      )
    )[0]
    // containment BEFORE the work, never after
    if (attributed?.f !== true || attributed?.o !== SECOND_OFFICE) {
      check(`${c.id}: the job is a fixture in the Sample office`, false, JSON.stringify(attributed))
      return null
    }
    const mark = sent.length
    const deadline = Date.now() + 7 * 60_000
    let idle = 0
    while (Date.now() < deadline && idle < 6) {
      const job: Job | null = await dequeue(db, WORKER, false, false, undefined, MINE)
      if (job === null) {
        idle += 1
        await db.execute(`select app.requeue_retrying()`)
        await pause(4_000)
        continue
      }
      idle = 0
      if (pass === null) return null
      await runJob(db, job, pass.handlers, pass.review)
    }
    const tree = (await rows(`
        with recursive t as (
          select job_id, kind, state, office_id from public.jobs where job_id = ${lit(root)}::uuid
          union all select j.job_id, j.kind, j.state, j.office_id from public.jobs j join t on j.parent_job_id = t.job_id)
        select job_id::text, kind, state::text s, office_id::text o from t`)) as {
      job_id: string
      kind: string
      s: string
      o: string
    }[]
    const outputs = (
      await rows(
        `select o.body from public.outputs o where o.job_id in (${tree.map((j) => lit(j.job_id)).join(',')})`,
      )
    )
      .map((o) => String(o.body))
      .join('\n')
    return { root, prompts: sent.slice(mark).join('\n'), outputs, tree }
  }

  for (const c of wanted) {
    const r = await ask(c)
    if (r === null) continue
    const seen = r.prompts
    const missing = c.prompt.filter((p) => !has(seen, p))
    const stray = [
      ...(c.absent ?? []).filter((a) => has(seen, a) || has(r.outputs, a)),
      ...leaked(`${seen}\n${r.outputs}`),
    ]
    const retr = missing.length === 0 && stray.length === 0
    if (retr) retrievalOk += 1
    check(
      `${c.id} RETRIEVAL: ${c.note}`,
      retr,
      retr
        ? `${c.prompt.length} expected item(s) were in the prompt${(c.absent?.length ?? 0) > 0 ? ', no other project material' : ''}`
        : `missing from prompt: ${missing.join(' | ').slice(0, 200)}${stray.length > 0 ? `; STRAY: ${stray.join(' | ').slice(0, 200)}` : ''}`,
    )
    if (process.env.DUMP === '1') {
      for (const body of sent.slice(sent.length - 2)) {
        try {
          const msgs =
            (JSON.parse(body) as { messages?: { role: string; content: unknown }[] }).messages ?? []
          for (const m of msgs)
            console.log(
              `     [${m.role}] ${String(
                typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              )
                .replace(/\s+/g, ' ')
                .slice(0, 420)}`,
            )
        } catch {
          /* not JSON: nothing to show */
        }
      }
    }
    if (c.forbidAnswer !== undefined)
      check(
        `${c.id} ANSWER does not deflect (${c.forbidAnswer.source.slice(0, 40)}…)`,
        !c.forbidAnswer.test(r.outputs),
        r.outputs.replace(/\s+/g, ' ').slice(0, 120),
      )
    if (c.wantAnswer !== undefined)
      check(
        `${c.id} ANSWER does the work`,
        c.wantAnswer.test(r.outputs),
        r.outputs.replace(/\s+/g, ' ').slice(0, 120),
      )
    const gotAnswer =
      r.outputs.trim() !== '' &&
      c.answer.every((a) => has(r.outputs, a)) &&
      (c.answer.length > 0 || c.prompt.length === 0 || c.prompt.some((t) => mentions(r.outputs, t)))
    if (gotAnswer) answerOk += 1
    console.log(
      `     ANSWER ${gotAnswer ? 'ok' : 'not as expected'} (model, not gated): ${r.outputs.replace(/\s+/g, ' ').slice(0, 170)}`,
    )
    if (process.env.INSPECT === '1') {
      const rd = await rows(
        `select d.intent_class, d.confident, d.roster::text r, d.roster_reason, d.intent_reason from public.routing_decisions d where d.job_id in (${r.tree.map((j) => lit(j.job_id)).join(',')}) order by d.decided_at`,
      )
      const who = await rows(
        `select j.kind, j.state::text s, coalesce(j.recipient_agent,'') w, (j.parent_job_id is not null) child from public.jobs j where j.job_id in (${r.tree.map((j) => lit(j.job_id)).join(',')}) order by j.created_at`,
      )
      console.log(
        `     TREE: ${who.map((x) => `${x.kind}/${x.s}/${x.w}${x.child ? '/child' : ''}`).join(', ')}`,
      )
      console.log(
        `     ROUTING: ${rd.map((x) => `${x.intent_class} conf=${x.confident} roster=${x.r} (${x.roster_reason}; ${x.intent_reason})`).join(' || ')}`,
      )
    }
    const tail = r.tree.every((j) => j.o === SECOND_OFFICE)
    check(
      `${c.id}: every job belongs to the Sample office`,
      tail,
      r.tree.map((j) => `${j.kind}:${j.s}`).join(','),
    )
  }

  // specialist delegation: the specialist must receive the project's material, not just the chief of staff
  if (only.length === 0 || only.includes('D1')) {
    const savings = String(
      (
        await rows(
          `select document_id::text d from public.documents where office_id = ${lit(SECOND_OFFICE)}::uuid and title = 'savings-account-comparison.csv' and state <> 'archived'`,
        )
      )[0]?.d,
    )
    const r = await ask({
      id: 'D1',
      project: FIN,
      ask: 'Please ask the finance director which savings account pays the highest rate and tell me what she says.',
    })
    if (r !== null) {
      const kids = r.tree.filter((j) => j.job_id !== r.root)
      const kidOutputs = (
        await rows(
          `select o.sources::text s, o.body from public.outputs o where o.job_id in (${(kids.length === 0 ? [r.root] : kids.map((k) => k.job_id)).map((x) => lit(x)).join(',')})`,
        )
      ).map((o) => `${String(o.s)} ${String(o.body)}`)
      delegated = kids.length > 0 ? `${kids.length} specialist job(s)` : 'none convened this run'
      check(
        'D1 RETRIEVAL: a specialist job (or the chief of staff, if nobody was convened) was shown the savings document',
        has(r.prompts, 'Harbour Mutual,One-year fixed,4.6') &&
          kidOutputs.some((o) => o.includes(savings) || has(o, '4.6')),
        delegated,
      )
      check(
        'D1: nothing from another project reached the specialist',
        !has(r.prompts, 'Sprung floor') && leaked(r.prompts).length === 0,
      )
      console.log(`     ANSWER (model, not gated): ${r.outputs.replace(/\s+/g, ' ').slice(0, 200)}`)
    }
  }

  const after = await fingerprint()
  check(
    "the other offices' tasks, documents and projects are unchanged by the run",
    before === after,
    `${before} -> ${after}`,
  )
} finally {
  await db.execute(
    `update public.jobs set state = 'cancelled', finished_at = app.now_utc(), state_reason = 'intelligence benchmark teardown' where requested_by = ${lit(MINE)} and state in ('queued','retrying','paused')`,
  )
  if (paused)
    await db.execute(
      `select cron.alter_job((select jobid from cron.job where jobname = 'worker-heartbeat'), active := true)`,
    )
  globalThis.fetch = realFetch
}
const failed = results.filter((r) => !r.ok)
console.log(
  `\nRETRIEVAL ${retrievalOk}/${wanted.length}   ANSWER (model) ${answerOk}/${wanted.length}   delegation: ${delegated}`,
)
console.log(`${results.length - failed.length}/${results.length} checks passed`)
process.exitCode = failed.length === 0 ? 0 : 1
