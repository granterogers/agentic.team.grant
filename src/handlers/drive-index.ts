/**
 * Reading connected Drive documents in the BACKGROUND, to keep their searchable text. HQ-DOC-026.
 *
 * Grant, 5 October 2026: agents may read and index a connected Drive document on their own. THAT IS NOT AN IMPORT.
 *
 *   index   reads the source read-only and keeps only derived material: extracted text in documents.content (the existing
 *           chunk index picks it up), the source's own version markers, and when it was last checked.
 *   import  an explicit press that makes a durable Team HQ copy. Text derived here is not "held" material (0990), so an
 *           import of an indexed document still fetches the source.
 *
 * So this handler has no way to write a binary (it calls no storage function and imports none), no way to write to Drive
 * (the provider is the read-only preview adapter), and nothing to ask: it cannot import, move, share or publish.
 *
 * The list of documents it may read comes from the database in one place, app.document_index_candidates (1020): the
 * attachment must be enabled AND Google connected for the office (1010), the document not in back-off, and not checked in
 * the last six hours. A disconnected or revoked source is therefore never fetched again until it is reconnected. Per run it
 * reads a handful, oldest check first, and stops at the first sign that Drive is pushing back (rate limit, quota), so a
 * back-log is worked through over hours and never in a burst.
 *
 * An unchanged document costs one metadata call: Drive's modified time (and checksum where it has one) is compared with
 * the cache, and the file is fetched only when they differ. A failure is written down with its reason and the document is
 * left alone for a back-off; the run's own output says what happened, in numbers, so the failures are not silent.
 */
import { LIMITS, capText, driveProvider, sourceChanged } from '../documents/preview.ts'
import type { CacheRow, Failure, SourceMeta } from '../documents/preview.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { driveAccess } from '../google/drive.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { fileText } from '../text/file-text.ts'
import { redactSecrets } from '../text/secrets.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface DriveIndexDeps {
  readonly db: SqlExecutor
  readonly fetchImpl?: typeof fetch
  /** Documents read per run when the job does not say. */
  readonly perRun?: number
  /** Wall-clock budget for one run, in ms. */
  readonly budgetMs?: number
  readonly now?: () => number
}

interface Candidate {
  readonly document_id: string
  readonly external_ref: string
  readonly title: string
}

/** A failure that means Drive is pushing back: stop the run rather than spend more of the quota. */
const PUSHBACK = new Set([
  'rate_limited',
  'quota',
  'unavailable',
  'unreachable',
  'unauthorised',
  'forbidden',
])

const json = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

