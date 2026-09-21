/**
 * Carrying out a plan, one durable step at a time (#283).
 *
 * ## What this is the other half of
 *
 * `goal.ts` decides what work a request appears to require and `validate`
 * rules on whether any of it may happen. `perform.ts` says what the office can
 * actually DO and compiles a plan into steps. This runs them, as a child job,
 * through the machinery `checkpoint.ts` already provides.
 *
 * A child job rather than the conversation turn, for the reason every other
 * composed path in this office is one: the turn has to answer Grant now, and
 * reading a project and writing to his list is work that should appear in
 * Active Jobs, be cancellable, resume after a restart and be traced like
 * everything else.
 *
 * ## The invariant, and where it actually lives
 *
 *     STEP B CONSUMES THE ACTUAL OBSERVATION PRODUCED BY STEP A.
 *
 * `runSteps` hands every step the recorded outcomes of the steps before it, so
 * this is not a property this file implements — it is one it USES. What was
 * missing was anything able to compose a plan that needs it.
 *
 * ## The answer is built from receipts
 *
 * Not from the plan and not from prose. Each observation carries canonical ids
 * and a factual line, and the body is assembled from those, so a step that
 * found nothing says so and a step the office cannot perform says that
 * instead of being quietly dropped. The brief's rule: *"created task" requires
 * a real task receipt.*
 */
import {
  type Again,
  type Capability,
  type GoalPlan,
  planFor,
  planningCatalogue,
} from '../agents/goal.ts'
import type { Observation } from '../agents/perform.ts'
import { compile, performable } from '../agents/perform.ts'
import { howComposed } from '../agents/provenance.ts'
import { assess, RECONSIDERED } from '../agents/satisfied.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { runSteps } from '../jobs/checkpoint.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface PursueDeps {
  readonly db: SqlExecutor
  /**
   * For `draft.create`, the one executor that reasons rather than reads.
   *
   * Optional, so a pass built without a provider still runs every other step
   * and reports the writing one as an honest impediment. A mocked default
   * would turn "there was no model" into a plausible sentence, which is the
   * failure direction.
   */
  readonly router?: ProviderRouter
}

/**
 * The code version in the checkpoint.
 *
 * Bumped when the MEANING of a step's outcome changes, never for a new
 * capability. A resume under a different number parks rather than guessing,
 * which is exactly what should happen when the code that wrote the earlier
 * steps is not the code reading them.
 */
const VERSION = 'office.pursue@1'

/**
 * Compose another route to what is still unmet.
 *
 * Deliberately a thin wrapper rather than a second planner: the catalogue, the
 * roster, the validator and the closed vocabulary are all the ones the first
 * round used, so a re-plan cannot reach a capability the first plan could not.
 * The only thing that differs is what the model is TOLD — the unmet part, what
 * was actually observed, and what has already been tried.
 */
const planAgain = async (
  db: SqlExecutor,
  router: ProviderRouter,
  job: Job,
  request: string,
  last: GoalPlan,
  outcome: { readonly unmet: readonly string[] },
  seen: Readonly<Record<string, Observation>>,
): Promise<GoalPlan | null> => {
  const granted = await planningCatalogue(db)
  const roster = (
    await db.execute(
      `select slug, coalesce(title, '') as title from public.staff where active order by slug`,
    )
  ).rows.map((r) => {
    const row = r as { slug?: unknown; title?: unknown }
    return { slug: String(row.slug ?? ''), title: String(row.title ?? '') }
  })
  const canDo = new Set(performable())
  const catalogue: readonly Capability[] = granted.map((c) => ({
    ...c,
    performable: canDo.has(c.tool),
  }))
  const again: Again = {
    unmet: outcome.unmet,
    learned: Object.values(seen)
      .filter((o) => o.found)
      .map((o) => o.saw)
      .filter((line) => line !== ''),
    alreadyTried: last.steps.map((st) => st.capability),
  }
  const next = await planFor(
    request,
    catalogue,
    roster,
    router,
    { jobId: job.jobId, correlationId: job.correlationId },
    again,
  ).catch(() => null)
  if (next === null || next.how === 'fallback') return null
  /*
    A ROUTE THAT REPEATS THE LAST ONE IS NOT ANOTHER ROUTE. The model is told
    what was tried; this is what happens when it says it anyway.
  */
  const same =
    next.steps.length === last.steps.length &&
    next.steps.every((st, i) => st.capability === last.steps[i]?.capability)
  return same ? null : next
}

