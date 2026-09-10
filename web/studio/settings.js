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
  { id: 'models', name: 'Models & cost' },
  { id: 'appearance', name: 'Appearance' },
]

/** Shaped like `connection_health` joined to `knowledge_connectors`. */
export const CONNECTIONS = [
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
  degraded: 'Needs attention',
  off: 'Not connected',
}

/** Shaped like `autonomy_settings` + `tool_permissions`. */
export const BEHAVIOURS = [
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
export const CHANNELS = [
  { key: 'telegram', name: 'Telegram', role: 'Claire, and the pager', state: 'ok',
    detail: 'Decisions buzz. Everything else is silent.' },
  { key: 'slack', name: 'Slack', role: 'The office floor', state: 'ok',
    detail: '6 channels — one per project, plus the queue.' },
  { key: 'zoom', name: 'Voice', role: 'Calling the team', state: 'ok',
    detail: 'Claire, with the whole office behind her.' },
  { key: 'drive', name: 'Email', role: 'Inbound only', state: 'degraded',
    detail: 'Read, not sent. Sending needs your say-so.' },
]

/** Shaped like `inference_usage` joined to `model_prices`. Mocked figures. */
export const SPEND = {
  target: 'about £0 / month',
  month: '£0.00',
  rows: [
    { name: 'Inference — OpenRouter free tier', cost: '£0.00', note: '1,284 calls this month' },
    { name: 'Supabase', cost: '£0.00', note: '412 MB of 500 MB · free tier' },
    { name: 'Vercel', cost: '£0.00', note: 'Hobby' },
    { name: 'Speech', cost: '£0.00', note: '38 minutes · free allowance' },
  ],
  warn: 'Supabase storage is at 82% of the free tier. Above 500 MB it starts costing.',
}

export const services = () => CONNECTIONS.map((c) => ({ ...c, ...MARKS[c.key] }))
export const staff = () => CREW
