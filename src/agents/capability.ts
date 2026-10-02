/**
 * What the team can actually reach, as a fact rather than a feeling.
 *
 * ## The message that caused this
 *
 * Grant asked the Chief of Staff, in Slack, to populate a Notion teamspace from
 * a notebook. She replied:
 *
 *     "I can't post to Slack or pull data from your Notion teamspace. I don't
 *      have integration access and I can't see the notebook you mention."
 *
 * Three claims, all false. She was posting in Slack as she said it. The Notion
 * token works — `verify:notion` passes twelve checks against the live
 * workspace. And the notebook had been read successfully twenty minutes
 * earlier.
 *
 * ## Why it happened, which is not "the model lied"
 *
 * Retrieval found nothing, because the job had been filed against the wrong
 * project (0162 fixes that half). The prompt has a deliberate, good rule for
 * that case: *"If the message names something specific we do not hold, say you
 * cannot see it and ask where it is."* It exists because an earlier version
 * answered a question about a notebook we held nothing on with four plausible
 * paragraphs about mindfulness.
 *
 * So she was told to say she could not see the notebook — and generalised from
 * "we hold nothing about this" to "I have no integration access". Those are
 * completely different claims. The first is about our records and is hers to
 * report. The second is about the system's wiring, and the system knows the
 * answer for certain.
 *
 * §11 says *"'free' means measured, not assumed"* about quotas. The same rule
 * belongs on capability: what a colleague says she can reach should come from
 * the registry that knows, not from the middle of a sentence.
 *
 * ## Two halves
 *
 * `capabilityBrief` puts the truth in front of the model. `contradictsReality`
 * catches it saying otherwise anyway — the same shape as the numeric guard in
 * `src/text/voice.ts`, and for the same reason: on a free model, an instruction
 * not to invent is followed most of the time.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { officeOf, type RetrievalOffice } from '../knowledge/office.ts'
import { currentPerson } from '../office/person.ts'

export interface Reach {
  /** How a person would name it: "Notion", "Slack", "Google NotebookLM". */
  readonly service: string
  /** True when the connector is enabled AND its service is not failing. */
  readonly reachable: boolean
  /** Why not, when not. */
  readonly detail: string | null
}

/** One tool, and what it can be made to do. */
export interface Able {
  readonly tool: string
  readonly what: string
  readonly verbs: readonly string[]
  /**
   * Can the colleague WRITING THIS ANSWER cause it to happen now? (0508)
   *
   * Required rather than optional, and deliberately. CLAUDE.md records what an
   * optional field on a row shape costs: a branch that never sets it compiles
   * green and dies four attempts deep in production. Every construction site
   * has to say which of the two this is, because the two are not the same
   * claim and the brief prints them in different sentences.
   *
   * Meaningless for `mustAsk` and `cannot`, where the answer is "neither" —
   * those lists say the tool is not this person's to use at all, and the brief
   * never reaches a verb for them.
   */
  readonly inReply: boolean
}

/** What has been asked for and refused, so it is not asked for again. */
export interface Refused {
  readonly tool: string
  readonly why: string | null
}

/**
 * Everything this office can do right now, for this person.
 *
 * One query, answered by `app.capability_index` (0277-0279), which reads
 * `tool_permissions`, `staff_tools`, `knowledge_connectors`, `connection_health`
 * and `tool_requests` on every call and stores nothing.
 *
 * **In SQL rather than here, and that is the change #148 asked for.** This file
 * used to hold `verbsNow()` — a hand-written list covering three of the
 * twenty-one tools, which meant eighteen of them had no verb at all and an
 * agent asked about one answered from what a language model is rather than from
 * what this office is. That is exactly how #64 happened. The verbs are now a
 * column, so the office can correct one without a deploy.
 *
 * Four answers rather than one, because they need different replies:
 *
 *   `can`      — enabled, and this person holds the grant
 *   `mustAsk`  — enabled, and they do not. ADR-0018: ask, never assume
 *   `cannot`   — off for everyone, with the reason, so #49 can be specific
 *   `declined` — already refused. Asking again is how a boundary becomes a nag
 */
export interface Capability {
  readonly reach: readonly Reach[]
  readonly can: readonly Able[]
  readonly mustAsk: readonly Able[]
  readonly cannot: readonly (Able & { readonly why: string })[]
  readonly declined: readonly Refused[]
}

/**
 * A capability of nothing.
 *
 * Exported because a caller that is confirming a say-back rather than answering
 * a question does not need the index and should not pay for the query — and
 * `[]` no longer type-checks now that a capability is five lists rather than
 * one.
 */
