/**
 * Claims of consequence require evidence of consequence.
 *
 * ## The invariant
 *
 *   > The office must never tell a person that an external action happened
 *   > unless durable evidence says it happened.
 *
 * `claimsToHaveSent` was a list of sentences that had been caught. A model
 * writing naturally says "Email sent to Kevin, cc'd your accountant", "Emailed
 * Kevin the report", "I've shared it with Kevin", "The report has been sent":
 * four of seven natural phrasings walked through, and no code in this
 * repository can send an email at all. Adding four more patterns would have
 * produced the same defect one phrasing further out, so this module splits the
 * question in two:
 *
 *   - the DETECTOR decides when a sentence is a CLAIM (a past-tense or
 *     completed statement, in the first person, the passive, or the clipped
 *     "Email sent." form) and what KIND of consequence it claims;
 *   - the EVIDENCE decides whether the claim is TRUE.
 *
 * The detector is allowed to be imperfect because it is the second line of
 * defence; the evidence is what makes a detected claim acceptable. A claim is
 * accepted only when a recorded row of the right kind exists in this job's
 * tree: a `deliveries` row for sent/messaged/posted/notified, an email-send
 * event for emailed (no such path exists, so none is ever found), a document
 * or output for drafted, task and calendar rows for scheduled/booked, the
 * undo ledger and events for deleted/cancelled, an approval event for
 * approved, child jobs for a hand-off to a colleague.
 *
 * ## What is NOT a claim
 *
 * Negations ("I haven't emailed Kevin"), questions ("Shall I send it?"),
 * instructions ("Email Kevin."), conditionals and futures ("I will email Kevin
 * once you approve"), modals ("it should have been sent"), reported speech
 * ("Kevin said he emailed it"), and anything inside quotation marks, because
 * a quotation is somebody else's sentence.
 *
 * ## Unknown is not accused, except where it is false by construction
 *
 * With no evidence object at all, the communication classes (mail, outbound)
 * are treated as unevidenced, exactly as before: an agent answering an
 * instruction has no outbound path, so they cannot be true. Every other class
 * (published, scheduled, removed, approved, drafted) is skipped, because
 * "unknown" is not "false" for things the office genuinely does.
 */

import type { SqlExecutor } from '../db/executor.ts'

/** What kind of consequence a sentence claims. */
export type ClaimClass =
  | 'mail'
  | 'outbound'
  | 'publish'
  | 'schedule'
  | 'remove'
  | 'approve'
  | 'draft'

/**
 * The recorded results in one job's tree. Every count is a number of durable
 * rows, never a number of words.
 */
export interface ConsequenceEvidence {
  /** Email sends recorded as events (tool `gmail.send`). No such path exists today, so this is 0. */
  readonly mailed: number
  /** Deliveries in `sent` state in the tree. */
  readonly delivered: number
  /** Documents the tree published into a connector (they mirror another document). */
  readonly published: number
  /** Task rows and calendar events the tree created. */
  readonly scheduled: number
  /** Deletions and cancellations recorded in the undo ledger or events. */
  readonly removed: number
  /** Approval events recorded in the tree. */
  readonly approved: number
  /** Documents the tree produced (a draft leaves one). */
  readonly drafted: number
  /** Child jobs in the tree: a hand-off to a colleague. */
  readonly handoffs: number
  /** The roster's names, so "sent it over to Marcus" can be told from "sent it to Kevin". */
  readonly colleagues: readonly string[]
  /** Whether the office can send email at all: `tool_permissions.gmail.send` is enabled. */
  readonly canEmail: boolean
}

/** Counts the worker already makes; they only ever widen what is accepted. */
export interface ActedCounts {
  readonly acted?: number | undefined
  readonly tasksChanged?: number | undefined
}

export interface ConsequenceClaim {
  readonly cls: ClaimClass
  /** The sentence fragment that made the claim, for the correction. */
  readonly quote: string
  /** The whole sentence, for evidence checks that need the recipient. */
  readonly sentence: string
}

const plain = (text: string): string =>
  text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ')

/**
 * Sentences, with the things that are not the office's own assertion removed:
 * code fences, block quotes and anything inside double quotes.
 */
