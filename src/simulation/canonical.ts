/**
 * The live door — the office as Grant actually reaches it.
 *
 * A message is written to `public.inbound_commands`, enqueued through
 * `app.enqueue_inbound`, and the job is watched until it settles. What comes
 * back is read from canonical state, never from the answer's prose: §11's
 * *"Do not ask a model what Postgres can answer."*
 *
 * ## THIS HAS NEVER BEEN RUN
 *
 * Stated at the top, not in a footnote. It was written in a session with no
 * `SUPABASE_ACCESS_TOKEN`, so every line below is READ code rather than
 * proved code, and CLAUDE.md is unambiguous about what that is worth:
 * *"A migration that applies cleanly is not a function that works"*, and
 * *"Driving a function finds what reading it cannot"* — the latter recorded
 * after four independent defects in one feature, none visible from reading.
 *
 * So it refuses to run without `--i-have-checked-the-first-run`, and
 * `firstRunChecklist()` below says exactly what to check. That is not
 * ceremony either: this writes to the shared Supabase that Grant's real
 * office runs on, and CLAUDE.md records this repository creating 41 fixture
 * projects in one night, ten permanent Slack channels, and 740 jobs in
 * twelve hours — each time from code that looked right.
 *
 * ## Why it does not import `scripts/sessions/run.ts`
 *
 * That file calls `process.exit(2)` at module scope when the token is
 * unset, so importing it kills any run in an environment without one —
 * including every unit test. It is Issue #294. The SQL below is
 * deliberately the same shape as `askOnce`'s, because that shape is proved
 * by months of use; it is copied rather than imported for that one reason,
 * and the duplication should be removed when #294 is.
 */

import { ManagementApiExecutor, type SqlExecutor } from '../db/executor.ts'
import { readEffects } from './effects.ts'
import type { Utterance } from './scenario.ts'
import type { Observation, Transport, TurnContext } from './transport.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The Management API throttles, and a throttle is not an answer.
 *
 * CLAUDE.md, from #232: a 429 falling through as a result turns a correct
 * decision into a miss and moves a headline figure for reasons that have
 * nothing to do with the office.
 */
const patiently = async <T>(what: () => Promise<T>): Promise<T> => {
  let last: unknown
  for (const wait of [0, 2_000, 5_000, 12_000, 25_000]) {
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    try {
      return await what()
    } catch (error) {
      last = error
      if (!String((error as Error).message).includes('Too Many Requests')) throw error
    }
  }
  throw last
}

export interface CanonicalOptions {
  /** How long to wait for a job to settle. */
  readonly deadlineMs?: number
  /**
   * The run token, which every row this makes will carry.
   *
   * It goes in `requested_by` as `<channel>:verify-shadow-<token>`, because
   * `jobs.is_fixture` is GENERATED and migration 0342 taught it the
   * `%:verify-%` shape precisely so a suite driving the real enqueue path
   * could produce a fixture job at all. Without it these are
   * indistinguishable from Grant's own messages, which CLAUDE.md records
   * happening six separate times — 43 jobs once, 61 and 29 another time,
   * and twice reported back to him as the office failing.
   *
   * The pattern was checked against the migration rather than remembered:
   * 0342 line 91 is `or coalesce(requested_by, '') like '%:verify-%'`, and
   * `teamhq:verify-shadow-<token>` matches it. Migration 0523 —
   * *harness traffic may not reach a production destination* — is the
   * second line of defence behind `announce = false`.
   */
  readonly runToken: string
}

/**
 * What must be true before this is run for the first time.
 *
 * Printed rather than assumed. A checklist in a comment is one nobody reads.
 */
export const firstRunChecklist = (): string => `
BEFORE THE FIRST LIVE RUN

This writes to the Supabase that Grant's real office runs on. Nothing below
is optional, and none of it has been exercised yet.

  1. Run ONE scenario first, not the corpus:
       npm run shadow:baseline -- --live --family noaction.acknowledgement --i-have-checked-the-first-run
     "thanks" is the cheapest possible message and creates nothing.

  2. Check the row it made is marked as harness traffic:
       npm run q -- "select requested_by, is_fixture, app.harness_job(job_id) from public.jobs order by created_at desc limit 3"
     is_fixture must be TRUE. If it is not, stop: every later reader that
     reports to Grant will count these as real, which CLAUDE.md records
     happening six times, twice inside features built to make the office
     legible.

  3. Check nothing was delivered:
       npm run q -- "select count(*) from public.deliveries where created_at > now() - interval '10 minutes'"
     Must be 0. The enqueue sets announce = false; verify it took.

  4. Only then widen to a family, and only then to the corpus.

  5. Afterwards, always:
       npm run check:leaks
     and sweep anything this created. A suite that creates a real project
     must remove it, and a teardown that matches nothing looks exactly like
     a teardown that worked.

Nothing here is paranoia. Each step corresponds to something this repository
has already done by accident: fixture projects that can never be deleted,
permanent Slack channels, 740 jobs in twelve hours, and harness traffic
reported to Grant as his office collapsing.
`

