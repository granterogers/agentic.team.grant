/*
  The Activity screen's pure half: turning one ledger event into what a person reads, and the query a filter means.

  No DOM and no network here, so every rule is unit tested (tests/web/activity-model.test.ts) and the renderer cannot drift from them.
  The rules come from docs/activity-ledger/EVENT-CONTRACT.md and are deliberately conservative:

  - the sentence is the ledger's own summary, never composed here;
  - an actor is named only when the record names one, and an unknown one is never credited to Claire or to a specialist;
  - a result word is read from the event's status, and "confirmed" is said only for a status the provider confirmed;
  - an outside worker's report is marked as reported, never as confirmed;
  - nothing here guesses a destination: a link exists only when a project is known to the page.
*/

export const CHIEF = 'chief-of-staff'

/** The four views, and what each asks the server. A view is a server query, never a filter over the page already loaded. */
export const VIEWS = [
  { id: 'all', name: 'All activity', short: 'All', ask: {} },
  { id: 'attention', name: 'Needs attention', short: 'Attention', ask: null },
  { id: 'completed', name: 'Completed', short: 'Done', ask: { status: 'completed' } },
  { id: 'problems', name: 'Errors and blockers', short: 'Problems', ask: { severity: 'warning' } },
]

export const RANGES = [
  { id: '', name: 'Any time', days: 0 },
  { id: '1', name: 'Today', days: 1 },
  { id: '7', name: 'Last 7 days', days: 7 },
  { id: '30', name: 'Last 30 days', days: 30 },
]

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** The instant a range starts at, in the person's own day: Today is since local midnight, N days is N-1 midnights back. */
export const sinceFor = (rangeId, now = new Date()) => {
  const r = RANGES.find((x) => x.id === rangeId)
  if (r === undefined || r.days === 0) return ''
  const d = startOfDay(now)
  d.setDate(d.getDate() - (r.days - 1))
  return d.toISOString()
}

/**
 * The gateway query for a set of filters. `scopeProject` (a project page) wins over a project chosen in the filter, so a page
 * about one project can never be widened by a stale filter. Unknown views ask for everything rather than for nothing.
 */
export const queryFor = ({ view = 'all', agent = '', project = '', range = '' }, { scopeProject = '', now = new Date(), limit = 40, cursor = null } = {}) => {
  const v = VIEWS.find((x) => x.id === view)
  const q = { visibility: 'user', limit: String(limit), ...(v?.ask ?? {}) }
  const p = scopeProject !== '' ? scopeProject : project
  if (p !== '') q.project = p
  if (agent !== '') q.agent = agent
  const since = sinceFor(range, now)
  if (since !== '') q.since = since
  if (cursor !== null && cursor !== undefined && typeof cursor.at === 'string' && typeof cursor.id === 'string') {
    q.before_at = cursor.at
    q.before_id = cursor.id
  }
  return q
}

/** The filters that are actually narrowing, as removable chips. Order is stable so the row of chips does not jump. */
export const activeFilters = ({ view, agent, project, range }, { agentName = (s) => s, projectName = (s) => s, scopeProject = '' } = {}) => {
  const out = []
  if (view === 'completed' || view === 'problems') out.push({ key: 'view', label: VIEWS.find((x) => x.id === view)?.name ?? view })
  if (agent !== '') out.push({ key: 'agent', label: agentName(agent) })
  if (project !== '' && scopeProject === '') out.push({ key: 'project', label: projectName(project) })
  if (range !== '') out.push({ key: 'range', label: RANGES.find((x) => x.id === range)?.name ?? range })
  return out
}

