/**
 * The handler behind the `credential-chores` duty (#259, migration 0484).
 *
 * #259's human-action bridge, with a real source. A dead credential is the
 * purest case of it there is: the office cannot do the thing, it knows exactly
 * who has to and what they have to do, and until now it said so in a table
 * Grant only sees if he opens Settings and goes looking.
 *
 * Two of them need him as this is written — `google_calendar / oauth_client`
 * has been refused since the 17th, so Gmail and Calendar have been returning
 * nothing for two days, and `Telegram / chief bot token` is missing. Neither
 * appeared anywhere he looks.
 *
 * ## Quiet, and why
 *
 * `announce` is false. The chore lands on My Tasks, which is where he reads a
 * list of things to do, and a message every hour saying the same credential is
 * still broken is the narration he has asked twice not to receive. The list
 * IS the notification, once.
 *
 * ## Both halves, or it is worse than nothing
 *
 * `chores_for_credentials` raises AND clears, and this handler reports both.
 * A to-do list that fills up and never empties is one he stops trusting, and
 * clearing is the half nobody sees working — so it is said out loud in the
 * output rather than left to be inferred from a shorter list.
 *
 * ## Two sources now: credentials, and the backup (0537)
 *
 * On 17 September the nightly backup failed, there was no copy of the
 * database from that date, and nothing told him. `app.office_health()` said
 * `failed: 1` for twenty-four hours in a reading nobody was watching, and
 * then the window moved and it said nothing at all — which is what it says
 * now and what it would say tonight if backups stopped for good.
 *
 * `app.chores_for_backups` is the same shape as the credential pass for the
 * same reason: a chore on My Tasks rather than a message, `chore_key`
 * deduping to one row instead of one an hour, cleared by the pass that
 * raises. It covers the two halves of invariant 13 — a recent FINISHED
 * backup, and a restore somebody has actually proven.
 *
 * This duty already runs hourly, which is why the check lives here rather
 * than getting a schedule of its own. CLAUDE.md's rule about new clocks is
 * the argument: a second schedule is a second thing that can silently stop.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { count } from '../text/plain.ts'

export function choresHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.chores',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:connection_health', 'db:backup_health'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
        announce: false,
      }

      const row = (await db.execute(`select app.chores_for_credentials() as r`)).rows[0] as
        | { r?: unknown }
        | undefined
      const raw = row?.r
      const outcome = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as {
        raised?: number
        cleared?: number
        about?: string[]
      }
      const raised = Number(outcome.raised ?? 0)
      const cleared = Number(outcome.cleared ?? 0)
      const about = Array.isArray(outcome.about) ? outcome.about : []

      /*
        What is OPEN, not just what changed this pass.

        A pass that raised nothing is not the same as a list with nothing on
        it, and reporting only the delta would say "nothing new" on the
        fiftieth hour of a credential nobody has fixed.
      */
      /*
        The backup pass, beside the credential one.

        Its own try/catch: a duty that reports credentials must not stop
        reporting them because the backup reading threw. The failure is said
        out loud rather than swallowed — an unreported backup check looks
        exactly like a backup that is fine, which is the whole defect this was
        written for.
      */
      let backupNote = ''
      try {
        const bRow = (await db.execute(`select app.chores_for_backups() as r`)).rows[0] as
          | { r?: unknown }
          | undefined
        const bRaw = bRow?.r
        const b = (typeof bRaw === 'string' ? JSON.parse(bRaw) : (bRaw ?? {})) as {
          raised?: number
          cleared?: number
          about?: string[]
        }
        const bRaised = Number(b.raised ?? 0)
        const bCleared = Number(b.cleared ?? 0)
        const bAbout = Array.isArray(b.about) ? b.about : []
        if (bRaised > 0) {
          backupNote = ` The backup needs you: ${bAbout.join(', ')}.`
        } else if (bCleared > 0) {
          backupNote = ' The backup is healthy again.'
        }
      } catch (error) {
        backupNote = ` The backup check could not run: ${(error as Error).message.slice(0, 160)}.`
      }

      const open = Number(
        (
          (
            await db.execute(
              `select count(*)::int as n from public.tasks
                where chore_key like 'credential:%' and state <> 'done'`,
            )
          ).rows[0] as { n?: number }
        )?.n ?? 0,
      )

      const body =
        raised === 0 && cleared === 0
          ? open === 0
            ? 'Every credential the office holds is working.'
            : `Nothing changed. ${count(open, 'credential', 'credentials')} still ` +
              'on your list to reconnect.'
          : [
              raised === 0
                ? ''
                : `${count(raised, 'credential', 'credentials')} on your list to reconnect` +
                  (about.length === 0 ? '' : ` — ${about.join(', ')}`),
              cleared === 0 ? '' : `${count(cleared, 'chore', 'chores')} cleared, working again`,
            ]
              .filter((x) => x !== '')
              .join('. ') + `. ${count(open, 'open', 'open')} in all.`

      return { ...base, body: body + backupNote } satisfies HandlerOutput
    },
  }
}
