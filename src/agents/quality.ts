/**
 * The quality gate (§10, §16).
 *
 * §16: *"no substantive output bypasses review."* The invariants note what
 * makes that sentence usable rather than decorative:
 *
 *   *"The word 'substantive' needs a hard definition, or the gate is decided
 *   ad hoc."*
 *
 * and the definition it settles on is about provenance, not importance:
 *
 *   *"the exemption must be defined by how the answer was produced -
 *   deterministic code path vs. inference - because THAT IS CHECKABLE, whereas
 *   'was it important?' is not."*
 *
 * So the question this module answers is never "does this matter?". It is
 * "where did this come from?", which has an answer the database can verify —
 * and 0023 does verify it, refusing a `deterministic` claim from any job with
 * recorded inference usage.
 *
 * ## What this module is not
 *
 * It is not the enforcement. The enforcement is the 0018 trigger on `jobs`,
 * which refuses `committed` while any non-deterministic output is unreviewed.
 * This module decides what to *send* to review and what a review must record.
 * If it were the only thing standing between an output and a commit, §10's
 * *"the gate cannot be bypassed by the caller"* would be false the moment
 * someone wrote a second caller.
 */

import type { Domain } from './provenance.ts'

/** How an output was produced. The only input the exemption is allowed to read. */
export const PRODUCTION_PATHS = [
  /** A model wrote it. Always substantive. */
  'inference',
  /** Code produced it with no model call — a status read, a count, a list. */
  'deterministic_retrieval',
  /** Code reshaped material that was already reviewed. */
  'mechanical_transformation',
  /** Words lifted verbatim from output that has already passed review. */
  'quoted_from_reviewed',
] as const

export type ProductionPath = (typeof PRODUCTION_PATHS)[number]

/**
 * What the output does, which decides review only when the path is ambiguous.
 *
 * The invariants list these explicitly under "Requires review", and they are
 * kept as data rather than prose so that adding a kind is a visible change.
 */
export const SUBSTANTIVE_KINDS = [
  'research_conclusion',
  'strategy',
  'recommendation',
  'project_change_from_inference',
  'external_source_introduced',
  'notebook_write',
] as const

export type OutputKind =
  | (typeof SUBSTANTIVE_KINDS)[number]
  | 'status'
  | 'task_list'
  | 'calendar_read'
  | 'restatement'

export interface ReviewDecision {
  readonly required: boolean
  /** `false` when the output may be recorded as `deterministic` in the database. */
  readonly exempt: boolean
  readonly reason: string
}

/**
 * Does this output need review?
 *
 * Reads the production path first and the kind second, in that order and not
 * the other way round. A `status` produced by a model is still a model's
 * words: §16's whole point is that provenance decides, because provenance is
 * the part that can be checked.
 */
export const reviewRequired = (input: {
  readonly path: ProductionPath
  readonly kind: OutputKind
}): ReviewDecision => {
  if (input.path === 'inference') {
    return {
      required: true,
      exempt: false,
      reason:
        'a model produced this, so it is substantive by §16 regardless of what ' + 'it is about',
    }
  }

  // Below here no model was involved, so the exemption is available. It is
  // still withheld for the kinds that introduce material from outside or write
  // somewhere - those change what the system believes, and a mechanical path
  // into a wrong belief is still a wrong belief.
  if (
    input.kind === 'external_source_introduced' ||
    input.kind === 'notebook_write' ||
    input.kind === 'project_change_from_inference'
  ) {
    return {
      required: true,
      exempt: false,
      reason: `${input.kind} introduces or writes material, so it is reviewed even on a ${input.path} path`,
    }
  }

  return {
    required: false,
    exempt: true,
    reason: `${input.path} with no model call, and ${input.kind} neither introduces nor writes material`,
  }
}

// ---------------------------------------------------------------------------
// The metadata a review must carry
// ---------------------------------------------------------------------------

export type Confidence = 'low' | 'medium' | 'high'
export type Evidence = 'verified' | 'inferred' | 'speculative'
export type ReviewerStatus =
  | 'pending'
  | 'approved'
  | 'approved_with_reservations'
  | 'rejected'
  | 'needs_revision'

export interface OutputMetadata {
  readonly confidence: Confidence
  readonly evidence: Evidence
  readonly sources: readonly string[]
  readonly contradictions: string | null
  /**
   * What the agent actually WROTE.
   *
   * Optional so every existing caller keeps compiling, and supplied by the
   * worker — which is the only caller — so the check below is live. See
   * `claimsToHaveRead` for why the body has to be in here at all.
   */
  readonly body?: string
  /**
   * How many things this job actually DID — child jobs, tasks, consultations.
   *
   * Supplied by the worker, which is the only caller that can count them.
   * Absent means "not counted", and an absent count never accuses anybody:
   * the action check below only fires on the claims that are false by
   * CONSTRUCTION, plus the ones this number can disprove.
   */
  readonly acted?: number
  /**
   * Whether this job had ANY earlier turn in its conversation.
   *
   * Supplied by the worker from `app.conversation_extent`. Absent means "not
   * established", and an absent value never accuses anybody — the attribution
   * check below fires only on an explicit `false`.
   */
  readonly hadHistory?: boolean
  /**
   * Everything the answer could legitimately have taken a specific FROM — the
   * instruction, the conversation replayed into the prompt, and the retrieved
   * documents.
   *
   * Supplied by the handler, because the handler is the only thing that knows
   * what it put in front of the model. Undefined disables `fabricatedWhen`
   * entirely: a comparison with nothing to compare against would refuse every
   * answer that mentions a time.
   */
  readonly grounding?: string
  /**
   * Whether anything was actually consulted for this turn.
   *
   * `provenance.consulted()` decides it. False means the answer rests entirely
   * on the conversation and the model's own knowledge, which is exactly the
   * state in which a confident claim about the office's records cannot be
   * true. Undefined means the caller cannot say, and disables the check rather
   * than guessing at it.
   */
  readonly consulted?: {
    readonly consulted: readonly Domain[]
    readonly complete: readonly Domain[]
  }
}

