/**
 * "Create a task for that" — recognised, and turned into a real task.
 *
 * Issue #237. Found by running a session rather than by reading code:
 *
 *     Grant: "Yes, do it. Create the task."
 *     Claire: "Sure, I'll create it. I need a few details first:
 *              1. Title  2. Due date  3. Owner  4. Parent task (if any)"
 *     public.tasks afterwards: EMPTY.
 *
 * `task.create` sits in `tool_permissions`, enabled, granted to all eight
 * agents and printed in every capability brief — and nothing routed a
 * conversation to `app.hq_task_add`. The nine actions an agent could request
 * were all NotebookLM artefacts. 0298's defect with the sign flipped: the
 * claim had a real function behind it, so its own check passed, and no path
 * reached it.
 *
 * Three things were wrong in that one exchange and this file is two of them.
 *
 * ## It asked for four things and needs one
 *
 * `public.tasks` requires a title. `due_on`, `assignee_staff` and
 * `parent_task_id` are all nullable and all default null in the writer — and
 * `parent` is not even a parameter of the function it would have called. An
 * agent asking for three fields it does not need, and one that does not exist,
 * is the #64 family: what it says about itself does not match what it can do.
 * So a title is asked for and nothing else.
 *
 * ## "Sure, I'll create it" was a promise it could not keep
 *
 * Worse than the missing feature. §10's whole invariant is not claiming what
 * did not happen, and a future-tense promise is the same lie in a politer
 * tense. Either a task exists after this or the reply says what is missing.
 *
 * ## What it deliberately does NOT do
 *
 * Fire on anything but a command. The office already distinguishes a thought
 * from a question from a suggestion from an instruction, and a session proved
 * it holds: *"I think we should create a task"*, *"Should we create a task?"*
 * and *"Do not create it yet"* all wrote nothing, correctly. Keying off
 * `classifyIntent` rather than off the word "task" is what keeps that true —
 * a phrase matcher alone would create a task on all four.
 */

import type { Classification } from './intent.ts'

/** The classes that may write. Everything cheaper discusses. */
const MAY_WRITE = new Set(['assignment', 'direct_command'])

/**
 * Asking for a task, with the title if the sentence carries one.
 *
 * `null` means this is not a task instruction at all — the commonest case by
 * far, and the reason this is a cheap regex rather than a model call.
 */
export interface TaskRequest {
  /** What to call it, or null when the sentence refers to something earlier. */
  readonly title: string | null
  /** The words that made this a task instruction, for the routing reason. */
  readonly matched: string
}

/*
  A task instruction, in the shapes people actually type.

  Each pattern captures the title where the sentence carries one. "for that",
  "for it", "for this" and "about that" are REFERENTS, not titles — they point
  at something earlier in the conversation, and inventing a title out of them
  produces a task called "that", which is worse than asking.
*/
/*
  The verbs here must be a SUBSET of the imperatives `intent.ts` recognises as
  a command, or a shape matches a sentence the gate has already refused and the
  two lists disagree silently. `open` was in an earlier draft of this list and
  is not in that one, so it could never fire.
*/
const SHAPES: readonly RegExp[] = [
  /\b(?:create|add|make|put|raise|log)\s+(?:a|an|the)?\s*(?:new\s+)?task\s+(?:to|for|about|called|named|titled)\s+(?<title>.+?)(?:\s*[.!?]|$)/i,
  /\b(?:create|add|make|put|raise|log)\s+(?:a|an|the)?\s*(?:new\s+)?task\s+on\s+the\s+board\s+to\s+(?<title>.+?)(?:\s*[.!?]|$)/i,
  /\b(?:create|add|make|put|raise|log)\s+(?:a|an|the)?\s*(?:new\s+)?tasks?\b(?<title>)/i,
]

