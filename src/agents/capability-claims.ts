/**
 * Does this answer tell Grant the office cannot do something it can? (#320)
 *
 * ## The invariant
 *
 *   > *"The office must not tell Grant that it cannot perform a capability
 *   > that the currently deployed system can actually perform for him in that
 *   > context."*
 *
 * `contradictsReality` in `capability.ts` has asked half of this since #64 —
 * for CONNECTORS, whose names are in `reach`. It cannot see a capability,
 * because a capability is a row in `tool_permissions` and that row was never
 * consulted. So "I can't post to Slack" was caught and "I can't create a PDF"
 * was not, though the office had made 139 of them.
 *
 * ## Why this is not a phrase list
 *
 * The obvious fix is to add "create a PDF" to a list of sentences. That is a
 * list which is wrong the day a capability is added, and CLAUDE.md records the
 * cost of an enumeration four separate times: *"prefer a property over an
 * enumeration wherever the enumeration is of things a future change will add
 * to."*
 *
 * So the words come out of the registry. `tool_permissions.description` is one
 * crisp sentence per capability, written for a person, editable by Grant
 * without a deploy — exactly the column 0368 added so a capability could
 * describe its own shape. The terms that identify a capability in a sentence
 * are its distinctive words, and DISTINCTIVE IS DERIVED: a word appearing in
 * more than one capability's text identifies none of them and drops out by
 * itself. Nothing here lists a capability, a service or a phrase.
 *
 * ## Four states, which must not collapse
 *
 * "I can't" covers four completely different facts and Grant can act on only
 * three of them:
 *
 *   `cannot`          — genuinely switched off for everyone. True; say it.
 *   `needs_something` — held, but this turn lacks information or approval.
 *   `attempt_failed`  — held, tried, and this attempt did not work.
 *   `false_denial`    — held, available, and the answer says otherwise.
 *
 * Only the last is a defect. The other three are reported too, because a gate
 * that returns a bare boolean teaches the reader nothing and CLAUDE.md records
 * what a report line that states an impossibility costs.
 *
 * ## And the other direction
 *
 * `false_offer` is the mirror: the answer offers a capability that is switched
 * off for everyone. Deliberately narrower than the denial side, because the
 * existing gates already cover the expensive half — `claimsToHaveMade` and
 * `claimsToHaveSent` check a claim to have DONE something against canonical
 * evidence that it happened. What neither can see is an offer to do something
 * in future that nothing could ever perform.
 */

import type { Capability } from './capability.ts'

/** What the checker decided about one capability mentioned in one answer. */
export interface CapabilityVerdict {
  readonly verdict: 'cannot' | 'needs_something' | 'attempt_failed' | 'false_denial' | 'false_offer'
  /** The capability the sentence is about. */
  readonly tool: string
  /** What it does, in the registry's own words, for a correction Grant reads. */
  readonly what: string
  /** The word that identified it, so a finding can be argued with. */
  readonly term: string
  /** The clause it was found in, for the report. */
  readonly quote: string
}

/**
 * Words that carry no capability on their own.
 *
 * NOT a list of capabilities — a list of ordinary English and office
 * furniture. It removes noise; it never decides what the office can do, and
 * adding a capability tomorrow needs no edit here. The derived-frequency rule
 * below does the actual identifying work, and this only stops a word like
 * "office" surviving because it happens to appear in one description.
 */
const NOT_A_SUBJECT = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'from',
  'with',
  'it',
  'its',
  'that',
  'this',
  'what',
  'who',
  'any',
  'has',
  'have',
  'is',
  'are',
  'be',
  'been',
  'can',
  'may',
  'will',
  'would',
  'should',
  'do',
  'does',
  'did',
  'grant',
  'office',
  'team',
  'you',
  'your',
  'he',
  'him',
  'his',
  'they',
  'them',
  'one',
  'something',
  'anything',
  'thing',
  'things',
  'stuff',
  'work',
  'works',
  'own',
  'new',
  'other',
  'into',
  'out',
  'up',
  'down',
  'about',
  'before',
  'after',
  'named',
  'asked',
  'says',
  'said',
  'change',
  'changed',
  'set',
  'get',
  'put',
  'which',
  'where',
  'when',
  'how',
  'why',
  'more',
  'less',
  'much',
  'many',
  'some',
  // Office furniture, added after measuring against 1292 real answers. Each of
  // these named a capability only because it happened to appear in one
  // description, and each produced a false finding: "I can pull the data",
  // "a relational database", "holding a voice conversation".
  'data',
  'database',
  'application',
  'dashboard',
  'conversation',
  'such',
  'unless',
  'there',
  'here',
  'back',
  'over',
  'through',
  'whatever',
  'anybody',
  'anyone',
  'make',
  'made',
  'take',
  'read',
  'write',
  'send',
  'sent',
  'create',
  'creates',
  'produce',
  'deliver',
  'open',
  'project',
  'projects',
  'channel',
  'channels',
  'record',
  'records',
  'kind',
  'never',
  'only',
  'now',
  'not',
  'no',
  'all',
])

