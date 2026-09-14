/**
 * An agent may not say it looked when it did not.
 *
 *   npm run verify:attests
 *
 * Issue #185. On 13 September, at 03:45, Claire sent Grant this:
 *
 *   > I pulled the project records. The db read shows five active projects:
 *   > mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi.
 *
 * None of the five existed. The output row said `evidence: inferred` — the
 * office KNEW nothing had been read — and rendered that knowledge as small
 * grey caption text underneath the sentence claiming the read.
 *
 * So this is not the "a model hallucinated" problem, which no check can solve.
 * It is that the output CONTRADICTED ITS OWN METADATA and nothing compared the
 * two. That is checkable, and this suite is what checks it.
 *
 * ## Both gates, because they catch different things
 *
 * `metadataProblems` runs when an output is CREATED, inside `runJob`. It fails
 * the job while somebody can still act on it, which is the better outcome.
 *
 * `refuseToSend` runs inside `combinedNotifier`, at the one point every
 * channel goes through. It exists because `resumeNotifications` rebuilds an
 * output from its stored row and sends it WITHOUT passing through creation at
 * all — so a row written before the rule existed, or a job that reached
 * `notifying` by recovery, would otherwise go out unexamined. #185's third box
 * asks for the check on the SENDING path for exactly that reason.
 *
 * Section 2 therefore drives the notifier directly rather than through the
 * worker. Going through `runJob` would test the creation gate a second time
 * and would never reach the one this section is about.
 *
 * ## Fixture jobs, deliberately
 *
 * A refused send writes a `job_impediments` row, and that ledger is
 * append-only by §6 — DELETE is refused by a trigger — so every impediment
 * this suite writes is PERMANENT. `is_fixture` is inherited from the job by
 * trigger and `impediments_tally` excludes fixtures, so a fixture impediment
 * is permanent AND uncountable, which is exactly what a suite wants from a
 * ledger it cannot clean up. This is `verify:proposes`' reasoning, and the
 * opposite of #45's usual advice, because nothing here filters fixtures.
 *
 * The suite claims only its own work (#184): every job is
 * `requested_by = 'verify:attests'` and the dequeue is scoped to that name.
 */

import { combinedNotifier } from '../../src/channels/notify.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import type { Handler, HandlerOutput, Job, NotifyOutcome, Reviewer } from '../../src/jobs/worker.ts'
import { dequeue, runJob } from '../../src/jobs/worker.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

const checks: { what: string; outcome: string; passed: boolean }[] = []
const check = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what} — ${outcome}`)
}

const run = Math.random().toString(36).slice(2, 10)
const MINE = 'verify:attests'
const WORKER = `attests-${run}`

/**
 * The message, verbatim.
 *
 * Kept exact because a regression here is a lie sent to a person, and the
 * words are the evidence. Asserting a paraphrase would let the check pass
 * against a body that no longer contains the claim it was written for.
 */
const FABRICATION =
  'I pulled the project records. The db read shows five active projects: ' +
  'mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi. No other project ' +
  'entries are present.'

console.log(`\nverify:attests — ${run}\n`)

// Debris from a crashed earlier run. Scoped to this suite's own name, so it
// can never touch anything else in the queue.
await db.execute(`
  update public.jobs
     set state = 'cancelled', finished_at = app.now_utc(),
         state_reason = 'verify:attests debris from an earlier run'
   where requested_by = ${lit(MINE)}
     and state not in ('complete', 'cancelled', 'failed')
