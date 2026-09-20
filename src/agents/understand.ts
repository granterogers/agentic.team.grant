/**
 * What Grant MEANS, resolved once, before anything decides what to do (#282).
 *
 * ## The hypothesis this file answers
 *
 * The office was asking deterministic TypeScript to understand human speech.
 * Traced in `handlers/instruction.ts`: every action decision — a task, a
 * preference, a document, a page fetch, an extraction, a follow-up change — is
 * made by regex between lines 2296 and 2723, and the first model call that
 * could have understood the sentence is at 3238. **Meaning was decided by
 * pattern matching and a model was then asked to write the reply about it.**
 *
 * Two production sentences show what that costs:
 *
 *   > "I've told you to always give your information in the form of clear
 *   > bullet points. Also, I want you to tell me what my current tasks are."
 *
 * `clauses.split` returned BOTH clauses correctly. Nothing downstream read
 * them: every recogniser ran on the whole message, `taskRequest` claimed it,
 * and the question was never answered.
 *
 *   > "Create a task for me and the um... No actually, you know what? Scan the
 *   > entirety of the Legacy Coaching Project and create appropriate tasks for
 *   > me to review."
 *
 * Same cause. One task, titled with the remainder of the transcript, including
 * the abandoned fragment and the filler.
 *
 * **The splitter was already right and its answer was thrown away.** That is
 * an architecture problem, not a missing phrase, and CLAUDE.md records eight
 * separate occasions of a regex being widened to cover one more way of
 * speaking.
 *
 * ## The boundary, and why THIS one
 *
 *     THE MODEL UNDERSTANDS THE HUMAN. DETERMINISTIC CODE CONTROLS REALITY.
 *
 * This file does not decide to do anything. It rewrites one messy utterance
 * into N clean standalone requests and says which were abandoned. The existing
 * deterministic cascade — which is good at a single clean request, and carries
 * every permission, capability, provenance, idempotency and approval guard the
 * office has — then executes each one exactly as it does today.
 *
 * Nothing here is authorization. A reading that says "Grant wants a task" is a
 * description of an utterance, not a right to write a row.
 *
 * ## Three properties that make it safe to put a model here
 *
 * 1. **It can only ever fall back to today.** Any failure — provider down,
 *    invalid JSON, a shape that does not validate, an ungrounded rewrite —
 *    yields the whole utterance as a single reading, which is precisely the
 *    current behaviour. The change cannot be worse than the status quo.
 * 2. **A rewrite must be GROUNDED in the utterance.** The model may drop
 *    filler and abandoned clauses and may re-order; it may not introduce
 *    content. Checked by vocabulary overlap, because an invented request is
 *    the one failure mode that would be worse than the defect being fixed.
 * 3. **It is bounded.** At most six readings, each at most 400 characters. A
 *    model that returns forty intents is malfunctioning, and executing forty
 *    actions from one sentence is the worst thing this layer could do.
 */
import type { ProviderRouter } from '../providers/router.ts'

/** What one surviving piece of an utterance is asking for. */
export type ReadingKind =
  /** Put something on Grant's own list. "remind me to ring the venue" */
  | 'task_create'
  /** Ask about his list. "what am I meant to be doing today" */
  | 'task_query'
  /** Change something already on it. "actually make that Friday" */
  | 'task_change'
  /** A standing instruction about how the office should behave. */
  | 'preference'
  /** A question for the office to answer. */
  | 'question'
  /** Work for the office to go and do, whose RESULT may be several tasks. */
  | 'delegate'
  /** Understood as a request, but none of the above. */
  | 'other'

const KINDS: readonly ReadingKind[] = [
  'task_create',
  'task_query',
  'task_change',
  'preference',
  'question',
  'delegate',
  'other',
]

export interface Reading {
  readonly kind: ReadingKind
  /**
   * The request as a single clean sentence, in Grant's own words wherever
   * possible.
   *
   * This is what the deterministic cascade is handed. It exists because that
   * cascade is demonstrably good at ONE clear request and demonstrably bad at
   * a paragraph of speech — so the model's job is to produce the former from
   * the latter, not to replace it.
   */
  readonly text: string
}