/**
 * The first sentence of a description, and only that.
 *
 * `capabilityBrief` already does this to `disabled_reason` (`firstClause`) for
 * the same reason in the other direction: the column serves a page AND a
 * prompt, so some rows are one clause and some are a paragraph. `task.create`
 * is 0368's shape-describing instruction -- "It needs a TITLE and nothing else
 * ... and there is no such thing as a parent task" -- which contributed
 * "there", "conversation" and "such" as capability terms and produced three
 * false findings in the calibration run. The opening clause is the part that
 * NAMES the capability; the rest tells an agent how to use it.
 */
const firstSentence = (s: string): string => {
  const stop = s.search(/[.;:]\s/)
  return stop === -1 ? s : s.slice(0, stop)
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !NOT_A_SUBJECT.has(w))

/**
 * Every capability, with the words that might name it and the state it is in.
 *
 * `can` is split by `inReply` because 0508 made that distinction load-bearing:
 * a capability the office performs on its own schedule is one the answering
 * colleague genuinely cannot perform now, so denying it is TRUE and must not
 * be reported.
 */
type State = 'held' | 'scheduled' | 'askable' | 'off' | 'unreachable'

interface Known {
  readonly tool: string
  readonly what: string
  readonly state: State
  readonly terms: readonly string[]
}

function inventory(cap: Capability): readonly Known[] {
  const entries: Known[] = []
  const add = (tool: string, what: string, _verbs: readonly string[], state: State): void => {
    entries.push({
      tool,
      what: firstSentence(what),
      state,
      /*
        The NAME and the one-sentence description, and deliberately NOT the
        verbs.

        Measured: with the verbs in, the checker fired on 40 of 1292 real
        delivered answers and almost every one was wrong. `tool_permissions.verbs`
        is prose about how a capability is used, so it contributes ordinary
        English -- "pull", "back", "answer", "there" -- and "I'll pull it in"
        became a false offer of `github.write` eight separate times. CLAUDE.md
        is unambiguous about which way this fails: a check that fires wrongly
        is one somebody switches off.

        The cost is real and is the cheap direction: "mailbox" lives only in
        `gmail.search`'s verbs, so "I can't read your mailbox" is no longer
        seen. A missed denial is one bad answer; a false one is every good
        answer that mentions a document.
      */
      terms: [...new Set([...words(tool.replace(/[._]/g, ' ')), ...words(firstSentence(what))])],
    })
  }
  /*
    A grant is not a capability while the service behind it is down -- 0508's
    question asked of the world rather than of the roster.

    `slack.post` is enabled and granted to all eight, and Slack's connector is
    `token_expired` right now, so "the Slack refresh token is missing, the
    configuration tokens cannot be renewed" is TRUE. The first version of this
    checker called that a lie twelve times in the calibration run. It is the
    state the invariant calls "capability temporarily unavailable", and it was
    already in canonical state: `reach` carries it and nothing was asking.

    Matched by the service's own words against the tool's, so nothing here
    names a service. "Slack" meets `slack.post`; a connector no tool is named
    after simply never matches.
  */
  const down = cap.reach.filter((r) => !r.reachable).flatMap((r) => words(r.service))
  const unreachable = (tool: string): boolean =>
    words(tool.replace(/[._]/g, ' ')).some((w) => down.includes(w))
  for (const a of cap.can)
    add(
      a.tool,
      a.what,
      a.verbs,
      unreachable(a.tool) ? 'unreachable' : a.inReply ? 'held' : 'scheduled',
    )
  for (const a of cap.mustAsk) add(a.tool, a.what, [], 'askable')
  for (const a of cap.cannot) add(a.tool, a.what, a.verbs, 'off')
  return entries
}

/**
 * A word identifies a capability only when every capability using it AGREES
 * about what the office can do.
 *
 * The first version asked for a word used by exactly ONE capability, and that
 * was too strict in the direction that matters. `gmail.read` and
 * `gmail.search` are two rows about one subject, so "mailbox" appeared twice
 * and dropped out — and "I can't read your mailbox" went unchecked though both
 * rows are held. Measured against the real registry it lost the mailbox, the
 * diary and the notebook, which is most of what Grant asks about.
 *
 * Agreement is the property the check actually needs: if every capability a
 * word touches is HELD, a denial of that word is false whichever row the
 * sentence meant. Where they disagree the word is genuinely ambiguous — "web"
 * covers `web.read` (on) and `web.search` (off) — and is dropped, which is the
 * cheap direction.
 */
