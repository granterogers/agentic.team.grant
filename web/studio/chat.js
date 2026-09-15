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

/*
  What the office holds, per project slug, once it has been asked for.

  The local store below is the PROTOTYPE's thread and the optimistic tail of a
  real one. It is not the record: a message Grant sends from Slack is in the
  office's conversation and was never in this browser, and clearing site data
  must not lose a word of what was said. #192 made that conversation readable;
  this is the half that reads it.
*/
const office = new Map()

/**
 * The thread for one project, oldest first.
 *
 * Once the office's conversation has loaded it wins, with only the messages
 * still in flight appended — a reply that has landed is in the office's copy
 * already, and showing both would double it.
 */
export const thread = (slug) => {
  const theirs = office.get(slug)
  if (theirs === undefined) return all()[slug] ?? []
  return [...theirs, ...(all()[slug] ?? []).filter((m) => m.inflight === true)]
}

/** Whether the office's own record is what is on screen for this project. */
export const isReal = (slug) => office.has(slug)

/*
  A conversation message, in the shape the bubble renderer already expects.

  `crewBy` matches on `staffSlug` as well as the studio's short slug, so the
  office's own vocabulary (`chief-of-staff`) needs no translation table here —
  which is the point: a second mapping would be the copy that drifts.
*/
const asBubble = (m) => ({
  id: String(m.message_id),
  from: m.kind === 'said' ? 'grant' : String(m.from ?? 'the-office'),
  text: String(m.body ?? ''),
  at: String(m.at ?? ''),
  to: m.addressed_to ?? null,
  context: null,
  // Reconstructed history, not something the office watched happen (0340).
  // Rendered differently, because implying it was present would be a claim.
  backfilled: m.backfilled === true,
  surface: m.surface ?? null,
  /*
    Whether the answer actually reached him (#202).

    Null for an answer that was never a delivery — most of them, read here in
    the studio — and 'sent', 'sending' or 'failed' when it was. Kept as the
    office's own word rather than turned into a boolean: "sending" and "failed"
    are different things to say and a boolean would have to pick one of them to
    be the false case.
  */
  delivery: m.delivery ?? null,
  undelivered: Number(m.undelivered ?? 0),
  job: m.job ?? null,
})

/**
 * Read one project's conversation from the office.
 *
 * Returns null when there is nothing to read — a prototype project with no id,
 * or no token — and the local thread stays in charge. Deliberately not an
 * error: the prototype is a supported way to look at this page.
 */