export const canonicalDoor = (options: CanonicalOptions): Transport => {
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const has = token !== undefined && token !== ''
  const confirmed = process.argv.includes('--i-have-checked-the-first-run')

  if (!has) {
    return {
      door: 'canonical',
      reachable: false,
      blockedBecause: 'SUPABASE_ACCESS_TOKEN is not set in this environment',
      async ask(): Promise<Observation> {
        throw new Error('the canonical door has no credential')
      },
    }
  }

  if (!confirmed) {
    return {
      door: 'canonical',
      reachable: false,
      blockedBecause:
        'this door has never been run. Read firstRunChecklist() and pass --i-have-checked-the-first-run',
      async ask(): Promise<Observation> {
        throw new Error('the canonical door has not been confirmed for a first run')
      },
    }
  }

  const db: SqlExecutor = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const one = async (sql: string): Promise<Record<string, unknown>> =>
    ((await db.execute(sql)).rows as Record<string, unknown>[])[0] ?? {}

  let nth = 0
  const deadlineMs = options.deadlineMs ?? 7 * 60 * 1000

  return {
    door: 'canonical',
    reachable: true,
    async ask(utterance: Utterance, _context: TurnContext): Promise<Observation> {
      const started = Date.now()
      // Bounds every count to THIS turn. Without it a later turn in the same
      // conversation inherits the earlier one's rows and effects appear to
      // grow for free.
      const since = new Date(Date.now() - 5_000).toISOString()
      nth++
      /*
        `inbound_dedupe_key_shaped` is `^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$`, so
        the SECOND segment may not contain a digit — and the run token is
        `Math.random().toString(36)`, which usually does. The original shape
        here, `shadow:<token>:<nth>`, therefore failed the CHECK on about
        nine runs in ten: 4 of 5 real tokens were refused when this was
        driven for the first time.

        It was written from reading, and reading could not see it. The token
        moves to the third segment, where digits are legal, and the first
        segment becomes the channel, which is what every real key in the
        table does (`telegram:message:...`, `teamhq:my_tasks:...`).
      */
      const key = `teamhq:shadow:${options.runToken}-${String(nth)}`

      /*
        `announce = false` is the leak protection and it is set in the same
        statement that creates the job, not afterwards.

        Afterwards would be a window: the worker ticks every minute, and a
        job that is announceable for even a second can be picked up and
        delivered. CLAUDE.md records a replay reaching Grant through work it
        SPAWNED, because a child inherits requested_by and takes the column
        default - which is why 0461 and 0462 were both needed.
      */
      const jobId = String(
        (
          await patiently(
            async () =>
              await one(`
                begin;
                insert into public.inbound_commands
                  (origin_channel, origin_ref, actor, instruction, dedupe_key, received_at)
                values ('teamhq', ${lit(key)},
                        ${lit(`verify-shadow-${options.runToken}`)},
                        ${lit(utterance.text)}, ${lit(key)}, app.now_utc())
                on conflict (dedupe_key) do nothing;
                create temp table _j as
                  select coalesce(
                    (select j.job_id from public.jobs j
                       where j.idempotency_key = (
                         select 'inbound-' || c.command_id::text from public.inbound_commands c
                          where c.dedupe_key = ${lit(key)})),
                    (app.enqueue_inbound(
                       (select command_id from public.inbound_commands
                         where dedupe_key = ${lit(key)})
                     ) ->> 'job_id')::uuid) as id;
                update public.jobs set announce = false where job_id = (select id from _j);
                select (select id from _j)::text as id;
                commit;`),
          )
        ).id,
      )

      const until = Date.now() + deadlineMs
      let row: Record<string, unknown> = {}
      while (Date.now() < until) {
        row = await patiently(
          async () =>
            await one(`
              select j.state::text as state,
                     app.harness_job(j.job_id) as fixture,
                     coalesce(j.recipient_agent, '') as agent,
                     /*
                       The office's READING of the mood, which is what the
                       understanding dimension scores - not who answered.
                       No backticks in here: this comment is inside a
                       template literal and one backtick ends the string.

                       This door used to report recipient_agent as the
                       reading, and the evaluator compares a reading against
                       the vocabulary classifyIntent produces: assignment,
                       direct_command, light_investigation, question,
                       thought. An agent slug is in none of them, so
                       understanding FAILED for every actionable scenario on
                       the live door, systematically, against a product that
                       had read the message correctly. routing_decisions
                       records the real class. jobs.intent_class is null on
                       every row, which is a separate finding.
                     */
                     coalesce((select rd.intent_class from public.routing_decisions rd
                                where rd.job_id = j.job_id
                                order by rd.decided_at desc limit 1), '') as reading,
                     coalesce((select left(o.body, 4000) from public.outputs o
                                where o.job_id = j.job_id
                                order by o.created_at desc limit 1), '') as answered,
                     (select count(*) from public.deliveries d where d.job_id = j.job_id) as delivered,
                     /*
                       Whether the whole CORRELATION FAMILY has finished,
                       not just this job.

                       A turn spawns children - one approval scenario made
                       three artifact.report jobs - and a child carries its
                       parent's correlation_id. Waiting only for the parent
                       read the effects while the children were still
                       running, so settled came back false and reality,
                       conversation and completion all reported "the job had
                       not settled" about a turn that had answered. That is
                       the unreached-for-the-wrong-reason shape, and it is
                       also how a child's deposited document would be missed.
                     */
                     (select bool_and(
                               k.state in ('complete','failed','cancelled')
                               or k.state = 'waiting_user'
                               or (k.state = 'paused'
                                   and coalesce(k.state_reason,'') like 'awaiting_approval%'))
                        from public.jobs k
                       where k.job_id = j.job_id
                          or k.parent_job_id = j.job_id
                          or k.correlation_id = j.correlation_id) as family_settled
                from public.jobs j
               where j.job_id = ${lit(jobId)}::uuid`),
        )
        if (row.family_settled === true || String(row.family_settled) === 'true') break
        await new Promise((r) => setTimeout(r, 10_000))
      }

      const answered = String(row.answered ?? '')
      const settled = row.family_settled === true || String(row.family_settled) === 'true'

      /*
        A turn that has not answered YET is not a turn that answered nothing.

        CLAUDE.md records the session runner scoring exactly that as a
        product failure on a job that had answered, and answered well. The
        deadline expiring means NOTHING HAS DECIDED, which is a different
        fact from the office producing nothing, and folding the two together
        is a lie about the product or about the run.
      */
      if (!settled) {
        throw new Error(
          `job ${jobId} and its spawned work had not settled after ${Math.round(deadlineMs / 1000)}s - nothing has decided yet, which is not the same as the office answering nothing`,
        )
      }

      const effects = await patiently(async () => await readEffects(db, jobId, since))

      return {
        door: 'canonical',
        reply: answered,
        effects,
        // Read from the answer, because on this door the office's question
        // IS its prose. Deliberately crude: the semantic judge is the right
        // instrument for this and is asked separately.
        asked: /\?/.test(answered),
        /*
          Whether the office understood this to be a request at all - which
          is the routing decision existing, not the answer being non-empty.

          It was `answered !== ''` and that is a different question. A job
          that was understood correctly and then FAILED has an empty answer,
          so the evaluator reported "the office did not recognise a request
          at all" about a turn whose recorded reading was direct_command -
          a finding that contradicted itself in its own sentence.
        */
        recognised: String(row.reading ?? '') !== '',
        reading: String(row.reading ?? ''),
        confident: String(row.state) === 'complete',
        clauses: [utterance.text],
        learned: false,
        corrected: false,
        extraction: false,
        wouldFile: false,
        acknowledgementOnly: false,
        bareRejection: false,
        exclusionSeen: false,
        // Everything IS reachable here, which is the whole point of the
        // door: the message goes through the real enqueue, the real project
        // resolution, the real thread resolver and the real handler.
        reaches: ['comprehension', 'referent', 'history', 'execution'],
        // Everything IS reachable here, which is the whole point of the
        // door. An empty list rather than a shortened one.
        unreached: [],
        ms: Date.now() - started,
        modelCalls: 0,
      }
    },
  }
}
