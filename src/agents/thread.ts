/**
 * What "it" refers to.
 *
 * Issue #63. Grant: *"it's struggling a little bit with what I just said about
 * the coaching for success message. Seems to have problems recalling what we
 * talked about before."*
 *
 * Every message was handled with only its own text. `inbound_commands` had
 * recorded every message he has ever sent and nothing read them back, so
 * "make the audio one long" arrived with no idea what "the audio" was — and
 * #60's plan parser was handed a sentence with no subject and blamed for
 * missing half of it.
 *
 * ## It resolves; it does not answer
 *
 * The one job here is to rewrite an elliptical sentence into a self-contained
 * one, so everything downstream — the parser, the say-back, the handlers — can
 * go on treating an instruction as a complete thought. It must never add a
 * step, drop a step, or answer the question. A resolver that helpfully expands
 * "do that" into a plan is a second planner, and the two would disagree.
 *
 * ## Most messages never reach the model
 *
 * The budget is ~£0/month and the common message is self-contained. So there
 * is a cheap test first: a sentence with no dangling reference is returned
 * untouched, without a call. That is most of them, and the ones it lets
 * through are exactly the ones worth spending on.
 *
 * ## And it says what it did
 *
 * A resolution is a guess about what he meant. A wrong one caught in the
 * say-back costs one message; a wrong one acted on silently costs the work.
 * So `changed` and `from` come back and the caller shows them.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { currentPerson } from '../office/person.ts'
import type { ProviderRouter } from '../providers/router.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface Turn {
  readonly at: string
  readonly who: string
  readonly text: string
}

export interface Resolved {
  readonly instruction: string
  readonly changed: boolean
  /** The original, when it was rewritten. For saying back. */
  readonly from: string | null
}

/*
  Does this sentence depend on something outside itself?

  Deliberately generous about what counts as a reference and strict about what
  counts as a subject: a false positive costs one cheap model call, a false
  negative costs the feature. The test is not "does it contain a pronoun" —
  "make it longer" and "add it to the project" both do, and so does "it costs
  nothing", which needs no resolution.

  What actually signals ellipsis is a referring expression with NO noun of its
  own nearby: "the audio one", "that", "those", "the second one", or an
  instruction that opens with a bare verb and never names a thing.
*/
const DANGLING =
  /\b(it|that|those|these|them|this|the (?:audio|video|slides?|deck|presentation|summary|report|first|second|last|other|same) one|the same|as (?:above|before)|again|instead)\b/i

/** A noun phrase specific enough to stand on its own. */
const NAMED = /["“”'‘’]|(?:\b[A-Z][a-z]+ [A-Z][a-z]+)|\bcalled\b|\bnamed\b|https?:\/\//

export function needsResolving(instruction: string): boolean {
  const text = instruction.trim()
  // A long instruction that names something is self-contained even if it also
  // says "it" halfway through — the antecedent is inside the sentence.
  if (NAMED.test(text) && text.length > 80) return false
  if (!DANGLING.test(text)) return false
  return true
}

/** The last few turns in this chat, both sides. */
export async function exchange(
  db: SqlExecutor,
  commandId: string,
  minutes = 90,
  limit = 12,
  jobId?: string,
): Promise<Turn[]> {
  if (commandId === '') return []
  // Only this office's conversation (0783). The office is the claimed job's when the caller holds one; a caller with
  // only the command (a harness, an operator script) reads it in the command's own office.
  const office =
    jobId !== undefined && jobId !== ''
      ? `app.job_office(${lit(jobId)}::uuid)`
      : `(select c.office_id from public.inbound_commands c where c.command_id = ${lit(commandId)}::uuid)`
  const { rows } = await db.execute(
    `select app.recent_exchange(${office}, ${lit(commandId)}::uuid, ${String(minutes)}, ${String(limit)}) as t`,
  )
  const turns = (rows[0] as { t?: Turn[] } | undefined)?.t
  return Array.isArray(turns) ? turns : []
}

/**
 * Rewrite an elliptical instruction into a self-contained one.
 *
 * Returns the original unchanged whenever it cannot do better — no history, no
 * model, a refusal, or an answer that looks like the model did something other
 * than what was asked. Falling back to the original is always safe: it is what
 * the office did before this existed.
 */
export async function resolveAgainstThread(
  db: SqlExecutor,
  router: ProviderRouter | null,
  commandId: string,
  instruction: string,
  options: { readonly correlationId?: string; readonly jobId?: string } = {},
): Promise<Resolved> {
  const untouched: Resolved = { instruction, changed: false, from: null }
  if (router === null) return untouched
  if (!needsResolving(instruction)) return untouched

  const turns = await exchange(db, commandId, 90, 12, options.jobId)
  if (turns.length === 0) return untouched

  // `who` is 'grant' for the office's person whoever that is (the label is the owner-key vocabulary, not a name).
  const script = turns
    .map((t) => `${t.who === 'grant' ? currentPerson().name : t.who}: ${t.text}`)
    .join('\n')

  let answer: string
  try {
    const result = await router.complete({
      messages: [
        {
          role: 'system',
          content:
            'You rewrite one sentence so it stands alone. You are given a chat ' +
            `history and the latest message from ${currentPerson().name}. Replace pronouns and ` +
            'shorthand in the LATEST MESSAGE with what they refer to, using the ' +
            'history.\n\n' +
            'Rules, all absolute:\n' +
            '- Output only the rewritten sentence. No preamble, no quotes, no ' +
            'explanation.\n' +
            '- Do not answer it, do not carry it out, do not comment on it.\n' +
            '- Do not add any step, requirement or detail that is not in the ' +
            'latest message or that it refers to.\n' +
            '- Do not remove anything from the latest message.\n' +
            '- If the latest message already stands alone, or the history does ' +
            'not say what it refers to, repeat it back exactly and unchanged.',
        },
        { role: 'user', content: `History:\n${script}\n\nLatest message:\n${instruction}` },
      ],
      // Enough for a long sentence and not enough for a plan. A cap is the
      // cheapest guard against the model deciding to be helpful.
      maxTokens: 300,
      ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }),
      ...(options.jobId === undefined ? {} : { jobId: options.jobId }),
    })
    answer = result.content.trim()
  } catch {
    // A resolver that can fail the job is worse than no resolver. The office
    // worked without this an hour ago and still can.
    return untouched
  }

  return accept(instruction, answer)
}

/**
 * Take the rewrite, or keep the original.
 *
 * Separated and exported so the judgement is testable without a model. Every
 * rule here exists because the failure it prevents is silent: a resolver that
 * quietly drops a clause produces a plausible instruction that is not the one
 * Grant gave, and nothing downstream can tell.
 */
export function accept(original: string, answer: string): Resolved {
  const clean = answer.replace(/^["“']|["”']$/g, '').trim()
  const untouched: Resolved = { instruction: original, changed: false, from: null }

  if (clean === '' || clean === original.trim()) return untouched

  // A rewrite should be about as long as the original plus the names it
  // substituted in. Much shorter means it summarised — which loses a clause.
  // Much longer means it started planning.
  if (clean.length < original.length * 0.6) return untouched
  if (clean.length > original.length * 3 + 120) return untouched

  // A model that starts explaining itself has stopped rewriting.
  if (/^(sure|okay|ok|here|the rewritten|rewritten|i )/i.test(clean)) return untouched
  // More than one line is a list, and a list is a plan.
  if (clean.includes('\n')) return untouched

  return { instruction: clean, changed: true, from: original }
}
