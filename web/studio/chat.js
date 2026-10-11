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

import { HQ_API, UNCONFIGURED, VOICE } from './backend.js'
import * as session from './session.js'
import { CREW, PROJECTS } from './data.js'

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
/*
  THE PROTOTYPE'S OWN CONVERSATION, in the shape the bubble renderer expects.

  Grant, 22 September: *"The sidebar should expose useful chat history, rather
  than behaving as though every interaction starts from nothing."* It did
  start from nothing: the dock read this module and this module read the
  browser's store, while the project's seeded conversation sat in data.js
  where only the Chat SURFACE looked at it. Two readers of one fact, and the
  quieter one was the sidebar.

  Mapped here rather than at either caller, because a shape converted twice is
  a shape that will be converted differently twice.
*/
const seeded = (slug) =>
  (PROJECTS.find((p) => p.slug === slug)?.chat ?? []).map((m, i) => ({
    id: `seed-${slug}-${String(i)}`,
    from: m.who === 'grant' ? 'grant' : m.who,
    text: m.text,
    at: m.when ?? '',
    when: m.when ?? '',
    seeded: true,
  }))

export const thread = (slug) => {
  const theirs = office.get(slug)
  const mine = all()[slug] ?? []
  // The prototype's invented conversations are for somebody with no session. A signed-in person (a Sample visitor included)
  // whose read has not landed or failed sees only their own messages, never another office's invented names (#426).
  if (theirs === undefined) return mine.length === 0 && !session.signedIn() ? seeded(slug) : mine
  return [...theirs, ...mine.filter((m) => m.inflight === true)]
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
  // The engine the office recorded: for a message, the one the person chose; for an answer, the one that wrote it.
  engine: m.engine === 'hermes' ? 'hermes' : 'team',
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
  const began = session.epoch()
  // When this read STARTED. A message sent after that cannot be in what comes back, so it must not be mistaken for one that has landed (#458).
  const startedAt = Date.now()
  try {
    // A visitor reads only their own thread, never the office's ordinary conversation (which is empty for a sample).
    const url = session.isSample()
      ? `${API()}?section=sample_conversation&id=${encodeURIComponent(projectId)}&visitor=${encodeURIComponent(session.visitorId())}`
      : `${API()}?section=conversation&id=${encodeURIComponent(projectId)}`
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const body = await r.json()
    if (began !== session.epoch()) return null
    if (!Array.isArray(body.data)) return null
    office.set(slug, body.data.map(asBubble))
    // What was in flight has landed, so the optimistic copy would now be a
    // duplicate of it. Only what was sent BEFORE this read began: a message typed while the read was on its way is not in the answer,
    // and dropping it made a sent message vanish from the screen until the next read (a person then types it again).
    write(
      slug,
      (all()[slug] ?? []).filter((m) => m.inflight !== true || Date.parse(String(m.at)) >= startedAt),
    )
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

const API = () => HQ_API
/*
  WHERE A TURN GOES. Derived from the gateway, with an override, because the
  experiment runs its own copy of both under different slugs (ADR-0043) and
  a regex anchored on `/hq-api` quietly returns the GATEWAY url when the slug
  is `hq-api-basecamp` -- so every turn would have been posted to the wrong
  function with no error to read.

  That derivation lives in `backend.js` now, with the rest of them, so there is
  one base and no second place to drift.
*/
const TURN = () => VOICE

/**
 * Where the voice surface lives, for anything that needs it besides a turn.
 *
 * Exported rather than re-derived by the caller: the basecamp voice note posts
 * a recording to `/note` on this same function, and two derivations of one
 * endpoint is the shape 0310 was spent undoing.
 */
export const endpoint = () => TURN()

/**
 * The project a thread belongs to, as the office knows it: its id (#373).
 *
 * Every caller already names the thread it writes into by slug, and the page
 * reads that thread back by the project's id (`load`). The office was never
 * told, so it had to guess where a message belonged and often filed it under
 * Unnamed, where its answer never appeared in the project it was sent from.
 * Only a real office id is ever sent: an example project has none, and a
 * value that is not an id would be a claim the office cannot check.
 */
export const projectIdOf = (slug) => {
  const id = PROJECTS.find((p) => p.slug === slug)?.id
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : undefined
}

/**
 * One id per page visit. It is the DEDUPE and containment identity of a turn, not the conversation: the office derives
 * the conversation (person + office + project) from the verified login, so a reload, a second tab or another device
 * keeps the thread (H1). Do not store this or send anything else as an identity; the shape is pinned by check:voice-sessions.
 */
const SESSION = `s${Math.random().toString(36).slice(2, 12)}`

/**
 * A name for ONE user message, minted when it is sent and kept for any retry of that same message (a retry after a
 * timeout is the same message; the same words typed again later are a new one with a new name). Plain characters and
 * bounded, because the office checks the shape and ignores anything else; it carries no meaning of its own, and the
 * office scopes it to the signed-in person, office and project, so it needs no secrecy.
 */
export function newMessageId() {
  let r = ''
  try {
    r = globalThis.crypto.randomUUID().replace(/-/g, '')
  } catch {
    r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }
  return `m${Date.now().toString(36)}${r}`.slice(0, 64)
}

export function send(slug, text, context, to, also = [], engine = 'team') {
  const now = new Date().toISOString()
  const mine = {
    id: `m${Date.now()}`, from: 'grant', text, at: now,
    // Which engine the person chose for THIS message. It travels with the message and with every retry of it.
    engine: engine === 'hermes' ? 'hermes' : 'team',
    context: context ? { kind: context.kind, id: context.id, title: context.title } : null,
    // Recorded on the message, not only on the composer, so the thread shows
    // who each thing was asked of after the composer has moved on (#26).
    to: to ?? null,
    // And who else was asked (#26). On the message, so the thread can say
    // "Emma, with Daniel" after the composer has moved on — the Issue asks
    // for the choice to be visible before sending AND to travel with it.
    also: Array.isArray(also) ? also : [],
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
    // This message's own name, minted once HERE and reused by every retry, so the office files a replay of it once.
    // The visit it was sent from travels with it: the office keys a turn on both.
    messageId: newMessageId(), visit: SESSION,
    engine: engine === 'hermes' ? 'hermes' : 'team',
    // And who else was asked, or a retry sends the request to fewer people
    // than the first attempt did (#375).
    also: Array.isArray(also) ? also : [],
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

export async function ask(slug, text, context, token, to, also, onState) {
  const pendingId = thread(slug).at(-1)?.id
  // The waiting row carries the message's name and the visit it was first sent from (a retry reuses both, so the
  // office sees the same message). A row with none (a direct ask) gets a fresh name for this attempt.
  const waitingRow = thread(slug).at(-1)
  const messageId =
    typeof waitingRow?.messageId === 'string' && waitingRow.messageId !== ''
      ? waitingRow.messageId
      : newMessageId()
  const visit =
    typeof waitingRow?.visit === 'string' && /^s[a-z0-9]{1,10}$/.test(waitingRow.visit)
      ? waitingRow.visit
      : SESSION
  // Only ever sent when Hermes was chosen: the team is the absence of the field, so an office without Hermes sends what it always sent.
  const engine = waitingRow?.engine === 'hermes' ? 'hermes' : 'team'
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
    /*
      NO OFFICE NAMED IS A STATE, AND IT IS NOT A NETWORK FAILURE.

      `backend.js` returns the empty string when nothing has told this
      deployment which office it belongs to (ADR-0048), and posting to
      `''/turn` is not an error -- it resolves against the page's own origin
      and asks Vercel for a conversation. `office.js` asks first for the same
      reason; this is the other door and it was left open, which
      `verify:talk` found by reporting "nothing reached the office" about a
      page that had nowhere to reach.
    */
    if (TURN() === '') throw new Error(UNCONFIGURED)
    /*
      A SAMPLE VISITOR ASKS THROUGH THE OFFICE'S OWN DOOR FOR VISITORS, not the voice function. `/turn` speaks as a person
      and refuses a guest by design (a realtime or spoken turn is a metered thing); `sample_say` is rate-limited, files the
      question in the visitor's own thread, and answers with the job to follow, the same way a delegated turn does.
    */
    const guest = session.isSample()
    const r = await fetch(guest ? API() : `${TURN()}/turn`, {
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
      /*
        `also` goes as slugs, translated the same way `to` is, and an
        unrecognised name is simply not sent — §5 again: an adapter may
        translate and may not decide. 0410's trigger is what drops a name that
        is real here and retired in the office, and the office says so.
      */
      body: JSON.stringify(
        guest
          ? {
              action: 'sample_say',
              args: { p_project_id: projectIdOf(slug), p_text: text, p_visitor: session.visitorId() },
            }
          : {
              said: text,
              session: visit,
              message: messageId,
              ...(engine === 'hermes' ? { engine: 'hermes' } : {}),
              // The thread's project, so the office files it there and nowhere else.
              project: projectIdOf(slug),
              to: staffSlug(to),
              also: (Array.isArray(also) ? also : [])
                .map((x) => staffSlug(x))
                .filter((x) => x !== null && x !== undefined && x !== ''),
            },
      ),
    })
    const body = await r.json()
    /*
      A TOKEN THE OFFICE WILL NOT ACCEPT IS NOT A NETWORK PROBLEM.

      This threw the server's own word - "unauthorized" - straight at the
      person, which is both meaningless and unrecoverable: the stale token
      stayed in the browser, so every following message failed the same way
      with the same word.

      `office.js` has always handled 401 properly, by clearing the token and
      saying what to do about it. The conversation goes to a different
      endpoint and had its own fetch, so it never learned. It says the same
      thing now, and clears the same token, which puts the page back into the
      signed-out state that offers a way in.

      AND IT HAS TO CLEAR BOTH. The sentence above was written when `hq.token`
      was the only credential a browser held. A person signs in with their own
      SESSION now, and clearing the legacy key alone left a dead session in
      storage -- so the page went on believing it was signed in, every message
      failed identically, and the way back in was never offered. Exactly the
      defect this block exists to fix, unfixed for the architecture that
      replaced it. `office.js` clears both for the same reason: either could
      be the thing the office refused.
    */
    if (r.status === 401) {
      session.forget()
      try {
        localStorage.removeItem('hq.token')
      } catch {
        /* Private window: nothing to clear, and the message still stands. */
      }
      throw new Error('This browser is not signed in to the office. Sign in and try again.')
    }
    if (guest) {
      // The gateway answers a refusal as { error, message } and a done thing as { result }. A limit says so in words.
      const said = body.result ?? body
      if (!r.ok || said.ok !== true) {
        // Already a sentence for a person (a limit, or "create your own office"): shown as it is, not as a network fault.
        throw Object.assign(new Error(said.error ?? body.message ?? `the office returned ${r.status}`), { plain: true })
      }
      reply = {
        text: 'Your question is with the sample team. The answer will appear here in a moment.',
        did: 'delegated',
        job: said.job ?? null,
      }
    } else {
      if (!r.ok) throw new Error(body.error ?? `the office returned ${r.status}`)
      reply = { text: body.speak, did: body.did, job: body.job_id ?? null }
    }
  } catch (e) {
    reply = { text: e.plain === true ? e.message : `I could not reach the office: ${e.message}`, failed: true }
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
  /*
    A turn that was put to the team is not finished when the page says so. The acknowledgement is all the office can say
    at once; the answer is written minutes later by somebody else, and until now it only reached a person who happened to
    open the Chat tab. Follow the job and bring the answer into this conversation (see `follow`).
  */
  if (reply.did === 'delegated' && typeof reply.job === 'string' && reply.job !== '') {
    void follow(slug, reply.job, token, onState)
  }
  return next
}

/*
  FOLLOWING A TURN THE TEAM IS WORKING ON.

  Team Chat acknowledged "I have put that to the team ... the answer will be on the Team page" and then went silent: the
  answer, written minutes later, was never in the conversation unless the Chat tab was opened and the office's record
  re-read, and nothing said whether anybody was working on it, whether it was stuck, or whether it had failed.

  `turn_status` is derived from the jobs and outputs themselves (migration 0874): which of queued, working, waiting, needs
  you, done or failed the work is in, who holds a live job, and the words written so far. This asks it every few seconds,
  shows exactly that in a row of the thread, and when the work is finished removes the row and reads the office's record,
  which holds the answer in the conversation like every other message. Nothing is shown that the office did not report: no
  plan, no reasoning, and no guess at how long it will take.

  A failed read changes nothing on screen. It is neither "working" nor "failed", so it is neither said.
*/
const following = new Set()
const STATUS_EVERY = 3_000
const FOLLOW_FOR = 8 * 60_000

const statusWords = (st) => {
  const names = Array.isArray(st.working) ? st.working.filter((n) => typeof n === 'string' && n !== '') : []
  const who = names.length === 0 ? '' : names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  switch (st.state) {
    case 'queued':
      return 'Waiting its turn. Nobody has picked it up yet.'
    case 'working':
      return who === '' ? 'The team is working on it.' : `${who} ${names.length === 1 ? 'is' : 'are'} working on it.`
    case 'waiting':
      return st.waiting_on ? `Waiting: ${st.waiting_on}` : 'Waiting on something before it can go on.'
    case 'needs_you':
      return 'It needs something from you. Look under Needs you.'
    default:
      return 'The team has it.'
  }
}

export async function follow(slug, job, token, onState) {
  if (following.has(job) || !token) return
  following.add(job)
  const began = session.epoch()
  const rowId = `turn-${job}`
  const upsert = (row) => {
    const rest = (all()[slug] ?? []).filter((m) => m.id !== rowId)
    write(slug, row === null ? rest : [...rest, row])
    if (typeof onState === 'function') onState()
  }
  const until = Date.now() + FOLLOW_FOR
  try {
    while (Date.now() < until) {
      await new Promise((ok) => setTimeout(ok, STATUS_EVERY))
      if (began !== session.epoch()) return
      let st = null
      try {
        const r = await fetch(`${API()}?section=turn_status&id=${encodeURIComponent(job)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (r.ok) st = (await r.json()).data ?? null
      } catch {
        st = null
      }
      if (st === null || typeof st.state !== 'string') continue
      if (st.state === 'done' || st.state === 'failed') {
        upsert(null)
        const pid = PROJECTS.find((x) => x.slug === slug)?.id
        const loaded = await load(slug, pid, token)
        if (st.state === 'failed') {
          write(slug, [
            ...(all()[slug] ?? []),
            {
              id: `turn-failed-${job}`, from: 'the-office', at: new Date().toISOString(),
              text: 'The team could not finish that. Nothing was lost: what you asked is recorded. You can ask again.',
              pending: false, bad: true, waiting: null, inflight: true,
            },
          ])
        } else if (loaded === null && Array.isArray(st.outputs)) {
          // The office's record could not be read (a prototype, a refused read): show what the status itself holds.
          write(slug, [
            ...(all()[slug] ?? []),
            ...st.outputs.map((o) => ({
              id: `turn-out-${String(o.id)}`, from: String(o.who ?? 'the-office'), at: String(o.at ?? ''),
              text: String(o.body ?? ''), pending: false, bad: false, waiting: null,
            })),
          ])
        }
        if (typeof onState === 'function') onState()
        return
      }
      upsert({
        id: rowId, from: 'the-office', at: new Date().toISOString(), inflight: true, pending: true,
        waiting: st.state, say: statusWords(st), since: Date.parse(String(st.asked_at ?? '')) || Date.now(),
      })
    }
  } finally {
    following.delete(job)
  }
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
  /*
    Every argument in its own slot (#375). This once passed `onState` where
    `ask` takes `also`, so a retry asked fewer people than the first attempt
    and never redrew while it waited.
  */
  return ask(slug, row.said, row.context ?? null, token, row.to ?? undefined, row.also ?? [], onState)
}
