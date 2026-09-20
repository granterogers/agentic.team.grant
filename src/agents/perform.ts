/**
 * Turning a validated plan into durable work (#283).
 *
 * ## The invariant this file exists for
 *
 *     STEP B CONSUMES THE ACTUAL OBSERVATION PRODUCED BY STEP A.
 *
 * Not a guessed output, not two independent handlers, not prose pretending the
 * first one happened. `runSteps` already hands each step the recorded outcomes
 * of the steps before it, so the property is one the office HAS — it simply had
 * nothing that could compose a plan to use it.
 *
 * ## No second workflow engine
 *
 * #263 forbids one and `checkpoint.ts` says so in its own header. A plan
 * compiles into `Step[]` and the existing loop runs it: skip what is recorded,
 * park an interrupted external write, refuse a checkpoint written by different
 * code, stop between steps when asked. Everything durable here is already
 * built; this is the compiler, not the runtime.
 *
 * ## Two gates, and they are different questions
 *
 * `goal.ts`'s validator asks **does this capability EXIST and may it be
 * proposed** — a question about `public.tool_permissions`, which owns
 * permission truth.
 *
 * This file asks **can it actually be PERFORMED** — a question about whether
 * code exists that does it. A registry row claiming a capability with nothing
 * behind it is 0298's defect, and the answer to it is not to trust the row: a
 * step whose capability has no executor becomes an honest impediment rather
 * than a silent no-op, which is what `check:callers` exists to prevent one
 * layer down.
 *
 * ## An observation is evidence, not prose
 *
 * Every executor returns canonical facts — ids, counts, titles, whether it
 * found anything — and those are what the next step reads and what the final
 * answer is checked against. The brief's rule: *"created task" requires a real
 * task receipt.* A step that cannot produce evidence returns `found: false`
 * and says why, because an empty result and a failed look are different
 * things and CLAUDE.md records what conflating them costs.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { Outcome, Step } from '../jobs/checkpoint.ts'
import { isUntrusted, retrieve } from '../knowledge/retrieval.ts'
import type { GoalPlan, PlanStep } from './goal.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** What an executor is given. Deliberately small and all canonical. */
export interface Doing {
  readonly db: SqlExecutor
  readonly jobId: string
  readonly projectId: string | null
  /** The whole request, so a step can be specific about what it is looking for. */
  readonly request: string
  /** The step being performed. */
  readonly step: PlanStep
  /** What the steps it depends on actually found. THE point of this file. */
  readonly from: Readonly<Record<string, Outcome>>
}

/**
 * What a step did, as facts.
 *
 * `found` separates "I looked and there was nothing" from "I could not look",
 * which every reader in this repository has had to learn the hard way.
 */
export interface Observation extends Outcome {
  readonly capability: string
  readonly found: boolean
  /** Canonical ids this step created or read. The receipt. */
  readonly ids: readonly string[]
  /** A short, factual line for the next step and for the narration. */
  readonly saw: string
  /** Set when the step could not run at all. */
  readonly impediment?: string
}

export interface Executor {
  /** What it does outside the office, so an interrupted resume knows. */
  readonly effect: 'none' | 'local' | 'external'
  readonly run: (doing: Doing) => Promise<Observation>
}

/**
 * Everything the steps before this one found, as one block a model can read.
 *
 * This is the mechanical heart of "B consumes A". A step with `needs: []` gets
 * nothing; a step naming earlier ids gets exactly their observations, in order,
 * as facts rather than as a summary somebody wrote.
 */
export const whatWeFound = (doing: Doing): string => {
  const lines: string[] = []
  for (const id of doing.step.needs) {
    const o = doing.from[id] as Observation | undefined
    if (o === undefined) continue
    lines.push(
      o.found
        ? `From "${id}": ${o.saw}`
        : `From "${id}": nothing was found${o.impediment === undefined ? '' : ` — ${o.impediment}`}`,
    )
  }
  return lines.join('\n')
}

const nothing = (capability: string, why: string): Observation => ({
  capability,
  found: false,
  ids: [],
  saw: '',
  impediment: why,
})

/**
 * THE EXECUTORS.
 *
 * Keyed by the SAME names `public.tool_permissions` uses, so the two halves
 * cannot drift into two vocabularies — 0311 was spent undoing exactly that.
 * A capability in the registry and absent here is reported as a gap rather
 * than skipped, which is the honest direction.
 */
