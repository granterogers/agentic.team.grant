/**
 * Bringing an artifact out of a notebook and into the dashboard project.
 *
 * Issue #66. Grant:
 *
 *     "Claire could generate the audio, maybe bring that audio file into the
 *      dashboard project, and just directly have the audio file sent to me on
 *      Telegram that I can play it directly in Telegram rather than
 *      necessarily having to open notebook. That would be cool."
 *
 * Everything up to *"the notebook has an artifact"* already worked — create,
 * add sources, generate, poll. Nothing could get the artifact OUT, so the chain
 * stopped one step short of the only step he cares about, and the answer was
 * always a link back to NotebookLM.
 *
 * ## Three things, in order, and each is undoable by the next
 *
 *   1. fetch the bytes from Google
 *   2. put them in the `files` bucket and record a file document against the
 *      DASHBOARD PROJECT — his word, meaning the row in `public.projects`
 *   3. send it to him as playable audio
 *
 * Step 2 before step 3 deliberately. If the send fails he still has the file in
 * the project, which is where he asked for it to live; if the order were
 * reversed a Telegram outage would lose the artifact entirely, because the
 * notebook's own copy is not ours to rely on.
 *
 * ## The 50MB wall
 *
 * Telegram refuses a bot upload over 50MB and does not say so kindly. A long
 * audio overview can exceed it. That is a stated outcome — the file is in the
 * project and the message says where — and not a failure, because the thing he
 * asked for (the file, kept) did happen.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { putFile } from '../files/store.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotebookActions } from '../notebook/actions.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Telegram's own ceiling for a bot upload. */
export const TELEGRAM_UPLOAD_LIMIT = 50 * 1024 * 1024

export interface CollectDeps {
  readonly db: SqlExecutor
  readonly projectRef: string
  readonly serviceKey: string
}

interface Payload {
  readonly notebook_id?: string
  readonly artifact_id?: string
  readonly project_id?: string
  readonly title?: string
}

export function collectHandler(deps: CollectDeps): Handler {
  return {
    kind: 'notebook.collect_artifact',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const said = (body: string, announce: boolean): HandlerOutput => ({
        body,
        announce,
        confidence: 'high',
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      })

      const { rows } = await deps.db.execute(
        `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
      )
      const p = ((rows[0] as { pinned_config?: Payload } | undefined)?.pinned_config ??
        {}) as Payload

      const notebookId = String(p.notebook_id ?? '')
      const artifactId = String(p.artifact_id ?? '')
      const projectId = String(p.project_id ?? job.projectId ?? '')
      if (notebookId === '' || artifactId === '' || projectId === '') {
        return said(
          'I need a notebook, an artifact and a dashboard project to collect into.',
          false,
        )
      }
      if (deps.serviceKey === '') {
        return said('No service key, so I cannot store the file. Nothing was fetched.', false)
      }

      const actions = await NotebookActions.fromVault(deps.db)
      if (actions === null) {
        return said('No notebook credential in the vault.', false)
      }

      const got = await actions.download(notebookId, artifactId)
      /*
        A URL is fetched here rather than handed to Telegram.

        Google's share URL is not durably public and may carry the session, so
        passing it on would be both fragile and a disclosure. Fetching it means
        the bytes land in Grant's own storage, which is where he asked for them.
      */
      let bytes = got.bytes
      if (bytes === null && got.url !== null) {
        const r = await fetch(got.url)
        if (r.ok) bytes = new Uint8Array(await r.arrayBuffer())
      }
      if (bytes === null || bytes.byteLength === 0) {
        return said(`I could not get the bytes for that ${got.kind} out of the notebook.`, false)
      }

      const isAudio = got.kind.includes('audio')
      const mime = isAudio ? 'audio/mpeg' : 'application/octet-stream'
      const title = String(p.title ?? got.title ?? 'Notebook overview')
      // Keyed on the artifact, so a retry overwrites rather than duplicating.
      const path = `${projectId}/${artifactId}.${isAudio ? 'mp3' : 'bin'}`

      /*
        The shared writer (#96), not a private one.

        This function had its own `store()` and the edge function had its own
        signing fetch — one writer, one reader, no shared idea of where files
        live. A second writer (a PDF read out of Drive) made that a problem
        rather than untidiness: two places deciding the bucket, the upsert and
        the path convention is two places for them to disagree, and a file
        written to the wrong path is a file the reader cannot find.
      */
      const stored = await putFile(deps.projectRef, deps.serviceKey, path, bytes, mime)
      if (!stored.ok) {
        return said(`The file came back but storing it failed — ${String(stored.error)}.`, false)
      }

      const recorded = (
        await deps.db.execute(`
          select app.record_file_document(
            ${lit(projectId)}::uuid, ${lit(title)}, ${lit(path)}, ${lit(mime)},
            ${String(bytes.byteLength)}::bigint, ${lit(notebookId)}, ${lit(artifactId)},
            null, 'chief-of-staff', ${lit(job.jobId)}::uuid) as r
        `)
      ).rows[0] as { r?: { document_id?: string; error?: string } }
      if (recorded.r?.error !== undefined) {
        return said(`Stored the file but could not record it: ${recorded.r.error}`, false)
      }

      const mb = (bytes.byteLength / 1024 / 1024).toFixed(1)

      /*
        Over the wall: a stated outcome, not a failure.

        The thing he asked for — the file, in the dashboard project — happened.
        Only the delivery could not, and saying which is the difference between
        an answer and an error.
      */
      if (bytes.byteLength > TELEGRAM_UPLOAD_LIMIT) {
        return said(
          `“${title}” is in the project — ${mb} MB, which is over Telegram's 50 MB ` +
            'limit for a file I can send, so it is on the dashboard rather than here.',
          true,
        )
      }

      return {
        body: `“${title}” — ${mb} MB. It is in the project, and here it is to play.`,
        announce: true,
        severity: 'important',
        // The audio rides on the output's delivery rather than being sent
        // separately, so it is one message with the file and the sentence
        // together — Grant, on a voice note arriving as two messages: *"try to
        // have everything self contained."*
        attachAudio: {
          bytes,
          filename: `${title.replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 60) || 'overview'}.mp3`,
          title,
          performer: 'Your AI team',
        },
        confidence: 'high',
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      } satisfies HandlerOutput
    },
  }
}
