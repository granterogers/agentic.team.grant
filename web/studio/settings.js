/*
  The office, configured.

  Grant: *"this level of visual quality should be applied to the actual, you
  know, the settings part of this code base as well. You know, where we defined
  the connectors, the bots, behaviors, all that stuff... I want to see these
  things properly arranged in a logical way. So like one tab for the bot
  management where you add and remove bots dynamically."*

  Six tabs, in the order you need them:

    Team        the eight, added and removed here
    Behaviour   how much the office does without asking
    Connections every external service, with its real state
    Channels    which surface reaches Grant, and when
    Models      what is being spent, against £0
    Appearance  palette and texture, which already existed

  ## Where the data comes from

  Almost none of this needs new schema — it needs an interface. `staff`,
  `staff_tools`, `tool_permissions`, `autonomy_settings`, `connection_health`,
  `provider_health`, `providers`, `model_prices`, `inference_usage`,
  `telegram_bots`, `slack_workspaces`, `knowledge_connectors` and
  `notification_preferences` all exist and hold real rows today. The mock below
  has the shape of those tables so that wiring it is a swap, not a rewrite.

  ## The honest bits

  Numbers marked `mocked` are shaped like the real thing and are not the real
  thing. Where a control cannot yet act, it says so rather than pretending —
  the same rule as the chat's "prototype" mark.
*/

import { CREW } from './data.js'
import { MARKS } from './logos/marks.js'

export const TABS = [
  { id: 'team', name: 'Team' },
  { id: 'behaviour', name: 'Behaviour' },
  { id: 'connections', name: 'Connections' },
  { id: 'channels', name: 'Channels' },
  /*
    "Usage", not "Models & cost".

    Grant asked for *"a dashboard dedicated to usage across the various API
    keys, third party services, you know, everything"* — and "Models & cost"
    names two things when the tab should name one. Models are now one card on
    it among six.
  */
  { id: 'models', name: 'Usage' },
  { id: 'appearance', name: 'Appearance' },
]

/** Shaped like `connection_health` joined to `knowledge_connectors`. */
const FALLBACK_CONNECTIONS = [
  { key: 'notion', state: 'ok', last: '2 days ago', used: 'Module pages, project mirrors', detail: '6 documents written' },
  { key: 'notebooklm', state: 'ok', last: '4 hours ago', used: 'The interview corpus', detail: '13 sources indexed' },
  { key: 'drive', state: 'ok', last: '1 day ago', used: 'Source documents', detail: '41 files visible' },
  { key: 'telegram', state: 'ok', last: 'live', used: 'Claire reaches you here', detail: 'Pager + chief bots' },
  { key: 'slack', state: 'ok', last: 'live', used: 'The office talks here', detail: '1 workspace, 6 channels' },
  { key: 'github', state: 'degraded', last: '1 day ago', used: 'Code and issues',
    detail: 'Read token flagged for rotation', fix: 'Rotate it' },
  { key: 'openrouter', state: 'ok', last: 'live', used: 'Inference for all eight', detail: '3 free models routed' },
  { key: 'supabase', state: 'ok', last: 'live', used: 'The database and the vault', detail: '170 migrations applied' },
  { key: 'zoom', state: 'off', last: 'never', used: 'Interview recordings', detail: 'Not connected',
    fix: 'Connect it' },
]

export const STATE_LABEL = {
  ok: 'Connected',
  attested: 'Connected',
  degraded: 'Needs attention',
  dead: 'Not working',
  missing: 'Not set up',
  parked: 'Parked',
  off: 'Not connected',
  /*
    Not the same as `unknown`, and the distinction matters on this page.

    Uploads, Drive and MCP have no health service because nothing probes them —
    they are not services with a status endpoint. "Unknown" says we cannot tell
    whether it works; this says we do not look, which is a fact about us rather
    than a doubt about them.
  */
  unchecked: 'Not checked',
  unknown: 'Unknown',
}

/** A state that is actually a problem, as opposed to one we simply do not probe. */
export const isWrong = (state) =>
  ['degraded', 'dead', 'missing', 'off'].includes(String(state))