export interface Understanding {
  /** Every intent that survived the utterance, in the order he said them. */
  readonly surviving: readonly Reading[]
  /** What he started saying and then replaced. Never executed; said back. */
  readonly abandoned: readonly string[]
  /** How this was arrived at, so a failure is diagnosable from the record. */
  readonly how: 'model' | 'fallback' | 'trivial'
  /** Why the fallback was taken, when it was. Never a secret. */
  readonly why: string | null
  readonly model: string | null
}

/** Bounds. A model that exceeds them is malfunctioning, not being helpful. */
const MOST_READINGS = 6
const LONGEST = 400

/*
  The words a rewrite may introduce without being ungrounded.

  A rewrite legitimately turns "scan the whole thing and make tasks" into
  "Scan the Legacy Coaching Project and create tasks for me to review" — it
  resolves pronouns, completes ellipsis and drops filler. What it must not do
  is invent a SUBJECT. So function words are free and content words are not,
  and the test below is about content words only.
*/
const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'so',
  'then',
  'also',
  'of',
  'to',
  'for',
  'from',
  'in',
  'on',
  'at',
  'by',
  'with',
  'about',
  'into',
  'over',
  'under',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'will',
  'would',
  'shall',
  'should',
  'can',
  'could',
  'may',
  'might',
  'must',
  'i',
  'me',
  'my',
  'mine',
  'you',
  'your',
  'yours',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'we',
  'us',
  'our',
  'they',
  'them',
  'their',
  'he',
  'she',
  'him',
  'her',
  'his',
  'hers',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
  'all',
  'any',
  'some',
  'no',
  'not',
  'if',
  'please',
  'let',
  'make',
  'made',
  'get',
  'got',
  'go',
  'going',
  'want',
  'wants',
  'need',
  'needs',
  'tell',
  'told',
  'give',
  'given',
  'put',
  'set',
  'up',
  'out',
  'down',
  'off',
  'now',
  'just',
  'very',
  'really',
  'actually',
  'ok',
  'okay',
  'yes',
  'yeah',
  'right',
  'well',
])

const words = (t: string): string[] =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !FUNCTION_WORDS.has(w))

/**
 * Is this rewrite made of what he actually said?
 *
 * Exported because it is the anti-fabrication control and deserves its own
 * tests. A rewrite that introduces a content word the utterance does not
 * contain is a request the office invented, and acting on one is strictly
 * worse than the defect this whole file exists to fix.
 *
 * Deliberately generous in one direction only: a rewrite may use FEWER words
 * than the utterance (that is what dropping an abandoned clause looks like),
 * and may not use words that are not there.
 */
export const grounded = (rewrite: string, utterance: string): boolean => {
  const had = new Set(words(utterance))
  const want = words(rewrite)
  if (want.length === 0) return true
  const strangers = want.filter((w) => !had.has(w))
  /*
    One stranger is tolerated because a rewrite legitimately normalises a
    word's form — "tasks" for "task", "reviewing" for "review" — and stemming
    properly here would be a second natural-language system inside the file
    written to stop having those. Two or more is an invention.
  */
  return strangers.length <= 1
}

