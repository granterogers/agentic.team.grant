/**
 * Is this request the same obligation as something already running? (#316)
 *
 * ## Why this is not text deduplication
 *
 * The candidates come from CANONICAL STATE — `app.conversation_work` returns
 * the jobs this conversation actually handed on and what each was asked to
 * do. Nothing is compared against a corpus, a history of phrasings or a
 * similarity threshold. The only question put to the model is which of these
 * REAL, RUNNING pieces of work, if any, the new sentence is asking for again.
 *
 * That matters because the alternative fails in both directions. A similarity
 * score high enough to catch "can you work out X" against "get someone to
 * work out X" also catches "draft the pricing email" against "draft the
 * pricing deck", and suppressing the second is worse than duplicating the
 * first: he asked for something and got nothing, silently.
 *
 * ## The exact-repeat case never reaches here
 *
 * `app.enqueue_child_once` refuses an identical obligation structurally, in
 * the database, where a unique index cannot be raced. This is only for the
 * REPHRASED case, which no key can catch.
 *
 * ## Every failure returns null
 *
 * No live work, no router, an unparseable answer, an index out of range, a
 * thrown request — all null, which means "go ahead and start it". That is
 * today's behaviour, so the worst this can do is fail to save a duplicate.
 * Answering the other way on a bad parse would suppress work he asked for.
 */

import type { ProviderRouter } from '../providers/router.ts'

export interface LiveWork {
  readonly job: string
  readonly about: string
  readonly who: string
  /**
   * What it produced, when it has already finished.
   *
   * #316's eighth case: previous work completed means answer FROM the
   * results, not start it again. Absent for work still running.
   */
  readonly answer?: string
}

const SYSTEM =
  'You decide whether a new request is asking for work that is ALREADY ' +
  'underway. You are given a numbered list of work currently running, and ' +
  'one new request.\n\n' +
  'Answer with a single number from the list when the new request is asking ' +
  'for THE SAME piece of work, however differently it is worded. Answer NONE ' +
  'when it asks for anything else — a different subject, a different ' +
  'deliverable, a narrower or wider question, or a follow-up about work ' +
  'rather than a request to do it.\n\n' +
  'Rules, all absolute:\n' +
  '- Output only the number, or the word NONE. No explanation.\n' +
  '- When you are not sure, answer NONE.\n' +
  '- Same subject is not enough. It must be the same work.\n' +
  '- A question about the work ("how is it going") is NONE, not a match.'

export async function alreadyPursuing(
  request: string,
  live: readonly LiveWork[],
  router: ProviderRouter | null,
  trace: { readonly jobId?: string; readonly correlationId?: string } = {},
): Promise<LiveWork | null> {
  const usable = live.filter((w) => w.about.trim() !== '')
  if (usable.length === 0 || router === null) return null

  const listed = usable
    .map((w, i) => `${String(i + 1)}. ${w.about.trim().slice(0, 240)}`)
    .join('\n')

  try {
    const result = await router.complete({
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Work already running:\n${listed}\n\nNew request:\n${request.trim().slice(0, 600)}`,
        },
      ],
      maxTokens: 1_200,
      temperature: 0,
      ...(trace.jobId === undefined ? {} : { jobId: trace.jobId }),
      ...(trace.correlationId === undefined ? {} : { correlationId: trace.correlationId }),
    })
    const said = String(result.content ?? '').trim()
    /*
      Strict. A number on its own, or NONE. The model returning a sentence is
      a refusal to answer the question asked, and reading a digit out of a
      sentence is how "item 2 of your 3 points" becomes a match.
    */
    const onlyANumber = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(said)
    if (onlyANumber === null) return null
    const index = Number(onlyANumber[1]) - 1
    return index >= 0 && index < usable.length ? (usable[index] ?? null) : null
  } catch {
    return null
  }
}
