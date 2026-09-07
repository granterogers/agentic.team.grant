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
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type ArtifactListing,
  NotebookActions,
} from '../notebook/actions.ts'

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

/** How long to keep asking, and how far apart. ~20 minutes in total. */
const MAX_TICKS = 10
const TICK_GAP = '2 minutes'

const LABEL: Record<string, string> = {
  audio: 'audio overview',
  slides: 'slide deck',
  video: 'video overview',
  mindmap: 'mind map',
  report: 'report',
  infographic: 'infographic',
  quiz: 'quiz',
  flashcards: 'flashcard set',
  study_guide: 'study guide',
}

/**
 * The library's own type codes, as a hint of last resort.
 *
 * Also bare numbers: `"1"` for the audio overview and `"8"` for the slide deck
 * started in the run that produced this comment, `"5"` for the mind maps from
 * the day before. Only the first two are certain, so only those two are here.
 *
 * This is reached only when a generation gave back no task id — which has not
 * happened yet. `external_ref` is normally the task id, recorded the moment the
 * generation starts, because the id the generator returns IS the id the
 * artifact appears under. That was worth measuring: the first version of this
 * file assumed the two were unrelated and matched artifacts by "which one is
 * new", which handed the slide deck's artifact to the audio overview's
 * collector within one minute of going live.
 */
const TYPE_HINT: Record<string, readonly string[]> = {
  audio: ['1'],
  slides: ['8'],
}

const READY = /^(3|ready|complete|completed|succeeded|success|done)$/i
const FAILED = /^(fail(ed)?|error|cancell?ed)$/i

const isPending = (status: string): boolean => !READY.test(status) && !FAILED.test(status)
const isFailed = (status: string): boolean => FAILED.test(status)

/**
 * Which listed artifact is the one we started, if any.
 *
 * ## The bug this function is shaped by
 *
 * Measured, 2026-09-07: Grant asked for an audio overview AND a slide deck in
 * one message. Two generations started seconds apart, so the slide deck's
 * "before" snapshot was taken before the audio existed. The audio appeared
 * first, the slide deck's collector saw it as new, claimed it, and hit
 * `artifacts_one_per_external_ref` — one artifact, two owners.
 *
 * So `known` is not merely what was there before this generation: it is that
 * plus everything any sibling row has already claimed in the same notebook.
 * The caller assembles it; this function must never be given less.
 *
 * The type hint also stops being advisory when the listing HAS types. If
 * Google labels its artifacts and none of the fresh ones is labelled ours, the
 * honest answer is "not yet" — falling back to "the newest" is how the same
 * collision returns through a different door. The advisory fallback survives
 * only for the case it was written for: a library release that reports no
 * types at all.
 */
function pick(
  listing: readonly ArtifactListing[],
  known: ReadonlySet<string>,
  kind: string,
): ArtifactListing | null {
  const fresh = listing.filter((a) => !known.has(a.artifactId))
  if (fresh.length === 0) return null
  const hints = TYPE_HINT[kind] ?? []
  const hinted = fresh.filter((a) => hints.includes(a.type))
  const pool =
    hinted.length > 0
      ? hinted
      : fresh.some((a) => a.type !== '')
        ? ([] as ArtifactListing[])
        : fresh
  // Newest first, and a listing with no timestamps keeps its own order.
  return [...pool].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))[0] ?? null
}

/** This job's output is real and not worth a message (0074). */
const quiet = async (db: SqlExecutor, job: Job): Promise<void> => {
  await db.execute(`update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`)
}