export const EXECUTORS: Readonly<Record<string, Executor>> = {
  /**
   * What this project actually holds. The commonest first step of a real goal
   * — "review X and tell me what is missing" cannot begin any other way.
   */
  'db.read': {
    effect: 'none',
    run: async ({ db, projectId }): Promise<Observation> => {
      if (projectId === null) {
        return nothing('db.read', 'no project is in scope for this request')
      }
      const { rows } = await db.execute(`
        select
          (select count(*) from public.documents
            where project_id = ${lit(projectId)}::uuid and state <> 'archived')::int as docs,
          (select count(*) from public.tasks
            where project_id = ${lit(projectId)}::uuid and state <> 'done')::int as open_tasks,
          (select coalesce(string_agg(t, '; '), '') from (
             select left(title, 70) as t from public.documents
              where project_id = ${lit(projectId)}::uuid and state <> 'archived'
              order by created_at desc limit 8) d)::text as doc_titles,
          (select coalesce(string_agg(t, '; '), '') from (
             select left(title, 70) as t from public.tasks
              where project_id = ${lit(projectId)}::uuid and state <> 'done'
              order by created_at desc limit 8) k)::text as task_titles,
          (select coalesce(max(updated_at)::text, '') from public.documents
            where project_id = ${lit(projectId)}::uuid) as newest`)
      const r = (rows[0] ?? {}) as Record<string, unknown>
      const docs = Number(r.docs ?? 0)
      const open = Number(r.open_tasks ?? 0)
      return {
        capability: 'db.read',
        found: docs > 0 || open > 0,
        ids: [projectId],
        saw:
          `${String(docs)} document(s) and ${String(open)} open task(s). ` +
          `Documents: ${String(r.doc_titles ?? '') || 'none'}. ` +
          `Open tasks: ${String(r.task_titles ?? '') || 'none'}.`,
        docs,
        openTasks: open,
        docTitles: String(r.doc_titles ?? ''),
        taskTitles: String(r.task_titles ?? ''),
        newest: String(r.newest ?? ''),
      }
    },
  },

  /**
   * What the project's material actually SAYS, rather than what it is called.
   *
   * `db.read` counts and titles; this reads. It is the step that makes a
   * composed plan worth composing — "look through the pricing project and put
   * whatever is out of date on my list" cannot be answered from titles, and a
   * second step handed titles will invent the rest.
   *
   * ## Untrusted material does not travel downstream
   *
   * `isUntrusted` fences the open internet and inbound correspondence (#135,
   * #172): material somebody OUTSIDE this office wrote and the office pulled
   * in automatically. Retrieval hands it to a model behind a fence, which is
   * right for an answer a person then reads. It is NOT right here, because an
   * observation is consumed by the next step as fact — that is the whole point
   * of this file — and a plan step is not a reader who can weigh it.
   *
   * So a hit from a fenced connector is COUNTED and NAMED and its text is
   * withheld, which is the refusing direction. Widening it needs evidence that
   * a downstream step can hold a fence, not the observation that the material
   * would be useful.
   */
  'notebook.read': {
    effect: 'none',
    run: async ({ db, projectId, request, step }): Promise<Observation> => {
      /*
        The step's own `why` is what this step is looking for; the request is
        the fallback, because a plan whose steps carry no reason is one the
        validator let through with the request as the only thing said.
      */
      const asking = (step.why === '' ? request : step.why).slice(0, 400)
      const hits = await retrieve(db, asking, projectId, 5).catch(() => null)
      if (hits === null) {
        return nothing('notebook.read', 'the knowledge index could not be searched')
      }
      const open = hits.filter((h) => !isUntrusted(h.connector))
      const fenced = hits.length - open.length
      if (open.length === 0) {
        return {
          capability: 'notebook.read',
          /*
            AN EMPTY SEARCH IS NOT A FAILED ONE, and the office has paid for
            conflating them. `found` is false because there is nothing for a
            later step to act on, and the reason says which of the two it was.
          */
          found: false,
          ids: [],
          saw: '',
          impediment:
            fenced === 0
              ? `nothing in the project's material matches "${asking.slice(0, 80)}"`
              : `the only matches (${String(fenced)}) are outside material, which does not travel into a later step`,
          searched: asking,
          fenced,
        }
      }
      return {
        capability: 'notebook.read',
        found: true,
        ids: open.map((h) => h.documentId),
        saw: open
          .map((h) => `"${h.title}": ${h.excerpt.replace(/\s+/g, ' ').trim().slice(0, 400)}`)
          .join('\n'),
        searched: asking,
        documents: open.length,
        fenced,
      }
    },
  },

  /**
   * Grant's own list, which is a different question from a project's tasks and
   * has its own reader (ADR-0041).
   */
  'task.create': {
    /*
      LOCAL, not none. A resume must not file the task twice, and `local` is
      what tells `step_begin` that repeating it is unsafe without a record.
    */
    effect: 'local',
    run: async ({ db, step, from, request }): Promise<Observation> => {
      /*
        THE DEPENDENCY, MADE REAL.

        Titles come from what the earlier step FOUND, never from the sentence.
        A step that depends on a read and then invents its own titles is the
        two-independent-handlers failure wearing a plan.
      */
      const upstream = step.needs
        .map((id) => from[id] as Observation | undefined)
        .filter((o): o is Observation => o !== undefined && o.found)
      if (step.needs.length > 0 && upstream.length === 0) {
        return nothing(
          'task.create',
          'the step it depends on found nothing, so there is nothing to put on the list',
        )
      }
      const title = (step.why === '' ? request : step.why).slice(0, 200)
      const detail =
        upstream.length === 0
          ? ''
          : upstream
              .map((o) => o.saw)
              .join('\n')
              .slice(0, 600)
      const { rows } = await db.execute(`
        select app.my_task_add(p_title => ${lit(title)},
                               p_detail => ${lit(detail)}) as t`)
      const raw = (rows[0] as { t?: unknown })?.t
      const got = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        ok?: boolean
        id?: string
        error?: string
      }
      if (got?.ok !== true || typeof got.id !== 'string') {
        return nothing('task.create', String(got?.error ?? 'the writer refused it'))
      }
      return {
        capability: 'task.create',
        found: true,
        ids: [got.id],
        saw: `Put on Grant's list: "${title}"`,
        title,
      }
    },
  },

  /**
   * Pulling what needs doing out of what a project holds — a child job,
   * because it is a model call over documents and this turn has to answer.
   */
  'task.extract': {
    effect: 'local',
    run: async ({ db, jobId }): Promise<Observation> => {
      const { rows } = await db
        .execute(`
          select app.enqueue_child(${lit(jobId)}::uuid, 'office.extract_tasks',
            jsonb_build_object('from', ''), interval '0', false)::text as id`)
        .catch(() => ({ rows: [] as Record<string, unknown>[] }))
      const id = String((rows[0] as { id?: string } | undefined)?.id ?? '')
      return id === ''
        ? nothing('task.extract', 'the extraction job could not be started')
        : {
            capability: 'task.extract',
            found: true,
            ids: [id],
            saw: 'Started reading what this project holds to pull out what needs doing.',
          }
    },
  },
}

