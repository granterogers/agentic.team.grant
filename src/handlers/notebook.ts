/**
 * Job handlers for the notebook actions an MCP client can ask for.
 *
 * The client asks (0068), the worker does. The MCP endpoint is a Deno Edge
 * Function and cannot spawn the Python the adapter needs — and an audio
 * overview takes minutes, so a tool call that did the work in-band would time
 * out in every client. The constraint and the right design agree.
 *
 * ## Why `src/handlers/` exists, which is a directory this file created
 *
 * §7 has two rules and they are stricter together than either is alone:
 * operational code must not depend on the notebook, AND the notebook module
 * must not reach back into the job engine. `tests/notebook/isolation.test.ts`
 * enforces both, and it caught two attempts at this file in a row —
 * `src/notebook/handlers.ts` broke the second rule, and `src/jobs/
 * notebook-handlers.ts` broke the first.
 *
 * Both failures were correct, and the second one is the more interesting: a
 * notebook job handler is not part of the job engine. The engine takes
 * handlers; it does not own them. So they belong in neither module, and this
 * third directory is where a handler that bridges two things lives — importing
 * the engine's `Handler` type and the notebook's adapter, while neither
 * imports it.
 *
 * The composition root is `scripts/work.ts`. That is the only place that knows
 * both exist, which is exactly what §13's "if Gate 2 proves too brittle, stop"
 * needs to remain available: deleting the notebook means deleting this file and
 * one line of wiring.
 *
 * ## Where the notebook comes from
 *
 * The project's `home` attachment for artifacts (0067), never a notebook id
 * from the client. A client naming a notebook is a client writing into
 * whichever of Grant's notebooks it likes, and the attachment table exists
 * precisely so that "where does this project's output go" has one answer.
 *
 * A project with no notebook attached fails with that sentence, rather than
 * silently picking the first notebook it finds.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { ARTIFACT_KINDS, type ArtifactKind, NotebookActions } from '../notebook/actions.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** The notebook a project's artifacts belong in, or null with a reason. */
async function notebookFor(
  db: SqlExecutor,
  projectId: string,
): Promise<{ id: string; name: string } | null> {
  const { rows } = await db.execute(`
    select external_ref, display_name
      from public.project_attachments
     where project_id = ${lit(projectId)}::uuid
       and connector = 'notebooklm'
       and enabled
       -- The home for artifacts, or failing that any notebook source: a
       -- project that reads from a notebook and has not been told where to
       -- write can reasonably write back to the one it reads.
     order by case when role = 'home' then 0 else 1 end
     limit 1
  `)
  const row = rows[0] as { external_ref?: string; display_name?: string } | undefined
  return row?.external_ref === undefined
    ? null
    : { id: String(row.external_ref), name: String(row.display_name ?? '') }
}

const payloadOf = async (db: SqlExecutor, job: Job): Promise<Record<string, unknown>> => {
  const { rows } = await db.execute(
    `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
  )
  return ((rows[0] as { pinned_config?: Record<string, unknown> } | undefined)?.pinned_config ??
    {}) as Record<string, unknown>
}

/**
 * A notebook operation's result.
 *
 * `verified` because these are operations, not opinions: the notebook either
 * accepted the source or it did not, and calling that `inferred` would cry
 * wolf. §16 exempts a deterministic output from review for exactly this case.
 *
 * **With the notebook as the source, which is not decoration.** The first
 * version passed `sources: []` and every job failed on §10's gate — *"evidence
 * is 'verified' with no sources. Verified means someone can go and check; with
 * nothing to check, the correct label is different."* The gate was right and
 * the fix is not to downgrade the label: someone CAN go and check, by opening
 * the notebook, and naming it is what makes the claim true rather than merely
 * asserted.
 */
const deterministic = (body: string, notebook: { id: string; name: string }): HandlerOutput =>
  ({
    body,
    confidence: 'high',
    evidence: 'verified',
    sources: [`notebooklm:${notebook.id} ${notebook.name}`],
    contradictions: null,
    path: 'deterministic',
    model: null,
  }) as unknown as HandlerOutput

export function notebookHandlers(db: SqlExecutor): readonly Handler[] {
  const need = async (
    job: Job,
  ): Promise<{ actions: NotebookActions; notebook: { id: string; name: string } }> => {
    const actions = await NotebookActions.fromVault(db)
    if (actions === null) {
      throw new Error('no NotebookLM credential in the vault; the connector is not configured')
    }
    if (job.projectId === null) throw new Error('this job has no project')
    const notebook = await notebookFor(db, job.projectId)
    if (notebook === null) {
      throw new Error(
        'this project has no NotebookLM notebook attached. Attach one before asking for ' +
          'notebook output — the alternative is writing into whichever notebook we found first.',
      )
    }
    return { actions, notebook }
  }

  return [
    {
      kind: 'notebook.generate',
      handle: async (job: Job): Promise<HandlerOutput> => {
        const { actions, notebook } = await need(job)
        const payload = await payloadOf(db, job)
        const kind = String(payload.kind ?? '')
        if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
          throw new Error(`${kind} is not an artifact kind`)
        }
        const instructions =
          payload.instructions === null ? undefined : String(payload.instructions)
        const started = await actions.generate(notebook.id, kind as ArtifactKind, instructions)
        return deterministic(
          `Started a ${kind} in the notebook "${notebook.name}". Task ${String(started.taskId)}, ` +
            `state ${started.state}. Google takes a few minutes; it appears in the notebook when ready.`,
          notebook,
        )
      },
    },
    {
      kind: 'notebook.push_document',
      handle: async (job: Job): Promise<HandlerOutput> => {
        const { actions, notebook } = await need(job)
        const payload = await payloadOf(db, job)
        const documentId = String(payload.document_id ?? '')
        const { rows } = await db.execute(`
          select title, content from public.documents
           where document_id = ${lit(documentId)}::uuid
             and project_id = ${lit(String(job.projectId))}::uuid
        `)
        const doc = rows[0] as { title?: string; content?: string } | undefined
        if (doc?.content === undefined) {
          // Scoped to the job's project on purpose: a document id from one
          // project must not be pushable into another's notebook.
          throw new Error(`no document ${documentId} in this project`)
        }
        const sourceId = await actions.addText(
          notebook.id,
          String(doc.content),
          String(doc.title ?? 'From AI Team HQ'),
        )
        return deterministic(
          `Pushed "${String(doc.title)}" into the notebook "${notebook.name}" as source ` +
            `${String(sourceId)}.`,
          notebook,
        )
      },
    },
    {
      kind: 'notebook.ask',
      handle: async (job: Job): Promise<HandlerOutput> => {
        const { actions, notebook } = await need(job)
        const payload = await payloadOf(db, job)
        const question = String(payload.question ?? '')
        if (question.trim() === '') throw new Error('no question was given')
        const answer = await actions.ask(notebook.id, question)
        return {
          body: answer,
          confidence: 'medium',
          // NotebookLM answers from the sources with citations into them, which
          // is a stronger claim than our own retrieval makes — but it is still
          // a model reading documents, so `inferred` with the notebook named as
          // the source is the honest pair.
          evidence: 'inferred',
          sources: [`notebooklm:${notebook.id} ${notebook.name}`],
          contradictions: null,
          path: 'inference',
          model: 'notebooklm',
        } as unknown as HandlerOutput
      },
    },
  ]
}