function distinctive(all: readonly Known[]): ReadonlyMap<string, Known> {
  /*
    Agreement is asked of the COARSE fact, not of the row.

    `held` and `askable` are two rows saying the same thing about the office —
    it can do this — and differing only about whether this colleague holds the
    grant. A denial is wrong under both; only the correction differs ("I can"
    versus "I need to ask"). Asking for agreement at row level lost `document`,
    because `document.create` is held and `task.extract` is askable, and that
    is the commonest word Grant uses for the thing #320 is about.

    `off` and `scheduled` are genuinely different facts and keep their own
    groups, so a word covering an on and an off capability — "web", across
    `web.read` and `web.search` — is still dropped.
  */
  const group = (k: Known): string => (k.state === 'askable' ? 'held' : k.state)
  const groups = new Map<string, Set<string>>()
  for (const k of all) {
    for (const w of k.terms) {
      const at = groups.get(w) ?? new Set<string>()
      at.add(group(k))
      groups.set(w, at)
    }
  }
  const index = new Map<string, Known>()
  for (const k of all) {
    for (const t of k.terms) {
      if (groups.get(t)?.size !== 1) continue
      const held = index.get(t)
      // Where two rows share a word, the more conservative one wins: reporting
      // "you need to ask for this" about a capability that is in fact held is
      // a smaller error than the reverse, and CLAUDE.md is clear which
      // direction a guard should fail in.
      if (held === undefined || (held.state === 'held' && k.state === 'askable')) index.set(t, k)
    }
  }
  return index
}

/** The words that can identify a capability, and which one. For tests. */
export function capabilityTerms(cap: Capability): ReadonlyMap<string, string> {
  return new Map([...distinctive(inventory(cap))].map(([w, k]) => [w, k.tool]))
}

/**
 * Whose inability is this?
 *
 * A capability claim is about the SPEAKER. The calibration run reported
 * *"if the bought solutions can't actually reach your Notion and Notebook"* as
 * a denial of `notion.write` -- a sentence about software Grant might buy,
 * with a third-person subject. Requiring the office to be the subject costs
 * the impersonal phrasings ("it is not possible to...") and that is the cheap
 * direction, as ever.
 */
const OURS = /\b(?:I|we|the office|the team)\b[^.!?]{0,30}$/i

/** Saying you cannot. Generic — it names no capability and no service. */
const DENIES =
  /\b(?:can(?:'|’)?t|cannot|can not|unable to|not able to|don(?:'|’)?t have|do not have|no way to|not something (?:I|we) can|beyond (?:me|us|what (?:I|we) can))\b/i

/** Offering to. Also generic. */
const OFFERS = /\b(?:I can|I(?:'|’)?ll|I will|I am able to|I(?:'|’)?m able to|happy to|shall I)\b/i