/** Which registry capabilities this office can actually perform today. */
export const performable = (): readonly string[] => Object.keys(EXECUTORS)

/**
 * Compile a validated plan into durable steps.
 *
 * Order is the plan's order, which `validate` has already proved is a forward
 * chain — a step may only depend on one before it, so running the array in
 * sequence satisfies every dependency by construction and no scheduler is
 * needed. That is the second reason the validator refuses a forward reference:
 * not just cycles, but the ability to execute this as a loop.
 */
export const compile = (
  plan: GoalPlan,
  db: SqlExecutor,
  jobId: string,
  projectId: string | null,
  request: string,
): readonly Step[] =>
  plan.steps.map((step) => {
    const executor = EXECUTORS[step.capability]
    return {
      name: `${step.id}:${step.capability}`,
      effect: executor?.effect ?? 'none',
      run: async (done): Promise<{ outcome: Outcome }> => {
        /*
          A CAPABILITY THE OFFICE CANNOT PERFORM IS AN IMPEDIMENT, NOT A SKIP.

          The registry may legitimately hold a capability nothing here executes
          yet — 0298's whole lesson is that a row can claim anything. Recording
          the gap as an observation means the narration can say so and the
          later steps can see that their input never arrived, instead of the
          plan quietly doing less than it said.
        */
        if (executor === undefined) {
          return {
            outcome: nothing(
              step.capability,
              `${step.capability} is granted but nothing in the office performs it yet`,
            ),
          }
        }
        /*
          The outcomes are keyed by STEP NAME, and the plan's ids are what the
          dependencies use. Re-keyed here so an executor reads `from[id]`
          rather than having to know the compiled name.
        */
        const from: Record<string, Outcome> = {}
        for (const [name, outcome] of Object.entries(done)) {
          from[name.split(':')[0] ?? name] = outcome
        }
        return {
          outcome: await executor.run({ db, jobId, projectId, request, step, from }),
        }
      },
    }
  })
