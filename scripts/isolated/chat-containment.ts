/**
 * #378 sibling (0602) — a harness turn is not in Grant's chat.
 *
 *   npx tsx scripts/isolated/chat-containment.ts <replica-db>
 *
 * On a REAL project, through the REAL doors: a voice-door turn from a
 * `verify-...` session (harness by app.harness_job, real by is_fixture) and a
 * Telegram turn from his chat, each with an answer. The reader the Chat is
 * drawn from must show the second pair and not the first.
 */
import { isolated } from './guard.ts'
import { realTelegramKey, registerBot } from './real-telegram.ts'

const db = await isolated(process.argv[2] ?? 'chat378')
await registerBot(db)
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const made = await one(`select app.hq_create_project(${lit(`Chat proof ${run}`)}, 'upload',
  ${lit(`chat-${run}`)}, ${lit(`Chat proof ${run}`)}, true) as v`)
const project = String((made.v as { project_id?: string }).project_id ?? '')
const p = await one(
  `select is_fixture from public.projects where project_id = ${lit(project)}::uuid`,
)
check(
  'precondition: the project is a real one',
  p.is_fixture === false,
  `is_fixture ${String(p.is_fixture)}`,
)

const turn = async (channel: string, key: string, ref: string, words: string): Promise<string> => {
  const cmd = await one(`
    set local application_name = 'PostgREST 14.5';
    insert into public.inbound_commands (origin_channel, origin_ref, actor, instruction, dedupe_key, subject, project_id)
    values (${lit(channel)}, ${lit(ref)}, 'grant', ${lit(words)}, ${lit(key)}, 'grant', ${lit(project)}::uuid)
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const job = String(
    ((typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id: string }).job_id,
  )
  await db.execute(`insert into public.outputs (job_id, body, confidence, evidence, sources, deterministic)
    values (${lit(job)}::uuid, ${lit(`Answer to ${words}`)}, 'medium', 'inferred', '[]'::jsonb, true)`)
  return job
}
const h = await turn(
  'voice',
  `voice:turn:verify-378h-${run}.1`,
  `verify-378h-${run}/x:1`,
  `harness asks ${run}`,
)
const r = await turn(
  'telegram',
  realTelegramKey(),
  `1386648496:${String(Date.now() % 100000)}`,
  `Grant asks ${run}`,
)
const c =
  await one(`select app.harness_job(${lit(h)}::uuid) as h, app.harness_job(${lit(r)}::uuid) as r,
  (select is_fixture from public.jobs where job_id = ${lit(h)}::uuid) as f`)
check(
  'precondition: harness by the canonical predicate, real by is_fixture',
  c.h === true && c.f === false && c.r === false,
  `harness_job ${String(c.h)}/${String(c.r)}, is_fixture ${String(c.f)}`,
)

const hist = (
  await one(`select app.conversation_history(app.test_office(), ${lit(project)}::uuid, 100) as v`)
).v as {
  body: string
  kind: string
}[]
const shown = (s: string) => hist.filter((m) => String(m.body).includes(s)).map((m) => m.kind)
check(
  'the harness question and its answer are not in the chat',
  shown(`harness asks ${run}`).length === 0,
  `shown: ${JSON.stringify(shown(`harness asks ${run}`))}`,
)
check(
  "control: Grant's question and its answer are",
  JSON.stringify(shown(`Grant asks ${run}`).sort()) === JSON.stringify(['answered', 'said']),
  `shown: ${JSON.stringify(shown(`Grant asks ${run}`))}`,
)

const failed = results.filter((x) => !x.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