export interface MetadataProblem {
  readonly field: string
  readonly problem: string
}

/**
 * Check the §16 metadata for the combinations that are not coherent.
 *
 * Not a schema check — the database has those. These are the pairings that
 * satisfy every column constraint individually and still describe something
 * impossible, which is how a confident-sounding guess gets published.
 */
/**
 * Does this text tell the reader what THEY said?
 *
 * #231, Campaign Three. Asked *"What price did I tell you the middle tier
 * was?"* in a chat with **no earlier turns at all**, the office answered:
 *
 *     "Forty-two pounds a month - that's the middle tier you told me."
 *
 * There was no such conversation. It invented a figure and attributed it to
 * Grant, who would have believed he had said it. A second turn in the same
 * empty chat produced *"You asked about the middle tier price."*
 *
 * Forty-two is the archetypal number a model reaches for when it has nothing,
 * which is how this was found: a memory test planted 42, and the CONTROL chat
 * — never told anything — produced the same figure, invalidating the
 * experiment and exposing the real defect underneath it.
 *
 * ## Why this can be strict
 *
 * Same structure as `claimsToHaveSent`. When the conversation carried no
 * earlier turn, "you told me" is false at the moment it is written, every
 * time — there is nothing it could be true of. The caller supplies that fact;
 * without it this never fires.
 *
 * A QUESTION about what was said is left alone ("did you mean the middle
 * tier?"), because asking is the honest behaviour this is trying to produce.
 */
export const claimsGrantSaid = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const claims: RegExp[] = [
    /\byou\s+(?:told|said\s+to)\s+me\b[^.!?]{0,60}/i,
    /\byou\s+(?:said|asked|mentioned|told\s+us|wanted|described)\b[^.!?]{0,60}/i,
    /\b(?:that\s+is|that's|thats)\s+(?:the\s+)?[a-z ]{0,30}\byou\s+(?:told|gave|mentioned|said)\b[^.!?]{0,40}/i,
    /\bas\s+you\s+(?:said|mentioned|put\s+it)\b[^.!?]{0,60}/i,
    /\bearlier\s+you\s+\w+\b[^.!?]{0,60}/i,
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit === null) continue
    /*
      A question about what was said is not a claim about it.

      "Did you mean the middle tier?" and "what did you say the price was?"
      are the office asking, which is precisely the behaviour this exists to
      encourage — refusing them would push it back towards guessing.
    */
    const sentence = text.slice(Math.max(0, hit.index - 60), hit.index + hit[0].length + 40)
    if (/\?/.test(sentence)) continue
    return hit[0].trim().slice(0, 80)
  }
  return null
}

/**
 * Does this text claim, in the first person, to have SENT something?
 *
 * #237. A voice note produced this, and Grant would have believed it:
 *
 *     "I've posted a Slack message to the team asking what's blocking
 *      onboarding. We need their input before we decide anything else.
 *      A Slack message is going out right now."
 *
 * `deliveries` for that job: **zero**. Child jobs: **zero**. Nobody was
 * contacted, and he would have sat waiting for replies from a team that was
 * never asked.
 *
 * ## Why this one can be strict where `claimsToHaveRead` must be narrow
 *
 * An agent answering an instruction has NO outbound path. The office's only
 * way out is the notifier, which runs after the output exists and is the
 * thing that turns this very answer into a message. So a first-person claim
 * to have already posted, sent, emailed or messaged somebody is false at the
 * moment it is written, every time, by construction — there is nothing to
 * check it against because there is nothing it could be true of.
 *
 * Future tense is left alone. "I'll ask the team" is a plan, and §9's hand-off
 * makes plans like that real; "I have asked the team" is a claim about the
 * past that nothing performed.
 */
export const claimsToHaveSent = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const claims: RegExp[] = [
    /\bI(?:'ve|\s+have)?\s+(?:just\s+)?(?:posted|sent|messaged|emailed|e-mailed|pinged|notified|forwarded)\b[^.!?]{0,60}/i,
    /\b(?:a|the)\s+(?:slack\s+message|message|email|note)\s+(?:is|has)\s+(?:going|gone|been)\s+(?:out|sent)\b[^.!?]{0,60}/i,
    /\bI\s+(?:have\s+)?(?:asked|contacted|reached\s+out\s+to)\s+(?:the\s+)?(?:team|everyone|them|him|her|\w+)\s+(?:on|in|via|over)\s+(?:slack|telegram|email)\b[^.!?]{0,60}/i,
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit !== null) return hit[0].trim().slice(0, 80)
  }
  return null
}

/**
 * Does this text PROMISE to contact somebody on a channel it cannot reach?
 *
 * #231, found by a voice-note session. The office told Grant:
 *
 *     "I'll post a quick question on #team-slack asking what's keeping
 *      onboarding from being usable. I'll hold off on any changes until we
 *      have the team's input."
 *
 * `deliveries` for that job: zero. Child jobs: zero. Consultations: zero. He
 * would have waited for input from a channel nobody was asked in — the same
 * betrayal `claimsToHaveSent` exists for, arriving in the one tense that
 * function deliberately leaves alone.
 *
 * ## Why future tense is still mostly safe, and where it stops being
 *
 * *"I'll ask the team"* is a plan, and §9's hand-off makes it real: convening
 * a specialist IS asking the team, and refusing that sentence would push the
 * office towards saying less about what it intends to do.
 *
 * *"I'll post it on Slack"* is not that. It names a MECHANISM, and no
 * mechanism of that shape runs after an answer: the notifier turns this very
 * output into a message to Grant, and nothing in the job's path opens a
 * conversation with anybody else. So the promise is unkeepable at the moment
 * it is written, by construction — which is the same argument
 * `claimsToHaveSent` makes about the past tense, and it is why this can be a
 * rule rather than a guess.
 *
 * The named channel is the whole discrimination. Drop it and this fires on
 * every honest plan; keep it and it fires only on the promises nothing can
 * keep.
 */