/** Shaped like `autonomy_settings` + `tool_permissions`. */
const FALLBACK_BEHAVIOURS = [
  {
    id: 'autonomy', name: 'How much the team does without asking',
    kind: 'choice', value: 'standing',
    options: [
      { id: 'ask', name: 'Ask me first', note: 'Every external action waits for you.' },
      { id: 'standing', name: 'Standing authorization', note: 'Routine work proceeds. Consequential actions wait.' },
      { id: 'wide', name: 'Wide', note: 'Only purchases and destructive changes wait.' },
    ],
  },
  {
    id: 'chief', name: 'Only the Chief of Staff messages me',
    kind: 'switch', value: true,
    note: 'Everyone else still works and still writes output. They just do not send.',
  },
  {
    id: 'quiet', name: 'Quiet hours', kind: 'range', value: '22:00 – 07:00',
    note: 'Nothing but a genuine blocker reaches you.',
  },
  {
    id: 'browser', name: 'Agents may drive a browser',
    kind: 'switch', value: false,
    note: 'For services with no API. Never bypasses MFA or a security challenge.',
  },
  {
    id: 'undo', name: 'Keep everything undoable',
    kind: 'switch', value: true,
    note: 'Every action the office takes is recorded so it can be reversed.',
  },
]

/** Shaped like `telegram_bots`, `slack_channel_map`, `notification_preferences`. */
const FALLBACK_CHANNELS = [
  { key: 'telegram', name: 'Telegram', role: 'Claire, and the pager', state: 'ok',
    detail: 'Decisions buzz. Everything else is silent.' },
  { key: 'slack', name: 'Slack', role: 'The office floor', state: 'ok',
    detail: '6 channels — one per project, plus the queue.' },
  { key: 'zoom', name: 'Voice', role: 'Calling the team', state: 'ok',
    detail: 'Claire, with the whole office behind her.' },
  { key: 'drive', name: 'Email', role: 'Inbound only', state: 'degraded',
    detail: 'Read, not sent. Sending needs your say-so.' },
]

/*
  Shaped like `inference_usage` joined to `model_prices`. Mocked — EXCEPT the
  two numbers that would make Grant do something.

  This block used to say *"Supabase storage is at 82% of the free tier — 412 MB
  of 500 MB"* and warn that above 500 MB it starts costing. Nobody measured
  that. It was invented to make a mock look realistic, and it is the most
  consequential figure on the page: the hard constraint here is ~£0/month and
  500 MB is where the database stops being free. A person reading it would have
  started deleting things.

  The real figures, from `public.free_tier_headroom()` (migration 0180) on
  11 September 2026: **31 MB of 500 MB, 6.3%** in the database, and **41 MB of
  1024 MB, 4%** in storage across 67 objects. There is no warning to give.

  The rest stays mocked, and §14A permits that at M0 — but a mocked figure must
  be plausible, not alarming. When these are wired up, the RPC is the source:
  it also names the five largest tables, because "the database is at 6%" is a
  fact and "and 3.6 MB of it is documents" is an action.
*/
const FALLBACK_SPEND = {
  target: 'about £0 / month',
  month: '£0.00',
  rows: [
    { name: 'Inference — OpenRouter free tier', cost: '£0.00', note: '1,284 calls this month' },
    { name: 'Supabase', cost: '£0.00', note: '31 MB of 500 MB database · 41 MB of 1 GB storage' },
    { name: 'Vercel', cost: '£0.00', note: 'Hobby' },
    { name: 'Speech', cost: '£0.00', note: '38 minutes · free allowance' },
  ],
  /*
    Empty means there is nothing wrong, and the page must then show nothing —
    not an empty warning box with a warning icon in it, which is what an
    unconditional render gives you.
  */
  warn: '',
  headroom: 'Well inside every free tier: 6% of the database, 4% of storage.',
}

/*
  ---------------------------------------------------------------------------
  The real office (#68, ADR-0019)
  ---------------------------------------------------------------------------

  This file's own header said the mock was shaped like the tables *"so that
  wiring it is a swap, not a rewrite"*. It was, and this is the swap:
  `app.hq_studio_settings()` returns these exact shapes.

  The mock stays as the fallback, for the reason `data.js` gives — §14A's loop
  is render, capture, critique, and a design that cannot be looked at without a
  live backend is one nobody critiques on the morning the backend is down.
*/

