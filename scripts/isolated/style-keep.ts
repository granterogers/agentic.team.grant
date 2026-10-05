/**
 * "Use this report's style for this project", said in a conversation (HQ-STYLE-018) - on a marked LOCAL replica, inside
 * one transaction that is rolled back.
 *
 *   env -u SUPABASE_ACCESS_TOKEN -u SUPABASE_PROJECT_REF -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_DB_URL \
 *     npx tsx scripts/isolated/style-keep.ts [replica-db]
 *
 * Drives the REAL `office.instruction` handler (model degraded to `{}`, so only the deterministic readers act) and the
 * real `style.adopt` handler. Every statement the handlers send is RECORDED, which is how it asserts that the
 * conversation reaches the viewer button's own function exactly once and that nothing else writes a project style.
 * No network, no model, no production.
 */
import { instructionHandler } from '../../src/handlers/instruction.ts'
import { styleAdoptHandler } from '../../src/handlers/style-adopt.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { isolated } from './guard.ts'

const real = await isolated(process.argv[2] ?? 'cand_goog2')
type Row = Record<string, unknown>
const sent: string[] = []
// The handlers get a recording executor; the proof's own reads go straight to the replica.
const db = new Proxy(real, {
  get(target, prop, receiver) {
    if (prop === 'execute') {
      return async (sql: string, ...rest: unknown[]) => {
        sent.push(sql)
        return (target.execute as (s: string, ...r: unknown[]) => Promise<unknown>)(sql, ...rest)
      }
    }
    const v = Reflect.get(target, prop, receiver)
    return typeof v === 'function' ? v.bind(target) : v
  },
})
const q = async (sql: string): Promise<Row[]> => (await real.execute(sql)).rows as Row[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}
const OFFICE = String((await q('select app.test_office()::text o'))[0]?.o)
const OTHER = String(
  (await q(`select office_id::text o from public.offices where kind = 'person' limit 1`))[0]?.o,
)
const run = Math.random().toString(36).slice(2, 8)
const handler = instructionHandler({
  db,
  router: { complete: async () => ({ content: '{}', model: 'isolated/stand-in' }) } as never,
})
const adopter = styleAdoptHandler(db)
const ADOPT = 'app.style_adopt_from_document'
const adoptCalls = (): number => sent.filter((s) => s.includes(ADOPT)).length
const writes = (): string[] =>
  sent.filter((s) => /\b(insert\s+into|update|delete\s+from)\s+public\.style_profiles\b/i.test(s))

