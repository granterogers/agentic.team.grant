/**
 * Carrying out a plan Grant approved.
 *
 * `src/agents/plan.ts` reads the instruction and writes the plan;
 * `office.instruction` shows it and holds it; 0087 turns a Go ahead into one
 * job of this kind carrying the plan in `pinned_config`. This is the part that
 * does it.
 *
 * ## Each step becomes a job, not a line of code
 *
 * The steps are `notebook.add_source`, `notebook.generate` and `notebook.ask`,
 * which already exist, are already metered against the notebook's allowance
 * (0078), and already gate generation behind its own approval (0083). A plan
 * executor that did the work itself would be a second implementation of all
 * three, and the first thing to drift would be the meter.
 *
 * So this schedules, and the steps run themselves.
 *
 * ## Ordering is a delay, and the delay is a guess
 *
 * A question about a video cannot be asked until Google has transcribed it, and
 * nothing tells us when that finished — `sources.list` reports a status, so the
 * ask step checks it and defers itself rather than trusting a timer. What is
 * scheduled here is a first attempt a few minutes out; the honesty is in the
 * step, not in the arithmetic.
 *
 * ## Creating a project creates three things
 *
 * A notebook in Google, a project row, and the attachment that ties them —
 * because "a new notebook project called AI Learning" is all three and Grant
 * should not have to make any of them by hand. The notebook is made FIRST: a
 * project with no attachment violates 0067's rule, so there would be nothing to
 * attach it to if the order were reversed.
 */

import type { Step } from '../agents/plan.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { type Outcome, runSteps } from '../jobs/checkpoint.ts'

const EXTERNAL_STEPS: ReadonlySet<string> = new Set([
  'create_project',
  'add_source',
  'generate',
  'ask',
])

import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotebookActions } from '../notebook/actions.ts'
import { checkApproval, mayStart, refusedApproval } from './approval-gate.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Long enough for Google to transcribe a video; the step re-checks anyway. */
const FIRST_ASK_DELAY = '3 minutes'

