/**
 * The handler behind the `proposal-round` duty (#49, #272).
 *
 * The office records an impediment every time an agent cannot do something —
 * 589 of them on the day this was written — and `app.raise_proposals` turns
 * the recurring ones into proposals Grant can answer on the Governance page.
 *
 * **Nothing had ever called it.** `check:callers` had it in the baseline, and
 * the consequence was not an unused function: it was that the only proposals
 * in the table were the ones verification suites raised with
 * `p_include_fixtures => true`, so the section headed *What it wants* showed
 * Grant sixteen rows of test traffic and zero real ones. 0473 swept those and
 * filtered the reader; this is the half that makes real ones appear.
 *
 * ## And it tells him, ONCE (0489)
 *
 * The first version of this handler was silent — `announce: false`, on the
 * reasoning that the proposals land where he already reads them. That was
 * half right and it left the loop unfinished: `app.proposals_to_send` and
 * `app.proposals_sent` were built by 0295 for exactly this, **and neither had
 * ever had a production caller.** So the office raised proposals correctly
 * and then said nothing, and the only way Grant learned it was stuck was by
 * opening the Governance page and noticing.
 *
 * The distinction that makes both true: a DAILY COUNT is narration and he has
 * asked twice not to receive it; a NEW thing the office cannot do, said once,
 * is the request itself. So the round is silent when there is nothing
 * undelivered, and speaks when there is. `delivered_at` is what makes "once"
 * mean once.
 *
 * ## Why marking sent is not the last step
 *
 * Marking a batch delivered and then failing to deliver it loses it for ever:
 * the next pass skips it, and what is lost is precisely the message saying
 * the office is stuck. 0489 records WHICH job claimed each proposal, and
 * `app.proposals_undeliver` puts back anything whose job finished without a
 * sent delivery. The sweep runs FIRST here, so a failure yesterday is
 * recovered today.
 *
 * ## What it does NOT do
 *
 * It does not decide or act. `raise_proposals` refuses to rewrite a proposal
 * Grant has answered, and a declined one stays silent for three months — both
 * are the RPC's rules, not this handler's, and it must stay that way: a
 * handler that re-raised a decline would be arguing with him once a day.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { sayAs } from '../text/voice.ts'

/** One proposal, as `app.proposals_to_send` returns it. */
interface Waiting {
  readonly id: string
  readonly who: string
  readonly needed: string
  readonly title: string
  readonly remedy: string
}

