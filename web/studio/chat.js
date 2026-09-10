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

export function routeTo(text, context) {
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

export function send(slug, text, context) {
  const now = new Date().toISOString()
  const mine = {
    id: `m${Date.now()}`, from: 'grant', text, at: now,
    context: context ? { kind: context.kind, id: context.id, title: context.title } : null,
  }
  const who = routeTo(text, context)
  const back = {
    id: `m${Date.now() + 1}`, from: who, text: replyText(text, context),
    at: now, pending: true,
  }
  const next = [...thread(slug), mine, back]
  write(slug, next)
  return next
}
