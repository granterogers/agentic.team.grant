/**
 * Carrying out an instruction that arrived on a surface.
 *
 * Grant: *"I want to be able to communicate with them in Telegram, tell them
 * what to do, and those commands are relayed and actions are carried out."*
 *
 * The inbound path used to end at a table. `inbound_commands` had a writer and,
 * for text, no consumer — so a message to a bot was stored and nothing
 * happened, which from the outside is exactly what a broken bot looks like.
 * This is the consumer.
 *
 * ## Who answers
 *
 * Whoever was written to. Opening `@atg_research_bot` addresses Ines, and 0072
 * records that as `addressed_to` — the router treats it as the roster rather
 * than classifying one, because choosing whose bot to open is a clearer signal
 * than any classifier could extract from the text, and overriding it would make
 * the choice of bot decorative.
 *
 * When the message went to the Chief of Staff bot there is no `addressed_to`,
 * and then the router does decide: that is what a chief of staff is for.
 *
 * ## The reply goes back where the instruction came from
 *
 * Same chat, same bot, in that person's voice. A reply from the pager to a
 * message sent to Ines would be a colleague answering through a switchboard.
 */

import { recordDecision, route, scanForDuplicates } from '../agents/router.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { contextBlock, retrieve, sourceRefs } from '../knowledge/retrieval.ts'
import type { ProviderRouter } from '../providers/router.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface InstructionDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter
}

interface Payload {
  readonly instruction?: string
  readonly addressed_to?: string | null
  readonly origin_channel?: string
  readonly origin_ref?: string
  readonly command_id?: string
}

/**
 * The staff member who should answer, and the roster reason.
 *
 * Returned together because §5 requires the routing decision to be recorded
 * with its reasoning, and "Grant chose this person by opening their bot" is a
 * better reason than anything a classifier produces.
 */
async function speaker(
  db: SqlExecutor,
  addressedTo: string | null,
  instruction: string,
): Promise<{ slug: string; name: string; title: string; reason: string }> {
  const byName = addressedTo === null || addressedTo === '' ? null : addressedTo
  if (byName !== null) {
    const { rows } = await db.execute(
      `select slug, name, title from public.staff where slug = ${lit(byName)} and active`,
    )
    const s = rows[0] as { slug: string; name: string; title: string } | undefined
    if (s !== undefined) {
      return { ...s, reason: 'addressed directly — Grant opened this person’s bot' }
    }
  }

  // Nobody was named, so the Chief of Staff decides. Deliberately the cheapest
  // possible routing rather than a second classifier: §9's roster ceilings
  // already encode who a kind of request belongs to, and the instruction
  // handler is not the place to re-litigate them.
  const { classifyIntent } = await import('../agents/intent.ts')
  const { pickRoster } = await import('../agents/router.ts')
  const classified = classifyIntent(instruction)
  const { roster, reason } = pickRoster(classified, instruction)
  const chosen = roster[0] ?? 'chief-of-staff'
  const { rows } = await db.execute(
    `select slug, name, title from public.staff where slug = ${lit(chosen)} and active`,
  )
  const s = rows[0] as { slug: string; name: string; title: string } | undefined
  return s === undefined
    ? { slug: 'chief-of-staff', name: 'Chief of Staff', title: 'Chief of Staff', reason }
    : { ...s, reason }
}

export function instructionHandler(deps: InstructionDeps): Handler {
  return {
    kind: 'office.instruction',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const { rows } = await deps.db.execute(
        `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
      )
      const payload = ((rows[0] as { pinned_config?: Payload } | undefined)?.pinned_config ??
        {}) as Payload
      const instruction = String(payload.instruction ?? '').trim()
      if (instruction === '') throw new Error('the command carried no instruction')

      const who = await speaker(deps.db, payload.addressed_to ?? null, instruction)

      // The same retrieval the office uses, so an instruction answered in
      // Telegram cites the same corpus as one answered in Slack. §22's rule
      // that the source interface must not change the organisation's
      // behaviour applies to the answer as much as to the routing.
      const hits = await retrieve(deps.db, instruction, job.projectId)
      const context = contextBlock(hits)

      const completion = await deps.router.complete({
        messages: [
          {
            role: 'system',
            content:
              `You are ${who.name}, ${who.title} on a small team. You are replying to ` +
              'Grant, who runs it, in a private chat. Write as a colleague would: plain ' +
              'prose, first person, no preamble, no bullet points, under 120 words. Do ' +
              'not sign your name — the chat already shows who you are. If you are ' +
              'inferring rather than reporting, say so.' +
              (context === ''
                ? ' Nothing in our own records matched this, so answer from general ' +
                  'knowledge and open by saying our records had nothing on it.'
                : ' Numbered excerpts from our documents follow. Prefer them, cite them ' +
                  'as [1], [2], and say plainly when they do not answer the question.'),
          },
          ...(context === ''
            ? []
            : [{ role: 'system' as const, content: `Our documents:\n\n${context}` }]),
          { role: 'user', content: instruction },
        ],
        maxTokens: 2_000,
        correlationId: job.correlationId,
      })

      // §5: the decision is recorded with its reason, through the same
      // `recordDecision` the office uses.
      //
      // The first version hand-wrote the insert with an empty
      // `subject_terms` and was refused by
      // `routing_decisions_search_was_performed` — a constraint that exists
      // because "we checked for duplicates" must be a fact and not a
      // convention. Writing the row by hand was the mistake; the duplicate
      // scan is not optional here just because the roster was already decided.
      const scan = await scanForDuplicates(deps.db, instruction, {
        ...(job.projectId === null ? {} : { projectId: job.projectId }),
      })
      const decided = route(instruction, scan)
      await recordDecision(deps.db, job.jobId, {
        ...decided,
        // The roster is the one thing not left to the classifier: Grant chose
        // it by opening this person's bot.
        roster: [who.slug] as never,
        rosterReason: who.reason,
      })

      return {
        body: completion.content.trim(),
        confidence: 'medium',
        evidence: 'inferred',
        sources: sourceRefs(hits),
        contradictions: null,
        path: 'inference',
        model: completion.model,
      } as unknown as HandlerOutput
    },
  }
}
