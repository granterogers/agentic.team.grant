/**
 * #374, multi-turn — an acknowledgement keeps the question, and the NEXT reply
 * answers that same question (production acceptance, 28 September 2026).
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
import { markShown } from './fixtures-approvals.ts' // the office-carrying copy: shown.ts predates deliveries.office_id
import { scopeOf } from './fixtures-jobs.ts'
import { isolated } from './guard.ts'
import { chatFor } from './shown.ts'

const db = await isolated(process.argv[2] ?? 'seq374')
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
            ${lit(`${channel}:ack_seq_proof:${run}.${String(seq)}`)}, 'grant')
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

/* A question raised by a turn's own office.pursue child, as in production. */
const ask = async (channel: string, chat: string, what: string): Promise<string> => {
  const asking = await turn(channel, chat, `Draft the note about ${what} and send it.`)
  const child = String(
    (
      await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, parent_job_id)
        select office_id, 'office.pursue', requested_by, project_id, 'seq374-' || gen_random_uuid(), correlation_id, job_id
          from public.jobs where job_id = ${lit(asking.jobId)}::uuid
        returning job_id::text as id`)
    ).id,
  )
  const raised = String(
    await raiseBlocker(db, {
      jobId: child,
      requestedAction: `Send the note about ${what}`,
      whyNeeded: 'isolated proof #374 sequence',
      consequencesOfDelay: 'none',
      approvalOptions: ['Yes, do it', 'No, leave it'],
      originatingAgent: 'chief-of-staff',
      workCanContinue: false,
    } as never),
  )
  // As in production: the question reached him, AFTER it was raised (0622, #394).
  await markShown(db, channel, chat, child)
  return raised
}
const reply = async (channel: string, chat: string, said: string): Promise<string> => {
  const j = await turn(channel, chat, said)
  try {
    return (await handler.handle(j, db)).body
  } catch (e) {
    return `THREW ${String((e as Error).message).slice(0, 140)}`
  }
}
/* The blocker as canonical state: open, or the option it was resolved with. */
const held = async (blocker: string): Promise<string> => {
  const b = await one(
    `select state::text as s, resolution from public.blockers where blocker_id = ${lit(blocker)}::uuid`,
  )
  return b.s === 'open' ? 'open' : (String(b.resolution ?? b.s).split(' — ')[0] ?? '')
}
/* Times the question was answered: the resolution is written once, by the
   single update in hq_answer_blocker, and 0596 locks the row around it. */
const resolvedCount = async (blocker: string): Promise<number> =>
  Number(
    (
      await one(`select count(*)::int as n from public.blockers
        where blocker_id = ${lit(blocker)}::uuid and state = 'resolved'`)
    ).n,
  )

for (const channel of ['teamhq', 'telegram', 'slack', 'voice']) {
  const tag = (s: string) => `${channel} · ${s}`

  /* 1. question -> "ok thanks" -> clarification -> "yes please" */
  {
    const chat = chatFor(run, channel, 1)
    const q = await ask(channel, chat, 'the venue')
    const r1 = await reply(channel, chat, 'ok thanks')
    check(tag('"ok thanks" leaves the question open'), (await held(q)) === 'open', await held(q))
    check(tag('and the office says it has not acted'), /have not acted/.test(r1), r1.slice(0, 90))
    const r2 = await reply(channel, chat, 'yes please')
    check(
      tag('"yes please" then resolves THAT question as yes'),
      (await held(q)) === 'Yes, do it',
      `${await held(q)}; said ${r2.slice(0, 80)}`,
    )
    const r3 = await reply(channel, chat, 'yes')
    check(
      tag('exactly once: a further "yes" answers nothing more'),
      (await held(q)) === 'Yes, do it' &&
        (await resolvedCount(q)) === 1 &&
        !/Taken as a yes/.test(r3),
      r3.slice(0, 80),
    )
  }

  /* 2. question -> "ok thanks" -> clarification -> "no thanks" */
  {
    const chat = chatFor(run, channel, 2)
    const q = await ask(channel, chat, 'the caterer')
    await reply(channel, chat, 'ok thanks')
    await reply(channel, chat, 'no thanks')
    check(
      tag('"no thanks" after the clarification declines it'),
      (await held(q)) === 'No, leave it',
      await held(q),
    )
  }

  /* 3. question -> "ok thanks" -> a contradiction: stays open */
  {
    const chat = chatFor(run, channel, 3)
    const q = await ask(channel, chat, 'the printer')
    await reply(channel, chat, 'ok thanks')
    await reply(channel, chat, 'no, go ahead')
    check(
      tag('a contradiction after the clarification leaves it open'),
      (await held(q)) === 'open',
      await held(q),
    )
  }

  /* 4. STALE: an old question, an unrelated turn, then "yes please" */
  {
    const chat = chatFor(run, channel, 4)
    const q = await ask(channel, chat, 'the minibus')
    await reply(channel, chat, 'What is on the list for tomorrow?')
    await reply(channel, chat, 'yes please')
    check(
      tag('CONTROL: an old question behind an unrelated turn is not selected'),
      (await held(q)) === 'open',
      await held(q),
    )
  }

  /* 5. STALE: bound by "ok thanks", then answered elsewhere; "yes please" must not re-answer */
  {
    const chat = chatFor(run, channel, 5)
    const q = await ask(channel, chat, 'the florist')
    await reply(channel, chat, 'ok thanks')
    await db.execute(
      `select app.hq_answer_blocker(coalesce((select zz_o.office_id from public.blockers zz_o where zz_o.blocker_id = ${lit(q)}::uuid), app.test_office()), ${lit(q)}::uuid, 'No, leave it', 'grant')`,
    )
    const r = await reply(channel, chat, 'yes please')
    check(
      tag('CONTROL: a bound question answered elsewhere is not answered again'),
      (await held(q)) === 'No, leave it' && !/Taken as a yes/.test(r),
      `${await held(q)}; said ${r.slice(0, 80)}`,
    )
  }

  /* 6. The binding does not cross chats. */
  {
    const chatA = chatFor(run, channel, 6)
    const chatB = chatFor(run, channel, 7)
    const q = await ask(channel, chatA, 'the tent')
    await reply(channel, chatA, 'ok thanks')
    await reply(channel, chatB, 'yes please')
    check(
      tag('CONTROL: another chat\'s "yes please" cannot reach this question'),
      (await held(q)) === 'open',
      await held(q),
    )
  }
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
