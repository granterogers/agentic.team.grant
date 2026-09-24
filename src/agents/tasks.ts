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

import { readFollowUp } from './clarify.ts'
import { clauses } from './clauses.ts'
import { type Classification, withoutOpeningAffirmation } from './intent.ts'
import { mentionsWithoutAsking } from './not-a-request.ts'
import { PROJECT_ADJUNCT, readRequest, requestBody } from './request.ts'
import { readRetraction } from './retraction.ts'

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
/*
  The indirect object, which is how a person actually asks (#248).

  "Make a task to chase the supplier" matched and "Make ME a task to chase the
  supplier" did not — one word between the verb and the article, and the whole
  path fell through to prose. The hostile corpus asked in exactly that shape,
  because that is the shape Grant would use, and the office answered "Task
  created for you, due Friday" with public.tasks untouched.

  Bounded to the pronouns an indirect object can be. A free wildcard here would
  swallow "make the pricing review a task", where the noun is the subject of the
  sentence rather than the person being done a favour.
*/
const FOR_ME = String.raw`(?:\s+(?:me|us|him|her|them|myself))?`

const SHAPES: readonly RegExp[] = [
  new RegExp(
    String.raw`\b(?:create|add|make|put|raise|log)${FOR_ME}\s+(?:a|an|the)?\s*(?:new\s+)?task\s+(?:to|for|about|called|named|titled)\s+(?<title>.+?)(?:\s*[.!?]|$)`,
    'i',
  ),
  new RegExp(
    String.raw`\b(?:create|add|make|put|raise|log)${FOR_ME}\s+(?:a|an|the)?\s*(?:new\s+)?task\s+on\s+the\s+board\s+to\s+(?<title>.+?)(?:\s*[.!?]|$)`,
    'i',
  ),
  new RegExp(
    String.raw`\b(?:create|add|make|put|raise|log)${FOR_ME}\s+(?:a|an|the)?\s*(?:new\s+)?tasks?\b(?<title>)`,
    'i',
  ),
  /*
    The label form, which is a different grammatical construction rather than
    another phrasing: a noun, a colon, and the thing. "Task: chase the
    supplier." `request.ts` already reads it as an ask and this is the writer
    agreeing — without it the two layers disagreed, which is how a recognised
    instruction reaches the writer and writes nothing.
  */
  /^\s*(?:task|todo|to-?do|action|reminder)\s*[:—-]\s*(?<title>\S.*)$/i,
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

/*
  The title, from the semantic structure the interpreter already built (#254).

  #249's version removed a PREAMBLE matched against a list of verbs, which is
  the defect #249 was about, one layer deeper. The third examination walked
  through it in one turn: "Line up a task on alpha to take up references for the
  two we keep" and "Set aside a task to book the room" both reached the writer
  and were asked what to call something plainly in the sentence.

  `requestBody` in `request.ts` removes the framing by POSITION, because the
  grammar already located the verb — an imperative's verb is token zero, by
  construction. This file never learns another verb again.

  What is left to do here is only the part that is specific to THIS action:

    - the capability's own object noun, which is how the action was identified
    - a determiner in front of it
    - a project adjunct, "on alpha", "under the beta project"
    - a link word joining the frame to the content

  All closed class. The due date is deliberately still not subtracted: nothing
  extracts it into a column, so removing it from the name would lose something
  Grant said (#253).
*/
const OBJECT_NOUN =
  /^\s*(?:a|an|the|another|new)?\s*(?:new\s+)?(?:tasks?|to-?dos?|todos?|reminders?|items?)\b\s*/i
/** What is left once the frame has gone, if it is only a link word. */
const LINKING =
  /^\s*(?:to|for|about|that|which|and|then|called|named|titled|saying|which\s+is)\b\s*/i
/** Politeness at the end, which the opening strip cannot reach. */
const TRAILING_PLEASE =
  /\s*\b(?:please|pls|thanks|ta|instead|if\s+you\s+(?:can|could|would))\b[\s,.]*$/i

/*
  WHAT ELSE IS FRAME, established from the rows rather than from reading.

  Every task the office wrote from a real message in the 45 days to 22
  September had a malformed title - four out of four - and the offline
  reproduction put the failures in four structural places, none of which is a
  missing word in a list. #249 moved RECOGNITION off a verb list and onto
  grammar and left titling stripping a frame with patterns, so the better
  recognition got, the more malformed titles it produced.

  Each of these is a closed class and each is named after what it is, so the
  next reader can tell whether a new phrasing belongs to one of them.
*/

/**
 * A topic named before the instruction, with a comma.
 *
 *   "on the bid, put something down to chase the letter of support"
 *
 * `requestBody` strips a LEADING verb, so nothing in the old pipeline could
 * see past the preamble and the whole sentence became the title. `readClause`
 * already follows an em-dash for exactly this shape - object first,
 * instruction after - and a comma is the commoner punctuation for it in
 * writing.
 *
 * Bounded to at most TWO words, and the bound is load-bearing rather than
 * tidy. The first version allowed spaces inside a 28-character run, so on
 *
 *     "On coaching to book the venue, end of next week"
 *
 * it matched "on coaching to book the venue," and left "end of next week" —
 * it ate the instruction and kept the deadline. Found by fresh material on
 * the very next session after the fix shipped, which is what fresh material
 * is for. A topic is a name; anything with a verb in it is the sentence.
 */
const TOPIC_FIRST =
  /^\s*(?:on|for|under|in|about|re)\s+(?:the\s+)?[\w'-]+(?:\s+[\w'-]+)?(?:\s+project)?,\s*(?=\S)/i