/** One event, as the screen needs it. Never throws; a field the record does not carry is simply absent. */
export const describe = (e, { crew = [], projects = [] } = {}) => {
  const str = (x) => (typeof x === 'string' ? x : '')
  const kind = str(e?.actor_kind)
  const actor = str(e?.actor)
  const slug = kind === 'agent' ? actor : str(e?.agent)
  // The roster is searched directly: a retired or unknown specialist is NOT credited to somebody else.
  const known = crew.find((c) => c.slug === slug || c.staffSlug === slug)
  const worker = actor.startsWith('external:') ? actor.slice('external:'.length) : ''
  let who
  let tone
  if (kind === 'user') {
    who = 'You'
    tone = 'you'
  } else if (kind === 'agent' && actor === CHIEF) {
    who = known?.name ?? 'Claire'
    tone = 'chief'
  } else if (kind === 'agent') {
    who = known?.name ?? 'A team member who is no longer on the roster'
    tone = known === undefined ? 'unknown' : 'agent'
  } else if (kind === 'external') {
    who = worker === '' ? 'An outside worker' : `${worker.charAt(0).toUpperCase()}${worker.slice(1)} (outside worker)`
    tone = 'external'
  } else {
    who = 'Team HQ'
    tone = 'system'
  }
  const project = projects.find((p) => p.id === str(e?.project_id))
  const status = str(e?.status)
  const category = str(e?.category)
  const meta = e?.metadata !== null && typeof e?.metadata === 'object' ? e.metadata : {}
  const byPerson = meta.confirmed_by_person === true
  const indeterminate = meta.indeterminate === true
  // The result, in the words the lifecycle allows. "Confirmed" is a provider's word; a person marking it is their own.
  let result = ''
  let resultTone = 'neutral'
  if (status === 'completed') [result, resultTone] = byPerson ? ['Marked as delivered by you', 'ok'] : ['Done', 'ok']
  else if (status === 'confirmed') [result, resultTone] = ['Confirmed sent', 'ok']
  else if (status === 'failed') [result, resultTone] = indeterminate ? ['Could not be confirmed', 'warn'] : ['Failed', 'bad']
  else if (status === 'blocked') [result, resultTone] = ['Held back', 'warn']
  else if (status === 'authorised') [result, resultTone] = ['You said yes', 'ok']
  else if (status === 'declined') [result, resultTone] = ['You said no', 'neutral']
  else if (status === 'requested' && category === 'approval') [result, resultTone] = ['Asked', 'wait']
  else if (status === 'attempted') [result, resultTone] = ['In progress', 'wait']
  else if (status === 'cancelled') [result, resultTone] = ['Cancelled', 'neutral']
  else if (status === 'scheduled') [result, resultTone] = ['Scheduled', 'neutral']
  else if (status === 'expired') [result, resultTone] = ['Expired', 'warn']
  return {
    id: str(e?.id),
    at: str(e?.at),
    who,
    tone,
    slug,
    // The stored marker an outside worker's report carries is bookkeeping, not wording; the worker is named by the actor line.
    sentence: str(e?.summary).replace(/^\[external:[^\]\s]{1,60}\]\s*/, ''),
    category,
    severity: str(e?.severity),
    status,
    result,
    resultTone,
    project,
    projectName: str(e?.project) || (project?.name ?? ''),
    via: viaWords(str(e?.source_interface)),
    reported: str(e?.provenance) === 'external',
    problem: status === 'failed' || status === 'blocked' || ['error', 'critical'].includes(str(e?.severity)),
    jobId: str(e?.job_id),
    correlationId: str(e?.correlation_id),
  }
}

export const viaWords = (v) =>
  ({ teamhq: 'Team HQ', chatgpt: 'ChatGPT', claude: 'Claude', mcp: 'an assistant', telegram: 'Telegram', slack: 'Slack', voice: 'voice', worker: '', system: '', external: '' })[v] ?? ''

/** How we know it: said once, in a sentence, so a worker's own report is never mistaken for the office's confirmation. */
export const howWeKnow = (e) => {
  const p = typeof e?.provenance === 'string' ? e.provenance : ''
  if (p === 'external') return 'Reported by an outside worker. The office has not independently confirmed it.'
  if (p === 'native') return 'Recorded by the office when it happened.'
  if (p === 'projected') return 'Read from the office\'s own record of this work.'
  return ''
}