/** One more tick, or give up and say so out loud. */
async function again(
  db: SqlExecutor,
  job: Job,
  notebook: { id: string; name: string },
  rowId: string,
  tick: number,
  kind: string,
  why: string,
): Promise<HandlerOutput> {
  await db.execute(`
    update public.artifacts set detail = ${lit(`${why} (tick ${String(tick)})`)}
     where artifact_id = ${lit(rowId)}::uuid
  `)

  if (tick >= MAX_TICKS) {
    // Abandoning the WATCH, not the artifact: Google may still finish it, and
    // the row keeps the notebook and the reason so it can be picked up by hand.
    await db.execute(`
      update public.artifacts
         set state = 'abandoned',
             detail = ${lit(`gave up watching after ${String(tick)} checks — ${why}`)}
       where artifact_id = ${lit(rowId)}::uuid
    `)
    return deterministic(
      `The ${LABEL[kind] ?? kind} still is not ready after ${String(tick)} checks (${why}). ` +
        `I have stopped watching — it may yet appear in the notebook "${notebook.name}".`,
      notebook,
    )
  }

  // A SIBLING, not a child. §9 caps delegation at three levels and enforces it
  // in the database, and the first version of this chain hung each tick off the
  // last one — so the fourth poll of an artifact was refused as a fourth level
  // of delegation. It was right to refuse: polling is not delegating. Every
  // tick belongs at the same depth as the first, under the generation that
  // started the work.
  await db.execute(`
    select app.enqueue_child(
      coalesce(
        (select parent_job_id from public.jobs where job_id = ${lit(job.jobId)}::uuid),
        ${lit(job.jobId)}::uuid
      ),
      'notebook.collect',
      jsonb_build_object('artifact', ${lit(rowId)}, 'tick', ${String(tick + 1)}),
      interval '${TICK_GAP}', true
    )
  `)
  await quiet(db, job)
  return deterministic(
    `Checked (${String(tick)}/${String(MAX_TICKS)}): ${why}. Checking again shortly.`,
    notebook,
  )
}

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
          payload.instructions === undefined || payload.instructions === null
            ? undefined
            : String(payload.instructions)

        // Snapshot BEFORE starting. A generator returns a task id and the
        // artifact appears in the listing minutes later under an id that has
        // nothing to do with the task, so the only reliable answer to "which
        // one is ours" is "the one that was not there a moment ago".
        const before = await actions.artifacts(notebook.id)
        const started = await actions.generate(notebook.id, kind as ArtifactKind, instructions)

        // The task id IS the artifact id — measured, not assumed (see
        // `TYPE_HINT`). Recording it here is what makes the collector exact
        // instead of a guess about which artifact is newest.
        const { rows: made } = await db.execute(`
          insert into public.artifacts
            (project_id, notebook_ref, kind, state, detail, requested_by_job,
             external_ref, preexisting)
          values (
            ${lit(String(job.projectId))}::uuid, ${lit(notebook.id)}, ${lit(kind)},
            'generating',
            ${lit(`task ${String(started.taskId ?? 'unknown')}, ${started.state}`)},
            ${lit(job.jobId)}::uuid,
            ${started.taskId === null ? 'null' : lit(started.taskId)},
            ${lit(JSON.stringify(before.map((a) => a.artifactId)))}::jsonb
          )
          returning artifact_id
        `)
        const artifactId = String((made[0] as { artifact_id: string }).artifact_id)

        // Ninety seconds is the floor Google has never beaten in measurement,
        // so a sooner poll would only spend a notebook call learning nothing.
        await db.execute(`
          select app.enqueue_child(
            ${lit(job.jobId)}::uuid, 'notebook.collect',
            jsonb_build_object('artifact', ${lit(artifactId)}, 'tick', 1),
            interval '90 seconds', true
          )
        `)

        return deterministic(
          `Started the ${LABEL[kind] ?? kind} in the notebook "${notebook.name}". ` +
            `Task ${String(started.taskId)}, ` +
            `state ${started.state}. Google takes a few minutes; I am watching for it and will ` +
            'post the link here when it lands.',
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
      /**
       * Follow a generation to its link, and say so where it was asked for.
       *
       * Grant: *"once they're created, see if you can pull them into our store
       * project and display the results as a link within both Slack and
       * Telegram."* This is the pulling. The displaying is free: the output
       * this returns goes through the normal notifier, which already answers in
       * the originating Telegram chat and posts to the project's Slack channel.
       *
       * ## Why a chain of jobs rather than a loop
       *
       * An audio overview takes minutes and the lease is five. A handler that
       * slept until the artifact was ready would be a handler that loses its
       * lease and gets recovered as a stalled job halfway through — so each
       * tick is one poll, and a tick that finds nothing hangs the next tick off
       * itself with `not_before` set a couple of minutes out (0074).
       *
       * Those interim ticks set `announce = false` on their own job. They are
       * real outputs — the poll happened, the answer was "not yet" — and
       * telling Grant "not yet" nine times is how a pager becomes noise.
       */
      kind: 'notebook.collect',
      handle: async (job: Job): Promise<HandlerOutput> => {
        const { actions, notebook } = await need(job)
        const payload = await payloadOf(db, job)
        const rowId = String(payload.artifact ?? '')
        const tick = Number(payload.tick ?? 1)

        const { rows } = await db.execute(`
          select kind, state, external_ref, preexisting
            from public.artifacts
           where artifact_id = ${lit(rowId)}::uuid
             and project_id = ${lit(String(job.projectId))}::uuid
        `)
        const row = rows[0] as
          | { kind: string; state: string; external_ref: string | null; preexisting: unknown }
          | undefined
        if (row === undefined) throw new Error(`no artifact ${rowId} in this project`)
        if (row.state === 'ready') {
          // Already collected — a recovered duplicate, not a failure.
          await quiet(db, job)
          return deterministic('Already collected; nothing to do.', notebook)
        }

        const listing = await actions.artifacts(notebook.id)
        // Everything that is not ours: what predated this generation, plus
        // whatever a sibling collector has already claimed in this notebook.
        const { rows: taken } = await db.execute(`
          select external_ref from public.artifacts
           where notebook_ref = ${lit(notebook.id)} and external_ref is not null
             and artifact_id <> ${lit(rowId)}::uuid
        `)
        const known = new Set([
          ...(Array.isArray(row.preexisting) ? row.preexisting : []).map((v) => String(v)),
          ...taken.map((t) => String((t as { external_ref: string }).external_ref)),
        ])
        let mine =
          row.external_ref === null
            ? pick(listing, known, row.kind)
            : (listing.find((a) => a.artifactId === row.external_ref) ?? null)

        if (mine !== null && row.external_ref === null) {
          // Guarded rather than blind. Two workers can be inside this function
          // at once, and losing the claim is a normal outcome — the sibling row
          // is the owner and this one goes round again — not a job failure.
          const { rows: claimed } = await db.execute(`
            update public.artifacts set external_ref = ${lit(mine.artifactId)}
             where artifact_id = ${lit(rowId)}::uuid
               and not exists (
                 select 1 from public.artifacts other
                  where other.notebook_ref = ${lit(notebook.id)}
                    and other.external_ref = ${lit(mine.artifactId)}
               )
            returning artifact_id
          `)
          if (claimed.length === 0) mine = null
        }

        if (mine !== null && !isPending(mine.status)) {
          if (isFailed(mine.status)) {
            await db.execute(`
              update public.artifacts
                 set state = 'failed', detail = ${lit(`the notebook reported ${mine.status}`)}
               where artifact_id = ${lit(rowId)}::uuid
            `)
            return deterministic(
              `The ${row.kind} failed in the notebook "${notebook.name}" — it reported ` +
                `"${mine.status}". Nothing to link to; it can be asked for again.`,
              notebook,
            )
          }

          const detail = await actions.poll(notebook.id, mine.artifactId)
          const url = detail.url
          if (url === null || url === '') {
            // Reported complete with nowhere to go. Not treated as ready:
            // `artifacts_ready_has_a_link` would refuse the row anyway, and a
            // "here it is" with no link is worse than one more tick.
            return await again(db, job, notebook, rowId, tick, row.kind, 'complete but no link yet')
          }
          const title = detail.title ?? mine.title ?? `${row.kind} overview`
          await db.execute(`
            update public.artifacts
               set state = 'ready', url = ${lit(url)}, title = ${lit(title)},
                   detail = null, ready_at = app.now_utc()
             where artifact_id = ${lit(rowId)}::uuid
          `)
          return deterministic(
            `The ${LABEL[row.kind] ?? row.kind} is ready: “${title}”\n${url}\n\n` +
              `It is in the notebook "${notebook.name}" and in this project's store.`,
            notebook,
          )
        }

        return await again(
          db,
          job,
          notebook,
          rowId,
          tick,
          row.kind,
          mine === null ? 'not in the notebook yet' : `still ${mine.status}`,
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