/**
 * A verb particle and the preposition after it.
 *
 *   "get a task DOWN FOR the printer quote"  ->  the frame is "get a task
 *   down for", not "get a task"
 *
 * The particle belongs to the verb (`request.ts` keeps the same closed class
 * for the same reason), so leaving it in front makes the title open with a
 * word that is not about the work.
 */
const STRANDED_PARTICLE = /^\s*(?:down|up|out|in|off|aside|together)\s+(?=(?:for|to|about)\b)/i

/**
 * The reason for the reminder, which is not the reminder.
 *
 * The particle is taken here rather than by `STRANDED_PARTICLE`, because in
 * "stick something DOWN so I do not forget to…" it is followed by the purpose
 * subordinator rather than by a preposition — and widening the particle rule
 * to cover it would let it fire on "in alpha", which is a place.
 *
 *   "stick something down SO I DO NOT FORGET TO ring Kevin about the quote"
 *
 * The commonest way a person asks for a reminder at all, and CLAUDE.md
 * quotes this exact sentence as #302's origin. The purpose subordinators are
 * the same closed class `readClause` already uses; what follows the "to" is
 * the action.
 */
const PLACEHOLDER_OBJECT = /^\s*(?:something|anything|a\s+(?:note|line|marker|placeholder))\b\s*/i
const PURPOSE_FRAME =
  /^\s*(?:down|up)?\s*(?:so(?:\s+that)?|in\s+order\s+(?:that|to|not\s+to))\s+(?:i|we)\s+(?:do\s*n[o']?t|don[\u2019']t|will\s*not|won[\u2019']t|never)?\s*(?:forget|lose\s+track\s+of|miss)\s*(?:to|about)?\s*/i

export const taskTitle = (clause: string): string | null => {
  /*
    A withdrawn false start is not part of the name.

    `public.tasks` holds one titled *"For me and the um... No actually, you
    know what? Scan the entire project"* - his raw dictated speech with the
    clause he took back in the same breath. #291's reader exists for exactly
    this and was never consulted when a title was composed.
  */
  // The survivor can begin with the word that joined it: "…scrap that AND add one…".
  const kept = readRetraction(clause)?.kept?.replace(/^\s*(?:and|then|so|but)\s+/i, '')
  const said = kept !== undefined && kept.trim() !== '' ? kept : clause
  const withoutTopic = TOPIC_FIRST.test(said) ? said.replace(TOPIC_FIRST, '') : said
  const framed = requestBody(withoutTopic)
  /*
    AND THE SURVIVOR OF A RETRACTION IS CONTENT, NOT A REQUEST.

    `requestBody` takes the verb BY POSITION — deliberately, so it needs no
    verb list, and its contract is that the clause opens with the asking verb:
    "add a task to chase the roofer" loses "add". A retraction has already
    removed everything up to the change of mind, so what survives opens with
    the INSTRUCTION's own verb, and running `requestBody` over it ate that.

    His real sentence, 20 September, by voice:

      "For me and the um... No actually, you know what? Scan the entirety of
       the Legacy Coaching Project and create appropriate tasks for me to
       review"

    The retraction fix correctly kept "Scan the entirety of…" and the title
    then came out as *"the entirety of the Legacy Coaching Project and…"* —
    a phrase with no verb, which is not a name for anything. Both halves were
    right alone and only their composition was wrong, which CLAUDE.md records
    as the hardest shape to see.

    The discriminator is whether stripping the verb REVEALED a task frame. It
    does for "no actually, add a task to chase the roofer" (leaving "a task
    to…", which `OBJECT_NOUN` matches) and it does not for a bare imperative.
    Gated on a retraction having happened at all, so the ordinary path is
    untouched.
  */
  let text = said === clause || OBJECT_NOUN.test(framed) ? framed : withoutTopic
  text = text.replace(OBJECT_NOUN, '')
  text = text.replace(PLACEHOLDER_OBJECT, '')
  /*
    The project adjunct FIRST, because "in" is both a particle and a
    preposition. Stripping the particle first turned "Raise a task in alpha
    to review the lease break clause" into "alpha to review…", which the
    adjunct could then no longer see - a regression caught by #249's own
    suite on the first run. The particle rule also now REQUIRES the
    preposition after it, so it can only fire on the shape it was written
    for ("down for", "up to").
  */
  text = text.replace(PROJECT_ADJUNCT, '')
  text = text.replace(STRANDED_PARTICLE, '')
  text = text.replace(PURPOSE_FRAME, '')
  /*
    A gerund joining the frame to the content: "a task ADDING to chase the
    roofer", "a task RAISED for the renewal". Structural — an -ing or -ed word
    immediately before "to" or "for" is part of how the request was phrased,
    not part of what the task is called.
  */
  text = text.replace(/^\s*\w+(?:ing|ed)\s+(?=(?:to|for)\b)/i, '')
  text = text.replace(PROJECT_ADJUNCT, '')
  text = text.replace(LINKING, '')
  /*
    The capability noun can come LAST: "make the pricing review a task". The
    object identifies which capability was asked for wherever it sits, so it is
    removed from whichever end it is on rather than only from the front.
  */
  text = text.replace(/\s+(?:in)?to\s+(?:a|an)\s*(?:tasks?|to-?dos?|reminders?|items?)\s*$/i, '')
  text = text.replace(/\s+(?:a|an|the)?\s*(?:tasks?|to-?dos?|reminders?|items?)\s*$/i, '')
  text = text.replace(TRAILING_PLEASE, '').trim().replace(/\s+/g, ' ')
  text = text.replace(/[\s,;:.-]+$/, '')
  if (text === '' || NOT_A_TITLE.test(text)) return null
  return text
}

/**
 * Was the office ASKED, and asked for a TASK?
 *
 * Two questions, separated (#249). The intent class answers neither on its
 * own: "Could you add a task to chase the roofing quote?" matches a question
 * rule, question is cheaper than assignment, section 6 resolves downward, and
 * the whole thing became an enquiry while the office wrote nothing.
 *
 * So the MOOD decides whether this is a request, and the OBJECT NOUN decides
 * which capability it is about. A noun is the right thing to key on: "task" is
 * what the capability operates on and it survives every paraphrase of asking
 * for one, where a list of verbs in front of it does not.
 *
 * The intent class is kept as the other way in, so nothing that worked before
 * stops working.
 */
const TASK_OBJECT = /\b(?:tasks?|to-?dos?|todos?)\b/i

const wasAsked = (instruction: string, classification: Classification): boolean => {
  if (MAY_WRITE.has(classification.intent) && classification.confident) return true
  return readRequest(instruction, clauses).some((r) => r.mood === 'ask' && TASK_OBJECT.test(r.text))
}

/*
  "Add ONE to ring the venue" is a task when a task has just been mentioned
  (ledger R7/R26). "Add a task to ring the printers. Actually scrap that and
  add one to ring the venue instead." filed nothing: the surviving clause
  says "one", and "one" is only a task because the clause he withdrew said
  "task". The antecedent is the whole of what he said; the elliptical noun is
  rewritten to the noun it stands for, and only after a verb of making, so
  "one of them is late" is untouched.
*/
const ELLIPTICAL =
  /\b(add|make|create|put|raise|log|stick|set\s+up|do)\s+(?:me\s+)?(?:another(?:\s+one)?|one\s+more|one)\s+(?=(?:to|for|about|called|on)\b)/i
const withElliptical = (text: string, antecedent: string): string =>
  TASK_OBJECT.test(antecedent) && !TASK_OBJECT.test(text)
    ? text.replace(ELLIPTICAL, '$1 a task ')
    : text

export const taskRequest = (
  rawText: string,
  classification: Classification,
  antecedent = '',
): TaskRequest | null => {
  const rawInstruction = withElliptical(rawText, antecedent)
  // A prohibition, an advice question or somebody else's words (ledger R34).
  if (mentionsWithoutAsking(rawInstruction)) return null
  /*
    The same cut `classifyIntent` makes, and for the same measurement.

    "Fine. Set aside a task to book the room myself once they confirm."
    classified correctly as an assignment once the opening agreement was
    stripped there — and the TITLE still came back null, because the clause
    splitter will not give "Fine." a clause of its own (it is too short) and
    glues it to the instruction, so the extractor never sees a clean one.

    Intent fixed and title not is the worst of the three outcomes: the office
    decides it is being asked to write something and then cannot say what,
    which is how a confident answer with an invented intake form is produced.
  */
  const instruction = withoutOpeningAffirmation(rawInstruction)
  if (!wasAsked(instruction, classification)) return null
  /*
    A prohibition stops the clause it is in, not the one beside it (#249).

    FORBIDDEN was tested against the whole message with a forty-character
    window, so "Actually do not email the roofer; make a task to chase them
    instead" refused the task — the prohibition was on the email. A correction
    that replaces one action with another is one of the commonest things Grant
    does, and it was writing nothing at all.
  */
  const parts = clauses(instruction)
  const permitted = parts.filter((c) => !FORBIDDEN.test(c))
  if (permitted.length === 0) return null
  const instructionText = permitted.join('. ')
  /*
    THE task is one that already exists (ledger R4).

    "And put it down as mine" was rewritten by the thread resolver as "put
    the task down as belonging to Grant", and both the bare-noun shape and
    the fallback below took it as a request for a NEW task — filed as
    "down as belonging to Grant". A definite article (or this/that/my) on a
    singular task noun, with nothing after it that introduces a title and no
    indefinite task noun anywhere, is a reference to a task, not a request
    for one. Returning null hands it to the readers that change tasks, and to
    prose, which is the cheap direction: a missed creation costs him one
    retyped sentence, a phantom one sits on his list.
  */
  if (
    /\b(?:the|this|that|my|our|his|your)\s+(?:task|to-?do|reminder)\b(?!\s+(?:to\s+(?!(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|the|my|next|this|tomorrow|today|me|him|her)\b)|for|about|called|named|titled|that|which)\b)/i.test(
      instructionText,
    ) &&
    /*
      "Create the task." after the office proposed one is a creation of THE
      task it proposed, so a verb that can only mean making something keeps
      it — when the sentence ends there. "Make the task urgent" goes on, and
      is a change. Put, add, move, mark and assign are what people say to a
      task that exists.
    */
    !/\b(?:create|make|raise|log|open|set\s+up)\s+(?:me\s+)?(?:the|that|this)\s+(?:task|to-?do|reminder)\s*(?:now|then|please|for\s+me)?\s*(?:[.!]|$)/i.test(
      instructionText,
    ) &&
    !/\b(?:a|an|another|new|one\s+more)\s+(?:[a-z-]+\s+){0,2}?(?:task|to-?do|reminder)s?\b/i.test(
      instructionText,
    ) &&
    !/\btasks\b/i.test(instructionText)
  ) {
    return null
  }

  for (const shape of SHAPES) {
    const hit = shape.exec(instructionText)
    if (hit === null) continue
    /*
      Subtraction first, the captured group second.

      The shapes still decide WHETHER this is a task instruction — that part
      works and is gated by the intent class above. What they were bad at is
      the title, so the title now comes from `taskTitle` and the capture is the
      fallback for a sentence subtraction cannot read.
    */
    /*
      A subtracted title that still opens with a conjunction and a request for
      a task ("and add a task to ring the venue") is the framing of a second
      clause, not a name; the shape's own capture holds the name.
    */
    const subtracted = taskTitle(instructionText)
    const framing =
      subtracted !== null &&
      /^(?:that\s+)?(?:and|then|so|but)\s+\w+\s+(?:me\s+)?(?:a|an|another)?\s*(?:task|to-?do)/i.test(
        subtracted,
      )
    const raw = ((framing ? null : subtracted) ?? hit.groups?.title ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(TRAILING_PLEASE, '')
    const title = raw === '' || NOT_A_TITLE.test(raw) ? null : raw
    return { title, matched: hit[0].slice(0, 80) }
  }
  /*
    Asked for a task in a shape nothing describes.

    "I need a task adding to chase the roofing quote" is unmistakable and fits
    no verb-plus-noun pattern. Reaching the writer with no title is the right
    outcome — the office asks one short question — and is strictly better than
    the old one, which was to say nothing and do nothing.
  */
  const clause = permitted.find(
    (c) => TASK_OBJECT.test(c) && readRequest(c, clauses)[0]?.mood === 'ask',
  )
  if (clause === undefined) return null
  const raw = (taskTitle(clause) ?? '').trim()
  return { title: raw === '' || NOT_A_TITLE.test(raw) ? null : raw, matched: clause.slice(0, 80) }
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
  The explicit naming form moved to `clarify.ts` with the rest of the
  follow-up reading (#255), so there is one place that decides what a reply to
  a question is rather than two that can disagree.
*/

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
export const titleReply = (
  instruction: string,
  previousAnswer: string | null,
  resolvesAnotherAction = false,
): string | null => {
  /*
    Delegated to the state machine (#255).

    This used to be the whole decision, and it was three conditions long: under
    ninety characters, no question mark, under fifteen words. "Walk me through
    whether two is actually enough to choose from" satisfies all three, so an
    ordinary question became the name of a task Grant never confirmed.

    `readFollowUp` distinguishes the six things a next turn can be. Only one of
    them proceeds, and everything else leaves the pending action unacted —
    which is the safe direction, because the office asking again costs a
    sentence and a wrong mutation costs Grant's trust in every confirmation
    after it.
  */
  const pending = previousAnswer !== null && previousAnswer.includes(TITLE_ASKED)
  const read = readFollowUp(instruction, pending, resolvesAnotherAction)
  if (read.kind !== 'answered' || read.value === null) return null
  return NOT_A_TITLE.test(read.value) ? null : read.value
}
