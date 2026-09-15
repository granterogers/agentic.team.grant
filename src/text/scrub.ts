/**
 * Taking the model's scaffolding out before a person reads it.
 *
 * ## What Grant got
 *
 * A reply from the Chief of Staff, in full:
 *
 *     Let me check what's already in Notion first, then build from there.
 *     <dots_function_call>
 *     __unparsedUserInput__
 *
 * The model — `dots-studio/dots-3-note-preview:free` — decided it wanted to
 * call a tool, and since the answer path offers none, it emitted the raw token
 * it would have used to ask for one. That went to Telegram.
 *
 * ## Why a scrubber rather than a better prompt
 *
 * Because it is not a prompting problem. The tokens are how the model asks for
 * something structurally, below the level a system message reaches, and this
 * runs on whichever free model OpenRouter has today — each with its own
 * scaffolding vocabulary. Asking every current model nicely does nothing about
 * the next one.
 *
 * The same reasoning as the numeric guard in `voice.ts` and the capability
 * guard in `agents/capability.ts`: the model is asked to behave, and then the
 * output is checked, because on a free tier the asking is followed most of the
 * time.
 *
 * ## Truncate rather than delete
 *
 * Everything after the first control token is the model talking to a harness
 * that is not there. Cutting at that point keeps the sentence it had already
 * written — which is usually fine and was fine here — and drops the rest.
 * Deleting only the token itself would leave the arguments behind as prose.
 */

/**
 * Control tokens, as families rather than as a list of models.
 *
 * A new free model will have its own, and the shapes are conventional even
 * when the words are not: an angle-bracketed name ending in a role word, a
 * pipe-delimited special token, or a dunder sentinel.
 */
const CONTROL = [
  // <dots_function_call>, <tool_call>, <|im_start|>, <function=...>
  /<\|?[a-z0-9_.-]*(?:function|tool|im_start|im_end|channel|analysis|assistant|system)[a-z0-9_.-]*\|?>/i,
  // __unparsedUserInput__, __tool_call__ — and NOT __init__, which is a real
  // thing people write. Matched on the harness vocabulary rather than on the
  // dunder shape, because the shape alone eats ordinary Python talk.
  /__[a-z0-9_]*(?:unparsed|tool|function|call|input|output|prompt)[a-z0-9_]*__/i,
  // <|eot_id|>, <|end_of_turn|>
  /<\|[a-z0-9_.-]+\|>/i,
  // ```tool_code / ```function_call fences
  /```(?:tool_code|tool_call|function_call|json_tool)\b/i,
]

/**
 * The reply, ending where the model stopped talking to the reader.
 *
 * Returns the text unchanged when there is no scaffolding in it, which is the
 * overwhelmingly common case — so this costs a few regex tests and nothing
 * else.
 */
export function scrub(reply: string): string {
  let cut = reply.length
  for (const pattern of CONTROL) {
    const found = pattern.exec(reply)
    if (found !== null && found.index < cut) cut = found.index
  }
  const kept = reply.slice(0, cut).trim()

  // If the scaffolding was the whole message there is nothing to salvage, and
  // an empty reply is worse than a plain one — a person is owed a sentence.
  if (kept === '') return NOTHING_SALVAGEABLE
  return kept
}

/**
 * What a caller says when the model produced only scaffolding.
 *
 * Exported so a caller can RECOGNISE it rather than compare against a string
 * of its own. #237 found the sentence on Grant's screen, on a job marked
 * `complete` with "nothing worth announcing" — the free model had emitted a
 * bare tool-call token, and the office's answer to a real question was an
 * apology asking him to type it again. Passing our problem back to him.
 *
 * `scrubbedToNothing` lets the handler retry instead, and keep this for the
 * last attempt, when there genuinely is nothing else to say.
 */
export const NOTHING_SALVAGEABLE =
  'I started on that and my answer came back malformed. Ask me again and I will retry.'

/** True when scrubbing left nothing — the reply WAS the scaffolding. */
export const scrubbedToNothing = (reply: string): boolean => scrub(reply) === NOTHING_SALVAGEABLE

/** True when there was scaffolding to remove. For logging and for tests. */
export const hadScaffolding = (reply: string): boolean => CONTROL.some((p) => p.test(reply))