`)

const projectId = String(
  (
    await one(`
      with created as (
        insert into public.projects (slug, name, status)
        values (${lit(`fixture-attests-${run}`)}, 'Fixture: attests', 'active')
        returning project_id
      ),
      attached as (
        insert into public.project_attachments
          (project_id, connector, external_ref, display_name, role)
        select project_id, 'upload', 'fixture', 'Verification fixture', 'source'
          from created
        returning project_id
      )
      select project_id::text as id from created
    `)
  ).id,
)

const enqueue = async (kind: string, key: string): Promise<string> =>
  String(
    (
      await one(`
        insert into public.jobs
          (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
        values (gen_random_uuid(), ${lit(projectId)}::uuid, ${lit(key)}, ${lit(kind)},
                ${lit(MINE)}, 100)
        returning job_id::text as id
      `)
    ).id,
  )

const approve: Reviewer = async () => ({ status: 'approved', notes: 'fixture reviewer' })

const teller = (output: Omit<HandlerOutput, 'path' | 'model'>): Handler => ({
  kind: 'research',
  handle: async (): Promise<HandlerOutput> => ({
    ...output,
    path: 'inference',
    model: 'fixture/liar',
  }),
})

/** Records what it was asked to send, and sends nothing anywhere. */
const recorder = (): {
  readonly sent: HandlerOutput[]
  readonly channel: {
    readonly name: string
    readonly notify: (job: Job, output: HandlerOutput, outputId: string) => Promise<NotifyOutcome>
  }
} => {
  const sent: HandlerOutput[] = []
  return {
    sent,
    channel: {
      name: 'recorder',
      notify: async (_job, output) => {
        sent.push(output)
        return { delivered: true, note: 'recorded' }
      },
    },
  }
}

let failedEarly = false
try {
  // =========================================================================
  console.log('\n1. the creation gate — a contradicting output never becomes a row')

  const liarJobId = await enqueue('research', `fixture-attests-${run}-liar`)
  const liar = await dequeue(db, WORKER, true, true, undefined, MINE)
  const seen = recorder()
  const liarResult =
    liar === null
      ? null
      : await runJob(
          db,
          liar,
          [
            teller({
              body: FABRICATION,
              confidence: 'medium',
              evidence: 'inferred',
              sources: [],
              contradictions: null,
            }),
          ],
          approve,
          combinedNotifier([seen.channel], db),
        )

  check(
    'the job fails rather than producing the message',
    liarResult === null
      ? 'nothing dequeued'
      : `${liarResult.finalState}: ${liarResult.note.slice(0, 110)}`,
    liarResult?.finalState === 'failed' && liarResult.note.includes('claims to have read'),
  )
  check(
    'and the notifier is never reached',
    `${String(seen.sent.length)} message(s) recorded`,
    seen.sent.length === 0,
  )

  const rows = Number(
    (
      await one(`
        select count(*)::int as n from public.outputs
         where job_id = ${lit(liarJobId)}::uuid
      `)
    ).n,
  )
  // Scoped to THIS job, not to every job the suite has ever run. The first
  // version counted by `requested_by` across all runs and went red on the
  // second run of the day, reading section 2's own deliberate insert — from a
  // previous run — as section 1 having failed.
  check('no output row was written at all', `${String(rows)} row(s)`, rows === 0)

  // =========================================================================
  console.log('\n2. the sending gate — the path that does not pass through creation')

  /*
    Driven directly, because that is the only way to reach it.

    `resumeNotifications` rebuilds an output from its stored row and hands it
    to this same notifier, so a row that exists — however it came to exist —
    is one send away from a person. The insert below is what that looks like.
  */
  const stranded = await enqueue('research', `fixture-attests-${run}-stranded`)
  const outputId = String(
    (
      await one(`
        insert into public.outputs
          (job_id, body, confidence, evidence, sources, deterministic, model)
        values (${lit(stranded)}::uuid, ${lit(FABRICATION)}, 'medium', 'inferred',
                '[]'::jsonb, false, 'fixture/liar')
        returning output_id::text as id
      `)
    ).id,
  )

  const strandedJob: Job = {
    jobId: stranded,
    kind: 'research',
    correlationId: String(
      (
        await one(
          `select correlation_id::text as c from public.jobs where job_id = ${lit(stranded)}::uuid`,
        )
      ).c,
    ),
    projectId,
    idempotencyKey: '',
    attempt: 0,
  }
  const atSend = recorder()
  const outcome = await combinedNotifier([atSend.channel], db)(
    strandedJob,
    {
      body: FABRICATION,
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'inference',
      model: 'fixture/liar',
    },
    outputId,
  )

  check(
    'a stored output that contradicts itself is not sent',
    `delivered=${String(outcome.delivered)} — ${outcome.note.slice(0, 110)}`,
    !outcome.delivered && outcome.note.startsWith('not sent:'),
  )
  check(
    'and no channel saw it',
    `${String(atSend.sent.length)} message(s) recorded`,
    atSend.sent.length === 0,
  )

  /*
    Refused, not silently dropped — #185's fourth box.

    An output that vanishes between `committed` and a channel is the same
    failure in a quieter costume: nobody can tell it from a job that had
    nothing to say. #49's ledger is the surface Grant already reads that on.
  */
  const imp = await one(`
    select kind::text as kind, needed, detail, is_fixture
      from public.job_impediments
     where job_id = ${lit(stranded)}::uuid
     order by created_at desc limit 1
  `)
  check(
    'the refusal is on the impediment ledger, with the phrase it objected to',
    imp.needed === undefined
      ? '(nothing recorded)'
      : `${String(imp.needed)} — ${String(imp.detail).slice(0, 90)}`,
    imp.needed === 'evidence for a claimed read' &&
      String(imp.detail).includes('I pulled the project records'),
  )
  check(
    'and it is a fixture, so this suite can never inflate a real tally',
    `is_fixture=${String(imp.is_fixture)}`,
    imp.is_fixture === true,
  )

  // =========================================================================
  console.log('\n3. a citation is an address, not a description')

  const prose = await combinedNotifier([recorder().channel], db)(
    strandedJob,
    {
      body: 'Four projects are active.',
      confidence: 'high',
      evidence: 'verified',
      sources: ['the project records', '5 sources'],
      contradictions: null,
      path: 'inference',
      model: 'fixture/liar',
    },
    outputId,
  )
  check(
    'a verified claim citing prose is not sent',
    `delivered=${String(prose.delivered)} — ${prose.note.slice(0, 110)}`,
    !prose.delivered && prose.note.includes('not addresses'),
  )

  // =========================================================================
  console.log('\n4. CONTROL — the office still speaks')

  /*
    The half that makes the rest worth having.

    A gate that refuses everything passes every check above and silences the
    office, and the failure would look exactly like the rule working. So the
    same sentence, from an output that DID read, must go out unaltered.
  */
  const honest = recorder()
  const ok = await combinedNotifier([honest.channel], db)(
    strandedJob,
    {
      body: FABRICATION,
      confidence: 'medium',
      evidence: 'verified',
      sources: ['db:public.projects'],
      contradictions: null,
      path: 'deterministic_retrieval',
      model: null,
    },
    outputId,
  )
  check(
    'the identical sentence is sent when the read actually happened',
    `delivered=${String(ok.delivered)} — ${ok.note.slice(0, 80)}`,
    ok.delivered && honest.sent.length === 1,
  )

  const ordinary = recorder()
  const plain = await combinedNotifier([ordinary.channel], db)(
    strandedJob,
    {
      body: 'The launch is the risk, on what we have. I would hold the date.',
      confidence: 'medium',
      evidence: 'inferred',
      sources: [],
      contradictions: null,
      path: 'inference',
      model: 'fixture/liar',
    },
    outputId,
  )
  check(
    'and an ordinary inferred answer is untouched',
    `delivered=${String(plain.delivered)}`,
    plain.delivered && ordinary.sent.length === 1,
  )
} catch (error) {
  failedEarly = true
  console.error(`\nthe suite threw: ${(error as Error).message.slice(0, 400)}`)
}

// ===========================================================================
console.log('\n| check | outcome | |')
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? '✅' : '❌'} |`)
const failed = checks.filter((c) => !c.passed)
console.log(`\n${String(checks.length - failed.length)}/${String(checks.length)} checks passed`)

