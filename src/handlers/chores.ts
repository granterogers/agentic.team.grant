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
        sources: [`job:${job.jobId}`, 'db:connection_health'],
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

      return { ...base, body } satisfies HandlerOutput
    },
  }
}
