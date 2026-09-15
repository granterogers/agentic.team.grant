/**
 * Is Grant asking the office to DO something, or is he talking?
 *
 * ## The defect this replaces
 *
 * Until #249 that question was answered by a list of phrasings —
 * `classifyIntent`'s twenty-five rules, `taskRequest`'s three shapes,
 * `notebookRequest`'s MAKE verbs — and a list of phrasings cannot generalise.
 * Measured on the frozen build, **8 of 16** ordinary paraphrases of
 * unmistakably actionable requests were not recognised at all, while all five
 * negative controls held. Not loose, not strict: pattern-bound.
 *
 *     Make a task to chase the supplier      recognised
 *     Make me a task to chase the supplier   NOT recognised
 *     Sort out what we tell the customer     NOT recognised
 *     Handle the supplier chase this week    NOT recognised
 *
 * Three separate defects were filed for three instances of that one cause
 * before anybody looked at the shape of it.
 *
 * ## The invariant
 *
 * IF A REASONABLE HUMAN WOULD CLEARLY UNDERSTAND THAT GRANT IS ASKING THE
 * OFFICE TO DO SOMETHING IT SUPPORTS, ORDINARY PARAPHRASING MUST NOT DETERMINE
 * WHETHER THE ACTION IS RECOGNISED.
 *
 * ## Why this is grammar and not a bigger list
 *
 * The thing that makes a sentence a request is its MOOD, not its verb.
 * "Sort out the refund", "Handle the refund", "Chase the refund" and "Deal
 * with the refund" are one grammatical form with four open-class verbs, and
 * open classes are infinite — that is what "open" means. Enumerating them is
 * the defect, not the fix.
 *
 * So every signal below is built on CLOSED classes: pronouns, determiners,
 * auxiliaries, modals, prepositions, conjunctions and a small set of stance
 * markers. Closed classes are finite, stable, and shared by every paraphrase
 * of the same request. English acquires new verbs constantly and has not
 * acquired a new pronoun in centuries.
 *
 * ## What it must NOT do
 *
 * This layer INTERPRETS. It does not govern. It may say "he is asking us to
 * act"; it may not decide that the action is supported, permitted, sufficiently
 * specified, or that it succeeded. Those stay where they are — in
 * `tool_permissions`, in the confirmation requirements, in the canonical
 * writers, and in #248's `acted` count. A recogniser that could also authorise
 * would be a recogniser whose false positives spend money.
 *
 * ## Unsure is a real answer
 *
 * The third value is the point. Precision matters more than recall here —
 * "I wonder whether we should email them" becoming an email is worse than a
 * missed instruction, because a missed instruction is visible to Grant in one
 * turn and a sent email is not recoverable at all. So a clause the grammar
 * cannot settle is returned as `unsure` for a layer that can think about it,
 * rather than guessed in either direction.
 */

/** What a clause is doing. */
export type Mood = 'ask' | 'question' | 'remark' | 'unsure'

export interface ClauseReading {
  readonly text: string
  readonly mood: Mood
  /** The closed-class signal that decided it, for the audit trail. */
  readonly why: string
}

