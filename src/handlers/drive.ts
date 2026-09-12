/**
 * Noticing what Grant drops in a project's Drive folder.
 *
 * Issue #62:
 *
 *     "anytime I drop a document in there, chief of staff is like, oh, we see
 *      that a file has been dropped in Google Drive. What would you like me to
 *      do with that?"
 *
 * ## It asks. It does not ingest.
 *
 * That sentence is the specification and the restraint in it is the point. A
 * file appearing in a folder is not consent to do anything with it — the same
 * rule as *"please don't assume I wish to create a new project"*. So an arrival
 * becomes a `blockers` row with real options, and nothing is read, imported,
 * summarised or sent anywhere until he picks one.
 *
 * ## One question for twelve files
 *
 * Dropping a folder of documents must produce ONE question naming them, not
 * twelve questions. Grant, twice: *"there's a lot of mindless repetition on
 * Telegram and Slack."* A watcher that raises a blocker per file is the purest
 * possible form of that.
 *
 * ## The first pass reports nothing
 *
 * A folder attached today may hold two hundred files from last year. The first
 * pass takes a cursor and stays quiet; `drive_watch.primed` records that it
 * happened. Opening a new connection with two hundred questions would teach
 * him not to attach folders.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { changesIn, describeKind, driveAccess, startToken } from '../google/drive.ts'
import { raiseBlocker } from '../inference/record.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { count } from '../text/plain.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

interface Watched {
  attachment_id: string
  project_id: string
  project_name: string
  folder_id: string
  page_token: string | null
  primed: boolean
}

export function driveWatchHandler(db: SqlExecutor, fetchImpl: typeof fetch = fetch): Handler {
  return {
    kind: 'drive.watch',
    handle: async (job: Job): Promise<HandlerOutput> => {
      /*
        `looked` is not in scope yet where `quiet` is defined, so the count is
        passed in. Declaring the shape without it would mean a `looked_at` that
        is always zero -- a structured field that is worse than no field, since
        a consumer would believe it.
      */
      const quiet = (body: string, lookedAt = 0): HandlerOutput => ({
        body,
        // The structure beside the prose (#130). A ten-minute duty whose usual
        // answer is "nothing new" is exactly the case where a consumer should
        // not have to read a sentence to establish it.
        shape: 'nothing_happened',
        facts: { changed: false, looked_at: lookedAt },
        // Nothing found is not news. A duty that says "looked, saw nothing"
        // every ten minutes is the hourly repetition `announce` was added to
        // stop — Marcus told Grant "Looked through 2 notebooks. Nothing new."
        // on two channels for a day.
        announce: false,
        confidence: 'high',
        evidence: 'verified',
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval',
        model: null,
      })

      const folders = (await db.execute('select * from app.drive_folders_to_check(10)'))
        .rows as unknown as Watched[]
      if (folders.length === 0) return quiet('No Drive folders are attached to a live project.')

      const access = await driveAccess(db, fetchImpl)
      if (!access.ok) {
        // A scope problem is Grant's to fix and is worth saying once — but not
        // every ten minutes, so it rides the failure counter in `drive_watch`
        // and stops after five.
        for (const f of folders) {
          await db.execute(
            `select app.drive_watch_checked(${lit(f.attachment_id)}::uuid, null, false, ${lit(access.reason)})`,
          )
        }
        return quiet(`Cannot reach Drive: ${access.reason}`)
      }

      let asked = 0
      let looked = 0

      for (const f of folders) {
        looked += 1

        // Not primed: take a cursor, report nothing, and say so in the record
        // rather than in a message.
        if (!f.primed || f.page_token === null) {
          const token = await startToken(access, fetchImpl)
          await db.execute(`
            select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
              ${token === null ? 'null' : lit(token)}, false,
              ${token === null ? lit('could not take a start token') : 'null'})
          `)
          continue
        }

        const changes = await changesIn(access, f.folder_id, f.page_token, fetchImpl)
        if (changes.error !== null) {
          await db.execute(`
            select app.drive_watch_checked(${lit(f.attachment_id)}::uuid, null, false,
              ${lit(changes.error)})
          `)
          continue
        }

        /*
          Files the office put there itself are not arrivals.

          0169's lesson in its other direction: `mirrors_document_id` exists
          because a document we wrote into a connector was being counted as new
          material. A watcher that reported its own output would ask Grant what
          to do with a file it had just produced for him.
        */
        const ours = new Set(
          (
            await db.execute(`
              select external_ref from public.documents
               where connector = 'drive'
                 and external_ref is not null
                 and project_id = ${lit(f.project_id)}::uuid
            `)
          ).rows.map((r) => String((r as { external_ref?: string }).external_ref ?? '')),
        )
        const arrived = changes.files.filter((file) => !ours.has(file.id))

        if (arrived.length === 0) {
          await db.execute(`
            select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
              ${lit(changes.nextToken ?? f.page_token)}, false, null)
          `)
          continue
        }

        /*
          One blocker, naming them all.

          `requested_action` is the question he reads on Telegram, so it names
          up to four files and counts the rest — a list of forty filenames in a
          chat message is not a question, it is a wall.
        */
        const named = arrived
          .slice(0, 4)
          .map((x) => `${x.name} (${describeKind(x.mimeType)})`)
          .join(', ')
        const rest = arrived.length > 4 ? `, and ${String(arrived.length - 4)} more` : ''

        await raiseBlocker(db, {
          projectId: f.project_id,
          jobId: job.jobId,
          requestedAction:
            `${count(arrived.length, 'file has', 'files have')} appeared in the Drive folder ` +
            `for “${f.project_name}”: ${named}${rest}. What would you like me to do with ` +
            `${arrived.length === 1 ? 'it' : 'them'}?`,
          whyNeeded:
            'I have not opened or read anything yet. A file appearing is not an instruction, ' +
            'so I would rather ask than guess.',
          consequencesOfDelay:
            'Nothing happens to the files until you say. They stay where they are.',
          // Real options he can act on, not "acknowledge". The last one is the
          // reason this is a question at all.
          approvalOptions: [
            'Add them to the project as source documents',
            'Add them and summarise each one',
            'Just tell me when things land here, do not ask again',
            'Ignore these',
          ],
          originatingAgent: 'chief-of-staff',
          // The rest of the project carries on. This is a question, not a halt.
          workCanContinue: true,
        })
        asked += 1

        await db.execute(`
          select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
            ${lit(changes.nextToken ?? f.page_token)}, true, null)
        `)
      }

      if (asked === 0) {
        return quiet(
          `Looked at ${count(looked, 'Drive folder', 'Drive folders')}. Nothing new.`,
          looked,
        )
      }
      return {
        body: `${count(asked, 'folder has', 'folders have')} something new in ${
          asked === 1 ? 'it' : 'them'
        }. I have asked what to do.`,
        shape: 'nothing_happened',
        facts: { changed: true, looked_at: looked },
        // The blocker itself is what reaches him, with its own options on it.
        // This job saying the same thing seconds later is the duplication the
        // instruction handler already had to fix once: "this job goes quiet and
        // the request speaks for both".
        announce: false,
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