/** The tool page an event can honestly lead to, or null. A project must be one the page knows; nothing else is guessed. */
export const destinationFor = (d) => {
  if (d.project === undefined || typeof d.project.slug !== 'string' || d.project.slug === '') return null
  const tool = { approval: 'team', output: 'team', job: 'team', request: 'team', delivery: 'team', external: 'team', task: 'tasks', document: 'documents', calendar: 'schedule' }[d.category]
  return { to: tool === undefined ? `/p/${d.project.slug}` : `/p/${d.project.slug}/${tool}`, label: tool === undefined ? 'Open the project' : tool === 'team' ? 'Open in Agentic Team' : tool === 'tasks' ? 'Open the to-dos' : tool === 'documents' ? 'Open Docs & Files' : 'Open the schedule' }
}

const DAY = 24 * 3600 * 1000
/** The heading a day sits under, in the person's own calendar: Today, Yesterday, then the weekday and date. */
export const dayLabel = (iso, now = new Date()) => {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return 'Undated'
  const a = startOfDay(t).getTime()
  const b = startOfDay(now).getTime()
  const days = Math.round((b - a) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const opts = t.getFullYear() === now.getFullYear() ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  return t.toLocaleDateString('en-GB', opts)
}

export const dayKey = (iso) => {
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? 'undated' : `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`
}

export const clock = (iso) => {
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export const exactTime = (iso) => {
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Group events (already newest first) under day headings, keeping their order. Events with no usable instant keep their place under Undated. */
export const groupByDay = (events, now = new Date()) => {
  const groups = []
  for (const e of events) {
    const k = dayKey(e.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === k) last.events.push(e)
    else groups.push({ key: k, label: dayLabel(e.at, now), events: [e] })
  }
  return groups
}

/** Merge a newly read page after the ones held, by event id, so a boundary event delivered twice is shown once and order is kept. */
export const appendPage = (held, page) => {
  const seen = new Set(held.map((e) => e.id))
  return [...held, ...page.filter((e) => typeof e?.id === 'string' && !seen.has(e.id))]
}

const STAGES = [
  [/^request\./, 'Request'],
  [/^job\.delegated$/, 'Handed over'],
  [/^approval\./, 'Approval'],
  [/^output\.reviewed$/, 'Review'],
  [/^output\./, 'Output'],
  [/^delivery\./, 'Delivery'],
  [/^job\.(completed)$/, 'Finished'],
  [/^job\.(failed|cancelled)$/, 'Stopped'],
  [/^external\./, 'Outside worker'],
  [/^tool\./, 'Tool'],
]
export const stageOf = (type) => (STAGES.find(([re]) => re.test(String(type ?? ''))) ?? [null, 'Work'])[1]

/** Metadata keys that are safe and useful to show as plain facts. Values must be short scalars; anything else stays out. */
const SAFE_META = ['kind', 'answer', 'channel', 'provider_confirmed', 'confirmed_by_person', 'indeterminate', 'reason_class', 'cost_usd', 'cost_provenance', 'total_tokens', 'duration_ms']
// A job kind is bookkeeping, not wording: the one a person's own message becomes reads as a request, and any other is shown in plain words.
export const kindWords = (k) => (k === 'office.instruction' ? 'A request' : String(k).replace(/[._]+/g, ' ').replace(/^./, (c) => c.toUpperCase()))
export const safeFacts = (meta) => {
  if (meta === null || typeof meta !== 'object') return []
  const words = { kind: 'Kind of work', answer: 'Answer given', channel: 'Channel', provider_confirmed: 'Confirmed by the provider', confirmed_by_person: 'Marked by you', indeterminate: 'Outcome unknown', reason_class: 'Reason', cost_usd: 'Cost (USD)', cost_provenance: 'Cost is', total_tokens: 'Tokens', duration_ms: 'Duration (ms)' }
  return SAFE_META.filter((k) => ['string', 'number', 'boolean'].includes(typeof meta[k]) && String(meta[k]).length <= 120).map((k) => [words[k], typeof meta[k] === 'boolean' ? (meta[k] ? 'Yes' : 'No') : k === 'kind' ? kindWords(meta[k]) : String(meta[k])])
}