export function driveIndexHandler(deps: DriveIndexDeps): Handler {
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? (() => Date.now())
  return {
    kind: 'drive.index',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const said = (body: string, ok = true): HandlerOutput => ({
        body,
        // Quiet by design: an hourly sentence about indexing is the repetition Grant has asked not to get.
        announce: false,
        confidence: ok ? 'high' : 'low',
        evidence: ok ? 'verified' : 'inferred',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      })
      const started = now()
      const budget = deps.budgetMs ?? 100_000
      const office = `app.job_office(${lit(job.jobId)}::uuid)`

      const cfg = (
        await deps.db.execute(
          `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
        )
      ).rows[0] as { pinned_config?: { limit?: number } } | undefined
      const asked = Number(cfg?.pinned_config?.limit)
      const limit =
        Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), 25) : (deps.perRun ?? 8)

      const listed = await deps.db.execute(
        `select app.document_index_candidates(${office}, ${String(limit)}) as c`,
      )
      const todo = json<Candidate[]>((listed.rows[0] as { c?: unknown } | undefined)?.c ?? []) ?? []
      if (todo.length === 0) return said('No connected Drive document is due for a read.')

      const access = await driveAccess(deps.db, fetchImpl)
      if (!('accessToken' in access)) {
        // Nothing was tried for any document, so nothing is blamed on one: the next hour asks again.
        return said(`Drive could not be reached for the background read: ${access.reason}`, false)
      }
      const provider = driveProvider(access.accessToken, fetchImpl)

      const tally = {
        unchanged: 0,
        indexed: 0,
        metadata: 0,
        failed: 0,
        skipped: 0,
        stoppedEarly: '',
      }
      const outcome = async (
        doc: Candidate,
        ok: boolean,
        indexed: boolean,
        error: string | null,
      ) => {
        await deps.db.execute(
          `select app.document_index_outcome(${office}, ${lit(doc.document_id)}::uuid, ${ok}, ${indexed}, ${error === null ? 'null' : lit(redactSecrets(error))})`,
        )
      }
      const fail = async (doc: Candidate, f: Failure) => {
        tally.failed += 1
        await outcome(doc, false, false, `${f.code}: ${f.message}`)
      }

      for (const doc of todo) {
        if (now() - started > budget) {
          tally.stoppedEarly = 'the time budget for one run was spent'
          break
        }
        const described = await provider.describe(doc.external_ref)
        if (!described.ok) {
          await fail(doc, described.failure)
          if (PUSHBACK.has(described.failure.code)) {
            tally.stoppedEarly = `Drive said ${described.failure.code}`
            break
          }
          continue
        }
        const meta: SourceMeta = described.meta
        if (meta.trashed) {
          // In the bin: nothing to read, nothing to keep fresh. Checked, not failed.
          tally.skipped += 1
          await outcome(doc, true, false, null)
          continue
        }
        const how = provider.howToShow(meta)
        if (how.kind === 'unsupported') {
          tally.skipped += 1
          await outcome(doc, true, false, null)
          continue
        }
        const planned = await deps.db.execute(
          `select app.document_preview_plan(${office}, ${lit(doc.document_id)}::uuid, null) as p`,
        )
        const plan = json<{ ok?: boolean; connected?: boolean; cache?: CacheRow | null }>(
          (planned.rows[0] as { p: unknown }).p,
        )
        if (plan.ok !== true || plan.connected === false) {
          // Switched off between the list and the read: not read, and not blamed on Drive.
          tally.skipped += 1
          continue
        }
        const cache = plan.cache ?? null
        // A cache row for this very version means this office (or a person's preview) has already read it.
        if (cache !== null && !sourceChanged(cache, meta)) {
          tally.unchanged += 1
          await outcome(doc, true, false, null)
          continue
        }
        const recordMeta = JSON.stringify({
          modifiedTime: meta.modifiedTime,
          mime: meta.mime,
          version: meta.version,
          size: meta.size,
        })
        const record = async (
          kind: 'text' | 'pdf' | 'image',
          text: string | null,
          truncated: boolean,
        ) => {
          const r = await deps.db.execute(
            `select app.document_preview_record(${office}, ${lit(doc.document_id)}::uuid, ${lit(recordMeta)}::jsonb, ${lit(kind)}, ${text === null ? 'null' : lit(text)}, ${truncated}) as r`,
          )
          return json<{ ok?: boolean; error?: string }>((r.rows[0] as { r: unknown }).r)
        }

        if (how.kind === 'image') {
          // Nothing to search in a picture; remember the version so it is not asked about again until it changes.
          const r = await record('image', null, false)
          if (r.ok === true) {
            tally.metadata += 1
            await outcome(doc, true, false, null)
          } else {
            tally.failed += 1
            await outcome(doc, false, false, r.error ?? 'could not be recorded')
          }
          continue
        }

        let text = ''
        if (how.kind === 'pdf' || how.via === 'extract') {
          const raw = await provider.fetchBytes(doc.external_ref, meta)
          if (!raw.ok) {
            await fail(doc, raw.failure)
            if (PUSHBACK.has(raw.failure.code)) {
              tally.stoppedEarly = `Drive said ${raw.failure.code}`
              break
            }
            continue
          }
          const read = await fileText(raw.bytes, meta.mime, meta.name)
          text = read.text ?? ''
        } else {
          const fetched = await provider.fetchText(doc.external_ref, meta, how)
          if (!fetched.ok) {
            await fail(doc, fetched.failure)
            if (PUSHBACK.has(fetched.failure.code)) {
              tally.stoppedEarly = `Drive said ${fetched.failure.code}`
              break
            }
            continue
          }
          text = fetched.text
        }
        const capped = capText(text.slice(0, LIMITS.derivedChars * 2))
        const r = await record(
          how.kind === 'pdf' ? 'pdf' : 'text',
          capped.text.trim() === '' ? null : capped.text,
          capped.truncated,
        )
        if (r.ok === true) {
          if (capped.text.trim() === '') tally.metadata += 1
          else tally.indexed += 1
          await outcome(doc, true, capped.text.trim() !== '', null)
        } else {
          tally.failed += 1
          await outcome(doc, false, false, r.error ?? 'could not be recorded')
        }
      }

      const parts = [
        `${String(todo.length)} connected Drive document(s) were due.`,
        `Read and indexed: ${String(tally.indexed)}. Unchanged: ${String(tally.unchanged)}. Version noted only: ${String(tally.metadata)}. Skipped: ${String(tally.skipped)}. Failed: ${String(tally.failed)}.`,
        tally.stoppedEarly === ''
          ? ''
          : `Stopped early: ${tally.stoppedEarly}; the rest wait for the next hour.`,
        'Nothing was imported and nothing was copied: only searchable text and version markers are kept.',
      ].filter((s) => s !== '')
      return said(parts.join(' '), tally.failed === 0)
    },
  }
}