const SYSTEM = [
  'You read one message from Grant to his office and say what he is asking for.',
  'He often speaks it aloud, so expect filler, false starts, abandoned clauses,',
  'self-correction and several requests in one breath.',
  '',
  'Answer with JSON only, in exactly this shape:',
  '{"surviving":[{"kind":"...","text":"..."}],"abandoned":["..."]}',
  '',
  'kind is one of: task_create, task_query, task_change, preference, question,',
  'delegate, other.',
  '',
  '  task_create  put something on HIS OWN to-do list',
  '  task_query   he is asking what is on that list. Anything about what he',
  '               has to do, what is due, what is overdue, what is on today or',
  '               this week, or what he is meant to be doing, is task_query —',
  '               however it is phrased. "Tell me what is overdue" is a',
  '               task_query, not a question.',
  '  task_change  change something already on it',
  '  preference   a standing instruction about how the office should behave',
  '  question     something he wants answered that is NOT about his own list —',
  '               the business, a project, a document, the office itself.',
  '  delegate     work for the office to go and DO. Its result may be several',
  '               tasks. "Review the X project and create appropriate tasks" is',
  '               delegate, NOT task_create: the sentence is the instruction,',
  '               never the title of a task.',
  '  other        a request you understood that is none of the above',
  '',
  'RULES',
  '1. One entry per thing he actually wants. Two requests in one message are',
  '   two entries. Do not merge them and do not let one swallow the other.',
  '2. text must be ONE clean sentence saying that one request, in his own',
  '   words. Remove filler, false starts and the words of any abandoned clause.',
  '3. If he starts a request and then replaces it ("no actually", "scratch',
  '   that", "you know what"), the replaced wording goes in abandoned and does',
  '   NOT appear in surviving.',
  '4. Never invent a subject, a name, a date or a project he did not mention.',
  '5. A message that asks for nothing gets an empty surviving list.',
  '6. Do not answer his question. Only say what he is asking for.',
  '7. Read the mood from the MAIN CLAUSE. "Tell me", "let me know", "what",',
  '   "give me" in front of something about his list is still a task_query;',
  '   the polite wrapper does not change the subject.',
  '8. A prohibition about THIS request is not a standing instruction. "Do not',
  '   write it up as a summary, read the transcript and give me the decisions"',
  '   is ONE request, and the first half says how to do it. Only a rule about',
  '   how the office should behave in future is a preference — "from now on",',
  '   "always", "never", "stop doing X".',
  '9. A correction can replace PART of a request. "Ask Daniel about the',
  '   pricing, no, sorry, Emma" still asks for the thing; only the name',
  '   changed. Put the replaced words in abandoned and keep the request, with',
  '   the correction applied. Only put nothing in surviving when he withdrew',
  '   the request itself.',
  '10. Something he has already done asks for nothing. "I already added it this',
  '    morning, so do not add it again" is a report and a prohibition, not a',
  '    request: surviving is empty.',
  '11. A trailing afterthought is still its own request. "...and while you are',
  '    at it tell me how many there are" is a second entry, not part of the',
  '    first.',
].join('\n')

interface Raw {
  surviving?: { kind?: unknown; text?: unknown }[]
  abandoned?: unknown[]
}

/**
 * The whole utterance as one reading — today's behaviour exactly.
 *
 * Every failure path returns this, which is what makes the model safe to put
 * in front of the cascade: the worst case is the system as it shipped.
 */
const asOneThing = (utterance: string, why: string): Understanding => ({
  surviving: [{ kind: 'other', text: utterance }],
  abandoned: [],
  how: 'fallback',
  why,
  model: null,
})

/**
 * The whole utterance as one reading, said out loud.
 *
 * Exported because a CALLER sometimes knows, without asking, that there is
 * nothing to interpret — a fan-out branch carries the instruction verbatim and
 * must not act on it at all, so spending a model call to be told what it
 * already knows is latency bought for nothing. Same shape as every failure
 * path, so a caller that takes this reads identically to one that fell back.
 */
export const oneReading = (utterance: string): Understanding => ({
  surviving: [{ kind: 'other', text: utterance }],
  abandoned: [],
  how: 'trivial',
  why: null,
  model: null,
})

/**
 * Read one utterance.
 *
 * `router` may be undefined — several callers and every unit test have no
 * provider — and that is a fallback, not an error.
 */