/*
  A statement about what the records CONTAIN, which is not a statement about
  what the office CAN DO.

  "I don't have any record of audio files in the Legacy Coaching Course" is
  true, useful, and exactly the sentence `contradictsReality` has always been
  careful to allow -- its own comment says so: *"not on 'I could not find
  anything in Notion', which is a true and useful sentence about a search."*
  Dropping that care cost eleven false findings in the calibration run.

  The shape is possession or record of a SUBJECT, not inability to act.
*/
const ABOUT_CONTENT =
  /\b(?:(?:do(?:n(?:'|\u2019)?t| not)|have not|haven(?:'|\u2019)?t)\s+(?:have|got|see|find|hold)(?!\s+(?:the\s+)?(?:means|ability|abilities|capability|tools?|way|access))|no\s+(?:record|entry|sign|trace|mention)|nothing\s+(?:on|about|in)|can(?:'|\u2019)?t\s+(?:see|find|locate)|could not find)\b/i

/*
  "I can't confirm", "I can't tell you", "I can't say" -- a limit of
  KNOWLEDGE, not of capability.

  The calibration run's one clear false positive was a paragraph about
  Monday.com: *"the specific things you're asking about -- holding a voice
  conversation, reading a private Notion or NotebookLM corpus -- I can't
  confirm any of that is shipped as of now."* The office is describing
  somebody else's product, and the word `Notion` in the sentence made it look
  like a denial of `notion.write`.

  Epistemic denials are also the honest answer this repository works hardest to
  protect: "I do not know" must never be discouraged by a gate.
*/
const EPISTEMIC_DENIAL =
  /\b(?:can(?:'|’)?t|cannot|can not|unable to|not able to)\s+(?:really\s+|fully\s+|yet\s+)?(?:confirm|tell|say|know|be sure|verify|vouch|speak to|comment)\b/i

/** Held, but this turn is short of something. Not a defect. */
const NEEDS_SOMETHING =
  /\b(?:without|unless|until|once you|if you|need(?:s)? (?:to know|the|a|an|more)|which (?:project|one|notebook|document)|not sure which|tell me which|approval|approve|permission|go[- ]ahead|sign[- ]?off|waiting (?:on|for) you)\b/i

/** Held, tried, and it did not work. Also not a defect. */
const ATTEMPT_FAILED =
  /\b(?:tried|attempted|failed|went wrong|error|timed out|did not work|didn(?:'|’)?t work|could not complete|came back empty|\d+ times|in the last (?:day|week|fortnight|month)|so far)\b/i

/**
 * Every capability claim in an answer, with what the registry says about it.
 *
 * The clause is the unit, not the message: CLAUDE.md records that a
 * whole-message match has exactly one winner, and an answer that denies one
 * thing while offering another is ordinary.
 */
export function capabilityClaims(reply: string, cap: Capability): readonly CapabilityVerdict[] {
  const text = String(reply ?? '')
  if (text.trim() === '') return []
  const index = distinctive(inventory(cap))
  if (index.size === 0) return []

  const out: CapabilityVerdict[] = []
  const seen = new Set<string>()
  /*
    A contrast conjunction starts a new clause, and leaving it out was a live
    false positive: "I can't create a PDF, but I'll build a Notion page"
    reported `notion.write` as denied, because the denial at the front of the
    sentence covered a word in the OFFER at the back. CLAUDE.md's rule about
    a clause being what has a subject, one punctuation mark further down.
  */
  for (const clause of text.split(
    /(?<=[.!?\n])|\s*(?:,\s*)?\b(?:but|however|though|although|whereas|instead|so)\b/i,
  )) {
    const at = DENIES.exec(clause)
    const denies =
      at !== null &&
      // The subject is usually in front of the modal ("I can't"), and in the
      // modal-free forms it is inside the phrase itself ("not something I can
      // do"). Either counts; a third-person subject in front of neither does
      // not.
      (OURS.test(clause.slice(0, at.index)) || /\b(?:I|we)\b/i.test(at[0])) &&
      !ABOUT_CONTENT.test(clause) &&
      !EPISTEMIC_DENIAL.test(clause)
    const offers = !denies && OFFERS.test(clause)
    if (!denies && !offers) continue
    /*
      One capability per clause, preferring a term that is part of the tool's
      own name.

      "I can't open the project or create a Notion page" matched `notion.write`
      on "notion" AND `web.read` on "page", and reported the same sentence
      twice under two tools. Both are held so the verdict was identical, but a
      finding that names the wrong capability is one somebody argues with.
      A word in the tool's own name is the stronger identification.
    */
    /*
      An OFFER's object FOLLOWS the offer.

      "If you can point me to the email, meeting note or document, I'll pull the wording" mentions email before the offer
      and offers to pull wording; it offers nothing about sending. A real model produced exactly that in 2 of 9 answers
      in the first controlled real-model run, and the scripted proofs never could, because they say what their author
      expected. A denial keeps the whole clause (its subject is in front, its object may be anywhere); an offer is read
      from the offer onward. Missing "send the email, I can do that" is the cheap direction: one missed false claim,
      against a correction note on every good answer that merely names a mailbox.
    */
    const offerAt = denies ? null : OFFERS.exec(clause)
    const scope = offerAt === null ? clause : clause.slice(offerAt.index)
    const hits = [...new Set(words(scope))]
      .map((w) => ({ w, known: index.get(w) }))
      .filter((h): h is { w: string; known: Known } => h.known !== undefined)
      .sort((a, b) => {
        const named = (h: { w: string; known: Known }): number =>
          h.known.tool.replace(/[._]/g, ' ').split(' ').includes(h.w) ? 0 : 1
        return named(a) - named(b)
      })
      .slice(0, 1)
    for (const { w, known } of hits) {
      const key = `${known.tool}:${denies ? 'd' : 'o'}`
      if (seen.has(key)) continue
      const quote = clause.trim().slice(0, 160)
      if (denies) {
        const verdict =
          known.state === 'off' || known.state === 'scheduled' || known.state === 'unreachable'
            ? 'cannot'
            : ATTEMPT_FAILED.test(clause)
              ? 'attempt_failed'
              : NEEDS_SOMETHING.test(clause) || known.state === 'askable'
                ? 'needs_something'
                : 'false_denial'
        seen.add(key)
        out.push({ verdict, tool: known.tool, what: known.what, term: w, quote })
      } else if (known.state === 'off') {
        seen.add(key)
        out.push({ verdict: 'false_offer', tool: known.tool, what: known.what, term: w, quote })
      }
    }
  }
  return out
}

/** Just the defects, for a gate that wants a yes or no. */
export function capabilityLies(reply: string, cap: Capability): readonly CapabilityVerdict[] {
  return capabilityClaims(reply, cap).filter(
    (v) => v.verdict === 'false_denial' || v.verdict === 'false_offer',
  )
}