await q('begin')
try {
  const project = async (slug: string): Promise<string> =>
    String(
      (
        await q(
          `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(OFFICE)}::uuid) returning project_id::text id`,
        )
      )[0]?.id,
    )
  const SLUG = `stylekeep-${run}`
  const P = await project(SLUG)
  const EMPTY = await project(`${SLUG}-empty`)

  let seq = 0
  let tick = 0
  const say = async (
    chat: string,
    said: string,
    opts: { project?: string; forwarded?: boolean } = {},
  ): Promise<Job> => {
    seq += 1
    const cmd = (
      await q(`insert into public.inbound_commands
        (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, context, office_id, project_id)
        values ('teamhq', ${lit(`${chat}:${String(seq)}`)}, 'grant', ${lit(said)},
                ${lit(`teamhq:stylekeep:${run}.${String(seq)}`)}, 'grant',
                ${lit(JSON.stringify(opts.forwarded === true ? { forwarded: true } : {}))}::jsonb,
                ${lit(OFFICE)}::uuid, ${lit(opts.project ?? P)}::uuid)
        returning command_id::text as id`)
    )[0] as Row
    const enq = (await q(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`))[0] as Row
    const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }
    await q(
      `update public.jobs set project_id = ${lit(opts.project ?? P)}::uuid where job_id = ${lit(v.job_id)}::uuid`,
    )
    const j = (
      await q(`select job_id::text as id, kind, correlation_id::text as c, project_id::text as p,
                      idempotency_key as k from public.jobs where job_id = ${lit(v.job_id)}::uuid`)
    )[0] as Row
    return {
      jobId: String(j.id),
      kind: String(j.kind),
      correlationId: String(j.c),
      projectId: j.p === null ? null : String(j.p),
      idempotencyKey: String(j.k),
      attempt: 1,
    } as Job
  }
  const turn = async (
    chat: string,
    said: string,
    opts: { project?: string; forwarded?: boolean } = {},
  ) => {
    const before = sent.length
    const job = await say(chat, said, opts)
    const out = await handler.handle(job, db)
    return { job, body: out.body, asks: out.asksBlocker, sent: sent.slice(before) }
  }

  // ---- fixtures: three made reports, one produced in THIS conversation ------------------------------------------------
  const CHAT = `kc${run}`
  const anchor = await say(CHAT, 'Write me a PDF report on pricing.')
  const doc = async (
    title: string,
    job: string | null,
    snapshot: object | null,
  ): Promise<string> => {
    const id = String(
      (
        await q(`insert into public.documents
          (office_id, project_id, title, doc_type, origin, state, storage_path, mime_type, byte_size, produced_by_job, created_at)
          values (${lit(OFFICE)}::uuid, ${lit(P)}::uuid, ${lit(title)}, 'report', 'made', 'approved',
                  ${lit(`files/${run}/${Math.random().toString(36).slice(2)}.pdf`)}, 'application/pdf', 2048,
                  ${job === null ? 'null' : `${lit(job)}::uuid`}, now() - interval '2 day' + (${String(++tick)} * interval '1 second'))
          returning document_id::text id`)
      )[0]?.id,
    )
    if (snapshot !== null) {
      const r = (
        await q(`select app.document_provenance_record(${lit(OFFICE)}::uuid, ${lit(id)}::uuid, ${job === null ? 'null' : `${lit(job)}::uuid`},
                  'h', now(), '{}'::jsonb, '[]'::jsonb, ${lit(JSON.stringify(snapshot))}::jsonb) as r`)
      )[0]?.r
      const parsed = (typeof r === 'string' ? JSON.parse(r) : r) as { snapshot?: boolean }
      if (parsed?.snapshot !== true)
        throw new Error(`fixture snapshot refused: ${JSON.stringify(r)}`)
    }
    return id
  }
  const SNAP_A = {
    palette: { primary: '#117755' },
    formatting: { title_page: 'band' },
    tone: 'Warm',
  }
  const SNAP_B = { palette: { primary: '#aa3322' }, tone: 'Stern' }
  const A = await doc('Pricing review', anchor.jobId, SNAP_A)
  const B = await doc('Onboarding findings', null, SNAP_B)
  const C = await doc('Legacy summary', null, null)
  const style = async (): Promise<Row | null> =>
    ((
      await q(
        `select profile p from public.style_profiles where scope = 'project' and project_id = ${lit(P)}::uuid`,
      )
    )[0]?.p ?? null) as Row | null

  const cands = (
    await q(`select app.style_source_candidates(${lit(OFFICE)}::uuid, ${lit(SLUG)}, null) c`)
  )[0]?.c as Array<{ document_id: string }>
  check(
    'the candidate reader lists the three made reports',
    cands.length === 3,
    String(cands.length),
  )
  check(
    'the candidate reader says nothing for another office',
    JSON.stringify(
      (await q(`select app.style_source_candidates(${lit(OTHER)}::uuid, ${lit(SLUG)}, null) c`))[0]
        ?.c,
    ) === '[]',
  )

  // ---- 1. "this report" = the one this conversation produced; no style yet -> saved --------------------------------
  const t1 = await turn(CHAT, "Use this report's style for this project.")
  const s1 = await style()
  check(
    'this report: the one made in THIS conversation is saved as the project style',
    (s1 as { palette?: { primary?: string }; source?: { document_id?: string } } | null)?.palette
      ?.primary === '#117755' &&
      (s1 as { source?: { document_id?: string } } | null)?.source?.document_id === A,
    t1.body.slice(0, 160),
  )
  check(
    'it says so, in words',
    /^Saved\b/.test(t1.body) && t1.body.includes('Pricing review'),
    t1.body.slice(0, 200),
  )
  check(
    'the SAME function was called, once, and nothing else wrote a project style',
    t1.sent.filter((s) => s.includes(ADOPT)).length === 1 && writes().length === 0,
    `${String(t1.sent.filter((s) => s.includes(ADOPT)).length)} call(s), ${String(writes().length)} style_profiles writes`,
  )
  const ev = await q(
    `select count(*)::int n from public.events where action_type = 'style.updated' and project_id = ${lit(P)}::uuid`,
  )
  check('and it left the same Activity row the button leaves', Number(ev[0]?.n) === 1)

  // ---- 2. a project that has a style: ASK, and change nothing -------------------------------------------------------
  const before2 = JSON.stringify(await style())
  const t2 = await turn(CHAT, "Use the onboarding report's style for this project.")
  check(
    'existing style: the style is NOT replaced, and the reply says nothing has changed yet',
    JSON.stringify(await style()) === before2 &&
      /Nothing has been changed yet/.test(t2.body) &&
      /yes/i.test(t2.body),
    t2.body.slice(0, 220),
  )
  const open = await q(
    `select blocker_id::text id, approval_options o, on_answer a, state from public.blockers where job_id = ${lit(t2.job.jobId)}::uuid`,
  )
  check(
    'a question is open whose YES carries the confirmed replace, and the reply is bound to it',
    open.length === 1 &&
      open[0]?.state === 'open' &&
      t2.asks === open[0]?.id &&
      (
        open[0]?.a as {
          kind?: string
          payloads?: Array<{ confirm?: boolean; document_id?: string }>
        }
      )?.kind === 'style.adopt' &&
      (open[0]?.a as { payloads?: Array<{ confirm?: boolean; document_id?: string }> })
        ?.payloads?.[0]?.confirm === true &&
      (open[0]?.a as { payloads?: Array<{ document_id?: string }> })?.payloads?.[0]?.document_id ===
        B,
    JSON.stringify(open[0]?.a),
  )
  check(
    'silence changes nothing: the style is still the first one',
    JSON.stringify(await style()) === before2,
  )
  const no = await q(
    `select app.hq_answer_blocker(app.job_office(${lit(t2.job.jobId)}::uuid), ${lit(String(open[0]?.id))}::uuid, 'No, keep the current style', 'grant') r`,
  )
  const kids = await q(
    `select count(*)::int n from public.jobs where kind = 'style.adopt' and parent_job_id = ${lit(t2.job.jobId)}::uuid`,
  )
  check(
    'NO: answered, no job started, the style is untouched',
    JSON.stringify(await style()) === before2 && Number(kids[0]?.n) === 0,
    JSON.stringify(no[0]?.r).slice(0, 120),
  )

  // ---- 3. asked again, and YES performs it through the job ----------------------------------------------------------
  const t3 = await turn(CHAT, "Use the onboarding report's style for this project.")
  const open3 = await q(
    `select blocker_id::text id from public.blockers where job_id = ${lit(t3.job.jobId)}::uuid and state = 'open'`,
  )
  const yes = await q(
    `select app.hq_answer_blocker(app.job_office(${lit(t3.job.jobId)}::uuid), ${lit(String(open3[0]?.id))}::uuid, 'Yes, replace the project style', 'grant') r`,
  )
  const child = await q(
    `select job_id::text id, kind from public.jobs where parent_job_id = ${lit(t3.job.jobId)}::uuid and kind = 'style.adopt'`,
  )
  check(
    'YES: the answer started exactly one style.adopt job',
    child.length === 1,
    JSON.stringify(yes[0]?.r).slice(0, 120),
  )
  const beforeJob = adoptCalls()
  const out = await adopter.handle(
    {
      jobId: String(child[0]?.id),
      kind: 'style.adopt',
      correlationId: 'x',
      projectId: P,
      idempotencyKey: 'k',
      attempt: 1,
    } as Job,
    db,
  )
  const s3 = (await style()) as {
    palette?: { primary?: string }
    source?: { document_id?: string }
  } | null
  check(
    "the job replaced the style with the onboarding report's, through the same function",
    s3?.palette?.primary === '#aa3322' &&
      s3?.source?.document_id === B &&
      adoptCalls() === beforeJob + 1 &&
      /replaced/.test(out.body),
    out.body.slice(0, 200),
  )

  // ---- 3b. a spoken yes: it answers the question only when it can tell WHICH message it answers ---------------------
  {
    const t = await turn(CHAT, "Use the pricing review's style for this project.")
    const snap = JSON.stringify(await style())
    const yesTurn = await turn(CHAT, 'Yes')
    const started = await q(
      `select count(*)::int n from public.jobs where kind = 'style.adopt' and parent_job_id = ${lit(t.job.jobId)}::uuid`,
    )
    const claimed = /going ahead now/.test(yesTurn.body)
    check(
      'spoken yes: either it binds and starts the one job, or it says it has not answered - never a silent replace',
      claimed
        ? Number(started[0]?.n) === 1
        : Number(started[0]?.n) === 0 && JSON.stringify(await style()) === snap,
      yesTurn.body.slice(0, 200),
    )
  }

  // ---- 4. which report? two in this conversation -> ASK, never choose ----------------------------------------------
  const chat2 = `kd${run}`
  const first = await say(chat2, 'Write me two reports.')
  const D1 = await doc('Alpha plan', first.jobId, SNAP_A)
  const D2 = await doc('Beta plan', first.jobId, SNAP_B)
  const beforeAsk = JSON.stringify(await style())
  const callsBefore = adoptCalls()
  const t4 = await turn(chat2, 'Save this as the project report style.')
  check(
    'ambiguous: it asks which, naming both, and changes nothing',
    /Which report/.test(t4.body) &&
      t4.body.includes('Alpha plan') &&
      t4.body.includes('Beta plan') &&
      JSON.stringify(await style()) === beforeAsk &&
      adoptCalls() === callsBefore,
    t4.body.slice(0, 240),
  )
  void D1
  void D2

  // ---- 5. a report made before styles were recorded: honest ----------------------------------------------------------
  const t5 = await turn(CHAT, "Use the legacy summary report's style for this project.")
  check(
    'no snapshot: it says so, nothing changed',
    /I did not save a style/.test(t5.body) &&
      /before its style was recorded/.test(t5.body) &&
      JSON.stringify(await style()) === JSON.stringify(s3),
    t5.body.slice(0, 220),
  )
  void C

  // ---- 6. no reports at all ----------------------------------------------------------------------------------------
  const t6 = await turn(`ke${run}`, "Use this report's style for this project.", { project: EMPTY })
  check(
    'no reports: it says there is none',
    /no report made in this project/.test(t6.body),
    t6.body.slice(0, 160),
  )

  // ---- 7. negative controls: the same turn machinery, other sentences ------------------------------------------------
  for (const said of [
    'Save this as a PDF.',
    'Use a different style for this project.',
    'Make this report longer.',
  ]) {
    const calls = adoptCalls()
    const snap = JSON.stringify(await style())
    await turn(CHAT, said)
    check(
      `negative: "${said}" does not touch a style`,
      adoptCalls() === calls && JSON.stringify(await style()) === snap,
    )
  }

  // ---- 8. a forwarded message is content, not an instruction --------------------------------------------------------
  {
    const calls = adoptCalls()
    const snap = JSON.stringify(await style())
    await turn(CHAT, "Use this report's style for this project.", { forwarded: true })
    check(
      'forwarded: the same words, forwarded, save nothing',
      adoptCalls() === calls && JSON.stringify(await style()) === snap,
    )
  }

  // ---- 9. only the one door writes a style, and the registry claim is checkable --------------------------------------
  check('the handlers never wrote style_profiles themselves', writes().length === 0)
  const reg = (
    await q(
      `select enabled, level, delivered_by, in_reply from public.tool_permissions where tool = 'style.save'`,
    )
  )[0]
  check(
    'registry: style.save is level 1, enabled, and its delivered_by names the real performer',
    reg?.enabled === true &&
      Number(reg?.level) === 1 &&
      String(reg?.delivered_by).includes('style.adopt') &&
      String(reg?.delivered_by).includes('app.style_adopt_from_document'),
    String(reg?.delivered_by),
  )
  const granted = (
    await q(
      `select count(distinct staff_slug)::int n from public.staff_tools where tool = 'style.save' and office_id = ${lit(OTHER)}::uuid`,
    )
  )[0]
  const holders = (
    await q(
      `select count(distinct staff_slug)::int n from public.staff_tools where tool = 'db.read' and office_id = ${lit(OTHER)}::uuid`,
    )
  )[0]
  check(
    'registry: granted to everyone who holds db.read',
    Number(granted?.n) === Number(holders?.n) && Number(granted?.n) > 0,
  )
} finally {
  await q('rollback')
  const left = (
    await q(`select (select count(*) from public.projects where slug like 'stylekeep-%')::int p`)
  )[0]
  check('rolled back: nothing from this run remains', Number(left?.p) === 0)
  await real.end()
}
console.log(failed === 0 ? '\nall checks passed' : `\n${String(failed)} check(s) FAILED`)
process.exitCode = failed === 0 ? 0 : 1