try {
  /*
    Failed, not cancelled. A job this suite left in `committing`, `committed`
    or `notifying` can ONLY move to `failed` — `enforce_job_transition` refuses
    the others, and a guard reading `state not in (complete, cancelled,
    failed)` looks complete and is not. Two such jobs from `verify:history`
    stranded every `npm run deploy:worker` for a day.
  */
  await db.execute(`
    update public.jobs set state = 'failed', finished_at = app.now_utc(),
           state_reason = 'fixture retired by verify:attests'
     where requested_by = ${lit(MINE)} and state not in ('complete', 'cancelled', 'failed')
  `)
  await db.execute(
    `update public.projects set status = 'archived' where project_id = ${lit(projectId)}::uuid`,
  )
  const live = Number(
    (
      await one(`
        select count(*)::int as n from public.jobs
         where requested_by = ${lit(MINE)} and state not in ('complete', 'cancelled', 'failed')
      `)
    ).n,
  )
  console.log(
    live === 0
      ? 'fixtures retired.'
      : `${String(live)} job(s) left live — teardown did not finish.`,
  )
  if (live > 0) process.exit(1)
} catch (error) {
  console.log(`cleanup did not complete: ${(error as Error).message.slice(0, 160)}`)
  process.exit(1)
}

process.exit(failed.length > 0 || failedEarly ? 1 : 0)
