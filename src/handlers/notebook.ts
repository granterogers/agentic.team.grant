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
  NotebookActionError,
  NotebookActions,
} from '../notebook/actions.ts'
import { nothingToDo, type Plan } from '../tools/plan.ts'
import { allowance, deferUntil, describe, record, refused } from './meter.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * Where a notebook lives, for a person.
 *
 * The fallback link for anything finished that has no file of its own — a mind
 * map, an interactive quiz. Not a guess: it is the address Grant's own notebook
 * is at, and it opens the artifact in the place the artifact exists.
 */
const notebookUrl = (id: string): string => `https://notebooklm.google.com/notebook/${id}`

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
    path: 'deterministic_retrieval',
    model: null,
  }) satisfies HandlerOutput

/** How long to keep asking, and how far apart. ~20 minutes in total. */
const MAX_TICKS = 10
const TICK_GAP = '2 minutes'

/** Capitalised for the start of a sentence: "mind map is away" reads as a typo. */
const sentence = (v: string): string => `${v.charAt(0).toUpperCase()}${v.slice(1)}`

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
 * Our artifact kinds against the library's `ArtifactType`, as a hint of last
 * resort.
 *
 * Reached only when a generation gave back no task id, which happens for mind
 * maps. `external_ref` is normally the task id, recorded the moment the
 * generation starts, because the id the generator returns IS the id the
 * artifact appears under — worth measuring, because the first version of this
 * file assumed the two were unrelated and matched by "which artifact is new",
 * which handed the slide deck's artifact to the audio overview's collector
 * within one minute of going live.
 *
 * Matched against the library's mapped kind rather than the wire integer. The
 * version of this table that held integers was built by reading Grant's
 * notebook, had no row for a mind map, and so quietly never found one.
 */
const KIND_MATCHES: Record<string, string> = {
  audio: 'audio',
  slides: 'slide_deck',
  video: 'video',
  mindmap: 'mind_map',
  report: 'report',
  infographic: 'infographic',
  quiz: 'quiz',
  flashcards: 'flashcards',
  study_guide: 'report',
}

// There is no status table here, and that is the point. The first version had
// one — `3` ready, everything else pending — built by reading Grant's live
// notebook, which is a better source than a guess and still the wrong source.
// The library exposes `is_completed` and `is_failed` and says in as many words
// that the integers must not be read directly, because PENDING and PROCESSING
// were transposed on the wire in an earlier release. A private table would have
// gone on reading the old meaning with no symptom at all.
//
// Measured cost of not doing this first: `2` (in progress) was read as
// finished, and the collector announced a slide deck with no link. That slide
// deck then genuinely failed with `4`, and the code that should have said so
// said "still not ready" ten times instead.

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
 * The kind hint also stops being advisory when the listing HAS kinds. If the
 * library can name what these artifacts are and none of the fresh ones is
 * ours, the honest answer is "not yet" — falling back to "the newest" is how
 * the same collision returns through a different door. The advisory fallback
 * survives only for the case it was written for: a release that can name
 * nothing at all.
 */
