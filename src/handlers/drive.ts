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

import { mayAct, recordRefusal } from '../agents/approval.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { changesIn, describeKind, driveAccess, listFolder, startToken } from '../google/drive.ts'
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
  /** Whether today's listing backstop is owed for this folder (0503). */
  reconcile_due: boolean
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
      // What the policy let it do, and what the policy stopped (#15). Counted
      // apart from `asked`, because "I took eleven files in" and "I asked about
      // eleven files" are different sentences and the report must not be able
      // to say the wrong one.
      let took = 0
      let refused = 0
      /*
        Counted apart from `took`, because "I brought eleven new files in" and
        "I re-read eleven files Grant had already filed" are different
        sentences and the report must not be able to say the wrong one — the
        same distinction `took` was split from `asked` for.
      */
      let refreshedFiles = 0

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

        /*
          A file the office ALREADY holds, changed in Drive, is a refresh and
          not a question.

          The filter above is right about arrivals and was silently dropping
          this case: Grant said yes to this file once, edited it in Drive, and
          the office went on answering from the version it read that day. It is
          the run mandate's "changes must update the index", and asking him
          again about a file he has already filed would be the worse of the two
          available bugs.

          Enqueued rather than read inline, so it goes through the same
          `drive.read_file` handler as the first import and cannot drift from
          it. `record_drive_document` fingerprints the text, so a change to a
          file's name or its sharing settings — which Drive reports as a change
          — costs one read and records `unchanged`.
        */
        const changed = changes.files.filter((file) => ours.has(file.id))
        for (const file of changed) {
          await db.execute(`
            select app.enqueue_child(
              ${lit(job.jobId)}::uuid, 'drive.read_file',
              jsonb_build_object(
                'project_id', ${lit(f.project_id)},
                'folder_id', ${lit(f.folder_id)},
                'file_id', ${lit(file.id)},
                'title', ${lit(file.name)},
                'mime_type', ${lit(String(file.mimeType ?? 'application/octet-stream'))}
              ),
              interval '0', false)
          `)
        }
        refreshedFiles += changed.length

        /*
          And the deletions, which the changes feed structurally cannot report
          (0503).

          A `removed` change carries no file object, so there is nothing to
          attribute to a folder; an expired page token loses events; a file
          trashed while nothing was watching produces no change at all. So once
          a day, for a folder the office actually holds documents for, the
          folder is LISTED and `app.reconcile_vanished` — 0465's mechanism,
          with its blast-radius guard and two-strike rule — is given the ids
          that are still there.

          A failed listing is passed through as an error rather than as an
          empty list. Handing `{}` to the reconciler would say every document
          in the folder had been deleted, and relying on the guard to catch the
          caller's own mistake is how a guard becomes the only thing between a
          failed request and a wiped corpus.
        */
        if (f.reconcile_due) {
          const listed = await listFolder(access, f.folder_id, fetchImpl)
          await db.execute(`
            select app.drive_reconcile(${lit(f.attachment_id)}::uuid, ${lit(f.folder_id)},
              array[${listed.ids.map((i) => lit(i)).join(', ')}]::text[],
              ${listed.error === null ? 'null' : lit(listed.error)})
          `)
        }

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

        /*
          Ask the policy BEFORE asking Grant (#15).

          This is the sentence #15 exists for. Until now this handler called
          `raiseBlocker` unconditionally -- it asked whatever he had set the
          dial to, and one of the options it offered him was literally "Just
          tell me when things land here, do not ask again", which nothing could
          honour because there was nowhere to write the answer.

          `drive.ingest` is a level-1 tool: the document lands as a project
          source with no text read yet, nothing is opened, nothing is sent. So
          `act_with_review` and `act` take it in and say so; `suggest` asks, as
          today; `observe` refuses and records why.
        */
        /*
          No `jobAskedFor`, deliberately.

          Pressing Check now asks for a LOOK at the folder. Taking in whatever
          turned up is something this job might additionally do, and reading
          his request as consent for it would be reading "check that folder" as
          "and add everything in it". Only a standing authorization or the dial
          makes this proceed.
        */
        const policy = await mayAct(db, { projectId: f.project_id, tool: 'drive.ingest' })

        if (policy.verdict === 'proceed') {
          /*
            A child job per file, not a row per file (#257).

            The first draft wrote the document here with `record_drive_document`
            and no text, which would have put a Drive file in the index as a
            TITLE — findable by name and useless for "the document about X",
            which is the sentence #257 exists for.

            `drive.read_file` already exports a Doc to text, downloads a PDF to
            the files bucket and records the document itself — implemented for
            #96 and, until now, **enqueued by nothing at all**. That is why the
            index holds 60 NotebookLM documents, 23 Notion documents and zero
            from Drive: #72's shape, the finished half with no caller.

            So this enqueues it. One job per file so a single unreadable file
            cannot stop the rest, and `p_announce => false` because Grant hears
            from the Chief of Staff and this job already speaks for the batch.
          */
          for (const file of arrived) {
            await db.execute(`
              select app.enqueue_child(
                ${lit(job.jobId)}::uuid, 'drive.read_file',
                jsonb_build_object(
                  'project_id', ${lit(f.project_id)},
                  'folder_id', ${lit(f.folder_id)},
                  'file_id', ${lit(file.id)},
                  'title', ${lit(file.name)},
                  'mime_type', ${lit(String(file.mimeType ?? 'application/octet-stream'))}
                ),
                interval '0', false)
            `)
          }
          took += arrived.length
          await db.execute(`
            select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
              ${lit(changes.nextToken ?? f.page_token)}, false, null)
          `)
          continue
        }

        if (policy.verdict === 'refuse') {
          /*
            #211: a gate that refuses without recording is a lost answer. The
            impediment is what the Governance page reads, and it names the tool
            and the reason rather than leaving a folder quietly unwatched.
          */
          await recordRefusal(db, {
            jobId: job.jobId,
            tool: 'drive.ingest',
            because: policy.because,
            noticedBy: 'chief-of-staff',
          })
          refused += 1
          await db.execute(`
            select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
              ${lit(changes.nextToken ?? f.page_token)}, false, null)
          `)
          continue
        }

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
            // Answering with this one writes a standing authorization for
            // `drive.ingest` in this project, which is what makes it true
            // rather than a sentence (#15, migration 0421).
            'Add them from now on without asking me',
            'Ignore these',
          ],
          originatingAgent: 'chief-of-staff',
          // Answering with that option writes a standing authorization for
          // `drive.ingest` in THIS project, and the next arrival is taken in
          // rather than asked about (#15, migrations 0421 and 0422).
          standingTool: 'drive.ingest',
          standingOption: 'Add them from now on without asking me',
          /*
            And the first option now DOES something (#257).

            It has been offered since #62 and could never work: the page token
            advances whether or not Grant was asked, so by the time he answers
            these files are no longer in the change list. The files he is being
            asked about are named here, so answering reads exactly those and
            nothing depends on the folder still reporting them.
          */
          onAnswer: {
            option: 'Add them to the project as source documents',
            kind: 'drive.read_file',
            payloads: arrived.map((file) => ({
              project_id: f.project_id,
              folder_id: f.folder_id,
              file_id: file.id,
              title: file.name,
              mime_type: String(file.mimeType ?? 'application/octet-stream'),
            })),
          },
          // The rest of the project carries on. This is a question, not a halt.
          workCanContinue: true,
        })
        asked += 1

        await db.execute(`
          select app.drive_watch_checked(${lit(f.attachment_id)}::uuid,
            ${lit(changes.nextToken ?? f.page_token)}, true, null)
        `)
      }

      if (asked === 0 && took === 0 && refused === 0 && refreshedFiles === 0) {
        return quiet(
          `Looked at ${count(looked, 'Drive folder', 'Drive folders')}. Nothing new.`,
          looked,
        )
      }

      /*
        One sentence per thing that actually happened, in the order Grant cares
        about: what was taken in, what he is being asked about, what the policy
        stopped. A report that folds all three into "I have asked what to do"
        would be claiming an action for a folder it refused, which is the
        output-contradicts-its-own-metadata defect #185 exists for.
      */
      const said: string[] = []
      if (took > 0) {
        said.push(
          `${count(took, 'new file', 'new files')} ${took === 1 ? 'is' : 'are'} being read ` +
            'into the project as ' +
            `${took === 1 ? 'a source' : 'sources'}, because you said not to ask about that.`,
        )
      }
      if (asked > 0) {
        said.push(
          `${count(asked, 'folder has', 'folders have')} something new in ${
            asked === 1 ? 'it' : 'them'
          }. I have asked what to do.`,
        )
      }
      if (refused > 0) {
        said.push(
          `${count(refused, 'folder is', 'folders are')} set to watch only, so I have ` +
            'left what arrived alone and written down that I could not take it in.',
        )
      }
      if (refreshedFiles > 0) {
        /*
          Said, and deliberately not announced on its own below. Re-reading a
          file Grant already filed is the office keeping its own index honest,
          not news — and a message every ten minutes saying "I re-read a file
          you edited" is the hourly repetition `announce` exists to stop.
        */
        said.push(
          `${count(refreshedFiles, 'file', 'files')} you had already filed ` +
            `${refreshedFiles === 1 ? 'has' : 'have'} changed in Drive, so ` +
            `${refreshedFiles === 1 ? 'it is' : 'they are'} being read again.`,
        )
      }

      return {
        body: said.join(' '),
        shape: 'nothing_happened',
        facts: { changed: took > 0 || refreshedFiles > 0, looked_at: looked },
        /*
          A blocker speaks for itself, and this job saying the same thing
          seconds later is the duplication the instruction handler already had
          to fix once: "this job goes quiet and the request speaks for both".

          Taking a file in is different. Nothing else tells him, and the whole
          point of a standing authorization is that he stops being ASKED, not
          that the office goes silent — CLAUDE.md's rule that a gate which
          fails into silence gets quieter the better it gets, with the sign
          flipped.
        */
        announce: took > 0,
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