export const CONNECTIONS = [...FALLBACK_CONNECTIONS]
export const BEHAVIOURS = [...FALLBACK_BEHAVIOURS]
export const CHANNELS = [...FALLBACK_CHANNELS]
export const SPEND = { ...FALLBACK_SPEND }
export const TEAM = []
export const SPARE_BOTS = []

export const settingsSource = { live: false, why: 'not asked yet' }

const replace = (target, rows) => {
  target.length = 0
  for (const r of rows) target.push(r)
}

/** Numbers a person can read. 1,284,067 tokens is not a quantity anyone feels. */
const readable = (n) => {
  const v = Number(n ?? 0)
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(v)
}

/**
 * Put the real office behind the same shapes.
 *
 * Forgiving, like `hydrate` in data.js: any failure leaves the mock and records
 * why, because a settings pane showing a stack trace is worse than one showing
 * a design.
 */
export async function hydrateSettings(read) {
  try {
    const d = await read('studio_settings')
    if (!d || !Array.isArray(d.behaviours)) throw new Error('unexpected shape')

    replace(TEAM, d.team ?? [])
    replace(SPARE_BOTS, d.spare_bots ?? [])
    replace(BEHAVIOURS, d.behaviours ?? [])
    replace(CONNECTIONS, d.connections ?? [])
    replace(CHANNELS, d.channels ?? [])

    /*
      Spend, from `usage_overview` — which distinguishes what a provider
      reported from what we counted ourselves, and that distinction survives
      into the sentence.

      `capacity.ts` established the rule and the morning briefing then broke it
      once: handed "35 of 40 by our own count, because Google publishes no usage
      API", a summariser produced "35/40 left" and an estimate became a fact on
      Grant's phone. So the caveat is part of the string here, not a footnote
      somebody may drop.
    */
    const u = d.usage ?? {}
    const head = d.headroom ?? {}
    const rows = []
    if (u.inference) {
      rows.push({
        name: 'Inference — OpenRouter free tier',
        cost: `£${Number(u.inference.cost_gbp ?? 0).toFixed(2)}`,
        note: `${readable(u.inference.calls)} calls · ${readable(u.inference.tokens)} tokens this month`,
      })
    }
    if (head.database) {
      rows.push({
        name: 'Supabase',
        cost: '£0.00',
        note: `${head.database.used_human ?? '?'} of ${head.database.limit_human ?? '500 MB'} database` +
          (head.storage ? ` · ${head.storage.used_human} of ${head.storage.limit_human} storage` : ''),
      })
    }
    if (u.notebook) {
      rows.push({
        name: 'NotebookLM',
        cost: '£0.00',
        // The hedge, in the row rather than in a note nobody reads.
        note: `${u.notebook.used ?? 0} of ${u.notebook.limit ?? 0} units today, by our own count — ` +
          'Google publishes no usage API',
      })
    }
    if (u.tts) {
      rows.push({
        name: 'Speech',
        cost: `£${Number(u.tts.cost_gbp ?? 0).toFixed(2)}`,
        note: `${u.tts.characters ? `${readable(u.tts.characters)} characters` : 'nothing spoken'} this month`,
      })
    }
    SPEND.rows = rows.length > 0 ? rows : FALLBACK_SPEND.rows
    SPEND.month = `£${Number(u.total_gbp ?? 0).toFixed(2)}`
    SPEND.target = 'about £0 / month'
    SPEND.headroom =
      head.database && head.storage
        ? `${head.database.percent ?? '?'}% of the database and ${head.storage.percent ?? '?'}% of storage.`
        : ''
    // Empty means nothing is wrong, and the page must then show nothing rather
    // than an empty warning box with a warning icon in it.
    SPEND.warn = u.warn ?? ''

    settingsSource.live = true
    settingsSource.why = ''
    return true
  } catch (e) {
    settingsSource.live = false
    settingsSource.why = e instanceof Error ? e.message : String(e)
    return false
  }
}

export const services = () => CONNECTIONS.map((c) => ({ ...c, ...(MARKS[c.key] ?? {}) }))
/*
  The team, real when it has been fetched.

  Falls back to CREW — the eight from `data.js`, which are themselves real
  people with design colours attached — so the pane renders before the settings
  payload arrives and on the morning it does not.
*/
export const staff = () => (TEAM.length > 0 ? TEAM : CREW)