export function proposeHandler(db: SqlExecutor, router: ProviderRouter | null = null): Handler {
  return {
    kind: 'office.propose',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`, 'db:job_impediments'],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
        announce: false,
      }

      /*
        FIRST: put back anything a previous round claimed to have told him
        about and did not (0489). A failure yesterday is recovered today, and
        the sweep can only ever restore a proposal, never hide one.
      */
      const restored = Number(
        ((await db.execute(`select app.proposals_undeliver() as n`)).rows[0] as { n?: number })
          ?.n ?? 0,
      )

      /*
        Thirty days and three occurrences, which are `raise_proposals`'s own
        defaults, stated rather than assumed: a duty that relied on the
        defaults would change behaviour silently the day somebody changed them.

        Fixtures excluded, which is the parameter's whole point (0297).
      */
      const row = (await db.execute(`select app.raise_proposals(30, 3, false) as r`)).rows[0] as
        | { r?: unknown }
        | undefined
      const raw = row?.r
      const outcome = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as {
        raised?: number
        updated?: number
        left_declined?: number
      }
      const raised = Number(outcome.raised ?? 0)
      const updated = Number(outcome.updated ?? 0)
      const silent = Number(outcome.left_declined ?? 0)

      const open = Number(
        (
          (
            await db.execute(
              `select count(*)::int as n from public.proposals
                where state = 'open' and not app.harness_label(needed)`,
            )
          ).rows[0] as { n?: number }
        )?.n ?? 0,
      )

      /*
        AND THE NOTICING ROUND, WHICH HAD NO CALLER AT ALL (#351).

        The round that fills the noticed section of the Governance page - this
        connector has produced nothing since you attached it, and the like.
        Nothing anywhere called it: the only database mention was inside a
        COMMENT, and the only caller in the repository was a verify suite,
        which is not a caller. public.suggestions had never held a row.

        Here rather than in a duty of its own, because it is the same idea as
        the round above: turn what the office noticed into something Grant can
        answer. One duty, two rounds, one report.

        Its count is deliberately NOT folded into raised: a proposal asks him
        for a capability and a suggestion points at something already in front
        of him, and a number that mixed them would mean neither.
      */
      const noticed = Number(
        ((await db.execute('select app.raise_suggestions(40) as n')).rows[0] as { n?: number })
          ?.n ?? 0,
      )

      const body =
        raised === 0 && updated === 0
          ? 'Nothing new the office could not do often enough to be worth asking about.' +
            (open === 0 ? '' : ` ${count(open, 'proposal', 'proposals')} still open.`)
          : `${count(raised, 'new proposal', 'new proposals')}` +
            (updated === 0 ? '' : `, ${String(updated)} seen again`) +
            (silent === 0
              ? ''
              : `, ${String(silent)} left alone because you have already said no`) +
            `. ${count(open, 'proposal', 'proposals')} open on the Governance page.`
      const withNoticed =
        noticed === 0
          ? body
          : `${body} ${count(noticed, 'thing', 'things')} noticed on the Governance page.`
      const withRestored =
        restored === 0
          ? withNoticed
          : `${withNoticed} ${count(restored, 'proposal', 'proposals')} put back: a previous ` +
            'round said it had told you and the message never arrived.'

      /*
        And the half that speaks (0489).

        Five, because `proposals_to_send` ranks by how often each has actually
        bitten and a list longer than that is one nobody reads to the end. The
        rest keep their turn on the next round.
      */
      const waiting = asWaiting(
        (await db.execute(`select app.proposals_to_send(5) as r`)).rows[0] as { r?: unknown },
      )
      if (waiting.length === 0) return { ...base, body: withRestored } satisfies HandlerOutput

      const lines = waiting.map((w) => `${w.who} could not ${w.needed} — ${w.remedy}`)
      const said = await sayAs(db, router, 'chief-of-staff', {
        purpose:
          'Tell Grant what the team has run into that it cannot do, and that each one ' +
          'is waiting for a yes or no from him on the Governance page. Do not argue for ' +
          'any of them and do not invent a cost. Keep the list as given.',
        facts: [
          `there ${waiting.length === 1 ? 'is' : 'are'} ${count(waiting.length, 'thing', 'things')} the team could not do`,
          ...lines,
          'each one is waiting for him to approve or decline it on the Governance page',
        ],
        fallback:
          `${count(waiting.length, 'thing', 'things')} the team could not do, waiting for you ` +
          `on the Governance page:\n\n${lines.map((l) => `- ${l}`).join('\n')}`,
        // #268: attributed, so the call lands under this job KIND.
        job: { jobId: job.jobId, correlationId: job.correlationId },
        words: 90,
      })

      /*
        Marked sent BEFORE delivery, and that is safe only because of the
        sweep at the top of this handler: `proposals_undeliver` puts back
        anything whose job finished without a `sent` delivery, so the claim is
        recoverable rather than final. Without that half this line would be
        the defect it exists to prevent.
      */
      await db.execute(
        `select app.proposals_sent(array[${waiting
          .map((w) => `'${w.id.replace(/'/g, "''")}'::uuid`)
          .join(', ')}], '${job.jobId.replace(/'/g, "''")}'::uuid) as n`,
      )

      return {
        ...base,
        body: said,
        // The one time this round is worth an interruption: something the
        // office cannot do, said once, is the request itself rather than
        // narration about it.
        announce: true,
        severity: 'routine',
        // The model wrote it, so the record says so. CLAUDE.md's fifth
        // instance of a handler claiming determinism over a model call, found
        // this morning in the Slack rotation handler.
        path: await howComposed(db, job.jobId),
      } satisfies HandlerOutput
    },
  }
}

/**
 * The batch, defensively.
 *
 * The executor hands a jsonb column back as an OBJECT, not a string —
 * CLAUDE.md records `JSON.parse(String(x))` producing
 * `"[object Object]" is not valid JSON` on exactly this shape — so both are
 * accepted. Anything missing an id is dropped rather than sent as
 * `undefined`, because a malformed row must not be able to mark a real
 * proposal delivered.
 */
const asWaiting = (row: { r?: unknown } | undefined): Waiting[] => {
  const raw = row?.r
  const list = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? [])
  if (!Array.isArray(list)) return []
  return list
    .map((x) => x as Partial<Waiting>)
    .filter((x) => typeof x.id === 'string' && x.id !== '')
    .map((x) => ({
      id: String(x.id),
      who: String(x.who ?? 'somebody'),
      needed: String(x.needed ?? 'something'),
      title: String(x.title ?? ''),
      remedy: String(x.remedy ?? 'no remedy recorded'),
    }))
}
