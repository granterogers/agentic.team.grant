/*
  Text, alongside the voice.

  Grant: *"I also want a tab to chat with the team in a text way"*.

  Voice is right when you can talk. It is wrong on a train, wrong when you want
  a record of what you asked, wrong when the thing you are sending is a document
  rather than a sentence, and wrong when the answer is a list you need to read
  twice. So this is not a downgrade of the call button — it is the other half of
  the same conversation, and it is deliberately per project, because a question
  about the Legacy course has nothing to do with the AI learning notes.

  ## Context is structured, not described

  A message can carry an item — a document, a contact, a task, a module. It
  travels as `{ kind, id, title }`, not as a sentence about the thing, because
  the point of #27 is that Grant never has to transcribe what he is looking at.
  When this is wired to the backend the job gets those ids.

  ## What is honest here

  The prototype has no team behind it. Rather than fake an answer that looks
  real, a reply says what the request WOULD become — which agent picks it up and
  what it produces — and carries a `pending` mark that the UI shows. A dead
  button is bad; a lying button is worse.
*/

import { CREW } from './data.js'

const KEY = 'studio.chat'

const all = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

/** The thread for one project, oldest first. */
export const thread = (slug) => all()[slug] ?? []

const write = (slug, messages) => {
  try {
    const store = all()
    store[slug] = messages.slice(-200) // a thread is not an archive
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch { /* not fatal — the thread is a convenience, not the record */ }
}

export const clear = (slug) => write(slug, [])

/*
  Who answers.

  Routing on the context item first, because it is the strongest signal: a
  question about a contact is Ruby's. Words are the fallback. Claire takes
  anything unclaimed, which is what a chief of staff is for.

  Once an attachment carries its asset's provenance, a question about something
  the team made should go to whoever made it — but the attachment carries only
  kind, id and title today, so that rule would be a branch that never fires.
*/
const ROUTE = [
  [/\b(cost|price|budget|invoice|revenue|number|forecast)\b/i, 'daniel'],
  [/\b(research|compare|source|paper|find out|look into)\b/i, 'emma'],
  [/\b(write|draft|copy|email|one.?pager|post|newsletter)\b/i, 'oliver'],
  [/\b(risk|check|review|quality|proof)\b/i, 'grace'],
  [/\b(client|lead|prospect|outreach|growth|pipeline)\b/i, 'ruby'],
  [/\b(schedule|calendar|set up|organise|organize|book)\b/i, 'marcus'],
  [/\b(strategy|positioning|plan|direction)\b/i, 'tom'],
]

/**
 * Who this is for.
 *
 * An explicit addressee wins over every guess, which is #26's whole point:
 * routing by keyword is a guess and *"ask Emma"* is an instruction. The
 * keywords stay as the fallback for when Grant has not chosen — he usually has
 * not, and making him choose every time would be worse than guessing.
 *
 * `to` is a studio short name (`emma`), not a staff slug (`research-lead`).
 * The translation happens once, at the edge, in `staffSlug` below — the same
 * reason `crewBy` exists.
 */
export function routeTo(text, context, to) {
  if (to !== undefined && to !== null && to !== '' && to !== 'everyone') return to
  if (context?.kind === 'contact') return 'ruby'
  for (const [re, who] of ROUTE) if (re.test(text)) return who
  return 'claire'
}

/** What the team says back. Honest about being a prototype. */
function replyText(text, context) {
  const about = context ? `“${context.title}”` : 'this project'
  if (/\?\s*$/.test(text.trim())) return `Reading ${about} now — I will come back with an answer.`
  return `Taking that on for ${about}. It will show up in Team as soon as there is something to look at.`
}

/*
  Where a typed message goes (#103).

  The same endpoint the voice call's typing box uses, and the same one Claire's
  own tool uses — because they are the same thing: something was said, and the
  office answers or takes it on. Two implementations would drift, and the one
  that drifted would be this one, which is the one nobody reads the logs of.

  §5 of the master spec: a channel adapter may only TRANSLATE. It writes to the
  canonical layer and asks; it never decides. `/voice/turn` is that layer, so
  this posts to it rather than working anything out for itself.
*/
/**
 * The studio's short name, as the office's staff slug.
 *
 * `crewBy` already holds the mapping — the roster carries `slug` (the short
 * name the studio uses, "emma") and `staffSlug` (the office's, "research-lead")
 * — so this reads it rather than keeping a second copy that can drift. #46's
 * rule: before inventing one, check whether the office already has it.
 *
 * Returns null for "everyone" and for anything unrecognised. Null means "the
 * office decides", which is the correct outcome for both: nobody was named, so
 * the Chief of Staff takes it.
 */
const staffSlug = (short) => {
  if (short === undefined || short === null || short === '' || short === 'everyone') return null
  const found = CREW.find((c) => c.slug === short)
  return found?.staffSlug ?? found?.slug ?? null
}

const API = () =>
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'
const TURN = () => API().replace(/\/hq-api$/, '/voice')

/** One session per visit, so the office can group the turns of a conversation. */
const SESSION = `s${Math.random().toString(36).slice(2, 12)}`

export function send(slug, text, context, to) {
  const now = new Date().toISOString()
  const mine = {
    id: `m${Date.now()}`, from: 'grant', text, at: now,
    context: context ? { kind: context.kind, id: context.id, title: context.title } : null,
    // Recorded on the message, not only on the composer, so the thread shows
    // who each thing was asked of after the composer has moved on (#26).
    to: to ?? null,
  }
  /*
    The local guess stays, as the thing on screen WHILE the office is asked.

    It is marked pending, which is what draws the "no team behind this yet"
    note. That note is now a lie only until the answer lands, and it is
    replaced by the real one — rather than being the whole of the feature,
    which is what it was.
  */
  const who = routeTo(text, context, to)
  const back = {
    id: `m${Date.now() + 1}`, from: who, text: replyText(text, context),
    at: now, pending: true,
  }
  const next = [...thread(slug), mine, back]
  write(slug, next)
  return next
}

/**
 * Ask the office, and replace the placeholder with what it actually said.
 *
 * Separate from `send` so the message appears instantly and the round trip
 * happens behind it: a composer that waits for the network before showing what
 * you typed feels broken even when it is fast.
 *
 * A failure leaves the placeholder and says why on it. The alternative — an
 * empty thread and a thrown error — loses what you wrote.
 */
export async function ask(slug, text, context, token, to) {
  const pendingId = thread(slug).at(-1)?.id
  let reply = null
  try {
    const r = await fetch(`${TURN()}/turn`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' },
      /*
        `to` is the studio's short name; the office wants a staff slug.

        Translated here rather than sent raw, because §5 says an adapter may
        only TRANSLATE — and turning "emma" into "research-lead" is exactly
        that. What it must not do is decide: an unrecognised name is sent as
        nothing at all rather than being quietly rerouted, so the office's own
        router handles it and says why.

        "everyone" sends nothing, deliberately. With no addressee the Chief of
        Staff takes it, and #65 gave her real delegation — so asking the whole
        team is one answer from Claire naming who she brought in, rather than
        eight near-identical replies, which is #26's fourth criterion.
      */
      body: JSON.stringify({ said: text, session: SESSION, to: staffSlug(to) }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error ?? `the office returned ${r.status}`)
    reply = { text: body.speak, did: body.did }
  } catch (e) {
    reply = { text: `I could not reach the office: ${e.message}`, failed: true }
  }

  const next = thread(slug).map((m) =>
    m.id === pendingId
      ? { ...m, text: reply.text, pending: false, bad: reply.failed === true,
          delegated: reply.did === 'delegated' }
      : m,
  )
  write(slug, next)
  return next
}
