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

import { CREW, DESIGN } from './data.js'
import { MARKS } from './logos/marks.js'

/*
  THE PAGE'S MAP.

  Nine tabs of one width became four groups that say what kind of thing is inside. The order is the order a person
  needs them: who works for me, how they reach the world, how it looks for me, and the machinery. `icon` names a
  drawing in settings-ui.js. `lead` is the one sentence under the page title - written for the person, not for the
  engineer who built the tab.

  Two tabs from the old list no longer exist and their ids still resolve (TAB_ALIAS), because a command-bar row, a link
  in a message or a remembered tab may still name them: Governance became Requests and What it has learned, and Setting
  up was a second checklist about the services the Services tab already lists.
*/
export const TAB_GROUPS = [
  {
    name: 'Your team',
    tabs: [
      { id: 'team', name: 'Team', icon: 'team', lead: 'The people who work for you. Bring in a specialist for a piece of work and they leave when it is finished.' },
      { id: 'behaviour', name: 'Autonomy and approvals', icon: 'autonomy', lead: 'How much the team does on its own, and what always waits for you.' },
      { id: 'requests', name: 'Requests', icon: 'requests', lead: 'Things the team is asking you to decide.' },
      { id: 'memory', name: 'What it has learned', icon: 'memory', lead: 'The rules and decisions the team now works by. You can take any of them back.' },
    ],
  },
  {
    name: 'Connections',
    tabs: [
      { id: 'connections', name: 'Services', icon: 'services', lead: 'The accounts and tools your team can reach, and whether each one is working.' },
      { id: 'channels', name: 'Messaging', icon: 'messaging', lead: 'How the team gets in touch with you, and where you can talk to it.' },
    ],
  },
  {
    name: 'You',
    tabs: [{ id: 'appearance', name: 'Appearance', icon: 'appearance', lead: 'How Team HQ looks on this device.' }],
  },
  {
    name: 'System',
    tabs: [
      { id: 'models', name: 'Usage and health', icon: 'system', lead: 'What the team is using, what it costs, and how well it is running.' },
      { id: 'help', name: 'Help', icon: 'help', lead: 'Short answers to the things people ask first.' },
    ],
  },
]

/** Every tab, flat - for the command bar and for anything that looks one up by id. */
export const TABS = TAB_GROUPS.flatMap((g) => g.tabs)