export const sentencesOf = (raw: string): string[] => {
  const text = plain(String(raw ?? ''))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/"[^"\n]{2,}"/g, ' ')
  return text
    .split(/(?<=[.!?])\s+|\n+|;\s+|\s+-\s+(?=[A-Z])/)
    .map((s) => s.replace(/^[\s\-*•]+|^\d+[.)]\s+/, '').trim())
    .filter((s) => s !== '')
}

const PREFIX = String.raw`\b(?:I|we)(?:'ve|\s+have|\s+had|'d)?\s+(?:(?:just|already|now|also|then|successfully|both|gone\s+ahead\s+and|went\s+ahead\s+and)\s+)*`
// A recipient other than the person being spoken to.
const RECIPIENT = String.raw`(?=[^.!?]*\b(?:to|with)\s+(?!you\b|me\b|us\b))`
const OBJECT = String.raw`(?:[A-Z][\w'-]*|the|your|it|them|him|her|a|an|my|our|that|this|everyone|all|to|with)`

interface Shape {
  readonly cls: ClaimClass
  readonly re: RegExp
  /** Passive and clipped forms are skipped when they carry an attribution or a past date. */
  readonly impersonal: boolean
}

const clipped = (cls: ClaimClass, verbs: string): Shape => ({
  cls,
  re: new RegExp(`^(?:Done\\W+)?${verbs}\\s+${OBJECT}\\b[^.!?]{0,60}`),
  impersonal: true,
})