const payloadOf = async (db: SqlExecutor, job: Job): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(
    `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
  )
  return ((rows[0] as { pinned_config?: Record<string, unknown> } | undefined)?.pinned_config ??
    {}) as Record<string, unknown>
}

const done = (body: string, sources: readonly string[]): HandlerOutput =>
  ({
    body,
    confidence: 'high',
    evidence: 'verified',
    sources,
    contradictions: null,
    path: 'deterministic_retrieval',
    model: null,
  }) satisfies HandlerOutput

export function planHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.execute_plan',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const payload = await payloadOf(db, job)
      const steps = (payload.plan_steps ?? []) as Step[]
      if (!Array.isArray(steps) || steps.length === 0) {
        throw new Error('this plan has no steps')
      }

      /*
        THE APPROVAL, ASKED OF THE QUESTION (0616). This handler had no gate at all: whatever put a plan
        in a job's config and queued it was carried out. It asks the database whether the question this job
        names is real, was answered yes by a person, and is about THESE steps, and then the boundary every
        other effect goes through. A plan that changed between the question and the answer does not run.
      */
      const approval = await checkApproval(db, job.jobId)
      const start = await mayStart(db, job, approval, 'notebook.write')
      if (!start.ok) {
        return await refusedApproval(db, job, 'carry out this plan', start.why)
      }

      /*
        EACH STEP ONCE (0616). A plan that makes a notebook in Google and then a project row failed
        between the two on a bad night and the retry made a SECOND notebook. Every step is a checkpointed
        step now: a finished one is skipped on the retry and its result carried forward, and the one that
        acts outside the office (creating the notebook) parks for a person if it was interrupted, instead
        of being run again. What each step leaves is the state the next one starts from.
      */
      type Acc = {
        projectId: string | null
        projectName: string
        said: string[]
        references: string[]
      }
      const stateBefore = (done: Readonly<Record<string, Outcome>>, index: number): Acc => {
        for (let i = index - 1; i >= 0; i -= 1) {
          const stored = done[stepName(i)]
          if (stored !== undefined) return structuredClone(stored) as unknown as Acc
        }
        return { projectId: job.projectId, projectName: '', said: [], references: [] }
      }
      const stepName = (i: number): string => `${String(i)}:${String(steps[i]?.kind)}`

      // The credential is checked BEFORE any step is claimed: a plan that cannot make its notebook
      // must fail cleanly at the start, not after an external claim has been opened for nothing.
      if (
        steps.some((x) => x.kind === 'create_project') &&
        (await NotebookActions.fromVault(db)) === null
      ) {
        throw new Error('no NotebookLM credential in the vault; cannot make a notebook')
      }

      const run = await runSteps(
        db,
        job.jobId,
        'office.execute_plan@1',
        steps.map((step, index) => ({
          name: stepName(index),
          // A step that makes something the office cannot take back - a notebook at Google, or a job
          // that will go and act - is EXTERNAL: a crash between the effect and its record parks the
          // plan for a person instead of doing it a second time (review of Run 3, F5).
          effect: EXTERNAL_STEPS.has(step.kind) ? ('external' as const) : ('local' as const),
          run: async (done: Readonly<Record<string, Outcome>>) => {
            const acc = stateBefore(done, index)
            let effectRef: string | undefined

            if (step.kind === 'use_project') {
              // Already exists — ours, or one of Grant's the resolver matched by
              // name. Adopt it rather than making a second: `hq_create_project` is
              // idempotent on the slug, so a project we already run is found and a
              // notebook of his we have never seen gets a project around it.
              const { rows } = await db.execute(`
                select app.hq_create_project(
                  ${lit(step.name)}, 'notebooklm', ${lit(step.notebookRef)}, ${lit(step.name)}
                ) as r
              `)
              const made = (rows[0] as { r: { error?: string; project_id?: string } }).r
              if (made.project_id !== undefined) acc.projectId = String(made.project_id)
              else {
                const found = await db.execute(`
                  select project_id::text as project_id from public.projects p
                   join public.project_attachments a using (project_id)
                   where a.external_ref = ${lit(step.notebookRef)} limit 1
                `)
                const row = found.rows[0] as { project_id?: string } | undefined
                if (row?.project_id === undefined) throw new Error(String(made.error))
                acc.projectId = row.project_id
              }
              acc.projectName = step.name
              acc.said.push(`working in your existing “${step.name}”`)
              acc.references.push(`notebooklm:${step.notebookRef} ${step.name}`)
              return { outcome: acc as unknown as Outcome }
            }

            if (step.kind === 'project') {
              // Unresolved: the handler is supposed to have decided before this ran.
              // Refusing beats guessing — guessing is what made the duplicate.
              throw new Error(
                `I do not know whether “${step.name}” already exists, and I am not going to guess`,
              )
            }

            if (step.kind === 'create_project') {
              const actions = await NotebookActions.fromVault(db)
              if (actions === null) {
                throw new Error('no NotebookLM credential in the vault; cannot make a notebook')
              }
              // The notebook first: 0067 refuses a project with no attachment, so
              // reversing this order leaves nothing to attach.
              const notebook = await actions.createNotebook(step.name)
              effectRef = notebook.id
              const { rows } = await db.execute(`
                select app.hq_create_project(
                  ${lit(step.name)}, 'notebooklm', ${lit(notebook.id)}, ${lit(step.name)}
                ) as r
              `)
              const made = (
                rows[0] as { r: { error?: string; project_id?: string; slug?: string } }
              ).r
              if (made.error !== undefined) throw new Error(String(made.error))
              acc.projectId = String(made.project_id)
              acc.projectName = step.name
              // Artifacts belong here too, not just documents. Without a `home`
              // the generate handler falls back to "any notebook source", which is
              // the same notebook today and would not be once a second is attached.
              await db.execute(`
                update public.project_attachments
                   set role = 'home', artifact_kind = 'artifact'
                 where project_id = ${lit(acc.projectId)}::uuid and connector = 'notebooklm'
              `)
              acc.said.push(`started “${step.name}” with a new notebook`)
              acc.references.push(`notebooklm:${notebook.id} ${step.name}`)
              return { outcome: acc as unknown as Outcome, effectRef }
            }

            if (acc.projectId === null) throw new Error('no project to carry this plan out in')

            switch (step.kind) {
              case 'attach': {
                const { rows } = await db.execute(`
                  select app.hq_attach(
                    (select slug from public.projects where project_id = ${lit(acc.projectId)}::uuid),
                    ${lit(step.link.kind === 'notion' ? 'notion' : 'notebooklm')},
                    ${lit(step.link.ref)},
                    ${step.link.kind === 'notebooklm' ? "'home'" : "'source'"},
                    ${step.link.kind === 'notebooklm' ? "'artifact'" : 'null'},
                    null
                  ) as r
                `)
                const r = (rows[0] as { r: { error?: string } }).r
                acc.said.push(
                  r.error === undefined ? 'attached it' : `could not attach it: ${r.error}`,
                )
                break
              }

              case 'add_source': {
                await child(db, job, acc.projectId, 'notebook.add_source', {
                  url: step.link.url,
                  kind: step.link.kind,
                })
                acc.said.push(`sending ${step.link.url} to the notebook`)
                break
              }

              case 'generate': {
                // No delay and no silence: the generate handler asks Grant for
                // permission itself (0083), which is the message he gets next.
                await child(db, job, acc.projectId, 'notebook.generate', { kind: step.artifact })
                acc.said.push(`queued the ${step.artifact} — I will ask before making it`)
                break
              }

              case 'ask': {
                // After the sources, and the step checks their status before
                // answering rather than trusting this number.
                await child(
                  db,
                  job,
                  acc.projectId,
                  'notebook.ask',
                  { question: step.question, await_sources: true },
                  FIRST_ASK_DELAY,
                )
                acc.said.push('will read it and come back to you here')
                break
              }
            }
            return { outcome: acc as unknown as Outcome }
          },
        })),
      )

      if (run.kind === 'paused') {
        // A pause is an outcome, not a failure: the attempt is not burned, and the job says where it
        // stopped and what a person has to check.
        return done(
          `I stopped part way through the plan, at "${run.at}": ${run.pause.detail} ${run.pause.resumeWhen}`,
          [`job:${job.jobId}`],
        )
      }
      if (run.kind === 'stopped') {
        return done(`Stopped at "${run.at}", as you asked.`, [`job:${job.jobId}`])
      }

      const last = steps.length === 0 ? undefined : run.outcomes[stepName(steps.length - 1)]
      const acc = (last ?? {
        projectId: job.projectId,
        projectName: '',
        said: [],
        references: [],
      }) as unknown as Acc
      const list =
        acc.said.length === 1
          ? (acc.said[0] as string)
          : `${acc.said.slice(0, -1).join(', ')}, and ${String(acc.said.at(-1))}`
      return done(
        `Right — ${list}.` +
          (acc.projectName === '' ? '' : ` Everything for this is under “${acc.projectName}”.`),
        acc.references.length > 0 ? acc.references : [`job:${job.jobId}`],
      )
    },
  }
}

/**
 * One step, as a job on the right project.
 *
 * `enqueue_child` inherits the parent's project, and for a plan that created a
 * project the parent's is the wrong one — `enqueue_inbound` picked the most
 * recently updated active project for the message that started all this. So the
 * project is set explicitly afterwards, in the same statement.
 */
async function child(
  db: SqlExecutor,
  job: Job,
  projectId: string,
  kind: string,
  payload: Record<string, unknown>,
  delay = '0',
): Promise<void> {
  // The project as a PARAMETER (0090). The first version wrapped the enqueue in
  // a CTE and updated the row afterwards in the same statement — where the
  // UPDATE's snapshot predates the insert the CTE performed, so it matched
  // nothing, raised nothing, and left every step of the plan on the parent's
  // project. Grant's video went into the wrong notebook and both outputs read
  // as success.
  await db.execute(`
    select app.enqueue_child(
      ${lit(job.jobId)}::uuid, ${lit(kind)},
      ${lit(JSON.stringify(payload))}::jsonb,
      ${lit(delay)}::interval, true, ${lit(projectId)}::uuid
    )
  `)
}
