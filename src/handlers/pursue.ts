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
import type { GoalPlan } from '../agents/goal.ts'
import type { Observation } from '../agents/perform.ts'
import { compile } from '../agents/perform.ts'
import { howComposed } from '../agents/provenance.ts'
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

      const run = await runSteps(
        db,
        job.jobId,
        VERSION,
        compile(plan, db, job.jobId, job.projectId, request, deps.router),
      )

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

      const seen = Object.entries(run.outcomes).map(([name, o]) => ({
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
      for (const u of plan.unreachable) lines.push(`I have no way to ${u}.`)

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
          goal: plan.goal,
          steps: plan.steps.map((s) => ({ id: s.id, capability: s.capability })),
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
