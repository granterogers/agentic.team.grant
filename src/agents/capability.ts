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

export interface Reach {
  /** How a person would name it: "Notion", "Slack", "Google NotebookLM". */
  readonly service: string
  /** True when the connector is enabled AND its service is not failing. */
  readonly reachable: boolean
  /** Why not, when not. */
  readonly detail: string | null
}

/**
 * What is reachable right now.
 *
 * Connectors joined to health, because a connector switched on with a dead
 * credential is not reachable and saying so is the honest answer. Chat surfaces
 * are included because two of the three false claims were about Slack.
 */
export async function reachNow(db: SqlExecutor): Promise<Reach[]> {
  const { rows } = await db.execute(`
    select
      k.name as service,
      (k.enabled and coalesce(h.state, 'ok') not in ('dead', 'missing')) as reachable,
      case
        when not k.enabled then coalesce(k.disabled_reason, 'switched off')
        when h.state in ('dead', 'missing') then coalesce(h.detail, h.state)
        else null
      end as detail
    from public.knowledge_connectors k
    left join lateral (
      select ch.state, ch.detail
        from public.connection_health ch
       where ch.service = k.health_service
       order by case ch.state
                  when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                  when 'ok' then 3 else 4 end
       limit 1
    ) h on true
    where k.connector not in ('upload', 'mcp')
    union all
    -- The surfaces. Not connectors, and the thing she was wrong about twice.
    select c.service,
           c.state not in ('dead', 'missing'),
           case when c.state in ('dead', 'missing') then coalesce(c.detail, c.state) else null end
      from public.connection_health c
     where c.service in ('Slack', 'Telegram')
  `)
  return (rows as { service: string; reachable: boolean; detail: string | null }[]).map((r) => ({
    service: String(r.service),
    reachable: r.reachable === true,
    detail: r.detail === null ? null : String(r.detail),
  }))
}

/**
 * The paragraph that goes in front of the model.
 *
 * Deliberately blunt about the distinction, because the distinction is the
 * whole bug: not holding a document is a fact about our records, and not
 * reaching a service is a fact about our wiring, and only one of them is hers
 * to report.
 */
export function capabilityBrief(reach: readonly Reach[], verbs: readonly Verb[] = []): string {
  if (reach.length === 0) return ''
  const can = reach.filter((r) => r.reachable).map((r) => r.service)
  const cannot = reach.filter((r) => !r.reachable)

  return (
    'What this team can reach right now, as a matter of fact: ' +
    (can.length === 0 ? 'nothing' : can.join(', ')) +
    '. ' +
    (cannot.length === 0
      ? ''
      : `Not reachable: ${cannot.map((r) => `${r.service} (${String(r.detail ?? 'unavailable')})`).join(', ')}. `) +
    (verbs.length === 0
      ? ''
      : `${verbs.map((v) => `${v.service} — you can ${v.can.join(', ')}.`).join(' ')} `) +
    'Never claim you cannot reach one of the reachable services, and never say ' +
    'you lack access or an integration for one. If our records hold nothing ' +
    'about the thing being asked about, say THAT — "I have nothing on it here" ' +
    'is true and useful; "I do not have access to Notion" is a different claim ' +
    'and it is not yours to make. ' +
    // The specific sentence Grant objected to, forbidden by name.
    'And do not offer to produce something "ready for you to add" when you can ' +
    'add it yourself — if a verb above covers it, use it.'
  )
}

/** What a service can actually be made to DO, as opposed to merely reached. */
export interface Verb {
  readonly service: string
  readonly can: readonly string[]
}

/**
 * The verbs, from the tool registry rather than from a live call.
 *
 * Reachability is a fact about right now and worth asking the network for.
 * Which operations exist is a fact about this repository and about what Grant
 * has permitted, both of which are in the database — so this costs one query
 * rather than a round trip to Notion on every answer.
 *
 * The distinction matters for the sentence it produces. "Notion is reachable"
 * did not stop Claire offering to write an outline for Grant to paste in; "you
 * can create pages, upload files and set relations in Notion" is the sentence
 * that does.
 */
export async function verbsNow(db: SqlExecutor): Promise<Verb[]> {
  const { rows } = await db.execute(`
    select tool from public.tool_permissions where enabled and level <= 2 order by tool
  `)
  const enabled = new Set((rows as { tool: string }[]).map((r) => String(r.tool)))
  const verbs: Verb[] = []

  if (enabled.has('notion.write')) {
    verbs.push({
      service: 'Notion',
      can: [
        'create pages in any shared data source',
        'append and update blocks',
        'set properties and relations',
        'upload and attach files including audio and video',
        'archive a page (reversibly)',
        'read a database schema before writing to it',
      ],
    })
  }
  if (enabled.has('notebook.write')) {
    verbs.push({
      service: 'Google NotebookLM',
      can: ['add sources and notes', 'generate artifacts'],
    })
  }
  if (enabled.has('github.read')) {
    verbs.push({
      service: 'GitHub',
      can: ['read repositories, branches, README, the source tree, issues and releases'],
    })
  }
  return verbs
}

/**
 * Did the reply claim it cannot reach something it can?
 *
 * Narrow on purpose. It fires only on a service currently reachable, and only
 * on wording that denies access to it — not on "I could not find anything in
 * Notion", which is a true and useful sentence about a search.
 *
 * Returns the offending service, or null.
 */
export function contradictsReality(reply: string, reach: readonly Reach[]): string | null {
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