/*
  Referents that look like a title and are not.

  The bare ones — "that", "it", "this" — plus the phrases the THREAD RESOLVER
  produces, which is how the second group was found. #237's cross-project
  session said *"Add a task for that."* one turn after *"same question for the
  second project"*, the resolver correctly expanded the referent, and the
  office filed a task called **"the second project"**. In the right project,
  not fabricated, and a name Grant would never find anything by.

  A resolved referent is still a referent. The improvement over inventing a
  title from it is to ask, which the office now does well and in one question.
*/
const NOT_A_TITLE =
  /^(?:that|it|this|those|them|the (?:above|same|second|first|other|next|last|latter|former)\b|the one\b)/i

/*
  A prohibition anywhere in the sentence stops it.

  Belt and braces over the intent gate rather than instead of it. "Do not
  create it yet" classifies as an unrecognised `thought` and so could never
  reach here — but it reaches that verdict by NOT BEING UNDERSTOOD, which is a
  thin reason to rely on for the one operation in this file that writes. A
  sentence containing "don't create" must not create whatever else is true of
  it.
*/
const FORBIDDEN =
  /\b(?:do\s*n[o']?t|don't|dont|never|hold\s+off|not\s+yet|no\s+need\s+to|without)\b[^.!?]{0,40}\b(?:creat|add|mak|rais|open|log)/i

export const taskRequest = (
  instruction: string,
  classification: Classification,
): TaskRequest | null => {
  if (!MAY_WRITE.has(classification.intent)) return null
  if (!classification.confident) return null
  if (FORBIDDEN.test(instruction)) return null

  for (const shape of SHAPES) {
    const hit = shape.exec(instruction)
    if (hit === null) continue
    const raw = (hit.groups?.title ?? '').trim().replace(/\s+/g, ' ')
    const title = raw === '' || NOT_A_TITLE.test(raw) ? null : raw
    return { title, matched: hit[0].slice(0, 80) }
  }
  return null
}

/**
 * What to say when a task was asked for with nothing to call it.
 *
 * One question, about the one field the writer requires. The reply that
 * prompted all of this asked for four, three of which are optional and one of
 * which — a parent task — is not a parameter of the function at all.
 */
export const TITLE_ASKED = 'What should it be called?'

export const NEEDS_A_TITLE =
  `Happy to add that. ${TITLE_ASKED} A title is all I need — ` +
  'a due date and an owner are optional and I can leave them off.'

/*
  An explicit naming reply, which needs no history to recognise.

  "Call it X", "name it X", "let's call it X" — unmistakable on their own, so
  they are matched without a lookup and without any risk of a false positive.
*/
const NAMING =
  /^\s*(?:call it|name it|title it|let'?s call it|it'?s called|call the task|title:)\s*[:,-]?\s*(?<title>.+?)\s*[.!]?\s*$/i

/**
 * The answer to *"what should it be called?"*, when that is what this is.
 *
 * #237. The office asked the question and then could not accept the answer:
 * *"Call it Review the onboarding copy."* matched no task shape, so the reply
 * fell through to prose and the task was never created. A question whose
 * answer is dead is worse than not asking — Grant has now typed the same
 * intention twice and has nothing.
 *
 * Two ways in, deliberately, because people do both:
 *
 *   - an explicit naming phrase, recognised on its own;
 *   - a bare phrase, but ONLY when the previous answer was this file's own
 *     question. Without that condition "Review the onboarding copy" is an
 *     ordinary instruction and turning it into a task would be a write nobody
 *     asked for.
 *
 * The bare case is bounded further: short, not a question, and not itself a
 * task command (which `taskRequest` would already have caught).
 */
export const titleReply = (instruction: string, previousAnswer: string | null): string | null => {
  const text = instruction.trim()
  const named = NAMING.exec(text)
  if (named !== null) {
    const title = (named.groups?.title ?? '').trim()
    return title === '' || NOT_A_TITLE.test(title) ? null : title
  }
  if (previousAnswer === null || !previousAnswer.includes(TITLE_ASKED)) return null
  if (text.length > 90 || text.includes('?') || text.split(/\s+/).length > 14) return null
  return NOT_A_TITLE.test(text) ? null : text.replace(/[.!]+$/, '')
}