/** Old ids that still resolve, to the tab that now holds what they held. */
export const TAB_ALIAS = { governance: 'requests', setup: 'connections' }
export const tabId = (id) => {
  const want = TAB_ALIAS[id] ?? id
  return TABS.some((t) => t.id === want) ? want : 'team'
}

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
    kind: 'choice', value: 'suggest',
    /*
      The four levels `public.autonomy_level` actually has.

      This list used to read `ask | standing | wide` -- three names the enum
      does not contain, so every capture of this pane showed a dial offering
      options `hq_autonomy_set` refuses by name. The LIVE payload was right all
      along, which is why nothing went red: the prototype and the product had
      different vocabularies and only the prototype is what a capture sees.
    */
    options: [
      { id: 'observe', name: 'Watch only', note: 'The team notices, reads and thinks things through and tells you what it sees. It writes nothing - not even a draft - and starts nothing.' },
      { id: 'suggest', name: 'Ask me first', note: 'The team notices, researches and prepares drafts and recommendations on its own. Anything that leaves our own records waits for you.' },
      { id: 'act_with_review', name: 'Act, then show me', note: 'Routine work proceeds and lands in front of you afterwards. Anything that reaches outside still waits for you.' },
      { id: 'act', name: 'Act', note: 'The team acts, including outward. Deleting, spending, rotating a credential and anything meant for somebody else still stop and ask.' },
    ],
  },
  {
    id: 'chief', name: 'Only the Chief of Staff messages me',
    kind: 'switch', value: true,
    note: 'On Telegram, everyone else still works and still writes output; they just do not send. Slack shows each colleague under their own name.',
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

/*
  Shaped like `standing_authorizations` joined to `tool_permissions` (#15).

  Two rows, one live and one taken back, because the pane has to be judgeable
  in both states: a permission in force is the thing Grant audits, and one he
  revoked is the thing that tells him revoking works.
*/
/*
  Shaped like `app.decisions_so_far` (#129).

  Three rows, and the third is the one that makes the section worth having: a
  superseded decision beside the one that replaced it. "Both visible" is the
  Issue's own acceptance criterion, because a history that hides what it
  replaced cannot answer when the office changed its mind.
*/
const FALLBACK_DECISIONS = [
  {
    id: 'f-d1', live: true, by: 'grant', at: '2026-09-14T11:20:00Z',
    project: 'Legacy Coaching Course',
    question: 'Where do the module pages live?',
    chose: 'Notion',
    ruled_out: ['Google Drive', 'a folder of markdown files'],
    because: 'The team needs to edit in place, and Drive cannot do that without a round trip.',
    supersedes: null,
  },
  {
    id: 'f-d2', live: true, by: 'operations-director', at: '2026-09-10T15:05:00Z',
    project: null,
    question: 'Should the office chase an unanswered question?',
    chose: 'Once, after two days',
    ruled_out: ['Every day until answered', 'Never'],
    because: 'Four questions went stale in a fortnight and one daily chase read as nagging.',
    supersedes: null,
  },
  {
    id: 'f-d3', live: false, by: 'grant', at: '2026-08-28T09:40:00Z',
    project: 'Legacy Coaching Course',
    question: 'Where do the module pages live?',
    chose: 'Google Drive',
    ruled_out: ['Notion'],
    because: 'Everyone already had Drive open.',
    supersedes: null,
  },
]

const FALLBACK_STANDING = [
  {
    id: 'f-sa1', tool: 'drive.ingest', level: 2, live: true,
    what: 'Add a file that has appeared in a watched Drive folder to the project as a source document.',
    scope: 'Legacy Coaching Course', reason: 'You answered "Add them from now on without asking me" on 15 Sep.',
    by: 'grant', since: '2026-09-15T09:12:00Z', until: null, revoked: null, revoked_reason: null,
  },
  {
    id: 'f-sa2', tool: 'notion.write', level: 2, live: false,
    what: 'Create and update Notion pages.',
    scope: 'everywhere', reason: 'Let it write the weekly page without asking.',
    by: 'grant', since: '2026-09-02T16:40:00Z', until: null,
    revoked: '2026-09-11T08:05:00Z', revoked_reason: 'you took it back',
  },
]

/** Shaped like `telegram_bots`, `slack_channel_map`, `notification_preferences`. */
const FALLBACK_CHANNELS = [
  /*
    One bot, and it is Claire's (#70, 0352). It used to read "Claire, and the
    pager", which described two things when the registry held one row that was
    neither — the disagreement #70 was opened about. Grant retired the seven
    staff bots on 14 September; individuals are reached in Slack and here.
  */
  { key: 'telegram', name: 'Telegram', role: "Claire's bot, and only hers", state: 'ok',
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

/**
 * How much of Grant's correspondence the office is holding the WORDS of.
 *
 * #172 and ADR-0038. He authorised body caching; this is what that produced,
 * on the pane where he can disconnect Google. An authorisation with nothing
 * showing its effect is a setting with no reader.
 *
 * A mutable object rather than a `replace`d array because it is one row, and
 * the payload can legitimately be absent — an older gateway, or a read that
 * failed. `held` null means the office could not say, which is a different
 * fact from zero and the pane renders it as a different sentence.
 */
export const MAIL_BODIES = { bulk: 0, held: null, messages: 0, unread: 0 }

/*
  Whether Grant's tasks are being kept in step with anything (#259, Phase 2).

  `configured` is NULL until the office has answered, never false — 0420's
  lesson, which cost a Governance page reading "0 open" over fourteen rows.
  "Not connected" and "I have not asked yet" are different sentences and the
  card says so.
*/
export const TASK_SYNC = { configured: null, url: null, project: null, linked: 0, trouble: [] }
export const BEHAVIOURS = [...FALLBACK_BEHAVIOURS]
export const STANDING = [...FALLBACK_STANDING]
export const DECISIONS = [...FALLBACK_DECISIONS]
export const CHANNELS = [...FALLBACK_CHANNELS]
export const SPEND = { ...FALLBACK_SPEND }
export const TEAM = []
export const SPARE_BOTS = []
/** The first-run checklist, from `hq_setup`. Fetched with the rest. */
export const SETUP = {}

/**
 * What an agent can be asked to do to an asset (#27).
 *
 * From `public.asset_actions`, not a list in this file. They are rows so an
 * eighth is a row and not a coding session — and a page holding its own copy
 * is a page that disagrees with the office the first time one changes.
 *
 * The fallback is the six the specification names, for the same reason every
 * other fallback here exists: §14A's loop is render, capture, critique, and a
 * menu that is empty without a live backend is a menu nobody critiques.
 */
export const ACTIONS = [
  { action: 'review', label: 'Review', needs_two: false },
  { action: 'summarise', label: 'Summarise', needs_two: false },
  { action: 'research', label: 'Research', needs_two: false },
  { action: 'critique', label: 'Critique', needs_two: false },
  { action: 'extract_tasks', label: 'Extract tasks', needs_two: false },
  { action: 'compare', label: 'Compare', needs_two: true },
]

/*
  `state` says whether the office has answered: 'pending' until it has, then 'ready' or 'failed'. A signed-in person must
  never be shown the page's own example rows while it is pending (the prototype names things that resemble real
  projects), so the sections draw "asking" until it is 'ready'.
*/
export const settingsSource = { live: false, why: 'not asked yet', state: 'pending' }

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
/*
  Which state each conversation surface is in (#198).

  Its own read, allowed to fail on its own. Not folded into the settings
  payload: it is answerable without paying for that payload, and a failure here
  should cost this one block rather than blanking the whole Settings screen —
  the shape of #119, where one slow fetch in a Promise.all left the page
  saying everything was fine.

  Empty until it has been read. A card with invented states on it is exactly
  the defect #90 was about, and inventing "connected" is the reassuring
  direction, which is the worse one.
*/
export const CONVO_CHANNELS = []

/*
  Whether the person looking after this deployment is the one looking. The deployment-wide controls (who is on the team,
  tool grants, the shared Slack and Google connections, the switches that govern every office) are refused by the gateway
  to anybody else, so the page does not draw them as if they would work. True until the gateway says otherwise.
*/
export const VIEWER = { operator: true }

export async function hydrateSettings(read) {
  void read('conversation_channels')
    .then((rows) => {
      if (Array.isArray(rows)) {
        CONVO_CHANNELS.length = 0
        CONVO_CHANNELS.push(...rows)
      }
    })
    .catch(() => {
      CONVO_CHANNELS.length = 0
    })

  try {
    const d = await read('studio_settings')
    if (!d || !Array.isArray(d.behaviours)) throw new Error('unexpected shape')

    /*
      The design layer, merged back on.

      `hue` and `tone` are decisions from direction.md about perception and are
      not facts about a person, so they live in `data.js` and not in a column.
      Without this the Team pane rendered eight identical green discs, which is
      the exact failure that file's own comment describes: two people sharing a
      colour is worse than nobody having one, because it teaches you the colour
      means nothing.
    */
    replace(
      TEAM,
      (d.team ?? []).map((m) => ({
        ...(DESIGN[m.slug] ?? { hue: 'p-slate', tone: 210 }),
        ...m,
        // `slug` from DESIGN is the studio's short name and would overwrite the
        // real one, which everything that writes back needs.
        slug: m.slug,
        staffSlug: m.slug,
      })),
    )
    replace(SPARE_BOTS, d.spare_bots ?? [])
    replace(BEHAVIOURS, d.behaviours ?? [])
    // Only an explicit false changes what is drawn: a payload from an older gateway says nothing and offers everything.
    VIEWER.operator = d.viewer?.operator !== false

    /*
      Its own call, because it is its own section (#15).

      `standing` is a security surface: every permission in force, across every
      project, on one page. Folding it into `studio_settings` would make it
      arrive only when that pane loads, and would make an audit of what the
      office may do depend on a settings screen having been opened.

      Failing to read it leaves the prototype rows in place and the pane still
      renders, the same rule `hydrateGovernance` follows -- a settings tab
      showing a stack trace is worse than one saying it could not ask.

      But the rows left in place are INVENTED ones (names that resemble a real person's projects), and the payload
      above has just proved this is a live office. So until its own answer arrives, and if it never does, a signed-in
      person sees an empty list and not somebody else's example. Found by signing in as a second person: the Autonomy
      page named "Legacy Coaching Course" for as long as the read took.
    */
    replace(STANDING, [])
    replace(DECISIONS, [])
    read('standing')
      .then((rows) => {
        if (Array.isArray(rows)) replace(STANDING, rows)
      })
      .catch(() => undefined)

    /*
      And the task provider, its own call for the same reason: it belongs to
      one card on one tab and the settings payload is already large.
    */
    read('task_sync')
      .then((d2) => {
        if (d2 === null || typeof d2 !== 'object') return
        TASK_SYNC.configured = d2.configured === true
        TASK_SYNC.url = typeof d2.base_url === 'string' ? d2.base_url : null
        TASK_SYNC.project = typeof d2.project_id === 'number' ? d2.project_id : null
        TASK_SYNC.linked = typeof d2.linked === 'number' ? d2.linked : 0
        replace(TASK_SYNC.trouble, Array.isArray(d2.trouble) ? d2.trouble : [])
      })
      .catch(() => undefined)

    // And the decision log, the same way and for the same reason (#129).
    read('decisions')
      .then((rows) => {
        if (Array.isArray(rows)) replace(DECISIONS, rows)
      })
      .catch(() => undefined)
    replace(CONNECTIONS, d.connections ?? [])
    /*
      Three places have to learn a new key and two of them fail SILENTLY.
      CLAUDE.md records 0420: the Governance page rendered "0 open" over
      fourteen rows because the store and the hydrator did not carry
      `requests`, and `?? []` is indistinguishable from an office with nothing
      to report. So the absent case here is `null`, not zero.
    */
    const bodies = d.mail_bodies ?? null
    MAIL_BODIES.held = typeof bodies?.with_body === 'number' ? bodies.with_body : null
    MAIL_BODIES.messages = typeof bodies?.messages === 'number' ? bodies.messages : 0
    MAIL_BODIES.bulk = typeof bodies?.withheld_as_bulk === 'number' ? bodies.withheld_as_bulk : 0
    MAIL_BODIES.unread = typeof bodies?.never_looked === 'number' ? bodies.never_looked : 0
    replace(CHANNELS, d.channels ?? [])

    /*
      Its own call for the same reason `studio_setup` is: the named actions are
      a vocabulary the whole product uses, not a preference on a settings page,
      and folding them into this payload would make every asset card depend on
      the settings pane having loaded.
    */
    try {
      const actions = await read('actions')
      if (Array.isArray(actions) && actions.length > 0) replace(ACTIONS, actions)
    } catch {
      // The six from the specification stay. A menu is better than no menu.
    }

    // Its own call: `hq_setup` is a different function with a different job,
    // and folding it into the settings payload would couple a checklist about
    // credentials to a page about preferences.
    try {
      const setup = await read('studio_setup')
      for (const k of Object.keys(SETUP)) delete SETUP[k]
      Object.assign(SETUP, setup ?? {})
    } catch {
      // A settings page that cannot show a checklist is still a settings page.
    }

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
    settingsSource.state = 'ready'
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('hq:viewer'))
    return true
  } catch (e) {
    settingsSource.live = false
    settingsSource.state = 'failed'
    settingsSource.why = e instanceof Error ? e.message : String(e)
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('hq:viewer'))
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


/*
  Where pressing a service's button actually goes (#89, #92).

  Every one of these already existed somewhere. Google's OAuth start has worked
  for weeks — it was an anchor buried in the "Setting up" tab, three tabs away
  from the card Grant pressed. Notion's token, GitHub's token and NotebookLM's
  credential are all in the same place. The channels have their own tab.

  So this is not new capability. It is a map from the card a person presses to
  the flow that already exists, which is the whole of what was missing: §31
  treats an avoidable request for manual configuration as a design failure, and
  "find the right tab yourself" is exactly that.

  `how` says what kind of destination it is, because the three behave
  differently: 'oauth' leaves the page for a provider and comes back, 'tab'
  moves within Settings, and 'none' is an honest dead end that says so rather
  than pretending.
*/
/*
  `off` names what disconnecting a service means, and only appears where a
  disconnect is real (#90).

  Three fields, and each earns its place:

  - `off` is the service key `app.hq_disconnect` takes. Its absence is the
    signal that there is no disconnect, so a card cannot draw the button by
    accident. Grant: the page asserting a connection that is not there is
    worse than no button.
  - `costs` goes in the confirmation. Destructive actions are confirmed
    (CLAUDE.md), and a confirmation that says "are you sure?" and nothing else
    reads as "will this delete my work" — so it names what stops AND what
    stays.
  - `revokeAt` is where consent is withdrawn at the PROVIDER. Deleting our copy
    of a credential is not revoking it, and the honest thing is to say so with
    the URL rather than claim a revocation that did not happen.
*/
export const ROUTES = {
  drive: {
    how: 'oauth', family: 'google', label: 'Connect Google', off: 'google',
    costs:
      'The team stops being able to read your Drive, calendar and mail. Everything ' +
      'it already read stays. Reconnecting is one consent screen.',
    revokeAt: 'https://myaccount.google.com/permissions',
  },
  calendar: {
    how: 'oauth', family: 'google', label: 'Connect Google', off: 'google',
    costs:
      'The team stops being able to read your calendar and mail, and calendar ' +
      'reading switches off. Everything already read stays.',
    revokeAt: 'https://myaccount.google.com/permissions',
  },
  gmail: {
    how: 'oauth', family: 'google', label: 'Connect Google', off: 'google',
    costs:
      'The team stops being able to read your mail, calendar and Drive. ' +
      'Everything already read stays.',
    revokeAt: 'https://myaccount.google.com/permissions',
  },
  notebooklm: {
    how: 'tab', to: 'setup', label: 'Set up in Setting up', off: 'notebooklm',
    costs:
      'Audio overviews, mind maps and briefings stop being made, and generation ' +
      'switches off. Notebooks already attached to a dashboard project stay ' +
      'attached, and what they produced stays.',
    revokeAt: 'https://notebooklm.google.com',
  },
  notion: {
    how: 'tab', to: 'setup', label: 'Set up in Setting up', off: 'notion',
    costs:
      'The office stops being able to read Notion. Pages it already imported ' +
      'stay — ADR-0013: a route may be closed and the corpus is kept.',
    revokeAt: 'https://www.notion.so/profile/integrations',
  },
  github: { how: 'tab', to: 'setup', label: 'Set up in Setting up' },
  openrouter: { how: 'tab', to: 'models', label: 'Set up in Models' },
  supabase: { how: 'tab', to: 'setup', label: 'Set up in Setting up' },
  /*
    Slack and Telegram can now be disconnected (#198, migration 0350).

    Both were previously set up only — the RPC refused to disconnect them and
    was right to while the alternative was a lie. What changed is not that the
    refusal was wrong but that the answer can now be honest: `hq_disconnect`
    says what stopped, says plainly what was NOT revoked, and gives the exact
    steps only Grant can take.

    `costs` is what he reads before confirming, so it names what STAYS as
    loudly as what stops — 0014's canonical-store claim is the whole reassurance
    here, and a person about to press a red button is not in the mood to infer
    it.
  */
  telegram: {
    how: 'tab', to: 'channels', label: 'Set up in Channels', off: 'telegram',
    costs:
      'The office stops sending and receiving on Telegram, and the chief bot ' +
      'token is deleted here. Everything already said there is kept and stays ' +
      'in the conversation. The staff bots are not touched. Only BotFather can ' +
      'revoke the token itself — the office will tell you how.',
    revokeAt: 'https://t.me/BotFather',
  },
  slack: {
    how: 'tab', to: 'channels', label: 'Set up in Channels', off: 'slack',
    costs:
      'The office stops reading and posting in Slack. Every message already ' +
      'there stays, and so does everything recorded from it. The app stays ' +
      'installed in the workspace until you remove it at Slack — the office ' +
      'will tell you how.',
    revokeAt: 'https://api.slack.com/apps',
  },
  /*
    MCP opens its own view rather than sending you to another tab (#91).

    It is the one connection whose "how do I use this" answer is a URL, a list
    of tools and a procedure — none of which lives in Setting up, which is
    where this used to point.
  */
  mcp: { how: 'mcp', label: 'How to connect a client' },
  upload: {
    how: 'none',
    label: 'Always available',
    why: 'Dropping a file into a project needs no connection. It is kept with that project.',
  },
  zoom: {
    how: 'none',
    label: 'Not supported yet',
    why: 'Nothing in the office reads Zoom yet. Recordings reach it through Drive.',
  },
}

/** The route for a service, or an honest unknown. */
export const routeFor = (key) =>
  ROUTES[key] ?? {
    how: 'none',
    label: 'No route yet',
    why: 'This service has no connect flow in the studio. It is set up outside it.',
  }

/*
  Whether a service counts as connected.

  Deliberately NOT `state === 'ok'`. `attested` means we cannot poll it and
  someone has vouched for it, which is still connected; `degraded` is connected
  and unwell, and offering Connect on it would be wrong — the thing to offer is
  the fix.
*/
export const isConnected = (state) =>
  state === 'ok' || state === 'attested' || state === 'degraded'


/*
  The MCP server's own page (#91), fetched on demand.

  Not part of `hq_studio_settings`: it reads three tables nobody else touches,
  and putting it in the shared payload would make every settings open pay for
  it. Same reasoning as `lately`.
*/
export const MCP = { loaded: false, url: '', tools: [], clients: [], recent: [], steps: [] }

/*
  The office as a CLIENT — providers it has registered (#265).

  Distinct from `MCP` above, which is the office as a SERVER: what Grant's
  ChatGPT connects to. This is the other direction, and the two were confused
  once already — `mcp_inventory` shipped as a gateway section and no page ever
  read it, so a whole side of the integration was invisible.

  Rows rather than an empty list for the same reason every fallback here has
  them: nothing is registered yet, and a design that can only be seen once
  somebody connects something is a design nobody has judged.
*/
/*
  The keys are `mcp_inventory`'s own, not a prototype vocabulary.

  The first version of this fallback said `healthy` and `detail` and `enabled`;
  the payload says `last_probe_ok`, `last_probe_detail` and `usable`. With no
  provider registered the grid was empty, so nothing ever rendered from the
  real shape and the disagreement was invisible — which is exactly the trap
  CLAUDE.md records about the autonomy levels: the prototype and the product
  held two vocabularies for one thing, and only the prototype is what a capture
  sees.
*/
const FALLBACK_PROVIDERS = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'weather-mcp', display_name: 'Weather MCP', endpoint: 'https://example.test/mcp',
    last_probe_ok: true, discovered: 6, offered: 2, usable: 1,
    last_probe_at: '2026-09-17T09:30:00Z',
    tools: [
      { id: '00000000-0000-4000-8000-0000000000b1', name: 'get_forecast', reach: 'read',
        offered_as: 'weather.forecast', usable: true, gone: false },
      { id: '00000000-0000-4000-8000-0000000000b2', name: 'set_alert', reach: 'write',
        offered_as: null, usable: false, gone: false },
    ],
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    name: 'crm-mcp', display_name: 'A CRM', endpoint: 'https://example.test/crm',
    last_probe_ok: false, discovered: 11, offered: 0, usable: 0,
    last_probe_at: '2026-09-16T22:02:00Z',
    last_probe_detail: 'it did not answer',
    tools: [
      { id: '00000000-0000-4000-8000-0000000000b3', name: 'delete_contact',
        reach: 'destructive', offered_as: null, usable: false, gone: false },
    ],
  },
]

export const PROVIDERS = { loaded: false, rows: [...FALLBACK_PROVIDERS] }

export async function hydrateProviders(read) {
  try {
    const d = await read('connectors')
    PROVIDERS.rows = Array.isArray(d) ? d : []
    PROVIDERS.loaded = true
  } catch {
    PROVIDERS.loaded = false
  }
  return PROVIDERS
}

export async function hydrateMcp(read) {
  try {
    const d = await read('mcp')
    if (!d || typeof d.url !== 'string') throw new Error('unexpected shape')
    Object.assign(MCP, d, { loaded: true })
  } catch {
    // A settings tab that shows a stack trace is worse than one that says it
    // could not ask. `loaded` stays false and the panel says so.
    MCP.loaded = false
  }
  return MCP
}


/*
  What the office learned, wants, noticed, and could not do (#54, migration
  0302), fetched on demand.

  Not part of `hq_studio_settings`, for the reason MCP is not: four tables
  nobody else on a settings open touches, and most opens are not about
  governance.

  `loaded` starts false and the panel says "asking the office" rather than
  drawing four empty lists — an empty governance page and an unreachable one
  look identical, and only one of them is good news.
*/
/*
  Shaped like `hq_governance` (0302), and standing in for it in the prototype.

  Rows rather than empty lists, for the reason `FALLBACK_CONNECTIONS` has rows:
  a design cannot be judged against nothing, and `npm run shots` runs with no
  token. The page already declares itself — with no token the studio banners
  "Nothing on this page is your office" — so this is never mistaken for his
  office, and `governanceTab` only draws it when that banner is up.
*/
const FALLBACK_GOVERNANCE = {
  lessons: [
    {
      id: 'f-l1', scope: 'global', where: 'everywhere', who: 'grant', seen: 3,
      job: '8f21ac04-0000-0000-0000-000000000000',
      body: 'Always paste the image URLs into the reply as well — a screenshot that only exists on the build page is one I have to go and find, and I will not.',
      at: '2026-09-10T18:04:00Z',
    },
    {
      id: 'f-l2', scope: 'project', where: 'INNERGY positioning', who: 'tom', seen: 2,
      job: '3c90bb71-0000-0000-0000-000000000000',
      body: 'This project wants the argument before the evidence. Leading with the research reads as hedging.',
      at: '2026-09-09T09:40:00Z',
    },
    {
      id: 'f-l3', scope: 'job_kind', where: 'research', who: 'emma', seen: 7,
      job: 'b0417e2a-0000-0000-0000-000000000000',
      body: 'A source without a date is not a source. Say when it was published or say that it does not say.',
      at: '2026-09-07T14:12:00Z',
    },
  ],
  proposals: [
    {
      id: 'f-p1', who: 'emma', title: 'Reading a page on the open web',
      remedy: 'web.search', state: 'open', times: 9, cost: 'Free tier, 100 lookups a day',
      argument: 'Nine research jobs in thirty days ended with a citation I could name but not read. I can reach Notion and Drive; I cannot open a URL.',
      decided: null, note: null,
    },
    {
      id: 'f-p2', who: 'marcus', title: 'Writing to the calendar',
      remedy: 'calendar.write', state: 'declined', times: 4, cost: 'None — the token exists',
      argument: 'Four dated tasks were agreed and then missed because nothing put them anywhere you look.',
      decided: '2026-09-08T11:00:00Z',
      note: 'Not yet — I want to see a month of dated tasks land correctly first.',
    },
  ],
  /*
    Two requests for reach, one open and one already answered (#272).

    The prototype needs both states or the design cannot be judged: an open
    request is the pair of buttons, and a declined one is the durable verdict
    with Grant's own reason under it, which is #49's whole argument.

    `because` is JSONB holding counts, not prose -- the card renders it as
    chips through the same evidence() the noticing pass uses.
  */
  /*
    One No still being remembered (ADR-0053). The prototype needs one or the
    card and its press cannot be judged, and verify:wired cannot see a control
    that is only drawn when a row exists.
  */
  refusals: [
    {
      id: 'f-n1', what: 'Put the module outline in Notion', project: 'Legacy Coaching Course',
      declined_at: '2026-09-28T09:00:00Z', until: '2026-10-28T09:00:00Z', by: 'grant',
    },
  ],
  requests: [
    {
      id: 'f-r1', tool: 'calendar.write', who: 'growth-director', who_name: 'Ruby',
      what_for: 'Booking the follow-ups a campaign needs. Doing it by hand is the whole delay.',
      because: { times: 3, jobs_stalled: 3 }, state: 'open', declines: 0,
      at: '2026-09-15T08:30:00Z', settled: null, reason: null,
    },
    {
      id: 'f-r2', tool: 'github.write', who: 'operations-director', who_name: 'Marcus',
      what_for: 'Pushing the change once the diff is agreed, instead of stopping at the diff.',
      because: { times: 3 }, state: 'declined', declines: 1,
      at: '2026-09-12T16:05:00Z', settled: '2026-09-12T18:40:00Z',
      reason: 'Not while it can push to main. Ask again when there is a branch rule.',
    },
  ],
  noticed: [
    {
      id: 'f-s1', kind: 'attach', state: 'open', weight: 0.82, dismissed: 0,
      project: 'INNERGY positioning',
      body: 'This project has eleven documents and no notebook.',
      because: { documents: 11, notebooks: 0, projects_like_it_with_one: 4 },
      at: '2026-09-11T07:20:00Z',
    },
    {
      id: 'f-s2', kind: 'routine', state: 'dismissed', weight: 0.44, dismissed: 4,
      project: null,
      body: 'A Friday summary of the week, unprompted.',
      because: { fridays_you_asked: 4, weeks_running: 6 },
      at: '2026-09-05T16:00:00Z',
    },
    /*
      A drafted standing rule, which is the one kind of suggestion that carries
      a DECISION rather than a note (#147).

      Here, in the prototype data, because a control that only appears when the
      live office happens to hold the right row is a control no audit in this
      repository can see. The command bar cost a screen naming a view that had
      been deleted for exactly this reason, and the fix there was the same
      thing: make the data the audits run against contain the case.

      The body is the drafted rule verbatim — what Grant reads is what gets
      stored — and `offer` is what tells the page to draw Accept and Decline at
      all. `because` holds the cheap signals that recognised the correction,
      which is the honest answer to "why are you asking me this".
    */
    {
      id: 'f-s3', kind: 'standing_rule', state: 'open', weight: 3, dismissed: 0,
      project: null, offer: 'learn',
      body: 'From now on, put the summary at the end of the message, not after every bullet.',
      because: { followed_an_answer: true, words: 9, opened_with_a_rejection: true },
      at: '2026-09-16T06:40:00Z',
    },
  ],
  agents: [
    {
      slug: 'chief-of-staff', name: 'Claire', remit: 'Chief of Staff', tools: 14,
      expertise: ['routing', 'summarising', 'chasing'],
      tried_and_could_not: [],
    },
    {
      slug: 'research-lead', name: 'Emma', remit: 'Research', tools: 9,
      expertise: ['desk research', 'synthesis'],
      tried_and_could_not: [
        { kind: 'missing_tool', needed: 'web.search', times: 9 },
        { kind: 'needs_permission', needed: 'drive.write', times: 2 },
      ],
    },
    {
      slug: 'operations-lead', name: 'Marcus', remit: 'Operations', tools: 11,
      expertise: ['scheduling', 'follow-through'],
      tried_and_could_not: [{ kind: 'missing_tool', needed: 'calendar.write', times: 4 }],
    },
  ],
  /*
    Invented, and only ever drawn behind the no-token banner. Both of these
    are usually EMPTY in a healthy office, and a design that can only be seen
    when something is wrong is a design nobody has judged.
  */
  stranded: {
    total: 2,
    oldest: '2026-09-16T22:10:00Z',
    why: 'These need a runtime that can run a local process. The only worker is a Supabase Edge Function, and Deno has none. They wait rather than fail, so they run the moment one exists.',
    kinds: [
      { kind: 'notebook.read', waiting: 2 },
    ],
  },
  scoring: [
    { at: '2026-09-14T16:58:22Z', cases: 18, agreed: 16, mean_score: 2.78, judge_model: 'a free model', note: '2 case(s) unreadable' },
    { at: '2026-09-14T16:46:54Z', cases: 19, agreed: 16, mean_score: 2.95, judge_model: 'a free model', note: '1 case(s) unreadable' },
  ],
  /*
    Invented triggers, behind the no-token banner (#264). None is configured
    in the real office yet, and a section that renders nothing is a section
    nobody can judge — which is how the trigger framework came to be built,
    verified and completely invisible.
  */
  triggers: [
    {
      name: 'notes-to-tasks', source: 'office', event_type: 'document.added',
      job_kind: 'office.extract_tasks', enabled: true, fired: 4, declined: 1,
      last_fired: '2026-09-17T08:12:00Z',
      last_declined: { why: 'it last fired 40 seconds ago and the cooldown is 3600' },
    },
    {
      name: 'stale-connection', source: 'office', event_type: 'connection.failing',
      job_kind: 'office.instruction', enabled: false, fired: 0, declined: 0,
      last_fired: null, last_declined: null,
    },
  ],
}

export const GOVERNANCE = {
  loaded: false,
  at: null,
  lessons: [...FALLBACK_GOVERNANCE.lessons],
  proposals: [...FALLBACK_GOVERNANCE.proposals],
  noticed: [...FALLBACK_GOVERNANCE.noticed],
  agents: [...FALLBACK_GOVERNANCE.agents],
  requests: [...FALLBACK_GOVERNANCE.requests],
  refusals: [...FALLBACK_GOVERNANCE.refusals],
  stranded: { ...FALLBACK_GOVERNANCE.stranded },
  scoring: [...FALLBACK_GOVERNANCE.scoring],
  triggers: [...FALLBACK_GOVERNANCE.triggers],
}

export async function hydrateGovernance(read) {
  try {
    /*
      Two reads, not one (#264).

      `triggers` is its own section because an agent holding the bearer token
      should be able to ask what is listening without pulling the whole
      governance payload. The PAGE wants both on one screen, so it asks for
      both at once rather than folding the section into the payload and
      leaving the section with no caller — which is the defect this work is
      about, and it would be poor form to create another one closing it.

      Settled, not awaited as a pair: a failing trigger read must not take the
      governance page down with it.
    */
    const [d, t] = await Promise.all([
      read('governance'),
      read('triggers').catch(() => null),
    ])
    if (!d || !Array.isArray(d.lessons)) throw new Error('unexpected shape')
    Object.assign(GOVERNANCE, {
      at: d.at ?? null,
      lessons: d.lessons ?? [],
      proposals: d.proposals ?? [],
      noticed: d.noticed ?? [],
      agents: d.agents ?? [],
      /*
        `requests` is newer than the rest of this payload (#272), so an
        `hq-api` deployed before migration 0420 returns four keys and not five.
        Defaulted here rather than guarded at the renderer, so there is one
        place that knows the shape.
      */
      requests: d.requests ?? [],
      /*
        `refusals` arrives from migration 0612 (ADR-0053); a gateway deployed
        before it returns none, which is an empty list here and nowhere else.
      */
      refusals: Array.isArray(d.refusals) ? d.refusals : [],
      /*
        Same rule, two keys later (#272). `stranded` and `scoring` arrive from
        migration 0451, so an hq-api deployed before it returns neither — and
        this is the ONE place that knows the shape, because CLAUDE.md records
        exactly this defect: a payload gained `requests`, the store and the
        hydrator did not learn it, and the page rendered "0 open" over
        fourteen rows without anything going red.
      */
      stranded: d.stranded ?? { total: 0, kinds: [], oldest: null, why: '' },
      scoring: Array.isArray(d.scoring) ? d.scoring : [],
      triggers: Array.isArray(t) ? t : [],
      loaded: true,
    })
  } catch {
    // Same rule as `hydrateMcp`: a settings tab showing a stack trace is worse
    // than one saying it could not ask.
    GOVERNANCE.loaded = false
  }
  return GOVERNANCE
}