export const EMPTY_CAPABILITY: Capability = {
  reach: [],
  can: [],
  mustAsk: [],
  cannot: [],
  declined: [],
}

export async function capabilityNow(
  db: SqlExecutor,
  office: RetrievalOffice,
  staffSlug?: string,
): Promise<Capability> {
  const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
  // The reach is the OFFICE'S OWN credentials and grants (connection_health, staff_tools), never the deployment's.
  const { rows } = await db.execute(
    `select app.capability_index(${officeOf(office)}, ${staffSlug === undefined ? 'null' : lit(staffSlug)}) as i`,
  )
  const i = (rows[0] as { i?: Record<string, unknown> } | undefined)?.i
  if (i === undefined) return EMPTY_CAPABILITY

  const able = (v: unknown): Able[] =>
    (Array.isArray(v) ? v : []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        tool: String(row.tool ?? ''),
        what: String(row.what ?? ''),
        verbs: Array.isArray(row.verbs) ? row.verbs.map((x) => String(x)) : [],
        /*
          Absent reads as FALSE, which is the same asymmetry 0508's column
          default is built on: a tool wrongly called unavailable produces a
          weaker sentence, and one wrongly called available produces a
          fabricated claim. `must_ask` and `cannot` never carry the key.
        */
        inReply: row.in_reply === true,
      }
    })

  return {
    reach: (Array.isArray(i.reach) ? i.reach : []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        service: String(row.service ?? ''),
        reachable: row.reachable === true,
        detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
      }
    }),
    can: able(i.can),
    mustAsk: able(i.must_ask),
    cannot: able(i.cannot).map((a, n) => ({
      ...a,
      why: String(
        ((Array.isArray(i.cannot) ? i.cannot : [])[n] as Record<string, unknown> | undefined)
          ?.why ?? 'switched off',
      ),
    })),
    declined: (Array.isArray(i.declined) ? i.declined : []).map((r) => {
      const row = r as Record<string, unknown>
      return {
        tool: String(row.tool ?? ''),
        why: row.why === null || row.why === undefined ? null : String(row.why),
      }
    }),
  }
}

/**
 * The paragraph that goes in front of the model.
 *
 * Deliberately blunt about the distinction, because the distinction is the
 * whole bug: not holding a document is a fact about our records, and not
 * reaching a service is a fact about our wiring, and only one of them is hers
 * to report.
 */
/**
 * Every tool identifier this capability knows about, whatever its state.
 *
 * `deliberationLeak` needs the machinery half of its co-occurrence rule, and
 * the honest source for it is the same rows the brief is built from —
 * including the disabled and must-ask ones, because a model narrating a call
 * to something switched off is exactly as wrong as one narrating a call to
 * something switched on.
 */
export function toolNames(cap: Capability): readonly string[] {
  return [...cap.can, ...cap.mustAsk, ...cap.cannot].map((a) => a.tool)
}

/**
 * The first clause of a registry reason, for the prompt.
 *
 * Cut at the first sentence end and then hard-capped, because two of the nine
 * disabled reasons have no full stop until well past two hundred characters.
 * An ellipsis rather than a clean cut, so nobody reads a truncated clause as
 * the whole rule.
 */
function firstClause(why: string | null, cap = 56): string {
  const text = (why ?? 'off').trim()
  const stop = text.search(/[.;]\s/)
  const head = stop === -1 ? text : text.slice(0, stop)
  return head.length <= cap ? head : `${head.slice(0, cap - 1).trimEnd()}…`
}