export const promisesToReachOut = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const CHANNEL = String.raw`(?:slack|telegram|e-?mail|whatsapp|teams|#[a-z0-9_-]+)`
  const claims: RegExp[] = [
    // "I'll post a question on #team-slack", "I will send them an email"
    new RegExp(
      String.raw`\bI(?:'ll|\s+will|\s+am\s+going\s+to|\s+shall)\s+(?:\w+\s+){0,6}?(?:post|send|message|ping|email|e-mail|drop|write)\b[^.!?]{0,40}?\b${CHANNEL}\b`,
      'i',
    ),
    // "I'll ask the team on Slack", "I am going to check with them over email"
    new RegExp(
      String.raw`\bI(?:'ll|\s+will|\s+am\s+going\s+to|\s+shall)\s+(?:\w+\s+){0,6}?(?:ask|check\s+with|reach\s+out\s+to|contact|chase)\b[^.!?]{0,40}?\b(?:on|in|via|over|through)\s+(?:the\s+)?${CHANNEL}\b`,
      'i',
    ),
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit !== null) return hit[0].trim().slice(0, 80)
  }
  return null
}

/**
 * Does this text claim, in the first person, to have gone and looked?
 *
 * Returns the phrase it found, so the failure can quote it back rather than
 * saying "something in here". Null when it makes no such claim.
 *
 * ## Deliberately narrow
 *
 * It matches a small set of verbs in the FIRST PERSON or attached to a named
 * retrieval — "I pulled", "the db read shows", "I queried". It does not match
 * "the records show", "according to the brief", or any of the hundred ways a
 * sentence can imply a source without asserting an action, because a check
 * that fires on those would fire on almost every honest summary and be turned
 * off within a week.
 *
 * The bar is: **would a person reading this believe a lookup happened?** Not:
 * does this mention data.
 *
 * False negatives are expected and acceptable. A false POSITIVE fails a job
 * that was fine, so the list stays short and grows only when a real message
 * gets past it.
 */
/**
 * Times and dates in the answer that were in nothing the office was given.
 *
 * ## The output this exists for
 *
 * Asked *"Remind me what we decided in the Tuesday call"* — about a meeting
 * that never happened, in a project holding no calendar — the office replied:
 *
 *     1. 3.19 PM - Weekly Standup - Completed: action items for Q3 pricing
 *        review (due Fri Oct 18)
 *     2. 4.02 PM - Client Renewal Review - Open issues: need Priya's churn
 *        analysis, pending Q3 pricing review summary, pending decision on
 *        discount tier.
 *     That's the only event on Tuesday.
 *
 * Two meetings with clock times, a due date, and named agenda items — none of
 * which exist. Worse, it had absorbed the three earlier baits in the same
 * chat (a Q3 pricing review, a person called Priya, a churn figure) and served
 * them back as calendar entries: the office's own honest *"I have nothing on
 * Priya"* three turns earlier had become evidence that Priya exists.
 *
 * ## Why the existing gates could not see it
 *
 * Every one of them keys on a CLAIM. `claimsToHaveRead` needs "I checked";
 * `claimsToHaveSent` needs "I posted"; `claimsGrantSaid` needs "you told me".
 * This output claims nothing. It simply asserts, and an assertion with no
 * verb of retrieval in front of it was invisible.
 *
 * ## What is checkable without a model
 *
 * Not "is this true" — nothing here can know that. But a clock time or a
 * calendar date is a specific that cannot be REASONED to. A margin of £26 can
 * be derived from £40 and £14, which is why numbers in general are not
 * checked here; 3.19 PM cannot be derived from anything. So if the answer
 * contains one and it appears nowhere in the instruction, the conversation or
 * the documents that were retrieved, the office made it up.
 *
 * Narrow on purpose, and the narrowness is what makes it a rule rather than a
 * guess. It will miss an invented name and an invented percentage. It cannot
 * fire on an answer that is doing arithmetic, quoting a document, or repeating
 * something Grant said, because all three are in the grounding.
 */