const SHAPES: readonly Shape[] = [
  // ---- first person ----
  { cls: 'mail', re: new RegExp(`${PREFIX}e-?mailed\\b[^.!?]{0,60}`, 'i'), impersonal: false },
  {
    cls: 'outbound',
    re: new RegExp(
      `${PREFIX}(?:sent|messaged|texted|slacked|pinged|dm'?d|notified|forwarded|posted|cc'?d|bcc'?d)\\b[^.!?]{0,60}`,
      'i',
    ),
    impersonal: false,
  },
  {
    cls: 'outbound',
    re: new RegExp(`${PREFIX}(?:delivered|shared)\\b${RECIPIENT}[^.!?]{0,60}`, 'i'),
    impersonal: false,
  },
  {
    cls: 'outbound',
    re: new RegExp(
      `${PREFIX}(?:let\\s+[\\w'-]+\\s+know|passed\\s+\\S+\\s+(?:on|along)|looped\\s+\\S+\\s+in)\\b[^.!?]{0,60}`,
      'i',
    ),
    impersonal: false,
  },
  { cls: 'publish', re: new RegExp(`${PREFIX}uploaded\\b[^.!?]{0,60}`, 'i'), impersonal: false },
  {
    cls: 'schedule',
    re: new RegExp(`${PREFIX}(?:booked|scheduled)\\b[^.!?]{0,60}`, 'i'),
    impersonal: false,
  },
  {
    cls: 'remove',
    re: new RegExp(`${PREFIX}(?:deleted|cancell?ed)\\b[^.!?]{0,60}`, 'i'),
    impersonal: false,
  },
  { cls: 'approve', re: new RegExp(`${PREFIX}approved\\b[^.!?]{0,60}`, 'i'), impersonal: false },
  // ---- clipped: "Emailed Kevin the report." / "Sent to Kevin." ----
  // Case-SENSITIVE on purpose: the verb opens the sentence and the object must be
  // a Name or a determiner. With the i flag "Sent items are in the Sent folder"
  // read as a send, because [A-Z] matched "items".
  clipped('mail', 'E-?mailed'),
  clipped('outbound', '(?:Sent|Messaged|Forwarded|Posted|Notified|Pinged|Shared)'),
  clipped('publish', 'Uploaded'),
  clipped('schedule', '(?:Booked|Scheduled)'),
  clipped('remove', '(?:Deleted|Cancell?ed)'),
  clipped('approve', 'Approved'),
  // ---- noun first: "Email sent to Kevin." / "The report has been sent." ----
  {
    cls: 'outbound',
    re: /^(?:Done\W+)?(?:the\s+|your\s+|my\s+|an?\s+)?(?:[\w'-]+\s+){0,2}?(?:e-?mail|message|note|report|invoice|invite|invitation|document|file|reply|notification|update|link|summary|dm|text|draft|memo|proposal|quote|agenda)\s+(?:(?:(?:has|have|had)\s+(?:now\s+|already\s+|just\s+)?been|was|were|is\s+now|now)\s+)?(?:sent|messaged|forwarded|posted|pinged|notified|shared|delivered)\b[^.!?]{0,60}/i,
    impersonal: true,
  },
  // ---- the passive: "has been sent", "was emailed" ----
  {
    cls: 'mail',
    re: /\b(?:(?:has|have|had)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?been|was|were|got)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?e-?mailed\b[^.!?]{0,60}/i,
    impersonal: true,
  },
  {
    cls: 'outbound',
    re: /\b(?:(?:has|have|had)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?been|was|were|got)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?(?:sent|messaged|texted|forwarded|posted|pinged)\b[^.!?]{0,60}/i,
    impersonal: true,
  },
  {
    cls: 'outbound',
    re: new RegExp(
      String.raw`\b(?:(?:has|have|had)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?been|was|were|got)\s+(?:now\s+|already\s+|just\s+|successfully\s+)?(?:shared|delivered)\b${RECIPIENT}[^.!?]{0,60}`,
      'i',
    ),
    impersonal: true,
  },
  {
    // "notified" and "contacted" only mean OUTSIDE when a channel is named; a colleague being notified is a hand-off.
    cls: 'outbound',
    re: /\b(?:(?:has|have|had)\s+been|was|were)\s+notified\b[^.!?]{0,60}?\b(?:on|in|via|over|by)\s+(?:slack|telegram|e-?mail|whatsapp|text)\b/i,
    impersonal: true,
  },
]

/** Words that make a sentence somebody else's, or not an assertion. */
const REPORTING =
  /\b(?:said|says|say|told|tells|wrote|writes|noted|notes|states?|stated|mentions?|mentioned|reports?|reported|claims?|claimed|according\s+to|per|as\s+per|shows?|showed|reads|records?|recorded|indicates?|indicated|confirms?|confirmed|replied|replies|responded|thinks?|thought|believes?|reckons?|suggests?)\b/i
const LEADING_SUBORDINATE =
  /^(?:if|once|when|after|before|unless|until|whenever|because|since|assuming|provided|should|whether)\b/i
const CONDITIONAL_INSIDE = /\b(?:if|unless|whether|in\s+case|so\s+that|in\s+order\s+to)\b/i
const NEGATION =
  /(?:\b(?:not|never|no|nothing|none|neither|nor|without|yet\s+to|unable|failed\s+to)|n't)\b[^.!?]{0,40}$/i
const MODAL =
  /\b(?:should|would|could|might|may|must|ought\s+to|will|shall|can)\s+(?:\w+\s+){0,1}$/i
const NAMED_AGENT = /\bby\s+[A-Z][\w'-]*/
const PAST_DATE =
  /\b(?:on\s+(?:mon|tue|wed|thu|fri|sat|sun)\w*|on\s+\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+|on\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|in\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|last\s+(?:week|month|year|quarter|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|sat\w*|sun\w*)|yesterday|earlier\s+this\s+(?:week|month)|\d{4}-\d{2}-\d{2})\b/i

const DRAFT_FIRST_PERSON = new RegExp(
  `${PREFIX}(?:drafted|written|wrote|composed|prepared|put\\s+together|written\\s+up)\\s+(?:up\\s+)?(?:an?\\s+|the\\s+|that\\s+|your\\s+)?(?:[\\w'-]+\\s+){0,2}?(?:e-?mail|message|note|letter|reply)\\b[^.!?]{0,60}`,
  'i',
)
const DRAFT_NOMINAL =
  /\b(?:a|the|your)\s+draft(?:\s+(?:e-?mail|message|reply|note|letter))?\b[^.!?]{0,60}?\b(?:is|has\s+been|are)\s+(?:now\s+)?(?:ready|saved|attached|prepared|waiting|in\s+(?:your|the)\s+drafts)\b[^.!?]{0,60}/i

const CAPABILITY_EMAIL =
  /\b(?:I|we)(?:\s+(?:can|could|am\s+able\s+to|are\s+able\s+to|will\s+be\s+able\s+to)|'m\s+able\s+to)\s+(?:also\s+|easily\s+|then\s+|just\s+)?(?:e-?mail\b|mail\s+(?:it|them|him|her|that|this|the|a|an)\b|send\s+(?:[\w'-]+\s+){0,3}?(?:by|via|over|through)\s+e-?mail\b|send\s+(?:an?\s+|the\s+|that\s+|this\s+|it\s+)?(?:[\w'-]+\s+){0,1}?e-?mails?\b)[^.!?]{0,60}/i

const stillAClaim = (sentence: string, hit: RegExpExecArray, shape: Shape): boolean => {
  if (/\?\s*$/.test(sentence)) return false
  if (LEADING_SUBORDINATE.test(sentence)) return false
  const before = sentence.slice(0, hit.index)
  if (REPORTING.test(before)) return false
  if (CONDITIONAL_INSIDE.test(before)) return false
  // "Nothing was sent" has its negation in front of the match; "No email has
  // been sent" has it INSIDE the match, as the first word the noun-first shape
  // skipped over.
  if (NEGATION.test(before) || /^(?:no|nothing|none|neither|never)\b/i.test(sentence)) return false
  if (MODAL.test(before.slice(-30))) return false
  if (shape.impersonal && (NAMED_AGENT.test(sentence) || PAST_DATE.test(sentence))) return false
  if (shape.impersonal) {
    // "the documents that were shared with Kevin": a relative clause describes a
    // noun, it does not report an act. "was sent back" is a state of a thing.
    if (/\b(?:that|which|who)\s+$/i.test(before)) return false
    if (/\bsent\s+back\b/i.test(hit[0])) return false
  }
  // "we" is a business speaking about its own dated history ("We sent the
  // proposal in June"); "I" is the office speaking about this turn.
  if (/^we\b/i.test(hit[0]) && PAST_DATE.test(sentence)) return false
  return true
}

/**
 * Every claim of consequence in a text, whatever its evidence. The detector
 * only: it says nothing about whether the claim is true.
 */
export function consequenceClaims(body: string): ConsequenceClaim[] {
  const out: ConsequenceClaim[] = []
  for (const sentence of sentencesOf(body)) {
    for (const shape of SHAPES) {
      const hit = shape.re.exec(sentence)
      if (hit === null || !stillAClaim(sentence, hit, shape)) continue
      // "sent ... email" is mail even when the verb is the generic one.
      const cls: ClaimClass =
        shape.cls === 'outbound' && /\be-?mail(?:ed|s)?\b/i.test(sentence) ? 'mail' : shape.cls
      out.push({ cls, quote: hit[0].trim().slice(0, 80), sentence })
      break
    }
    for (const re of [DRAFT_FIRST_PERSON, DRAFT_NOMINAL]) {
      const hit = re.exec(sentence)
      if (hit === null || /\?\s*$/.test(sentence)) continue
      if (LEADING_SUBORDINATE.test(sentence) || REPORTING.test(sentence.slice(0, hit.index)))
        continue
      if (
        NEGATION.test(sentence.slice(0, hit.index + 20)) ||
        MODAL.test(sentence.slice(0, hit.index).slice(-30))
      )
        continue
      out.push({ cls: 'draft', quote: hit[0].trim().slice(0, 80), sentence })
      break
    }
  }
  return out
}

/**
 * An offer to email, as a statement about what the office CAN do.
 *
 * True when it is said and the office has no email capability: `gmail.send` is
 * switched off and nothing in the repository sends mail. Questions ("Shall I
 * send it?") and denials are not offers.
 */
export function emailCapabilityClaims(body: string): string[] {
  const out: string[] = []
  for (const sentence of sentencesOf(body)) {
    const hit = CAPABILITY_EMAIL.exec(sentence)
    if (hit === null || /\?\s*$/.test(sentence)) continue
    if (NEGATION.test(sentence.slice(0, hit.index))) continue
    out.push(hit[0].trim().slice(0, 80))
  }
  return out
}

const mentionsColleague = (sentence: string, colleagues: readonly string[]): boolean =>
  colleagues.some(
    (c) =>
      c.trim() !== '' &&
      new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sentence),
  )

/**
 * Does the answer itself hold the draft it says it wrote? A draft email that
 * is quoted in the answer exists in the only place a draft can exist when no
 * mail path does.
 */
export const bodyHoldsDraft = (body: string, claimSentence: string): boolean => {
  const text = plain(String(body ?? ''))
  const rest = text.replace(claimSentence, ' ').trim()
  if (rest.length < 40) return false
  return (
    /(?:^|\n)\s*(?:subject|re)\s*:/i.test(text) ||
    /(?:^|\n)\s*(?:dear|hi|hello|hey)\b[^\n]*(?:\n|$)/i.test(text) ||
    (rest.length >= 80 && rest.split(/\n+/).filter((l) => l.trim().length > 20).length >= 2)
  )
}

/**
 * Whether the evidence supports one claim. `null` means the claim is of a kind
 * the office genuinely performs and no evidence was supplied: not accused.
 */
export function isEvidenced(
  claim: ConsequenceClaim,
  body: string,
  ev: ConsequenceEvidence | undefined,
  counts: ActedCounts = {},
): boolean | null {
  switch (claim.cls) {
    case 'mail':
      return ev !== undefined && ev.mailed > 0
    case 'outbound':
      if (ev === undefined) return false
      if (ev.delivered > 0) return true
      return ev.handoffs > 0 && mentionsColleague(claim.sentence, ev.colleagues)
    case 'publish':
      return ev === undefined ? null : ev.published > 0
    case 'schedule':
      return ev === undefined ? null : ev.scheduled > 0 || (counts.acted ?? 0) > 0
    case 'remove':
      return ev === undefined ? null : ev.removed > 0 || (counts.tasksChanged ?? 0) > 0
    case 'approve':
      return ev === undefined ? null : ev.approved > 0
    case 'draft':
      return ev === undefined ? null : ev.drafted > 0 || bodyHoldsDraft(body, claim.sentence)
  }
}

export interface ConsequenceProblem {
  readonly cls: ClaimClass | 'capability'
  readonly quote: string
  readonly problem: string
}

const WHAT: Record<ClaimClass, string> = {
  mail:
    'says an email went out. No email was sent: the office has no way to send email, and nothing in its records shows one. ' +
    'Say plainly that it has NOT been sent and cannot be sent from here, and offer the text as a draft he can send himself.',
  outbound:
    'says something was sent, shared, posted or passed to somebody. Nothing in this job recorded a delivery, so nobody was contacted. ' +
    'Say what you WILL do, or hand the work over, but do not report a message that does not exist.',
  publish:
    'says something was uploaded. No document was published anywhere in this job. Say that it has not been uploaded, or what you would need to do it.',
  schedule:
    'says something was booked or scheduled. No task or calendar row was created in this job. Say that nothing has been scheduled, or ask what he wants created.',
  remove:
    'says something was deleted or cancelled. Nothing was removed and nothing is in the undo record. Say plainly that it is unchanged.',
  approve:
    'says something was approved. No approval was recorded in this job, and the office does not approve on its own. Say that it is still waiting for him.',
  draft:
    'says a draft was written, and no draft exists: no document was made and the answer does not contain the text. Put the draft in the answer, or say none was written.',
}

/**
 * Every claim in the text that its evidence does not support, and every offer
 * of a capability that does not exist.
 */
export function unevidencedClaims(
  body: string,
  ev: ConsequenceEvidence | undefined,
  counts: ActedCounts = {},
  /** Extra comm claims found by a caller's own detector (the legacy patterns). */
  extra: readonly string[] = [],
): ConsequenceProblem[] {
  const out: ConsequenceProblem[] = []
  const seen = new Set<ClaimClass | 'capability'>()
  const claims: ConsequenceClaim[] = [
    ...consequenceClaims(body),
    ...extra.map(
      (quote): ConsequenceClaim => ({
        cls: /\be-?mail/i.test(quote) ? 'mail' : 'outbound',
        quote,
        sentence: quote,
      }),
    ),
  ]
  for (const c of claims) {
    if (isEvidenced(c, body, ev, counts) !== false) continue
    if (seen.has(c.cls)) continue
    seen.add(c.cls)
    out.push({ cls: c.cls, quote: c.quote, problem: `the text ("${c.quote}") ${WHAT[c.cls]}` })
  }
  if (ev !== undefined && !ev.canEmail) {
    const offer = emailCapabilityClaims(body)[0]
    if (offer !== undefined)
      out.push({
        cls: 'capability',
        quote: offer,
        problem:
          `the text offers to email ("${offer}") and the office has no email capability: sending email is switched off and nothing sends it. ` +
          'Say that plainly - it can write the email as a draft, and he would send it himself - rather than offering what cannot be done.',
      })
  }
  return out
}

/**
 * Read the recorded results for one job's whole tree.
 *
 * "The tree" is the root job and everything below it: a hand-off child's
 * delivery is evidence for the parent's synthesis, and a parent's earlier task
 * is evidence for a child's follow-up. This is deliberately the generous
 * reading, because the cheap error is a missed false claim and the expensive
 * one is refusing a true answer.
 */
export async function loadConsequenceEvidence(
  db: SqlExecutor,
  jobId: string,
): Promise<ConsequenceEvidence | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return undefined
  try {
    const r = await db.execute(`
      with recursive up as (
        select job_id, parent_job_id from public.jobs where job_id = '${jobId}'::uuid
        union all
        select j.job_id, j.parent_job_id from public.jobs j join up on j.job_id = up.parent_job_id),
      root as (select job_id from up where parent_job_id is null limit 1),
      tree as (
        select job_id from root
        union all
        select j.job_id from public.jobs j join tree t on j.parent_job_id = t.job_id)
      select
        (select count(*) from public.events e where e.related_job_id in (select job_id from tree)
            and e.tool_used = 'gmail.send')::int as mailed,
        (select count(*) from public.deliveries d where d.job_id in (select job_id from tree)
            and d.state = 'sent')::int as delivered,
        (select count(*) from public.documents d where d.produced_by_job in (select job_id from tree)
            and d.mirrors_document_id is not null)::int as published,
        ((select count(*) from public.tasks t where t.job_id in (select job_id from tree))
         + (select count(*) from public.events e where e.related_job_id in (select job_id from tree)
              and e.action_type ~* 'calendar'))::int as scheduled,
        ((select count(*) from public.undoable_actions u where u.job_id in (select job_id from tree))
         + (select count(*) from public.events e where e.related_job_id in (select job_id from tree)
              and e.action_type ~* '(delete|cancel|remove)'))::int as removed,
        (select count(*) from public.events e where e.related_job_id in (select job_id from tree)
            and e.action_type ~* 'approv')::int as approved,
        (select count(*) from public.documents d where d.produced_by_job in (select job_id from tree))::int as drafted,
        greatest((select count(*) from tree) - 1, 0)::int as handoffs,
        coalesce((select array_agg(s.name) from public.staff s where s.active), '{}'::text[]) as colleagues,
        coalesce((select bool_or(tp.enabled) from public.tool_permissions tp where tp.tool = 'gmail.send'), false) as can_email`)
    const row = r.rows[0] as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    const n = (k: string): number => Number(row[k] ?? 0)
    const names = row.colleagues
    return {
      mailed: n('mailed'),
      delivered: n('delivered'),
      published: n('published'),
      scheduled: n('scheduled'),
      removed: n('removed'),
      approved: n('approved'),
      drafted: n('drafted'),
      handoffs: n('handoffs'),
      colleagues: Array.isArray(names) ? names.map(String) : [],
      canEmail: row.can_email === true,
    }
  } catch {
    // Not being able to look is not evidence either way: the caller falls back to
    // the strict reading for the communication classes and skips the rest.
    return undefined
  }
}