/*
  Stance and hedge markers: the speaker commenting on their own thought.

  These are what makes "I wonder whether we should email them" a remark rather
  than an instruction to send an email — the main clause is about wondering.
  CLAUDE.md records the same lesson about complement clauses in teaching.ts:
  the mood of a sentence is set by its main clause.
*/
const STANCE =
  /^\s*(?:i\s+(?:wonder|think|thought|feel|felt|suspect|reckon|guess|imagine|assume|expect|hope|worry|wondered)\b|i'?m\s+(?:not\s+sure|wondering|thinking|unsure)\b|my\s+(?:instinct|feeling|sense|hunch|worry)\b|it\s+(?:seems|feels|looks|might\s+be|may\s+be|could\s+be)\b|(?:maybe|perhaps|possibly|probably|arguably|honestly|frankly|apparently|hypothetically|theoretically|ideally)\b|in\s+theory\b|fyi\b|just\s+(?:thinking|a\s+thought|noting)\b|note\s+to\s+self\b|for\s+(?:example|instance)\b|such\s+as\b)/i

/*
  A supposition. Not an instruction, whatever verb it contains, and the
  companion of quality.ts's HYPOTHETICAL — the same distinction on the way in
  that that one draws on the way out.
*/
/*
  An example, introduced rather than asked for.

  "Take something like adding a task" is grammatically an imperative and is
  nobody's instruction — "something like" frames what follows as an
  illustration. `actions.ts` already reads a bare "like" the same way when
  deciding whether a notebook artifact was asked for or merely mentioned.
*/
const EXEMPLIFYING =
  /^\s*(?:take\s+)?(?:something|anything|somewhere)\s+like\b|\bsomething\s+like\b/i

const SUPPOSING =
  /^\s*(?:suppose|supposing|assuming|imagine|what\s+if|say\s+we|if\s+we|were\s+we)\b/i

/*
  A prohibition or a hold, anywhere in the clause.

  Deliberately the whole clause rather than the opening: "make me a task but
  don't send anything" needs the second half to stop the second half only, and
  clause segmentation is what separates them.
*/
const FORBIDS =
  /\b(?:do\s*n[o']?t|don'?t|dont|never|hold\s+off|not\s+yet|no\s+need\s+to|leave\s+it|forget\s+it|cancel\s+that|on\s+no\s+account|under\s+no\s+circumstances)\b|\bleave\s+(?:\w+\s+){0,3}alone\b/i

/*
  Asking ABOUT something rather than asking FOR something.

  Wh-words and subject-auxiliary inversion, which is how English marks a
  question. Both are closed classes.
*/
const WH = /^\s*(?:what|which|why|when|where|who|whose|whom|how)\b/i
const INVERTED =
  /^\s*(?:do|does|did|is|are|was|were|has|have|had|am|shall|will)\s+(?:i|we|they|he|she|it|the|a|an|there|that|this|any|our|your)\b/i

/*
  The politeness convention: a question in form, a request in function.

  "Can you sort out the refund?" is not an enquiry into the office's
  capabilities. A second-person modal followed by anything is how English
  speakers give instructions without sounding brusque, and reading it as a
  question is how an assistant becomes useless.
*/
const POLITE_REQUEST = /^\s*(?:can|could|would|will|might)\s+(?:you|u|someone|somebody)\b/i

/*
  First person, wanting something done. "I need someone to look at X", "I'd
  like the margin worked out", "we want this chased".

  Separated from STANCE by the verb class, which is small and closed enough to
  enumerate honestly: wanting is a different mental state from wondering.
*/
const DESIDERATIVE =
  /^\s*(?:i|we)\s*(?:'d|\s+would)?\s*(?:need|needs|want|wants|like|require|requires)\b|^\s*(?:i|we)\s+(?:need|want)\s+(?:you|someone|somebody|emma|tom|claire|daniel|marcus|ruby|oliver|grace)\b|^\s*let'?s\b/i

/*
  Handing the work to a named person. "Get Emma to look at it", "have Tom
  draft the reply", "ask Ruby about the channel".
*/
const DELEGATES =
  /^\s*(?:get|have|ask|tell|put)\s+(?!you\b|i\b|we\b|they\b|he\b|she\b|it\b|me\b|us\b|them\b|a\b|an\b|the\b)\w+\s+(?:to\s+|on\s+)?\w+/i

/*
  Shorthand. A label, a colon, and the thing. "Task: chase the supplier."
*/
const LABELLED = /^\s*(?:task|todo|to-?do|action|reminder|note)\s*[:—-]\s*\S/i

/*
  The closed classes an imperative cannot begin with.

  An imperative has no subject, so a clause beginning with one is not an
  imperative. Everything here is a function word — the whole point of the
  design: this list is finite and has been finite for a very long time, where a
  list of verbs would need a new entry every time Grant used a new one.
*/
const NOT_IMPERATIVE_OPENERS = new Set([
  // subjects
  'i',
  'you',
  'we',
  'they',
  'he',
  'she',
  'it',
  'there',
  'who',
  'that',
  'this',
  'those',
  'these',
  'everyone',
  'everybody',
  'nobody',
  'someone',
  'somebody',
  // determiners and possessives
  'the',
  'a',
  'an',
  'my',
  'our',
  'your',
  'their',
  'his',
  'her',
  'its',
  'some',
  'any',
  'each',
  'every',
  'no',
  'both',
  'either',
  'neither',
  'another',
  // auxiliaries and modals
  'do',
  'does',
  'did',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'has',
  'have',
  'had',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  // prepositions and conjunctions
  'in',
  'on',
  'at',
  'by',
  'for',
  'with',
  'from',
  'of',
  'about',
  'after',
  'before',
  'during',
  'over',
  'under',
  'between',
  'and',
  'but',
  'or',
  'so',
  'because',
  'if',
  'when',
  'while',
  'although',
  'unless',
  'since',
  'as',
  'than',
  'though',
  'whether',
  // discourse openers that precede a real clause rather than being one
  'well',
  'right',
  'ok',
  'okay',
  'alright',
  'anyway',
  'also',
  'plus',
  'however',
  'meanwhile',
  'then',
  'now',
  'again',
  'yes',
  'no',
  'yeah',
  'nope',
  'not',
  // Indefinite pronouns. "Something like drafting a notice would be premature"
  // opens with one and is a statement about a thing, not an instruction.
  'something',
  'anything',
  'nothing',
  'everything',
  'somewhere',
  'anywhere',
  // Particles that begin a CONTINUATION rather than a clause. Segmentation cuts
  // on commas, so "Revenue was 1.2m last quarter, up from 0.9m" arrives here as
  // the fragment "up from 0.9m" — no subject because it is not a sentence, not
  // because it is a command. The cost is losing "up the price", which nobody
  // says to an office.
  'up',
  'down',
  'off',
  'out',
  'back',
  'over',
  'through',
  'along',
  'around',
  'due',
  'per',
  'via',
  'minus',
  // Social formulae: small, closed, stable. A greeting is not a command, and
  // "Thanks, that is helpful" was being read as one.
  'thanks',
  'thank',
  'cheers',
  'hi',
  'hello',
  'hey',
  'morning',
  'afternoon',
  'evening',
  'sorry',
  'congrats',
  'great',
  'good',
  'nice',
  'perfect',
  'brilliant',
  'lovely',
  'fine',
  'excellent',
  'agreed',
  'noted',
])

/*
  A finite verb in second position means a subject-predicate statement, not an
  imperative. "Revenue was 1.2m", "Emma has finished", "The stand costs nine
  thousand" — the first token is a noun, so the opener test alone would read
  them as commands.

  Closed class again, and it is the one that keeps this from firing on Grant
  telling the office a fact.
*/
const FINITE_SECOND = new Set([
  'is',
  'was',
  'are',
  'were',
  'has',
  'have',
  'had',
  'will',
  'would',
  'can',
  'could',
  'should',
  'shall',
  'may',
  'might',
  'must',
  'does',
  'did',
  'do',
  "isn't",
  "wasn't",
  "aren't",
  "weren't",
  "hasn't",
  "haven't",
  "won't",
  "doesn't",
  "didn't",
  "can't",
  "couldn't",
  "shouldn't",
])

/*
  Function words an imperative legitimately puts in second position, so the
  inflection test below does not fire on them. "Follow UP with the accountant"
  is a command; "us", "his" and "its" end in the letters the test looks for and
  are not verbs.
*/
/*
  Adverbs that cannot follow an imperative verb's subject-less opening, because
  they place the action in the past or mark it as complete.
*/
/*
  Irregular past forms whose spelling differs from the stem.

  A list, and a legitimate one: irregular verbs are among the most closed
  classes English has — the set has been shrinking for a thousand years and
  has not gained a member in living memory. This is nothing like a list of
  phrasings, which is what #249 was about.

  Only the UNAMBIGUOUS ones. "put", "set", "cut", "let", "read" and "hit" are
  spelt the same as their stems and are perfectly good imperatives, so including
  them would refuse real instructions to keep out reports.

  Found by a semantic mutation: "…and then thought better of it" opened a
  clause with a past tense the -ed test cannot see.
*/
const IRREGULAR_PAST = new Set([
  'thought',
  'said',
  'went',
  'took',
  'saw',
  'came',
  'gave',
  'found',
  'knew',
  'felt',
  'bought',
  'brought',
  'caught',
  'taught',
  'sought',
  'wrote',
  'spoke',
  'chose',
  'drove',
  'broke',
  'wore',
  'told',
  'did',
  'was',
  'were',
  'had',
  'got',
  'began',
  'ran',
  'sat',
  'spent',
  'sent',
  'built',
  'held',
  'kept',
  'meant',
  'met',
  'paid',
  'heard',
  'led',
  'lost',
  'made',
  'won',
  'left',
  'stood',
  'understood',
  'forgot',
  'grew',
  'flew',
  'threw',
  'drew',
  'knew',
])

const REPORTING_ADVERB = new Set([
  'already',
  'just',
  'recently',
  'yesterday',
  'earlier',
  'previously',
  'never',
  'always',
  'usually',
  'often',
  'once',
  'finally',
  'eventually',
])

const FUNCTION_SECOND = new Set([
  'up',
  'out',
  'off',
  'down',
  'back',
  'over',
  'through',
  'along',
  'around',
  'us',
  'his',
  'its',
  'this',
  'these',
  'those',
  'yours',
  'ours',
  'theirs',
  'towards',
  'across',
  'plus',
  'versus',
  'as',
])

const words = (clause: string): string[] =>
  clause
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'’-]+/)
    .filter((w) => w !== '')

/**
 * Read one clause.
 *
 * Order matters and is not arbitrary: a prohibition beats everything, then
 * stance and supposition (because the main clause sets the mood), then the
 * forms that are unambiguously requests, then questions, and only then the
 * imperative test — which is the broadest and so goes last.
 */
export const readClause = (clause: string): ClauseReading => {
  const text = clause.trim()
  if (text === '') return { text, mood: 'remark', why: 'empty' }

  /*
    A prohibition stops the clause it is in, not the one beside it.

    "Make a note of it but do not send anything" is an instruction and a
    prohibition, and a reasonable person makes the note. The shared clause
    splitter does not cut on contrastive coordinators — it serves routing too,
    and widening it there would change who gets convened — so the contrast is
    followed here, and only when the prohibition lives on the far side of it.
  */
  if (FORBIDS.test(text)) {
    const contrast = /^(.{6,}?)\s+(?:but|though|however|although)\s+(.+)$/is.exec(text)
    const before = contrast?.[1]
    const after = contrast?.[2]
    if (
      before !== undefined &&
      after !== undefined &&
      FORBIDS.test(after) &&
      !FORBIDS.test(before)
    ) {
      const head = readClause(before)
      if (head.mood === 'ask')
        return { text, mood: 'ask', why: `${head.why}, with the prohibition on the other clause` }
    }
    return { text, mood: 'remark', why: 'a prohibition or a hold' }
  }
  if (STANCE.test(text))
    return { text, mood: 'remark', why: 'a stance marker — the main clause is the thought' }
  if (SUPPOSING.test(text)) return { text, mood: 'remark', why: 'a supposition' }
  if (EXEMPLIFYING.test(text))
    return { text, mood: 'remark', why: 'an example, not an instruction' }

  if (LABELLED.test(text)) return { text, mood: 'ask', why: 'a labelled shorthand' }
  if (POLITE_REQUEST.test(text))
    return { text, mood: 'ask', why: 'a second-person modal — a request in question clothing' }
  if (DESIDERATIVE.test(text))
    return { text, mood: 'ask', why: 'first person wanting something done' }
  if (DELEGATES.test(text)) return { text, mood: 'ask', why: 'handing the work to a named person' }

  if (WH.test(text) || INVERTED.test(text)) return { text, mood: 'question', why: 'a question' }
  if (text.endsWith('?')) return { text, mood: 'question', why: 'a question mark' }

  /*
    Object first, instruction after. "That supplier — chase them Friday."

    English lets you name the thing and then say what to do with it, and the
    opener test sees only the naming half. Rather than teach the shared clause
    splitter a new rule — it serves routing too, and one splitter answering two
    questions is how a list gets built twice — the dash is followed here, and
    only when what comes after it is long enough to be a clause of its own.
  */
  const afterDash = /[—–]\s*(.{6,})$/.exec(text)?.[1]
  if (afterDash !== undefined && !FORBIDS.test(text)) {
    const tail = readClause(afterDash)
    if (tail.mood === 'ask') return { text, mood: 'ask', why: `${tail.why}, after the topic` }
  }

  const w = words(text)
  /*
    Three tokens, because "Morning." and "Thanks" are not commands and a
    one-word clause carries no evidence either way. The floor is what stops the
    broadest signal here from firing on a greeting.
  */
  if (w.length < 3) return { text, mood: 'remark', why: 'too short to be an instruction' }

  const first = w[0] ?? ''
  const second = w[1] ?? ''
  /*
    An imperative is a BARE STEM. A clause opening with a gerund or a past
    tense is therefore not one, whatever the verb is — "Drafting it now feels
    premature" and "Decided not to in the end" are things being described, not
    things being asked for.

    Structural, like the second-token test below: it reads the shape of the
    token rather than recognising the word, so it holds for verbs nobody has
    used yet. Found by semantic mutation rather than by the development
    controls, which is what mutations are for.
  */
  if (/ing$/.test(first) || /ed$/.test(first) || IRREGULAR_PAST.has(first)) {
    return { text, mood: 'remark', why: `"${first}" is not a bare stem, so not a command` }
  }
  if (NOT_IMPERATIVE_OPENERS.has(first)) {
    return {
      text,
      mood: 'unsure',
      why: `opens with the function word "${first}", so not an imperative`,
    }
  }
  /*
    "Review OF the quarter" is a noun phrase; "Review THE quarter" is a
    command. English imperatives take a direct object, not a prepositional
    complement, so an "of" in second position means the first token was a noun.

    Found by a regression that predates all of this: "Review of the quarter is
    attached, no action needed" became an assignment, which is the false
    positive this whole design is most afraid of.
  */
  /*
    "Emma ALREADY put a task on the board." An imperative cannot take these —
    "already chase the roofer" is not English — so one in second position means
    the first token was a subject and this is a report of something done.
  */
  if (REPORTING_ADVERB.has(second)) {
    return { text, mood: 'remark', why: `"${second}" makes this a report, not a command` }
  }
  if (second === 'of') {
    return { text, mood: 'remark', why: `"${first} of" is a noun phrase, not a command` }
  }
  if (FINITE_SECOND.has(second)) {
    return { text, mood: 'remark', why: `"${first} ${second}" is a statement, not a command` }
  }
  /*
    An INFLECTED second token means the first one was its subject.

    "Emma finished the teardown yesterday" opens with a word that is not a
    function word, so the opener test alone reads it as a command addressed to
    nobody. An imperative is a bare stem and what follows it is almost always a
    function word — chase THE landlord, draft A note, tidy UP the list, book A
    slot. A past tense or a third-person singular in that position is the tell
    that somebody is reporting something instead.

    Structural rather than a lexicon: it asks about the SHAPE of the token, not
    which token it is, so it holds for verbs nobody has thought of yet.
  */
  /*
    Past tense and third-person singular only. NOT the -ing form, which was in
    the first draft and cost a real instruction: "Stick CHASING the supplier on
    my list" is an imperative with a gerund object, and so are "start drafting"
    and "keep chasing". A bare noun followed by an -ing word is not a sentence
    at all, so -ing carries no evidence that the first token was a subject.
  */
  const inflected = /ed$/.test(second) || (/s$/.test(second) && !/(?:ss|us|is)$/.test(second))
  if (inflected && !FUNCTION_SECOND.has(second)) {
    return { text, mood: 'remark', why: `"${first} ${second}" reads as subject and verb` }
  }
  return { text, mood: 'ask', why: `imperative: opens with "${first}", no subject` }
}

/**
 * Read a whole message, clause by clause.
 *
 * Per clause rather than per message, because one message routinely carries
 * more than one intention — *"work out where we stand on the policy and then
 * draft what I send them"* is an analysis and an action for two different
 * desks, and forcing it into a single class is what made the whole thing an
 * unrecognised remark.
 */
export const readRequest = (
  message: string,
  split: (t: string) => readonly string[],
): readonly ClauseReading[] => split(message).map(readClause)

/** Does any clause ask the office to act? */
export const asksForAction = (readings: readonly ClauseReading[]): boolean =>
  readings.some((r) => r.mood === 'ask')

/** Does any clause need an answer — an ask or a question? */
export const wantsSomething = (readings: readonly ClauseReading[]): boolean =>
  readings.some((r) => r.mood === 'ask' || r.mood === 'question')
