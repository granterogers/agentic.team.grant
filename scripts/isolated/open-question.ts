/**
 * Run 1 (B3) - an open question outranks generic conversation, on every channel.
 *
 *   npx tsx scripts/isolated/open-question.ts <replica-db>
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
import { markShown, realTurn } from './fixtures-approvals.ts'
import { isolated } from './guard.ts'
import { chatFor } from './shown.ts'

const db = await isolated(process.argv[2] ?? 'openq')
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
  // The turn as the production adapter writes it (a recognised dedupe key, the PostgREST door), not a made-up key.
  const v = await realTurn(db, {
    channel: channel === 'telegram' ? 'telegram' : 'teamhq',
    text: said,
    chat,
  }).then((t) => ({ job_id: t.job }))
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

type Want = 'open' | 'Yes, do it' | 'No, leave it'
/*
  The property, per reply, read from the blocker row and never from the prose:
    - a reply that ANSWERS the open question resolves it with that option;
    - an acknowledgement, a close, a rejection that names nothing, or noise
      leaves it OPEN (and never approves it).
  "No." is the audit's B3: a bare no was claimed by the generic rejection gate
  ("What did I get wrong?") before the open question saw it.
*/
const CASES: { reply: string; want: Want }[] = [
  { reply: 'No.', want: 'No, leave it' },
  { reply: 'no', want: 'No, leave it' },
  { reply: 'No!', want: 'No, leave it' },
  { reply: 'Nope.', want: 'No, leave it' },
  { reply: 'nah', want: 'No, leave it' },
  { reply: 'No thanks.', want: 'No, leave it' },
  { reply: 'Not now.', want: 'No, leave it' },
  { reply: 'No, leave it', want: 'No, leave it' },
  { reply: 'Yes.', want: 'Yes, do it' },
  { reply: 'yes', want: 'Yes, do it' },
  { reply: 'Yes, go ahead.', want: 'Yes, do it' },
  { reply: 'Do that.', want: 'Yes, do it' },
  // acknowledgements and closes answer nothing (#374), whatever they sound like
  { reply: 'Thanks.', want: 'open' },
  { reply: 'Good.', want: 'open' },
  { reply: 'Perfect.', want: 'open' },
  { reply: 'Fine.', want: 'open' },
  { reply: 'Right.', want: 'open' },
  { reply: 'ok thanks', want: 'open' },
  { reply: "That's all, thanks.", want: 'open' },
  // a rejection that names nothing is not a yes; it leaves the question open
  { reply: "That's not what I meant.", want: 'open' },
  // noise
  { reply: 'banana', want: 'open' },
]
const CHANNELS = (process.env.CHANNELS ?? 'teamhq,telegram').split(',')

for (const channel of CHANNELS) {
  for (const c of CASES) {
    const chat = chatFor(run, channel, seq)
    const asking = await turn(channel, chat, 'Draft the renewal note and send it to the venue.')
    /* As in production: the question is raised by the office.pursue job the
       turn started, a CHILD of it (conversation_before counts exactly those). */
    const child = String(
      (
        await one(`insert into public.jobs (office_id, kind, requested_by, project_id, idempotency_key, correlation_id, parent_job_id)
          select office_id, 'office.pursue', requested_by, project_id, 'openq-' || gen_random_uuid(), correlation_id, job_id
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
    check(
      `${channel} · "${c.reply}" → ${c.want}`,
      got === c.want && thrown === '',
      `blocker ${got}${thrown === '' ? '' : `; threw ${thrown}`}; said ${JSON.stringify(body.slice(0, 110))}`,
    )
  }
}

/*
  The negative control, and it matters as much as the fix: with NOTHING waiting
  on him, a bare rejection is still the generic one ("what did I get wrong?"),
  because the precedence is by state and a fix that made every "No." an answer
  would have bought recall with precision.
*/
for (const channel of CHANNELS) {
  for (const reply of ['No.', 'Nope.', 'nah']) {
    const chat = `openq-ctl-${run}-${channel}-${String(seq)}`
    await turn(channel, chat, 'Draft the renewal note for the venue.')
    const said = await turn(channel, chat, reply)
    let body = ''
    try {
      body = (await handler.handle(said, db)).body
    } catch (e) {
      body = `threw ${String((e as Error).message).slice(0, 100)}`
    }
    check(
      `${channel} · "${reply}" with NOTHING waiting is still a generic rejection`,
      /let me not guess/.test(body),
      JSON.stringify(body.slice(0, 100)),
    )
  }
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
await db.end()
process.exitCode = failed === 0 ? 0 : 1