function pick(
  listing: readonly ArtifactListing[],
  known: ReadonlySet<string>,
  kind: string,
): ArtifactListing | null {
  const fresh = listing.filter((a) => !known.has(a.artifactId))
  if (fresh.length === 0) return null
  const wanted = KIND_MATCHES[kind]
  const hinted = wanted === undefined ? [] : fresh.filter((a) => a.kind === wanted)
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

        // The gate, before the meter and before anything else (0083). Grant:
        // *"when it comes to any of the agents deciding to generate anything on
        // the notebook, I would like manual approval for that."*
        //
        // Here rather than in the office because three things can start a
        // generation — an instruction, an MCP client, a scheduled retry — and a
        // gate on the one door he watches is no gate at all on the two he does
        // not. The only thing that writes an approval is a button press.
        const approvedBy = payload.approved_by
        if (approvedBy === undefined || approvedBy === null || String(approvedBy) === '') {
          const forecast = await allowance(db, kind)
          const { rows: asked } = await db.execute(`
            select app.request_generation_approval(
              ${lit(job.jobId)}::uuid, ${lit(kind)},
              ${lit(`${LABEL[kind] ?? kind} for “${notebook.name}”`)},
              ${lit(`It costs about ${String(forecast.operationCost ?? 5)} of the notebook's allowance. ${describe(forecast)}`)}
            ) as id
          `)
          const asking = String((asked[0] as { id: string }).id)

          // Forced, whatever the enqueuer wanted. The office silences the
          // generation job because its own reply already acknowledged the
          // request (`announce = false`), and that was right until this gate
          // existed — after which it produced the worst possible outcome:
          // nothing generated, and nobody told why. A gate whose request can be
          // muted by a caller is not a gate.
          await db.execute(
            `update public.jobs set announce = true where job_id = ${lit(job.jobId)}::uuid`,
          )

          return {
            body:
              // Carries the acknowledgement too, now that the office's own is
              // suppressed: this is the first thing Grant sees after asking,
              // so it has to show that the ask was understood as well as ask
              // for permission.
              `You asked for ${LABEL[kind] ?? kind}. Shall I make it in "${notebook.name}"?` +
              (instructions === undefined ? '' : `\n\n${instructions}`) +
              `\n\n${describe(forecast)}` +
              '\n\nNothing happens until you say go ahead.',
            confidence: 'high',
            evidence: 'verified',
            // The request itself, so the trail from "she asked" to "he said
            // yes" is one join. §10's gate wants something checkable and a
            // blocker row is exactly that.
            sources: [`approval:${asking}`],
            contradictions: null,
            path: 'deterministic_retrieval',
            model: null,
          } satisfies HandlerOutput
        }

        // The meter, before spending anything (0078). Google's allowance is
        // compute-based since 2 September and cannot be queried, so this is our
        // own ledger — and the honest thing to do when it says no is to
        // schedule the work rather than refuse it.
        const meter = await allowance(db, kind)
        if (!meter.allowed) {
          const when = deferUntil(meter)
          await db.execute(`
            select app.enqueue_child(
              coalesce(
                (select parent_job_id from public.jobs where job_id = ${lit(job.jobId)}::uuid),
                ${lit(job.jobId)}::uuid
              ),
              'notebook.generate',
              (select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid),
              ${lit(`${String(Math.max(60, Math.round((when.getTime() - Date.now()) / 1000)))} seconds`)}::interval,
              true
            )
          `)
          return deterministic(
            `Not starting the ${LABEL[kind] ?? kind} yet — that would take us past what we ` +
              `think is safe on the notebook's five-hour allowance. ${describe(meter)} ` +
              `I have scheduled it for ${when.toISOString().slice(11, 16)} UTC, when the ` +
              'window turns over, and it will run then without you asking again.',
            notebook,
          )
        }

        // Snapshot BEFORE starting. A generator returns a task id and the
        // artifact appears in the listing minutes later under an id that has
        // nothing to do with the task, so the only reliable answer to "which
        // one is ours" is "the one that was not there a moment ago".
        const before = await actions.artifacts(notebook.id)
        let started: Awaited<ReturnType<typeof actions.generate>>
        try {
          started = await actions.generate(notebook.id, kind as ArtifactKind, instructions)
        } catch (error) {
          if (error instanceof NotebookActionError && error.quota) {
            // The measurement. Refused having spent what we spent, so the real
            // ceiling is at most that — and 0078 lowers ours to match, once.
            const learned = await refused(db, kind, error.detail)
            const when = deferUntil(await allowance(db, kind))
            await db.execute(`
              select app.enqueue_child(
                coalesce(
                  (select parent_job_id from public.jobs where job_id = ${lit(job.jobId)}::uuid),
                  ${lit(job.jobId)}::uuid
                ),
                'notebook.generate',
                (select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid),
                ${lit(`${String(Math.max(60, Math.round((when.getTime() - Date.now()) / 1000)))} seconds`)}::interval,
                true
              )
            `)
            return deterministic(
              `Google refused the ${LABEL[kind] ?? kind}: the notebook's usage limit is spent. ` +
                (learned.loweredTo === null
                  ? ''
                  : `I have lowered our own ceiling to ${String(learned.loweredTo)} units a ` +
                    'window, which is what that refusal measured. ') +
                `Rescheduled for ${when.toISOString().slice(11, 16)} UTC.`,
              notebook,
            )
          }
          throw error
        }
        await record(db, kind, {
          notebook: notebook.id,
          projectId: job.projectId,
          jobId: job.jobId,
        })

        // The task id IS the artifact id — measured, not assumed (see
        // `KIND_MATCHES`). Recording it here is what makes the collector exact
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

        // Quiet. He pressed Go ahead fifteen seconds ago; "it has started" is
        // not news, and the next message he wants is the link. Grant, on the
        // repetition: *"you need to watch that."*
        //
        // Unconditional, and safe to be: the gate above returns early unless
        // an approval is present, so there is no path to this line that Grant
        // did not just press a button on. That includes an MCP client's
        // generation — 0083 gates those too, which is the whole reason the gate
        // is in the handler rather than in the office.
        await db.execute(
          `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
        )
        return deterministic(
          `${sentence(LABEL[kind] ?? kind)} is away — Google has it (task ${String(started.taskId)}, ` +
            `${started.state}). Few minutes usually. I am watching for it and will post the ` +
            'link the moment it appears.',
          notebook,
        )
      },
    },
    {
      /**
       * Put a link into the project's notebook, so Google fetches and reads it.
       *
       * Grant: *"let's just say it's a YouTube link on the history of coaching,
       * and we just send him that link and say, add that to the project."* This
       * is the doing of it. Deciding that a link means this rather than
       * something else is `src/agents/links.ts`.
       *
       * The URL rather than our own fetch of it, deliberately. NotebookLM
       * transcribes a YouTube video and renders a PDF; we would hand it the
       * HTML of a consent banner.
       */
      kind: 'notebook.add_source',
      /*
        What it would do (#131). Reads the same payload and the same notebook
        row the work itself decides from, and stops there. It deliberately does
        NOT build a `NotebookActions` -- a dry run that touches the credential
        path is a dry run with a way to reach Google, and verify:dryrun fails a
        planning phase that makes any outward call at all.
      */
      plan: async (job: Job): Promise<Plan> => {
        const payload = await payloadOf(db, job)
        const url = String(payload.url ?? '')
        const notebook = job.projectId === null ? null : await notebookFor(db, job.projectId)
        if (notebook === null) {
          return nothingToDo('notebook.write', 'this project has no notebook attached')
        }
        if (!/^https?:\/\//.test(url)) {
          return nothingToDo('notebook.write', `${url} is not a link I can add`)
        }
        return {
          tool: 'notebook.write',
          reaches: ['google:notebooklm'],
          steps: [{ verb: 'create', what: url, where: `NotebookLM · ${notebook.name}`, writes: 1 }],
        }
      },
      handle: async (job: Job): Promise<HandlerOutput> => {
        const { actions, notebook } = await need(job)
        const payload = await payloadOf(db, job)
        const url = String(payload.url ?? '')
        if (!/^https?:\/\//.test(url)) throw new Error(`${url} is not a link I can add`)

        const meter = await allowance(db, 'add_url')
        if (!meter.allowed) {
          const when = deferUntil(meter)
          await db.execute(`
            select app.enqueue_child(
              coalesce(
                (select parent_job_id from public.jobs where job_id = ${lit(job.jobId)}::uuid),
                ${lit(job.jobId)}::uuid
              ),
              'notebook.add_source',
              (select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid),
              ${lit(`${String(Math.max(60, Math.round((when.getTime() - Date.now()) / 1000)))} seconds`)}::interval,
              true
            )
          `)
          return deterministic(
            `Holding that link until ${when.toISOString().slice(11, 16)} UTC — adding a source ` +
              `costs the notebook's allowance and we are at the edge of it. ${describe(meter)}`,
            notebook,
          )
        }

        try {
          await actions.addUrl(notebook.id, url)
        } catch (error) {
          if (error instanceof NotebookActionError && error.quota) {
            await refused(db, 'add_url', error.detail)
            throw new Error(
              `Google refused the source: the notebook's usage limit is spent. ${error.detail}`,
            )
          }
          throw error
        }
        await record(db, 'add_url', {
          notebook: notebook.id,
          projectId: job.projectId,
          jobId: job.jobId,
        })

        return deterministic(
          `In it goes — "${notebook.name}" now has ${url}\n\nGoogle is reading it; a video ` +
            'takes a few minutes to transcribe. Once it lands the whole team can cite it.',
          notebook,
        )
      },
    },
    {
      kind: 'notebook.push_document',
      /*
        The same read the work does -- the document, scoped to the job's own
        project, so a document id from one project cannot be planned into
        another's notebook any more than it can be pushed there.
      */
      plan: async (job: Job): Promise<Plan> => {
        const payload = await payloadOf(db, job)
        const documentId = String(payload.document_id ?? '')
        const notebook = job.projectId === null ? null : await notebookFor(db, job.projectId)
        if (notebook === null) {
          return nothingToDo('notebook.write', 'this project has no notebook attached')
        }
        const { rows } = await db.execute(`
          select title from public.documents
           where document_id = ${lit(documentId)}::uuid
             and project_id = ${lit(String(job.projectId))}::uuid
        `)
        const title = (rows[0] as { title?: string } | undefined)?.title
        if (title === undefined) {
          return nothingToDo('notebook.write', 'no such document in this project')
        }
        return {
          tool: 'notebook.write',
          reaches: ['google:notebooklm'],
          steps: [
            {
              verb: 'create',
              what: String(title),
              where: `NotebookLM · ${notebook.name}`,
              writes: 1,
            },
          ],
        }
      },
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
        // Cheap, but not free: Google processes a source on the way in, and a
        // meter that counts only the expensive things drifts (0078).
        await record(db, 'add_text', {
          notebook: notebook.id,
          projectId: job.projectId,
          jobId: job.jobId,
        })
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

        if (mine !== null && (mine.done || mine.failed)) {
          if (mine.failed) {
            await db.execute(`
              update public.artifacts
                 set state = 'failed', detail = ${lit(`the notebook reported ${mine.status}`)}
               where artifact_id = ${lit(rowId)}::uuid
            `)
            return deterministic(
              `The ${LABEL[row.kind] ?? row.kind} failed in the notebook "${notebook.name}" — ` +
                `it reported ` +
                `"${mine.status}". Nothing to link to; it can be asked for again.`,
              notebook,
            )
          }

          const detail = await actions.poll(notebook.id, mine.artifactId)
          // A direct link when Google gives us one — an audio overview is an
          // mp2 you can open — and the notebook itself when it does not.
          //
          // Measured: a mind map is finished and has no url of its own, ever.
          // It is interactive and lives inside NotebookLM. The first version
          // treated "complete with no url" as "not ready yet" and polled a
          // finished artifact until it gave up, which is the worst of both — it
          // never delivered the thing and never said why.
          const direct = detail.url !== null && detail.url !== ''
          const url = direct ? String(detail.url) : notebookUrl(notebook.id)
          const title = detail.title ?? mine.title ?? `${row.kind} overview`
          await db.execute(`
            update public.artifacts
               set state = 'ready', url = ${lit(url)}, title = ${lit(title)},
                   detail = null, ready_at = app.now_utc()
             where artifact_id = ${lit(rowId)}::uuid
          `)
          return deterministic(
            `${sentence(LABEL[row.kind] ?? row.kind)} is done — “${title}”\n${url}\n\n` +
              (direct
                ? `It is in "${notebook.name}" and in the project's store here too.`
                : `That link opens the notebook "${notebook.name}" — this one is interactive ` +
                  "and has no file of its own. It is in this project's store either way."),
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

        // A question about a video cannot be answered until Google has
        // transcribed it, and nothing tells us when that finished. So the step
        // LOOKS, rather than trusting the delay that scheduled it: a plan that
        // asked too early would get a confident answer about a source the
        // notebook had not read, which is the worst of the available outcomes.
        if (payload.await_sources === true) {
          const tick = Number(payload.tick ?? 1)
          const pending = (await actions.sources(notebook.id)).filter(
            (src) => !/ready/i.test(src.status),
          )
          if (pending.length > 0) {
            if (tick >= 8) {
              throw new Error(
                `${String(pending.length)} source(s) are still not ready after ` +
                  `${String(tick)} checks; the notebook cannot answer about them yet`,
              )
            }
            await db.execute(`
              select app.enqueue_child(
                coalesce(
                  (select parent_job_id from public.jobs where job_id = ${lit(job.jobId)}::uuid),
                  ${lit(job.jobId)}::uuid
                ),
                'notebook.ask',
                (select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid)
                  || jsonb_build_object('tick', ${String(tick + 1)}),
                interval '90 seconds', true
              )
            `)
            await db.execute(
              `update public.jobs set announce = false where job_id = ${lit(job.jobId)}::uuid`,
            )
            return deterministic(
              `Still waiting on ${String(pending.length)} source(s) to finish processing ` +
                `(check ${String(tick)}). I will ask again shortly.`,
              notebook,
            )
          }
        }
        const answer = await actions.ask(notebook.id, question)
        await record(db, 'ask', {
          notebook: notebook.id,
          projectId: job.projectId,
          jobId: job.jobId,
        })
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
        } satisfies HandlerOutput
      },
    },
  ]
}