export async function load(slug, projectId, token) {
  if (!projectId || !token) return null
  try {
    const r = await fetch(`${API()}?section=conversation&id=${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const body = await r.json()
    if (!Array.isArray(body.data)) return null
    office.set(slug, body.data.map(asBubble))
    // What was in flight has landed, so the optimistic copy would now be a
    // duplicate of it.
    write(slug, (all()[slug] ?? []).filter((m) => m.inflight !== true))
    return thread(slug)
  } catch {
    return null
  }
}

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

/*
  Nothing is invented while we wait (#215).

  This used to be `replyText`, which composed a sentence in an agent's voice -
  *"Taking that on for this project. It will show up in Team as soon as there
  is something to look at."* - and wrote it into the thread the instant the
  send button was pressed, attributed to a person picked by keyword, before
  anything had been asked of anybody.

  Grant's report of it: *"a message can be sent and get no reply for minutes,
  with no state shown."* He is describing exactly this. He DID get a reply -
  immediately, confident, and made up - so nothing on screen ever said the
  request was still in the air. The fabrication was the reason the waiting was
  invisible.

  It is also the office's first invariant leaking into the interface. The
  backend spent a whole certification campaign learning not to claim what it
  had not done; the dashboard was doing it in the composer.

  So the placeholder is a STATE, not a message. It says which of four things is
  true - sending, waiting, answered, failed - and it says nothing else.
*/

/** The moment a request was handed over, for the waiting row to count from. */
const startedAt = () => Date.now()

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
    // Cleared the moment the office's own copy arrives (#192).
    inflight: true,
  }
  /*
    The local guess stays, as the thing on screen WHILE the office is asked.

    It is marked pending, which is what draws the "no team behind this yet"
    note. That note is now a lie only until the answer lands, and it is
    replaced by the real one — rather than being the whole of the feature,
    which is what it was.
  */
  /*
    The waiting row carries everything a retry needs.

    `said`, `context` and `to` are kept on it because a failure is the one
    moment the composer has already been cleared - #197 clears the draft on
    send, correctly - so without them the only copy of what Grant typed would
    be the bubble above, as escaped HTML. Retry has to resend the words, not a
    reconstruction of them.
  */
  const who = routeTo(text, context, to)
  const back = {
    id: `m${Date.now() + 1}`, from: who, text: '',
    at: now, pending: true, inflight: true,
    waiting: 'sending', since: startedAt(),
    said: text, to: to ?? null,
    context: context ? { kind: context.kind, id: context.id, title: context.title } : null,
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
/**
 * How long the studio waits before it says so, in milliseconds.
 *
 * Not a cancellation - the office may still be working, and a turn that takes
 * two minutes has happened. It is the point at which silence stops being
 * informative and the page owes Grant a sentence. #211's rule, on the surface
 * he is looking at: anything that can end with no answer has to say so
 * somewhere he looks.
 */
const PATIENCE = 90_000

/** Move a waiting row to its next state, in place, without disturbing the rest. */
function mark(slug, id, patch) {
  const next = thread(slug).map((m) => (m.id === id ? { ...m, ...patch } : m))
  write(slug, next)
  return next
}

export async function ask(slug, text, context, token, to, onState) {
  const pendingId = thread(slug).at(-1)?.id
  /*
    Sending, then waiting.

    Two states rather than one spinner, because they fail differently and a
    person reads them differently: still sending is a network you can retry in
    a second, waiting is a team that has your request. The flip happens when
    the request has been handed to the browser and we are on the awaiting side
    of it - which is the only honest place to draw the line from here.
  */
  let settled = false
  const tell = (patch) => {
    /*
      A timer that fires after the answer has landed must do NOTHING.

      Both of these are set before the request goes out and the request can beat
      them: a fast reply arrives in 200ms, the row becomes the answer, and then
      the 400ms timer marks that answer as "thinking" and the thread shows a
      spinner over a finished reply for ever. The first run of this code did
      exactly that and `verify:chat` reported it as "STILL WAITING AFTER THE
      ANSWER LANDED", which is the check earning its place.

      Clearing the timers is not enough on its own - one of them can already be
      on the queue when the answer resolves - so the flag is what actually
      decides, and the clears are the tidy-up.
    */
    if (settled) return
    mark(slug, pendingId, patch)
    if (typeof onState === 'function') onState()
  }
  const late = setTimeout(() => { tell({ waiting: 'slow' }) }, PATIENCE)
  const soon = setTimeout(() => { tell({ waiting: 'thinking' }) }, 400)

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
  settled = true
  clearTimeout(late)
  clearTimeout(soon)

  /*
    The waiting row becomes the answer, or becomes a failure that can be tried
    again.

    `said`, `to` and `context` survive on a failed row and are dropped from a
    successful one - a retry button on an answer would be a control that means
    nothing, and #59's rule is that a control that cannot help should not be
    drawn.
  */
  const next = thread(slug).map((m) => {
    if (m.id !== pendingId) return m
    if (reply.failed === true) {
      return { ...m, text: reply.text, pending: false, bad: true, waiting: 'failed' }
    }
    const { said, ...rest } = m
    void said
    return {
      ...rest, text: reply.text, pending: false, bad: false, waiting: null,
      delegated: reply.did === 'delegated',
    }
  })
  write(slug, next)
  return next
}

/**
 * Send the same words again (#215).
 *
 * Grant asked for Retry by name. It rewrites the failed row back to sending
 * rather than appending a second question, because he asked once - a thread
 * that grows a duplicate every time the network hiccups is a worse record than
 * one that says a request took two attempts.
 */
export async function retry(slug, id, token, onState) {
  const row = thread(slug).find((m) => m.id === id)
  if (row === undefined || typeof row.said !== 'string' || row.said === '') return thread(slug)
  mark(slug, id, { waiting: 'sending', bad: false, pending: true, text: '', since: startedAt() })
  if (typeof onState === 'function') onState()
  /*
    `ask` keys on the LAST row in the thread, which is what a fresh send always
    is. A retry is not: the failed row may have anything after it. So the row is
    moved to the end first, which also puts the retry where a person looks for
    it - at the bottom, with the newest thing.
  */
  const moved = [...thread(slug).filter((m) => m.id !== id), thread(slug).find((m) => m.id === id)]
  write(slug, moved.filter((m) => m !== undefined))
  return ask(slug, row.said, row.context ?? null, token, row.to ?? undefined, onState)
}