export async function understand(
  utterance: string,
  router: ProviderRouter | undefined,
  trace: { readonly jobId?: string; readonly correlationId?: string } = {},
): Promise<Understanding> {
  const said = utterance.trim()
  if (said === '') {
    return { surviving: [], abandoned: [], how: 'trivial', why: null, model: null }
  }
  /*
    SHORT AND SINGLE. A model call on "ok" or "thanks" is latency and money
    spent on a sentence with no structure to find. The bar is deliberately
    low — one clause, no correction words, under twelve words — because the
    cost of reading something simple with the model is small and the cost of
    NOT reading something complex is the defect this file exists for.
  */
  if (said.length <= 60 && !/\b(also|actually|instead|and|but|then|scratch|forget)\b/i.test(said)) {
    return {
      surviving: [{ kind: 'other', text: said }],
      abandoned: [],
      how: 'trivial',
      why: null,
      model: null,
    }
  }
  if (router === undefined) return asOneThing(said, 'no provider was available')

  const result = await router
    .complete({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: said },
      ],
      /*
        Pinned, for the reason #229 records about the judge: a reading that
        differs between two runs of the same sentence is not an interpretation,
        it is a coin. Free models do not honour it perfectly and unpinned is
        measurably worse.
      */
      temperature: 0,
      /*
        Room for the ANSWER plus whatever the model spends thinking first.
        CLAUDE.md records a judge given 2,000 tokens returning nothing at all
        because it spent them all reasoning, and #116 measured 1,091 reasoning
        tokens before any content.
      */
      maxTokens: 1200,
      ...(trace.correlationId === undefined ? {} : { correlationId: trace.correlationId }),
      ...(trace.jobId === undefined ? {} : { jobId: trace.jobId }),
    })
    .catch((error: unknown) => {
      void error
      return null
    })

  if (result === null) return asOneThing(said, 'the provider did not answer')
  return readAnswer(result.content, said, result.model ?? null)
}

/**
 * Validate one answer. Exported so the schema can be tested without a model —
 * which is most of what can go wrong with it.
 */
export function readAnswer(
  content: string,
  utterance: string,
  model: string | null,
): Understanding {
  /*
    The JSON, wherever in the answer it is. Models wrap it in prose and in
    code fences however firmly they are told not to, and refusing a good
    answer over a fence is a fallback taken for no reason.
  */
  const at = content.indexOf('{')
  const to = content.lastIndexOf('}')
  if (at < 0 || to <= at) return asOneThing(utterance, 'the answer carried no JSON')
  let raw: Raw
  try {
    raw = JSON.parse(content.slice(at, to + 1)) as Raw
  } catch {
    return asOneThing(utterance, 'the answer was not valid JSON')
  }

  if (!Array.isArray(raw.surviving)) {
    return asOneThing(utterance, 'the answer had no surviving list')
  }
  if (raw.surviving.length > MOST_READINGS) {
    return asOneThing(utterance, `the answer claimed ${String(raw.surviving.length)} intents`)
  }

  const surviving: Reading[] = []
  for (const r of raw.surviving) {
    const text = typeof r?.text === 'string' ? r.text.trim() : ''
    const kind = String(r?.kind ?? '') as ReadingKind
    if (text === '' || text.length > LONGEST) {
      return asOneThing(utterance, 'a reading had no usable text')
    }
    if (!KINDS.includes(kind)) {
      return asOneThing(utterance, `a reading had an unknown kind: ${String(r?.kind)}`)
    }
    if (!grounded(text, utterance)) {
      /*
        The one failure that must never be executed. Falling back means the
        whole utterance goes to the cascade unchanged, which is today's
        behaviour — never the invented request.
      */
      return asOneThing(utterance, 'a reading was not grounded in what he said')
    }
    surviving.push({ kind, text })
  }

  const abandoned = (Array.isArray(raw.abandoned) ? raw.abandoned : [])
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .slice(0, MOST_READINGS)
    .map((a) => a.trim().slice(0, LONGEST))

  /*
    A model that understood nothing is not the same as one that said the
    message asks for nothing, and only the first should fall back. The
    difference is whether it also named an abandoned clause: "he replaced his
    only request and asked for nothing else" is a real reading.
  */
  if (surviving.length === 0 && abandoned.length === 0) {
    return asOneThing(utterance, 'the answer found nothing at all in it')
  }

  return { surviving, abandoned, how: 'model', why: null, model }
}