export function capabilityBrief(cap: Capability): string {
  if (cap.reach.length === 0 && cap.can.length === 0) return ''
  const can = cap.reach.filter((r) => r.reachable).map((r) => r.service)
  const cannotReach = cap.reach.filter((r) => !r.reachable)

  /*
    The verbs, from the registry. Capped at four per tool and only for tools
    that have them, because this paragraph goes into every prompt and a
    twenty-one-item catalogue would push the actual question out of the model's
    attention. The tools with no verbs recorded still appear by name and
    description below, which is more than the eighteen of them had before.
  */
  /*
    Split by WHEN, before anything is worded (0508).

    The sentence a few lines down tells the agent to use a verb rather than
    offer to prepare something -- which is right, and which made an unqualified
    verb list actively dangerous. `calendar.write`'s verbs were true of the
    office and false of the person answering: the only thing that writes the
    diary is an hourly duty, and a conversation cannot start it. So the office
    replied "I've added a calendar event on Tuesday 20 Sept, 8 am-12 pm",
    four times, and the coherence gate refused all four. Grant asked for
    something and received nothing.
  */
  const now = cap.can.filter((a) => a.inReply)
  const onTheClock = cap.can.filter((a) => !a.inReply)
  const verbs = now
    .filter((a) => a.verbs.length > 0)
    .map((a) => `${a.tool} — you can ${a.verbs.slice(0, 4).join(', ')}.`)
  const plain = now.filter((a) => a.verbs.length === 0).map((a) => a.tool)

  return (
    'What this team can reach right now, as a matter of fact: ' +
    (can.length === 0 ? 'nothing' : can.join(', ')) +
    '. ' +
    (cannotReach.length === 0
      ? ''
      : `Not reachable: ${cannotReach.map((r) => `${r.service} (${String(r.detail ?? 'unavailable')})`).join(', ')}. `) +
    (verbs.length === 0 ? '' : `${verbs.join(' ')} `) +
    (plain.length === 0 ? '' : `You also hold: ${plain.join(', ')}. `) +
    /*
      What the office does on a schedule, which is not what you can do now.

      Named rather than hidden, for ADR-0018's reason: an agent that does not
      know a capability exists cannot tell Grant how to reach it. The
      actionable half is in the sentence — give a task a date and the sync
      picks it up — so this reads as a route rather than a refusal.
    */
    (onTheClock.length === 0
      ? ''
      : `The office also does these, but on its own schedule and never inside a reply: ${onTheClock
          .map((a) => a.tool)
          .join(', ')}. You cannot perform one now, so do not say you have. ` +
        'Say what would make it happen — a dated task reaches the diary on the ' +
        'next sync — or ask for what you need. ') +
    /*
      What this person may NOT do, which is as load-bearing as what they may.

      An agent that does not know a tool exists cannot ask for it, and ADR-0018
      makes asking the correct move — so "must ask" and "nobody may" are stated
      apart. Before this the brief said neither, and an agent hitting a boundary
      had nothing to propose (#49).
    */
    (cap.mustAsk.length === 0
      ? ''
      : `The office can ${cap.mustAsk.map((a) => a.tool).join(', ')} but you do not hold ` +
        'those — ask for one rather than saying it is impossible. ') +
    /*
      Switched off for everyone — the NAMES, and a clause, never the essay.

      `tool_permissions.disabled_reason` is written for a person reading the
      registry: `web.search`'s runs to 398 characters and recites 0298's whole
      argument. Nine of them came to 2,027 characters, which was 39% of a brief
      that goes in front of EVERY answer and had grown to 5,183 against a
      ceiling of 4,000 this suite has asserted all along.

      What the agent needs from this sentence is that the tool is off and
      roughly why, so that it does not claim the capability (#64) and does not
      ask for something nobody may have. The full reason is Grant's, on the
      Governance page, and is still returned by `capabilityNow` for anything
      that wants it.
    */
    (cap.cannot.length === 0
      ? ''
      : `Switched off for everyone: ${cap.cannot
          .map((a) => `${a.tool} (${firstClause(a.why)})`)
          .join('; ')}. `) +
    (cap.declined.length === 0
      ? ''
      : `Already asked for and refused, so do not ask again: ${cap.declined
          .map((d) => `${d.tool}${d.why === null ? '' : ` (${d.why})`}`)
          .join(', ')}. `) +
    'Never claim you cannot reach one of the reachable services, and never say ' +
    'you lack access or an integration for one. If our records hold nothing ' +
    'about the thing being asked about, say THAT — "I have nothing on it here" ' +
    'is true and useful; "I do not have access to Notion" is a different claim ' +
    'and it is not yours to make. ' +
    // The specific sentence Grant objected to, forbidden by name.
    'And do not offer to produce something "ready for you to add" when you can ' +
    'add it yourself — if a verb above covers it, use it. ' +
    noCallChannel() +
    channelTruths()
  )
}

/**
 * What the office does for you, whether or not you hold a tool.
 *
 * Issue #64. Claire told Grant *"I cannot add interactive Telegram buttons; I
 * only generate plain text"*, which was false when she said it: §12's six
 * buttons had been built for months and the pager was rendering them. He then
 * asked me to add a feature that already existed.
 *
 * `reachNow` covers connectors and `verbsNow` covers tools, and a button is
 * neither — it is a property of the delivery layer. So an agent asked about it
 * had nothing to consult and answered from what a LANGUAGE MODEL is: a text
 * generator. Right about the model, wrong about the system it is part of.
 *
 * These are stated as facts rather than grants precisely because the agent does
 * not do them. `TelegramTransport` attaches the buttons; she does not have to
 * act, which is exactly why she did not know she could.
 */
