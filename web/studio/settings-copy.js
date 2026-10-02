/*
  The words Global Settings uses.

  The state of a setting comes from the office; the sentence a person reads about it is the page's. Several of the
  office's own descriptions were written for the engineer who added the setting ("Not built yet - tracked as issue 16",
  "A staff slug, or empty to let everyone message you directly") and live in SQL, which a settings redesign should not
  have to migrate. So this file holds the plain-language version, keyed by the setting's id. Where an id has no entry the
  office's own words are used, so a setting added tomorrow still appears - just in its author's voice until someone
  writes it a line here.

  One vocabulary: the product says "Team Chat" for typing to the team, "Talk to Team" for the live voice conversation,
  "Services" for the accounts the team can reach and "Project settings" for the other scope. Nothing below invents a
  second name for any of them.
*/

/** The four levels of autonomy. The server owns the ids and the value; these are the sentences. */
export const autonomy = {
  observe: {
    name: 'Watch only',
    note: 'Reads, thinks, and tells you what it sees. It does not write or start anything.',
  },
  suggest: {
    name: 'Ask me first',
    note: 'Researches and prepares drafts and recommendations. Anything that changes something waits for your yes.',
  },
  act_with_review: {
    name: 'Act, then show me',
    note: 'Routine work goes ahead and you see it afterwards. Anything that reaches outside Team HQ still waits for you.',
  },
  act: {
    name: 'Act',
    note: 'Goes ahead, including outside Team HQ. Deleting, spending, changing a key, and anything meant for another person still ask you first.',
  },
}

/** Switches that start work by themselves. */
export const behaviour = {
  read_new_sources: {
    name: 'Read new documents as they arrive',
    note: 'When a document appears in a connected folder, the team reads it without being asked.',
  },
  notebook: {
    name: 'Use NotebookLM',
    note: 'Lets the team read and write notebooks, and make audio overviews.',
  },
  calendar_tasks: {
    name: 'Show dated tasks in Google Calendar',
    note: 'A task with a due date appears as an all-day event and is removed when the task is done. The calendar never changes your tasks, and the team never touches an event it did not create.',
  },
}

/** What a permission is, in words. The ids are the office's; people do not read them. */
const TOOLS = {
  'calendar.read': 'Reading your calendar',
  'calendar.write': 'Putting tasks in your calendar',
  'document.create': 'Making finished documents',
  'draft.create': 'Writing drafts',
  'drive.ingest': 'Adding new Drive files to a project',
  'gmail.read': 'Reading your email',
  'gmail.search': 'Searching your email',
  'gmail.send': 'Sending email',
  'github.read': 'Reading code on GitHub',
  'github.write': 'Changing code on GitHub',
  'note.create': 'Writing internal notes',
  'notebook.read': 'Reading notebooks',
  'notebook.write': 'Adding to notebooks',
  'notion.write': 'Writing to Notion',
  'preference.update': 'Updating your notification preferences',
  'slack.channel': 'Creating Slack channels',
  'slack.post': 'Posting in Slack',
  'slack.rotate': 'Renewing the Slack connection',
  'task.board.write': 'Updating your other task list',
  'task.board.delete': 'Deleting from your other task list',
  'task.create': 'Creating tasks',
  'task.extract': 'Finding tasks inside documents',
  'web.read': 'Reading web pages you name',
  'web.search': 'Searching the web',
}

/** A permission's name for a person; an unknown one is made readable rather than shown as an id. */
export const toolName = (id) => {
  const known = TOOLS[String(id)]
  if (known !== undefined) return known
  const [a, b] = String(id ?? '').split('.')
  const word = (s) => String(s ?? '').replace(/[_-]+/g, ' ')
  const first = word(a)
  return b === undefined ? first : `${first.charAt(0).toUpperCase()}${first.slice(1)}: ${word(b)}`
}

/** The chief of staff's setting, in her own name rather than her job title. */
export const chief = (name) => ({
  name: `Only ${name} messages me`,
  note: 'On Telegram, everyone else still does the work but does not send messages. Slack shows each colleague under their own name.',
})

/**
 * The accent colours Team HQ can wear. The id is the stored `palette` value (it existed before Team HQ and means
 * something else in the classic studio); the name and colour are what a person sees. bc/tokens.css holds the same
 * colours as CSS and tests/web/settings-accents.test.ts fails if the two lists drift apart.
 */
export const ACCENTS = [
  { id: 'slate', name: 'Blue', color: '#6ab3fd' },
  { id: 'moss', name: 'Green', color: '#8cc96f' },
  { id: 'clay', name: 'Coral', color: '#f0a07e' },
  { id: 'ink', name: 'Gold', color: '#e8c88f' },
  { id: 'paper', name: 'Violet', color: '#b9a6f2' },
]

/** The word for a connection's state. One list, used by every row that shows one. */
export const state = {
  ok: ['ok', 'Connected'],
  attested: ['ok', 'Connected'],
  degraded: ['warn', 'Needs attention'],
  dead: ['bad', 'Not working'],
  missing: ['off', 'Not set up'],
  parked: ['off', 'Paused'],
  off: ['off', 'Not connected'],
  unchecked: ['off', 'Not checked'],
  unknown: ['off', 'Unknown'],
}