export const fabricatedWhen = (body: string, grounding: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const flat = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]/g, '')
  const known = flat(grounding)
  const MONTH = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec'
  const shapes: RegExp[] = [
    /*
      A clock time, and the hour has to be an HOUR.

      The first draft was `\d{1,2}[:.]\d{2}` with an optional am/pm, and it
      read the price **£63.50** as 63 minutes past something. The gate then
      refused a perfectly good monetisation answer four times, which cost four
      model calls and — since a gate that fires wrongly is worse than no gate —
      would have taught the next person to switch it off.

      So the colon form is bounded to a real 24-hour clock, and the DOT form
      requires am or pm, because "63.50" and "3.19 PM" are otherwise the same
      shape and money is far commoner here than a dotted time. The cost is
      missing a bare "9.30", which is the cheap direction: a missed invention
      is one bad answer, and a false refusal is every good answer that
      mentions a price.
    */
    /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g,
    /\b(?:1[0-2]|0?\d)[:.][0-5]\d\s*(?:am|pm)\b/gi,
    /\b(?:1[0-2]|0?\d)\s*(?:am|pm)\b/gi,
    // A calendar date: Oct 18, 18 October, 2026-10-18.
    new RegExp(String.raw`\b(?:${MONTH})[a-z]*\.?\s+\d{1,2}\b`, 'gi'),
    new RegExp(String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTH})[a-z]*\b`, 'gi'),
    /\b\d{4}-\d{2}-\d{2}\b/g,
  ]
  for (const re of shapes) {
    for (const hit of text.matchAll(re)) {
      const token = flat(hit[0])
      if (token === '' || known.includes(token)) continue
      /*
        A bare hour that is also just a number is not worth a refusal: "9am"
        is a specific, "2.00" in a sentence about money is not. The clock
        shapes above already require a colon, a point or an am/pm, which is
        the whole discrimination — this only guards the degenerate case where
        stripping punctuation leaves two digits that could be anything.
      */
      if (/^\d{1,2}$/.test(token)) continue
      return hit[0].trim().slice(0, 40)
    }
  }
  return null
}

/**
 * Nouns for things the office either HOLDS or does not.
 *
 * Every one of them is a row somewhere, or a thing a row stands for. That is
 * what makes a claim about them checkable in principle and unfounded in fact
 * when nothing was looked at.
 *
 * Deliberately not "thing", "item", "option", "idea", "point" or "risk" — an
 * answer is allowed to enumerate its own reasoning, and a check that refused
 * "there are three options" would stop the office thinking out loud.
 */
const HOLDS: Readonly<Record<Domain | 'unreachable', readonly string[]>> = {
  calendar: ['event', 'meeting', 'call', 'appointment', 'reminder', 'attendee'],
  documents: ['document', 'doc', 'note', 'entry', 'record', 'file', 'page', 'notebook'],
  projects: ['project'],
  tasks: ['task'],
  mail: ['email', 'message'],
  contacts: ['contact'],
  /*
    Nothing in this office consults these, so a claim about them is never
    grounded — which is the honest state of it rather than an oversight. The
    day one of them gets a reader, it moves up into a domain and the check
    relaxes on its own.
  */
  unreachable: ['decision', 'deadline', 'invoice', 'ticket'],
}

/** Both numbers, because a model writes either. */
const plural = (w: string): string => `${w}s?`
const RECORD = `(?:${Object.values(HOLDS).flat().map(plural).join('|')})`

/**
 * Containers, for the sentences that name the place rather than the thing.
 *
 * "The diary is empty" is a claim about the calendar, and "nothing is
 * scheduled" is the same claim with no noun in it at all.
 */
const CONTAINER: Readonly<Record<string, Domain>> = {
  diary: 'calendar',
  calendar: 'calendar',
  inbox: 'mail',
  mailbox: 'mail',
}

/**
 * A statement about the office's own knowledge, rather than about the world.
 *
 * This is the third value, and leaving it out was the defect. There are not
 * two states here but three:
 *
 *   - **a supported positive fact** — "the review is on Thursday" — needs the
 *     source read and the answer in it;
 *   - **a supported absence** — "there are no meetings on Thursday" — needs
 *     the source read and nothing in it. It is a claim about the world and it
 *     is exactly as falsifiable as the positive;
 *   - **not checked** — "I have no record of a meeting on Thursday" — needs
 *     nothing at all, because it says only what the office has been shown.
 *
 * Collapsing the last two is wrong in both directions. Treat an absence as
 * free and the office asserts an empty diary it never opened, which is how
 * Grant stops looking. Treat "I have not been shown one" as a claim and the
 * office is forbidden from saying the one honest thing available to it, which
 * is worse — it would have to either invent or go silent.
 *
 * So the frame decides. First person about knowing beats any absence pattern
 * in the same sentence; everything else is a claim about the world.
 */
const EPISTEMIC =
  /\b(?:I\s+(?:have|'ve|do|did|am|can|could)\b[^.!?]{0,20}?\b(?:not|n't|no)\b|I\s+(?:cannot|can't|haven't|don't|doubt)\b|not\s+that\s+I\s+(?:can\s+see|know)|nothing\s+(?:I|we)\s+(?:can\s+see|hold|have|was\s+shown)|as\s+far\s+as\s+I\s+can\s+see|I\s+have\s+no\s+(?:record|evidence|sight|visibility))/i

/** Which domain a record noun belongs to, so provenance can be checked per source. */
const domainOf = (noun: string): Domain | 'unreachable' => {
  const bare = noun.toLowerCase().replace(/s$/, '')
  for (const [domain, nouns] of Object.entries(HOLDS))
    if (nouns.includes(bare)) return domain as Domain | 'unreachable'
  return 'unreachable'
}

/**
 * A number, in either notation, because a model writes both.
 *
 * "no" and "zero" are deliberately absent. *"I have no record of that"* is the
 * honest answer this whole file exists to encourage, and the first draft
 * refused it — `no` + `record` read as a count of records. An absence is not a
 * claim about contents. The exhaustiveness shape below still catches *"no
 * other invoices"*, which is one: it says something about everything that is
 * there.
 */
const HOW_MANY = String.raw`(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)`

/**
 * Does this text state what the office HAS, when the office looked at nothing?
 *
 * ## The generalisation, rather than the calendar
 *
 * The fabricated answer that prompted this listed two meetings with times and
 * finished *"that's the only event on Tuesday"*. The times are caught by
 * `fabricatedWhen`. This catches the other half, and the half that generalises:
 * a definite claim about the CONTENTS of the office's records, made when
 * nothing was retrieved and nothing canonical was read.
 *
 * It is the same shape as #185's *"the db read shows five active projects:
 * mtz08joe, ..."* — none of which existed — and it is available in every
 * domain the office touches, not just calendars. Tasks, emails, documents,
 * contacts, deadlines, decisions and invoices are all rows, and a count or an
 * exhaustiveness claim about any of them is either grounded or invented.
 *
 * ## Two shapes, both definite
 *
 *   - a COUNT of records: "five active projects", "three documents", "no other
 *     tasks";
 *   - an EXHAUSTIVENESS claim: "the only event", "all of the emails", "none of
 *     the decisions".
 *
 * Both assert something checkable about persisted state. Neither can be true
 * of a turn that consulted nothing.
 *
 * ## What keeps it from firing on good answers
 *
 * Three things, and they matter more than the patterns:
 *
 *   1. It is off entirely when something WAS retrieved. An office answering
 *      from documents is allowed to count them.
 *   2. The claim is allowed when the same words are in the grounding — if
 *      Grant said "we have three documents on this", repeating him is not a
 *      claim about records, it is listening.
 *   3. `RECORD` excludes the nouns an answer uses to enumerate its own
 *      thinking. "Three options", "two risks", "the only sensible approach"
 *      are reasoning, not retrieval.
 *
 * Returns the phrase, so the refusal can quote it rather than gesturing.
 */
export const assertsRecordsUnseen = (
  body: string,
  grounding: string,
  /**
   * What the office may say about which source.
   *
   * `consulted` — a lookup RAN, so an absence is reportable. `complete` — the
   * office holds the whole list, so a count is reportable. A search is not a
   * census, which is why these are two sets and not one: `retrieve()` returns
   * the best few matches, so it supports "nothing in our documents about
   * renewals" and never "we hold four documents on renewals".
   */
  may: { readonly consulted: readonly Domain[]; readonly complete: readonly Domain[] },
): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const flat = (v: string): string => v.toLowerCase().replace(/\s+/g, ' ')
  const known = flat(grounding)
  const shapes: { readonly needs: 'consulted' | 'complete'; readonly re: RegExp }[] = [
    /*
      An ABSENCE asserted about the world (#231, second pass).

      "There are no meetings on Tuesday" is not the same sentence as "I have no
      record of a meeting on Tuesday", and the first draft of this check let
      both through because it only looked for counts and exhaustiveness. An
      empty diary the office never opened is a claim, and it is the one that
      makes Grant stop looking.

      `EPISTEMIC` above is the escape, and it runs first: a sentence framed as
      what the office knows is never refused however it is worded.
    */
    {
      needs: 'consulted',
      re: new RegExp(
        String.raw`\bthere\s+(?:is|are|was|were)\s+no\s+(?:\w+\s+){0,2}?${RECORD}\b`,
        'gi',
      ),
    },
    {
      needs: 'consulted',
      re: new RegExp(String.raw`\b(?:you|we)\s+have\s+no\s+(?:\w+\s+){0,2}?${RECORD}\b`, 'gi'),
    },
    {
      needs: 'consulted',
      re: new RegExp(
        String.raw`\bno\s+(?:\w+\s+){0,2}?${RECORD}\s+(?:exist|exists|are|is|were|scheduled|booked|outstanding|open|filed|logged)\b`,
        'gi',
      ),
    },
    {
      needs: 'consulted',
      re: /\bnothing\s+(?:is|was|has\s+been)\s+(?:scheduled|booked|filed|logged|recorded|diarised)\b/gi,
    },
    {
      needs: 'consulted',
      re: new RegExp(
        String.raw`\bthe\s+(?:\w+\s+){0,2}?(?:${Object.keys(CONTAINER).join('|')})\s+(?:is|was)\s+(?:empty|clear|blank)\b`,
        'gi',
      ),
    },
    // A COUNT needs the whole list, not a search. "five active projects".
    {
      needs: 'complete',
      re: new RegExp(String.raw`\b${HOW_MANY}\s+(?:\w+\s+){0,2}?${RECORD}\b`, 'gi'),
    },
    // So does exhaustiveness. "the only event", "none of the decisions".
    {
      needs: 'complete',
      re: new RegExp(
        String.raw`\b(?:the only|all(?:\s+of)?\s+the|every|none\s+of\s+the|no\s+other)\s+(?:\w+\s+){0,2}?${RECORD}\b`,
        'gi',
      ),
    },
  ]
  for (const shape of shapes) {
    for (const hit of text.matchAll(shape.re)) {
      const phrase = flat(hit[0]).trim()
      /*
        Grant's own words come back unrefused.

        He is entitled to tell the office how many documents there are, and an
        answer that repeats him is listening rather than claiming. Matched on
        the phrase because that is what a repetition looks like; a DIFFERENT
        count is a different claim and stays caught.
      */
      if (known.includes(phrase)) continue
      /*
        Grounded per SOURCE, not per turn.

        Retrieving a document licenses a claim about documents and nothing
        else. The diary, the inbox and the task list are separate reads and
        each has to have happened for a claim about it to be reporting rather
        than inventing.
      */
      /*
        What the office KNOWS is never refused, however it is worded — the
        third value. See `EPISTEMIC`.
      */
      const from = text.lastIndexOf('.', hit.index) + 1
      const stop = text.indexOf('.', hit.index + hit[0].length)
      const sentence = text.slice(from, stop === -1 ? text.length : stop + 1)
      if (EPISTEMIC.test(sentence)) continue
      const noun = new RegExp(String.raw`\b${RECORD}\b`, 'i').exec(hit[0])?.[0] ?? ''
      const named = new RegExp(String.raw`\b(?:${Object.keys(CONTAINER).join('|')})\b`, 'i').exec(
        hit[0],
      )?.[0]
      const domain =
        noun === '' && named !== undefined
          ? (CONTAINER[named.toLowerCase()] as Domain)
          : noun === '' && /scheduled|booked|diarised/i.test(hit[0])
            ? ('calendar' as Domain)
            : domainOf(noun)
      const allowed = shape.needs === 'complete' ? may.complete : may.consulted
      if (domain !== 'unreachable' && allowed.includes(domain)) {
        /*
          Holding the whole list licenses COUNTING it, not choosing a number.

          The office is handed the live project list every turn, so "you have
          two projects open" is reporting — and "six active projects" is a
          claim that contradicts the thing in front of it. Being entitled to
          count is not being entitled to be wrong, and #185's original
          fabrication was exactly a count with real-looking names after it.

          Checked against the grounding in both notations, because a model
          writes either. A loose floor rather than a proof: the grounding has
          other digits in it and one could coincide. It still closes the case
          where the answer disagrees with the list it was given.
        */
        const said = /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.exec(
          hit[0],
        )?.[1]
        const WORDS: Readonly<Record<string, string>> = {
          one: '1',
          two: '2',
          three: '3',
          four: '4',
          five: '5',
          six: '6',
          seven: '7',
          eight: '8',
          nine: '9',
          ten: '10',
        }
        if (said === undefined) continue
        const digits = WORDS[said.toLowerCase()] ?? said
        const word = Object.keys(WORDS).find((w) => WORDS[w] === digits) ?? ''
        const inGrounding =
          known.includes(digits) || (word !== '' && flat(grounding).includes(word))
        if (inGrounding) continue
      }
      return hit[0].trim().slice(0, 60)
    }
  }
  return null
}

/**
 * Sources this path never touches, whatever the sentence says about them.
 *
 * `handlers/instruction.ts` retrieves from `public.documents` and nothing else
 * — `retrieve()` calls `app.search_documents`. GitHub, the inbox, the
 * calendar, Drive, Notion and Slack are other tools on other paths, so a
 * sentence claiming to have looked in one of them is false here whether it
 * reports a finding or an absence.
 *
 * This is what keeps #237's case caught while #231's are let through. *"I
 * checked the notebook, our docs, GitHub and the mail folder, but I have
 * nothing on it here"* is not modesty about a lookup that happened — it tells
 * Grant four places have been searched, so he does not search them himself,
 * and two of the four never were. An absence IS a claim when it is about
 * somewhere nothing looked.
 */
const BEYOND_REACH = /\b(?:github|repo|mail|inbox|gmail|e-?mails?|calendar|drive|notion|slack)\b/i

/**
 * The sentence reports that the look came back empty.
 *
 * Deliberately about ABSENCE and not about negation in general: "I checked the
 * notebook and it is not up to date" is a claim about what is in there and
 * stays caught. The phrases here all say the search returned no rows.
 */
const FOUND_NOTHING =
  /\b(?:nothing|no\s+(?:entry|entries|record|records|document|documents|match|matches|note|notes|result|results|file|files|data|sign|mention|reference)|not\s+(?:find|see|found)|(?:don'?t|do\s+not|didn'?t|did\s+not|can'?t|cannot)\s+(?:see|find|have)|turns?\s+up\s+no|came\s+back\s+empty|is\s+empty|none)\b/i

export const claimsToHaveRead = (body: string): string | null => {
  const text = String(body ?? '')
  if (text.trim() === '') return null
  const claims: RegExp[] = [
    // First person, past tense, retrieval verb.
    /\bI\s+(?:pulled|queried|fetched|retrieved|looked\s+up|ran\s+a?\s*quer\w+|checked\s+the\s+(?:db|database|table))\b[^.!?]{0,60}/i,
    /\bI(?:'ve|\s+have)\s+(?:pulled|queried|fetched|retrieved|read)\b[^.!?]{0,60}/i,
    /*
      First person, a looking verb, and one of the office's OWN sources named.

      Added because a real message got past the list, which is the only reason
      this header permits growing it. #237's contradictions session produced:

        "I checked the notebook, our docs, GitHub and the mail folder, but I
         have nothing on it here..."

      from an output whose evidence was `inferred` — four named lookups, none
      of which happened, in a sentence whose second half is honest. "I pulled"
      was caught and "I checked the notebook" was not, which is a distinction
      no reader would make.

      Kept narrow by naming the SOURCES rather than widening the verbs: "I
      checked the maths" and "I reviewed your proposal" still match nothing,
      and "the records show" still matches nothing because it asserts no
      action. The bar is unchanged — would a person reading this believe a
      lookup happened.
    */
    /\bI\s+(?:checked|searched|reviewed|read|looked\s+(?:at|through|in)|went\s+through|had\s+a\s+look\s+(?:at|in))\s+(?:the\s+|our\s+|your\s+)?(?:notebook|notebooklm|documents?|docs?|drive|github|repo|mail|inbox|gmail|email|calendar|notion|records?|files?|corpus|sources?|attachments?)\b[^.!?]{0,60}/i,
    // The system named as the actor of a read.
    /\bthe\s+(?:db|database|table|query|record)\s+(?:read|query|results?)\s+shows?\b[^.!?]{0,60}/i,
    /\b(?:db|database)\s+read\s+shows?\b[^.!?]{0,60}/i,
    /\baccording\s+to\s+the\s+(?:db|database)\b[^.!?]{0,60}/i,
  ]
  for (const re of claims) {
    const hit = re.exec(text)
    if (hit === null) continue
    /*
      A read that found NOTHING is not a claim about anything (#231).

      The held-out bait corpus found this. Every honest answer to "summarise
      the Q3 pricing review" has the same shape — *"I checked our notebook and
      the project documents and there is no entry"* — and every one of them was
      refused here, because the sentence claims a look and `evidence` on an
      answer that found nothing can only be `inferred`. There is no value in
      the evidence vocabulary for "searched, empty", so the office was
      structurally unable to say the true thing.

      It cost two attempts on one turn and four on another, and on the first it
      made the answer WORSE: the refused attempt said "I don't have the Q3
      pricing review document in our records"; the retry that replaced it said
      "I need the document name or ID to pull it", which reads as a lookup
      about to happen rather than one that came back empty.

      Safe in a way #185 was not, and the asymmetry is the argument. That case
      was *"I pulled the project records. The db read shows five active
      projects: mtz08joe, ..."* — a claimed read PRODUCING five facts, none of
      which existed. A claimed read reporting an absence produces nothing, so
      there is nothing in it for Grant to act on wrongly — unless the absence is
      about somewhere nothing looked, which `BEYOND_REACH` above is for.

      Scoped to the sentence the claim sits in, like the question escape hatch
      in `claimsGrantSaid`: a later sentence asserting a fact carries no read
      claim of its own and was never covered by this one.
    */
    const from = text.lastIndexOf('.', hit.index) + 1
    const end = text.indexOf('.', hit.index + hit[0].length)
    const sentence = text.slice(from, end === -1 ? text.length : end + 1)
    if (FOUND_NOTHING.test(sentence) && !BEYOND_REACH.test(sentence)) continue
    return hit[0].trim().slice(0, 80)
  }
  return null
}

export const metadataProblems = (m: OutputMetadata): readonly MetadataProblem[] => {
  const problems: MetadataProblem[] = []

  if (m.evidence === 'verified' && m.sources.length === 0) {
    problems.push({
      field: 'sources',
      problem:
        'evidence is "verified" with no sources. Verified means someone can go ' +
        'and check; with nothing to check, the correct label is inferred.',
    })
  }

  /*
    A citation that is not an address (#185).

    "verified with no sources" was already refused above; this is the same rule
    one step in, because a model that has been told it must cite something
    writes "the project records" and satisfies a length check. Every handler in
    `src/handlers` writes `<scheme>:<ref>`, so the shape is the office's own and
    not an invention of this check. Caught here as well as on the sending path
    so a job fails while somebody can still act on it, rather than producing
    something that is refused at the last moment.
  */
  if (m.evidence === 'verified' && m.sources.length > 0) {
    const bad = unresolvableSources(m.sources)
    if (bad.length > 0) {
      problems.push({
        field: 'sources',
        problem:
          `${bad.length} of ${m.sources.length} citations are not addresses ` +
          `(${bad
            .map((b) => `"${String(b).slice(0, 40)}"`)
            .join(', ')
            .slice(0, 160)}). ` +
          'A source is where somebody goes to check, so it needs a scheme and a ' +
          'reference, not a description.',
      })
    }
  }

  if (m.evidence === 'speculative' && m.confidence === 'high') {
    problems.push({
      field: 'confidence',
      problem:
        'high confidence in a speculative finding. §12 exists to keep these ' +
        'apart, and this pairing is what it looks like when they are conflated.',
    })
  }

  /*
    A claim of having READ, from an output that read nothing (#185).

    On 13 September Claire sent Grant this, at 03:45, on his phone:

      "I pulled the project records. The db read shows five active projects:
       mtz08joe, mtyz6js5, mtyyz7zy, mtyywoxz and mty9izdi."

    None of the five existed. The office had recorded `evidence: inferred` —
    it knew perfectly well that nothing had been read — and rendered that as
    small grey text UNDER a sentence claiming a database read. The footer was
    honest and the message was not, and the message is the part a person reads.

    So this is not the "a model hallucinated" problem, which no check can
    solve. It is that the output CONTRADICTED ITS OWN METADATA and nothing
    compared the two. That is checkable, cheaply, and it is what this does.

    The same model did it twice, five days apart, and it reached Grant both
    times.
  */
  /*
    A claim of having SENT something, from a job that sent nothing (#237).

    Strict, and it can afford to be: an agent answering an instruction has no
    outbound path at all. The notifier is the office's only way out and it runs
    after this, on this very answer. So "I've posted a Slack message to the
    team" is false at the moment it is written, every time.

    Worse than a fabricated read, which is why it is here: a fabricated read
    produces a wrong answer Grant can argue with, and a fabricated send leaves
    him waiting on people who were never asked.
  */
  /*
    Telling Grant what he said, in a conversation that had no earlier turn.

    Strict for the same structural reason as the send check: when the office
    carried no history, "you told me" is false at the moment it is written.
    Only fires on an explicit `hadHistory === false`, so a caller that does not
    establish the fact never triggers it.

    This is the worst of the three claim families. A fabricated read produces a
    wrong answer Grant can argue with; a fabricated send leaves him waiting;
    a fabricated attribution makes him doubt his own memory.
  */
  if (m.hadHistory === false) {
    const said = claimsGrantSaid(m.body ?? '')
    if (said !== null) {
      problems.push({
        field: 'body',
        problem:
          `the text tells Grant what he said ("${said}") and this conversation has no ` +
          'earlier turn at all — there is nothing he could have told you. Ask what he ' +
          'means, or say you have nothing on it; never attribute a fact to him that ' +
          'only the model produced (#231).',
      })
    }
  }

  const sentClaim = claimsToHaveSent(m.body ?? '')
  if (sentClaim !== null) {
    problems.push({
      field: 'body',
      problem:
        `the text says it sent something ("${sentClaim}"), and an agent answering an ` +
        'instruction has no way to send anything — the notifier runs after this, on ' +
        'this answer. Nobody was contacted. Say what you WILL do, or hand the work ' +
        'over, but do not report a message that does not exist (#237).',
    })
  }

  const promised = promisesToReachOut(m.body ?? '')
  if (promised !== null) {
    problems.push({
      field: 'body',
      problem:
        `the text promises to contact somebody on a named channel ("${promised}"), and ` +
        'nothing in this job can do that — the notifier turns THIS answer into a ' +
        'message to Grant and opens no other conversation. Say who should be asked ' +
        'and let him ask, or hand the work to the specialist, but do not promise a ' +
        'message that will never be sent (#231).',
    })
  }

  /*
    A specific nothing gave it (#231).

    Only when the caller supplies the grounding. Without it there is nothing
    to compare against, and a check that fires on an empty comparison would
    refuse every answer that mentions a time.
  */
  if (m.grounding !== undefined) {
    const invented = fabricatedWhen(m.body ?? '', m.grounding)
    if (invented !== null) {
      problems.push({
        field: 'body',
        problem:
          `the text gives a specific time or date ("${invented}") that appears nowhere in ` +
          'the request, the conversation or the documents that were retrieved, so it was ' +
          'made up. Say you have no record of it and ask where it is (#231).',
      })
    }
  }

  /*
    A claim about what the office HOLDS, made having looked at nothing (#231).

    Only when the caller says whether anything was consulted. Undefined means
    the caller cannot tell, and a check that assumed "nothing" would refuse
    every handler that does not report.
  */
  if (m.grounding !== undefined && m.consulted !== undefined) {
    const claimed = assertsRecordsUnseen(m.body ?? '', m.grounding, m.consulted)
    if (claimed !== null) {
      problems.push({
        field: 'body',
        problem:
          `the text states what our records contain ("${claimed}") and nothing was read ` +
          'this turn — no document was retrieved and no list was queried, so that is not ' +
          'something you can know. Having been MENTIONED in this conversation is not the ' +
          'same as existing. Say you have no record of it (#231).',
      })
    }
  }

  const readClaim = claimsToHaveRead(m.body ?? '')
  if (readClaim !== null && (m.evidence === 'inferred' || m.evidence === 'speculative')) {
    problems.push({
      field: 'body',
      problem:
        `the text claims to have read something ("${readClaim}") while evidence is ` +
        `"${m.evidence}", which means nothing was read. One of the two is wrong, and ` +
        'the sentence is the half Grant sees (#185).',
    })
  }

  if (m.contradictions !== null && m.contradictions.trim() !== '' && m.confidence === 'high') {
    // The averaging failure, caught at its source. An output that names a
    // material disagreement and then reports high confidence has resolved the
    // disagreement silently - which §16 forbids.
    problems.push({
      field: 'confidence',
      problem:
        'high confidence alongside recorded contradictions. §16 forbids ' +
        'resolving disagreement by averaging; if the contradiction is real the ' +
        'confidence is not high, and if it is not real it should not be recorded.',
    })
  }

  return problems
}

/**
 * Does this review need Grant told about it?
 *
 * §16: *"The output carries both positions; Grant is notified when it
 * matters."* "When it matters" is the part that needs a rule, and the rule is
 * that a disagreement which survived review is exactly the thing a human
 * should see — a reviewer who could resolve it would have.
 */
export const disagreementNeedsGrant = (input: {
  readonly status: ReviewerStatus
  readonly contradictions: string | null
}): boolean => {
  const hasContradiction = input.contradictions !== null && input.contradictions.trim() !== ''
  if (!hasContradiction) return false
  return input.status === 'approved' || input.status === 'approved_with_reservations'
}

/**
 * The statuses that let a job proceed toward `committed`.
 *
 * Mirrors the 0018 trigger. Duplicated deliberately, and the duplication is
 * the point: if this list and the trigger ever disagree, the trigger wins and
 * the caller gets an error — which is the correct direction for a gate to fail.
 */
export const COMMITTABLE_STATUSES: readonly ReviewerStatus[] = [
  'approved',
  'approved_with_reservations',
]

export const canCommit = (statuses: readonly ReviewerStatus[]): boolean =>
  statuses.length === 0 || statuses.every((s) => COMMITTABLE_STATUSES.includes(s))

// ---------------------------------------------------------------------------
// What must not reach a person (#185)
// ---------------------------------------------------------------------------

/*
  `metadataProblems` runs when an output is CREATED. That is the right place to
  catch an incoherent output and it is not the last place it can be caught,
  because it is not the place a person is reached from.

  Two paths reach a channel without passing through output creation:

    - `resumeNotifications` rebuilds an output from its stored row and sends
      it. A row written before this rule existed goes out unexamined.
    - Anything that comes to hold `notifying` by recovery rather than by
      running.

  #185's third box says the check belongs on the SENDING path for exactly that
  reason, so this is the guard `combinedNotifier` consults, once, for every
  channel.

  ## Deliberately narrower than `metadataProblems`

  It refuses the two things that are LIES TO THE READER — a claim of having
  looked from an output that did not, and a claim of verification with nothing
  behind it. It does not refuse the judgement pairings (high confidence on a
  speculative finding, high confidence alongside contradictions). Those are
  real defects and they are already refused at creation; refusing them again
  here would mean a job that ran, produced something usable and then said
  nothing at all, which is how a send guard gets turned off.

  The bar for this list is: **would a person, reading only the message, believe
  something that did not happen?**
*/

/** Why an output was not sent, and the handle #49 counts it under. */
export interface SendRefusal {
  readonly reason: string
  /** Lower-case, no spaces — `job_impediments.needed` groups on it. */
  readonly needed: string
}

/**
 * The citations that are not addresses.
 *
 * Shape only, and a SHAPE rather than a list. Every handler in `src/handlers`
 * writes `<scheme>:<ref>` — `job:<uuid>`, `google:calendar`,
 * `notebooklm:<id>`, `db:projects` — so the form is the office's own. What
 * this rejects is prose: "the project records", "internal notes", "5 sources".
 * The five fabricated project names in #185 arrived alongside a source count,
 * and a count is the only thing about a citation that cannot be checked.
 *
 * **A list of permitted schemes would be the wrong check**, and the first
 * version of this was one: it refused `db:projects`, which is a perfectly good
 * address, because nobody had thought to write `db` down. A whitelist here
 * fails whenever the office grows a source it did not have, and it fails by
 * refusing to speak — which is the expensive direction. The scheme therefore
 * only has to LOOK like a scheme: lower-case, no spaces, something after the
 * colon.
 *
 * False negatives are expected, for the same reason `claimsToHaveRead` accepts
 * them. A false positive silences a job that was fine.
 */
const SCHEME = /^[a-z][a-z0-9_+.-]*$/

export const unresolvableSources = (sources: readonly string[]): readonly string[] =>
  sources.filter((raw) => {
    const s = String(raw ?? '')
    const at = s.indexOf(':')
    if (at < 1) return true
    return !SCHEME.test(s.slice(0, at)) || s.slice(at + 1).trim() === ''
  })

export const refuseToSend = (m: OutputMetadata): SendRefusal | null => {
  const readClaim = claimsToHaveRead(m.body ?? '')
  if (readClaim !== null && (m.evidence === 'inferred' || m.evidence === 'speculative')) {
    return {
      needed: 'evidence for a claimed read',
      reason:
        `the message says "${readClaim}" while the output records evidence ` +
        `"${m.evidence}", which means nothing was read. The sentence is the half ` +
        'a person believes, so it is not sent (#185).',
    }
  }

  if (m.evidence === 'verified') {
    if (m.sources.length === 0) {
      return {
        needed: 'a source that resolves',
        reason:
          'the output claims verified evidence and cites nothing. Verified means ' +
          'somebody can go and check, and there is nowhere to go (#185).',
      }
    }
    const bad = unresolvableSources(m.sources)
    if (bad.length > 0) {
      return {
        needed: 'a source that resolves',
        reason:
          `the output claims verified evidence and ${bad.length} of its ` +
          `${m.sources.length} citations are not addresses: ${bad
            .map((b) => `"${String(b).slice(0, 40)}"`)
            .join(', ')
            .slice(0, 200)} (#185).`,
      }
    }
  }

  return null
}
