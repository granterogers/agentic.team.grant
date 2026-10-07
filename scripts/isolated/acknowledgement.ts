/**
 * #374 — an acknowledgement is not an authorisation, on every channel.
 *
 *   npx tsx scripts/isolated/acknowledgement.ts <replica-db>
 *
 * The REAL `office.instruction` handler, run against the isolated replica.
 * Each case is a two-turn conversation on one channel:
 *
 *   turn 1 raised a question (a blocker with "Yes, do it" / "No, leave it");
 *   turn 2 is the reply under test.
 *
 * The property is read from canonical state — the blocker row — not from the
 * prose: an acknowledgement leaves it OPEN and the reply asks; an explicit yes
 * or no resolves it with that option. The model is a stand-in that returns an
 * empty object, so every model-mediated path degrades and only the
 * deterministic reading can act. Nothing is sent: no notifier is constructed.
 */

import { instructionHandler } from '../../src/handlers/instruction.ts'
import { raiseBlocker } from '../../src/inference/record.ts'
import type { Job } from '../../src/jobs/worker.ts'
import { scopeOf } from './fixtures-jobs.ts'
import { isolated } from './guard.ts'
import { markShown } from './fixtures-approvals.ts' // the office-carrying copy: shown.ts predates deliveries.office_id
import { chatFor } from './shown.ts'

const db = await isolated(process.argv[2] ?? 'ack374')
const run = Date.now().toString(36)
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

const router = {
  complete: async () => ({ content: '{}', model: 'isolated/stand-in' }),
} as never
const handler = instructionHandler({ db, router })

let seq = 0
const turn = async (channel: string, chat: string, said: string): Promise<Job> => {
  seq += 1
  const cmd = await one(`
    insert into public.inbound_commands (${scopeOf('real').cols}, origin_channel, origin_ref, actor, instruction, dedupe_key, subject)
    values (${scopeOf('real').vals}, ${lit(channel)},${lit(`${chat}:${String(seq)}`)}, 'grant', ${lit(said)},
            ${lit(`${channel}:ack_proof:${run}.${String(seq)}`)}, 'grant')
    returning command_id::text as id`)
  const enq = await one(`select app.enqueue_inbound(${lit(String(cmd.id))}::uuid) as v`)
  const v = (typeof enq.v === 'string' ? JSON.parse(enq.v) : enq.v) as { job_id?: string }
  if (v.job_id === undefined) throw new Error(`enqueue refused: ${JSON.stringify(enq.v)}`)
  const j = await one(`select job_id::text as id, kind, correlation_id::text as c,
      project_id::text as p, idempotency_key as k from public.jobs where job_id = ${lit(v.job_id)}::uuid`)
  return {
    jobId: String(j.id),
    kind: String(j.kind),
    correlationId: String(j.c),
    projectId: j.p === null ? null : String(j.p),
    idempotencyKey: String(j.k),
    attempt: 1,
  } as Job
}

const CASES: { reply: string; want: 'open' | 'Yes, do it' | 'No, leave it' }[] = [
  { reply: 'ok thanks', want: 'open' },
  { reply: 'Thanks!', want: 'open' },
  { reply: 'cheers', want: 'open' },
  { reply: '👍', want: 'open' },
  { reply: 'ok', want: 'open' },
  { reply: 'yes please', want: 'Yes, do it' },
  { reply: 'ok, go ahead', want: 'Yes, do it' },
  { reply: 'no thanks', want: 'No, leave it' },
]
const CHANNELS = ['teamhq', 'telegram', 'slack', 'voice']

for (const channel of CHANNELS) {
  for (const c of CASES) {
    const chat = chatFor(run, channel, seq)
    const asking = await turn(channel, chat, 'Draft the renewal note and send it to the venue.')
    /* As in production: the question is raised by the office.pursue job the
       turn started, a CHILD of it (conversation_before counts exactly those). */
    const child = String(
      (
        await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, parent_job_id)
          select office_id, 'office.pursue', requested_by, project_id, 'ack374-' || gen_random_uuid(), correlation_id, job_id
            from public.jobs where job_id = ${lit(asking.jobId)}::uuid
          returning job_id::text as id`)
      ).id,
    )
    const blocker = await raiseBlocker(db, {
      jobId: child,
      requestedAction: 'Send the renewal note to the venue',
      whyNeeded: 'isolated proof #374',
      consequencesOfDelay: 'none',
      approvalOptions: ['Yes, do it', 'No, leave it'],
      originatingAgent: 'chief-of-staff',
      workCanContinue: false,
    } as never)
    void blocker
    // As in production: the question reached him (0622, #394).
    await markShown(db, channel, chat, child)
    const reply = await turn(channel, chat, c.reply)
    let body = ''
    let thrown = ''
    try {
      body = (await handler.handle(reply, db)).body
    } catch (e) {
      thrown = String((e as Error).message).slice(0, 160)
    }
    const b = await one(`select state::text as s, resolution from public.blockers
      where job_id = ${lit(child)}::uuid order by created_at desc limit 1`)
    /* The resolution is stored as "<option> — answered by grant". */
    const got = b.s === 'open' ? 'open' : String(b.resolution ?? b.s).split(' — ')[0]
    const asked = c.want !== 'open' || /have not acted/.test(body)
    check(
      `${channel} · "${c.reply}" → ${c.want}`,
      got === c.want && asked && thrown === '',
      `blocker ${got}${thrown === '' ? '' : `; threw ${thrown}`}; said ${JSON.stringify(body.slice(0, 110))}`,
    )
  }
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