export function pursueHandler(deps: PursueDeps): Handler {
  const { db } = deps
  return {
    kind: 'office.pursue',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        model: null,
      }
      /*
        Asked rather than asserted. A child shares its parent's correlation and
        the parent has spent a semantic read and a plan by the time this runs,
        so claiming determinism here is the 77-dead-jobs defect.
      */
      const spent = async (): Promise<'deterministic_retrieval' | 'inference'> =>
        await howComposed(db, job.jobId)

      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const raw = payload?.plan
      const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw) as GoalPlan | undefined
      const request = String(payload?.request ?? '')

      if (plan === undefined || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        return {
          ...base,
          path: await spent(),
          body: 'There was no plan to carry out.',
          announce: false,
        }
      }

      /*
        THE BOUNDED LOOP.

        A step finding nothing must not always end the goal — the office may
        consider another REAL route. It may not consider one for ever, and it
        may not consider one because a model changed its mind.

        Every bound the brief asks for is here and each is a real limit rather
        than a gesture:

          ROUNDS      at most two extra attempts. The third has never found
                      anything the second did not, and an unbounded loop is the
                      failure mode that makes an agent frightening.
          NEW REASON  a round runs only if `assess` says another route could
                      conceivably help — a permission refusal and a missing
                      capability answer the same way however often they are
                      asked.
          FINGERPRINT the goal plus what is unmet. If a round would address
                      exactly what the last one addressed, it is the model
                      going round rather than learning, and it stops.
          TIME        a wall-clock ceiling, because a plan that takes longer
                      than Grant will wait for has failed whatever it returns.
          MODEL       each round costs one planning call; the ceiling on rounds
                      is therefore also the ceiling on spend.

        Authorization is not among the bounds because re-planning cannot touch
        it: every step of every round compiles through the same `mayAct`,
        the same registry check and the same executor gate as the first. A
        second round is a second PROPOSAL, never a second permission.
      */
      const MOST_ROUNDS = 3
      const LONGEST_MS = 120_000
      const startedAt = Date.now()
      const tried = new Set<string>()
      let round = 1
      let working = plan
      let run = await runSteps(
        db,
        job.jobId,
        VERSION,
        compile(working, db, job.jobId, job.projectId, request, deps.router, round),
      )
      let outcome = assess(
        working,
        (run.kind === 'done' ? run.outcomes : {}) as Record<string, Observation>,
        { kind: run.kind, ...(run.kind === 'paused' ? { pauseReason: run.pause.reason } : {}) },
      )
      const everySeen: Record<string, Observation> =
        run.kind === 'done' ? ({ ...run.outcomes } as Record<string, Observation>) : {}
      const rounds: string[] = []

      while (
        outcome.worthAnotherRoute &&
        round < MOST_ROUNDS &&
        Date.now() - startedAt < LONGEST_MS &&
        deps.router !== undefined
      ) {
        /*
          THE FINGERPRINT. Re-planning is allowed because an OBSERVATION
          changed what should happen; if the unmet part is what it was last
          time, nothing was learned and another round is a loop.
        */
        const shape = `${working.goal}|${[...outcome.unmet].sort().join('|')}`
        if (tried.has(shape)) {
          rounds.push(RECONSIDERED.sameAgain)
          break
        }
        tried.add(shape)

        const next = await planAgain(db, deps.router, job, request, working, outcome, everySeen)
        if (next === null || next.steps.length === 0) {
          rounds.push(RECONSIDERED.noneLeft)
          break
        }
        round += 1
        working = next
        run = await runSteps(
          db,
          job.jobId,
          VERSION,
          compile(next, db, job.jobId, job.projectId, request, deps.router, round),
        )
        if (run.kind === 'done') Object.assign(everySeen, run.outcomes)
        outcome = assess(
          next,
          (run.kind === 'done' ? run.outcomes : {}) as Record<string, Observation>,
          { kind: run.kind, ...(run.kind === 'paused' ? { pauseReason: run.pause.reason } : {}) },
        )
        rounds.push(RECONSIDERED.tookAnother(next.steps.map((st) => st.capability).join(' → ')))
      }

      if (run.kind === 'paused') {
        /*
          A PAUSE THAT ASKS HIM SOMETHING MUST REACH HIM.

          `announce: false` was right for the pauses this handler could produce
          when it was written — a stale checkpoint and an interrupted external
          write are both for a person who is already looking. `awaiting_approval`
          is the opposite: the office has stopped BECAUSE it needs an answer,
          and a question nobody is told about is #211's silent gate again, one
          layer out. The blocker is on his Governance page either way; this is
          what makes the turn say so.
        */
        const asking = run.pause.reason === 'awaiting_approval'
        /*
          A PAUSE MUST NOT SWALLOW THE WORK ALREADY DONE.

          `RunEnd` carries `at` and the pause and no outcomes, so this branch
          reported the stop and nothing else — a plan that read the material
          and then stopped to ask told Grant only that it needed an answer,
          losing the reading entirely. He is then asked to approve a step
          without being shown what the step before it found, which is #131's
          objection exactly: approving something you cannot see is consent to a
          category.

          The finished steps are in `public.job_steps`, so they are read back
          rather than lost. Canonical state, not a variable that happened to
          survive.
        */
        const already = (
          await db
            .execute(`
              select coalesce(outcome ->> 'saw', '') as saw
                from public.job_steps
               where job_id = ${lit(job.jobId)}::uuid
                 and finished_at is not null
                 and coalesce(outcome ->> 'found', 'false') = 'true'
               order by ordinal`)
            .catch(() => ({ rows: [] as Record<string, unknown>[] }))
        ).rows
          .map((r) => String((r as { saw?: string }).saw ?? ''))
          .filter((line) => line !== '')
        const sofar = already.length === 0 ? '' : `${already.join('\n')}\n\n`
        return {
          ...base,
          path: await spent(),
          announce: asking,
          body: asking
            ? `${sofar}I have stopped before "${run.at}" because I need you to say. ${run.pause.detail} ${run.pause.resumeWhen}`
            : `${sofar}I stopped part way through, at "${run.at}": ${run.pause.detail} ${run.pause.resumeWhen}`,
        }
      }

      /*
        EVERY ROUND, not the last one.

        `run` holds only the final round's outcomes, so narrating from it would
        report the second attempt and silently drop what the first one found —
        the same defect as a pause swallowing completed work, one layer up.
        `everySeen` accumulates across rounds.
      */
      if (run.kind === 'done') Object.assign(everySeen, run.outcomes)
      const seen = Object.entries(everySeen).map(([name, o]) => ({
        name,
        o: o as unknown as Observation,
      }))
      const did = seen.filter((s) => s.o.found)
      const couldNot = seen.filter((s) => !s.o.found)
      const receipts = did.flatMap((s) => s.o.ids)

      /*
        THE BODY IS THE RECEIPTS.

        Every line here is something an observation recorded, so the narration
        cannot claim more than canonical state proves. A step that found
        nothing is named with its reason rather than omitted — #60's rule, one
        layer out: a report that covers a third of the work and presents it as
        complete is worse than one that admits it understood nothing.
      */
      const lines: string[] = []
      if (run.kind === 'stopped') lines.push(`You asked me to stop, so I did, at "${run.at}".`)
      for (const s of did) lines.push(s.o.saw)
      for (const s of couldNot) {
        lines.push(`I could not ${s.o.capability}: ${s.o.impediment ?? 'nothing came back'}.`)
        /*
          Countable, not just apologetic. Four agents hitting the same wall
          GROUP BY together and a repeated one becomes a proposal (#49).
        */
        await db
          .execute(`
            select app.cannot(${lit(job.jobId)}::uuid, 'not_capable',
              ${lit(s.o.capability.slice(0, 60))}, 'chief-of-staff',
              ${lit(String(s.o.impediment ?? '').slice(0, 400))},
              ${lit(request.slice(0, 280))})`)
          .catch(() => undefined)
      }
      for (const u of working.unreachable) lines.push(`I have no way to ${u}.`)
      /*
        SAY THAT IT TRIED AGAIN. A second route that Grant cannot see is a
        second route he cannot judge — and if it was not worth telling him
        about, it was not worth spending a model call on.
      */
      for (const r of rounds) lines.push(r)
      /*
        AND SAY WHERE IT GOT TO. "All the steps ended" is not "your goal was
        met", and the whole point of `assess` is that the office can tell the
        difference — so it says which, in a sentence, rather than leaving him
        to infer it from a list of receipts.
      */
      if (outcome.verdict !== 'satisfied') lines.push(outcome.because)

      return {
        ...base,
        path: await spent(),
        announce: true,
        body: lines.length === 0 ? 'The plan ran and produced nothing.' : lines.join('\n'),
        shape: 'plan_carried_out',
        /*
          SNAKE_CASE, because `public.output_shapes` is the vocabulary and
          every other declared shape speaks it (`suggested_collection`,
          `looked_at`, `confidence_note`). 0526 declared this one and the
          first draft here wrote `couldNot`, which the shape check correctly
          refused — 0311's two-words-for-one-thing, caught before it could
          become two.
        */
        facts: {
          goal: working.goal,
          verdict: outcome.verdict,
          rounds: round,
          unmet: outcome.unmet,
          steps: working.steps.map((s) => ({ id: s.id, capability: s.capability })),
          done: did.map((s) => s.name),
          could_not: couldNot.map((s) => s.name),
          receipts,
          ...(run.kind === 'stopped' ? { stopped_at: run.at } : {}),
        },
        acted: did.length,
      }
    },
  }
}