/**
 * There is no call channel, and the catalogue above does not imply one.
 *
 * ## The measurement that made this necessary
 *
 * The brief lists dotted identifiers -- `task.create`, `db.read`,
 * `notebook.read` -- and tells the reader to use them. The office has no
 * tool-calling protocol: it sends prose and reads prose back. A model trained
 * to call tools, handed a catalogue and given no way to call anything, does the
 * only thing left and narrates the call.
 *
 * Probed three times on one tool-shaped turn, 2026-09-15, gpt-oss-120b returned
 * one "We will call task.create." and two raw JSON objects. None of the three
 * was an answer, and all three would have gone to Grant as written.
 *
 * It is not specific to that model and it is not new -- four outputs from the
 * free-model months contain the same thing, including
 * `{"tool": "notebook.read", "question": …}` sent to him whole. It is simply
 * far commoner on a model that is good at tool use, which is precisely the
 * model this office now runs on.
 *
 * So the catalogue is given a sentence saying what it is FOR. The deterministic
 * half of the fix is `deliberationLeak` in `src/agents/quality.ts`; this is the
 * half that stops the model wanting to do it.
 */
// Functions, not constants: they name the person the running job is for (#404), which is known only when a job runs.
const noCallChannel = (): string =>
  'One thing about the list above, because it is easy to misread: those are ' +
  'things the OFFICE does on the strength of what you write, not functions you ' +
  'can call. There is no call syntax here and no tool channel — your reply goes ' +
  `to ${currentPerson().name} exactly as you type it. So never write a tool name, a call, or any ` +
  'JSON in your answer, and never narrate what you are about to do or which ' +
  'tool you are weighing up. Do the thinking silently and send only the result: ' +
  'what you found, what you did, or what you need from them. If you cannot do ' +
  'something, say so plainly in their words rather than naming the switch. '

const channelTruths = (): string =>
  'Facts about how your messages are sent, which are true whether or not you ' +
  'do anything: every Telegram message you send automatically carries thumbs ' +
  'up and thumbs down buttons, and a request for permission carries Go ahead ' +
  `and Not now. Voice notes ${currentPerson().name} sends are transcribed before you see them. ` +
  'You reach them on Telegram and the team on Slack. Never tell them you can ' +
  'only produce plain text, or that you cannot add buttons — you can, because ' +
  'the office adds them for you.'

/**
 * Did the reply claim it cannot reach something it can?
 *
 * Narrow on purpose. It fires only on a service currently reachable, and only
 * on wording that denies access to it — not on "I could not find anything in
 * Notion", which is a true and useful sentence about a search.
 *
 * Returns the offending service, or null.
 */
/*
  Claims about the channel, which name no service and so slip past the loop
  below.

  "I only generate plain text" mentions nothing in `reach`, so the service scan
  cannot see it. It is the exact sentence Grant was given, and it cost him a
  request for a feature he already had.
*/
const DENIES_CHANNEL =
  /\b(?:can(?:'|’)?t|cannot|can not|unable to|do(?:n(?:'|’)?t| not))\b[^.!?]{0,60}\b(?:add |send |use |attach |create )?(?:interactive |inline )?buttons?\b|\bonly (?:generate|produce|send|reply with|output)\b[^.!?]{0,30}\b(?:plain )?text\b|\breplies (?:are|stay) limited to text\b/i

export function contradictsReality(reply: string, reach: readonly Reach[]): string | null {
  // Checked first: it names no service, so the loop below would never reach it.
  if (DENIES_CHANNEL.test(reply)) return 'Telegram buttons'

  const text = reply.toLowerCase()
  for (const r of reach) {
    if (!r.reachable) continue
    const service = r.service.toLowerCase()
    // The service has to be named at all before any of this matters.
    const named = text.indexOf(service)
    if (named === -1) continue

    // "can't ... Notion" / "no access to Notion" / "not connected to Notion",
    // within a clause of it. A window rather than the whole message, because a
    // reply that says "I can't find the file" and later mentions Notion is not
    // making a claim about Notion.
    const around = text.slice(Math.max(0, named - 90), named + 90)
    const denies =
      /\b(?:can(?:'|’)?t|cannot|can not|unable to|no|not|don(?:'|’)?t|do not|lack)\b[^.!?]{0,60}\b(?:access|reach|connect|connected|integration|permission|credentials?|see|get into|log ?in)\b/.test(
        around,
      ) ||
      /\b(?:access|integration|connection|credentials?)\b[^.!?]{0,40}\b(?:missing|unavailable|not (?:set ?up|configured|granted))\b/.test(
        around,
      )
    if (denies) return r.service
  }
  return null
}
