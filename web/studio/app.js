/*
  The M0 prototype.

  Static ES modules, no bundler, no framework — Option 2 of the integration
  assessment. What it is proving is not that a dashboard can be built, but that
  the interaction quality §14A demands is reachable without a framework. If it
  is not, that is evidence for React and this file becomes the specification.
*/

import {
  CREW,
  FROM_OFFICE,
  PROJECTS,
  SOURCE_STATE,
  WAITING,
  byId,
  crewBy,
  health,
  hydrate,
  source,
} from './data.js'
import { act, attempt, canWrite, onWrite, read, say, sure, token, why, presented, presentedFresh} from './office.js'
/*
  The experimental Basecamp-inspired Team HQ (basecamp_clone.md).

  Imported unconditionally and rendered only at the /basecamp prefix. Three
  small modules rather than another few thousand lines in this file: the spec
  warns by name against appending a second all-screen implementation to a file
  that is already 600 KB, and a separate module is also the only way the two
  presentations can be diffed against one another.
*/
import * as bc from './bc/shell.js'
import * as bcJump from './bc/jump.js'
import * as bcNotes from './bc/notestore.js'
import * as bcSession from './session.js'
import * as bcGrid from './bc/layout.js'
import * as bcWire from './bc/wire.js'
import * as plane from './plane.js'
import * as undo from './undo.js'
import { DENSITIES, PALETTES, TEXTURES, SCHEMES, appearance, apply, hydrate as hydrateAppearance, readTexture, saveWith, toggleScheme, activeScheme } from './appearance.js'
import * as canvasView from './canvas.js'
import * as chat from './chat.js'
import * as dictate from './dictate.js'
import * as command from './command.js'
import * as config from './settings.js'
import { wireCall, unwireCall, syncCallButtons, callIsLive, toggleCall } from './call.js'
import { hydrateUsage, usageTab } from './usage.js'
import { MARKS } from './logos/marks.js'
import * as workspace from './workspace.js'
import * as panels from './panels.js'
import * as pulse from './pulse.js'
import * as people from './people.js'
import * as projectSettings from './project-settings.js'
import * as when from './when.js'
import { ambient, breathe, scatter, tiltable } from './alive.js'
import { coverSvg } from './cover.js'
import * as icons from './icons.js'
import { pageSvg } from './page.js'
import { paint } from './pdf.js'
import { SPRING, carry, pressable, spring } from './motion.js'

const $ = (sel, root = document) => root.querySelector(sel)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/*
  A message body, with its line breaks intact (#209).

  HTML collapses whitespace, so a body rendered as one escaped string inside a
  single paragraph tag loses every newline in it. That is what the studio did,
  and it means #186's whole outcome — two or three short paragraphs, one
  thought each, instead of a wall — has NEVER been visible here. The model was
  writing it, Telegram and Slack were showing it, and this surface ran it all
  together into one block.

  Grant asked for numbered lists on 14 September and that is what made it
  visible: a three-item list arrives as one line reading 1. first 2. second
  3. third, which is worse than the prose it replaced.

  Blank line starts a paragraph; a single newline is a line break inside one.
  That is the whole rule, and it is deliberately NOT a markdown renderer — §5
  says an adapter may only translate, and the three surfaces have three markup
  languages. The model writes one plain-text body; each surface renders the
  breaks in its own. Telegram and Slack already did.

  Escaped first, then the tags are added, for the reason the Telegram escaper
  gives: convert-then-escape turns the tags you just added into visible text.
*/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
const prose = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n')
      const items = lines.map((l) => NUMBERED.exec(l))
      /*
        A paragraph whose every line is numbered becomes a real list.

        Line breaks alone were not enough, and the phone capture is what
        showed it: with each item on its own line but wrapping at 390px, the
        continuation of item 1 started in exactly the column item 2 started
        in, so three items read as five and the shape Grant asked for was
        gone at the width he reads on.

        An ordered list gets the hanging indent for nothing, and it gets the
        semantics too — a screen reader says "list, 3 items" before reading
        them, which is the same affordance the thread itself gained in #200.

        Still not a markdown renderer, and the distinction is the one in
        section 5: this translates a line break into the markup THIS surface
        uses for it. Telegram and Slack translate the same body into theirs.
        Nothing here parses emphasis, links or headings.

        The literal number is dropped and replaced by the start attribute, so
        a model that begins at 1 gets 1 and a model that continues from 4
        gets 4 — but a model that writes 1, 2, 2, 5 gets a list that counts
        properly rather than a transcription of its mistake.
      */
      if (lines.length >= 2 && items.every((m) => m !== null)) {
        const from = Number(items[0][1])
        return `<ol class="msglist"${from === 1 ? '' : ` start="${from}"`}>${items
          .map((m) => `<li>${esc(m[2])}</li>`)
          .join('')}</ol>`
      }
      return `<p>${esc(para).replace(/\n/g, '<br>')}</p>`
    })
    .join('')

/*
  Payloads that belong to one screen rather than to the whole shell.

  Declared HERE, beside `state`, rather than beside the functions that fetch it
  — because `rail()` reads `latest.tasks` to put a count on the Tasks entry, and
  `render()` runs during module evaluation. A `const` further down the file is
  in the temporal dead zone at that moment, and the page rendered NOTHING with
  "Cannot access 'latest' before initialization" in the console. Nothing else
  reports that: `check:templates` passes, and `npm run smoke` announces it as a
  timeout waiting for a selector that cannot exist.
*/
const latest = { lately: null, tasks: null }

/*
  The waiting-time ticker's handle, declared HERE for the reason directly
  above — the second instance of that trap, found by printing page errors
  during #221's captures rather than by anything that was watching for it.

  `tickWaiting` is a function DECLARATION, so it hoists and `render()` can
  reach it during module evaluation. `let ageTimer` three hundred lines further
  down does not hoist, so the first tick threw "Cannot access 'ageTimer' before
  initialization" and the page reported "The studio could not draw this
  screen." Every later render worked, which is exactly why nobody saw it: the
  studio recovers on the next draw and the only trace is one console line.

  A hoisted `var` would have hidden it rather than fixed it — `ageTimer` would
  be `undefined`, the `=== null` guard would be false, and the ticker would
  never start. The declaration belongs where the code that uses it can see it.
*/
let ageTimer = null

/*
  The map, per project (#25).

  Keyed by slug and kept out of `latest` because those two are portfolio-wide
  and these are not: a second project's map must not show the first one's cards
  for the moment between opening it and the fetch landing. `maps` holds the
  graph, `placed` holds where he put the cards and how far he zoomed.
*/
/*
  A project's story, fetched once per project (#156).

  Same shape as `maps` and for the same reason: undefined means nobody has
  asked, null means the ask is in flight, an array means it answered. Three
  states rather than two, because "loading" and "empty" are different things
  to show and collapsing them is how a panel says "nothing here" about a
  project with ten years in it.
*/
const stories = {}
/*
  What a project's notebook has MADE, fetched once per project (#260).

  Same three states as `stories` and for the same reason: undefined means
  nobody has asked, null means the ask is in flight, an array means it
  answered. Kept apart from `p.sources` deliberately — the Issue's own
  acceptance line is that source material and generated artifacts are clearly
  distinguished, and one list holding both is how that stops being true.
*/
const notebookMade = {}
/*
  What the team has made and Grant has not decided about (#28, #276).

  Same three states as the two above: undefined means nobody has asked, null
  means the ask is in flight, an array means it answered. No mock, ever — a
  prototype that invents a review queue is inviting a press that would approve
  a document which does not exist, and every other lazy block here mocks only
  a SHAPE. An empty queue is the ordinary case and says nothing at all.
*/
const reviewing = {}
/* Signed-in sites, and what the office opened on them (#135, #16). */
const browserSites = {}
const browserSeen = {}
const browserNow = {}
let browserLeft = null
/*
  Archived projects worth bringing back (#276, migration 0480).

  undefined = never asked, null = the ask is in flight or it failed, an array
  means it answered. Never mocked: an invented row here would offer to
  un-archive a project that does not exist, which is the press that cannot
  work, and the list is empty in the ordinary case anyway.
*/
let recoverable
/*
  How far a running job has got (#263, #276).

  Keyed by job id. `app.job_progress` has been a gateway section since the
  resumption work and nothing read it, so the one place in the product with a
  Stop button showed no progress at all — Stop with nothing beside it asks
  Grant to decide whether to kill something without telling him how far it is.
*/
const progress = {}

/*
  MY TASKS (#259, ADR-0041).

  Grant's own list, which is the same table as the office's project tasks with
  `assigned_to_human` true — a column that had been modelled since #11, had
  never once been set, and was read by nothing.

  Keyed by bucket, because the seven views are seven filters over one list and
  re-fetching on every tab press is seven round trips for something that has
  not changed. The counts come back in ONE call beside them.
*/
const mine = {
  bucket: 'today',
  lists: {},
  counts: null,
  editing: null,
  trouble: {},
  /*
    What is typed in the search box and which order the list is in (#259).

    Both live here rather than in the DOM because `render()` rebuilds the
    screen and anything held only in an input is gone at the next draw — the
    same reason `mine.editing` is a field. And both are part of the CACHE KEY
    below: a bucket cached under its own name would hand back the unsearched
    list the moment you typed, which looks exactly like a search that matches
    everything.
  */
  query: '',
  sort: 'smart',
}

/** What identifies one fetched list: the bucket AND how it was asked for. */
const mineKey = () => `${mine.bucket}|${mine.query}|${mine.sort}`
/*
  Declared HERE, beside the other stores, not next to the function that fills
  it three thousand lines below. A hoisted function reached during module
  evaluation that names a `const` declared later throws "cannot access before
  initialization", the studio prints "could not draw this screen", and the
  NEXT draw works — one console line, no failing check, months old. CLAUDE.md
  records exactly that, about `ageTimer`.
*/
const maps = {}
const placed = {}

/*
  What to say about the trip to Google, until the screen is left (0486).

  Declared here for the reason the comment above gives: `connectionsTab` is a
  hoisted function reading it, and a `let` three thousand lines below the
  function that names it is the `ageTimer` trap.
*/
let googleSaid = null

/*
  How much has arrived on each project since he last opened it (#122).

  A plain object rather than part of `latest`, for the same reason `maps` is:
  it is keyed by project and the two things in `latest` are portfolio-wide.
  Empty until the office answers, which is correct — no marks is the right
  first frame, and a mark that appears a moment later is better than one that
  is wrong for a moment.
*/
const unseen = {}

/*
  What each agent has done lately (#155, 0385).

  One call for the whole roster: eight round trips to draw one screen is eight
  chances for a slow one to make the page look broken.
*/
const teamWork = {}

const state = {
  /*
    WHICH PRESENTATION OF THE OFFICE IS ON SCREEN.

    'default' is everything this studio has always been. 'basecamp' is the
    experimental Basecamp-inspired Team HQ described by the top-level
    basecamp_clone.md, reached only at the /basecamp path prefix.

    A FLAG ON THE STATE RATHER THAN A SECOND FRONTEND. Same state object, same
    data adapters, same mutations, same canonical records - only the renderer
    differs. Two frontends is the thing ADR-0019 was spent removing, and a
    forked copy of a 607 KB file would drift from the real one within a day.

    It is deliberately NOT a query parameter: keepUrl() writes the path and
    discards the query on every paint, so an experience carried in the query
    string would be erased by the first render after arrival.
  */
  experience: 'default',
  /*
    The experiment's full-search query and its two filters (§7.4).

    On the state rather than in the address for the same reason the drafts
    are: `keepUrl()` writes the path from the state on every paint and drops
    the query string, so anything held there is gone at the next render.
  */
  bcQuery: '',
  bcKind: 'Everything',
  bcOnly: null,
  /*
    Which task's record page is open, or null for the list (§9, §17 phase 4).

    Cleared by goToPath on every navigation rather than by each caller, so a
    stale id cannot survive a move to another project and open a record that
    belongs to somebody else's list.
  */
  bcTask: null,
  // Which module is open as an expanded view over the project home (v2).
  bcExpanded: null,
  /*
    Which person the Contacts tool is showing, and whether it is showing the
    form that adds one. Both live here for the same reason bcTask does: the
    miniature and the expanded view are two presentations of one tool, so the
    thing being looked at belongs to the tool rather than to either of them.
  */
  bcContact: null,
  bcContactAdd: false,
  // Which document the detail view is showing (audio, or one with no file).
  bcDoc: null,
  /*
    Which filter the to-dos are under, from the counts at the top of the
    project, and which half of Mine / The team's is on. Both are places -
    they go in the address - because a count that opens a filtered list and
    then loses the filter on a reload is a count that lied.
  */
  bcFilter: null,
  bcMine: null,
  // Which source is open, and whether the Add Source surface is showing.
  bcSource: null,
  bcSourceAdd: false,
  // Which Settings tab is open (#39).
  setting: 'team',
  view: 'portfolio', project: null, done: new Set(), label: null,
  // Which filter the home board's Tasks panel is showing (#219).
  homeTasks: 'all',
  // Which person's card is open in Settings. Null is the grid (#68).
  person: null,
  // The project's sections (#30). Overview is the default: the specification
  // opens on Current Focus and Project Status, not on a file list.
  tab: 'overview',
  // Which of AI Team's four you are looking at.
  sub: 'board',
  // Which pane of the project's own Settings is open (#36).
  setpane: 'people',
  // Which card on the project map is open in its side panel (#25).
  mapPick: null,
  /*
    Which tasks are chosen, for acting on several at once (#150).

    A Set of task ids rather than of indexes: the list is filtered (#154) and
    re-ordered by grouping, so an index means a different task the moment
    anything changes, and a stale selection acting on the wrong row is the one
    failure a bulk action must never have.
  */
  picked: new Set(),
  /*
    Which facet each long list is filtered to (#154).

    Per list and per project, and cleared whenever the project changes: a
    filter you forgot you set is how a list appears empty, and the list that
    looks empty is the one you conclude the office never filled.
  */
  facet: {},
  /*
    Unsent composer text, per project (#197).

    On `state` rather than in localStorage: an unsent message is this session's
    business, and a draft that outlived the tab would reappear days later with
    no idea what it was about. Cleared when the message is actually sent.
  */
  drafts: {},
  // Whether the chat has been scrolled into view for this project already, so
  // a repaint does not drag the page back while somebody is reading (#197).
  chatShown: null,
  /*
    What arrived while you were reading further up (#205).

    `keepingPlace` already gets the SCROLL right — stay put unless you were at
    the bottom — and #199 deliberately left the other half: when a message
    lands above you, nothing says so, and you find it by scrolling or you do
    not find it.

    Per project, and reset when you reach the bottom. `who` is the last
    person to speak, because "Emma replied" is worth more than "1 new
    message"; `n` counts them because two of Emma is not one of Emma.
  */
  arrived: { project: null, n: 0, who: null },
  // The ids the thread has already shown, so an arrival can be told from a
  // repaint of the same conversation (#205).
  seen: { project: null, ids: null },
  // Set by `keepingPlace` for the length of one redraw: were you reading
  // further up when this happened? Only it can know (#205).
  wasReading: false,
  // The page-scroll listener currently installed, so a rebuild replaces it
  // rather than stacking another one on every render (#205).
  onPageScroll: null,
  // The same, for the two resize listeners that keep the newest message in
  // view when the keyboard opens (#197).
  onResize: null,
  onResize2: null,
  /*
    Whether the thread was showing its newest message, remembered as it changes
    (#197). A resize event arrives after the layout has already moved, so this
    has to be recorded continuously rather than measured when it is needed.
  */
  threadAtEnd: true,
  // The item a chat message is about (#27), until it is sent or removed.
  attach: null,
  // Whether the MCP client view is open, on the Connections tab (#91).
  mcp: false,
  // Which channel's "how it works" is open, in Settings (#93). One at a time:
  // four expanded cards is a page nobody reads.
  channel: null,
  // The command bar (#40 idea 1): open, what is typed, which row is picked.
  cmd: { open: false, q: '', at: 0 },
  /*
    Whether the project's waiting list is expanded (#151).

    Collapsed by default and deliberately NOT remembered per project: the bar
    only exists when something is waiting, and a person who has just answered
    the last one should get the space back rather than an empty open panel on
    the next project they open.
  */
  waitingOpen: false,
}

/*
  The sections of a project, from the verbatim specification.

  `docs/spec/project-dashboard-ia-2026-09-10.md` — Grant's own left-hand
  navigation: Overview · AI Team · Documents · Tasks · Contacts · Sources ·
  Activity, with Project Settings top-right.

  The first version of this was Board · Team · Chat · People, built against a
  reconstruction of that document while the original was unrecoverable. It was
  wrong in a way worth naming: it made Chat a peer of Documents. The hierarchy
  is the claim that *"the Agentic Team is a first-class part of each Project
  rather than a separate application"*, and a chat tab sitting beside a
  documents tab says the opposite — that it is a messaging feature bolted on.
  So Chat moves inside AI Team, where he put it.
*/
const SECTIONS = [
  { id: 'overview', name: 'Overview' },
  { id: 'team', name: 'AI Team' },
  { id: 'documents', name: 'Documents' },
  { id: 'tasks', name: 'Tasks' },
  { id: 'contacts', name: 'Contacts' },
  { id: 'sources', name: 'Sources' },
  /*
    Activity is NOT a section any more (#222).

    Grant: *"The current Activity feature is vague and appears to provide little
    usable information. It is not clear what it represents, why entries are
    shown, what users can do with them. If Activity has no meaningful
    interaction or drill-down, remove it."*

    It had none: `activitySection` rendered a read-only list where every row was
    a sentence and nothing was a link. So the TAB goes and the PANEL stays -
    Recent activity is still addable to the Overview board, which is where a
    glanceable history belongs and where it sits beside the work it describes
    rather than in a room of its own. That is also the shape he described for
    its return: *"a better-designed Recent Activity / Recent Actions
    component."*

    A stored tab preference of 'activity' from before this change falls through
    the body selector to the board, which is the right landing: the Overview is
    where the panel lives now.
  */
  /*
    Project Settings (#36) — the last section of the specification's hierarchy.

    Named in full (#158). Grant: *"Rename the project-level settings UI
    explicitly to Project Settings. Do not make users guess which scope they
    are editing."* One word was ambiguous next to the rail's global Settings,
    two rows below it, on a product that has both.
  */
  { id: 'settings', name: 'Project Settings' },
]

/*
  AI Team's own four, also his:

      ├── Team Board      who is on this project
      ├── Team Chat       ask one / selected / everyone
      ├── Active Jobs     running · waiting-blocked · completed
      └── Agent Outputs   reports · research · plans · files → IMPORT

  Two levels, never three — *"minimal navigation depth"*.
*/
const TEAM_VIEWS = [
  { id: 'board', name: 'Team board' },
  { id: 'chat', name: 'Chat' },
  { id: 'jobs', name: 'Active jobs' },
  { id: 'outputs', name: 'Outputs' },
]

const tabFor = (slug) => {
  try { return JSON.parse(localStorage.getItem('studio.tab') ?? '{}')[slug] ?? 'overview' }
  catch { return 'overview' }
}
const rememberTab = (slug, tab) => {
  try {
    const all = JSON.parse(localStorage.getItem('studio.tab') ?? '{}')
    all[slug] = tab
    localStorage.setItem('studio.tab', JSON.stringify(all))
  } catch { /* not fatal */ }
}

/*
  One place that knows whether something is open (#23 idea 6).

  Every sheet was toggling `hidden` on its own, so the defocus behind them
  would have had to be repeated five times and would have drifted the first
  time one of them changed. `behind` on the body is the single fact, and the
  CSS reads it.
*/
/*
  Open or shut a sheet. Settings is not one of them any more (#158).

  Grant: *"The current settings modal/pop-up is too constrained for the amount
  of configuration available... Settings has enough complexity to justify being
  a first-class page."*

  So the settings container carries `page`, which the stylesheet reads to give
  it the content column instead of a box in the middle of a blurred screen, and
  it no longer sets `behind` - the shell is not receding behind it, the rail is
  beside it and still works. That is the whole difference between a page and a
  dialog: you can leave it by going somewhere else.

  The document viewer stays a dialog, because it IS one.
*/
/*
  Who to give the keyboard back to when a dialog closes.

  Remembered here rather than worked out on the way out, because by then the
  thing that opened it may not be on screen any more.
*/
let cameFrom = null

const sheet = (el, open) => {
  const wasOpen = !el.hidden
  el.hidden = !open
  if (el.id === 'settings') el.classList.toggle('page', open)
  document.body.classList.toggle('behind', !$('#viewer').hidden)

  /*
    The viewer is a DIALOG, and a dialog owns the keyboard while it is up
    (§30).

    It did not. Twenty-five Tabs with a document open put focus on the shell
    behind it twenty-three times — the rail, the tabs, the composer, every one
    of them underneath a full-screen overlay and none of them announced as
    unreachable. A sighted mouse user never meets this; somebody working by
    keyboard loses the dialog on the second Tab and cannot tell where they are.

    Settings is deliberately NOT treated this way. #158 made it a page on
    purpose, and a page you can leave by going somewhere else is the whole
    difference.
  */
  if (el.id !== 'viewer') return
  if (open && !wasOpen) {
    cameFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = el.querySelector(FOCUSABLE)
    if (first instanceof HTMLElement) first.focus()
  } else if (!open && wasOpen) {
    if (cameFrom !== null && cameFrom.isConnected) cameFrom.focus()
    cameFrom = null
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/*
  And Tab stays inside it.

  Wrapped rather than blocked: reaching the end and starting again is what a
  dialog does everywhere else, and a Tab that simply does nothing reads as a
  frozen page.
*/
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const dialog = $('#viewer')
    if (dialog === null || dialog.hidden) return
    const inside = [...dialog.querySelectorAll(FOCUSABLE)].filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    )
    if (inside.length === 0) return
    const first = inside[0]
    const last = inside[inside.length - 1]
    const here = document.activeElement
    if (!dialog.contains(here)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
      return
    }
    if (e.shiftKey && here === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && here === last) {
      e.preventDefault()
      first.focus()
    }
  })
}

/*
  Escape closes whatever is open (#88, #98).

  One listener on the document rather than one per sheet, for the same reason
  `sheet()` exists: five copies of the same behaviour drift the first time one
  of them changes.

  It is what makes the close button a convenience rather than the only way out
  — which is the actual complaint behind both of those issues. A panel you can
  only leave by finding one small target is a panel people get stuck in, and
  the studio has been shipping two of them.

  The call is deliberately NOT hung up here: closing the sheet leaves the call
  running (#101), and Escape is closing the sheet.
*/
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    for (const id of ['#viewer', '#settings']) {
      const el = $(id)
      if (el && !el.hidden) {
        if (id === '#viewer') unwireCall()
        sheet(el, false)
        syncCallButtons()
        return
      }
    }
  })
}

// --- pieces -----------------------------------------------------------------

/*
  A face, with the real portrait behind it.

  The initial stays as the fallback layer underneath: if the image is slow or
  gone the mark is still a mark, not an empty circle. `loading="lazy"` because
  eight portraits in a rail are not what the first paint is for.
*/
/*
  A face, carrying its person's own hue (#40 idea 4).

  `--tone` is set inline from the agent's OKLCH angle and overrides the palette
  class, so every ring, tint and border derived from `--hue` downstream is that
  person's colour rather than one of six shared ones. One inline custom property
  is what makes an identity consistent across eight components without eight
  components knowing anything about agents.
*/
const face = (c, size = 28) =>
  `<span class="face ${c.hue} ${c.state}" style="--hue:oklch(0.62 0.14 ${c.tone ?? 150});--beat:${
    CREW.findIndex((x) => x.slug === c.slug)
  };width:${size}px;height:${size}px"
         title="${esc(c.name)} — ${esc(c.doing ?? c.role)}">${esc(c.name[0])}${
    /*
      A portrait that fails hides itself, leaving the initial (#207's neighbour).

      The initial is drawn underneath every face by design; the photograph is an
      improvement on it, and a photograph that does not arrive should be no
      worse than none. Without this the browser paints its own torn-paper glyph
      over the letter and a missing file reads as a broken page.

      Inline rather than a listener, because a face is rebuilt on every render
      and an image can fail before any wiring pass reaches it - the error has
      usually already fired by the time a listener would be attached.
    */
    c.face
      ? `<img src="${esc(c.face)}" alt="" loading="lazy"
             onerror="this.classList.add('gone')">`
      : ''
  }</span>`

/*
  A document cover.

  Reference 9: the page IS the thumbnail. Until pdf.js renders a real page
  (Issue #10) this draws the shape of one — rules at the real proportions of the
  document's first page — so the LAYOUT is being tested against something the
  right size and weight, rather than against a grey box that will look nothing
  like the finished thing.
*/
const cover = (d) => {
  if (d.kind === 'audio') {
    return `<div class="page" style="background:var(--sunken);align-items:center;justify-content:center">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)"
           stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <path d="M3 12h2l2-5 3 11 3-14 3 12 2-4h3"/></svg></div>`
  }
  const badge = `k-${d.kind === 'made' ? 'made' : d.kind}`
  const label = d.kind === 'made' ? 'MADE' : d.kind.toUpperCase()
  return `<div class="page">${pageSvg(d.title, d.kind)}<span class="kind ${badge}">${label}</span></div>`
}

/*
  "Talk to the team about this" (#27).

  Grant: *"each item (Docs, contacts, todo, etc) has a little button to 'talk to
  the team about this' and I can send a message that takes the item as context"*.

  One component, so a new item type gets it for nothing. Two details that are
  the whole point rather than polish:

  - It is a SIBLING of the card, not a child. The cards are `<button>`, and a
    button inside a button is invalid and behaves differently in every browser.
  - It carries `kind` and `id`, not a sentence. When this reaches the backend
    the job gets the id; a description would have to be parsed back.
*/
/*
  Send this to someone, and say what to do with it (#27).

  This was one button meaning "talk to the team about this", which opened the
  composer with the item attached. That left Grant typing the verb every time,
  in whatever words occurred to him, for the office to parse back out of a
  sentence. The specification names the actions instead — Review, Summarise,
  Research, Critique, Extract tasks, Compare — and each one now creates a typed
  job carrying the asset's ID.

  The actions come from `config.ACTIONS`, hydrated from `public.asset_actions`.
  Not a list in this file: they are rows so an eighth is a row and not a coding
  session, and a page that hard-codes them is a page that disagrees with the
  office the first time one changes.

  Still a SIBLING of the card, never a child — the cards are buttons and a
  button inside a button is invalid HTML. #27 says to keep that when the menu
  arrives, and this does: the menu is a popover positioned against the trigger,
  not nested inside the card.
*/
const talkBtn = (kind, id, title) => `
  <span class="sendwrap">
    <!--
      No data-send-title. The title is in the aria-label where a screen reader
      needs it, and the RPC looks the real one up from the asset itself — an
      attribute nothing reads is a control nothing can have wired, which is
      what verify:wired exists to catch and did.
    -->
    <button class="talkabout" data-send-kind="${esc(kind)}" data-send-id="${esc(id)}"
            aria-haspopup="menu"
            aria-expanded="${state.sendFor === `${kind}:${id}` ? 'true' : 'false'}"
            title="Send to the team" aria-label="Send ${esc(title)} to the team">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/>
      </svg>
    </button>
    ${state.sendFor !== `${kind}:${id}` ? '' : `<span class="sendmenu" role="menu"
        aria-label="What should the team do with ${esc(title)}">
      ${(config.ACTIONS ?? []).map((a) => `<button role="menuitem" class="senditem"
          data-do-action="${esc(a.action)}" data-do-kind="${esc(kind)}"
          data-do-id="${esc(id)}"
          ${a.needs_two ? 'disabled title="Pick a second thing to compare against first"' : ''}
        >${esc(a.label)}</button>`).join('')}
      <!--
        Custom instruction is last and is not one of the rows, because it has
        no fixed sentence: it opens the composer with the item attached, which
        is what the single button used to do and is still the right answer when
        none of the six fits.

        No backticks in this comment: template literal.
      -->
      <button role="menuitem" class="senditem quiet" data-talk-kind="${esc(kind)}"
        data-talk-id="${esc(id)}" data-talk-title="${esc(title)}">Say something else…</button>
    </span>`}
  </span>`

/** A card and its send action, side by side rather than nested. */
const withTalk = (html, kind, id, title) =>
  `<span class="withtalk">${html}${talkBtn(kind, id, title)}</span>`

const docCard = (d, i) => withTalk(`
  <!--
    Two keys, and both are needed.

    data-doc is the card's INDEX in the gallery, which is what the local
    command-bar rows and the keyboard walk use. data-doc-id is the document's
    real id, which is what anything arriving from the office has — a full-text
    hit (#37) knows the id and has no idea what position the page put it in.
    Looking one up by the other would mean the page holding a map it does not
    need.

    No backticks in this comment: template literal.
  -->
  <button class="doc" data-doc="${i}" data-doc-id="${esc(d.id ?? '')}">
    ${cover(d)}
    <span style="font-weight:500;font-size:13px;line-height:1.35">${esc(d.title)}</span>
    <!--
      The separator only when there is something on both sides of it.

      Several real documents have no size worth printing — a Notion database
      container is twenty-four characters, so the API deliberately says nothing
      rather than "4 words" — and the caption rendered as "Notion ·" with a
      dangling middot. A trailing separator reads as data that failed to load.

      No backticks in this comment: template literal.
    -->
    <span class="t-meta" style="font-size:12px">${[d.origin, d.size]
      .filter((x) => String(x ?? '').trim() !== '')
      .map((x) => esc(x))
      .join(' · ')}</span>
  </button>`, 'document', String(i), d.title)

/*
  Every document the project actually has.

  Its own, plus the artifacts the team made that Grant has approved. Everything
  downstream — the shelf, the viewer, the counts — reads this rather than
  `p.documents`, so approving something in Team makes it appear here with no
  second code path.
*/
const allDocs = (p) => [
  ...p.documents,
  ...workspace.approved(p).map((r) => ({
    ...r.output, origin: `${crewBy(r.who).name} · ${r.delivered}`,
  })),
]

const taskRow = (t, i) => {
  const done = t.state === 'done' || state.done.has(i)
  const who = t.who ? crewBy(t.who) : null
  return withTalk(`<button class="task ${done ? 'done' : ''}" data-task="${i}"${
    t.id ? ` data-task-id="${esc(t.id)}"` : ''}>
    <span class="box ${t.state === 'due' && !done ? 'due' : ''}">${
      done ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)"
        stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>` : ''
    }</span>
    <span class="label">
      <span style="display:block;font-size:14px;font-weight:500">${esc(t.title)}</span>
      ${t.due ? `<span class="t-meta" style="color:var(--warn);font-weight:600">${esc(t.due)}</span>`
              : t.note ? `<span class="t-meta">${esc(t.note)}</span>` : ''}
    </span>
    ${who ? face(who, 22) : ''}
  </button>
  <!--
    Editing it (#106). A SIBLING of the row, not a child: the row is a button
    and a button inside a button is invalid markup that browsers silently
    rearrange. The withtalk wrapper already puts one control beside the row, so
    this is the second in the same slot.

    Only for a writer, and only for a task the office actually holds -- a
    prototype task has no id and nothing to update.

    No backticks in this comment. Template literal.
  -->
  <!--
    Choosing several, to act on them once (#150).

    A SIBLING for the same reason the edit pencil is one: the row is a button
    and a button inside a button is invalid markup that browsers rearrange
    silently.

    44px, and that is the constraint the issue names: a selection column is
    exactly where touch targets get squeezed, so this one is a full-height
    target with a small mark inside it rather than a small control.

    No backticks in this comment. Template literal.
  -->
  ${t.id && canWrite() ? `<button class="rowpick ${state.picked.has(t.id) ? 'on' : ''}"
    data-task-pick="${esc(t.id)}" role="checkbox"
    aria-checked="${state.picked.has(t.id)}"
    aria-label="Choose ${esc(t.title)}"><span class="pickbox"></span></button>` : ''}
  ${t.id && canWrite() ? `<button class="rowedit" data-task-edit="${esc(t.id)}"
    aria-label="Edit ${esc(t.title)}" title="Edit this task">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14.5 4.5l5 5-9 9H5.5v-5z"/></svg>
  </button>` : ''}`, 'task', String(i), t.title)
}

// --- views -------------------------------------------------------------------


/*
  The office, in one line (#40 idea 2).

  Grant asked for the whole product to feel like one thing. The clearest reason
  it did not was that the portfolio, a project and Settings each showed a
  different amount of life — Settings showed none at all, which is why it read
  as a separate application no matter how it was styled.

  So: a hairline strip carrying what the office is doing right now, on every
  screen. Three facts and no more, because a ribbon that grows into a dashboard
  is a dashboard nobody asked for:

    what is running    the pulse. Zero is a real state and says so.
    what is stuck      the only thing here that is ever urgent.
    what it costs      the £0 constraint, live, because the bad way to find
                       the edge of a free tier is an invoice.

  It is ambient. Nothing in it blinks for attention unless something is
  actually blocked, in which case it is the one thing that does.
*/

/*
  The command bar (#40 idea 1).

  Grant: *"easy to use, easy to expand."* Both, from one control. It is the
  fastest route to anything in the product, and anything added later becomes
  reachable through it without adding a button anywhere.

  The property that makes it worth building rather than a search box: it has no
  dead end. If what you typed matches nothing, the last row is still **Ask the
  team** carrying your words — because *"draft the follow-up for Priya"* matches
  no document and is a perfectly good thing to say. You never have to decide
  whether you are navigating or asking before you start typing.
*/

/*
  An empty section is a setup screen (#40 idea 7).

  Grant's frontend spec §31A: *"Treat avoidable requests for manual
  configuration as a design failure: first investigate whether the same outcome
  can be achieved through existing credentials, repository tooling, an API,
  CLI, SDK, connector or authorized browser session."*

  Applied to empty states, that rule says something specific. Every empty
  section in this app used to say a variant of "nothing here yet" — true, and
  useless, because it leaves the whole job with Grant. The office has eight
  people who can do most of these jobs. So an empty state offers TWO doors:

    the thing HE would do          add a document, add a person
    the thing the TEAM can do      go and find them

  and the team's door is first, because that is the one that is new information.
  He already knows he can add a document.

  A section with nothing in it and nothing the team could do about it — Activity
  on a brand-new project — gets prose and no buttons. Offering an action that
  cannot help is worse than offering none.
*/
function emptyState({ says, mine, mineDo, ask }) {
  /*
    A reader is told the truth instead of being offered a refusal (#123).

    Grant's words on the issue: "Where there is genuinely nothing to offer - a
    reader with no token - say that instead, rather than showing an action that
    will be refused."

    Every other write control on these screens already guards on canWrite --
    the tasks header three hundred lines below does exactly that -- and the
    empty state was the one place that did not, so the surface most likely to
    be seen by somebody who has just arrived was the surface offering them two
    buttons that cannot work.

    The sentence matches the banner's wording rather than inventing a second
    way of saying the same thing.

    No backticks in this comment. Template literal.
  */
  if (!canWrite()) {
    return `<div class="empty">
      <p class="t-lead" style="margin:0">${says}</p>
      <p class="t-meta" style="margin:0">Sign in to change anything here.</p>
    </div>`
  }
  return `<div class="empty">
    <p class="t-lead" style="margin:0">${says}</p>
    <div class="emptydo">
      ${ask === undefined ? '' : `<button class="btn primary" data-ask-team="${esc(ask.say)}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg>
        ${esc(ask.name)}</button>`}
      <!--
        The empty state's own action (#105).

        Every empty state in the product rendered this as a bare button with no
        attribute at all — Add a task, Add a document, Add someone, Add a
        source - so all of them did nothing. verify:wired could not see them
        either, because it compared attributes against source lookups and these
        had no attribute to compare.

        mineDo names what the press should do. Where it is absent the button
        is not drawn at all, which is the honest state for a section whose
        write path does not exist yet — Contacts has no table (#24).

        No backticks in this comment. Template literal.
      -->
      ${mine === undefined || mineDo === undefined ? '' :
        `<button class="btn" data-empty-do="${esc(mineDo)}">${esc(mine)}</button>`}
    </div>
  </div>`
}


/**
 * The rows the command bar shows, built once.
 *
 * Both the renderer and the thing that ACTS on a press need this list, and for
 * a while they each built their own. The comment on `pickCommand` already
 * warned what that costs — "a second copy of the row list that can disagree
 * with the one on screen, and the disagreement only shows up as the bar
 * navigating somewhere you did not pick" — and adding #37's second group made
 * it true: the renderer grew a group the picker did not have, so every press
 * below the first group would have opened the wrong thing.
 *
 * So there is one list now, and the two callers cannot drift.
 */
function commandRows() {
  const p = state.view === 'project' ? byId(state.project) : null
  const all = command.candidates({
    projects: PROJECTS,
    project: p,
    sections: SECTIONS,
    settings: config.TABS,
    crew: CREW,
    docsFor: allDocs,
  })
  /*
    The call panel is reachable, and only from here (#214).

    Appended to the candidate list rather than built into `command.candidates`,
    which takes the page's data and knows nothing about the studio's surfaces.
    Appended BEFORE the search, so it is ranked and filtered like everything
    else rather than always showing.

    One list, two callers: this function is the single assembly the renderer and
    the keyboard picker both read, which is the property the comment above it
    exists to protect.
  */
  all.push({
    kind: 'section',
    id: 'call-panel',
    title: callIsLive() ? 'The call in progress' : 'The call panel',
    hint: 'transcript, and typing to the team',
    go: { callpanel: true },
  })

  const hits = command.search(state.cmd.q, all)
  const typed = state.cmd.q.trim()

  /*
    What is INSIDE things, under what they are called (#37).

    The rows above are titles, matched locally against the payload the page
    already holds — instant, and that is what makes the bar good. These are the
    words inside documents and inside answers the team wrote, which the page
    cannot hold and which arrive a moment later from `studio_search`.

    A second group rather than merged and re-ranked: a local title match and a
    full-text rank are not the same number, and interleaving them would put a
    weak body match above the document you were obviously reaching for.
    Grouping is also the honest thing to draw — these took a round trip and the
    ones above did not.
  */
  const inside = (state.cmd.inside ?? []).filter(
    (r) => !hits.some((h) => h.kind === 'document' && h.title === r.title),
  )

  // Always last, always available. This is the whole idea.
  return [
    ...hits,
    ...inside,
    ...(typed === '' ? [] : [{
      kind: 'ask', id: 'ask', title: typed,
      hint: p === null ? 'Ask the team — choose a project first' : `Ask the team about ${p.name}`,
    }]),
  ]
}

function commandBar() {
  if (!state.cmd.open) return ''
  const rows = commandRows()

  const at = Math.min(state.cmd.at, Math.max(rows.length - 1, 0))

  return `<div class="cmdwrap" data-cmd-wrap>
    <div class="cmdbar" role="dialog" aria-modal="true" aria-label="Command">
      <div class="cmdinput">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)"
          stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
        <input data-cmd-input type="text" autocomplete="off" spellcheck="false"
               placeholder="Find anything, or tell the team what to do…"
               aria-label="Find anything, or tell the team what to do"
               value="${esc(state.cmd.q)}">
        <kbd>esc</kbd>
      </div>
      ${rows.length === 0 ? `<p class="cmdempty t-meta">Nothing matches. Keep typing and
        it becomes something to ask the team.</p>` : `
      <div class="cmdrows" role="listbox">
        ${rows.map((r, i) => `
          <button role="option" aria-selected="${i === at}" class="cmdrow ${
            i === at ? 'on' : ''} ${esc(r.hue ?? '')}" data-cmd-row="${i}">
            <span class="ckind">${esc(r.kind === 'ask' ? 'Ask' : command.KIND_NAME[r.kind] ?? '')}</span>
            <span class="ctitle">${esc(r.title)}</span>
            <span class="chint t-meta">${esc(r.hint ?? '')}</span>
            ${i === at ? '<kbd class="cgo">↵</kbd>' : ''}
          </button>`).join('')}
      </div>`}
    </div>
  </div>`
}

/** What pressing a row does. Kept out of the renderer so it can be read. */
function runCommand(row) {
  if (row === undefined) return
  if (row.kind === 'ask') {
    /*
      No project chosen yet, so this cannot ask anybody — and it used to end
      there: a highlighted row, a return key, and NOTHING, with the bar still
      open (§30, §59).

      The row's own hint already says a project is needed. So say it and then
      do the next step rather than refusing: shut the bar and open the project
      switcher, which is where the missing piece is. A dead end becomes a path,
      and the typed words are not lost — the bar reopens with them if he asks
      for it again.
    */
    if (state.view !== 'project') {
      /*
        Asked from the portfolio, and filed where loose questions belong (#149).

        This opened the project switcher an hour ago, which was the honest
        answer while there was nowhere to put the question. There is: `Unnamed`,
        the reserved project 0334 made for exactly this. The dock says where it
        went, so nothing is filed silently.
      */
      const loose = PROJECTS.find((x) => x.slug === 'unnamed')
      if (loose === undefined) {
        closeCmd()
        render()
        const open = document.querySelector('[data-switch-open]')
        if (open instanceof HTMLElement) open.click()
        return
      }
      chat.send(loose.slug, row.title, null)
      closeCmd()
      rememberDock(true)
      render()
      paintDock()
      return
    }
    chat.send(state.project, row.title, null)
    state.tab = 'team'
    state.sub = 'chat'
    rememberTab(state.project, 'team')
    closeCmd()
    render()
    return
  }
  const go = row.go ?? {}
  closeCmd()
  if (go.callpanel === true) {
    render()
    openCallPanel()
    return
  }
  if (go.settings !== undefined) {
    state.setting = go.settings
    settingsSheet()
    sheet($('#settings'), true)
    return
  }
  carry(null, null, () => {
    if (go.project !== undefined) state.project = go.project
    if (go.view !== undefined) state.view = go.view
    if (go.tab !== undefined) { state.tab = go.tab; rememberTab(state.project, go.tab) }
    if (go.sub !== undefined) state.sub = go.sub
    render()
  })
  if (go.doc !== undefined) {
    const b = $(`[data-doc="${go.doc}"]`)
    if (b !== null) b.click()
  }
  if (go.contact !== undefined) {
    const c = byId(state.project).contacts[go.contact]
    if (c !== undefined) openContact(c)
  }
  /*
    A row that matched INSIDE a document opens the document (#37).

    By its real id, not by its index on the page: these rows came from the
    office and the office does not know or care what position the gallery has
    put a document in. `data-doc` is an index — the local rows use it, and it
    is the wrong key for anything that arrived over the wire.

    A row that matched inside an ANSWER lands on Outputs and no further. An
    output has no screen of its own; the honest thing is to put you where they
    live rather than to invent a destination.
  */
  if (go.open !== undefined && go.open !== '') {
    const b = $(`[data-doc-id="${go.open}"]`)
    if (b !== null) b.click()
  }
}


/**
 * Resolve the highlighted index back to a row and run it.
 *
 * Rebuilt rather than stashed on state, because a list held on state is a list
 * that can disagree with the one on screen — and the disagreement only shows up
 * as the bar navigating somewhere you did not pick.
 */
/*
  The call panel, on demand.

  Closing it does not hang up - #101's rule, and still right: the call is a
  module-level singleton and the panel attaches to it and detaches from it.
  `unwireCall` drops the reference and stops nothing, which is the whole point.
*/
function openCallPanel() {
  const v = $('#viewer')
  v.innerHTML = callSheet()
  sheet(v, true)
  const shut = () => { unwireCall(); sheet(v, false); syncCallButtons() }
  $('.close', v)?.addEventListener('click', shut)
  v.addEventListener('click', (e) => { if (e.target === v) shut() })
  wireCall(v)
}

function pickCommand(index) {
  runCommand(commandRows()[index])
}

const openCmd = () => { state.cmd = { open: true, q: '', at: 0 }; render(); $('[data-cmd-input]')?.focus() }
/*
  A menu that only closes by pressing its own trigger again is a menu that gets
  left open behind whatever you do next. Escape and a click anywhere else both
  shut it, which is what every other popover in this product does.
*/
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.sendFor) {
    state.sendFor = null
    render()
  }
})
document.addEventListener('click', (e) => {
  if (!state.sendFor) return
  if (e.target.closest?.('.sendwrap')) return
  state.sendFor = null
  render()
})

const closeCmd = () => {
  state.cmd = { open: false, q: '', at: 0 }
  insideFor = ''
}

/*
  What the last inside-search was FOR.

  Not a timer id and not a boolean: the thing that goes wrong here is an
  answer for "pri" arriving after the answer for "pricing" and replacing it,
  which reads as the results going backwards as you type. Comparing the query
  the answer was for against the query on screen is the only check that
  survives out-of-order replies.
*/
let insideFor = ''
let insideTimer = null

/**
 * Search inside documents and answers, a moment after typing stops (#37).
 *
 * Debounced at 220ms and floored at three characters. Every keystroke is a
 * full-text scan of the corpus, and one per letter of "positioning" is twelve
 * scans of which eleven are thrown away — which costs nothing visible on a
 * fast connection and is the sort of thing that makes a free tier stop being
 * free.
 *
 * Failure is silent, deliberately. The local title results are already on
 * screen and they are the ones people use; an error bar over the top of a
 * working search would be the page reporting its own plumbing.
 */
function lookInside(query) {
  const q = String(query ?? '').trim()
  if (insideTimer !== null) clearTimeout(insideTimer)
  if (q.length < 3) {
    if ((state.cmd.inside ?? []).length > 0) { state.cmd.inside = []; render() }
    return
  }
  insideTimer = setTimeout(async () => {
    try {
      const p = state.view === 'project' ? byId(state.project) : null
      const found = await read('search', undefined, { q, project: p?.id })
      // The answer is for the query it was asked about, not for whatever is in
      // the box now.
      if (state.cmd.q.trim() !== q || !state.cmd.open) return
      insideFor = q
      state.cmd.inside = (Array.isArray(found) ? found : []).map((r) => ({
        kind: r.kind === 'answer' ? 'answer' : 'inside',
        id: String(r.ref ?? ''),
        title: String(r.title ?? '(untitled)'),
        // The matched words, with the marks the headline put round them
        // stripped: this is a plain-text row and `esc` would print the tags.
        hint: String(r.snippet ?? '').replace(/<\/?b>/g, '').trim(),
        go: r.kind === 'answer'
          ? { view: 'project', tab: 'team', sub: 'outputs' }
          : { view: 'project', tab: 'documents', open: String(r.ref ?? '') },
        place: String(r.place ?? ''),
      }))
      render()
    } catch {
      // Silent: the local results are already there and are the useful ones.
    }
  }, 220)
}


/*
  The ribbon is gone (#78).

  Grant: *"Remove the top status bar: Remove the Waiting on me / Nothing
  running strip."*

  It occupied a full-width strip at the top of every view to report, most of
  the time, that nothing was happening. A status line whose common case is "no
  news" trains you not to read it, and once you are not reading it the
  uncommon case does not reach you either.

  It was also where the "68 BLOCKED" bug lived: it keyed on state_reason, which
  is set on every dequeue, so it claimed sixty-eight blocked jobs against an
  office with none. Two fixes were needed. That the most prominent element on
  the page could be that wrong for that long is its own argument.

  The two things worth carrying went where they are actionable: waiting on me
  is on the project it concerns and in the morning briefing, which already
  reaches his phone, and running is in Lately, which is the record of what the
  office did.
*/

/*
  Seven sections, and AI Team's four inside it (#30).

  The counts on the section buttons are how Grant learns something is waiting
  without opening anything — which is the whole reason the specification puts
  an operational overview first rather than a file list.

  Top-level since #80, because the sections moved into the rail and the rail is
  rendered before the project body. It used to be computed inside `dashboard()`,
  which is the only place that needed it then.
*/
/*
  Every light/dark shortcut shows which way it will go (#87).

  Same reasoning as `syncCallButtons`: the button is rebuilt on every render and
  knows nothing, and two copies disagreeing about the theme is worse than one
  copy being wrong. A class on the button, and CSS picks the icon — swapping
  innerHTML on a button whose content is an SVG is how the call button once
  deleted its own microphone.
*/
function paintSchemeButtons() {
  const dark = activeScheme() === 'dark'
  for (const b of document.querySelectorAll('[data-scheme-toggle]')) {
    b.classList.toggle('is-dark', dark)
    const to = dark ? 'light' : 'dark'
    b.title = 'Switch to ' + to
    b.setAttribute('aria-label', 'Switch to ' + to)
  }
}

/*
  The one thing the page must never stop admitting.

  Removed from the DOM entirely when the office answered, rather than hidden:
  an element that is present and invisible is one a later stylesheet can
  reveal, and this must be exactly as true as the data behind it.
*/
/*
  Three states, three sentences, and only one of them is calm (#119).

  There was one strip and one wording, so "you are not signed in" and "the
  office is down" looked identical. The first is normal; the second is an
  outage, and the more alarming state was wearing the quieter label.

  The mock strip exists because a design was once judged as a product and
  reported Supabase storage at 82% of the free tier when the real figure was
  4%. That was invented data mistaken for real. This is the same class in the
  other direction -- real breakage mistaken for a normal prototype -- and it is
  how an outage goes unnoticed.
*/
function markMock(root) {
  const existing = $('.mockbar')
  if (existing) existing.remove()
  if (source.live) return

  const state = SOURCE_STATE[source.state] ?? SOURCE_STATE.prototype
  const bar = document.createElement('div')
  bar.className = `mockbar${state.tone === '' ? '' : ' bad'}`

  /*
    The retry is drawn only where retrying can help. Offering one on the
    prototype state would be a button that cannot work -- there is no token to
    try with -- and a control that cannot do its job is the defect #105 spent a
    day on.
  */
  const when =
    source.at === null
      ? ''
      : ` Last answered ${esc(new Date(source.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}.`
  bar.innerHTML = `<b>${esc(state.label)}</b><span>${esc(state.say)}${when}</span>${
    source.state === 'unreachable' || source.state === 'stale'
      ? '<button class="btn small quiet" data-retry-office>Try again</button>'
      : ''
  }`
  root.prepend(bar)

  $('[data-retry-office]', bar)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    b.disabled = true
    b.textContent = 'Trying…'
    await refresh()
    /*
      No `say()` on success: the strip disappears, which is the clearest
      possible confirmation. On failure `refresh` has already updated
      `source.why` and the redraw prints it, so a repeated failure reads as a
      repeated failure rather than as a button that did nothing.
    */
  })
}

/*
  The office is answering, and falling behind (#112).

  A DIFFERENT strip from the one above, deliberately. That one says the page
  cannot see the office; this one says the office is visible and is not keeping
  up. They are opposite states and one wording for both is what let nine hourly
  jobs sit queued for eight hours with a green dashboard -- the number everyone
  was told to trust counted complete, failed and in-flight, and a job nobody has
  taken is none of those.

  It names the kind and the age, because "3 stuck" sends you looking and
  "3x google.write_calendar_tasks, oldest 8h" is the answer. In this case the
  answer was: the deployed worker was built before that handler existed.
*/
/*
  The office cannot think, and the dashboard says so (#240).

  Migration 0372 gave `office_health()` a `cannot_think` field - which providers
  have an open circuit breaker, since when, when they will next be probed, and
  what the provider said. Nothing rendered it. While it was true, eighteen jobs
  failed in thirty minutes and the page looked entirely normal.

  That is the worst shape a state can take, and it is what section 32 is about:
  a quiet office reads as an idle office, and idle means wait while this means
  investigate. Two opposite instructions, drawn identically.

  Grant's shape for it, from the issue:

    - a plain sentence, not a JSON blob
    - the provider's own words are operator detail, behind a disclosure
    - it clears itself the moment the breaker closes, with no reload
    - an empty list adds NOTHING to the screen, because the common case is
      healthy and an always-present "all good" pill is furniture

  Drawn as a sibling of the stalled strip, in the same place, because they are
  the same kind of fact and two different treatments for "something is wrong
  with the office" would be two things to learn.
*/
function markThinking(root) {
  const existing = $('.thinkbar')
  if (existing) existing.remove()
  /*
    Only when the office is answering. A page that cannot reach the office knows
    nothing about whether the office can reach its model provider, and saying so
    anyway would be an alarm sourced from no information - which is the same
    guard the stalled strip carries, for the same reason.
  */
  if (!source.live || health.cannotThink.length === 0) return

  const first = health.cannotThink[0]
  const more = health.cannotThink.length - 1
  const back = first?.next_probe_at
    ? ` It tries again ${when.words(first.next_probe_at)}.`
    : ' It will try again on its own.'

  const bar = document.createElement('div')
  bar.className = 'mockbar thinkbar badbar'
  const head = document.createElement('b')
  head.textContent = more > 0
    ? `The office cannot reach ${String(health.cannotThink.length)} of its model providers`
    : `The office cannot reach ${String(first?.provider ?? 'its model provider')}`
  const say = document.createElement('span')
  say.textContent = `Nothing it is asked can be answered until this clears.${back}`
  bar.append(head, say)

  /*
    What the provider actually said, behind a disclosure.

    His words: the reason is operator detail and does not belong in the
    headline. It is also the only thing that makes the difference between a
    quota, a key and an outage, so it must be reachable in one press rather
    than absent.
  */
  if (first?.said) {
    const why = document.createElement('details')
    why.className = 'thinkwhy'
    const sum = document.createElement('summary')
    sum.textContent = 'What it said'
    const pre = document.createElement('p')
    pre.className = 't-meta'
    pre.textContent = health.cannotThink
      .map((c) => `${String(c.provider)}: ${String(c.said ?? 'no reason given')}`)
      .join(' · ')
    why.append(sum, pre)
    bar.append(why)
  }
  root.prepend(bar)
}

function markStalled(root) {
  const existing = $('.stalledbar')
  if (existing) existing.remove()
  // Only when the office is actually answering. A page that cannot see anything
  // has nothing to say about whether the queue is moving, and saying it anyway
  // would be an alarm sourced from no information.
  if (!source.live || health.stalled === 0) return

  const worst = health.kinds[0]
  const hours = worst === undefined ? 0 : Math.round((worst.oldest_minutes ?? 0) / 60)
  const age =
    worst === undefined
      ? ''
      : hours >= 1
        ? ` The oldest has waited ${String(hours)} hour${hours === 1 ? '' : 's'}.`
        : ` The oldest has waited ${String(worst.oldest_minutes ?? 0)} minutes.`

  const bar = document.createElement('div')
  bar.className = 'mockbar stalledbar warnbar'
  bar.innerHTML = `<b>${esc(
    `${String(health.stalled)} job${health.stalled === 1 ? '' : 's'} nobody has taken`,
  )}</b><span>${esc(
    `${health.kinds.map((k) => `${String(k.n)}x ${k.kind}`).join(', ')}.${age} ` +
      'Usually this means the worker was deployed before the handler existed.',
  )}</span>`
  root.prepend(bar)
}

/*
  The team, in writing, docked (#103).

  Grant: *"Provide an integrated text conversation area that remains accessible
  without opening a pop-up or obstructing navigation."*

  Three things follow from that sentence and each one is a decision:

  NOT A POP-UP. It is a panel on the right with the page still usable beside
  it. No backdrop, no `body.behind`, nothing to dismiss before you can press
  something else.

  DOES NOT OBSTRUCT NAVIGATION. It lives outside `#root`, so `render()` never
  touches it — the scroll position, the draft and any in-flight request survive
  moving between projects and sections. That is why it is a sibling of the
  settings sheet in index.html rather than part of the shell.

  REMAINS ACCESSIBLE. Open is remembered, so it is still there on the next
  visit if that is how you work.

  It is the same conversation as the project's Chat tab, because it is the same
  thread for the same project, read from the same place.
*/
const dockOpen = () => {
  try { return localStorage.getItem('studio.dock') === 'open' } catch { return false }
}
const rememberDock = (open) => {
  try { localStorage.setItem('studio.dock', open ? 'open' : 'shut') } catch { /* not fatal */ }
}

function paintDock() {
  const el = $('#dock')
  if (!el) return
  const open = dockOpen()
  el.hidden = !open
  document.body.classList.toggle('docked', open)
  if (!open) { el.innerHTML = ''; return }

  /*
    Asking from the portfolio, without a project (#149).

    This was `PROJECTS[0]?.slug` — so a question asked from the home screen was
    silently attached to whichever project happened to be first, and Grant's
    "what is going on this week" landed on Legacy Coaching Course. That is worse
    than refusing: a dashboard project is the source of truth, and a message
    filed under the wrong one is a message he will not find again.

    `Unnamed` is the reserved project 0334 made for exactly this — his own
    words: *"you can just create an untitled or undefined project. Stuff that's
    not a bit specific project."* Telegram already renames it to Conversation
    for a reader (#208), and the dock says which project it is using whenever it
    is not the one you are in, so the choice is visible rather than silent.
  */
  const loose = PROJECTS.find((x) => x.slug === 'unnamed')
  const slug = state.project ?? loose?.slug ?? PROJECTS[0]?.slug
  const p = slug ? byId(slug) : null
  const filed = p !== null && p.slug !== state.project
  const messages = p ? chat.thread(p.slug) : []
  const draft = $('[data-docksay]')?.value ?? ''
  const at = $('[data-dockthread]')?.scrollTop

  el.innerHTML = `<div class="dockhead">
      <span style="flex:1;min-width:0">
        <b>The team</b>
        <span class="t-meta">${
          p === null
            ? 'No project yet'
            : filed
              ? `Filed under ${esc(p.slug === 'unnamed' ? 'Conversation' : p.name)}`
              : esc(p.name)
        }</span>
      </span>
      <button class="closeconv" data-dock-close aria-label="Close the conversation">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="thread${messages.length === 0 ? ' empty' : ''}" data-dockthread>${
      /*
        An empty conversation should look like an invitation, not like a fault.

        The first cut rendered the standing "ask them something" line at the
        top of the full-height bordered thread box, which on a 900px screen is
        three lines of grey text above 600px of ruled nothing. Empty gets its
        own treatment: no box, centred, and the two examples do more work than
        the explanation did.
      */
      messages.length === 0
        ? `<div class="dockblank">
             <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
               <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg>
             <p class="t-meta">Ask them something, or tell them what to do.</p>
             <p class="dockeg">&ldquo;Where are we on this?&rdquo; &middot;
               &ldquo;Draft the next module outline&rdquo;</p>
             <p class="t-meta dockwhere">The same conversation as the Chat tab on
               ${p ? esc(p.name) : 'a project'}.</p>
           </div>`
        : messages.map(bubble).join('')
    }</div>
    <form class="composer" data-dockform>
      <div class="crow">
        <textarea data-docksay rows="1" placeholder="Ask the team…"
                  aria-label="Message the team"></textarea>
        <button class="btn primary" type="submit">Send</button>
      </div>
    </form>`

  const box = $('[data-docksay]', el)
  if (box) box.value = draft
  const thread = $('[data-dockthread]', el)
  if (thread) thread.scrollTop = at ?? thread.scrollHeight

  $('[data-dock-close]', el)?.addEventListener('click', () => {
    rememberDock(false)
    paintDock()
  })

  /*
    Retry, in the dock as well (#215).

    The dock lives OUTSIDE `#root` so `render()` never wipes it - which is the
    whole point of #103 - and that also means `render()` never WIRES it. A
    control drawn by `bubble` therefore needs wiring on both sides, and
    `verify:wired` cannot catch the gap: it checks that an attribute is looked
    up somewhere in the source, and this one is, in the other half.
  */
  tickWaiting()

  for (const b of el.querySelectorAll('[data-chat-retry]')) {
    b.addEventListener('click', () => {
      if (!p) return
      void chat.retry(p.slug, b.dataset.chatRetry, presented(), () => { paintDock() })
        .then(() => { paintDock() })
    })
  }

  /*
    ENTER SENDS. SHIFT+ENTER MAKES A NEWLINE.

    Grant, 23 September, listing it with the Send button as a separate
    requirement - because a textarea does neither on its own: Enter inserts a
    newline and nothing sends, so the keyboard could not send a message at all
    and the only way was the mouse.

    `requestSubmit`, not `submit`: the form's own listener below is where
    sending lives, and `submit()` bypasses listeners entirely. And the newline
    case is simply left alone, which is what a textarea already does well.
  */
  box?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    const form = e.currentTarget.closest('form')
    if (form === null) return
    e.preventDefault()
    form.requestSubmit()
  })

  $('[data-dockform]', el)?.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = String(box?.value ?? '').trim()
    if (text === '' || !p) return
    if (box) box.value = ''
    chat.send(p.slug, text, null)
    paintDock()
    void chat.ask(p.slug, text, null, presented(), undefined, () => { paintDock() })
      .then(() => { paintDock() })
  })
}

/*
  A panel that has more in it must SAY so (#108).

  The capture showed Modules and Tasks ending mid-row, sliced horizontally
  through a title. `.pbodywrap` already scrolls — `overflow: auto` — but
  Chromium draws an overlay scrollbar that is invisible until you scroll, so a
  row cut through the middle of a word does not read as "there is more below".
  It reads as a rendering fault, on the tab you land on.

  So the panel gets a fade at whichever edge has content beyond it: one below
  when there is more to come, one above once you have scrolled. `scrollTop` is
  in the sum deliberately — the fade must go away at the end of the list,
  otherwise it is claiming there is more when there is not, which is the same
  lie in the other direction.

  Recomputed on scroll and on resize: the panels are user-resizable, so the
  answer changes when Grant drags one narrower.
*/
function markPanelScroll(root) {
  for (const wrap of root.querySelectorAll('.pbodywrap')) {
    const panel = wrap.parentElement
    if (!panel) continue
    const paint = () => {
      const below = wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop
      panel.classList.toggle('more', below > 4)
      panel.classList.toggle('above', wrap.scrollTop > 4)
    }
    paint()
    wrap.addEventListener('scroll', paint, { passive: true })
    // The panel is resizable, and a ResizeObserver is the only thing that
    // hears a drag on the grip.
    new ResizeObserver(paint).observe(wrap)
  }
}

function sectionCounts(p) {
  const waiting = workspace.split(p).waiting.length
  const blocked = workspace.rows(p).filter((r) => r.blocked !== undefined).length
  const openTasks = p.tasks.filter((t, i) => t.state !== 'done' && !state.done.has(i)).length
  return {
    /*
      Two rawer numbers ride along, because AI Team's own sub-tabs need them
      separately and they are the same two counts. They are not section ids, so
      they never collide with a SECTIONS lookup.
    */
    waiting,
    blocked,
    team: waiting + blocked,
    /*
      The true count, not the number of rows in hand.

      The API caps the document list at 24 because a hundred of them with their
      metadata is a slow first paint on a phone. The tab said 24 on a project
      with 41, which is the kind of wrong that costs trust in every other number
      on the page. `p.docs` is counted in SQL over the whole project.
    */
    documents: Math.max(p.docs ?? 0, allDocs(p).length),
    tasks: openTasks,
    contacts: p.contacts.length,
    sources: (p.sources ?? []).length,
  }
}

function rail() {
  const inProject = state.view === 'project'
  const p = inProject ? byId(state.project) : null
  const counts = inProject ? sectionCounts(p) : {}
  // Asked once per page, and only for a writer: a reader has nothing to press.
  if (canWrite()) void needRecoverable()

  /*
    The toggle is a SIBLING of the rail, not a child of it (#76).

    Grant: *"Make the sidebar collapse fully and reclaim the space. Currently,
    only a small portion disappears."* It used to collapse from 220px to 74px,
    keeping an icon strip - a narrower rail rather than a hidden one.

    Collapsing the rail now hides it with opacity, and OPACITY ON AN ANCESTOR
    HIDES EVERY DESCENDANT no matter what the child's own opacity says. With
    the button inside, the way to reopen the sidebar disappeared along with the
    sidebar. Same family of trap as backdrop-filter breaking position:fixed:
    the parent decides things the child cannot override.
  */
  return `<button class="railtoggle" data-rail aria-label="Collapse the sidebar">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
        <path d="M14 6l-6 6 6 6"/></svg>
    </button>
    <aside class="rail">
    <!--
      The way home, and the name of the place (#216).

      Grant: *"There is currently no obvious way to return to the homepage after
      entering a project."* He was right, and it was worse than an omission: the
      switcher underneath goes BETWEEN projects, so from inside one the only
      exit was the browser back button on a page that does not change its URL.

      Two changes in one element. It is a button now, not a div, so the logo and
      the wordmark are one target that always returns to the global home. And it
      says "My Agentic Team" rather than "Studio" - his words, and the honest
      ones: Studio named the prototype, not the product.
    -->
    <button class="wordmark" data-go="portfolio" aria-label="My Agentic Team, back to the home dashboard"
            aria-current="${inProject || state.view !== 'portfolio' ? 'false' : 'page'}">
      <span class="glyph"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"><path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 12l7-4M12 12v9M12 12L5 8"/></svg></span>
      <span>
        <span class="wordmark-name">My Agentic Team</span>
        <span class="brandline">Eight people, one queue</span>
      </span>
    </button>

    <!--
      The dashboard project selector, top left, always.

      Grant: *"the top left should be the project selector and it should be like
      a drop down menu that shows other projects. But once the project is
      selected, everything else on the screen is relevant to that project."*
      And again on 11 September: *"Allow switching between projects directly
      from the sidebar."* (#79)

      It used to appear only while inside a project, so from the portfolio the
      only way in was the grid. Now it is the permanent anchor: which dashboard
      project you are in, and that there are others. Everything under it belongs
      to that project.

      A dashboard project is a row in public.projects. Not a notebook, not a
      Notion database, not a Drive folder — those are things it is attached to.
    -->
    <div class="switcher">
      <button class="switch ${inProject ? p.hue : ''}" data-switch-open aria-haspopup="listbox"
              aria-expanded="false">
        <span class="dot"></span>
        <span class="sname">${inProject ? esc(p.name) : 'All projects'}</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 10l5 5 5-5"/></svg>
      </button>
      <div class="switchmenu" data-switch-menu hidden role="listbox">
        ${PROJECTS.map((x) => `
          <button role="option" aria-selected="${inProject && x.slug === p.slug}"
                  class="${x.hue} ${inProject && x.slug === p.slug ? 'on' : ''}" data-open="${x.slug}">
            <!--
              The chosen mark, where a project is chosen (#83). A coloured dot
              is a colour; an icon is recognisable, which is the point of
              letting him pick one. Falls back to the dot, so a project he has
              not touched looks exactly as it did.
            -->
            ${icons.known(x.icon)
              ? `<span class="dot mark ${esc(x.iconHue ?? x.hue)}">${icons.svg(x.icon, 13)}</span>`
              : '<span class="dot"></span>'}
            <span>
              <b>${esc(x.name)}</b>
              <span class="t-meta">${x.docs} docs · ${x.total} tasks</span>
            </span>
          </button>`).join('')}
        <!--
          The ONLY element carrying data-go=portfolio.

          There were two: this one and a nav item below. Grant asked for the
          nav item to go (#77), and the duplicate was also a real bug — the
          control audit resolved the hidden copy inside this menu and waited
          thirty seconds for something invisible to become clickable. The
          comment recording that is still in scripts/verify/controls.ts.
        -->
        <button class="allprojects" data-go="portfolio">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z"/></svg>
          All projects
        </button>
        <!--
          THE WAY BACK, where you notice it is missing (#276).

          Archiving a project offers an undo for ten minutes and this is the
          other half: the project you archived last week and have just gone
          looking for. It is here rather than in Settings because the switcher
          is where you find out a project is not in the list.

          Drawn only when there is something on it, which today is never: 926
          projects in this database are archived and not one holds a document,
          a task or a contact, because archiving is what a suite teardown does
          when it cannot delete. The reader asks whether the project HELD
          something rather than what it is called, so the first row it ever
          shows Grant will be one of his.

          No backticks in this comment: template literal.
        -->
        ${
          !canWrite() || !Array.isArray(recoverable) || recoverable.length === 0
            ? ''
            : `<div class="swarch" data-saidwrap>
          <span class="t-label">Archived</span>
          ${recoverable
            .map(
              (x) => `<span class="swarchrow">
              <span class="swarchname">${esc(x.name)}</span>
              <button class="btn small quiet" data-unarchive="${esc(x.slug)}"
                      data-name="${esc(x.name)}">Bring it back</button>
            </span>`,
            )
            .join('')}
          <span class="t-meta" data-said></span>
        </div>`
        }
      </div>
    </div>

    <!--
      The project sections, in the sidebar (#80).

      Grant: *"Move project sections into the left sidebar: Place Overview,
      Documents, Tasks, Contacts, and other project sections there."*

      They were a horizontal tab strip above the content. As sidebar entries
      under the picker the rail reads WHICH PROJECT, then WHERE IN IT, which is
      the shape four of his thirty items are circling.

      These stay data-tab so the wiring and the audits that drive them keep
      working, but they are navigation now, not a tablist: aria-current, not
      aria-selected, and no role=tab on a thing that is not in a tablist.
    -->
    <nav class="navgroup" aria-label="${inProject ? esc(p.name) : 'Projects'}">
      ${inProject
        ? SECTIONS.map((t) => `
          <button class="navitem sect ${state.tab === t.id ? 'on' : ''}" data-tab="${t.id}"
                  aria-current="${state.tab === t.id ? 'page' : 'false'}">
            <span>${esc(t.name)}</span>
            ${counts[t.id] > 0 ? `<span class="n">${counts[t.id]}</span>` : ''}
          </button>`).join('')
        : PROJECTS.map((x) => `
          <button class="navitem proj ${x.hue}" data-open="${x.slug}" aria-current="false">
            <span class="dot"></span>${esc(x.name)}
          </button>`).join('')}
    </nav>

    <!--
      Everything below here is pinned to the bottom by .railfoot.

      Grant: *"Move Lately near the bottom"* (#84) and *"Place Settings at the
      bottom left. Label the entry Settings rather than Appearance"* (#86).
      Appearance is one of six tabs inside Settings and has been since the
      settings sheet was built; the rail was still advertising the tab as if it
      were the whole thing, so five tabs were behind a door that did not
      mention them.

      "Working now" and the Desk entry are gone (#77) — presence for its own
      sake, and a view whose contents all found homes in the project sections.
    -->
    <div class="railfoot">
      <!--
        Grant: *"of course the talk to team button should be prominent"*. It is
        the one control he uses when he does not want to use the interface at
        all, so it is the only filled thing in the rail.
      -->
      <button class="callbtn" data-call>
        <span class="ring"></span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"/></svg>
        <span class="lbl">Call the team</span>
      </button>

      <!--
        What the call is doing, in words, where the call is (#214).

        Empty and hidden until the call has something to say, so an idle rail
        shows nothing at all. It exists because the panel stopped being in the
        way: with no dialog open, a call that is refused the microphone, or that
        cannot reach the service, had nowhere to report it. A prominent control
        that fails silently is worse than the dialog it replaced.

        A live region, so it is announced rather than only drawn - section 29
        asks for call and conversation state to reach a screen reader, and this
        is the one piece of state a person cannot see happening.
      -->
      <p class="callsay t-meta" data-callsay role="status" aria-live="polite" hidden></p>

      <!--
        Writing to them, beside calling them (#103).

        The same conversation either way: both reach /voice/turn, which is the
        canonical layer. §5 — a surface may translate and may not decide.
      -->
      <button class="navitem" data-dock aria-label="Message the team">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 0 1 3.6 11 8.4 8.4 0 0 1 12 2.6a8.4 8.4 0 0 1 9 8.9z"/></svg>
        Message the team
      </button>

      <!--
        Everything on his plate, across every project and none (#173).

        Above Lately because it is what he has to DO and Lately is what already
        happened. The count is the point of the entry: a nav item that only says
        Tasks tells him nothing about whether to press it.
      -->
      <button class="navitem" data-go="tasks" aria-current="${state.view === 'tasks' ? 'page' : 'false'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 5.5h11M9 12h11M9 18.5h11"/><path d="M3.6 5.4l1.1 1.1 2-2.2"/>
          <path d="M3.6 11.9l1.1 1.1 2-2.2"/><circle cx="4.7" cy="18.5" r="1.3"/></svg>
        Tasks${
          latest.tasks === null || Number(latest.tasks.counts?.open ?? 0) === 0
            ? ''
            : `<span class="n${Number(latest.tasks.counts?.overdue ?? 0) > 0 ? ' bad' : ''}">${
                Number(latest.tasks.counts.open)
              }</span>`
        }
      </button>

      <button class="navitem" data-go="lately" aria-current="${state.view === 'lately' ? 'page' : 'false'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>
        <!--
          Recent activity, not Lately (#222).

          Grant: *"Lately is vague and does not communicate what the module
          contains. Rename it to something clearer. Use the same terminology
          consistently across the application."* It is the same two words on the
          Overview panel, so a person who learns one has learnt the other.

          The internal id stays as it was, because it is the payload's name and
          a stored panel layout refers to it. Renaming a word Grant reads is not
          a reason to rename a key nothing shows him. No backticks in this
          comment: template literal.
        -->
        Recent activity
      </button>

      <button class="navitem settings-open" data-settings>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2"/>
          <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"/>
        </svg>
        Settings
      </button>
    </div>
  </aside>`
}

/*
  `attention()` was removed with #219.

  It drew the single top-level waiting item as a banner over the project cards.
  The home board's Waiting on you panel draws every waiting item there is, that
  one included, so the banner became a smaller second answer to a question one
  surface should answer.
*/
function contactCard(c, i) {
  const stage = { active: 'Active', prospect: 'Prospect', dormant: 'Dormant' }[c.stage] ?? c.stage
  const bits = [c.org, c.where].filter((x) => x !== '' && x !== undefined)
  return withTalk(`<button class="contact ${c.hue}" data-contact="${i}">
    <span class="disc">${esc(c.name[0])}</span>
    <span class="who">
      <span class="line1">
        <b>${esc(c.name)}</b>
        <span class="stage s-${esc(c.stage)}">${esc(stage)}</span>
      </span>
      <span class="t-meta">${esc(c.role)}${bits.length > 0 ? ` · ${esc(bits.join(' · '))}` : ''}</span>
      ${(() => {
        const on = people.labelsFor(c)
        return on.length === 0 ? '' :
          `<span class="tags">${on.map((l) =>
            `<span class="tag ${l.hue}">${esc(l.name)}</span>`).join('')}</span>`
      })()}
      ${c.next ? `<span class="next">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        ${esc(c.next)}${c.nextDue ? ` — ${esc(c.nextDue)}` : ''}</span>` : ''}
    </span>
    <span class="t-meta when">${when.stamp(c.lastAt, c.last)}</span>
  </button>`, 'contact', String(i), c.name)
}

/*
  What a project looks like (#83).

  Three answers in order, and the order is the whole design: an image he
  uploaded, then an icon he chose, then the generated art. A project nobody has
  touched keeps exactly the cover it has today, so nothing had to be migrated
  and nothing looks different until he says so.

  The icon takes `iconHue` and falls back to the project's own hue, because
  picking an icon and not picking a colour is a normal thing to do and the
  project already has a colour that means something.

  `covimg`, not `.art`. `.art` is the generated SVG's class and carries a
  `color` that means "the hue"; an image needs `object-fit` and no colour at
  all, and this file has twice been bitten by two things sharing a class name.
*/
function look(p, opts = {}) {
  if (typeof p.image === 'string' && p.image.startsWith('data:image/')) {
    return `<img class="covimg" src="${esc(p.image)}" alt="">`
  }
  if (icons.known(p.icon)) {
    return `<span class="iconmark ${esc(p.iconHue ?? p.hue)}">${
      icons.svg(p.icon, opts.dense === true ? 40 : 30)
    }</span>`
  }
  return coverSvg(p.slug, opts)
}

/*
  What has arrived since he last looked (#122, migration 0381).

  One mark, and it says WHAT as well as how many, because "3 new" on a project
  card raises the question it was supposed to answer. The count is capped at
  nine: the mark's job is "look here", and a project reading 75 is a statistic
  rather than a signal — and on a first run, before anything has ever been
  opened, 75 is exactly what the honest number is.

  Nothing is drawn when nothing has arrived. A mark that is always on is a mark
  nobody reads, which is the failure the issue names and the one this product
  has already shipped once.
*/
/*
  Opening a project is what clears its mark (#122).

  Cleared LOCALLY first and told to the office second, because the mark is
  gone from the screen he is looking at either way and a round trip he can see
  is worse than one he cannot. If the write fails the count comes back on the
  next load, which is the honest outcome — it was not recorded, so it did not
  happen.

  "on every device", which is why this is a write at all and not a line in
  browser storage: he reads on a laptop and a phone, and a mark that clears on
  one of them is a mark that lies on the other.
*/
function markSeen(slug) {
  if (unseen[slug] === undefined) return
  delete unseen[slug]
  if (!canWrite()) return
  const p = byId(slug)
  if (p?.id === undefined) return
  void act('project_seen', { p_project_id: p.id }).catch(() => undefined)
}

function newsFor(slug) {
  const seen = unseen[slug]
  if (seen === undefined || seen.n === undefined || seen.n < 1) return ''
  const bits = []
  if (seen.walls > 0) bits.push(`${seen.walls} needs you`)
  if (seen.answers > 0) bits.push(`${seen.answers} answered`)
  if (seen.docs > 0) bits.push(`${seen.docs} new`)
  if (seen.tasks > 0) bits.push(`${seen.tasks} tasks`)
  const many = seen.n > 9 ? '9+' : String(seen.n)
  return `<span class="news" title="${esc(bits.join(', '))}">
    <span class="newsdot" aria-hidden="true"></span>${many} since you looked</span>`
}

function card(p, lead) {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  return `<button class="project ${p.hue} ${lead ? 'lead' : ''}" data-open="${p.slug}">
    <span class="cover" style="view-transition-name:cover-${p.slug}">
      ${look(p, { dense: lead, facts: p })}
    </span>
    <span class="body">
      <span>
        <span class="${lead ? 't-title' : ''}" style="display:block;${
          lead ? '' : 'font:600 16px/1.25 var(--text);'
        }">${esc(p.name)}</span>
        <span class="${lead ? 't-lead' : 't-meta'}" style="display:block;margin-top:${lead ? '8px' : '4px'}">${
          esc(p.purpose)
        }</span>
      </span>
      ${p.total > 0 ? `<span class="bar">
        <span class="track"><span class="fill" style="width:${pct}%"></span></span>
        <span class="t-meta" style="font-size:12px">${p.done}/${p.total}</span>
      </span>` : ''}
      <span class="facts t-meta" style="font-size:12.5px">
        ${newsFor(p.slug)}
        <span>${p.docs} ${p.docs === 1 ? 'doc' : 'docs'}</span>
        ${p.total > 0 ? `<span>${p.total} tasks</span>` : ''}
        ${p.next ? `<span style="color:var(--warn);font-weight:500">${esc(p.next)}</span>` : ''}
      </span>
    </span>
  </button>`
}

/*
  A project's people.

  Corrected: Grant, on the first version — *"remember people is a subset of each
  project.. not merged"*. I had built the union across every project, which
  quietly asserts that a person is a global record a project happens to
  reference. He is saying the opposite, and it matches the rest of the model:
  the project is the source of truth, and a contact belongs to one the way a
  document does.

  So this is the same view, scoped. It reads the project you are in, and the
  rail reaches it per project rather than once at the top.
*/
/*
  The desk (#23 idea 9).

  Projects on a pannable surface, positioned where Grant left them. Offered
  beside the portfolio rather than instead of it, because the claim that spatial
  memory beats a list might be false for three projects and obviously true for
  thirty — and the only way to find out is to have both.
*/
/*
  Lately — what the office did, and what is being built.

  Two of the six sections that only existed on the plain page, and they are the
  same shape: a reverse-chronological list answering "what has been going on".
  One page with two columns rather than two rail items, because the IA is two
  levels and never three, and because they are read together.

  Grant on the second column: *"I want to see what it is that you're doing... so
  that I can pop into the application and see what it is you're doing."* It is
  neither office work nor his work — it is a window on the person changing the
  thing — which is why it sits beside the office's history rather than in
  Settings.
*/
function lately() {
  const d = latest.lately
  const office = d?.office ?? []
  const build = d?.building ?? {}
  const steps = build.steps ?? []
  const t = d?.today ?? {}

  /*
    A summary line only where there is something to summarise.

    The morning briefing arrived at this after telling Grant "nothing failed"
    every day for a month: a section that announces its own emptiness teaches
    the reader to skip the region.
  */
  const bits = []
  if (Number(t.jobs_done) > 0) bits.push(`${t.jobs_done} finished`)
  if (Number(t.jobs_failed) > 0) bits.push(`${t.jobs_failed} failed`)
  if (Number(t.events) > 0) bits.push(`${t.events} things recorded`)

  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">Recent activity</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${
          bits.length === 0
            ? 'Nothing in the last day. The office is idle, which is not the same as broken.'
            : `In the last day: ${esc(bits.join(', '))}.`
        }</p>
      </div>
    </div>

    <div class="lately">
      <section class="latecol">
        <h2 class="t-title">The office</h2>
        <p class="t-meta">What the team did, and whether it can be undone.</p>
        ${
          office.length === 0
            ? '<p class="t-meta">Nothing recorded yet.</p>'
            : `<div class="tasks">${office
                .map(
                  (e) => `<div class="task" style="cursor:default">
              ${face(crewBy(e.who), 22)}
              <span class="label t-meta" style="color:var(--ink)">
                <b style="font-weight:600">${esc(crewBy(e.who).name ?? e.who)}</b>
                ${esc(e.verb)} ${esc(e.what)}${e.project ? ` on ${esc(e.project)}` : ''}
                <!--
                  A folded row (#14). The two newest of any repeated thing are
                  shown as themselves and the rest arrive as one line saying how
                  many, because 285 of one day's 372 events were the noticing
                  pass and they were the entire page. It carries no undo: a
                  reversal belongs to one event, and offering it for a hundred
                  would be a control claiming something nothing performs.

                  No backticks in this comment: template literal.
                -->
                ${e.times ? `<span style="color:var(--ink-3)"> · ${
                  esc(String(e.times))} more like this</span>` : ''}
                <span style="color:var(--ink-3)"> · ${when.stamp(e.at, e.when)}</span>
                ${e.why ? `<span class="latewhy">${esc(e.why)}</span>` : ''}
              </span>
            </div>`,
                )
                .join('')}</div>`
        }
      </section>

      <section class="latecol">
        <h2 class="t-title">What Claude is building</h2>
        ${
          build.now
            ? `<article class="nowcard">
                <span class="t-label">${esc(build.now.towards ?? 'in progress')}</span>
                <b>${esc(build.now.headline ?? '')}</b>
                <p class="t-meta">${esc(build.now.detail ?? '')}</p>
              </article>`
            : ''
        }
        ${
          steps.length === 0
            ? '<p class="t-meta">Nothing in the diary yet.</p>'
            : `<div class="steps">${steps
                .slice(0, 12)
                .map(
                  (st) => `<article class="stepcard">
              ${
                st.shot
                  ? `<a href="${esc(st.shot)}" target="_blank" rel="noopener">
                       <img src="${esc(st.shot)}" alt="${esc(st.what ?? 'a screenshot of the work')}" loading="lazy">
                     </a>`
                  : ''
              }
              <div class="stepbody">
                <b>${esc(st.what ?? '')}</b>
                ${st.produced ? `<span class="t-meta">${esc(st.produced)}</span>` : ''}
                <span class="t-meta from">${esc(st.when ?? st.finished ?? '')}</span>
              </div>
            </article>`,
                )
                .join('')}</div>`
        }
      </section>
    </div>
  </main>`
}

/*
  The call, as a sheet.

  Deliberately spare. There is one thing to do here and a page of controls
  around a microphone is a page that makes you look for the microphone. The
  typing box is a disclosure rather than a second equal option: it is the
  fallback for a quiet room, not a parallel interface.
*/
function callSheet() {
  return `<div class="sheet callsheet">
    <div class="chead">
      <span style="flex:1;min-width:0">
        <h2 class="t-title" style="margin:0">Talk to the team</h2>
        <p class="t-meta" style="margin:4px 0 0">Claire picks up. She knows what the
          office has been doing — ask her, tell her, interrupt her.</p>
      </span>
    </div>

    <div class="callstage">
      <!--
        The ids are the old page's, deliberately.

        verify:talk drives this by id — call, talkstate, askform, asktext,
        asksend, turns, typeinstead — and those are stable handles an audit
        already knows. Keeping them means the check follows the capability
        rather than being rewritten alongside it, which is how a retarget
        quietly loses an assertion.

        No backticks in this comment. Template literal.
      -->
      <button type="button" class="bigmic" id="call" data-call aria-label="Call Claire">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="1.9" stroke-linecap="round" aria-hidden="true">
          <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
          <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3"/></svg>
      </button>
      <p class="t-lead" id="talkstate" data-callstate style="margin:0;text-align:center">Press to call
        Claire. The browser will ask for the microphone once.</p>
    </div>

    <details class="typeinstead" id="typeinstead">
      <summary>Type instead</summary>
      <form class="askform" id="askform" data-callform>
        <input id="asktext" data-calltext placeholder="Say it here"
               aria-label="What you want to say" autocomplete="off" enterkeyhint="send">
        <button class="btn primary" id="asksend" type="submit">Send</button>
      </form>
      <div class="turns" id="turns" data-callturns></div>
    </details>
  </div>
  <button class="close" aria-label="Close">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
  </button>`
}

/*
  The desk is gone (#77).

  Grant: *"Remove Working now icons, All projects, and the redundant Desk
  view."* Redundant is the right word — everything that lived on the pannable
  surface now has a home in a project section, so it was a second door to the
  same rooms.

  `canvas.js` and the drag springs it used are kept: the customizable project
  dashboard (#81) is the same interaction with a reason to exist.
*/

function peopleTab(p) {
  const defined = people.labels()
  const chosen = state.label
  const shown = chosen === null
    ? p.contacts
    : p.contacts.filter((c) => people.labelsFor(c).some((l) => l.id === chosen))

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Everyone on ${esc(p.name)}.
        Labels are yours — rename them, add your own, delete the ones you do not use.</p>
      <button class="btn" data-label-edit>Edit labels</button>
    </div>

    <div class="filters">
      <button class="pill ${chosen === null ? 'on' : ''}" data-filter="">All
        <span class="n">${p.contacts.length}</span></button>
      ${defined.map((l) => {
        const n = p.contacts.filter((c) => people.labelsFor(c).some((x) => x.id === l.id)).length
        return `<button class="pill ${l.hue} ${chosen === l.id ? 'on' : ''}" data-filter="${l.id}">
          <span class="swatchdot"></span>${esc(l.name)}<span class="n">${n}</span></button>`
      }).join('')}
    </div>

    ${canWrite() ? '<div class="tabhead"><span></span><button class="btn primary" data-empty-do="contact">Add someone</button></div>' : ''}
    ${addContactForm(p)}
    ${
      shown.length === 0
        ? (p.contacts.length === 0
            ? emptyState({
                says: 'Nobody on this project yet.',
                ask: { name: 'Ask the team to find who it is about',
                       say: `Go through ${p.name}'s documents and messages and list the people it is actually about.` },
                mine: 'Add someone',
                mineDo: 'contact',
              })
            : `<div class="empty"><p class="t-lead" style="margin:0">Nobody here carries that
                label yet. Open someone and tick it.</p></div>`)
        : `<div class="peoplegrid">${shown.map((c) => `
            <!--
              A contact is a name and a way to reach them (#100, #85).

              Grant: "Remove unnecessary people imagery or decorative contact
              elements." The 54px disc was the first letter of the name in a
              circle - decoration standing in for a photograph that does not
              exist, taking the left third of every card.

              What went in its place is the thing that was missing: the email,
              the phone and the Instagram handle were all stored and NONE of
              them were on the card. A contact card that does not show how to
              contact anybody is decoration all the way down.

              Each way of reaching them is a real link, so the card does the
              job rather than describing it. stopPropagation on the anchors
              because the card itself opens the person.

              No backticks in this comment. Template literal.
            -->
            <div class="pcard ${c.hue}">
              <span class="pbody">
                <!--
                  The name is the button; the card is not (#200).

                  It used to be a button wrapping the whole card, with the
                  mailto and tel anchors inside it. That is a control inside a
                  control: invalid HTML, and axe reports it as
                  nested-interactive because a screen reader cannot reach the
                  inner one at all. Four contacts, every tab, both themes, and
                  no existing check could see it — verify:wired looks up
                  attributes, verify:controls presses what it can reach with a
                  mouse, and neither asks whether the markup is reachable
                  another way.

                  So the links became SIBLINGS of the button rather than
                  children of it, and the button keeps the name, the role and
                  the labels — which is most of the card's height.

                  The first attempt made only the name a button and stretched a
                  pseudo element over the card. It passed axe and it was worse:
                  verify:layouts immediately measured a 301x19 touch target,
                  because the hit area and the CONTROL are not the same thing
                  and an audit can only see the second. Reachable by thumb and
                  19 pixels tall is the shape of a control nobody can rely on.

                  No backticks in this comment. Template literal.
                -->
                <button class="pmain" data-person="${esc(c.name)}">
                  <b>${esc(c.name)}</b>
                  <span class="t-meta">${esc(c.role ?? '')}${c.org ? ` · ${esc(c.org)}` : ''}</span>
                  <span class="tags">${people.labelsFor(c).map((l) =>
                    `<span class="tag ${l.hue}">${esc(l.name)}</span>`).join('')}</span>
                </button>
                <span class="reach">
                  ${c.email ? `<a href="mailto:${esc(c.email)}" data-stop>${esc(c.email)}</a>` : ''}
                  ${c.phone ? `<a href="tel:${esc(String(c.phone).replace(/\s+/g, ''))}" data-stop>${esc(c.phone)}</a>` : ''}
                  ${c.instagram ? `<a href="https://instagram.com/${esc(String(c.instagram).replace(/^@/, ''))}"
                     target="_blank" rel="noopener" data-stop>${esc(c.instagram)}</a>` : ''}
                </span>
                ${c.next ? `<span class="t-meta from">Next: ${esc(c.next)}</span>` : ''}
              </span>
            </div>`).join('')}</div>`
    }
  </div>`
}

/*
  The time of day, in his zone.

  "Good morning, Grant" at nine in the evening is the first thing that tells a
  reader nothing on this page is really about them. Cheap to get right and one
  of the few places a product can feel like it is paying attention.
*/
function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Athens' })
      .format(new Date()),
  )
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/*
  Where things stand, counted rather than written.

  This line said "Three projects. One thing waiting on you, and the team
  finished nine things overnight" for a fortnight, and it was true of the mock
  and false of everything else — the first render against the real office showed
  it claiming three projects above four cards. A sentence that contradicts the
  page under it is worse than no sentence, because it teaches a reader to stop
  believing the ones that are true.

  Each clause is dropped when its count is zero rather than printed as "no
  projects" — the rule the morning briefing arrived at after telling him
  "nothing failed" every day for a month.
*/
function standing() {
  const parts = []
  const n = PROJECTS.length
  if (n > 0) parts.push(`${n} ${n === 1 ? 'project' : 'projects'}`)

  const waiting = PROJECTS.reduce((t, p) => t + workspace.split(p).waiting.length, 0)
  if (waiting > 0) parts.push(`${waiting} thing${waiting === 1 ? '' : 's'} waiting on you`)

  const open = PROJECTS.reduce(
    (t, p) => t + (p.tasks ?? []).filter((k) => k.state !== 'done').length,
    0,
  )
  if (open > 0) parts.push(`${open} task${open === 1 ? '' : 's'} still open`)

  const busy = CREW.filter((c) => c.state === 'busy').length
  if (busy > 0) parts.push(`${busy} of the team working now`)

  if (parts.length === 0) return 'Nothing is waiting on you, and nothing is running.'
  // Sentence case, and a full stop. "4 projects, 1 thing waiting on you." reads
  // as a status bar; the same words with a capital read as a person telling you.
  const said = parts.join(', ')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`
}

/*
  The home screen's panels (#219).

  Grant: *"The current homepage consisting mainly of project cards is not useful
  enough. The homepage should become the global command dashboard for the entire
  Agentic Team workspace."* And the constraint that stops it becoming a
  different wall: *"Projects should remain discoverable without consuming the
  entire purpose of the home screen."*

  So Projects is one panel of five. The other four answer the questions a
  command dashboard exists for, in the order they matter: what needs a decision
  from him, what is open everywhere, who is working, what just happened.

  Each reads what the studio already holds. Nothing here fetches - `needTasks`
  and `needLately` are the two lazy reads and they are triggered by arriving,
  the same way the Tasks and Recent activity screens trigger them.
*/
/*
  The home Tasks panel's invented rows, for the prototype only.

  Shaped to the payload the real panel renders rather than given a renderer of
  its own -- a second list assembly is this file's most-recorded defect, and
  the panel below filters, counts and ticks these rows with exactly the code
  that runs on the office's answer. Only the SOURCE differs, which is the whole
  point: the prototype shows the design on invented data, and it is invented
  from the same PROJECTS every other panel on this board uses.

  A prototype task carries no id, so nothing here is tickable -- `data-tick`
  needs a real row and inventing one would be a control that lies.
*/
const protoTasks = () => {
  const rows = PROJECTS.flatMap((p) => (p.tasks ?? [])
    .filter((t) => t.state !== 'done')
    .map((t) => ({
      id: null,
      title: t.title,
      project_name: p.name,
      owner_name: t.who === undefined ? null : (crewBy(t.who)?.name ?? null),
      due_on: null,
      // The prototype says "Due 16 September" as prose, so the panel's own
      // date formatting has nothing to parse. `overdue` carries the state the
      // capture needs to show and the due column stays honestly empty.
      overdue: t.state === 'due',
      waiting: t.blocked !== undefined,
      blocked_on: t.blocked ?? null,
    })))
  return { counts: {}, tasks: rows }
}

const HOME_PANEL = {
  waiting: () => {
    /*
      Two sources, and neither is allowed to go missing.

      The per-project lists are the detailed ones. The payload also carries a
      single top-level `waiting`, which is what the old banner above the project
      cards drew - so folding that banner into this panel without carrying its
      item would have replaced something Grant could see with something that
      says "nothing is waiting on you" while the office believes otherwise.
      That is the disagreement CLAUDE.md keeps recording, and the safe direction
      is to include rather than to drop.

      Deduplicated on the sentence, because when both sources know about the
      same blocker they describe it with the same words.
    */
    const items = PROJECTS.flatMap((p) => (p.waiting ?? []).map((w) => ({ ...w, project: p })))
    const from = PROJECTS.find((p) => p.slug === WAITING?.slug)
    if (WAITING?.what && from !== undefined && !items.some((w) => w.what === WAITING.what)) {
      items.unshift({
        what: WAITING.what,
        who: WAITING.who ?? 'the office',
        blocks: false,
        project: from,
      })
    }
    if (items.length === 0) {
      return `<p class="t-meta">Nothing is waiting on you. The office carries on
        without asking unless it genuinely cannot.</p>`
    }
    return `<ul class="homelist">${items.slice(0, 8).map((w) => `
      <li class="homerow ${w.overdue ? 'od' : ''}">
        <!--
          A blocker lands on the job, everything else lands on the project.

          The blocked attribute already existed and already goes to AI Team,
          Active jobs, on the named project - it was the ribbon's route to a
          stopped job and nothing has drawn it since the ribbon went. Something
          holding the work up is a job, so that is where pressing it should
          arrive; a plain waiting item is about the project.

          One attribute or the other, never both: they are separate handlers and
          a button carrying both would fire two navigations. No backticks in
          this comment: template literal.
        -->
        <button class="homego" ${w.blocks
          ? `data-blocked="${esc(w.project.slug)}"`
          : `data-open="${esc(w.project.slug)}"`}>
          <span class="homemark ${esc(w.project.hue)}" aria-hidden="true"></span>
          <span class="homebody">
            <b>${esc(w.what)}</b>
            <span class="t-meta">${esc(w.project.name)} · ${esc(w.who)}${
              w.blocks ? ' · nothing else on this moves until you answer' : ''
            }</span>
          </span>
        </button>
      </li>`).join('')}</ul>`
  },

  /*
    Everything open, filtered the way he asked (#219).

    His list was *"due soon, overdue, priority, project, assigned agent/person,
    status."* Four of those are columns the payload actually carries, and they
    are the four offered. Priority is not one of them: `tasks` has no priority
    column, and a filter pill that silently matches everything is worse than an
    absent one - it is a control that lies, which section 59 is about.
  */
  tasks: () => {
    /*
      Three states, because "we have no answer" was standing in for two of them.

      `latest.tasks === null` is true while a read is in flight AND true when
      nothing ever asked, and the panel rendered the same sentence for both --
      which is CLAUDE.md's recorded shape exactly: when a default value is also
      a legitimate value, nothing downstream can tell "we decided this" from
      "we did not know".

      What that cost: `needTasks` is triggered from the block that runs AFTER
      the office answers, so on the PROTOTYPE path it is never called at all,
      and this panel read "Reading what is open…" for ever. Measured, not
      inferred -- a probe held the page open for 22 seconds and `latest.tasks`
      never left null. Every capture of the front door this repository has ever
      taken shows it, and the harness wait added to stop that could never pass,
      so it spent its full 14-second timeout on every run and photographed the
      loading state anyway. A comment here previously said the panels read it
      "for the first second or two"; that was a claim with no check behind it.

      So the sentence is now only ever shown when a read is genuinely out, and
      the no-token path draws invented tasks from the same PROJECTS the other
      four home panels already use -- the mock behind "there is no token",
      which is where `needHistory` was already taught to put it, rather than
      behind "the request failed".
    */
    const payload = latest.tasks ?? (canWrite() ? null : protoTasks())
    if (payload === null) {
      return askedTasks
        ? '<p class="t-meta">Reading what is open…</p>'
        : `<p class="t-meta">Could not read what is open. The office may not have
          answered yet — reloading is the quickest way to ask again.</p>`
    }
    const rows = Array.isArray(payload.tasks) ? payload.tasks : []
    if (rows.length === 0) {
      return `<p class="t-meta">Nothing open, here or on any project. Ask the team
        for something and it will land here.</p>`
    }
    const f = state.homeTasks ?? 'all'
    const soon = (t) => {
      if (t.due_on === null || t.due_on === undefined) return false
      const days = (new Date(`${t.due_on}T00:00:00Z`).getTime() - Date.now()) / 86_400_000
      return days <= 7
    }
    const keep = rows.filter((t) =>
      f === 'all' ? true
      : f === 'overdue' ? t.overdue === true
      : f === 'soon' ? soon(t) === true
      : f === 'waiting' ? (t.waiting === true || t.blocked_on !== null)
      : f === 'mine' ? (t.owner_name === null || t.owner_name === undefined)
      : true)
    const pill = (id, label, n) => `<button class="fpill ${f === id ? 'on' : ''}"
        data-home-tasks="${id}" aria-pressed="${f === id}">${esc(label)}${
        n === null ? '' : `<span class="n">${String(n)}</span>`}</button>`
    const count = (fn) => rows.filter(fn).length
    return `<div class="fpills" role="group" aria-label="Filter the tasks">
        ${pill('all', 'All', rows.length)}
        ${pill('overdue', 'Overdue', count((t) => t.overdue === true))}
        ${pill('soon', 'Due in a week', count(soon))}
        ${pill('waiting', 'Waiting', count((t) => t.waiting === true || t.blocked_on !== null))}
        ${pill('mine', 'Nobody on it', count((t) => t.owner_name === null || t.owner_name === undefined))}
      </div>
      ${keep.length === 0
        ? '<p class="t-meta">Nothing under that filter, which is the good answer.</p>'
        : `<ul class="homelist">${keep.slice(0, 40).map((t) => `
        <li class="homerow ${t.overdue === true ? 'od' : ''}">
          <!--
            No id, no tick. The prototype's rows are invented and carry none,
            and a tick wired to the string "null" is a control that lies -
            which is the thing this file keeps paying for. .homerow is flex, so
            leaving it out closes the gap rather than breaking a column, and in
            the prototype every row is in the same state so nothing looks
            ragged.
          -->
          ${t.id ? `<button class="ptick" data-tick="${esc(t.id)}" title="Mark done"
            aria-label="Mark &ldquo;${esc(t.title)}&rdquo; done"></button>` : ''}
          <span class="homebody">
            <b>${esc(t.title)}</b>
            <span class="t-meta">${
              t.project_name === null || t.project_name === undefined
                ? 'No project' : esc(String(t.project_name))
            }${t.owner_name ? ` · ${esc(String(t.owner_name))}` : ''}${
              t.due_on ? ` · due ${esc(new Date(`${t.due_on}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short' }))}` : ''
            }${t.overdue === true ? ' · overdue' : ''}</span>
          </span>
        </li>`).join('')}</ul>`}`
  },

  /*
    The real project cards, in a column.

    Not a plainer list written for this panel. Grant's objection was that the
    cards were the WHOLE page - *"Projects should remain discoverable without
    consuming the entire purpose of the home screen"* - not that the cards are
    wrong, and they carry the cover, the progress and the counts that a list
    would have had to leave out or rebuild.

    It also keeps one renderer for a project card. Thirteen harness files open a
    project by pressing this exact element, and a second, simpler card would
    have been the one that quietly stopped matching them - which is this file's
    most-recorded failure, a list built twice.
  */
  projects: () => `<div class="homeprojects">${PROJECTS.map((p) => card(p, false)).join('')}</div>`,

  team: () => {
    const busy = CREW.filter((c) => c.state === 'busy')
    return `<div class="homecrew">${CREW.map((c) => `
        <span class="homeface ${c.state}">${face(c, 30)}
          <span class="homebody">
            <b>${esc(c.name)}</b>
            <span class="t-meta">${esc(c.doing ?? c.role)}</span>
          </span>
        </span>`).join('')}</div>
      <p class="t-meta homefoot">${busy.length === 0
        ? 'Nobody is mid-task. That is idle, not broken.'
        : `${String(busy.length)} of ${String(CREW.length)} working now.`}</p>`
  },

  activity: () => {
    const rows = PROJECTS.flatMap((p) => (p.activity ?? []).map((a) => ({ ...a, project: p })))
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    if (rows.length === 0) return '<p class="t-meta">Nothing yet. This fills itself in.</p>'
    return `<div class="tasks">${rows.slice(0, 20).map((a) => {
      const c = crewBy(a.who)
      return `<div class="task" style="cursor:default">${face(c, 22)}
        <span class="label t-meta" style="color:var(--ink)">
          <b style="font-weight:600">${esc(c.name)}</b> ${esc(a.verb)} ${esc(a.what)}
          <span style="color:var(--ink-3)"> · ${esc(a.project.name)} · ${when.stamp(a.at, a.when)}</span>
        </span></div>`
    }).join('')}</div>`
  },
}

function portfolio() {
  /*
    A board, not a wall of project cards (#219).

    The same engine the project pages use, deliberately: Grant asked for *"the
    same modular dashboard philosophy as project pages - drag modules, reorder
    modules, resize modules, collapse modules, persist layout"*, and a second
    grid written for this screen would be the one that drifts. The arrangement
    is his and it follows him between devices, which is what migration 0376 is
    for; `localStorage` is only the cache that makes a drag feel instant.
  */
  const mine = panels.homeLayout()
  const spare = panels.HOME_KINDS.filter((k) => !mine.some((m) => m.id === k.id))
  const tallest = mine.reduce((m, sp) => Math.max(m, sp.y + sp.h), 0)

  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">${esc(greeting())}, Grant</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(standing())}</p>
      </div>
      <!--
        A new dashboard project (#68).

        Grant: "Please don't assume I wish to create a new project — this is a
        large task and should always be confirmed." So it takes two steps by
        design: the button opens the field, and the field is what creates. And
        hq_create_project without p_force returns CANDIDATES rather than
        creating, which is the behaviour that stops a fifth notebook for one
        intention — the studio shows them and makes him choose.

        No backticks in this comment: template literal.
      -->
      ${canWrite() ? `<span class="newproj" data-saidwrap>
        <input data-new-name placeholder="Name a new project" aria-label="Name a new project">
        <input data-new-ref placeholder="…and a link to attach" aria-label="A link to attach">
        <button class="btn" data-new-project>Create</button>
        <span class="t-meta" data-said></span>
      </span>` : ''}
      <!--
        The board's own controls, on the greeting's line.

        They were a row of their own between the greeting and the first panel -
        sixty pixels holding one Reset button and a great deal of nothing, on
        the screen section 24 asks the composition question about hardest. The
        head already has a right-hand slot and this is what it is for.
      -->
      <div class="headctl">
        ${spare.length === 0 ? '' : `<div class="addpanel">
          <button class="btn" data-home-add-open>+ Add panel</button>
          <div class="addmenu" data-home-add-menu hidden>
            ${spare.map((k) => `<button data-home-add="${k.id}">
              <b>${esc(k.name)}</b><span class="t-meta">${esc(k.note)}</span></button>`).join('')}
          </div>
        </div>`}
        <button class="btn" data-home-reset title="Put the home screen back">Reset</button>
      </div>
    </div>
    <!--
      The banner is gone from here (#219, and section 23's question).

      It drew ONE waiting item, above the project cards, in a card of its own -
      and the board now has a Waiting on you panel that draws every one of them
      across every project, with the project named and a way in. Two surfaces
      for the same fact, one of them showing a fraction of it, is exactly the
      duplication the density audit asks about: *"what can disappear?"*

      Its item is not lost. The panel takes the top-level one as well, so
      nothing the office says is waiting stops being visible.

      No backticks in this comment. Template literal.
    -->
    <!-- Same tree as a project's: h1 the greeting, h2 the section, h3 each
         panel. Hidden, because the page is the dashboard and saying so twice
         is furniture. -->
    <h2 class="aonly">Your dashboard</h2>
    <div class="tabbody">
      <div class="board" data-home-board style="height:${Math.max(tallest + 40, 520)}px">
        ${mine.map((spec) => panelChrome(spec, panels.HOME_KINDS,
          (id) => HOME_PANEL[id]?.() ?? '')).join('')}
      </div>
    </div>
  </main>`
}

/*
  The contents of each panel.

  Split out of `dashboard()` so a panel is a thing that can be positioned,
  removed and re-added, rather than a section that happens to be in a fixed
  order. Each takes the project and returns its inside; the chrome — title,
  grip, controls — is the same for all of them.
*/
const PANEL = {
  modules: (p) => p.modules.length === 0
    ? `<p class="t-meta">No modules on this project yet — a module is a part of
         the work, with its own tasks and documents underneath it.</p>
       ${canWrite() ? '<button class="btn" data-empty-do="module">Add a module</button>' : ''}`
    : `<div class="modgrid">${p.modules.map((m) => `
        <div class="module" style="--dot:${
          m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
        }">
          <div class="t-label" style="color:${
            m.state === 'done' ? 'var(--good)' : m.state === 'doing' ? 'var(--warn)' : 'var(--ink-3)'
          }">${m.state === 'done' ? 'Done' : m.state === 'doing' ? 'In hand' : 'Not started'}</div>
          <div style="font-weight:600;font-size:14px;margin-top:5px;line-height:1.35">${esc(m.name)}</div>
          <div class="t-meta" style="margin-top:4px">${m.docs} docs · ${m.tasks} tasks</div>
          ${talkBtn('module', String(m.n), m.name)}
        </div>`).join('')}</div>`,

  /*
    The shelf, plus whatever Grant has approved out of the Team tab.

    This is the other half of the review gate (#28): an artifact the team made
    is nowhere near the project's documents until it is approved, and the moment
    it is, it is simply a document. Two shelves for "yours" and "approved" would
    put the in-tray back in the library.
  */
  documents: (p) => {
    const docs = allDocs(p)
    return docs.length === 0
      ? `<p class="t-meta">Nothing here yet. Drop a file, or ask the team to make one.</p>`
      : `<div class="shelf" data-shelf>${docs.map(docCard).join('')}</div>`
  },

  tasks: (p) => `<div class="tasks">${p.tasks.map(taskRow).join('')}</div>`,

  contacts: (p) => p.contacts.length === 0
    ? `<p class="t-meta">Nobody on this project yet.</p>`
    : `<div class="contacts">${p.contacts.map(contactCard).join('')}</div>`,

  activity: (p) => `<div class="tasks">${p.activity.map((a) => {
    const c = crewBy(a.who)
    return `<div class="task" style="cursor:default">${face(c, 22)}
      <span class="label t-meta" style="color:var(--ink)">
        <b style="font-weight:600">${esc(c.name)}</b> ${esc(a.verb)} ${esc(a.what)}
        <span style="color:var(--ink-3)"> · ${when.stamp(a.at, a.when)}</span></span></div>`
  }).join('')}</div>`,

  /*
    How it got here (#156).

    Oldest first, which is the opposite of every other list in the product and
    is the point: a story is read forwards. Grant's own distinction — "a feed
    of every job is noise at month three; a sequence of the project changed in
    this way is a story."

    The words come from `app.project_history`, which derives them from the
    timestamps the rows already carry. Nothing is composed here beyond the
    verb, so the page and an agent asking the same question get the same
    answer.
  */
  history: (p) => {
    const story = stories[p.slug]
    if (story === undefined || story === null) {
      needHistory(p.slug)
      return `<p class="t-meta">Reading how this project got here…</p>`
    }
    if (story.length === 0) {
      return `<p class="t-meta">Nothing has happened to ${esc(p.name)} yet — it was only just
        started, and the first source you attach will be the first line of this.</p>`
    }
    const WORD = {
      created: 'started',
      attached: 'attached',
      detached: 'detached',
      source: 'came in',
      made: 'written',
      finished: 'finished',
      milestone: 'milestone',
      standing: 'where it stands',
    }
    return `<ol class="story">${story
      .map(
        (e) => `<li class="storyat t-meta">
          <!--
            One format down the column, and it is absolute (#156).

            when.stamp switches to "26 days ago" past a threshold, which is
            right everywhere else in the product and wrong here: the capture
            showed "16 Aug" followed by "26 days ago", and in a column read
            top to bottom that looks like the sequence going backwards. A
            story needs one scale or it stops being one.

            The exact instant is still on the title, so hovering gives the
            time of day this deliberately leaves out.

            No backticks in this comment. Template literal.
          -->
          <span class="storywhen" title="${esc(when.exact(e.at))}">${esc(shortDay(e.at))}</span>
          <span class="storykind k-${esc(e.kind)}">${esc(WORD[e.kind] ?? e.kind)}</span>
          <span class="storywhat">${esc(e.what)}</span>
          ${e.detail ? `<span class="storywhy">${esc(e.detail)}</span>` : ''}
        </li>`,
      )
      .join('')}</ol>`
  },

  links: (p) => `<div class="links" style="margin:0">
      ${p.connectors.length === 0
        ? '<span class="t-meta">Nothing yet — this project stands on its own.</span>'
        : p.connectors.map((c) => `<span class="link">${esc(c)}</span>`).join('')}
      <!--
        The project's own version of the same dead button (#92). It goes to the
        project's Sources tab, which is where attaching to THIS project happens
        and where a pasted Drive link is already recognised on its own (#62) —
        not to Settings, which is about the office's credentials rather than
        about this project.
      -->
      <button class="link add" data-empty-do="sources">+ Connect something</button>
    </div>`,

  note: () => `<textarea class="notepad" placeholder="Anything you want to remember about
this project…" aria-label="Note"></textarea>`,
}


/*
  The team's in-tray (#28).

  A request and the artifact it produced are one row, because the question a
  produced file has to answer is *why does this exist* — and neither an activity
  feed (outputs without requests) nor a job queue (requests without outputs)
  answers it.

  Waiting first. Approving is what moves an artifact into the project; until
  then the project does not have it. That gate is the substance of Grant's word
  "coordinated" — the two columns are just how you see it.
*/
function teamTab(p) {
  const { all, waiting, working, settled } = workspace.split(p)
  const crewHere = [...new Set(all.map((r) => r.who))].map(crewBy)

  if (all.length === 0) {
    return `<div class="tabbody">${emptyState({
      says: `The team has nothing in hand on ${esc(p.name)}, and has made nothing for it yet.`,
      ask: { name: 'Ask them to look at it',
             say: `Look over ${p.name} and tell me the three things most worth doing next.` },
      mine: 'Open the chat',
    })}</div>`
  }

  const row = (r) => {
    const c = crewBy(r.who)
    const st = workspace.STATE[r.state] ?? workspace.STATE.working
    return `<article class="wrow ${st.hue}" data-row="${esc(r.id)}">
      <div class="wask">
        <span class="t-label">Asked · ${when.stamp(r.askedAt, r.asked)}</span>
        <p>${esc(r.ask)}</p>
        <span class="t-meta">${esc(r.from)}${
          r.context ? ` · about ${esc(r.context.title)}` : ''}</span>
      </div>
      <div class="warrow" aria-hidden="true">
        ${face(c, 30)}
        <svg width="34" height="10" viewBox="0 0 34 10" fill="none" stroke="var(--ink-3)"
             stroke-width="1.4" stroke-linecap="round"><path d="M1 5h28M25 1l4 4-4 4"/></svg>
      </div>
      <div class="wout">
        <span class="stage s-${esc(r.state)}">${esc(st.name)}</span>
        ${r.output === null || r.output === undefined
          ? `<p class="t-meta">${esc(c.name)} is on it. Nothing to look at yet.</p>`
          : `<${r.output.id ? 'button type="button"' : 'div'} class="woutfile"
              ${r.output.id ? `data-out-open="${esc(r.output.id)}" data-out-row="${esc(r.id)}"
                aria-label="Open ${esc(r.output.title)}"` : ''}
              style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
              <span class="wpage">${pageSvg(r.output.title, r.output.kind)}</span>
              <span>
                <b>${esc(r.output.title)}</b>
                <span class="t-meta">${esc(c.name)} · ${when.stamp(r.deliveredAt, r.delivered)} · ${esc(r.output.size)}</span>
                ${r.derived.length === 0 ? '' :
                  `<span class="t-meta from">From ${esc(r.derived.join(', '))}</span>`}
              </span>
            </${r.output.id ? 'button' : 'div'}>`}
        <div class="wctl">
          <!--
            IMPORT TO PROJECT is a STEP, not a button (#28).

            The specification draws it as its own box with four things chosen
            inside it, and the reason is that the moment an output enters the
            project is the only moment anybody will ever choose them. "Add to
            project" as a single press meant a document with no collection, no
            tags and no relations, filed nowhere, findable only by scrolling.

            Opening the sheet rather than importing immediately, and the sheet
            can still be submitted with nothing filled in — that means "yes, and
            I have nothing to add", which is a real answer.

            No backticks in this comment: template literal.
          -->
          ${r.state === 'review' && r.output?.id ? `
            <button class="btn primary" data-import="${esc(r.output.id)}"
              data-import-title="${esc(r.output.title)}">Import to project…</button>
            <button class="btn" data-drop="${esc(r.output.id)}">Drop</button>` : ''}
          ${(r.state === 'approved' || r.state === 'discarded') && r.output?.id
            ? `<button class="btn" data-undecide="${esc(r.output.id)}">Undo</button>` : ''}
          ${talkBtn('request', r.id, r.ask)}
        </div>
      </div>
    </article>`
  }

  const group = (name, note, rows2) => rows2.length === 0 ? '' : `
    <section class="wgroup">
      <h3 class="t-label">${esc(name)} <span class="n">${rows2.length}</span></h3>
      <p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>
      ${rows2.map(row).join('')}
    </section>`

  /*
    Outputs was not dead. It was EMPTY, which looks identical (#217).

    Grant: *"Clicking Outputs currently appears to do nothing."* The sub-tab
    wiring was fine and the prototype fixture renders eight rows through it -
    which is exactly why nobody caught this. Each of the three groups returns
    an empty string when it holds no rows, so against his real office, where
    the team had been asked for nothing yet, pressing Outputs produced one
    sentence of lead copy and a blank page below it. A control that changes
    nothing you can see has, as far as the person pressing it is concerned, done
    nothing.

    So it says so. His words for the rule: *"Outputs should display the
    artifacts/results generated by the AI team, or clearly state that none exist
    yet. A navigation control should never silently do nothing."*

    The action offered is to ask the team for something, because that is the
    thing that fills this page, and #105's rule is that an empty state whose
    button does nothing is worse than an empty state with no button.
  */
  const nothingBack = waiting.length === 0 && working.length === 0 && settled.length === 0

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">What the team was asked, and what came back.
        Nothing they make joins ${esc(p.name)} until you say so.</p>
      <div class="crew" style="margin:0">${crewHere.map((c) => face(c)).join('')}</div>
    </div>
    ${nothingBack ? emptyState({
      says: `The team has not been asked for anything on ${esc(p.name)} yet, so there is
             nothing to review. Whatever they make will wait here for your decision before
             it joins the project.`,
      ask: { name: 'Ask the team for something',
             say: `Look at what ${p.name} already holds and tell me the first thing worth doing.` },
    }) : ''}
    <!--
      What happens if it is ignored, said out loud (#14).

      "Finished, and waiting on your decision" describes the state and leaves
      the consequence to be guessed at, and the consequence is the whole reason
      the group is first: an output nobody decides on is an output the project
      does not have. It is not lost and it is not filed - saying which is the
      difference between a queue Grant works through and a queue he learns to
      scroll past.

      No backticks in this comment: template literal.
    -->
    ${group('Needs you',
      'Finished, and waiting on your decision. Nothing here is in the project yet — ' +
      'an output left undecided stays out of Documents, and stays on the record either way.',
      waiting)}
    ${group('In hand', 'Being worked on now.', working)}
    ${group('Settled', 'Already decided.', settled)}
  </div>`
}

/*
  The chat (#26).

  The same conversation as the call button, in the mode you use when you cannot
  talk or when you want a record. Per project, and it carries the attached item
  as a visible, removable chip — invisible context is context you cannot trust.

  The replies here are marked `pending`, and the UI says so, because the
  prototype has no team behind it. Faking a plausible answer would make the
  prototype prove something that is not true.
*/
/*
  One bubble renderer, used by the Chat tab and by the dock (#103).

  Hoisted out of `chatTab` when the dock arrived: two copies of "what a message
  looks like" would have drifted the first time one of them changed, and the
  one that drifted would have been the dock, because it is the one nobody has
  open while editing the other.
*/
/*
  One message's attribution, in words (#200).

  The name is repeated from the visible label rather than shared with it,
  because the visible one is `aria-hidden` — a screen reader hearing "Emma
  Research Emma, Research, at 14:32" would be worse than either alone. The
  visible label keeps its own typography; this one keeps the facts.

  The time is deliberately the time and not "2 hours ago": a relative time read
  aloud is a fact that was true when the page was drawn, and a conversation
  page can be open all day.

  The surface matters more here than it looks. A message Grant sent from Slack
  and a message he sent here are the same conversation (#192), and on screen
  they are indistinguishable — which is right. Non-visually there is nothing
  else to go on, so it is said.
*/
const saidBy = (who, m) => {
  const name = who === 'grant' ? 'You' : (crewBy(who)?.name ?? 'The office')
  const role = who === 'grant' ? '' : `, ${crewBy(who)?.role ?? ''}`
  const at = m.at === undefined || m.at === null || m.at === ''
    ? ''
    : `, ${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const to = m.to === undefined || m.to === null || m.to === ''
    ? ''
    : `, to ${crewBy(m.to)?.name ?? String(m.to)}`
  const where = m.surface === undefined || m.surface === null || m.surface === 'teamhq'
    ? ''
    : `, from ${String(m.surface)}`
  return `${name}${role}${at}${to}${where}`
}

const bubble = (m) => {
    if (m.from === 'grant') {
      /*
        The reconstructed mark belongs on THIS branch more than on the other
        one: a backfilled conversation is mostly Grant's own messages, imported
        from a channel's past. Adding it only to the office's replies would
        have marked the rare case and missed the common one.
      */
      /*
        Who, when and to whom — available to a screen reader (#200).

        On screen this is carried by position (your messages are on the right)
        and by colour, and neither exists for somebody listening to the page.
        The visually-hidden line is the same three facts in words, first in
        reading order so the message is attributed before it is read out.

        `role=listitem` inside the thread's `role=list`: a conversation is a
        list of messages and announcing "list, 14 items" is how you know how
        much there is before you start.
      */
      return `<div class="msg mine" role="listitem">
        <span class="aonly">${esc(saidBy('grant', m))}</span>
        ${m.context ? `<span class="ctxchip">${esc(m.context.title)}</span>` : ''}
        ${prose(m.text)}
        ${m.backfilled ? '<span class="t-meta pendmark">From the channel history</span>' : ''}
      </div>`
    }
    /*
      A request that has not been answered is a STATE, not a message (#215).

      Grant: *"Investigate why a message can currently be sent and still have no
      response several minutes later. Surface useful states such as Sending,
      Thinking/processing, Delivered, Failed, Retry. Do not leave the user
      wondering whether anything happened."*

      The reason he was left wondering is that the studio invented a reply. The
      moment Send was pressed it wrote a sentence in a named agent's voice -
      picked by keyword, before anyone had been asked - so the thread showed an
      instant, confident answer and nothing anywhere said the real request was
      still in the air. Waiting was invisible because it had already been
      painted over.

      So while the office has not answered, this draws what is actually true and
      nothing else: which of four states the request is in, and how long it has
      been there. No name, no face, no voice - because nobody has spoken yet,
      and attributing silence to Emma is the same class of claim the backend
      spent a certification campaign learning not to make.

      No backticks in this comment. Template literal.
    */
    if (typeof m.waiting === 'string' && m.waiting !== '' && m.waiting !== 'failed') {
      const said = {
        sending: 'Sending to the office…',
        thinking: 'With the team. They are working on it.',
        slow: 'No answer yet. The office may still be working — it also answers in Slack and Telegram.',
      }[m.waiting] ?? 'Waiting.'
      return `<div class="msg theirs waitrow" role="listitem" aria-live="polite">
        <span class="waitspin" aria-hidden="true"></span>
        <div class="mbody">
          <!--
            The same visually-hidden attribution every other message carries
            (#200). A waiting row IS a message in the thread - it occupies a
            listitem and it is what somebody listening hears next - so leaving
            it out would make the conversation's narration skip a beat exactly
            where the explanation is. No backticks in this comment.
          -->
          <span class="aonly">The team${
            m.at ? `, ${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''
          } — has not answered yet</span>
          <span class="t-meta waitsay">${esc(said)}</span>
          ${typeof m.since === 'number'
            ? `<span class="t-meta waitage" data-waiting-since="${m.since}"></span>` : ''}
          ${m.waiting === 'slow' && typeof m.said === 'string'
            ? `<button class="btn" data-chat-retry="${esc(m.id)}">Ask again</button>` : ''}
        </div>
      </div>`
    }

    const c = crewBy(m.from)
    return `<div class="msg theirs ${m.bad ? 'bad' : ''}" role="listitem"
         style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 30)}
      <div class="mbody">
        <span class="aonly">${esc(saidBy(m.from, m))}</span>
        <span class="t-label" aria-hidden="true">${esc(c.name)} · ${esc(c.role)}</span>
        ${prose(m.text)}
        <!--
          A failure that can be tried again (#215).

          Grant asked for Retry by name. Only on a row that still carries the
          words, because a button that cannot resend anything is worse than no
          button - which is #105's whole lesson about empty states.

          No backticks in this comment. Template literal.
        -->
        ${m.waiting === 'failed' && typeof m.said === 'string'
          ? `<button class="btn" data-chat-retry="${esc(m.id)}">Try again</button>` : ''}
        <!--
          What the office is doing with it (#103).

          This used to say "Prototype - no team behind this yet" on EVERY
          reply, for ever, because the reply was invented locally and nothing
          was ever asked. Now it is asked, so the note means what it says: it
          is on screen only while the answer is on its way, and it is replaced
          by the real one.

          No backticks in this comment. Template literal.
        -->
        ${m.pending ? '<span class="t-meta pendmark">Asking the office…</span>' : ''}
        <!--
          Reconstructed history (0340). Imported from a channel's past, which
          the office did not watch happen — so it says so rather than letting
          the page imply it was there. No backticks in this comment.
        -->
        ${m.backfilled ? '<span class="t-meta pendmark">From the channel history, before the office was watching</span>' : ''}
        ${m.delegated ? `<span class="t-meta pendmark">Put to the team — the answer comes
          back in Slack and Telegram too.</span>` : ''}
        <!--
          Could not be delivered (#202).

          Silence looks the same whether the office has not answered yet or the
          answer could not reach him, and those mean opposite things: one is
          wait, the other is act. Only drawn when a delivery genuinely failed —
          an answer read here was never a delivery at all, and marking every
          one of them undelivered would be the alarming wording for the normal
          state, which is the mistake #119 records.

          The retry is a person's decision, and it is the only door out of a
          failed delivery: the worker that gave up must not quietly change its
          mind. No backticks in this comment.
        -->
        ${m.delivery === 'failed' ? `<span class="t-meta undeliv">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 8v5M12 16.5v.1M12 3.2L1.8 20.8h20.4z"/></svg>
          Could not be delivered${m.undelivered > 1
            ? ` to ${esc(String(m.undelivered))} places`
            : ''}.
          ${canWrite() && m.job !== null
            ? `<button type="button" class="linky" data-retry-send="${esc(String(m.job))}">Try again</button>`
            : ''}
        </span>` : ''}
        ${m.delivery === 'sending' ? '<span class="t-meta pendmark">Still going out…</span>' : ''}
      </div>
    </div>`
  }


/*
  What the addressee line says, in one place (#26).

  Three sentences for three states, and the third is the one worth getting
  right: when Grant has picked companions the line has to NAME them, because
  the Issue asks for the choice to be legible before the message is sent and
  a count would not be.
*/
function askWhoSays() {
  const who = state.askWho
  if (who === undefined || who === 'everyone') return 'Claire will bring in whoever it needs.'
  const also = (state.askAlso ?? []).filter((x) => x !== who)
  if (also.length === 0) return `Goes straight to ${crewBy(who).name}.`
  const names = also.map((x) => crewBy(x).name)
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${crewBy(who).name} answers, with ${list} — each in their own name.`
}

function chatTab(p) {
  const messages = chat.thread(p.slug)
  const a = state.attach

  /*
    The way out, and it is the first thing in the panel (#97, #98).

    Grant: *"ensure users can reliably return from the conversation to
    Documents"* and *"Provide an obvious X that closes the conversation panel
    and returns to the document."*

    Obvious is the requirement and it is the one most easily failed. Not
    hover-revealed: `opacity: 0` hides pixels and not layout, and on a touch
    screen a hover-revealed control does not exist at all — that is #67, where
    eight agent names wrapped one character per line behind an invisible
    button. And 44px, because the moment `verify:ui` was pointed at the right
    payload it found a 68x24 target in this same area.

    Two controls rather than one, because they do different things and merging
    them would be the bug: the X leaves the conversation and goes back to what
    you were reading; the small x on the chip below detaches the document and
    keeps you here to write about something else.

    This is a JS block comment, not an HTML one — it sits outside the template
    literal, so it closes with a star-slash and not with an arrow. Getting that
    wrong left the comment unterminated and the file unparseable.
  */
  const backTo = a?.back?.tab
  const backName = SECTIONS.find((sx) => sx.id === backTo)?.name ?? 'the project'

  return `<div class="tabbody chatbody">
    ${a?.back === undefined ? '' : `<div class="backbar">
      <button class="btn quiet backbtn" data-back-out>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6"/></svg>
        Back to ${esc(backName)}
      </button>
      <span class="t-meta">Talking about ${esc(a.title)}</span>
      <button class="closeconv" data-back-out aria-label="Close this conversation and go back to ${esc(backName)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`}
    <!--
      The thread is a LIST of messages, and says so (#200). A person listening
      to the page is told how many there are before the first one is read out,
      and can move between them with one key rather than by word.

      It is deliberately NOT a live region. Marking the whole thread live would
      announce the "Asking the office" placeholder as though it were an answer,
      which is the exact thing #200 rules out — a reply is announced and a
      typing indicator is not. The announcement is made by hand, once, for
      messages that are real. No backticks in this comment.
    -->
    <div class="threadwrap">
      <!--
        The list role only when there IS a list.

        role=list requires every child to be a listitem, and the empty state is
        a paragraph explaining that nothing has been said yet. axe caught it on
        four of eleven screens the moment the role was added, which is the
        argument for running it: the markup read fine and was wrong.
        No backticks in this comment.
      -->
      <div class="thread" data-thread ${messages.length === 0 ? '' : 'role="list"'}
           aria-label="Conversation about ${esc(p.name)}">
        ${messages.length === 0
          ? `<div class="empty">
              <p class="t-meta">Nothing said about ${esc(p.name)} yet. Ask for something, or
                press the talk button on any document, person or task to start with that
                already attached.</p>
            </div>`
          : messages.map(bubble).join('')}
      </div>
      <!--
        What arrived while you were reading further up (#205).

        Inside the thread's own wrapper rather than fixed to the viewport, for
        a reason this repository has already paid for: backdrop-filter
        establishes a containing block, so a fixed child anchors to that
        element instead of the screen, and the composer area is exactly where
        that has bitten before.

        Hidden with the hidden attribute rather than a class, so it is out of
        the accessibility tree as well as off the screen — a button a screen
        reader can reach and a sighted person cannot is worse than no button.
      -->
      <button type="button" class="arrived" data-arrived hidden
              aria-label="Jump to the newest message">
        <span class="arrdot" aria-hidden="true"></span>
        <span data-arrived-says>New message</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 5v13M6 13l6 6 6-6"/></svg>
      </button>
    </div>
    <form class="composer" data-composer>
      ${a === null ? '' : `<div class="attached">
        <span class="t-label">About</span>
        <span class="ctxchip">${esc(a.title)}
          <button type="button" data-unattach aria-label="Remove ${esc(a.title)}">×</button>
        </span>
      </div>`}
      <!--
        Who it is for (#26). All three of them, now.

        The specification asks for one agent, selected agents, or the entire
        team. This used to carry two and say so: "selected" was missing
        because several people answering one message is several jobs sharing a
        thread, and a control that looks like it does that and does not is
        worse than no control. 0410 and 0411 made it real — the selection
        joins the same alsoConvened path a routed roster takes, one child job
        each, each answering in their own name — so the control can exist.

        Everyone is still the DEFAULT and is still not a broadcast: with
        nobody named the Chief of Staff takes it, and since #65 she can really
        bring people in. So the whole team is one answer from Claire saying
        who she asked, rather than eight near-identical replies — the outcome
        the Issue asks for rather than a shortcut around it.

        A select for the first choice, because eight faces on a phone composer
        is most of the composer and this is a thing you set occasionally. The
        others are behind a disclosure, so the common case — ask the team, say
        nothing about who — is exactly as short as it was.

        No backticks in this comment: template literal.
      -->
      <label class="askwho">
        <span class="t-label">Ask</span>
        <select data-askwho aria-label="Who this message is for">
          <option value="everyone"${state.askWho === 'everyone' ? ' selected' : ''}>the whole team</option>
          ${CREW.map((c) => `<option value="${esc(c.slug)}"${
            state.askWho === c.slug ? ' selected' : ''}>${esc(c.name)} — ${esc(c.role)}</option>`).join('')}
        </select>
        <span class="t-meta">${askWhoSays()}</span>
      </label>
      ${state.askWho === 'everyone' || state.askWho === undefined ? '' : `
      <div class="askalso">
        <button type="button" class="btn quiet small" data-askalso-open
                aria-expanded="${state.askAlsoOpen === true ? 'true' : 'false'}">
          ${state.askAlsoOpen === true ? 'Just them' : 'Ask somebody else too'}
        </button>
        ${state.askAlsoOpen !== true ? '' : `<span class="alsochips" role="group"
            aria-label="Who else should answer">
          ${CREW.filter((c) => c.slug !== state.askWho).map((c) => `<button type="button"
              class="alsochip ${(state.askAlso ?? []).includes(c.slug) ? 'on' : ''} ${esc(c.hue ?? '')}"
              data-askalso="${esc(c.slug)}"
              aria-pressed="${(state.askAlso ?? []).includes(c.slug) ? 'true' : 'false'}"
              title="${esc(c.name)} — ${esc(c.role)}">${esc(c.name)}</button>`).join('')}
        </span>`}
      </div>`}
      <!--
        Dictation (#196). Speaking a message, not placing a call — the call
        button is elsewhere and answers in two seconds; this one puts words in
        the box for Grant to read before anything is sent.

        Disabled with the reason rather than hidden where the browser cannot
        transcribe: a control that is absent teaches nothing, and a control
        that is present and silently dead is the defect the Issue names.

        The title carries the disclosure, because in Chrome the audio goes to
        Google to be transcribed and a person deserves to know that before
        they press it rather than after.
      -->
      <div class="crow">
        <textarea data-say rows="1" placeholder="Ask the team, or tell them what to do…"
                  aria-label="Message the team"></textarea>
        <button class="btn mic" type="button" data-dictate
                ${dictate.supported() ? '' : 'disabled'}
                aria-pressed="false"
                aria-label="Dictate a message"
                title="${esc(dictate.supported() ? dictate.disclosure() : dictate.why())}">
          ${icons.svg('mic', 18)}
        </button>
        <button class="btn primary" type="submit">Send</button>
      </div>
      <p class="dicsay t-meta" data-dicsay role="status" aria-live="polite"></p>
    </form>
  </div>`
}


/*
  Team board — who is on this project.

  The specification lists roles (Chief of Staff, Research, Development, QA), not
  the eight named staff this office actually has. The staff ARE those roles, so
  this shows the real people rather than inventing a second vocabulary — but it
  says what each is doing here, because a board that only lists names is the
  "eight identical dots" the portraits were introduced to replace.
*/
function teamBoard(p) {
  const here = new Set((p.requests ?? []).map((r) => r.who))
  for (const a of p.activity) here.add(a.who)
  const onIt = CREW.filter((c) => here.has(c.slug))
  const rest = CREW.filter((c) => !here.has(c.slug))

  const jobsFor = (slug) => (p.requests ?? []).filter((r) => r.who === slug)

  /*
    What they have actually done, across the office (#155).

    Grant: *"Eight cards saying Available... It is an org chart where a team
    page should be."* The line above is about THIS project; this is about the
    person, over the last fortnight, everywhere.

    The failures are on the card and not behind it, which is the issue's own
    instruction and the one worth defending: *"what they failed at — visible,
    not hidden, because a team page that only shows wins is decoration."* An
    office that reports only its successes trains the reader to stop reading,
    which is the same defect as a health line that always says fine.

    Nothing is drawn when the office has not answered yet or when the person has
    not been asked for anything. An agent with nothing to show says nothing
    rather than saying zero four times.
  */
  const workOf = (slug) => {
    const w = teamWork[slug]
    if (w === undefined || (w.asked ?? 0) === 0) return ''
    const bits = []
    if (w.in_hand > 0) bits.push(`${w.in_hand} in hand`)
    if (w.answered > 0) bits.push(`${w.answered} answered`)
    if (w.could_not > 0) bits.push(`${w.could_not} could not`)
    if (bits.length === 0) return ''
    const wall = (w.walls ?? [])[0]
    return `<span class="mwork">
      <span class="mcounts">${esc(bits.join(' · '))}</span>
      ${
        wall === undefined
          ? ''
          : `<span class="mwall" title="What stopped it">${esc(String(wall.needed ?? '').slice(0, 72))}</span>`
      }
      ${
        (w.made ?? []).length === 0
          ? ''
          : `<span class="mmade">${esc(String(w.made[0].title ?? '').slice(0, 54))}</span>`
      }
    </span>`
  }

  const memberCard = (c, active) => {
    const mine = jobsFor(c.slug)
    const open = mine.filter((r) => r.state === 'working' || r.state === 'review')
    return `<article class="member ${c.hue} ${active ? '' : 'quiet'}"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 42)}
      <div class="mwho">
        <b>${esc(c.name)}</b>
        <span class="t-meta">${esc(c.role)}</span>
        <span class="t-meta from">${
          active
            ? open.length > 0
              ? `${open.length} open on this project`
              : `${mine.length} finished here`
            : 'Not working on this project'
        }</span>
        ${workOf(c.slug)}
      </div>
      ${talkBtn('agent', c.slug, c.name)}
    </article>`
  }

  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Who is on ${esc(p.name)}. Press the
        talk button on anyone to give them something.</p>
    </div>
    <div class="members">${onIt.map((c) => memberCard(c, true)).join('')}</div>
    ${rest.length === 0 ? '' : `
      <h3 class="t-label" style="margin:var(--s3) 0 0">Available</h3>
      <div class="members">${rest.map((c) => memberCard(c, false)).join('')}</div>`}
  </div>`
}

/*
  Active jobs — running, waiting/blocked, completed.

  Waiting/blocked is the reason this section exists. The first version had two
  states, "in hand" and "needs you", and a job stuck on a missing credential
  read as in hand — which says the opposite of the truth about it. A blocked job
  states its blocker and offers the one action that clears it.
*/
function activeJobs(p) {
  const rows = workspace.rows(p)
  const running = rows.filter((r) => r.state === 'working' && r.blocked === undefined)
  const blocked = rows.filter((r) => r.blocked !== undefined)
  const done = rows.filter((r) => r.state !== 'working' && r.blocked === undefined)

  if (rows.length === 0) {
    return `<div class="tabbody">${emptyState({
      says: `Nobody is working on ${esc(p.name)} right now.`,
      ask: { name: 'Give them something',
             say: `What should the team pick up on ${p.name} first?` },
    })}</div>`
  }

  const job = (r) => {
    const c = crewBy(r.who)
    if (r.state === 'working' && r.blocked === undefined && canWrite()) void needProgress(r.id)
    /*
      A job's leading edge is its OWNER's colour, not its state's. State is
      already said twice — by the group it sits in and by the blocker line — and
      colouring by state would overwrite the one signal that is not repeated
      anywhere else on the row. A blocked job keeps the warning treatment
      through `.blocked` instead.
    */
    return `<article class="job ${r.blocked !== undefined ? 'stuck' : ''}"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 30)}
      <div class="jbody">
        <b>${esc(r.ask)}</b>
        <span class="t-meta">${esc(c.name)} · asked ${when.stamp(r.askedAt, r.asked)}${
          r.context ? ` · about ${esc(r.context.title)}` : ''}</span>
        ${steps(r)}
        ${r.blocked === undefined ? '' :
          `<span class="blocker">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
            ${esc(r.blocked)}</span>`}
      </div>
      ${r.blocked === undefined ? '' :
        `<button class="btn" data-unblock="${esc(r.id)}">${esc(r.unblock ?? 'Sort it out')}</button>`}
      ${r.blocked !== undefined || r.state !== 'working' || !canWrite() ? '' :
        // Stop, for work that is running. The gateway has had this action
        // since the browser work and nothing has ever pressed it, so a job
        // spending tokens on the wrong thing could only be waited out.
        `<button class="btn quiet" data-stop-job="${esc(r.id)}"
          title="Ask it to stop at its next checkpoint">Stop</button>`}
    </article>`
  }

  /*
    HOW FAR IT HAS GOT (#263, #276).

    Beside Stop, because that is the decision the line informs: a job four
    steps into five is one to leave alone and a job that has been on step one
    for twenty minutes is one to stop. The section existed and nothing read it.

    Named steps, not a percentage. The office does not know how many steps a
    job will take — a handler decides as it goes — so a bar would be a number
    invented to fill a shape, which is the thing this repository keeps paying
    for. What it CAN say honestly is which steps are finished and what it is
    on now.

    An unrepeatable step is marked, because that is what it means to a resume:
    it has already had an effect outside the database and running it again
    would repeat it.
  */
  const steps = (r) => {
    const got = progress[r.id]
    if (!got || !Array.isArray(got.steps) || got.steps.length === 0) return ''
    const done = got.steps.filter((x) => x.done === true)
    const now = got.steps.find((x) => x.done !== true)
    return `<span class="jsteps">
      ${got.steps
        .map(
          /*
            Three states, not two. The first draft gave every unfinished step
            the "now" treatment, so a job on step three of four showed TWO
            highlighted chips and the line said "on drafted" about one of them
            — the picture and the sentence disagreeing on the same row. Only
            the first unfinished step is being worked on; the ones after it
            have not started.
          */
          (x) => `<span class="jstep ${
            x.done === true ? 'was' : x === now ? 'now' : 'next'
          }"
                        title="${esc(
                          x.unrepeatable === true
                            ? `${String(x.step)} — already had an effect outside the office`
                            : String(x.step),
                        )}">${esc(x.step)}${x.unrepeatable === true ? ' *' : ''}</span>`,
        )
        .join('')}
      <span class="t-meta">${
        now === undefined
          ? `${done.length} step${done.length === 1 ? '' : 's'} done`
          : `${done.length} of ${got.steps.length} done · on ${esc(String(now.step))}`
      }${
        // `paused` is an OBJECT — reason, detail, resume_when, resumable — and
        // an escaper over it prints "object Object", which is a trap this
        // repository has already shipped once, on the Governance page. The
        // reason is the word a person needs; the rest is for a resume.
        got.paused && typeof got.paused === 'object'
          ? ` · paused: ${esc(String(got.paused.reason ?? 'waiting'))}`
          : ''
      }</span>
    </span>`
  }

  const group = (name, note, list) => list.length === 0 ? '' : `
    <section class="wgroup">
      <h3 class="t-label">${esc(name)} <span class="n">${list.length}</span></h3>
      <p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>
      ${list.map(job).join('')}
    </section>`

  return `<div class="tabbody">
    ${group('Waiting on something', 'Stopped, and it will not start again on its own.', blocked)}
    ${group('Running', 'Being worked on now.', running)}
    ${group('Completed', 'Finished. What came back is under Outputs.', done)}
  </div>`
}

/*
  Sources — what this project points at.

  Two kinds, and the distinction is the point: a CONNECTOR is authenticated and
  syncs, so it has health and a last-read time and can fail; a REFERENCE is a
  pointer and can only be right or stale. Showing them identically would make a
  broken Notion connection look like a bookmark.
*/
function sources(p) {
  const list = p.sources ?? []
  if (list.length === 0) {
    return `<div class="tabbody">${emptyState({
      says: `${esc(p.name)} stands on its own — nothing outside it feeds in. That is a fine
             state to be in.`,
      ask: { name: 'Ask the team to go looking',
             say: `Search Drive, Notion, NotebookLM and GitHub for anything to do with ${p.name}, and tell me what you find before connecting it.` },
      mine: 'Point it at something',
    })}</div>`
  }
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">What ${esc(p.name)} reads from. The project
        is the source of truth; these are optional attachments to it.</p>
      <!--
        A real action now, not a stub (#68).

        Grant: treat an avoidable request for manual configuration as a design
        failure. So it takes a link and works the rest out — hq_attach reads
        knowledge_connectors and delegates a Drive folder to the Drive path
        without being told which kind it is.

        No backticks in this comment: template literal.
      -->
      ${canWrite() ? `<span data-saidwrap class="addsource">
        <input data-src-ref placeholder="Paste any link — a notebook, a Drive folder, a website, an API" aria-label="A link to connect">
        <button class="btn" data-add-source="${esc(p.slug)}">Connect</button>
        <span class="t-meta" data-said></span>
      </span>` : ''}
    </div>
    <!--
      "Not now" — the fifth option, and the only one that ends in no attachment.

      Without it the office keeps asking about a connector Grant has decided
      this project does not want, and there is no way to answer except by
      connecting something. §3 lists it as a real answer, so it is a real
      control: it records the decision and the asking stops.

      No backticks in this comment. Template literal.
    -->
    ${
      canWrite()
        ? `<div class="declines" data-saidwrap>
      <span class="t-meta">Not every project needs everything.</span>
      ${(config.CONNECTIONS ?? [])
        .filter((k) => !(p.connectors ?? []).includes(k.name))
        .slice(0, 4)
        .map(
          (k) => `<button class="btn small quiet" data-decline="${esc(p.slug)}"
             data-connector="${esc(k.key)}" data-name="${esc(k.name)}">
             ${esc(p.name)} does not need ${esc(k.name)}</button>`,
        )
        .join('')}
      <span class="t-meta" data-said></span>
    </div>`
        : ''
    }
    ${facetBar('sources', list, (x) => (x.kind === 'reference' ? 'reference' : 'connector'),
               (f) => (f === 'reference' ? 'References' : 'Connected'))}
    <div class="sourcegrid">${facetKeep('sources', list, (x) => (x.kind === 'reference' ? 'reference' : 'connector')).map((x) => `
      <article class="source ${x.kind === 'connector' ? 'live' : ''}" data-saidwrap>
        <span class="t-label">${x.kind === 'connector' ? 'Connector' : 'Reference'}</span>
        <b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`
                   : esc(x.name)}</b>
        <span class="t-meta">${esc(x.via ?? '')}${x.what ? ` · ${esc(x.what)}` : ''}</span>
        <span class="srcfoot">
          ${x.kind === 'connector'
            ? `<span class="stage s-${x.health === 'ok' ? 'approved' : 'review'}">${
                x.health !== 'ok' ? esc(x.problem ?? 'switched off')
                : x.last === 'never' ? 'Not read yet'
                : `Read ${esc(x.last)}`}</span>`
            : x.last ? `<span class="t-meta">${esc(x.last)}</span>` : ''}
          <!--
            Counted per CONNECTOR, not per attachment, because documents record
            which connector they came through and not which of its data sources.
            Three Notion databases on one project therefore all report the same
            number, and saying "29 documents" three times looks like a bug. The
            wording carries the caveat instead of the number pretending to be
            something it is not.

            No backticks in this comment: template literal.
          -->
          ${x.gave > 0 ? `<span class="t-meta">${x.gave} via ${esc(x.via ?? 'it')}</span>` : ''}
          <span class="t-meta" data-said></span>
          <!--
            Disconnect and Remove are different acts and say so.

            Detaching a connector DISABLES the row and keeps the corpus it fed
            (ADR-0013), so the word is Disconnect and the documents survive.
            A reference holds nothing at all, so removing it is a real delete
            and there is nothing to warn about. One button, two verbs, because
            offering Disconnect on a bookmark implies a corpus that is not
            there.

            No backticks in this comment: template literal.
          -->
          <!--
            And the way back (#276). A disconnected connector draws Reconnect
            rather than Disconnect, because the row already says it is blocked
            and offering to disconnect it again is furniture. The reattach
            action has been at the gateway since 118 as the exact inverse of
            detach, and
            nothing named it: a source Grant switched off by mistake could only
            be switched back on from SQL.

            Not quiet, unlike its opposite: on a row the page has already drawn
            as blocked, the one action that clears it is the point of the row.

            No backticks in this comment: template literal.
          -->
          ${canWrite() && x.id
            ? x.kind === 'reference'
              ? `<button class="btn small quiet" data-unref="${esc(x.id)}"
                   data-name="${esc(x.name)}">Remove</button>`
              : x.health === 'blocked'
                ? `<button class="btn small" data-reattach="${esc(x.id)}"
                     data-name="${esc(x.name)}">Reconnect</button>`
                : `<button class="btn small quiet" data-detach="${esc(x.id)}"
                     data-name="${esc(x.name)}">Disconnect</button>`
            : ''}
        </span>
      </article>`).join('')}</div>
    ${madeInNotebook(p)}
    ${signedInSites(p)}
  </div>`
}

/*
  The words for the artifact kinds, so the page says what Grant says.

  A map rather than a switch, and it falls through to the stored slug for a
  type NotebookLM adds later: the Issue asks that an unknown type not break
  enumeration, and a lookup that returns the raw word is clumsy where a lookup
  that returns nothing is a blank chip.
*/
const KIND_SAID = {
  audio: 'Audio overview',
  video: 'Video overview',
  slides: 'Slide deck',
  mindmap: 'Mind map',
  report: 'Report',
  quiz: 'Quiz',
  flashcards: 'Flashcards',
}

/*
  What the notebook MADE, under what the project reads FROM (#260).

  Grant's acceptance line is that source material and generated artifacts are
  clearly distinguished, so this is a separate block with its own heading
  rather than more cards in the source grid. A notebook is something the
  project reads from; an audio overview is something that came out of it, and
  the two answer different questions.

  Drawn only when there is something to draw. A project with no notebook, or
  one whose notebook has generated nothing, gets no heading at all — an empty
  section under a populated one reads as a fault.

  No backticks in this comment: template literal.
*/
function madeInNotebook(p) {
  /*
    The prototype answers synchronously, and it has to.

    `needMade` is async and ends in `render()`, which is safe when a real
    request is in flight and re-entrant when the answer is already in hand: a
    render calling render from inside itself finishes the inner one and then
    the outer overwrites it with the output it had already computed. The block
    was invisible in every capture for exactly that reason. With no token
    there is nothing to wait for, so nothing waits.
  */
  if (notebookMade[p.slug] === undefined && !canWrite()) notebookMade[p.slug] = mockMade(p)
  const rows = notebookMade[p.slug]
  if (rows === undefined || rows === null) {
    needMade(p.slug)
    return ''
  }
  if (rows.length === 0) return ''
  return `<section class="nbmade">
    <h3 class="t-label">Made in the notebook</h3>
    <p class="t-meta">Generated by NotebookLM from what is attached above — not
      material the project was given.</p>
    <ul class="nbrows">${(rows ?? [])
      .map(
        (a) => `<li class="nbrow">
        <span class="nbkind">${esc(KIND_SAID[a.kind] ?? a.kind ?? 'file')}</span>
        <span class="nbtitle">${
          a.openable
            ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title ?? '(untitled)')}</a>`
            : esc(a.title ?? '(untitled)')
        }</span>
        <!--
          The honest half. NotebookLM exposes no stable link for every type, and
          an anchor drawn regardless would be the fabricated link the Issue
          forbids. The row still appears, because knowing the thing exists is
          worth something even when it cannot be opened from here.

          No backticks in this comment: template literal.
        -->
        <span class="t-meta">${
          a.openable
            ? a.mine
              ? 'The team asked for this one'
              : 'You made this one'
            : esc(a.detail ?? 'No link — open it in NotebookLM')
        }</span>
      </li>`,
      )
      .join('')}</ul>
  </section>`
}


/*
  Tasks, in the states the specification names.

  To-do · In progress · Waiting/blocked · Completed, and who each is assigned
  to — *"assigned to human"* and *"assigned to agent"* are two of his branches,
  so the face on a row is doing real work rather than decorating it.
*/
/*
  Adding a task (#11).

  `public.tasks` had a good schema and zero rows, because nothing anywhere
  could write one. Migrations 0238 and 0239 gave it an RPC; this is the mouth.

  A title and a project are all that is required — a form that demands a date,
  an owner and a description before it will accept "chase the invoice" is a
  form people route around. Date and owner are there because they are what
  makes a task reach the diary (#94) and reach a person, and both are optional.

  No backticks in the HTML comments below. Template literal.
*/
/*
  Adding a contact (#24, #99).

  Grant: *"Open a standard Add Contact form with name, phone number, email,
  Instagram, and other relevant contact details."* Those four are here by name,
  with role, org, website and a kind beside them.

  Only the name is required. A form that demands nine fields before it will
  take "Ben, referrer" is a form people route around, and a half-filled contact
  is worth more than the one nobody entered.

  `kind` is a select because the canonical IA lists companies, collaborators
  and suppliers beside people, and a supplier with no surname is not a
  malformed person.
*/
function addContactForm(p) {
  if (!canWrite()) return ''
  return `<div class="taskform" data-contact-form hidden>
    <div class="hirerow">
      <label>Name
        <input data-c-name placeholder="Ben Hartley" autocomplete="off"></label>
      <label>What they are to this project
        <input data-c-role placeholder="Referrer" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Email
        <input data-c-email type="email" placeholder="ben@hartleyco.com" autocomplete="off"></label>
      <label>Phone
        <input data-c-phone placeholder="+44 7700 900118" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Instagram
        <input data-c-insta placeholder="@benhartley" autocomplete="off"></label>
      <label>Organisation
        <input data-c-org placeholder="Hartley and Co" autocomplete="off"></label>
    </div>
    <div class="hirerow">
      <label>Kind
        <select data-c-kind>
          <option value="person">A person</option>
          <option value="company">A company</option>
          <option value="collaborator">A collaborator</option>
          <option value="supplier">A supplier</option>
        </select>
      </label>
      <span class="hireact">
        <span class="t-meta" data-said></span>
        <button class="btn primary" data-c-go>Add them</button>
        <button class="btn quiet" data-c-cancel>Cancel</button>
      </span>
    </div>
  </div>`
}

function addTaskForm(p) {
  if (!canWrite()) return ''
  return `<div class="taskform" data-task-form hidden>
    <div class="hirerow">
      <label>What needs doing
        <input data-task-title placeholder="Draft the pricing note" autocomplete="off"></label>
      <label>Due
        <input type="date" data-task-due></label>
    </div>
    <div class="hirerow">
      <label>Who
        <select data-task-who>
          <option value="">Nobody yet</option>
          ${CREW.map((c) => `<option value="${esc(c.staffSlug ?? c.slug)}">${esc(c.name)} — ${esc(c.role)}</option>`).join('')}
        </select>
      </label>
      <span class="hireact">
        <!--
          A module is a milestone (#71, migration 0286).

          Not a second form: the office has one noun for a piece of work and
          this is the box that says this one is a heading with others under it.
          A separate Add Module form would be a second place a title and a date
          are typed, and the two would drift.
        -->
        <label class="tickbox">
          <input type="checkbox" data-task-milestone>
          <span>It is a module — a part of the work, with tasks under it</span>
        </label>
        <span class="t-meta" data-said></span>
        <button class="btn primary" data-task-go>Add it</button>
        <button class="btn quiet" data-task-cancel>Cancel</button>
      </span>
    </div>
  </div>`
}

/**
 * The bar that appears only when something is chosen (#150).
 *
 * Grant: *"A bar that appears only when something is selected, naming the count
 * and the actions that apply to all of them."* And the actions are the ones
 * that genuinely apply to all of them: marking done and handing over. Anything
 * that needs a different value per row is not a bulk action and is not offered.
 *
 * The batching is HERE and not in an RPC, which is the issue's own instruction
 * and the right one: *"one write per row keeps every action auditable, undoable
 * and independently failable."* So a half-succeeding batch says which rows
 * moved and which did not, rather than one yes or no.
 */
function pickedBar(p) {
  const mine = (p.tasks ?? []).filter((t) => t.id !== undefined && state.picked.has(t.id))
  if (mine.length === 0) return ''
  const n = mine.length
  return `<div class="pickbar" role="group" aria-label="What to do with the chosen tasks">
    <span class="pickn">${n} chosen</span>
    <button class="btn small" data-picked-done>Mark ${n === 1 ? 'it' : 'them all'} done</button>
    <span class="docact">
      <select data-picked-who aria-label="Who to give them to">
        ${CREW.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}
      </select>
      <button class="btn small" data-picked-give>Give ${n === 1 ? 'it' : 'them'} over</button>
    </span>
    <button class="btn small quiet" data-picked-clear>Clear</button>
    <span class="t-meta" data-picked-said></span>
  </div>`
}

function tasksSection(p) {
  if (p.tasks.length === 0) {
    return `<div class="tabbody">${emptyState({
      says: `Nothing to do on ${esc(p.name)} yet.`,
      ask: { name: 'Ask the team to work out what is needed',
             say: `Read everything on ${p.name} and propose the tasks it actually needs, with owners.` },
      mine: 'Add a task',
      mineDo: 'task',
    })}${addTaskForm(p)}</div>`
  }
  const at = (t, i) => t.state === 'done' || state.done.has(i) ? 'done'
    : t.blocked !== undefined ? 'blocked'
    : t.state === 'doing' ? 'doing' : 'todo'
  /*
    Filtered by OWNER, not by state (#154).

    The tasks screen already groups by state — Doing, To do, Blocked, Done —
    so a state filter would be a second control answering a question the page
    has already answered in a better way. Who it belongs to is the facet the
    grouping hides, and it is the one Grant asks about when the list is long.

    The index has to survive the filter: `taskRow(t, i)` writes `i` into every
    control on the row and the handlers look the task up by it, so filtering a
    mapped list keeps the ORIGINAL index rather than renumbering.
  */
  const all = p.tasks.map((t, i) => ({ t, i, at: at(t, i) }))
  const owner = (r) => r.t.who ?? null
  const rows = facetKeep('tasks', all, owner)
  const group = (name, key, note) => {
    const list = rows.filter((r) => r.at === key)
    return list.length === 0 ? '' : `
      <section class="wgroup">
        <h3 class="t-label">${esc(name)} <span class="n">${list.length}</span></h3>
        ${note === '' ? '' : `<p class="t-meta" style="margin:0 0 var(--s3)">${esc(note)}</p>`}
        <div class="tasks">${list.map((r) => taskRow(r.t, r.i)).join('')}</div>
      </section>`
  }
  const owners = facetBar('tasks', all, owner, (f) => crewBy(f)?.name ?? f)
  return `<div class="tabbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">Everything open on ${esc(p.name)}, and who has it.</p>
      ${canWrite() ? '<button class="btn primary" data-empty-do="task">Add a task</button>' : ''}
    </div>
    ${addTaskForm(p)}
    ${owners}
    ${pickedBar(p)}
    ${group('Waiting or blocked', 'blocked', 'Cannot move until something else does.')}
    ${group('In progress', 'doing', '')}
    ${group('To do', 'todo', '')}
    ${group('Completed', 'done', '')}
  </div>`
}

/** The full document gallery, rather than a panel's worth of it. */
/*
  One filter idiom, several lists (#154).

  Grant: *"One filter idiom reused across all four lists, not four designs."*
  So this is the renderer and the applier, and a caller supplies only the
  question — which facet a row belongs to, and what to call it.

  Two rules the helper enforces so no caller has to remember them:

  * A facet nobody has is never offered. Drawing "Audio 0" teaches that the
    filter is broken rather than that the project has no audio, and this
    repository has a whole trap list about controls that cannot do anything.
  * "All" is always first and always clearable in one press.

  It filters the rows the page already holds. No endpoint, per the issue: a
  project with 41 documents is not a paging problem, and inventing one would
  make the filter slower than the list.
*/
function facetsIn(rows, facetOf) {
  const seen = new Map()
  for (const r of rows) {
    const f = facetOf(r)
    if (f === null || f === undefined || f === '') continue
    seen.set(f, (seen.get(f) ?? 0) + 1)
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1])
}

function facetBar(list, rows, facetOf, label) {
  const facets = facetsIn(rows, facetOf)
  // One facet is not a choice. Two identical pills is furniture (section 23).
  if (facets.length < 2) return ''
  const chosen = state.facet[list] ?? null
  return `<div class="filters" role="group" aria-label="Filter this list">
    <button class="pill ${chosen === null ? 'on' : ''}" data-facet="${esc(list)}"
            data-facet-value="" aria-pressed="${chosen === null}">All
      <span class="n">${rows.length}</span></button>
    ${facets
      .map(
        ([f, n]) => `<button class="pill ${chosen === f ? 'on' : ''}" data-facet="${esc(list)}"
          data-facet-value="${esc(f)}" aria-pressed="${chosen === f}">${esc(label(f))}
        <span class="n">${n}</span></button>`,
      )
      .join('')}
  </div>`
}

function facetKeep(list, rows, facetOf) {
  const chosen = state.facet[list] ?? null
  return chosen === null ? rows : rows.filter((r) => facetOf(r) === chosen)
}

/*
  What the team made and Grant has not decided about (#28, #276).

  0315 made an unapproved document invisible in the gallery, which is half of
  the gate: the other half is being able to let one in, and it had no control
  anywhere. `document_approve` and `document_discard` have been gateway
  actions with nothing pressing them, which is exactly what `check:pressable`
  was written to find.

  Above the gallery rather than inside it, because these rows are not in the
  project yet and putting them in the same grid is what 0315 removed. Drawn
  only when the queue has something: a permanently-present empty panel reads
  as a fault, and this one is empty most of the time by design.

  Discard is quiet and confirmed. Approve is the ordinary press.
*/
function reviewBlock(p) {
  if (!canWrite()) return ''
  needReview(p.slug)
  const rows = reviewing[p.slug]
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const row = (r) => `<article class="revrow">
    <div class="revbody">
      <b>${esc(r.title)}</b>
      <!--
        when.stamp returns a time element, so escaping it printed the markup
        on the page: "made <time data-rel datetime=...>2 hours ago</time>".
        Found by opening the capture, which is the only thing that finds it -
        it is not overflow, not low contrast, not small type and not a dead
        control. Every other caller in this file passes it through unescaped.
      -->
      <span class="t-meta">${esc(r.produced_by ?? 'The team')} · made
        ${when.stamp(r.created_at)}${
          (r.derived_from ?? []).length === 0 ? ''
            : ` · from ${esc((r.derived_from ?? []).slice(0, 2).join(', '))}`}</span>
    </div>
    <button class="btn" data-doc-approve="${esc(r.document_id)}"
      data-doc-title="${esc(r.title)}">Approve</button>
    <button class="btn quiet" data-doc-discard="${esc(r.document_id)}"
      data-doc-title="${esc(r.title)}">Discard</button>
  </article>`
  return `<section class="review" aria-label="Waiting for your decision">
    <h3 class="t-label">Waiting for you <span class="n">${rows.length}</span></h3>
    <p class="t-meta" style="margin:0 0 var(--s3)">The team made these. They are
      not in the project until you approve them.</p>
    ${rows.map(row).join('')}
  </section>`
}

function documentsSection(p) {
  const docs = allDocs(p)
  if (docs.length === 0) {
    // The review block still draws here. A project whose ONLY content is a
    // draft the office just made is precisely the case this gate exists for,
    // and hiding the queue behind "there are no documents" would mean the one
    // moment it matters is the one moment it is not shown.
    return `<div class="tabbody">${reviewBlock(p)}${emptyState({
      says: `Nothing in ${esc(p.name)} yet.`,
      ask: { name: 'Ask the team to gather what exists',
             say: `Find everything already written about ${p.name} — in Drive, Notion and NotebookLM — and bring it in.` },
      mine: 'Bring documents in',
      mineDo: 'sources',
    })}</div>`
  }
  return `<div class="tabbody">
    ${reviewBlock(p)}
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${docs.length} in ${esc(p.name)}.
        Anything the team made is here only because you approved it.</p>
      <!--
        Documents arrive through a connector, not through an upload here (#105).

        This was a bare button with no attribute, like the Tasks header. It
        goes to Sources, which is where attaching Drive or Notion actually puts
        documents in a project, and where a pasted Drive link is already
        recognised on its own.

        No backticks in this comment. Template literal.
      -->
      <button class="btn" data-empty-do="sources">Bring documents in</button>
    </div>
    ${facetBar('documents', docs, (d) => docKind(d), (f) => DOC_FACET[f] ?? f)}
    <div class="gallery">${facetKeep('documents', docs, (d) => docKind(d)).map(docCard).join('')}</div>
  </div>`
}

/*
  Which facet a document belongs to (#154).

  `mirrors_document_id` is why this is a function rather than `d.kind`: 0169
  records that a document the office WROTE INTO a connector is not new material,
  and the issue names the same trap — without it, half the list is counted twice
  and "what the team made" is wrong in the direction that flatters us.

  The page's own shape carries that fact as `origin`, which is the word a person
  reads on the card, so the two agree by construction rather than by a second
  rule that has to be kept in step.
*/
const DOC_FACET = {
  made: 'Made by the team',
  mirror: 'Written out to a connector',
  pdf: 'PDF',
  doc: 'Document',
  audio: 'Audio',
  source: 'Source material',
}

function docKind(d) {
  if (d.mirror === true || d.mirrors === true) return 'mirror'
  if (d.kind === 'made' || String(d.origin ?? '').includes('·')) return 'made'
  return d.kind ?? 'doc'
}

/** What happened, most recent first. */
/*
  Activity's SECTION is gone (#222); its panel is not.

  `PANEL.activity` still renders on the Overview board under the clearer name
  Recent activity, so the history is one panel away rather than a tab of its
  own with nothing to press.
*/

/*
  One panel's chrome, for both boards (#219).

  Lifted out of `dashboard()` when the home screen became a board of its own.
  The alternative was a second copy of the header, the grip, the three width
  controls and the view-transition-name - which is the drift this file records
  over and over, and it would have been the copy that kept the plus glyph #217
  had just removed.
*/
function panelChrome(spec, kinds, bodyFor) {
  const kind = kinds.find((k) => k.id === spec.id)
  if (!kind) return ''
  /*
    Collapsed is a property of the arrangement, not of this render (#220).

    Grant's list for a panel was *"dragging, free rearrangement, resizing
    horizontally, resizing vertically where appropriate, reordering,
    collapse/expand, removal, adding again, persistent layout"* - and collapse
    sits in the middle of it, between two things that persist. A collapsed
    panel that opens again on the next visit is a toggle, not a layout.

    So it rides on the spec beside x, y, w and h and goes through the same
    save. The RPC's shape check requires those five keys and forbids nothing
    else, which is why 0250 modelled a panel as jsonb: *"every new panel
    property - a colour, a collapsed flag - would then be a migration."*
  */
  const shut = spec.c === true
  /*
    `view-transition-name` pairs this panel with the full section of the same
    subject (#40 idea 6). Pressing Documents on Overview makes the Documents
    PANEL grow into the Documents SECTION rather than the page swapping —
    Grant's *"the item you touched is the item you land in"*, applied across
    the tab boundary where it was not applied before.

    The name has to be unique per document, which is why only the panels get
    it and the section claims the same name on the other side of the switch.
  */
  return `<section class="panel ${shut ? 'shutpanel' : ''} ${esc(kind.tone ?? '')}"
           data-panel="${spec.id}"
           style="view-transition-name:sec-${spec.id};
                  left:calc((100% - 40px)/3 * ${spec.x} + ${spec.x} * 20px);
                  top:${spec.y}px;
                  width:calc((100% - 40px)/3 * ${spec.w} + ${(spec.w - 1) * 20}px);
                  height:${shut ? 46 : spec.h}px">
    <header data-grip>
      <!--
        Open and shut, on the title (#220).

        Before the width controls rather than after, because it is the one a
        person reaches for most and because a chevron beside a title reads as
        part of the title. It sits inside the grip like the other three and
        needs the same pointerdown guard, for the reason #105 records.

        No backticks in this comment. Template literal.
      -->
      <button class="pfold" data-fold aria-expanded="${shut ? 'false' : 'true'}"
              aria-label="${shut ? 'Open' : 'Collapse'} the ${esc(kind.name)} panel"
              title="${shut ? 'Open' : 'Collapse'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6"/></svg>
      </button>
      <!--
        h3, under the section's h2 (#207).

        The tree is: h1 the project or the greeting, h2 the section you are in,
        h3 each panel inside it. That last one was already h3 and was skipping a
        level, because the h2 did not exist anywhere in the document - the
        section's name was carried entirely by the rail, where a screen reader
        moving by heading never goes.

        The class is what makes it look like a label; the tag is what heading
        navigation reads. Those are two decisions and they had been made as one.
      -->
      <h3 class="t-label">${esc(kind.name)}</h3>
      <!--
        These are WIDTH controls, and two of them used to be a plus and a
        minus (#217).

        Grant pressed the plus on the Documents panel, which is where a plus
        means add a document in every application he has ever used, and got a
        panel that filled the row. His report of it - *"pressing plus
        currently results in a large/full-screen interface that either does
        nothing or feels broken"* - is an exact description of what widening
        a panel to full width looks like when you expected an upload dialog.

        Nothing was broken. The glyph was lying. A plus sitting inside a
        panel called Documents is a claim about what the press will do, and
        the title attribute correcting it only helps a person who already
        suspected. So they are arrows now: the shape says width, and nothing
        in the product says add with an arrow.

        No backticks in this comment. Template literal.
      -->
      <span class="pctl">
        <button data-narrower aria-label="Make the ${esc(kind.name)} panel narrower" title="Narrower">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10 7l-4 5 4 5M14 7l4 5-4 5"/></svg>
        </button>
        <button data-wider aria-label="Make the ${esc(kind.name)} panel wider" title="Wider">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 7l4 5-4 5M19 7l-4 5 4 5"/></svg>
        </button>
        <button data-drop-panel aria-label="Remove the ${esc(kind.name)} panel" title="Remove">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.1" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>
    </header>
    ${shut ? '' : `<div class="pbodywrap">${bodyFor(spec.id)}</div>`}
    <!--
      The bottom edge, for height (#220).

      Grant asked for vertical resize as well as horizontal. Width snaps to
      columns because a dashboard of arbitrary widths never lines up; height
      does not, because there is no column of rows to line up WITH and the
      right height for a panel is however tall its contents are.

      Not on a collapsed panel, where the height IS the header, and not on a
      phone, where the board is static and a resize grip would be a gesture the
      layout has switched off.

      No backticks in this comment. Template literal.
    -->
    ${shut ? '' : '<span class="pgrow" data-taller aria-hidden="true"></span>'}
  </section>`
}

/**
 * Map or panels, and the studio remembers which (#25, #220).
 *
 * A per-viewer preference, so browser storage is the right home for it and
 * CLAUDE.md's bounds apply: wrapped, and correct when it comes back empty. The
 * default is the map, because that is what Grant asked to land on.
 *
 * ## Except on a phone, where the map cannot do its job (#278)
 *
 * Measured rather than judged. On a 390x844 phone the port is 350x464, the
 * field is 1142x1050, and the map opens at k=1 showing FOUR of twenty-four
 * cards — 17%, with the zoom controls sitting on one of them. Panning is the
 * affordance for the rest, and panning to see 83% of a project is not an
 * overview.
 *
 * It cannot be fixed by fitting. Zoom multiplies every font size on the plane
 * and the smallest text on a card is 12px, which IS the floor the visual
 * standard sets — so the scale that shows everything (0.31 here) renders the
 * state line at under 4px, and any scale below 1.0 breaks the floor at all.
 * That is why the first paint calls `fit(1)`: the floor and the fit are in
 * direct conflict on a screen this size, and there is no third value.
 *
 * So the medium decides, not the preference. On a phone the Overview opens on
 * the panels — a vertical list that scrolls, shows every module with its state
 * and its counts, and reaches all of it. The map is one tap away on the same
 * toggle, in both directions, and an explicit choice still wins on both sizes:
 * somebody who picks Map on their phone gets Map, every time.
 *
 * Nothing about the desktop changes. There the map shows 21 of 24 on opening,
 * which is what #25 asked for and where it works.
 */
function mapMode() {
  let stored = null
  try {
    stored = localStorage.getItem('studio.overview')
  } catch {
    /* Per-viewer convenience only; an empty read is the same as no choice. */
  }
  if (stored !== null) return stored !== 'panels'
  /*
    No choice made. The breakpoint is the stylesheet's own 860px, so the
    default and the phone layout can never disagree about what a phone is.
    `matchMedia` is absent in some capture contexts, and the desktop answer is
    the safe one there.
  */
  try {
    if (window.matchMedia?.('(max-width: 860px)').matches === true) return false
  } catch {
    /* Treated as a desktop, which is the behaviour this had before. */
  }
  return true
}

/**
 * The project on one page, for paper (#125).
 *
 * Grant: *"Everything the office knows about a dashboard project is on screen
 * and none of it can leave. To tell somebody where a project stands you read
 * the screen and retype it."* And the shape he asked for: *"A print
 * stylesheet, and nothing else... Brief, open tasks with dates, key contacts,
 * what the team produced recently, what is waiting on a decision — on one
 * page, Cmd-P to PDF from the browser."*
 *
 * Almost nothing else. The Overview is a MAP now, and a pan-and-zoom plane of
 * absolutely positioned cards is the one layout a print stylesheet cannot
 * rescue — so the briefing is markup that exists only on paper, assembled from
 * the payload the page already holds.
 *
 * ## What it must not carry
 *
 * The issue is explicit: *"anything the screen deliberately withholds. The MCP
 * tab does not render a token and neither does this."* Every field below is one
 * the studio already draws somewhere, and the assembly is from `p`, the same
 * object the tabs render — so there is no path by which this could reach
 * something the screen does not.
 */
function briefing(p) {
  const open = (p.tasks ?? []).filter((t) => t.state !== 'done').slice(0, 14)
  const recent = (p.documents ?? []).slice(0, 8)
  const people = (p.contacts ?? []).slice(0, 8)
  const waiting = p.waiting ?? []
  const when = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
  const part = (name, rows) =>
    rows.length === 0 ? '' : `<section class="printpart">
      <h3>${esc(name)}</h3>
      <ul>${rows.join('')}</ul>
    </section>`

  return `<div class="printonly" aria-hidden="true">
    <header class="printhead">
      <h2>${esc(p.name)}</h2>
      ${p.purpose ? `<p class="printsub">${esc(p.purpose)}</p>` : ''}
      <p class="printwhen">Where it stands on ${esc(when)}</p>
    </header>
    ${part('Waiting on you', waiting.map((w) => `<li>${esc(w.title ?? w.what ?? '')}
        ${w.who ? `<span class="printwho">${esc(crewBy(w.who)?.name ?? w.who)}</span>` : ''}</li>`))}
    ${part('Open tasks', open.map((t) => `<li>${esc(t.title)}
        ${
          t.due
            ? /*
                 "due Due 16 September" on the first capture.

                 The mock's own due strings already begin with the word, so the
                 sheet adding it produced a doubled one. The value says it or
                 the sheet says it; never both.
              */
              `<span class="printwho">${/^due\b/i.test(String(t.due)) ? '' : 'due '}${esc(t.due)}</span>`
            : ''
        }
        ${t.who ? `<span class="printwho">${esc(crewBy(t.who)?.name ?? t.who)}</span>` : ''}</li>`))}
    ${part('Recent documents', recent.map((d) => `<li>${esc(d.title)}
        ${d.origin ? `<span class="printwho">${esc(d.origin)}</span>` : ''}</li>`))}
    ${part('People', people.map((c) => `<li>${esc(c.name)}
        ${c.role ? `<span class="printwho">${esc(c.role)}</span>` : ''}</li>`))}
    ${part('What it reads from', (p.sources ?? []).map((x) => `<li>${esc(x.name)}
        ${x.what ? `<span class="printwho">${esc(x.what)}</span>` : ''}</li>`))}
  </div>`
}

function projectMap(p) {
  void needMap(p.slug)
  const graph = maps[p.slug]
  const put = placed[p.slug] ?? { at: {}, view: {} }
  return `<div class="tabbody">
    <div class="mapbar">
      <!--
        The existing segmented control, not a new one.

        Section 19's coherence, and the cheapest kind of it: this product
        already has a "pick one of these" object with a 44px target and an
        accent fill, drawn for the light and dark switch. A second one invented
        here would be a second thing to keep in step.
      -->
      <!--
        Adding a source goes to the real setup, not to a gesture on the canvas.

        Grant: *"Let me add services and connect them to agents through an
        intuitive visual flow"* AND *"Adding a service should lead through its
        actual setup and authorization process. Drawing a connection must not
        falsely imply that access has been granted or setup has succeeded."*
        The second sentence decides what the first one can be. Attaching a Drive
        folder is an OAuth consent and a picker (#62); there is no version of
        dragging a line that performs it, and a line drawn before it would be a
        drawing of access nobody has.

        So the flow starts here and finishes where it really finishes, and the
        new source appears on the map on the next read - which is the same
        moment it becomes true.
      -->
      <button class="btn small quiet" data-overview-add>+ Add a source</button>
      <div class="segmented" role="group" aria-label="How to show this project">
        <button class="seg on" data-overview="map" aria-pressed="true">Map</button>
        <button class="seg" data-overview="panels" aria-pressed="false">Panels</button>
      </div>
    </div>
    ${
      graph === null
        ? `<div class="planeport"><div class="planeempty"><p class="m">Drawing the map…</p></div></div>`
        : plane.draw(graph, put.at, put.view, state.mapPick)
    }
    ${briefing(p)}
  </div>`
}

function dashboard() {
  const p = byId(state.project)
  const mine = panels.layout(p)
  const spare = panels.KINDS.filter((k) => !mine.some((m) => m.id === k.id))

  const chrome = (spec) => panelChrome(spec, panels.KINDS, (id) => PANEL[id]?.(p) ?? '')
  const tallest = mine.reduce((m, s) => Math.max(m, s.y + s.h), 0)

  const board = `
    <!--
      Grant: *"this draggable area should be present within the project itself"*.
      Panels snap to a 24px grid AND to each other's edges, because "nicely
      arranged" means aligned and a bare grid does not guarantee that — two
      panels can both be on the grid and still be out of line with each other.
    -->
    <div class="tabbody">
      <!--
        The tuition is gone from the page (#188, #222's density argument).

        It said *"Drag a panel by its title. Add what this project needs, drop
        what it does not."* on every visit, for ever, in the highest-value strip
        of the screen - and on a phone it taught a gesture the phone has
        switched off, because the panels are static below 860px and the resize
        controls are not drawn. This file already records that trap once, about
        the same sentence.

        The Add panel button says the second half, the drag says itself the
        first time anybody tries it, and neither needs a permanent caption.
        Measured on a 390px phone: the header stack went from 0.75 screens of
        furniture before the first content pixel to 0.60.

        No backticks in this comment. Template literal.
      -->
      <!--
        The way back to the map (#156, fixing #25).

        The Map / Panels toggle was drawn in the MAP branch only, so choosing
        Panels removed the control that had just been pressed and there was no
        way back short of reloading. A one-way door, shipped this morning, and
        found by trying to CAPTURE the board rather than by reading the code -
        the capture run failed waiting for a button that no longer existed.

        Drawn from the same two-button shape on both sides now, with the
        pressed state following the view, because a segmented control whose
        other half vanishes when you use it is not a segmented control.

        No backticks in this comment. Template literal.
      -->
      <div class="tabhead">
        <div class="segmented" role="group" aria-label="How to show this project">
          <button class="seg" data-overview="map" aria-pressed="false">Map</button>
          <button class="seg on" data-overview="panels" aria-pressed="true">Panels</button>
        </div>
      </div>
      <div class="board" data-board style="height:${Math.max(tallest + 40, 520)}px">
        ${mine.map(chrome).join('')}
      </div>
    </div>`

  /*
    Seven sections, and AI Team's four inside it (#30).

    The counts on the section buttons are how Grant learns something is waiting
    without opening anything — which is the whole reason the specification puts
    an operational overview first rather than a file list.
  */
  const counts = sectionCounts(p)

  const teamBody =
    state.sub === 'chat' ? chatTab(p)
    : state.sub === 'jobs' ? activeJobs(p)
    : state.sub === 'outputs' ? teamTab(p)
    : teamBoard(p)

  const teamCounts = {
    jobs: counts.blocked,
    outputs: counts.waiting,
  }

  const team = `
    <div class="subnav" role="tablist" aria-label="AI Team">
      ${TEAM_VIEWS.map((v) => `<button role="tab" class="subtab ${state.sub === v.id ? 'on' : ''}"
          aria-selected="${state.sub === v.id}" data-sub="${v.id}">${esc(v.name)}${
            teamCounts[v.id] > 0 ? `<span class="n">${teamCounts[v.id]}</span>` : ''
          }</button>`).join('')}
    </div>
    ${teamBody}`

  /*
    The section body claims the panel's transition name, so the browser pairs
    them and animates one into the other. `sec-documents` is a panel on
    Overview and the whole gallery in Documents; the browser does the rest.
  */
  const named = (id, html) => `<div style="view-transition-name:sec-${id}">${html}</div>`

  /*
    The section you are in, as a heading (#207).

    Visually hidden, because the rail already names it in the navigation and a
    second copy on the page is the duplication section 23 asks about. Hidden
    from the eye is not hidden from the document: it is in the accessibility
    tree, it is what heading navigation lands on, and it is what makes the
    panels beneath it h3 rather than an orphan level.

    Before #207 a project's Documents screen had exactly ONE heading - the
    project's name - over a gallery of twelve documents. Moving by heading
    reached nothing.
  */
  const sectionName = SECTIONS.find((x) => x.id === state.tab)?.name ?? 'Overview'

  const body =
    state.tab === 'team' ? team
    : state.tab === 'documents' ? named('documents', documentsSection(p))
    : state.tab === 'tasks' ? named('tasks', tasksSection(p))
    : state.tab === 'contacts' ? named('contacts', peopleTab(p))
    : state.tab === 'sources' ? named('links', sources(p))
    : state.tab === 'settings' ? named('settings', projectSettings.section(p, state.setpane, people))
    /*
      The Overview IS the map (#25).

      Grant: *"This describes how the project dashboard itself should look and
      behave. It is not a request for a separate Canvas tab, additional view, or
      disconnected feature."* So opening a project opens the map, and it is not
      somewhere else you can go.

      The panel board is still here, behind one switch, because #220 is three
      days old and Grant asked for it in his own words — *"this draggable area
      should be present within the project itself"* — and his integration
      instruction on this very issue says to extend working functionality rather
      than rebuild it. Deleting a feature he asked for on Friday to satisfy a
      brief he sent on Monday is not what either sentence asks for. The map is
      what he lands on; the panels are one press away and remember which he
      chose. ADR-0020.
    */
    : mapMode() ? named('overview', projectMap(p)) : board

  return `<main class="main">
    <div class="head">
      <div class="projhead">
        <!--
          The mark, beside the title rather than a 208px band above it (#82).
          It keeps the view-transition-name so the portfolio card's mark still
          grows and moves into this slot when you open the project.
        -->
        <span class="heroslot">
          <span class="hero ${p.hue}" style="view-transition-name:cover-${p.slug}">
            ${look(p, { dense: true, facts: p })}
          </span>
          <!--
            Changing the look, where the look is (#83).

            On the mark rather than in a Settings tab, because section 31 calls
            an avoidable request for manual configuration a design failure and
            "go to another screen to change the picture you are looking at" is
            that. Only for a writer: a reader pressing it would reach a picker
            whose every choice is refused.

            No backticks in this comment. Template literal.
          -->
          ${canWrite() ? `<button class="lookbtn" data-look="${esc(p.slug)}"
            aria-label="Change how ${esc(p.name)} looks" title="Change the icon or image">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14.5 4.5l5 5-9 9H5.5v-5z"/></svg>
          </button>` : ''}
        </span>
        <span style="min-width:0">
        <h1 class="t-display projname"${
          canWrite() ? ` contenteditable="plaintext-only" spellcheck="false" data-rename="${esc(p.slug)}"` : ''
        }>${esc(p.name)}</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${esc(p.purpose)}</p>
        </span>
      </div>
      <div class="headctl">
        <!--
          The faces are gone from here (#216).

          Grant: *"The small Chief of Staff/team-member photographs currently
          shown in the top-right navigation area do not add sufficient value.
          Remove them unless they are performing an important interaction that
          is currently hidden. Simplify the global header."*

          Nothing was hidden. A face here was a SPAN with a title attribute -
          not a button, not a filter, not a link to the person - so the only
          thing it could tell you was that somebody had touched the project,
          which the Activity and AI Team surfaces both say properly and with a
          verb attached. They stay where they mean something: the AI Team tab,
          where the face sits beside what that person is doing now.
        -->
        <!--
          There is no "Talk to the team" button here.

          Grant: *"what's the point of having two 'talk to the team' buttons?"*
          There were two, and worse, they did different things under the same
          words — the rail's is the voice call, this one opened the text chat.
          Chat is one tap away in AI Team, so the header keeps only what the
          tabs cannot say: the project's own settings.
        -->
        <!--
          The light/dark shortcut (#87).

          A sun icon sat here and did nothing. It was the Project Settings
          placeholder for #36, which is not built, so it shook and apologised —
          but the icon it shook with was a SUN, in the top right, which is where
          every application on earth puts a theme switch. Grant read it as a
          broken dark-mode button and he read it correctly.

          So the sun does what a sun does. Project settings comes back with #36,
          with a gear on it.

          It says which way it will go rather than which way it is: the icon is
          a moon when pressing it makes things dark. A control labelled with its
          current state reads as a status light and gets pressed by accident.
        -->
        <!--
          The board's controls, on the project's own line (#220).

          Same move as the home screen's: they were a row of their own directly
          under the waiting banner, holding two buttons and three hundred pixels
          of nothing, immediately above the content. The head has a right-hand
          slot and this is what it is for. Only drawn on Overview, because that
          is the only tab with a board on it - and only in PANELS mode, because
          the map has neither panels to add nor panels to reset, and its own
          Reset is in the corner controls where the reference puts it (#25).
          Two buttons named Reset on one screen, doing different things, is
          worse than either of them missing.

          No backticks in this comment. Template literal.
        -->
        ${state.tab !== 'overview' || mapMode() ? '' : `${spare.length === 0 ? '' : `<div class="addpanel">
          <button class="btn" data-add-open>+ Add panel</button>
          <div class="addmenu" data-add-menu hidden>
            ${spare.map((k) => `<button data-add="${k.id}">
              <b>${esc(k.name)}</b><span class="t-meta">${esc(k.note)}</span></button>`).join('')}
          </div>
        </div>`}
        <button class="btn" data-reset-panels title="Put the panels back">Reset</button>`}
        <button class="btn iconbtn" data-scheme-toggle title="Switch between light and dark"
                aria-label="Switch between light and dark">
          <svg class="i-sun" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2"/>
            <path d="M12 2.5v2.4M12 19.1v2.4M21.5 12h-2.4M4.9 12H2.5M18.7 5.3l-1.7 1.7M7 17l-1.7 1.7M18.7 18.7L17 17M7 7L5.3 5.3"/>
          </svg>
          <svg class="i-moon" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>
          </svg>
        </button>
      </div>
    </div>

    <!--
      The section strip lived here. It is in the rail now (#80), which is where
      Grant asked for it. The counts moved with it: sectionCounts is
      top-level for exactly that reason.

      No backticks in this comment. Template literal.
    -->

    ${waitingHere(p)}

    <!--
      AFTER the h1, not before it (#207).

      The first draft put this at the top of main, so the document opened with
      an h2 and reached its h1 second - a heading order that is wrong in a way
      an axe run does not catch, because nothing SKIPS. Order is not only about
      levels; it is about which heading you meet first.
    -->
    <h2 class="aonly">${esc(sectionName)}</h2>
    ${body}
  </main>`
}

/*
  What is waiting on Grant, in the project (#151).

  His words: *"the one genuinely urgent category in the whole product is visible
  exactly where you are least able to act on it"* — the landing page has shown
  this since 0240 and a project never did.

  ## In the header, not in a tab

  A tab would be an eighth section competing with seven others for a glance, and
  the whole complaint is that this is the urgent one. It sits under the project
  name, above everything, where nothing has to be scrolled to or chosen.

  ## Collapsed to a line until pressed

  A project usually has none, and a permanent empty panel above every project is
  worse than nothing — it teaches the eye to skip the place the urgent thing
  will appear. Nothing waiting renders NOTHING at all.

  ## And answered here

  The third bullet, and the one that had no mechanism until 0289: every other
  blocker could only be discussed. Each item draws the answers it actually
  offers, from `approval_options` — never an invented Yes/No, because an answer
  the handler cannot act on resolves the row and strands the job.

  No backticks in these comments. Template literal.
*/
function waitingHere(p) {
  const list = p.waiting ?? []
  if (list.length === 0) return ''
  const open = state.waitingOpen

  return `<section class="waitbar ${open ? 'open' : ''}">
    <button class="waithead" data-waiting-toggle aria-expanded="${open ? 'true' : 'false'}">
      <span class="waitdot ${list.some((w) => w.overdue) ? 'late' : ''}"></span>
      <b>${list.length === 1 ? 'One thing is' : `${list.length} things are`} waiting on you</b>
      <span class="t-meta">${
        list.some((w) => w.blocks)
          ? 'Something here is holding the work up.'
          : 'The rest of the project is carrying on.'
      }</span>
      <svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6"/></svg>
    </button>
    ${!open ? '' : `<div class="waitlist">${list.map((w) => `
      <article class="waititem ${w.overdue ? 'late' : ''}">
        <div class="wbody">
          <b>${esc(w.what)}</b>
          <span class="t-meta">${esc(w.who)} · ${when.stamp(w.at, w.when)}${
            w.overdue ? ' · <b class="wlate">past its deadline</b>' : ''}${
            w.blocks ? ' · nothing else on this moves until you answer' : ''}</span>
          ${w.why ? `<p class="t-meta wwhy">${esc(w.why)}</p>` : ''}
        </div>
        ${!canWrite() ? '' : `<div class="wact" data-saidwrap>
          <span class="t-meta" data-said></span>
          ${
            (w.options ?? []).length > 0
              ? w.options.map((o, i) => `<button class="btn ${i === 0 ? 'primary' : ''}"
                   data-answer="${esc(w.id)}" data-answer-with="${esc(o)}">${esc(o)}</button>`).join('')
              : `<form class="addfield" data-answer-form="${esc(w.id)}">
                   <input name="answer" placeholder="Your answer" aria-label="Your answer"
                     maxlength="240" autocomplete="off">
                   <button class="btn primary" type="submit">Send it</button>
                 </form>`
          }
        </div>`}
      </article>`).join('')}</div>`}
  </section>`
}

// --- render and wire ---------------------------------------------------------

/*
  The appearance picker.

  Swatches rather than names: nobody knows what "Clay" looks like from the word,
  and a palette you can see is a palette you can choose in a second. Each swatch
  is drawn from the palette's own tokens by setting `data-palette` on itself, so
  a new palette appears in this list with no code here at all.
*/

/*
  Team — the eight, and adding a ninth.

  Grant: *"one tab for the bot management where you add and remove bots
  dynamically, that's automatically done."* The database already supports this:
  `staff.permanent`, `staff.expires_at`, `staff.justification` and
  `staff.requested_for_job` exist precisely so an agent can be brought in for a
  piece of work and expire when it is done. What was missing was any way to see
  or do it.
*/
/*
  One person, opened.

  Configure was a dead button — the one whose reserved 90px made eight names
  wrap a character per line (#67). This is what it should always have opened.

  Expanded in place rather than in a second sheet. Settings is already a sheet,
  and a sheet inside a sheet is two Escape presses and a lost sense of where you
  are. The card becomes the editor and the rest of the grid stays put, so the
  answer to "who else is there" never leaves the screen.

  Grant: *"I want the staff members details to be editable on the front page —
  names, roles, but you know what kind of skills they have? I'd like to give
  them the ability to interact with other tools."* Both halves are here, and 0119
  is why they look different: expertise is a text field because it grants
  nothing, and a tool is a checkbox against a foreign key because it does.
*/
const LEVEL_NAMES = ['Reads only', 'Writes internally', 'Acts outside', 'Needs approval']

function personEditor(c) {
  const tools = c.tools ?? []
  const held = tools.filter((t) => t.granted).length
  const procs = c.procedures ?? []
  const spares = config.SPARE_BOTS ?? []

  const groups = [0, 1, 2, 3]
    .map((lvl) => {
      const rows = tools.filter((t) => t.level === lvl)
      if (rows.length === 0) return ''
      return `<div class="toolgroup">
        <span class="t-label">${esc(LEVEL_NAMES[lvl])}</span>
        ${rows
          .map(
            (t) => `<label class="toolrow${t.available ? '' : ' off'}"${
              t.available ? '' : ` title="${esc(t.unavailable_because ?? 'switched off for everyone')}"`
            }>
            <input type="checkbox" data-grant="${esc(t.tool)}" data-who="${esc(c.slug)}"
              ${t.granted ? 'checked' : ''}${t.available ? '' : ' disabled'}>
            <span>${esc(t.description ?? t.tool)}</span>
          </label>`,
          )
          .join('')}
      </div>`
    })
    .join('')

  const botOptions = [
    '<option value="">— none —</option>',
    ...(c.bot ? [`<option value="${esc(c.bot)}" selected>@${esc(c.bot)}</option>`] : []),
    ...spares.map((b) => `<option value="${esc(b.username)}">@${esc(b.username)} (spare)</option>`),
  ].join('')

  return `<article class="staffcard open" data-saidwrap
           style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
    <div class="sopen">
      <div class="srow">
        ${face(c, 46)}
        <div class="sfields">
          <input class="nm" data-f="p_name" value="${esc(c.name)}" aria-label="First name">
          <input data-f="p_title" value="${esc(c.role ?? '')}" aria-label="Role">
        </div>
        <button class="btn small quiet" data-close-person>Done</button>
      </div>

      <label class="flab">What they do</label>
      <textarea data-f="p_remit" rows="2" aria-label="What they do">${esc(c.remit ?? '')}</textarea>

      <label class="flab">How they talk <span class="t-meta">— one line, in your words.</span></label>
      <input data-f="p_style" value="${esc(c.style ?? '')}" aria-label="How they talk">

      <!--
        Skills route work, and they grant nothing.

        0119 drew the line and it is worth repeating on the page: this is
        vocabulary the router matches against, so a word here decides who gets
        asked. The tools below are the other thing entirely.

        No backticks in this comment. Template literal.
      -->
      <label class="flab">Skills <span class="t-meta">— comma separated. This decides
        who gets the work: "how much should we charge" finds whoever owns
        <i>charge</i>. It grants no tools.</span></label>
      <input data-f="p_skills" value="${esc((c.expertise ?? []).join(', '))}"
             aria-label="Skills" placeholder="pricing, charge, budget, forecast">

      <div class="srow wrap">
        <label class="flab" style="margin:0">Bot</label>
        <select data-bot="${esc(c.slug)}" aria-label="Which bot speaks as ${esc(c.name)}">
          ${botOptions}
        </select>
        ${c.bot ? `<a class="t-meta" href="https://t.me/${esc(c.bot)}" target="_blank" rel="noopener">open chat</a>` : ''}
      </div>

      <details class="tools">
        <summary>Tools — ${held} of ${tools.length} allowed</summary>
        <div class="toolbody">
          ${groups}
          <p class="t-meta">Ticking saves at once. A greyed row is switched off for
            everyone by policy, and granting it here cannot turn it on.</p>
        </div>
      </details>

      ${procs.length === 0 ? '' : `<details class="tools">
        <summary>How they work — ${procs.length} procedure${procs.length === 1 ? '' : 's'}</summary>
        <div class="toolbody">
          ${procs
            .map(
              (pr) => `<div class="proc" data-saidwrap>
              <div class="procname">${esc(pr.name)}${
                pr.scope === 'global' ? ' <span class="t-meta">— whole team</span>' : ''
              }</div>
              <div class="proctext">${esc(pr.procedure)}</div>
              <div class="srow">
                <span class="t-meta">from ${esc(pr.authored_by)} · shown to ${pr.uses ?? 0} job${
                  (pr.uses ?? 0) === 1 ? '' : 's'
                }</span>
                <span class="t-meta" data-said></span>
                <button class="btn small quiet" data-retire-proc="${esc(pr.skill_id)}">Retire</button>
              </div>
            </div>`,
            )
            .join('')}
          <p class="t-meta">Written down by telling the team, in a message. Retiring is
            reversible — say it again and it comes back.</p>
        </div>
      </details>`}

      <div class="srow wrap">
        <button class="btn primary" data-save-person="${esc(c.slug)}">Save</button>
        ${c.slug === 'chief-of-staff' ? '' : `<button class="btn small quiet"
          data-retire-person="${esc(c.slug)}" data-to="${c.active === false ? 'true' : 'false'}"
          data-name="${esc(c.name)}">${c.active === false ? 'Bring back' : 'Retire'}</button>`}
        <span class="t-meta" data-said></span>
      </div>
    </div>
  </article>`
}

function teamTabSettings() {
  const card = (c) =>
    state.person === c.slug
      ? personEditor(c)
      : `
    <article class="staffcard${c.active === false ? ' retired' : ''}" data-lift data-edge data-tilt="3.2"
             style="--hue:oklch(0.62 0.14 ${c.tone ?? 150})">
      ${face(c, 46)}
      <div class="sbody">
        <b>${esc(c.name)}</b>
        <span class="t-label">${esc(c.role)}</span>
        <span class="t-meta">${esc(
          c.active === false ? 'Retired' : (c.doing ?? 'Available'),
        )}</span>
      </div>
      <div class="sctl">
        <button class="btn" data-configure="${esc(c.slug)}">Configure</button>
      </div>
    </article>`

  const people = config.staff()
  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${people.filter((c) => c.active !== false).length}
        permanent. Bring in a specialist for a piece of work and they leave when it
        is finished.</p>
      ${canWrite() ? '<button class="btn primary" data-hire>+ Bring someone in</button>' : ''}
    </div>
    <!--
      The form behind the last dead button in the product (#105, migrations
      0233 to 0235).

      It carried data-hire and nothing anywhere looked that attribute up. Found
      by cross-referencing every data attribute in the rendered DOM against
      every attribute any source file queries, which is now verify:wired,
      rather than by pressing things one at a time.

      Why and when are required fields rather than optional ones. A hire with
      no reason and no end is how an office quietly grows: eight becomes
      eleven, nobody remembers why three of them are there, and every prompt is
      a little more expensive forever. The RPC refuses both too, because the
      page is not the only possible caller.

      No backticks in this comment. Template literal.
    -->
    <div class="hireform" data-hire-form hidden>
      <div class="hirerow">
        <label>Name
          <input data-hire-name placeholder="Priya" autocomplete="off"></label>
        <label>Here to do
          <input data-hire-title placeholder="Pricing research" autocomplete="off"></label>
      </div>
      <label>Why they are needed
        <input data-hire-why placeholder="The pricing work needs someone who is not already on three projects"
               autocomplete="off">
        <span class="t-meta" style="font-variant-caps:normal;letter-spacing:0">At least
          30 characters — the database enforces it, and a reason nobody can read later
          is the same as no reason.</span></label>
      <div class="hirerow">
        <label>Until
          <input type="date" data-hire-until></label>
        <span class="hireact">
          <span class="t-meta" data-said></span>
          <button class="btn primary" data-hire-go>Bring them in</button>
          <button class="btn quiet" data-hire-cancel>Cancel</button>
        </span>
      </div>
    </div>
    <div class="staffgrid">${people.map(card).join('')}</div>
    <p class="t-meta">A temporary agent carries a justification and an expiry, so the
      office never quietly grows. Removing one is reversible — there is no delete,
      because outputs, routing decisions and deliveries all name a person and a
      roster that can lose a row is a history that stops explaining itself.</p>
  </div>`
}

/*
  Setting up — the checklist, and the one thing only Grant can do.

  §31: an avoidable request for manual configuration is a design failure, and
  the preference order is API, then CLI, then automated configuration, then a
  manual UI. So this page is deliberately SHORT: everything that could be
  automated already was, and what is left is the irreducible part — a Google
  consent screen that has to be clicked by the person whose account it is.

  Three states and not two. `off` is something switched off on purpose and must
  not be shown as a fault; that distinction is the difference between a
  checklist you trust and one you learn to ignore.
*/
function setupTab() {
  const d = config.SETUP ?? {}
  const services = d.services ?? []
  const google = d.google ?? {}
  /*
    #210. From `hq_slack_setup`, not from the services list.

    The first version asked `services` for an entry named "Slack". There is
    none — Slack is listed there as "The office" — so the condition could never
    fire and the form never rendered. Handed the same shape `google` has, so
    nothing here has to match a display string.
  */
  const slack = d.slack ?? {}
  const needs = Number(d.needs_you ?? 0)
  const lamp = { ready: 'ok', action: 'degraded', off: 'off' }

  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${
        needs === 0
          ? `${d.ready ?? services.length} of ${services.length} services are set up. Nothing needs you.`
          : `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you. Everything else is done.`
      }</p>
    </div>

    ${
      google.services
        ? `<article class="behave" data-lift data-tilt="1.4" data-saidwrap>
      <div class="bhead">
        <b>Google</b>
        <span class="t-meta">${
          google.ready
            ? 'Connected. Calendar and mail are readable; sending stays off by policy.'
            : 'Not connected. One consent screen, and only you can click it.'
        }</span>
        <span class="t-meta" data-said></span>
      </div>
      <div class="srow wrap">
        ${
          google.ready
            ? `<button class="btn small quiet" data-forget-google>Disconnect Google</button>`
            : `<a class="btn primary" href="${esc(GOOGLE_START)}" target="_blank" rel="noopener">Connect Google</a>`
        }
      </div>
      <!--
        The two credentials, before the consent screen can be reached.

        The secret is a password field and is cleared the moment it is saved: it
        goes straight to the Supabase Vault through the API and is never echoed,
        never logged, and never put anywhere this page can read it back. That is
        the established mechanism, and it is why there is a field here at all
        rather than a request to paste it somewhere.

        Shown only when Google is not connected — once it is, these are answered
        and a form that stays around invites re-entering a working credential.

        No backticks in this comment. Template literal.
      -->
      ${
        google.ready
          ? ''
          : `<div class="gsetup" data-saidwrap>
        <label class="flab">Client ID</label>
        <input data-g-id placeholder="…apps.googleusercontent.com" aria-label="Google client ID"
               value="${esc(google.client_id ?? '')}">
        <label class="flab">Client secret</label>
        <input data-g-secret type="password" autocomplete="off"
               placeholder="GOCSPX-…" aria-label="Google client secret">
        <div class="srow wrap">
          <button class="btn" data-save-google>Save credentials</button>
          <span class="t-meta" data-said></span>
        </div>
      </div>`
      }
      <div class="glist">${(google.services ?? [])
        .map(
          (g) => `<div class="grow">
          <span class="dotstate ${g.connected ? 's-ok' : 's-off'}"></span>
          <b>${esc(g.name)}</b>
          <span class="t-meta">${esc(g.does)}</span>
        </div>`,
        )
        .join('')}</div>
    </article>`
        : ''
    }

    <!--
      Putting Slack back, from the page (#210).

      On 14 September a verification suite deleted the bot token and the
      signing secret. The restore instruction sent Grant to "the Slack section
      of Setting up", which did not exist: the only path was a script with the
      token in an environment variable. Section 31 calls an avoidable request
      for manual configuration a design failure, and his standing goal is
      blunter than that - a capability that exists only as a script an agent
      runs is a capability he does not have.

      Shown only while Slack is missing its credentials, for the same reason
      the Google form is: once it is connected these are answered, and a form
      that stays around invites re-entering a working credential.

      Both halves together because reinstalling produces both at the same
      moment, and a bot token on its own can post while being unable to verify
      anything inbound - which reads as connected and is half a connection.

      Both fields are cleared on save. They go to the Supabase Vault through
      the API and are never echoed, never logged and never readable back.

      No backticks in this comment. Template literal.
    -->
    ${
      slack.ready === false
        ? `<article class="behave" data-lift data-tilt="1.4" data-saidwrap>
      <div class="bhead">
        <b>Slack</b>
        <span class="t-meta">${
          slack.why_off
            ? esc(String(slack.why_off))
            : 'Not connected.'
        } Reinstall the app at Slack, then paste the two values it gives you.</span>
        <span class="t-meta" data-said></span>
      </div>
      <div class="gsetup">
        <label class="flab">Bot user OAuth token</label>
        <input data-sl-bot type="password" autocomplete="off" placeholder="xoxb-…"
               aria-label="Slack bot user OAuth token">
        <span class="t-meta">Install App page, under Bot User OAuth Token. Starts xoxb-.</span>
        <label class="flab">Signing secret</label>
        <input data-sl-sig type="password" autocomplete="off" placeholder="32 hex characters"
               aria-label="Slack signing secret">
        <span class="t-meta">Basic Information, under App Credentials. 32 characters, 0-9 and a-f.</span>
        <span class="t-meta">If you put them in the wrong boxes it does not matter — they are
          sorted by shape, not by which field they came from.</span>
        <div class="srow wrap">
          <a class="btn small quiet" href="https://api.slack.com/apps" target="_blank"
             rel="noopener">Open Slack app settings</a>
          <button class="btn primary" data-save-slack>Reconnect Slack</button>
        </div>
      </div>
    </article>`
        : ''
    }

    <div class="servicegrid">${services
      .map(
        (x) => `<article class="service s-${lamp[x.state] ?? 'unchecked'}" data-lift data-tilt="2.6">
        <div class="svbody">
          <b>${esc(x.name)}</b>
          <span class="t-meta">${esc(x.what ?? x.does ?? '')}</span>
          ${x.detail ? `<span class="t-meta from">${esc(x.detail)}</span>` : ''}
        </div>
        <div class="svfoot">
          <span class="dotstate"></span>
          <span class="t-label">${esc(
            x.state === 'ready' ? 'Ready' : x.state === 'off' ? 'Switched off' : 'Needs you',
          )}</span>
          ${x.action ? `<span class="t-meta">${esc(x.action)}</span>` : ''}
        </div>
      </article>`,
      )
      .join('')}</div>
  </div>`
}

/*
  Help — what all this is.

  Written as prose rather than a list of features, because the question it
  answers is not "what can it do" but "what am I looking at". Short on purpose:
  a help page nobody finishes is a help page nobody read.
*/
/*
  Help, as a guide rather than seven aphorisms (#104).

  Grant named the sections: setup, navigation, connections, documents, tasks,
  and using team voice and messaging. They are used in that order, because a
  list of the things he asked for in the order he asked for them is a better
  structure than one invented here.

  ## Written in his register, which is a standing instruction

  *"Always be explicit with instructions!!! Never assume I just know what you
  are referring to. Also include full instructions each and every time with
  URLs, steps to follow, etc."*

  So: numbered steps, the real button labels, and what success looks like. Not
  "connect your Drive account" but the press, the screen it lands on, and how
  you know it worked.

  ## Written LAST, on purpose

  Nine of the thirty items in his review changed navigation. A guide describing
  tabs that became sidebar entries is worse than no guide, because it is
  confidently wrong. This describes the interface as it stands after all of
  them.

  ## No secrets, ever

  Not the bearer token, not a connector credential, not in an example. Where a
  step needs one, the step is the procedure for getting it — `npm run hq:token`
  sends it to Telegram. `npm run check:secrets` would catch a pasted value in
  this file; it would not catch one baked into a screenshot of this page.
*/
const HELP = [
  {
    title: 'Setting up',
    steps: [
      'Open Settings at the bottom left, then "Setting up". It lists what is done and what is not, in order.',
      'Anything still outstanding says what to press. Work down the list — each step unlocks the next.',
      'To connect Google, use "Connect Google" on the Connections tab. It opens Google\'s own consent screen and comes back here.',
      'The bearer token is never shown on any page. Run npm run hq:token and it arrives on Telegram.',
    ],
    note: 'If a step looks done but the light is orange, the connection answered and something about it is off — the card says which.',
  },
  {
    title: 'Finding your way around',
    steps: [
      'The sidebar is the whole of the navigation. Top left is the dashboard project you are in; press it to switch to another or to see them all.',
      'Under it are that project\'s sections: Overview, AI Team, Documents, Tasks, Contacts, Sources and Project Settings. The number beside one is how many things are waiting in it.',
      'The chevron at the very top left collapses the sidebar completely and gives the space to the content. It stays collapsed until you press it again.',
      'At the bottom: Call the team, Recent activity, and Settings.',
    ],
    note: 'A dashboard project is the source of truth and it lives here. A Notion database, a notebook or a Drive folder is something a project is ATTACHED TO — never the project itself.',
  },
  {
    title: 'Connections',
    steps: [
      'Settings, then Connections. Every service the office can reach, with a light saying whether it answered.',
      'Not connected shows a Connect button that starts the real authorisation. Connected shows Manage, which takes you to where its credential lives.',
      '"+ Connect something" lists everything available with its state, and every row leads somewhere real or says plainly that there is no flow yet.',
      'The MCP card\'s "How to connect a client" shows the server URL and the tools another client would see — this is how something other than this page reaches the office.',
    ],
    note: 'Disconnecting Google is real and reversible: it revokes here and you can connect again. Other services say Manage instead, because a button that appeared to revoke a credential while revoking nothing would be worse than no button.',
  },
  {
    title: 'Documents',
    steps: [
      'Documents shows everything the office holds for a project. Opening one shows its whole text, however long.',
      'Documents arrive through a connector rather than an upload: press "Bring documents in" and attach Drive, Notion or NotebookLM on the Sources tab.',
      'The Sources tab takes a pasted Google Drive link and works out the rest by itself.',
      'The speech icon on a document starts a conversation about that document with the team. The bar at the top of it brings you back to where you were.',
    ],
    note: 'A PDF that came in as extracted text shows its text. Where the office holds the actual file, it opens in a viewer with a link to the real thing.',
  },
  {
    title: 'Tasks',
    steps: [
      'Tasks, then "Add a task". A title is all that is required; a due date and an owner are optional.',
      'The circle beside a task marks it done, and that is saved — it is not just a tick on this screen.',
      'A task can be waiting on something, in progress, to do, or completed, and the section groups them that way.',
      'To have dated tasks appear in your Google Calendar, turn on "Put dated tasks in my Google Calendar" on the Behaviour tab.',
    ],
    note: 'Calendar sync is one way. A task with a due date becomes an all-day event and comes away when it is done; the diary never changes a task, and nothing the office did not create is ever touched.',
  },
  {
    title: 'Talking to the team',
    steps: [
      'Press "Call the team" in the sidebar. The browser asks for the microphone once. Talk over her whenever you like — she stops.',
      'The call keeps running while you move around the interface. The button stays lit while it is live.',
      'Press it again to hang up. That stops the microphone as well as the call — the recording indicator in your browser goes out.',
      'To type instead, open AI Team then Chat on any project, or use the "Type instead" box on the call itself.',
    ],
    note: 'Telegram is the other way in, and the one that reaches you when you are not here. Message the bot and it answers as Claire.',
  },
  {
    title: 'When something looks wrong',
    steps: [
      'Recent activity shows everything the office did and whether it can be undone.',
      'Settings then Connections shows what is reachable right now, rather than what was reachable when it was set up.',
      'The Usage tab says, on every card, whether a figure was measured, reported by the service, or estimated by us.',
      'If a number looks wrong, say so. A dashboard that lies once is one you stop believing.',
    ],
    note: '',
  },
]

function helpTab() {
  return `<div class="setbody">
    <p class="t-lead" style="margin:0 0 var(--s4)">Seven things, in the order you
      are likely to need them.</p>
    <div class="helplist">${HELP.map((h) => `<article class="helpsec">
      <h3 class="t-title" style="margin:0;font-size:17px">${esc(h.title)}</h3>
      <ol class="helpsteps">${h.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      ${h.note === '' ? '' : `<p class="helpnote">${esc(h.note)}</p>`}
    </article>`).join('')}</div>
  </div>`
}

/*
  Behaviour — how much the office does without asking.

  This is the frontend half of #15. The one that matters is the top one: a
  system that interrupts on everything is a system you stop reading, and one
  that interrupts on nothing is one you stop trusting.
*/
function behaviourTab() {
  const row = (b) => {
    if (b.kind === 'choice') {
      return `<article class="behave" data-lift data-tilt="1.6" data-saidwrap>
        <div class="bhead"><b>${esc(b.name)}</b><span class="t-meta" data-said></span></div>
        <div class="choices">
          ${b.options.map((o) => `
            <button class="choice ${b.value === o.id ? 'on' : ''}"
                    data-choose="${esc(b.id)}:${esc(o.id)}" data-via="${esc(b.via ?? '')}"
                    ${b.settable === false || !canWrite() ? 'disabled' : ''}>
              <b>${esc(o.name)}</b>
              <span class="t-meta">${esc(o.note)}</span>
            </button>`).join('')}
        </div>
      </article>`
    }
    if (b.kind === 'switch') {
      /*
        Drawn as a control only when it IS one.

        `settable` comes from the same allow-list `hq_set_setting` enforces, so
        the page can never offer a switch the API will refuse. Two of these are
        deliberately fixed rather than unbuilt — "keep everything undoable" is
        what the ledger does, not a preference — and both say why instead of
        being silently omitted, because a missing row raises the question and
        a stated one answers it.

        No backticks in this comment: template literal.
      */
      return `<article class="behave row" data-lift data-tilt="1.6" data-saidwrap>
        <div class="bhead">
          <b>${esc(b.name)}</b>
          <span class="t-meta">${esc(b.note)}</span>
          <span class="t-meta" data-said></span>
        </div>
        ${b.settable === false || !canWrite()
          ? `<span class="pillvalue">${b.value ? 'On' : 'Off'}</span>`
          : `<button class="toggle ${b.value ? 'on' : ''}" role="switch"
                aria-checked="${b.value}" data-toggle="${esc(b.id)}"
                data-via="${esc(b.via ?? '')}" data-now="${b.value ? '1' : ''}"
                aria-label="${esc(b.name)}"><span class="knob"></span></button>`}
      </article>`
    }
    return `<article class="behave row" data-lift data-tilt="1.6">
      <div class="bhead">
        <b>${esc(b.name)}</b>
        <span class="t-meta">${esc(b.note)}</span>
      </div>
      <span class="pillvalue">${esc(b.value)}</span>
    </article>`
  }
  /*
    The exceptions to the dial above (#15).

    A standing authorization is Grant having said "do not ask me about this
    again" -- usually by answering a question with that option rather than by
    coming here. So this list is mostly a place to AUDIT and to take one back,
    which is why there is a Revoke and no Add: a permission granted from a
    settings page is one granted without the question that motivated it.

    Level is shown because it is the thing that decides: a level-2 exception
    lets outward work happen unasked, and a level-3 one cannot exist at all.
  */
  const standing = (a) => `<article class="behave row ${a.live ? '' : 'spent'}" data-lift data-tilt="1.6" data-saidwrap>
    <div class="bhead">
      <b><code class="govreqtool">${esc(a.tool)}</code> in ${esc(a.scope)}</b>
      <span class="t-meta">${esc(a.reason)}</span>
      <!--
        The reason only when it adds something.

        app.revoke_standing supplies "you took it back" when Grant gives none,
        which under a line already reading "Taken back" is the same sentence
        twice - the repetition #186 found in the provenance line, in a smaller
        place. No backticks in this comment: template literal.
      -->
      ${a.revoked
        ? `<span class="t-meta">Taken back ${when.stamp(a.revoked)}${
            a.revoked_reason && a.revoked_reason !== 'you took it back'
              ? ` — ${esc(a.revoked_reason)}`
              : ''
          }</span>`
        : `<span class="t-meta">Since ${when.stamp(a.since)}${a.until ? `, until ${when.stamp(a.until)}` : ''}</span>`}
      <span class="t-meta" data-said></span>
    </div>
    ${a.live
      ? `<button class="gobtn danger" data-unstand="${esc(a.id)}"
                 ${canWrite() ? '' : 'disabled'}>Revoke</button>`
      : '<span class="pillvalue">Taken back</span>'}
  </article>`

  const live = config.STANDING.filter((a) => a.live).length

  return `<div class="setbody">
    <p class="t-lead" style="margin:0">What the team may do on its own, and when it
      should stop and ask you.</p>
    <div class="behaves">${config.BEHAVIOURS.map(row).join('')}</div>

    <section class="govsec">
      <h3 class="govtitle">Things you said not to ask about<span class="t-meta">${esc(String(live))} in force</span></h3>
      ${config.STANDING.length === 0
        ? '<p class="t-meta govempty">Nothing. Every exception here comes from you answering a question with “do not ask me again”.</p>'
        : `<div class="behaves">${config.STANDING.map(standing).join('')}</div>`}
    </section>
  </div>`
}


/*
  Governance — what the office learned, what it wants, what it noticed, and
  what each agent has tried and could not do (#54, migration 0302).

  Four questions on one page, in the order Grant would ask them. The last list
  is the one the Issue calls the most useful thing here, and it is: an agent
  that has hit the same wall nine times is an agent telling you what to build
  next, in its own words, without anybody writing a report.

  ## The shape, and why it is not four card grids

  Four uniform card grids is exactly the generic-AI UI the visual standard
  forbids. So each answer gets the form its content wants: a lesson is a
  QUOTATION and is set as one; a proposal is an ARGUMENT and is set as a case
  with its cost and its verdict; a suggestion is a NOTE with a tally; an agent
  is a PROFILE whose failures are the body, not a footnote.

  Everything on this page is read-only for a reader with no token. Retracting a
  lesson and deciding a proposal are writes and say so.
*/
function governanceTab() {
  const g = config.GOVERNANCE

  /*
    Waiting, but only when there is a real office to wait for.

    With no token the studio banners "Nothing on this page is your office" and
    the fallback rows in settings.js stand in — which is what makes this page
    judgeable from a capture. With a token and nothing back yet, four empty
    lists would say the office has learned nothing, and that is a different and
    much worse sentence than "asking".
  */
  if (!g.loaded && source.live) {
    return `<div class="setbody">
      <p class="t-lead" style="margin:0">Asking the office what it has learned…</p>
      <div class="govskel">${[0, 1, 2].map(() => '<span></span>').join('')}</div>
    </div>`
  }

  /*
    A lesson, as a quotation.

    The attribution line carries all three things the Issue asks for — the
    scope, who learned it, and the job it came from — because a lesson you
    cannot place is one you cannot judge. The job id is shown as its first
    eight characters: it is there to be recognised and searched for, not read
    aloud.
  */
  const lesson = (l) => `<article class="govlesson" data-lift data-tilt="1.4" data-saidwrap>
    <blockquote class="govquote">${esc(l.body)}</blockquote>
    <div class="govfoot">
      <div class="govfrom">
        <span class="govscope s-${esc(l.scope)}">${esc(SCOPE_WORD[l.scope] ?? l.scope)}</span>
        <!--
          The place, unless the scope already said it.

          A global lesson comes back with "everywhere" in both fields, and a
          pill reading Everywhere followed by the word everywhere is the page
          saying the same thing twice in a row.

          No backticks in this comment: template literal.
        -->
        ${String(l.where ?? '').toLowerCase() === 'everywhere' ? ''
          : `<span class="t-meta">${esc(l.where)}</span>`}
        <span class="t-meta">learned by ${esc(l.who ?? 'the office')}</span>
        ${l.seen > 1 ? `<span class="t-meta">seen ${esc(String(l.seen))} times</span>` : ''}
        ${l.job ? `<span class="t-meta govjob" title="The job this came from">job ${esc(String(l.job).slice(0, 8))}</span>` : ''}
        <span class="t-meta">${when.stamp(l.at)}</span>
      </div>
      <span class="t-meta" data-said></span>
      <button class="gobtn danger" data-retract="${esc(l.id)}"
              ${canWrite() ? '' : 'disabled'}>Retract</button>
    </div>
  </article>`

  /*
    A proposal, as a case to be answered.

    Approve and Decline sit side by side and a settled one keeps its verdict on
    the page — #49's whole argument is that a decline has to be durable, and a
    decline that disappears is one Grant cannot remember making. Reopen is
    offered on a settled row because the world changes; it is a person's call
    and never the office's.
  */
  const proposal = (p) => `<article class="govcase g-${esc(p.state)}" data-lift data-tilt="1.4" data-saidwrap>
    <div class="govhead">
      <b>${esc(p.title)}</b>
      <span class="govstate">${esc(STATE_WORD[p.state] ?? p.state)}</span>
    </div>
    <p class="govarg">${esc(p.argument)}</p>
    ${p.note ? `<p class="govnote">Your note: ${esc(p.note)}</p>` : ''}
    <div class="govfoot">
      <div class="govfrom">
        <span class="t-meta">${esc(p.who)} asks for <b>${esc(p.remedy)}</b></span>
        ${p.cost ? `<span class="t-meta govcost">${esc(p.cost)}</span>` : ''}
        ${p.times > 1 ? `<span class="t-meta">hit ${esc(String(p.times))} times</span>` : ''}
      </div>
      <span class="t-meta" data-said></span>
      ${p.state === 'open'
        ? `<button class="gobtn" data-decide="${esc(p.id)}:declined"
                   ${canWrite() ? '' : 'disabled'}>Decline</button>
           <button class="gobtn go" data-decide="${esc(p.id)}:approved"
                   ${canWrite() ? '' : 'disabled'}>Approve</button>`
        : `<button class="gobtn" data-decide="${esc(p.id)}:open"
                   ${canWrite() ? '' : 'disabled'}>Reopen</button>`}
    </div>
  </article>`

  /*
    A suggestion, and what became of it.

    The dismissal count is deliberately loud when it is above zero. A thing
    offered four times and dismissed four times is the office failing to take a
    hint, and that is a fact about the office rather than about the suggestion.
  */
  const noted = (s) => `<li class="govnoted" data-lift data-tilt="1.2">
    <div class="govhead">
      <b>${esc(s.body)}</b>
      <span class="govstate">${esc(STATE_WORD[s.state] ?? s.state)}</span>
    </div>
    <!--
      The evidence, as chips.

      suggestions.because is JSONB and holds the numbers the noticing pass
      counted, not a sentence: something like eleven documents and no notebook.
      Rendered with esc() it becomes the words object Object, which is what the
      first pass at this page shipped.

      No backticks in this comment: template literal.
    -->
    ${evidence(s.because)}
    <div class="govfrom">
      ${s.project ? `<span class="t-meta">${esc(s.project)}</span>` : ''}
      <span class="t-meta">${esc(KIND_WORD[s.kind] ?? String(s.kind).replace(/_/g, ' '))}</span>
      ${s.dismissed > 0
        ? `<span class="govdismiss">dismissed ${esc(String(s.dismissed))}×</span>`
        : ''}
      <span class="t-meta">${when.stamp(s.at)}</span>
    </div>
    <!--
      A decision, where there is one to make (#147).

      Most suggestions are a NOTE: the noticing pass counted something and is
      telling him. A few carry an offer the office can perform on a press, and
      only those get buttons - drawing Accept on a note would put a control in
      front of him that performs nothing, which this repository has a whole
      audit for.

      offer is app.hq_governance's name for suggestions.offer_kind, added in
      0391. A missing one is a note, which is the common case and the safe
      default.

      The body above IS the drafted rule, verbatim, which is what makes these
      buttons honest: he is approving the sentence he can read, not a summary
      of one. No backticks in this comment: template literal.
    -->
    ${s.offer && s.state === 'open'
      ? `<div class="govdecide">
          <span class="t-meta">${esc(OFFER_WORD[s.offer] ?? 'The office can act on this.')}</span>
          <button class="gobtn" data-suggest="${esc(s.id)}:yes"
                  ${canWrite() ? '' : 'disabled'}>Accept</button>
          <button class="gobtn danger" data-suggest="${esc(s.id)}:no"
                  ${canWrite() ? '' : 'disabled'}>Decline</button>
        </div>`
      : ''}
  </li>`

  /*
    An agent, and the walls it has hit.

    `tried_and_could_not` comes from `app.impediments_tally(90, 1, false)` —
    ninety days, at least once, fixtures excluded. An agent with an empty list
    says so in a sentence rather than rendering as a card with a hole in it.
  */
  const agent = (a) => `<article class="govagent" data-lift data-tilt="1.4">
    <div class="govhead">
      <b>${esc(a.name)}</b>
      <span class="t-meta">${esc(a.remit ?? '')}</span>
    </div>
    <div class="govtools">
      <span class="govcount">${esc(String(a.tools ?? 0))} tools</span>
      ${(a.expertise ?? []).slice(0, 4).map((x) => `<span class="govskill">${esc(x)}</span>`).join('')}
    </div>
    ${(a.tried_and_could_not ?? []).length === 0
      ? '<p class="t-meta govclear">Has not been stopped by anything in ninety days.</p>'
      : `<ul class="govwalls">${a.tried_and_could_not.map((w) => `<li>
          <span class="govwall">${esc(w.needed)}</span>
          <span class="t-meta">${esc(WALL_WORD[w.kind] ?? w.kind)}</span>
          <span class="govtimes">${esc(String(w.times))}×</span>
        </li>`).join('')}</ul>`}
  </article>`

  /*
    What it counted, in a form a person can read.

    Keys come from the noticing pass and are snake_case column-ish names, so
    the underscores go and the number sits beside the word. A value that is
    itself a structure is skipped rather than stringified — one chip reading
    object Object teaches a reader to distrust the other four.
  */
  const evidence = (because) => {
    const rows = Object.entries(because ?? {}).filter(
      ([, v]) =>
        typeof v === 'number' ||
        v === true ||
        (typeof v === 'string' && v.trim() !== '' && v.length <= 32),
    )
    if (rows.length === 0) return ''
    /*
      A counted fact and a signal that simply FIRED are not the same chip.

      The noticing pass counts things — eleven documents, four Fridays — and the
      number in ink is the whole point. A correction's evidence is boolean: it
      followed an answer, it opened with a rejection. Rendering those through
      the same path put a bold 1 in front of every one of them, which reads as a
      count of something and is a count of nothing.

      Long strings are dropped rather than truncated. This row is a set of
      chips; a sentence in it is not a chip, and suggestions.because is JSONB
      that nothing constrains, so the guard belongs here.
    */
    return `<div class="govwhy">${rows
      .slice(0, 6)
      .map(([k, v]) => `<span class="govbit">${v === true ? '' : `<b>${esc(String(v))}</b>`}
        ${esc(k.replace(/_/g, ' '))}</span>`)
      .join('')}</div>`
  }

  /*
    A request for reach, as a thing to answer (ADR-0018, #272).

    The difference from a proposal one section above: a proposal asks for a
    CHANGE and this asks for a KEY. Approving it grants the tool there and
    then, so the confirmation is on the approve side here and on the decline
    side there -- the heavier press gets the question, whichever it is.

    because is JSONB holding counts, not a sentence, so it goes through
    evidence() like a suggestion does. Rendered with esc it reads object
    Object, which is a defect this page has already shipped once.

    No backticks in this comment: template literal.
  */
  const request = (r) => `<article class="govcase g-${esc(r.state)}" data-lift data-tilt="1.4" data-saidwrap>
    <div class="govhead">
      <b>${esc(r.who_name)} is asking for <code class="govreqtool">${esc(r.tool)}</code></b>
      <span class="govstate">${esc(STATE_WORD[r.state] ?? r.state)}</span>
    </div>
    <p class="govarg">${esc(r.what_for)}</p>
    ${r.reason ? `<p class="govnote">Your reason: ${esc(r.reason)}</p>` : ''}
    ${evidence(r.because)}
    <div class="govfoot">
      <div class="govfrom">
        ${r.declines > 0
          ? `<span class="govdismiss">asked again after ${esc(String(r.declines))} no${r.declines === 1 ? '' : 'es'}</span>`
          : ''}
        <span class="t-meta">${when.stamp(r.at)}</span>
      </div>
      <span class="t-meta" data-said></span>
      ${r.state === 'open'
        ? `<button class="gobtn" data-tool="${esc(r.id)}:decline"
                   ${canWrite() ? '' : 'disabled'}>Decline</button>
           <button class="gobtn go" data-tool="${esc(r.id)}:approve"
                   ${canWrite() ? '' : 'disabled'}>Approve</button>`
        : ''}
    </div>
  </article>`

  /*
    A decision, and what it ruled out (#129).

    The ruled-out list is given its own line rather than folded into the
    reason, because it is the thing the Issue is about and the thing that would
    otherwise be skimmed: "we chose Notion" invites the question again, "we
    chose Notion over Drive because the team edits in place" closes it.

    A superseded decision stays on the page, sunken. That is the Issue's own
    acceptance criterion — a log that hides what it replaced cannot answer when
    the office changed its mind — and it is why this is a list rather than a
    lookup.
  */
  const decision = (d) => `<article class="govcase ${d.live ? 'g-open' : 'g-declined'}" data-lift data-tilt="1.4" data-saidwrap>
    <div class="govhead">
      <b>${esc(d.question)}</b>
      <span class="govstate">${d.live ? 'Standing' : 'Replaced'}</span>
    </div>
    <p class="govarg"><b>${esc(d.chose)}</b> — ${esc(d.because)}</p>
    ${(d.ruled_out ?? []).length === 0
      ? ''
      : `<p class="govnote">Ruled out: ${(d.ruled_out ?? []).map((x) => esc(x)).join(' · ')}</p>`}
    <div class="govfoot">
      <div class="govfrom">
        <span class="t-meta">${d.by === 'grant' ? 'You decided' : `${esc(d.by)} decided`}</span>
        ${d.project ? `<span class="t-meta">${esc(d.project)}</span>` : ''}
        <span class="t-meta">${when.stamp(d.at)}</span>
      </div>
    </div>
  </article>`

  const empty = (what) => `<p class="t-meta govempty">${esc(what)}</p>`

  return `<div class="setbody">
    <p class="t-lead" style="margin:0">What the team has learned, what it wants,
      what it noticed, and where it keeps getting stuck. Everything here is a row
      you can act on — nothing changes behaviour without leaving a trace.</p>

    <section class="govsec">
      <h3 class="govtitle">What it learned<span class="t-meta">${esc(String(g.lessons.length))}</span></h3>
      ${g.lessons.length === 0
        ? empty('Nothing yet. A lesson is written when a correction sticks.')
        : `<div class="govlessons">${g.lessons.map(lesson).join('')}</div>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">What it wants<span class="t-meta">${esc(String(g.proposals.filter((p) => p.state === 'open').length))} open</span></h3>
      ${g.proposals.length === 0
        ? empty('Nothing outstanding. A proposal appears when an agent hits the same wall three times.')
        : `<div class="govcases">${g.proposals.map(proposal).join('')}</div>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">What it is asking for<span class="t-meta">${esc(String((g.requests ?? []).filter((r) => r.state === 'open').length))} open</span></h3>
      ${(g.requests ?? []).length === 0
        ? empty('Nothing outstanding. A request appears when an agent needs reach it does not have.')
        : `<div class="govcases">${g.requests.map(request).join('')}</div>`}
    </section>

    <!--
      What it cannot finish, and how well it is doing (#272).

      Both were in the database with a mouth and no caller: nothing anywhere
      read app.hq_stranded_work or app.eval_latest, so the one number that
      says whether the office is getting better or worse was visible only to
      a script. Folded into this payload rather than given their own sections,
      because this is the same screen and the same question.

      No backticks in this comment: template literal.
    -->
    <section class="govsec">
      <h3 class="govtitle">What it cannot finish<span class="t-meta">${esc(String((g.stranded ?? {}).total ?? 0))}</span></h3>
      ${Number((g.stranded ?? {}).total ?? 0) === 0
        ? empty('Nothing is stuck. Work that needs something the office has not got would appear here.')
        : `<div class="govstranded">
            <ul class="govnotes">${((g.stranded ?? {}).kinds ?? []).map((k) => `<li class="govnote">
              <b>${esc(k.kind ?? '')}</b>
              <span class="t-meta">${esc(String(k.waiting ?? 0))} waiting</span>
            </li>`).join('')}</ul>
            ${(g.stranded ?? {}).why ? `<p class="t-meta govwhy">${esc(g.stranded.why)}</p>` : ''}
          </div>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">How it is scoring<span class="t-meta">${
        (g.scoring ?? []).length === 0 ? 'not measured' : `${esc(String((g.scoring ?? [])[0]?.agreed ?? 0))} of ${esc(String((g.scoring ?? [])[0]?.cases ?? 0))}`
      }</span></h3>
      ${(g.scoring ?? []).length === 0
        ? empty('No evaluation has been run. npm run eval grades the office against Grant\'s own judgement.')
        : `<ul class="govnotes">${(g.scoring ?? []).slice(0, 4).map((e) => `<li class="govnote">
            <b>${esc(String(e.agreed ?? 0))} of ${esc(String(e.cases ?? 0))} agreed</b>
            <span class="t-meta">mean ${esc(String(e.mean_score ?? '—'))} · ${esc(when.words(e.at))}${
              e.note ? ` · ${esc(e.note)}` : ''
            }</span>
          </li>`).join('')}</ul>`}
    </section>

    <!--
      What starts work on its own (#264).

      The framework was built, verified and completely invisible: a section on
      the gateway that no page read. Grant's questions from the Issue are the
      columns — what exists, is it on, what does it listen for, what does it
      start, when did it last fire, and was anything declined.

      No backticks in this comment: template literal.
    -->
    <section class="govsec">
      <h3 class="govtitle">What starts work on its own<span class="t-meta">${
        (g.triggers ?? []).filter((t) => t.enabled).length
      } on</span></h3>
      ${(g.triggers ?? []).length === 0
        ? empty('Nothing is listening. A trigger turns something happening — a document arriving, a connection failing — into work, under the same permissions as anything else.')
        : `<ul class="govnotes">${(g.triggers ?? []).map((t) => `<li class="govnote gtrig">
            <b>${esc(t.name ?? '')}</b>
            <span class="gtrigstate ${t.enabled ? 'on' : 'off'}">${t.enabled ? 'on' : 'off'}</span>
            <span class="t-meta">${esc(t.source ?? '')} · ${esc(t.event_type ?? '')} → ${esc(t.job_kind ?? '')}</span>
            <span class="t-meta">${
              t.last_fired ? `last fired ${esc(when.words(t.last_fired))}` : 'never fired'
            }${Number(t.declined ?? 0) > 0 ? ` · ${esc(String(t.declined))} declined` : ''}</span>
            ${
              t.last_declined && t.last_declined.why
                ? `<span class="t-meta govwhy">${esc(t.last_declined.why)}</span>`
                : ''
            }
          </li>`).join('')}</ul>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">What it noticed<span class="t-meta">${esc(String(g.noticed.length))}</span></h3>
      ${g.noticed.length === 0
        ? empty('Nothing noticed yet. The noticing pass runs over finished work.')
        : `<ul class="govnotes">${g.noticed.map(noted).join('')}</ul>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">What it has settled<span class="t-meta">${esc(String(config.DECISIONS.filter((d) => d.live).length))} standing</span></h3>
      ${config.DECISIONS.length === 0
        ? empty('Nothing yet. A decision is written down when you answer a question or settle a proposal.')
        : `<div class="govcases">${config.DECISIONS.map(decision).join('')}</div>`}
    </section>

    <section class="govsec">
      <h3 class="govtitle">What each of them can do<span class="t-meta">${esc(String(g.agents.length))}</span></h3>
      <div class="govagents">${g.agents.map(agent).join('')}</div>
    </section>
  </div>`
}

/** A scope, in words. The enum is for the database; this page is for a person. */
const SCOPE_WORD = {
  global: 'Everywhere',
  project: 'One project',
  staff: 'One person',
  job_kind: 'One kind of work',
}

/*
  A refusal, in words.

  `job_impediments.kind` is an enum written for the office to reason with, and
  `not_capable` in front of a person is the database talking. §25.
*/
const WALL_WORD = {
  missing_tool: 'the office has no such tool',
  missing_skill: 'nobody has been shown how',
  missing_data: 'nothing to work from',
  needs_permission: 'they are not granted it',
  ambiguous: 'could not tell what was meant',
  not_capable: 'beyond what they can do',
}

/*
  What accepting a suggestion would actually DO (#147).

  Said in the office's words rather than the column's, and said at all because
  "Accept" on its own does not tell him whether he is agreeing with an
  observation or changing how the team behaves for ever. Keyed on
  suggestions.offer_kind; an offer kind with no sentence here still gets its
  buttons and a general one, because a missing label must not silence a
  control.
*/
const OFFER_WORD = {
  learn: 'Accepting makes this a standing rule the team is shown.',
}

/*
  What kind of thing the office noticed, in words rather than in the column's.

  `suggestions.kind` is a slug and `standing_rule` was printing on Grant's
  screen with its underscore in it — a database value shown as prose, which is
  the same defect as the one that put "object Object" on the first draft of
  this page. Anything not named here falls back to its own words with the
  underscores taken out, so a kind added later reads badly rather than not at
  all.
*/
const KIND_WORD = {
  standing_rule: 'a rule it drafted',
  attach: 'attach',
  routine: 'routine',
}

/** A state, in words, for both proposals and suggestions. */
const STATE_WORD = {
  open: 'Open',
  approved: 'Approved',
  declined: 'Declined',
  done: 'Done',
  dismissed: 'Dismissed',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
}

/*
  Connections — every service, with its real mark.

  The marks are drawn on one 24×24 grid at one weight rather than downloaded,
  because eight official SVGs arrive at eight different optical sizes and a row
  of them reads as eight logos instead of one list. See logos/LICENCE.txt.

  A connection that is unwell says what to do about it in the same card. A
  settings page that reports a problem and leaves you to find the fix is a
  settings page that has told on itself and helped nobody.
*/
function connectionsTab() {
  const card = (c) => `
    <article class="service s-${c.state}" data-lift data-tilt="3.4"
             style="--tint:${esc(c.tint ?? 'var(--edge)')}">
      <!--
        Nothing rather than the word "undefined".

        The marks table has a logo for the services with one, and Uploads and
        MCP are not companies — there is no mark to draw. Printing an absent one
        gave every card without a logo the literal text "undefined", wrapped
        across two lines where the icon should be.

        This comment originally spelled that table name in backticks, inside an
        HTML comment, inside a template literal — while itself saying not to.
        The file became unparseable and every capture failed with a syntax
        error. Fourth time; the rule is in CLAUDE.md and it is easy to type.

        No backticks in this comment: template literal.
      -->
      ${c.svg ? `<span class="mark">${c.svg}</span>` : ''}
      <div class="svbody">
        <b>${esc(c.name)}</b>
        <span class="t-meta">${esc(c.used)}</span>
        <!--
          Capped. connection_health.detail is a short state note for most
          services and four hundred characters of token scoping for GitHub, and
          one card four times the height of its neighbours is the grid falling
          over. The whole note is still in the database for whoever needs it.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta from">${esc(
          String(c.detail ?? '').length > 110
            ? `${String(c.detail).slice(0, 108).replace(/[\s,;.]+\S*$/, '')}…`
            : (c.detail ?? ''),
        )}</span>
      </div>
      <div class="svfoot">
        <span class="dotstate"></span>
        <span class="t-label">${esc(config.STATE_LABEL[c.state])}</span>
        <span class="t-meta">${when.stamp(c.lastAt, c.last)}</span>
        <!--
          The action, and it goes somewhere (#89, #90).

          There was a button here carrying the text of c.fix and NOTHING ELSE —
          no attribute, no handler. "Connect it" on the Zoom card and "Rotate
          it" on the GitHub card, both completely inert. A card that names the
          problem and offers a button that does not fix it is worse than a card
          that only names the problem.

          Not connected gets Connect, routed to the flow that already exists.
          Connected gets Disconnect where a disconnect actually exists — which
          today is the Google family, through forget_google. Everything else
          says where its credential lives instead of offering a button that
          would lie.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta" data-said></span>
        ${(() => {
          const route = config.routeFor(c.key)
          if (!config.isConnected(c.state)) {
            if (route.how === 'oauth') {
              return `<a class="btn small primary" href="${esc(GOOGLE_START)}"
                        target="_blank" rel="noopener">${esc(route.label)}</a>`
            }
            if (route.how === 'tab') {
              return `<button class="btn small primary" data-goto-setting="${esc(route.to)}"
                        >${esc(route.label)}</button>`
            }
            if (route.how === 'mcp') {
              return `<button class="btn small primary" data-mcp-open>${esc(route.label)}</button>`
            }
            return `<span class="t-meta">${esc(route.why ?? route.label)}</span>`
          }
          if (route.how === 'mcp') {
            return `<button class="btn small quiet" data-mcp-open>${esc(route.label)}</button>`
          }
          /*
            Disconnect where a disconnect is real, Manage where it is not (#90).

            Driven by `route.off` rather than by the family, which is what made
            this Google-only: Notion and NotebookLM both have a credential in
            the vault and neither had a way out. A service with no `off` still
            says Manage, because a button that appeared to revoke a credential
            while revoking nothing is the failure this issue is about.

            `btn small quiet`, deliberately not a new class. During the port
            Disconnect rendered as a 110px empty box because `.mini` is a 78px
            preview thumbnail -- grep for a class name before inventing one.
          */
          if (route.off !== undefined && canWrite()) {
            return `<button class="btn small quiet" data-disconnect="${esc(route.off)}"
                      data-service="${esc(c.name)}">Disconnect</button>`
          }
          return route.how === 'tab'
            ? `<button class="btn small quiet" data-goto-setting="${esc(route.to)}"
                 >Manage</button>`
            : ''
        })()}
      </div>
    </article>`
  const list = config.services()
  /*
    Only what is actually wrong.

    `state !== 'ok'` counted `unchecked` and `attested` as problems and told
    Grant four of six services wanted looking at when none of them did. A
    dashboard that cries wolf on the summary line is one he stops reading before
    reaching the card that matters.
  */
  const bad = list.filter((c) => config.isWrong(c.state)).length
  return `<div class="setbody">
    <div class="tabhead">
      <p class="t-lead" style="margin:0">${list.length} services. ${
        bad === 0 ? 'All of them well.' : `${bad} want looking at.`}</p>
      <button class="btn" data-connect-open>+ Connect something</button>
    </div>
    <!--
      What the trip to Google said (0486).

      The consent flow ends on our own domain now, because the functions host
      flattens HTML to plain text and every page that function has produced has
      been a wall of raw markup. So the outcome arrives as a query parameter and
      is said HERE, once, above the cards.

      It is words and nothing else. Whether Google is actually connected is the
      card underneath, which reads connection health from the office.
    -->
    ${
      googleSaid === null
        ? ''
        : `<p class="saidback${googleSaid.tone === 'good' ? '' : ' warn'}">${esc(
            googleSaid.text,
          )}</p>`
    }
    <!--
      What the office is holding of his mail (number 172, ADR-0038).

      Grant authorised message bodies in writing and this is the disclosure
      that has to ship with the permission: one sentence, on the pane where he
      would go to disconnect Google, saying how many messages the office is
      currently holding the WORDS of rather than only the subject line.

      Three states and never a number for the first, because they are three
      different facts. Could not ask, holds nothing, holds some. A zero printed
      where the answer is unknown is the defect this whole block exists to
      avoid.

      No backticks in this comment. Template literal.
    -->
    ${(() => {
      const m = config.MAIL_BODIES
      if (m.held === null) {
        return `<p class="t-meta" data-mailheld>The office could not say how much of your
          mail it is holding.</p>`
      }
      if (m.held === 0) {
        return `<p class="t-meta" data-mailheld>Of ${m.messages} cached messages the office
          holds the words of <b>none</b> — only subject lines and previews.${
            m.bulk === 0 ? '' : ` ${m.bulk} withheld as bulk.`
          }</p>`
      }
      return `<p class="t-meta" data-mailheld>The office is holding the words of
        <b>${m.held}</b> of ${m.messages} cached messages, forgotten after 90 days.${
          m.bulk === 0 ? '' : ` ${m.bulk} withheld as bulk.`
        }</p>`
    })()}
    <!--
      The picker (#92).

      This button had no attribute and no handler at all — the front door to
      every integration in the product, completely inert, in two places.

      It lists only what the office can actually reach, and every row leads to
      a real flow or says plainly that there is not one. A picker offering a
      service that cannot be connected is the same defect one level up.

      No backticks in this comment. Template literal.
    -->
    <div class="connectpick" data-connect-menu hidden>
      <p class="t-lead" style="margin:0 0 var(--s3)">What would you like the office to
        reach? Each of these goes to the real thing.</p>
      <div class="pickgrid">
        ${list.map((c) => {
          const route = config.routeFor(c.key)
          const on = config.isConnected(c.state)
          const body = `<span class="pickname">${c.svg ? `<span class="mark">${c.svg}</span>` : ''}
              <b>${esc(c.name)}</b></span>
            <span class="t-meta">${esc(on ? config.STATE_LABEL[c.state] : (route.why ?? route.label))}</span>`
          if (on) return `<div class="pick done">${body}</div>`
          if (route.how === 'oauth') {
            return `<a class="pick" href="${esc(GOOGLE_START)}" target="_blank"
                      rel="noopener">${body}</a>`
          }
          if (route.how === 'tab') {
            return `<button class="pick" data-goto-setting="${esc(route.to)}">${body}</button>`
          }
          return `<div class="pick off">${body}</div>`
        }).join('')}
      </div>
    </div>
    <div class="servicegrid">${list.map(card).join('')}</div>

    <!--
      Your task list somewhere else (number 259, Phase 2).

      The office keeps Grant's personal tasks; a provider is a projection of
      them and never the list. So this is a small card rather than a service
      alongside Slack and Google: nothing here can stop the tasks working, and
      the copy says so where he can read it before connecting anything.

      The two fields are sorted BY SHAPE in the database, not by which box they
      arrived in. 0359 records the alternative: a live secret pasted into a
      plaintext setting and printed back onto this very page.

      No backticks in this comment. Template literal.
    -->
    ${(() => {
      const v = config.TASK_SYNC
      if (v.configured === null) {
        return `<section class="tsync" data-tsync>
          <h3 class="t-title">Your task list elsewhere</h3>
          <p class="t-meta">Asking the office…</p></section>`
      }
      if (v.configured === true) {
        return `<section class="tsync on" data-tsync>
          <h3 class="t-title">Your task list elsewhere</h3>
          <p class="t-lead" style="margin:0 0 var(--s3)">Kept in step with Vikunja at
            <b>${esc(String(v.url ?? ''))}</b>, project ${esc(String(v.project ?? ''))} —
            ${String(v.linked)} task${v.linked === 1 ? '' : 's'} mapped. Your tasks live here;
            that is a copy.</p>
          ${
            v.trouble.length === 0
              ? '<p class="t-meta">Nothing in disagreement.</p>'
              : `<ul class="ptasks">${v.trouble
                  .slice(0, 5)
                  .map(
                    (t) => `<li class="ptask"><div class="ptbody"><b>${esc(
                      String(t.title ?? ''),
                    )}</b><span class="t-meta">${esc(String(t.why ?? t.state ?? ''))}</span></div></li>`,
                  )
                  .join('')}</ul>`
          }
          <span class="t-meta" data-said></span>
          ${
            canWrite()
              ? '<button class="btn small quiet" data-vikunja-off>Disconnect</button>'
              : ''
          }
        </section>`
      }
      return `<section class="tsync" data-tsync>
        <h3 class="t-title">Your task list elsewhere</h3>
        <p class="t-lead" style="margin:0 0 var(--s3)">Your tasks work on their own. If you
          keep a Vikunja, the office can mirror them both ways — it stays a copy, and
          disconnecting it never loses anything.</p>
        ${
          canWrite()
            ? `<form class="myadd" data-vikunja-on data-saidwrap>
                 <input data-vikunja-url placeholder="https://tasks.example.com"
                        aria-label="The address of your Vikunja" required>
                 <input data-vikunja-project type="number" min="1" placeholder="Project"
                        aria-label="Which Vikunja project" required>
                 <input data-vikunja-token type="password" placeholder="API token"
                        aria-label="A Vikunja API token" required>
                 <button class="btn primary" type="submit">Connect</button>
                 <span class="t-meta" data-said></span>
               </form>`
            : '<p class="t-meta">Sign in to connect one.</p>'
        }
      </section>`
    })()}

    <!--
      Outside providers the office has registered (#265).

      The other direction from the MCP block below: that one is what connects
      TO this office, this is what the office connects to. The inventory was
      built, verified and never rendered, so a whole side of the integration
      was invisible — which is the failure this whole run is about.

      Three numbers per provider on purpose. A provider can advertise forty
      tools, the office can offer six, and NONE be usable until Grant
      approves: showing only what was offered would read as reach.

      No backticks in this comment: template literal.
    -->
    <section class="provsec">
      <h3 class="t-label">Providers the office uses</h3>
      ${(config.PROVIDERS?.rows ?? []).length === 0
        ? `<p class="t-meta">None registered. A provider is somewhere the office can
             discover capabilities from — discovering them grants nothing on its own.</p>`
        : `<div class="provgrid">${(config.PROVIDERS?.rows ?? []).map((p) => `
          <article class="prov ${p.last_probe_ok ? 'well' : 'unwell'}">
            <b>${esc(p.display_name || p.name || '')}</b>
            <span class="stage s-${p.last_probe_ok ? 'approved' : 'review'}">${
              p.last_probe_ok ? 'answering' : esc(p.last_probe_detail ?? 'not answering')
            }</span>
            <span class="t-meta">${esc(String(p.discovered ?? 0))} discovered ·
              ${esc(String(p.offered ?? 0))} offered ·
              <b>${esc(String(p.usable ?? 0))} usable</b></span>
            ${((p.tools ?? []).length === 0)
              ? ''
              : `<ul class="provtools">${(p.tools ?? []).slice(0, 4).map((t) => `<li>
                  <code>${esc(t.name ?? '')}</code>
                  <span class="reach r-${esc(t.reach ?? 'unknown')}">${esc(t.reach ?? 'unknown')}</span>
                  <span class="t-meta">${
                    t.gone ? 'gone from the provider'
                      : t.usable ? 'granted'
                      : t.offered_as ? 'offered, waiting on you'
                      : 'not offered'
                  }</span>
                  <!--
                    Offering is not granting, and the wording has to keep them
                    apart: this puts the tool in front of Grant as a request he
                    can approve on the Governance page. ADR-0018 is the whole
                    reason the two are separate verbs.
                  -->
                  ${t.gone || t.offered_as || !canWrite() ? '' :
                    `<button class="btn quiet" data-offer-tool="${esc(t.id ?? '')}"
                       data-offer-name="${esc(t.name ?? '')}">Offer it</button>`}
                </li>`).join('')}</ul>`}
            ${!canWrite() ? '' :
              `<button class="btn quiet" data-revoke-provider="${esc(p.id ?? '')}"
                 data-provider-name="${esc(p.display_name || p.name || '')}">Stop using this
               </button>`}
          </article>`).join('')}</div>`}
      <!--
        Registering one, which until now needed SQL (#265, #276).

        Name and endpoint only. A provider that needs a token is NOT
        registerable from here and the note says so plainly rather than
        offering a box that would put a credential in a plaintext form field —
        0359's lesson, and the reason register_mcp_provider takes a vault
        reference rather than a secret.

        Registering discovers nothing and grants nothing. The office probes
        the endpoint, lists what it advertises, and every tool still has to be
        offered and then approved.
      -->
      ${!canWrite() ? '' : `<div class="provadd">
        <span class="t-label">Add a provider</span>
        <p class="t-meta">The office will ask it what it can do. Nothing is granted by
          asking. A provider that needs a token has to be connected another way —
          this form has no box for one on purpose.</p>
        <div class="provfields">
          <!--
            provin, not in. A class called just in is styled nowhere in this
            stylesheet — the icon search measured 13.3px on its first capture
            for exactly that reason, and anything under 16px makes iOS Safari
            zoom the page on focus.
          -->
          <input class="provin" data-prov-name aria-label="Provider short name"
            placeholder="short name, e.g. weather-mcp" />
          <input class="provin" data-prov-endpoint aria-label="Provider endpoint"
            placeholder="https://…/mcp" />
          <button class="btn" data-register-provider>Add it</button>
        </div>
        <span class="t-meta" data-said></span>
      </div>`}
    </section>
    <!--
      How to connect a client to this office (#91).

      Below the grid rather than inside a card, for the reason the channel
      detail learned: expanding in place stretches the grid row and turns the
      neighbours into tall empty boxes.

      The token is not here. Not truncated, not fingerprinted, not present at
      all - the RPC never selects token_sha256. This tab gets captured by
      npm run shots and attached to a build step on a public page, and the
      procedure for getting the token is the thing that belongs on screen.

      No backticks in this comment. Template literal.
    -->
    ${!state.mcp ? '' : `<div class="chdetail">
      <h3 class="t-title" style="margin:0;font-size:19px">Connecting a client</h3>
      ${!config.MCP.loaded
        ? '<p class="t-meta">Asking the office…</p>'
        : `<p class="t-label">Server URL</p>
           <code class="mcpurl">${esc(config.MCP.url)}</code>
           <ol class="mcpsteps">${config.MCP.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
           <div>
             <span class="t-label">Tools a client would see (${
               config.MCP.tools.filter((t) => t.on).length} of ${config.MCP.tools.length})</span>
             <div class="chwho">${config.MCP.tools.map((t) => `<span class="chbot ${t.on ? '' : 'off'}"
               title="${esc(t.why_off ?? t.what ?? '')}">
               <b>${esc(t.tool)}</b>
               <span class="t-meta">${esc(t.on ? (t.what ?? '') : (t.why_off ?? 'switched off'))}</span>
             </span>`).join('')}</div>
           </div>
           ${config.MCP.clients.length === 0 ? '' : `<div>
             <span class="t-label">Clients that have connected</span>
             <div class="chwho">${config.MCP.clients.slice(0, 8).map((c) => `<span class="chbot ${c.on ? '' : 'off'}">
               <b>${esc(c.name ?? 'unnamed')}</b>
               <span class="t-meta">${esc(String(c.calls ?? 0))} calls${c.last ? ` · ${esc(c.last)}` : ''}</span>
             </span>`).join('')}</div>
           </div>`}`}
    </div>`}
  </div>`
}

/** Channels — which surface reaches Grant, and when. */
/*
  The conversation's own surfaces, and what state each is in (#198).

  Above the connector grid rather than inside it, because they answer different
  questions. The grid says "is this credential alive"; this says "can Grant
  have a conversation there, and is anything wrong with it right now" — which
  needs the credential AND the traffic AND the last day of delivery failures
  together, and no one of those can answer it.

  Five states, each with its own sentence from the office rather than a word
  the page dresses up. #198 asks for never-connected to read as an INVITATION
  and not an error, and that difference is entirely the wording — so the
  wording is the RPC's, in one place, and this draws it.
*/
function conversationStates() {
  const rows = config.CONVO_CHANNELS
  if (!Array.isArray(rows) || rows.length === 0) return ''
  /*
    Named `lastSeen`, not `when` — a local `const when` shadows the module
    namespace imported at the top of this file, so `when.words(iso)` inside it
    resolves to the arrow function's own binding and throws "when.words is not
    a function". The throw happens while `settingsSheet` is building its
    template, BEFORE `innerHTML` is assigned, so the old pane stays on screen
    and the symptom is "the Channels tab does nothing" — four steps from the
    cause, and invisible until the page errors were printed.
  */
  const lastSeen = (iso) =>
    iso === null || iso === undefined ? 'never' : when.words(iso)
  return `<section class="convstates">
    <h3 class="t-label">The conversation</h3>
    <ul class="convlist">
      ${rows.map((c) => `<li class="conv c-${esc(String(c.state))}">
        <span class="convdot" aria-hidden="true"></span>
        <div class="convbody">
          <b>${esc(String(c.label))}</b>
          <span class="t-meta">${esc(String(c.says))}</span>
          <span class="t-meta from">
            ${c.messages > 0
              ? `${esc(String(c.messages))} message${c.messages === 1 ? '' : 's'}, last ${esc(lastSeen(c.last_at))}`
              : 'nothing yet'}${c.recent_failures > 0
              ? ` · ${esc(String(c.recent_failures))} could not be delivered today`
              : ''}
          </span>
        </div>
        <!--
          The state as a WORD as well as a colour. A dot alone is the
          conveyed-by-colour-only failure axe exists to catch, and it is also
          simply harder to read. No backticks in this comment.
        -->
        <span class="t-label convword">${esc(CONVO_WORD[String(c.state)] ?? String(c.state))}</span>
      </li>`).join('')}
    </ul>
  </section>`
}

/*
  The state names a person sees. Kept beside the renderer rather than in the
  RPC because these are labels and the RPC's `says` is the sentence — two
  registers for two jobs, and putting the label in SQL would mean a migration
  to reword a chip.
*/
const CONVO_WORD = {
  here: 'You are here',
  carrying: 'Carrying',
  quiet: 'Ready',
  degraded: 'Struggling',
  disconnected: 'Disconnected',
  never: 'Not connected',
  unchecked: 'Unverified',
}

function channelsTab() {
  return `<div class="setbody">
    <p class="t-lead" style="margin:0">How the office reaches you. Only the Chief of
      Staff sends; everyone else still does the work.</p>
    ${conversationStates()}
    <div class="servicegrid">
      ${config.CHANNELS.map((c) => {
        const m = MARKS[c.key] ?? { svg: '', tint: 'currentColor' }
        return `<article class="service s-${c.state}" data-lift data-tilt="3.4"
                 style="--tint:${esc(m.tint)}">
          <span class="mark">${m.svg}</span>
          <div class="svbody">
            <b>${esc(c.name)}</b>
            <span class="t-meta">${esc(c.role)}</span>
            <!--
          Capped. connection_health.detail is a short state note for most
          services and four hundred characters of token scoping for GitHub, and
          one card four times the height of its neighbours is the grid falling
          over. The whole note is still in the database for whoever needs it.

          No backticks in this comment. Template literal.
        -->
        <span class="t-meta from">${esc(
          String(c.detail ?? '').length > 110
            ? `${String(c.detail).slice(0, 108).replace(/[\s,;.]+\S*$/, '')}…`
            : (c.detail ?? ''),
        )}</span>
          </div>
          <div class="svfoot">
            <span class="dotstate"></span>
            <span class="t-label">${esc(config.STATE_LABEL[c.state])}</span>
            <button class="btn small quiet" data-channel="${esc(c.key)}">${
              state.channel === c.key ? 'Close' : 'How it works'}</button>
          </div>
        </article>`
      }).join('')}
    </div>
    <!--
      What the open channel actually is (#93).

      BELOW the grid, not inside the card. Expanding it in place stretched the
      whole grid row, so the other three cards became tall empty boxes with a
      logo floating at the top - visible immediately in a capture and invisible
      in the source.

      Everything here comes from the office rather than from this file: the
      bots and whose they are, the settings that govern the channel, and what
      to actually do, spelled out.

      The two Telegram settings sit side by side deliberately. They are
      confused constantly - one decides WHO SENDS AT ALL, the other decides
      WHICH CHAT - and putting them next to each other with both said plainly
      is the cheapest fix available for that.

      No backticks in this comment. Template literal.
    -->
    ${(() => {
      const c = config.CHANNELS.find((x) => x.key === state.channel)
      if (c === undefined) return ''
      return `<div class="chdetail">
        <h3 class="t-title" style="margin:0;font-size:19px">${esc(c.name)}</h3>
        ${c.steps ? `<p class="t-lead" style="margin:0">${esc(c.steps)}</p>` : ''}
        ${(c.settings ?? []).length === 0 ? '' : `<div class="chset">
          ${c.settings.map((x) => `<div class="chrow">
            <span class="chname">${esc(x.name)}</span>
            <span class="chval">${x.kind === 'switch'
              ? (x.value ? 'On' : 'Off')
              : esc(String(x.value === '' ? 'anyone' : x.value))}</span>
            <span class="t-meta">${esc(x.note ?? '')}</span>
          </div>`).join('')}
        </div>`}
        ${(c.who ?? []).length === 0 ? '' : `<div>
          <span class="t-label">Bots</span>
          <div class="chwho">
            ${c.who.map((w) => `<span class="chbot ${w.on ? '' : 'off'}">
              <b>@${esc(w.username)}</b>
              <span class="t-meta">${esc(w.whose)}${w.pager ? ' · pager' : ''}</span>
            </span>`).join('')}
          </div>
        </div>`}
      </div>`
    })()}
  </div>`
}

/*
  Models and cost.

  The £0/month constraint is a hard one, so it is a live number rather than a
  note in a document. The warning is the useful part: the free tier has an edge
  and the only bad way to find it is an invoice.
*/


/*
  Appearance — one of six tabs now, not the whole of Settings.

  Its contents are unchanged. The swatches were always the right idea: nobody
  knows what "Clay" looks like from the word, and each one paints itself from
  its own palette's tokens so a new palette needs no code here.
*/
function appearanceTab() {
  const now = appearance()
  return `<div class="setbody">
      <p class="t-lead" style="margin:0 0 var(--s4)">Changes apply straight away and are
        remembered on this device.</p>

      <!--
        Light and dark (#87).

        The shortcut in the project header sets the same value this does, and
        both read it back from the same place, so the two can never disagree —
        which was the thing most likely to go wrong here: one control that works
        and one that lies.

        Three choices, not a switch. Following the system is the default and the
        honest answer for most people; a boolean forces a side and then the
        studio is the one application on the machine that does not go dark at
        sunset with everything else.
      -->
      <div class="setgroup">
        <span class="t-label">Light and dark</span>
        <div class="segmented" role="group" aria-label="Light and dark">
          ${SCHEMES.map((x) => `
            <button class="seg ${now.scheme === x.id ? 'on' : ''}" data-scheme-pick="${x.id}"
                    aria-pressed="${now.scheme === x.id}">${esc(x.name)}</button>`).join('')}
        </div>
      </div>

      <!--
        Density (#124).

        Grant, in the review: "Improve space usage throughout - less
        decoration, less clutter." A control rather than a guess, because
        picking a tighter rhythm and hoping is how that request gets answered
        once and re-litigated a month later.

        Beside Light and dark because it is the same kind of choice about the
        same thing, and in the same segmented shape #87 established, so there
        is one way to pick between a small number of options rather than two.

        The note under each is what it DOES, not what it is called. "Compact"
        alone asks him to press it to find out.

        No backticks in this comment: template literal.
      -->
      <div class="setgroup">
        <span class="t-label">Density</span>
        <div class="segmented" role="group" aria-label="Density">
          ${DENSITIES.map((d) => `
            <button class="seg ${now.density === d.id ? 'on' : ''}" data-density-pick="${d.id}"
                    aria-pressed="${now.density === d.id}"
                    title="${esc(d.note)}">${esc(d.name)}</button>`).join('')}
        </div>
        <p class="t-meta" style="margin:0">${esc(
          (DENSITIES.find((d) => d.id === now.density) ?? DENSITIES[0]).note,
        )}</p>
      </div>

      <div class="setgroup">
        <span class="t-label">Palette</span>
        <div class="swatches">
          ${PALETTES.map((p) => `
            <button class="swatch ${now.palette === p.id ? 'on' : ''}"
                    data-palette-pick="${p.id}" data-palette="${p.id}">
              <!--
                A miniature of the actual interface, not three colour bars.
                Grant: *"your sample palettes and textures don't look like
                anything"* — and he was right: three chips tell you the hues
                exist, not what living in them is like. This is a ground, a
                card on it, two lines of type and the accent, at 1/8 scale.
              -->
              <span class="mini">
                <span class="mini-card">
                  <span class="mini-art"></span>
                  <span class="mini-l1"></span>
                  <span class="mini-l2"></span>
                </span>
                <span class="mini-btn"></span>
              </span>
              <b>${esc(p.name)}</b>
              <span class="t-meta">${esc(p.note)}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="setgroup">
        <span class="t-label">Texture</span>
        <div class="swatches">
          ${TEXTURES.map((t) => `
            <button class="swatch ${now.texture === t.id ? 'on' : ''}"
                    data-texture-pick="${t.id}">
              <span class="texpreview" data-texture="${t.id}"><i></i></span>
              <b>${esc(t.name)}</b>
              <span class="t-meta">${esc(t.note)}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="setgroup">
        <span class="t-label">Your own texture</span>
        <div class="ownrow">
          ${now.own ? `<button class="swatch ${now.texture === 'own' ? 'on' : ''}"
              data-texture-pick="own" style="max-width:180px">
              <span class="texpreview" style="background-image:url('${now.own}');
                    background-size:cover"></span>
              <b>${esc(now.ownName || 'Uploaded')}</b>
              <span class="t-meta">Yours</span>
            </button>` : ''}
          <label class="dropzone">
            <input type="file" accept="image/*" data-texture-file hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
              <path d="M12 16V4M12 4L7 9M12 4l5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
            <span><b>Upload a texture</b>
              <span class="t-meta">Any image. It is shrunk and stored on this device.</span></span>
          </label>
          ${now.own ? '<button class="link add" data-texture-clear>Remove</button>' : ''}
        </div>
        <p class="t-meta" id="texerr" hidden></p>
      </div>

    </div>`
}


/*
  Settings, as a place rather than a sheet.

  Grant: *"I want to see these things properly arranged in a logical way. So
  like one tab for the bot management where you add and remove bots
  dynamically... where you can see all the various services that we're
  connected to. And I want to see it, you know, like the proper logos."*

  Six tabs in the order you need them: who is on the team, how much they do
  without asking, what they are plugged into, how they reach you, what it
  costs, and how it looks.
*/
/**
 * IMPORT TO PROJECT — the step, in a sheet (#28).
 *
 * Four fields, all optional, and each one is a thing that can only sensibly be
 * chosen NOW: a collection, some tags, the task it belongs to, and the source
 * it came out of. Once the document is in the gallery among eighty others,
 * nobody goes back and files it.
 *
 * Provenance is deliberately absent from the form. `import_output` takes it
 * from the output itself — the job and the author — so there is nothing here to
 * fill in wrongly, and #28 asks for it to be *"carried automatically and not
 * removable"*. It is shown, as a line of prose, so Grant can see what will be
 * recorded.
 *
 * Uses the viewer element rather than a third overlay: `sheet()` already
 * handles Escape, the backdrop, focus and the shell blur, and CLAUDE.md records
 * that five copies of that behaviour drift the first time one changes.
 */
function importSheet(p) {
  const v = $("#viewer")
  if (v === null || state.importing === null || state.importing === undefined) return
  const it = state.importing
  const tasks = (p.tasks ?? []).filter((t) => t.state !== 'done')
  const sources = (p.sources ?? []).filter((x) => x.id)
  const collections = [...new Set((p.documents ?? []).flatMap((d) => d.collections ?? []))]

  /*
    `.sheet`, which is the class that IS the frame.

    The first draft wrote `.sheetin`, which does not exist anywhere in the
    stylesheet — so the sheet had no surface, no border, no padding and no
    max-height: the header rendered its own white block and the four fields and
    both buttons sat loose on the page behind it, half outside the card.

    Nothing failed. `smoke`, `check:templates` and `verify:wired` were all green
    — a class that does not exist is not a syntax error, and no check reads the
    stylesheet. Found by opening the PNG, which is what §14A's loop is for.

    `.sheethead` below has negative margins sized to `.sheet`'s padding, so the
    two only work together.
  */
  v.innerHTML = `<div class="sheet importsheet" role="dialog" aria-modal="true"
       aria-label="Import to project">
    <!--
      The artefact, then where it is going. A form is what this IS; a transfer
      is what it MEANS, and the page glyph plus the arrow says the second in the
      space the first was using anyway.

      The close control is the one the sheet header already has, not a bare
      icon button: that header is a flex row and its existing close class
      already undoes the floating version's positioning. Inventing a second
      one put the X hard against the title instead of at the right edge.

      No backticks in this comment: template literal.
    -->
    <header class="sheethead">
      <span class="ipage">${pageSvg(it.title, 'made')}</span>
      <div style="flex:1 1 auto;min-width:0">
        <span class="t-label">Import to project</span>
        <h2 style="margin:2px 0 0">${esc(it.title)}</h2>
        <span class="t-meta">Into ${esc(p.name)}</span>
      </div>
      <button class="close inhead" data-import-close aria-label="Close">✕</button>
    </header>

    <label class="ifield">
      <span class="t-label">Collection</span>
      <input data-import-collection list="import-collections" placeholder="Research, Planning, Reference…"
             aria-label="Which collection this belongs in">
      <datalist id="import-collections">
        ${collections.map((c) => `<option value="${esc(c)}"></option>`).join('')}
      </datalist>
      <span class="t-meta">A new name makes a new collection.</span>
    </label>

    <label class="ifield">
      <span class="t-label">Tags</span>
      <input data-import-tags placeholder="pricing, q4, competitor"
             aria-label="Tags, separated by commas">
      <span class="t-meta">Comma separated. Lower case, so filtering works.</span>
    </label>

    <label class="ifield">
      <span class="t-label">Related task</span>
      <select data-import-task aria-label="The task this belongs to">
        <option value="">— none —</option>
        ${tasks.map((t) => `<option value="${esc(t.id ?? '')}">${esc(t.title)}</option>`).join('')}
      </select>
    </label>

    <label class="ifield">
      <span class="t-label">Came from</span>
      <select data-import-source aria-label="The source this came out of">
        <option value="">— none —</option>
        ${sources.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}
      </select>
    </label>

    <!--
      Shown, not asked. The office takes the job and the author off the output
      itself, so there is nothing here to get wrong, and #28 wants provenance
      unremovable rather than editable.

      No backticks in this comment: template literal.
    -->
    <p class="t-meta iprov">Who wrote it and which job it came from are recorded
      automatically, and cannot be edited afterwards.</p>

    <div class="ifoot" data-saidwrap>
      <span class="t-meta" data-said></span>
      <button class="btn" data-import-close>Cancel</button>
      <button class="btn primary" data-import-go="${esc(it.output)}">Import</button>
    </div>
  </div>
  <div class="sheetfade" aria-hidden="true"></div>`

  // Two of them — the header X and the Cancel button — so this is a loop, not
  // a `?.` on the first one.
  for (const b of v.querySelectorAll("[data-import-close]")) {
    b.addEventListener("click", () => {
      state.importing = null
      sheet(v, false)
    })
  }

  $("[data-import-go]", v)?.addEventListener("click", async (e) => {
    const b = e.currentTarget
    const tags = String($("[data-import-tags]", v)?.value ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t !== "")
    const done = await attempt(
      b,
      "Importing…",
      () =>
        act("output_import", {
          p_output: b.dataset.importGo,
          p_collection: String($("[data-import-collection]", v)?.value ?? "").trim() || null,
          // An empty array and null are different to the RPC: null LEAVES the
          // tags alone, an empty array replaces them with nothing. A new
          // document has none either way, so null is the honest one.
          p_tags: tags.length > 0 ? tags : null,
          p_related_task: $("[data-import-task]", v)?.value || null,
          p_related_source: $("[data-import-source]", v)?.value || null,
        }),
      (r) => `In the project${r?.collection ? ` under ${String(r.collection)}` : ""}.`,
    )
    if (done) {
      state.importing = null
      sheet(v, false)
      await refresh()
    }
  })

  sheet(v, true)
}

function settingsSheet() {
  const v = $('#settings')
  const body =
    state.setting === 'behaviour' ? behaviourTab()
    : state.setting === 'governance' ? governanceTab()
    : state.setting === 'connections' ? connectionsTab()
    : state.setting === 'channels' ? channelsTab()
    : state.setting === 'models' ? usageTab()
    : state.setting === 'appearance' ? appearanceTab()
    : state.setting === 'setup' ? setupTab()
    : state.setting === 'help' ? helpTab()
    : teamTabSettings()

  /*
    The close button lives in the dialog's own header (#88).

    Grant: *"Put the X in the top-right corner of the dialog's outer header,
    outside the content area."* It was a sibling of the sheet, positioned
    against the backdrop — so it floated in the corner of the SCREEN, detached
    from the thing it closes, and on a narrow window it was nowhere near it.

    The header is `position: sticky` inside the scrolling sheet rather than
    `position: fixed`. Fixed would have been wrong twice over: the sheet is the
    scroll container, and a fixed child of anything carrying backdrop-filter,
    filter, transform, perspective or will-change anchors to that element
    instead of the viewport — which is how a bottom navigation bar once
    rendered across the top of the page.
  */
  v.innerHTML = `<div class="sheet wide settings" data-more>
    <div class="chead sheethead">
      <span style="flex:1;min-width:0">
        <!--
          Named by scope (#158).

          Grant: *"There are effectively two kinds of settings, but the current
          interface does not communicate this clearly. Separate them explicitly
          into Global Settings and Project Settings... Do not make users guess
          which scope they are editing."*

          It said "The office", which is warm and says nothing about scope. The
          project's own settings are two rows away in the rail under the other
          name, so the two now differ by the only word that matters.
        -->
        <h1 class="t-display" style="margin:0;font-size:clamp(24px,2vw + 14px,32px)">Global settings</h1>
        <p class="t-lead" style="margin:6px 0 0">Everything about how this place runs,
          and what it is plugged into. For one project's own, open the project and
          choose Project Settings.</p>
      </span>
      <button class="close inhead" aria-label="Close settings and go back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="settabs" role="tablist" aria-label="Settings">
      ${config.TABS.map((t) => `<button role="tab" class="settab ${
        state.setting === t.id ? 'on' : ''
      }" aria-selected="${state.setting === t.id}" data-setting="${t.id}">${esc(t.name)}</button>`).join('')}
    </div>
    ${body}
    <!--
      A sheet taller than the screen has to LOOK like it is.

      Chromium paints an OVERLAY scrollbar on a touch device — zero reserved
      width, invisible until you are already scrolling — so a settings tab with
      two thousand pixels below the fold simply ended, mid-section, and read as
      a rendering fault rather than as more to come. That is #108 wearing a
      different hat, and it is the same defect that once left Save nowhere on
      the phone task editor.

      Sticky rather than absolute, and a real element rather than a pseudo: the
      sheet is the scroll container, so an absolutely positioned fade scrolls
      away with the content, and a fixed one would anchor to the sheet only
      because it carries backdrop-filter, which is a coincidence to rely on.
      Sticky needs no JavaScript and no class to toggle — with nothing below it
      the fade sits on the sheet's own surface and cannot be seen, which is
      exactly when there is nothing to announce.

      No backticks in this comment: template literal.
    -->
    <div class="sheetfade" aria-hidden="true"></div>
  </div>`

  for (const b of v.querySelectorAll('[data-setting]')) {
    b.addEventListener('click', async () => {
      state.setting = b.dataset.setting
      settingsSheet()
      sheet(v, true)
      /*
        Governance is fetched the first time it is opened (#54).

        Lazy, like the MCP view: four tables nobody else on a settings open
        touches. Drawn once with its waiting line, then again with the answer,
        so the tab responds immediately rather than appearing to hang.
      */
      if (state.setting === 'governance' && !config.GOVERNANCE.loaded) {
        await config.hydrateGovernance(read)
        /*
          Only if the sheet is still open on the same tab.

          Without this guard the redraw runs whenever the fetch lands, which
          may be after the person has moved to another tab or closed the sheet
          — and `sheet(v, true)` REOPENS it. A capture run walked six tabs,
          closed the settings viewer, and had it reappear over the page three
          seconds later; every click after that hit the backdrop.
        */
        if (state.setting === 'governance' && !v.hidden) {
          settingsSheet()
          sheet(v, true)
        }
      }
      /*
        The same lazy pattern for outside providers (#265).

        Connections draws immediately from what the page already holds; the
        provider inventory is one more table and is fetched only when somebody
        opens the tab. The same guard applies — a redraw landing after the
        person has moved on reopens a sheet they closed.
      */
      if (state.setting === 'connections' && !config.PROVIDERS.loaded) {
        await config.hydrateProviders(read)
        if (state.setting === 'connections' && !v.hidden) {
          settingsSheet()
          sheet(v, true)
        }
      }
    })
  }
  /*
    Take me to where that is set up (#89, #92).

    The same navigation as the tab strip, but from a card. The point of it is
    that a person pressing Connect on the Notion card should not then have to
    know that Notion's token lives in "Setting up" — §31 again.
  */
  /* Open and close the picker. */
  const pickMenu = $('[data-connect-menu]', v)
  $('[data-connect-open]', v)?.addEventListener('click', (e) => {
    e.stopPropagation()
    if (pickMenu) pickMenu.hidden = !pickMenu.hidden
  })
  /*
    Open one channel's detail, and close it again (#93).

    `settingsSheet()` rather than `render()`: the sheet is outside `#root` and
    the page behind it does not change. One at a time — four expanded cards is
    a page nobody reads.
  */
  /*
    Open the MCP view, fetching it the first time (#91).

    Lazy, like `lately`: it reads three tables nobody else touches and most
    settings visits never open it. The panel says "asking the office" until it
    arrives rather than appearing empty.
  */
  for (const b of v.querySelectorAll('[data-mcp-open]')) {
    b.addEventListener('click', async () => {
      state.mcp = !state.mcp
      settingsSheet()
      sheet(v, true)
      if (state.mcp && !config.MCP.loaded) {
        await config.hydrateMcp(read)
        settingsSheet()
        sheet(v, true)
      }
    })
  }

  for (const b of v.querySelectorAll('[data-channel]')) {
    b.addEventListener('click', () => {
      state.channel = state.channel === b.dataset.channel ? null : b.dataset.channel
      settingsSheet()
      sheet(v, true)
    })
  }

  for (const b of v.querySelectorAll('[data-goto-setting]')) {
    b.addEventListener('click', () => {
      state.setting = b.dataset.gotoSetting
      settingsSheet()
      sheet(v, true)
    })
  }
  for (const el of v.querySelectorAll('[data-lift]')) {
    tiltable(el, { max: Number(el.dataset.tilt ?? 3), scale: 1.006 })
  }

  /*
    Behaviour, for real (#68).

    Three different RPCs behind three switches that look identical, which is
    why each row carries `via` rather than the page holding a lookup: autonomy
    is `hq_autonomy_set`, the chief switch is `hq_routing_set` (its own RPC,
    because turning it off means eight bots may message Grant), and the rest are
    `hq_set_setting` against its allow-list. A page that decides which one to
    call is a second place the routing lives.
  */
  const afterWrite = async () => {
    await config.hydrateSettings(read)
    settingsSheet()
    sheet(v, true)
  }

  /*
    Redraw the governance tab from the office, not from the page's guess.

    Its own refresher rather than `afterWrite`: `hydrateSettings` does not
    fetch this section, and a retraction that only disappeared from the DOM
    would look identical to one the database refused.
  */
  const afterGovernance = async () => {
    await config.hydrateGovernance(read)
    settingsSheet()
    sheet(v, true)
  }

  const applyBehaviour = async (el, via, value) => {
    const [kind, name] = String(via ?? '').split(':')
    const done = await attempt(el, 'Saving…', () => {
      if (kind === 'autonomy') return act('autonomy_set', { p_level: value })
      if (kind === 'routing') return act('routing_set', { p_what: name, p_value: value })
      if (kind === 'setting') return act('set_setting', { p_key: name, p_value: value })
      throw new Error('nothing behind that control yet')
    })
    if (done !== null) await afterWrite()
  }

  for (const b of v.querySelectorAll('[data-toggle]')) {
    b.addEventListener('click', () => {
      // The value it will become, not the one it shows.
      applyBehaviour(b, b.dataset.via, b.dataset.now === '1' ? 'false' : 'true')
    })
  }

  /*
    Taking back a standing authorization (#15).

    No confirmation. Revoking NARROWS what the office may do on its own, and
    the control immediately above it uses exactly that rule: nobody regrets
    being asked more often, and confirming a narrowing is how a confirmation
    becomes noise.

    No reason is asked for either, unlike declining a tool request — a decline
    is durable and shapes what an agent may ask for next, where this is simply
    switching an exception off, and `revoke_standing` supplies "you took it
    back" rather than storing an empty string.
  */
  for (const b of v.querySelectorAll('[data-unstand]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Saving…',
        () => act('revoke_standing', { p_authorization: b.dataset.unstand }),
        'It will ask you again.',
      )
      if (done !== null) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-choose]')) {
    b.addEventListener('click', () => {
      const chosen = String(b.dataset.choose).split(':')[1]
      /*
        Confirmed when it widens what the office may do on its own.

        Narrowing needs no confirmation — nobody regrets being asked more often
        — and treating both the same is how a confirmation becomes noise.
      */
      const widening = chosen !== 'suggest'
      if (
        widening &&
        !sure(
          'Let the team act without asking first? Consequential actions still ' +
            'wait for you, and you can put this back at any time.',
        )
      ) {
        return
      }
      applyBehaviour(b, b.dataset.via, chosen)
    })
  }

  /*
    The team, editable (#68).

    Five actions behind one card: edit the person, grant a tool, assign a bot,
    retire a procedure, retire the person. Each is a separate RPC because each
    is a separate kind of change — 0119's argument that a text field and a
    foreign key must not share a mechanism, applied to the interface.
  */
  /*
    Bringing someone in (#105, migrations 0233 to 0235).

    `afterWrite()` rather than a local splice, like every other write in this
    file: the roster the page shows comes from the office, and a page that
    edits its own copy is a page that disagrees with the database the moment
    anything else writes.
  */
  const hireForm = $('[data-hire-form]', v)
  $('[data-hire]', v)?.addEventListener('click', () => {
    if (hireForm) hireForm.hidden = !hireForm.hidden
    $('[data-hire-name]', v)?.focus()
  })
  $('[data-hire-cancel]', v)?.addEventListener('click', () => {
    if (hireForm) hireForm.hidden = true
  })
  $('[data-hire-go]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const name = String($('[data-hire-name]', v)?.value ?? '').trim()
    const title = String($('[data-hire-title]', v)?.value ?? '').trim()
    const why = String($('[data-hire-why]', v)?.value ?? '').trim()
    const until = String($('[data-hire-until]', v)?.value ?? '').trim()
    /*
      Said here rather than sent and refused.

      The RPC checks all of these and returns a sentence, so this could just
      post and show the answer. It does not, because a round trip to be told
      the name box is empty is a round trip nobody needed, and the message
      reads better attached to the press than arriving after it.
    */
    if (name === '' || title === '') {
      say(b, 'A name, and what they are here to do.', 'warn')
      return
    }
    if (why === '') {
      say(b, 'Say why. A hire with no reason is how a team grows without anyone deciding to.', 'warn')
      return
    }
    /*
      Thirty, because `staff_temporary_is_justified` says thirty. Mirrored so
      the form fails once instead of twice, and the count is in the message
      because "say more" without saying how much more is a field edited blind.
    */
    if (why.length < 30) {
      say(b, `${why.length} characters — a temporary hire needs at least 30.`, 'warn')
      return
    }
    if (until === '') {
      say(b, 'Say when they go.', 'warn')
      return
    }
    const done = await attempt(
      b,
      'Bringing them in…',
      () => act('staff_hire', {
        p_name: name,
        p_title: title,
        p_justification: why,
        // End of that day rather than its first instant: a date input gives
        // midnight, and "until the 20th" means through the 20th.
        p_expires_at: new Date(`${until}T23:59:59`).toISOString(),
      }),
      `${name} is on the team until ${until}.`,
    )
    if (done) {
      if (hireForm) hireForm.hidden = true
      await afterWrite()
    }
  })

  for (const b of v.querySelectorAll('[data-configure]')) {
    b.addEventListener('click', () => {
      state.person = b.dataset.configure
      settingsSheet()
      sheet(v, true)
    })
  }
  for (const b of v.querySelectorAll('[data-close-person]')) {
    b.addEventListener('click', () => {
      state.person = null
      settingsSheet()
      sheet(v, true)
    })
  }

  for (const b of v.querySelectorAll('[data-save-person]')) {
    b.addEventListener('click', async () => {
      const card = b.closest('.staffcard')
      const field = (name) => card?.querySelector(`[data-f="${name}"]`)?.value ?? ''
      const done = await attempt(
        b,
        'Saving…',
        () =>
          act('staff_update', {
            p_slug: b.dataset.savePerson,
            p_name: field('p_name'),
            p_title: field('p_title'),
            p_remit: field('p_remit'),
            p_style: field('p_style'),
            /*
              An empty box means no skills, and that is a real instruction.

              Splitting on comma and dropping the blanks rather than sending the
              raw string: the RPC takes an array, and "pricing, , charge" with an
              empty element is a routing word that matches everything.
            */
            p_skills: field('p_skills')
              .split(',')
              .map((x) => x.trim())
              .filter((x) => x !== ''),
          }),
        (r) => {
          const lost = Number(r?.skills_removed ?? 0)
          return lost > 0
            ? `Saved — ${lost} skill${lost === 1 ? '' : 's'} removed.`
            : 'Saved.'
        },
      )
      if (done) await afterWrite()
    })
  }

  for (const box of v.querySelectorAll('[data-grant]')) {
    box.addEventListener('change', async () => {
      /*
        Optimistic and then corrected, rather than optimistic and hoped for.

        The RPC refuses a grant for a globally disabled tool, and a checkbox left
        ticked after a refusal is a lie about what somebody can do.
      */
      const done = await attempt(box, 'Saving…', () =>
        act('staff_tool_set', {
          p_slug: box.dataset.who,
          p_tool: box.dataset.grant,
          p_granted: box.checked,
        }),
      )
      if (done === null) box.checked = !box.checked
      else await afterWrite()
    })
  }

  for (const sel of v.querySelectorAll('[data-bot]')) {
    // What it held, so a change knows which bot to hand back.
    sel.dataset.was = sel.value
    sel.addEventListener('change', async () => {
      const done = await attempt(sel, 'Saving…', async () => {
        /*
          Free the previous bot first.

          The RPC refuses to give a person a second bot — one each, so "who is
          this from" always has an answer — and a bot cannot be deleted and a
          username is claimed for ever, so firing must hand it back rather than
          consume it.
        */
        if (sel.dataset.was) await act('bot_assign', { p_username: sel.dataset.was, p_staff_slug: null })
        if (sel.value) await act('bot_assign', { p_username: sel.value, p_staff_slug: sel.dataset.bot })
        return { ok: true }
      })
      if (done) await afterWrite()
    })
  }

  /*
    Retracting a lesson (#54).

    `lessons` is append-only (§6), so this writes a retraction row that
    supersedes it — nothing is deleted and the trail stays readable. The
    confirmation says that, because "retract" sounds like "delete" and a person
    who thinks they are destroying history will not press it when they should.
  */
  for (const b of v.querySelectorAll('[data-retract]')) {
    b.addEventListener('click', async () => {
      if (
        !sure(
          'Retract this lesson? The team stops being shown it. Nothing is ' +
            'deleted — a retraction is recorded next to it, so why it changed ' +
            'stays answerable.',
        )
      ) {
        return
      }
      const done = await attempt(b, 'Retracting…', () =>
        act('lesson_retract', { p_lesson_id: b.dataset.retract }), 'Retracted.')
      if (done) await afterGovernance()
    })
  }

  /*
    Deciding a proposal (#49, #54).

    Approve, decline and reopen through one control, because they are one
    column. Declining asks first and approving does not: a decline is the
    durable half — `proposals_one_per_need` means the same need cannot be
    raised again while the row stands — and an approval only says the office
    may ask for the thing, which is undone by declining it.
  */
  for (const b of v.querySelectorAll('[data-decide]')) {
    b.addEventListener('click', async () => {
      const [id, verdict] = String(b.dataset.decide).split(':')
      if (
        verdict === 'declined' &&
        !sure(
          'Decline this? The agent stops asking for it — the decline is a row, ' +
            'not a mood, so it will not come back next week. You can reopen it ' +
            'here whenever you like.',
        )
      ) {
        return
      }
      const done = await attempt(b, 'Saving…', () =>
        act('proposal_decide', { p_proposal_id: id, p_state: verdict }),
        verdict === 'open' ? 'Reopened.' : `${verdict[0].toUpperCase()}${verdict.slice(1)}.`)
      if (done) await afterGovernance()
    })
  }

  /*
    Answering a request for reach (ADR-0018, #272).

    Approving asks first and declining does not, which is the opposite way
    round from the proposal control above -- and deliberately. Approving GRANTS
    the tool: the agent can use it on the next job, and whatever that tool
    reaches it now reaches on Grant's behalf. Declining only says not now; the
    row stays, the count goes up, and the office may ask again.

    No p_reason is sent. A decline with nothing to add is a complete answer and
    the RPC supplies an honest default rather than storing an empty string,
    which is 0177's argument about sentinels.
  */
  for (const b of v.querySelectorAll('[data-tool]')) {
    b.addEventListener('click', async () => {
      const [id, verdict] = String(b.dataset.tool).split(':')
      const yes = verdict === 'approve'
      if (
        yes &&
        !sure(
          'Grant this? The agent gets the tool from its next job onwards, and ' +
            'whatever it reaches, it reaches as you. You can take it back under ' +
            'What each of them can do.',
        )
      ) {
        return
      }
      /*
        A decline needs a reason, because app.decline_tool refuses one without.
        Asked for here rather than defaulted, so what is stored is a sentence
        Grant wrote: the reason is shown back on the card and is the whole
        point of a durable decline.
      */
      let reason = null
      if (!yes) {
        reason = why('Why not? The team is shown this, and so are you when it asks again.')
        if (reason === null) return
      }
      const done = await attempt(b, 'Saving…', () =>
        act(
          yes ? 'approve_tool' : 'decline_tool',
          yes ? { p_request_id: id } : { p_request_id: id, p_reason: reason },
        ),
        yes ? 'Granted.' : 'Declined.')
      if (done) await afterGovernance()
    })
  }

  /*
    Accepting or declining a drafted standing rule (#147).

    Accepting asks first and declining does not, which is the opposite way
    round from the proposal control above it — and deliberately, because the
    two decisions are asymmetric in opposite directions. Approving a proposal
    only lets an agent ASK for something; accepting a rule changes how the
    office behaves on every job from now on, which is the heavier of the two.

    Declining is the reversible-looking one and is not: propose_standing_rule
    matches on the normalised rule text whatever its state, so a declined rule
    never comes back. The confirmation says so rather than implying otherwise.
  */
  for (const b of v.querySelectorAll('[data-suggest]')) {
    b.addEventListener('click', async () => {
      const [id, verdict] = String(b.dataset.suggest).split(':')
      const yes = verdict === 'yes'
      if (
        yes &&
        !sure(
          'Make this a standing rule? The team is shown it on every job from ' +
            'now on. You can retract it at any time under What it learned, ' +
            'and the retraction is recorded beside it.',
        )
      ) {
        return
      }
      if (
        !yes &&
        !sure(
          'Decline this rule? It is not stored, and the office will not offer ' +
            'this one again — correct it differently and it can propose a new ' +
            'one.',
        )
      ) {
        return
      }
      const done = await attempt(b, yes ? 'Saving…' : 'Declining…', () =>
        act('suggestion_decide', { p_suggestion_id: id, p_accept: yes }),
        yes ? 'The team will be shown this.' : 'Declined.')
      if (done) await afterGovernance()
    })
  }

  for (const b of v.querySelectorAll('[data-retire-proc]')) {
    b.addEventListener('click', async () => {
      if (!sure('Retire this procedure? The team stops being shown it. Saying it again brings it back.')) {
        return
      }
      const done = await attempt(b, 'Retiring…', () =>
        act('retire_skill', { p_skill_id: b.dataset.retireProc }),
      )
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-retire-person]')) {
    b.addEventListener('click', async () => {
      const bringingBack = b.dataset.to === 'true'
      if (
        !bringingBack &&
        !sure(
          `Retire ${b.dataset.name}? They stop taking work. Everything they have ` +
            'already done stays, and you can bring them back at any time.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        bringingBack ? 'Bringing back…' : 'Retiring…',
        () => act('staff_retire', { p_slug: b.dataset.retirePerson, p_active: bringingBack }),
        bringingBack ? 'Back on the team.' : 'Retired.',
      )
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-save-google]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('[data-saidwrap]')
      const id = String(wrap?.querySelector('[data-g-id]')?.value ?? '').trim()
      const secretBox = wrap?.querySelector('[data-g-secret]')
      const secret = String(secretBox?.value ?? '').trim()
      if (id === '' && secret === '') {
        say(b, 'Nothing to save.', 'warn')
        return
      }
      /*
        One call, not two (§35, 0377).

        These were two writes — the ID through set_setting, the secret through
        set_google_secret — so nothing could tell that they had been typed into
        each other's boxes. The ID is stored in plain text and rendered back
        into the field above, so a secret pasted there was printed on this
        page. The RPC sorts the two by shape, the way the Slack form already
        does, and refuses a credential in the ID box outright.
      */
      const done = await attempt(
        b,
        'Saving…',
        async () => await act('set_google_credentials', { p_client_id: id, p_secret: secret }),
        'Saved. Now press Connect Google.',
      )
      /*
        Both boxes cleared whatever happened.

        The secret, because on success it is in the vault and this copy is
        redundant, and on failure leaving a wrong credential sitting in a
        password field is how it gets submitted again.

        And the ID box for a sharper reason (§35): it is plain text and the
        page renders what is stored in it, so if the refusal was "that is a
        credential, not a client ID" then the credential is currently on
        screen. Clearing only on that one refusal would need this file to keep
        its own copy of the server's list of credential shapes, and two lists
        that must agree are how 0282 and 0293 happened. Clearing always needs
        no list, and a client ID is one paste away on the console page it came
        from.
      */
      if (secretBox) secretBox.value = ''
      const idBox = wrap?.querySelector('[data-g-id]')
      if (idBox) idBox.value = ''
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-save-slack]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('[data-saidwrap]')
      const botBox = wrap?.querySelector('[data-sl-bot]')
      const sigBox = wrap?.querySelector('[data-sl-sig]')
      const bot = String(botBox?.value ?? '').trim()
      const sig = String(sigBox?.value ?? '').trim()
      if (bot === '' || sig === '') {
        say(b, 'Both values are needed — reinstalling gives you both.', 'warn')
        return
      }
      const done = await attempt(
        b,
        'Reconnecting…',
        async () => await act('set_slack_credentials', { p_bot_token: bot, p_signing_secret: sig }),
        'Slack is back. The office can post and verify again.',
      )
      /*
        Cleared whatever happened, exactly as the Google secret is.

        On success both are in the vault and these copies are redundant; on
        failure the commonest cause is the two boxes swapped, and leaving a
        wrong credential in a password field is how it gets submitted twice.
      */
      if (botBox) botBox.value = ''
      if (sigBox) sigBox.value = ''
      if (done) await afterWrite()
    })
  }

  for (const b of v.querySelectorAll('[data-forget-google]')) {
    b.addEventListener('click', async () => {
      /*
        Confirmed, and the sentence says what it costs.

        Nothing is deleted — the mail and calendar the office already read stay
        in `documents` — but the team stops being able to see the diary, which
        is a real loss of capability and not a tidy-up.
      */
      if (
        !sure(
          'Disconnect Google? The team stops being able to read your calendar ' +
            'and mail. Everything already read stays. Reconnecting is one consent screen.',
        )
      ) {
        return
      }
      const done = await attempt(b, 'Disconnecting…', () => act('forget_google', {}), 'Disconnected.')
      if (done) await afterWrite()
    })
  }

  /*
    Disconnecting anything (#90).

    Three things this does that the Google-only version did not:

    1. It names the service and what stops, from `route.costs`, so the
       confirmation is about THIS service rather than a generic "are you
       sure?". Grant confirms every destructive action, and a confirmation that
       does not say what it costs reads as "will this delete my work".
    2. It repeats the RPC's own sentence afterwards rather than saying
       "Disconnected." A disconnect of something that was never connected
       reports exactly that, because a teardown that matched nothing looks
       identical to one that worked.
    3. It says where consent is withdrawn at the provider. Deleting our copy of
       a credential is not revoking it; Postgres makes no HTTP calls, so
       claiming a revocation here would be false. The link is the honest half.
  */
  /*
    Connecting a task provider, and letting it go (#259, Phase 2).

    Both go through the gateway to functions that sort the address and the
    token by SHAPE, so the page does not judge either — it hands over what was
    typed and says back exactly what the office answered. A page that
    pre-validated a credential would be a second opinion about a boundary, and
    the two would drift.
  */
  const wire = $('[data-vikunja-on]', v)
  if (wire !== null) {
    wire.addEventListener('submit', async (e) => {
      e.preventDefault()
      const url = String($('[data-vikunja-url]', wire)?.value ?? '').trim()
      const project = Number($('[data-vikunja-project]', wire)?.value ?? 0)
      const token = String($('[data-vikunja-token]', wire)?.value ?? '').trim()
      const btn = $('button[type="submit"]', wire)
      const done = await attempt(btn, 'Connecting…', async () =>
        await act('vikunja_connect', {
          p_base_url: url,
          p_project_id: project,
          p_api_token: token,
        }),
      )
      /*
        The token field is cleared whatever happened, including a refusal.
        A credential left in a form is a credential in the next screenshot,
        and this page is captured on every run.
      */
      const box = $('[data-vikunja-token]', wire)
      if (box !== null) box.value = ''
      if (!done) return
      await afterWrite()
    })
  }
  for (const b of v.querySelectorAll('[data-vikunja-off]')) {
    b.addEventListener('click', async () => {
      if (
        !sure(
          'Disconnect Vikunja? Every task stays here — it was a copy, not the list. ' +
            'The API token is removed too, so reconnecting needs a new one.',
        )
      ) {
        return
      }
      const done = await attempt(b, 'Disconnecting…', async () => await act('vikunja_forget', {}))
      if (!done) return
      await afterWrite()
    })
  }
  for (const b of v.querySelectorAll('[data-disconnect]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.disconnect
      const name = b.dataset.service ?? key
      const route = Object.values(config.ROUTES).find((r) => r.off === key)
      if (!sure(`Disconnect ${name}? ${route?.costs ?? ''}`)) return
      let outcome = null
      const done = await attempt(b, 'Disconnecting…', async () => {
        outcome = await act('disconnect', { p_service: key })
        return outcome
      })
      if (!done) return
      await afterWrite()
      /*
        Said after the redraw, and found again by attribute, because
        `afterWrite` rebuilds the sheet and the button pressed is gone. Without
        this the sentence lands on a detached node and nothing appears — the
        same shape as the eighteen dead panel buttons in #105.
      */
      const again = $(`[data-disconnect="${key}"]`) ?? $('[data-settings-body]')
      const where = outcome?.revoke_at
      /*
        Everything the office said, in the order a person needs it (#198).

        What STOPPED first, because that is what he pressed the button for;
        then what was NOT revoked, because #109 is a real defect and a
        Disconnect that let him believe access ended would inherit it; then the
        numbered steps only he can take, because "Always be explicit with
        instructions!!! ... include full instructions each and every time with
        URLs, steps to follow".

        The older services answer with `note` alone and are unchanged — this
        adds the fields Slack and Telegram return rather than replacing what
        was there.
      */
      const parts = [
        outcome?.stopped,
        outcome?.not_revoked,
        Array.isArray(outcome?.to_finish) && outcome.to_finish.length > 0
          ? `To finish it: ${outcome.to_finish.map((t, i) => `${String(i + 1)}. ${t}`).join(' ')}`
          : null,
        outcome?.note,
        where === undefined || where === null ? null : `Provider page: ${where}`,
      ].filter((x) => typeof x === 'string' && x !== '')
      say(again, parts.length === 0 ? 'Disconnected.' : parts.join(' '))
    })
  }

  wireAppearance(v)
}

/*
  The appearance controls, wired.

  Split out of the old sheet when Settings became six tabs. Each change applies
  immediately and redraws, so the tick moves under your finger rather than after
  a save — a settings panel with a Save button is a settings panel that makes
  you guess what a palette looks like before committing to it.
*/
function wireAppearance(v) {
  const pick = (key, value) => {
    apply({ ...appearance(), [key]: value })
    settingsSheet()          // redraw so the tick moves
    sheet(v, true)
  }
  /*
    The same value the header's shortcut sets (#87). One setting, two doors —
    which is the only way the two can be guaranteed not to contradict each
    other, and a page insisting it is light while it is plainly dark is the
    worst outcome available here.
  */
  for (const b of v.querySelectorAll('[data-scheme-pick]')) {
    b.addEventListener('click', () => {
      pick('scheme', b.dataset.schemePick)
      paintSchemeButtons()
    })
  }
  for (const b of v.querySelectorAll('[data-palette-pick]')) {
    b.addEventListener('click', () => pick('palette', b.dataset.palettePick))
  }
  /*
    Density redraws the pane, unlike palette.

    The note under the control says what the chosen one does, so it has to be
    rewritten — and the pane is the surface whose spacing just changed, which
    makes it the one worth seeing change.
  */
  for (const b of v.querySelectorAll('[data-density-pick]')) {
    b.addEventListener('click', () => {
      pick('density', b.dataset.densityPick)
      settingsSheet()
      sheet(v, true)
    })
  }
  for (const b of v.querySelectorAll('[data-texture-pick]')) {
    b.addEventListener('click', () => pick('texture', b.dataset.texturePick))
  }
  const file = $('[data-texture-file]', v)
  file?.addEventListener('change', async () => {
    const chosen = file.files?.[0]
    if (!chosen) return
    const err = $('#texerr', v)
    err.hidden = true
    const out = await readTexture(chosen)
    if (out.error) { err.textContent = out.error; err.hidden = false; return }
    apply({ ...appearance(), texture: 'own', own: out.data, ownName: out.name })
    settingsSheet()
    sheet(v, true)
  })
  $('[data-texture-clear]', v)?.addEventListener('click', () => {
    apply({ ...appearance(), texture: 'plaster', own: null, ownName: '' })
    settingsSheet()
    sheet(v, true)
  })

  $('.close', v)?.addEventListener('click', () => { sheet(v, false) })
  v.addEventListener('click', (e) => { if (e.target === v) sheet(v, false) })
}

/*
  The time of day, as one number (#23 idea 7).

  0 at the coolest part of the morning, 1 at the warmest part of the evening,
  and the CSS mixes two washes from it. One variable rather than six blocks of
  CSS, because "warmer as the day goes on" is a curve, not five states.

  Re-read every ten minutes. Nobody watches it change and that is the point:
  it should only ever be noticed as the app not feeling the same at 9pm as it
  did at 9am.
*/
function clock() {
  const set = () => {
    const h = new Date().getHours() + new Date().getMinutes() / 60
    // Coolest around 09:00, warmest around 20:00, wrapping through the night.
    const warm = 0.5 - 0.5 * Math.cos(((h - 9 + 24) % 24) / 24 * 2 * Math.PI)
    document.body.style.setProperty('--hour-warm', warm.toFixed(3))
  }
  set()
  setInterval(set, 600_000)
}

/** Remembered, because a person who collapses a sidebar means it. */
const railShut = () => {
  try { return localStorage.getItem('studio.rail') === 'shut' } catch { return false }
}

/*
  Everything on his plate, across every project and none (#173).

  Grant asked for one question to be answerable: "What should I be doing next?"
  So the FIRST thing on the page is the first row, named — not a count, not a
  chart. A list sorted by date is something he can already assemble in his head;
  an answer is not.

  Grouped by what is wrong with a task rather than by project, because the
  grouping is the argument: overdue is a different kind of thing from waiting,
  and both are different from merely open. Project is a label on each row.

  The ordering comes from the SQL (0280) and is not recomputed here — the page
  and the Chief of Staff must agree about what is next, and two orderings is how
  they stop agreeing.
*/
/** The seven views #259 names, in the order a person works through them. */
const MY_BUCKETS = [
  ['today', 'Today'],
  ['overdue', 'Overdue'],
  ['upcoming', 'Upcoming'],
  ['inbox', 'Inbox'],
  ['unscheduled', 'Unscheduled'],
  ['done', 'Done'],
  ['all', 'All'],
]

/*
  MY TASKS (#259, ADR-0041).

  Grant's own list. It is the same table as the office's project tasks with
  `assigned_to_human` true — the audit in ADR-0041 found that column modelled
  since #11, never once set, and read by nothing anywhere.

  #259's third invariant is that there is only ONE personal-task interface and
  that a canonical task is never shown twice, so the team's cross-project work
  is a clearly separate section at the bottom of this screen rather than mixed
  in: 0483 makes the portfolio reader exclude personal tasks and the project
  reader mark them, so the two lists cannot overlap by construction rather than
  by this renderer being careful.

  The bucket is state, not a route. A person moves between Today and Overdue
  the way they move between filters, and putting seven buckets in the URL would
  make the back button undo a filter change.
*/
function tasksView() {
  if (canWrite()) void needMine(mine.bucket)
  const rows = mine.lists[mineKey()]
  const counts = mine.counts ?? {}
  const c = (k) => Number(counts[k] ?? 0)

  const payload = latest.tasks
  const theirs = Array.isArray(payload?.tasks) ? payload.tasks : []

  const dueWords = (t) =>
    t.due_on === null || t.due_on === undefined
      ? ''
      : new Date(`${t.due_on}T00:00:00Z`).toLocaleDateString([], {
          day: 'numeric',
          month: 'short',
        })

  /*
    Finding one, and choosing the order (#259, migration 0504).

    Above the buckets rather than inside one, because a search narrows
    WHICHEVER bucket you are in: "what am I late on about the pricing" is a
    real question and a search that threw away Overdue could not answer it.

    The box is a form so Return submits it and so the phone keyboard shows a
    Search key; it is not live-as-you-type, because every keystroke is a round
    trip to the office and a list that reshuffles under your thumb on a phone
    is worse than one you ask for.

    No backticks in this comment: template literal.
  */
  const find = !canWrite()
    ? ''
    : `<form class="myfind" data-my-find>
        <input data-my-query type="search" value="${esc(mine.query)}"
               placeholder="Find a task" aria-label="Find a task by title, notes or label">
        <select data-my-sort aria-label="What order to show them in">
          ${[
            ['smart', 'Soonest first'],
            ['priority', 'Most important first'],
            ['title', 'By name'],
            ['created', 'Newest first'],
          ]
            .map(
              ([v, name]) =>
                `<option value="${v}"${mine.sort === v ? ' selected' : ''}>${esc(name)}</option>`,
            )
            .join('')}
        </select>
        ${
          mine.query === ''
            ? ''
            : `<button class="btn small quiet" type="button" data-my-clear>Clear</button>`
        }
      </form>`

  const tabs = `<div class="mybuckets" role="tablist" aria-label="Which of my tasks">
    ${MY_BUCKETS.map(
      ([id, name]) => `<button role="tab" class="mybucket${mine.bucket === id ? ' on' : ''}"
             aria-selected="${mine.bucket === id}" data-bucket="${esc(id)}">
        ${esc(name)}${c(id) === 0 ? '' : ` <span class="n">${String(c(id))}</span>`}
      </button>`,
    ).join('')}
  </div>`

  /*
    Adding one is the first thing on the screen, not behind a button.

    #259's native experience asks for "fast creation", and a task app where
    adding one takes a click to open a form is a task app people stop using.
    The project is optional BECAUSE the inbox is the bucket with no project —
    the whole first bucket depends on that being sayable.

    (No backticks in this comment: it lives inside a template literal.)
  */
  const composer = !canWrite()
    ? ''
    : `<form class="myadd" data-my-add data-saidwrap>
        <input data-my-title placeholder="What do you need to do?"
               aria-label="A new task" required>
        <input data-my-due type="date" aria-label="When it is due">
        <select data-my-project aria-label="Which project, if any">
          <option value="">No project</option>
          ${PROJECTS.map((x) => `<option value="${esc(x.slug)}">${esc(x.name)}</option>`).join('')}
        </select>
        <button class="btn primary" type="submit">Add</button>
        <span class="t-meta" data-said></span>
      </form>`

  const myRow = (t) => {
    const done = t.state === 'done'
    const labels = Array.isArray(t.labels) ? t.labels : []
    return `<li class="ptask${t.overdue === true ? ' od' : ''}${done ? ' was' : ''}">
      <button class="ptick${done ? ' on' : ''}" data-my-tick="${esc(t.id)}"
        data-done="${done}"
        aria-label="${done ? 'Reopen' : 'Mark done'} &ldquo;${esc(t.title)}&rdquo;"></button>
      <div class="ptbody">
        <b>${esc(t.title)}</b>
        <span class="t-meta">
          ${t.overdue === true ? '<em class="pt-bad">Overdue</em> · ' : ''}
          ${t.project === null || t.project === undefined
            ? 'No project'
            : esc(String(t.project.name ?? ''))}
          ${dueWords(t) === '' ? '' : ` · due ${esc(dueWords(t))}`}
          ${t.repeats === null || t.repeats === undefined ? '' : ' · repeats'}
          ${t.remind_at === null || t.remind_at === undefined
            ? ''
            : /*
                RAW, not escaped. `when.stamp` returns a `<time data-rel>`
                ELEMENT — that is how `pulse` re-words it without a redraw —
                and every one of the six other callers interpolates it
                directly. Wrapping it in `esc()` printed the whole tag as text
                on the card: *"reminder <time data-rel datetime=… >in 2h</time>"*.
                It escapes its own content; the six callers are the evidence.
              */
              ` · reminder ${when.stamp(t.remind_at)}`}
          ${t.for_job === null || t.for_job === undefined ? '' : ' · the team is waiting on this'}
        </span>
        ${labels.length === 0
          ? ''
          : `<span class="dchips">${labels
              .map((l) => `<span class="dchip">${esc(l)}</span>`)
              .join('')}</span>`}
        ${(() => {
          /*
            The children, under their parent (#259, migration 0515).

            Read from the payload rather than matched up in the page: a subtask
            due today and its parent due next week are in different buckets, so
            a renderer that nested whatever happened to be in the same answer
            would orphan the rest — the row-list-built-twice defect with a
            filter in front of it.
          */
          const kids = Array.isArray(t.subtasks) ? t.subtasks : []
          if (kids.length === 0) return ''
          const left = kids.filter((k) => k.done !== true).length
          return `<ul class="psubs" aria-label="Subtasks of ${esc(t.title)}">
            ${kids
              .map(
                (k) => `<li class="psub${k.done === true ? ' was' : ''}">
                  <button class="ptick small${k.done === true ? ' on' : ''}"
                    data-my-tick="${esc(k.id)}" data-done="${k.done === true}"
                    aria-label="${k.done === true ? 'Reopen' : 'Mark done'} &ldquo;${esc(k.title)}&rdquo;"
                    ${canWrite() ? '' : 'disabled'}></button>
                  <span>${esc(k.title)}</span>
                </li>`,
              )
              .join('')}
            <li class="psub-n t-meta">${
              left === 0 ? 'All done' : `${String(left)} of ${String(kids.length)} left`
            }</li>
          </ul>`
        })()}
        ${done || !canWrite() ? '' : myEditor(t)}
      </div>
      ${done || !canWrite()
        ? ''
        : `<button class="btn small quiet mydetail" data-my-open="${esc(t.id)}"
             aria-expanded="${mine.editing === t.id}">${
               mine.editing === t.id ? 'Close' : 'Details'
             }</button>`}
    </li>`
  }

  const list =
    rows === undefined || rows === null
      ? '<p class="t-lead">Looking…</p>'
      : rows.length > 0
        ? // Rows beat everything. The first version of this put the trouble
          // check ABOVE the rows, so a bucket that HAD three tasks rendered
          // the "could not load" line instead of the tasks — a stale failure
          // flag hiding real content, which is worse than the false absence
          // it was written to prevent. Caught by a capture reporting
          // rows 3, writer true, and ZERO task elements in the DOM.
          `<ul class="ptasks">${rows.map(myRow).join('')}</ul>`
        : mine.trouble[mineKey()] === true
          ? // Empty AND the read failed: not an empty list, a list that could
            // not be read. Saying "nothing due today" here would be a claim
            // about his own tasks that nothing established.
            `<p class="t-lead">I could not load this list just now, so this is
               not &ldquo;nothing to do&rdquo; &mdash; it is &ldquo;I could not
               look&rdquo;. The counts above came from a different request and
               may well be right.</p>`
          : mine.query !== ''
            ? /*
                A search that found nothing is not an empty bucket, and saying
                "nothing due today" here would answer a question nobody asked.
                #257's rule on the smallest possible surface.
              */
              `<p class="t-lead">Nothing in this list matches
                 &ldquo;${esc(mine.query)}&rdquo;. Try All, or clear the search.</p>`
            : `<p class="t-lead">${esc(emptyFor(mine.bucket))}</p>`

  /*
    And what the TEAM is doing, under a rule of its own.

    Separate and second, because #259's second invariant is that these are
    different kinds of thing: one is work Grant owes somebody and the other is
    work the office owes him. Reading them as one list is what makes a personal
    task manager stop being one.
  */
  const teamRow = (t) => `<li class="ptask">
    <div class="ptbody">
      <b>${esc(t.title)}</b>
      <span class="t-meta">${
        t.project === null || t.project === undefined
          ? 'No project'
          : esc(String(t.project_name ?? t.project))
      }${t.owner_name === null || t.owner_name === undefined ? '' : ` · ${esc(String(t.owner_name))}`}${
        t.overdue === true ? ' · overdue' : ''
      }</span>
    </div>
  </li>`

  return `<main class="main">
    <div class="head">
      <div>
        <h1 class="t-display">My tasks</h1>
        <p class="t-lead" style="margin:var(--s2) 0 0">${
          !canWrite()
            ? 'Sign in to see your own list.'
            : c('overdue') > 0
              ? `${String(c('overdue'))} overdue, ${String(c('today'))} for today.`
              : c('today') > 0
                ? `${String(c('today'))} for today, and nothing overdue.`
                : /*
                    AND NOT THE SENTENCE THE LIST IS ABOUT TO SAY.

                    With nothing due, this read "Nothing overdue and nothing
                    due today." an inch above the list's own "Nothing due
                    today and no reminders." — the same news twice, which
                    CLAUDE.md records as the thing to look for whenever two
                    lines are pushed under one condition. This one summarises
                    the WHOLE list, so when the list is not empty it says how
                    much is on it, and when it is, it says that instead.
                  */
                  c('all') > 0
                  ? `Nothing due today. ${String(c('all'))} on your list in all.`
                  : 'Nothing on your list.'
        }</p>
      </div>
    </div>

    ${composer}
    ${find}
    ${tabs}
    ${list}

    ${theirs.length === 0
      ? ''
      : `<section class="myteam">
          <h2 class="t-label">What the team is working on</h2>
          <p class="t-meta" style="margin:0 0 var(--s3)">Not yours to do — the office's own
            work, across every project. Open a project to follow one.</p>
          <ul class="ptasks">${theirs.slice(0, 8).map(teamRow).join('')}</ul>
        </section>`}
  </main>`
}

/*
  The three fields the quick-add cannot ask for (#259).

  Labels, a reminder and a repeat are what turn a list into a task manager, and
  they are also what nobody wants in the way while typing "ring the venue". So
  they live behind Details, one row open at a time — not in a sheet, because a
  modal to add the word "errand" is the kind of ceremony that stops people
  labelling anything.

  A reminder is a TIME and the due date is a DATE. `datetime-local` gives a
  local wall-clock string with no zone; it is sent as-is and Postgres reads it
  in the database's zone, which for a one-person office in one place is the
  right answer and is stated here so nobody has to rediscover it.
*/
/**
 * An instant, in the shape a `datetime-local` input will accept (#259).
 *
 * The office stores `remind_at` as a UTC timestamp and the input speaks LOCAL
 * wall-clock with no zone at all, so the two cannot be handed to each other
 * raw. `toISOString()` would put the UTC time in a box the browser labels
 * with the viewer's own clock, which is the quiet kind of wrong: a reminder
 * set for nine would show as eight and save as eight.
 *
 * Empty for an absent or unparseable value, because the editor's blank state
 * has to mean "no reminder" and nothing else.
 */
function localStamp(iso) {
  if (iso === null || iso === undefined || iso === '') return ''
  const at = new Date(String(iso))
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

/**
 * And back: a local wall-clock string as an instant the office can store.
 *
 * `new Date('2026-09-20T09:00')` is parsed as LOCAL by every browser, which is
 * exactly what the input means, and `toISOString()` then carries the offset
 * explicitly. Sending the bare string would leave Postgres to guess a zone
 * from its session, and a reminder an hour out is a reminder nobody trusts.
 */
function instantFrom(local) {
  if (local === '') return ''
  const at = new Date(local)
  return Number.isNaN(at.getTime()) ? '' : at.toISOString()
}

function myEditor(t) {
  if (mine.editing !== t.id) return ''
  const labels = Array.isArray(t.labels) ? t.labels : []
  const every = t.repeats === null || t.repeats === undefined ? '' : String(t.repeats.every ?? '')
  const from = t.repeats === null || t.repeats === undefined ? 'due' : String(t.repeats.from ?? 'due')
  // Postgres renders an interval as "7 days" or "1 mon"; the select's values
  // are what it PARSES, and the comparison below is against what it renders.
  const repeat = /7 day/.test(every)
    ? '7 days'
    : /1 mon/.test(every)
      ? '1 month'
      : /1 day/.test(every)
        ? '1 day'
        : ''
  /*
    Title, notes, priority, due date and project (#259, migration 0504).

    These were all WRITE-ONCE until 0504: `my_task_add` took them and
    `my_task_set` did not, so a task's name, its notes, how important it is and
    when it is due were fixed at the moment you typed them. Not a missing
    feature so much as a missing letter — the U of CRUD, half absent, on the
    one screen whose whole job is that you change your mind.

    Priority is the vocabulary the column already uses: a number where LOWER is
    more important and 100 is ordinary. Offered as four named steps rather than
    a number box, because "20" is not a thing anybody means; the values are the
    column's and the words are a person's.

    No backticks in this comment: template literal.
  */
  const priority = Number(t.priority ?? 100)
  const step = priority <= 10 ? 10 : priority <= 20 ? 20 : priority <= 50 ? 50 : 100
  const due = t.due_on === null || t.due_on === undefined ? '' : String(t.due_on).slice(0, 10)
  const slug = t.project === null || t.project === undefined ? '' : String(t.project.slug ?? '')

  return `<form class="myedit" data-my-save="${esc(t.id)}" data-saidwrap>
    <label class="t-meta">Title
      <input data-my-title-edit value="${esc(t.title ?? '')}"
             aria-label="What this task is called" required></label>
    <label class="t-meta">Notes
      <textarea data-my-detail rows="2" placeholder="Anything you want to remember"
                aria-label="Notes on this task">${esc(t.detail ?? '')}</textarea></label>
    <label class="t-meta">Due
      <input data-my-due-edit type="date" value="${esc(due)}"
             aria-label="When this is due"></label>
    <label class="t-meta">Importance
      <select data-my-priority aria-label="How important this is">
        ${[
          [10, 'Urgent'],
          [20, 'Important'],
          [50, 'Normal'],
          [100, 'Whenever'],
        ]
          .map(
            ([v, name]) =>
              `<option value="${String(v)}"${step === v ? ' selected' : ''}>${esc(name)}</option>`,
          )
          .join('')}
      </select></label>
    <label class="t-meta">Project
      <select data-my-project-edit aria-label="Which project this belongs to">
        <option value=""${slug === '' ? ' selected' : ''}>No project</option>
        ${PROJECTS.map(
          (x) =>
            `<option value="${esc(x.slug)}"${slug === x.slug ? ' selected' : ''}>${esc(x.name)}</option>`,
        ).join('')}
      </select></label>
    <label class="t-meta">Labels
      <input data-my-labels value="${esc(labels.join(', '))}"
             placeholder="errand, admin" aria-label="Labels, separated by commas"></label>
    <label class="t-meta">Remind me
      <input data-my-remind type="datetime-local" value="${esc(localStamp(t.remind_at))}"
             aria-label="When to remind me"></label>
    <label class="t-meta">Repeat
      <select data-my-repeat aria-label="How often this repeats">
        <option value=""${repeat === '' ? ' selected' : ''}>Never</option>
        <option value="1 day"${repeat === '1 day' ? ' selected' : ''}>Every day</option>
        <option value="7 days"${repeat === '7 days' ? ' selected' : ''}>Every week</option>
        <option value="1 month"${repeat === '1 month' ? ' selected' : ''}>Every month</option>
      </select></label>
    <label class="t-meta">Counting from
      <select data-my-repeat-from aria-label="What the repeat counts from">
        <option value="due"${from === 'due' ? ' selected' : ''}>The due date</option>
        <option value="done"${from === 'done' ? ' selected' : ''}>When I last did it</option>
      </select></label>
    <button class="btn small primary" type="submit">Save</button>
    <span class="t-meta" data-said></span>
    <!--
      Adding a subtask, and removing the task, both live in the editor.

      Not on the row: the row is a list of things to do and every control on it
      is one more thing between Grant and reading it. Details is already the
      place you go to change your mind about a task, and these are two more
      ways of doing that.

      No backticks in this comment. Template literal.
    -->
    <div class="myedit-more">
      ${
        t.parent === null || t.parent === undefined
          ? `<button class="btn small quiet" type="button" data-my-sub="${esc(t.id)}">
               Add a subtask</button>`
          : `<button class="btn small quiet" type="button" data-my-unsub="${esc(t.id)}">
               Take out of its parent</button>`
      }
      <button class="gobtn danger" type="button" data-my-delete="${esc(t.id)}"
        data-name="${esc(t.title ?? '')}"
        data-kids="${String(Array.isArray(t.subtasks) ? t.subtasks.length : 0)}">Delete</button>
    </div>
  </form>`
}

/*
  What an empty bucket MEANS, which is different for each of them.

  "No tasks" under Today and under Done are opposite pieces of news, and a
  single empty state that says the same thing in both places is the card with
  nothing in it this repository keeps shipping.
*/
function emptyFor(bucket) {
  switch (bucket) {
    case 'today':
      return 'Nothing due today and no reminders. '
        + 'Anything overdue is in the next tab along.'
    case 'overdue':
      return 'Nothing overdue.'
    case 'upcoming':
      return 'Nothing scheduled beyond today.'
    case 'inbox':
      return 'The inbox is empty — nothing unsorted and without a date.'
    case 'unscheduled':
      return 'Everything open has a date on it.'
    case 'done':
      return 'Nothing finished yet.'
    default:
      return 'No tasks of your own yet. Add one above, or say '
        + '"remind me on Friday to…" and it will land here.'
  }
}

/*
  The studio cannot be left in a broken state it will not admit to (#218).

  Grant: *"the application appears capable of entering a crashed/broken
  state... Fix the root cause rather than merely suppressing the visible
  error."* Three laps of every route, every sub-tab and every way back, with
  `pageerror` recorded, threw nothing - so the specific crash he hit is not
  reproducible here and this is NOT presented as its fix. What it fixes is the
  CLASS, which is the part that was always going to bite again.

  `drawShell` builds the whole shell and then wires about sixty handlers onto
  it.
  If anything in that second half throws, the markup is already on screen and
  the wiring stops where it threw: a page that LOOKS finished and whose
  controls below that line do nothing. That is what a crashed studio looks like
  from the outside, and it is indistinguishable from a product that was built
  badly. There was no boundary anywhere, and no route out of it but a reload
  the page never suggested.

  So a throw now produces a state that says what happened and offers the way
  back. It is deliberately NOT a swallow: the error goes to the console with
  its stack, the message is shown rather than hidden behind a shrug, and the
  screen it draws is an honest failure state in the sense of section 32 rather
  than a skeleton that never resolves.

  A second throw while drawing the apology would recurse, so the guard latches.
*/
let painting = false

/*
  Where the keyboard was, so a redraw can put it back (§30).

  `drawShell` replaces every node in the shell, which destroys whatever had
  focus — so pressing Return on Tasks in the left rail navigated correctly AND
  dropped focus onto the body. A keyboard user was returned to the top of the
  document after every single action, and had to Tab back down to where they
  already were. Nothing was broken enough for an audit to see: the control
  worked, the section changed, the focus ring simply went out.

  Remembered as a SELECTOR built from the element's own identifying attribute
  rather than as a node reference, because the node is precisely what will not
  survive. One attribute, not a fingerprint of several: the aim is to land on
  the element that does the same job on the new screen, and a rail item keeps
  its `data-go` while everything else about it changes.

  A composer or an input is deliberately not restored here — they manage their
  own focus and their own caret, and #197 is a long record of what happens when
  something outside them tries to help.
*/
const KEYED_BY = ['data-go', 'data-tab', 'data-sub', 'data-setting', 'data-open', 'data-switch-open']

function focusKey() {
  const el = document.activeElement
  if (!(el instanceof HTMLElement)) return null
  if (el === document.body) return null
  if (el.matches('input, textarea, select, [contenteditable]')) return null
  for (const name of KEYED_BY) {
    const value = el.getAttribute(name)
    if (value !== null) {
      return value === '' ? `[${name}]` : `[${name}="${CSS.escape(value)}"]`
    }
  }
  return null
}

function restoreFocus(key) {
  if (key === null) return
  // Only when the redraw actually took focus away. A render triggered while
  // the person is somewhere else entirely must not yank them back.
  if (document.activeElement !== null && document.activeElement !== document.body) return
  const again = document.querySelector(key)
  if (again instanceof HTMLElement) again.focus()
}

/*
  The studio can be linked to (#157).

  Grant's third pick, and his reason for it: *"the one people notice ten times a
  day without ever reporting it."* One URL and all state in memory means you
  cannot send yourself a project, cannot bookmark the Tasks tab, and pressing
  Back — which people press anyway — LEAVES THE STUDIO.

  No router library and no build step (ADR-0002, ADR-0011). This is `pushState`,
  one `popstate` listener and two pure functions, and the two are written next
  to each other on purpose: a parser and a printer that disagree is a URL that
  changes every time you copy it.

  The host needs one line for this to survive a reload, and it is in
  `vercel.json` as a rewrite rather than as something anybody has to configure —
  §31A calls an avoidable manual step a design failure. `index.html` asks for
  its assets by absolute path for the same reason: from `/p/a-project` a
  relative `./app.js` is a different file as far as a static host is concerned.
*/
function pathNow() {
  /*
    The experimental experience keeps its own addresses under one prefix, so a
    link into it stays in it across a reload, a Back and a bookmark - and the
    default addresses below are byte-for-byte what they have always been.
  */
  const at = state.experience === 'basecamp' ? '/basecamp' : ''
  if (state.view === 'project' && state.project !== null) {
    /*
      AN EXPANDED VIEW IS A PLACE TOO.

      Grant, 22 September: *"using the browser Back button or a mouse Back
      button while inside an expanded module can immediately throw the user
      back to Project Selection... Where technically appropriate, use browser
      history/state correctly rather than hijacking the Back button in a
      brittle way."*

      It was held only on the state, so opening a modal wrote no history entry
      and Back walked out of the project entirely - the same defect, and the
      same fix, as the task record three comments down. With the modal in the
      address the browser does the work: Back returns to the entry without the
      suffix, `goToPath` reads no expanded view, and the dialog closes. No
      popstate special case, and Forward reopens it.
    */
    /*
      AND WHAT IS OPEN INSIDE IT. A record opened within an expanded view is
      one level deeper, and without it in the address the two levels collapse
      into one history entry - so Back closed the whole dialog from inside a
      task, which is level 2 of Grant's hierarchy skipped. One suffix, one
      optional argument, whichever kind of thing the dialog is showing.
    */
    const inside =
      state.bcExpanded === 'document'
        ? (state.bcDoc?.ref ?? '')
        : state.bcExpanded === 'tasks'
          ? /*
              A FILTER IS A PLACE TOO, and it travels where the record does.
              `~` cannot begin a task key - the port's keys are a uuid or
              `p:<title>` - so the two cannot be confused, and a count that
              opens a filtered list keeps that filter through a reload and a
              Back.
            */
            (state.bcTask ?? (state.bcFilter === null ? '' : `~${state.bcFilter}`))
          : state.bcExpanded === 'contacts'
            ? (state.bcContactAdd === true ? 'new' : (state.bcContact ?? ''))
            : state.bcExpanded === 'sources'
              ? (state.bcSourceAdd === true ? 'new' : (state.bcSource ?? ''))
              : ''
    const x =
      state.experience === 'basecamp' &&
      state.bcExpanded !== null &&
      state.bcExpanded !== undefined &&
      state.bcExpanded !== ''
        ? `/x/${encodeURIComponent(String(state.bcExpanded))}${
            inside === '' || inside === null ? '' : `/${encodeURIComponent(String(inside))}`
          }`
        : ''
    if (state.tab === 'overview') return `${at}/p/${state.project}${x}`
    /*
      A RECORD IS A PLACE, so it goes in the address.

      It was held only on the state, which cost three things at once: the
      record could not be linked or bookmarked, a reload lost it, and Back
      out of one left the app entirely rather than returning to the list —
      §18 requires the record-to-tool return path to always be clear, and
      Back is the commonest way anybody takes it.
    */
    if (state.tab === 'tasks' && state.bcTask !== null && state.bcTask !== undefined) {
      return `${at}/p/${state.project}/tasks/${encodeURIComponent(String(state.bcTask))}${x}`
    }
    return `${at}/p/${state.project}/${state.tab}${x}`
  }
  if (state.view === 'bcsearch') return `${at}/search`
  if (state.view === 'tasks') return `${at}/tasks`
  if (state.view === 'lately') return `${at}/activity`
  return at === '' ? '/' : at
}

/**
 * Read a path into the state, and say whether it meant anything.
 *
 * An unknown route lands on the portfolio rather than on a blank page, which is
 * the issue's own requirement and the only sensible answer for a link that has
 * outlived the thing it pointed at — a project can be archived, and a bookmark
 * to it should not look like a broken product.
 */
function goToPath(path) {
  let bits = String(path ?? '/').split('/').filter((x) => x !== '')
  /*
    THE EXPERIMENTAL EXPERIENCE, read off the front of the path (basecamp_clone.md).

    A prefix rather than a separate deployment: vercel.json already rewrites any
    dotless path outside api/, studio/, samples/ and fonts/ to index.html, and
    index.html asks for root-absolute assets - so /basecamp and /basecamp/p/x
    boot the same page with the same stylesheets and need no routing change at
    all. Everything after the prefix is then parsed exactly as it always was,
    which is what keeps the two experiences one router rather than two.

    Sticky within a visit and nowhere else: the flag is set only by the address,
    so a default URL always lands in the default experience even after the
    experiment has been open in the same tab.
  */
  state.experience = bits[0] === 'basecamp' ? 'basecamp' : 'default'
  if (state.experience === 'basecamp') bits.shift()
  // Cleared here, once, rather than at each of the callers that navigate.
  state.bcTask = null
  // An expanded module does not survive a navigation: the page underneath it
  // has changed, so the dialog over it is about somewhere else.
  state.bcExpanded = null
  state.bcContact = null
  state.bcContactAdd = false
  state.bcDoc = null
  state.bcFilter = null
  state.bcSource = null
  state.bcSourceAdd = false
  if (bits.length === 0) { state.view = 'portfolio'; state.project = null; return true }
  /*
    The experiment's full search (§7.4). Its own view, reachable only under
    the prefix, so the default studio's router is untouched by it.
  */
  if (state.experience === 'basecamp' && bits[0] === 'search') { state.view = 'bcsearch'; return true }
  if (bits[0] === 'tasks') { state.view = 'tasks'; return true }
  if (bits[0] === 'activity') { state.view = 'lately'; return true }
  if (bits[0] === 'p' && bits[1] !== undefined) {
    const p = PROJECTS.find((x) => x.slug === decodeURIComponent(bits[1]))
    if (p === undefined) { state.view = 'portfolio'; state.project = null; return false }
    state.view = 'project'
    state.project = p.slug
    /*
      THE EXPANDED VIEW COMES OFF THE END OF THE ADDRESS FIRST, so everything
      below parses the page the dialog is over rather than tripping on the
      suffix. `x` is not a tool and cannot collide with one: the router's list
      of tools is `bc.TOOLS`, and nothing in it is one character long.
    */
    const cut = bits.indexOf('x', 2)
    if (state.experience === 'basecamp' && cut !== -1) {
      state.bcExpanded = bits[cut + 1] === undefined ? null : decodeURIComponent(bits[cut + 1])
      const inside = bits[cut + 2] === undefined ? '' : decodeURIComponent(bits[cut + 2])
      if (inside !== '') {
        if (state.bcExpanded === 'document') state.bcDoc = { ref: inside, title: '' }
        if (state.bcExpanded === 'tasks') {
          if (inside.startsWith('~')) state.bcFilter = inside.slice(1)
          else state.bcTask = inside
        }
        if (state.bcExpanded === 'contacts') {
          if (inside === 'new') state.bcContactAdd = true
          else state.bcContact = inside
        }
        if (state.bcExpanded === 'sources') {
          if (inside === 'new') state.bcSourceAdd = true
          else state.bcSource = inside
        }
      }
      bits = bits.slice(0, cut)
    }
    const tab = bits[2] === undefined ? 'overview' : decodeURIComponent(bits[2])
    /*
      WHICH TAB LIST DECIDES depends on which experience you are in.

      This validated against SECTIONS alone, which is the DEFAULT studio's
      list — and Activity was removed from it in #222. The experiment has an
      Activity tool with a heading, a preview and a link, so
      /basecamp/p/:slug/activity was accepted by the rewrite, rejected here,
      and silently rewritten to the overview: a link that took you back to
      the page you pressed it on. Four capture runs photographed the overview
      under the name "activity" without anybody noticing, and it surfaced
      only because two published files had identical byte counts.

      An offer may only promise what the press can perform, and a link is an
      offer. The experiment's own tools decide its own routes.
    */
    /*
      ONLY THE TOOLS THIS EXPERIENCE ACTUALLY RENDERS.

      The first fix here used the whole of `bc.TOOLS`, and that list answers a
      DIFFERENT question: what the overview links to. It includes Project
      Settings, which is a hand-off into the current Team HQ rather than a
      surface this experience draws — so /basecamp/p/:slug/settings was
      accepted by the router, found no renderer, fell back to the overview,
      and left the address saying `/settings`.

      Worse than the Activity defect it was written to fix: that one at least
      corrected the URL on the way past. This one rendered one page while the
      address named another, so a bookmark to it was permanently wrong.

      One list, two questions, and they differ for exactly one entry. The
      router asks the narrower one.
    */
    const known =
      state.experience === 'basecamp'
        ? bc.TOOLS.filter((t) => t.own).map((t) => t.id)
        : SECTIONS.map((x) => x.id)
    state.tab = known.includes(tab) ? tab : 'overview'
    /*
      And the record after it, if the address names one. Only under the
      experiment and only under its Tasks tool, so the default studio's
      four-segment addresses are unaffected.
    */
    if (state.experience === 'basecamp' && state.tab === 'tasks' && bits[3] !== undefined) {
      state.bcTask = decodeURIComponent(bits[3])
    }
    return true
  }
  state.view = 'portfolio'
  state.project = null
  return false
}

/*
  Written on every paint, from the state, rather than at each of the forty
  places that change it.

  Forty callers each remembering to push is forty chances to forget, and the
  one that forgets is the screen whose URL silently describes the previous
  screen. `render()` already runs after every one of them, so the address bar
  is a function of the state by construction.

  `replaceState` when the path has not changed, so a redraw — a selection, a
  fetch landing — does not add an entry to the history that Back has to walk
  through.
*/
let shownPath = null
function keepUrl() {
  if (typeof history === 'undefined') return
  const path = pathNow()
  if (path === shownPath) return
  const first = shownPath === null
  shownPath = path
  try {
    /*
      In a review build the address goes in the hash, so the page URL itself
      never changes and a reload comes back to the same screen rather than to
      a path the host has never heard of.
    */
    const to = REVIEW ? `#${path}` : path
    if (first) history.replaceState({ path }, '', to)
    else history.pushState({ path }, '', to)
  } catch {
    /* A page opened from a file has no history to write to. It still works. */
  }
}

function render() {
  const key = focusKey()
  try {
    drawShell()
    keepUrl()
    restoreFocus(key)
    painting = false
  } catch (e) {
    console.error('The studio could not draw this screen.', e)
    if (painting) throw e
    painting = true
    broke(e)
  }
}

/*
  The failure state itself.

  Built with textContent and createElement rather than a template literal,
  because the thing that just failed may be the escaper, the data or one of the
  helpers - and an apology screen that depends on the machinery that broke is
  an apology screen you will not get to read.
*/
function broke(e) {
  const root = $('#root')
  if (root === null) return
  root.textContent = ''
  root.classList.remove('shut')

  const wrap = document.createElement('div')
  wrap.className = 'broke'
  wrap.setAttribute('role', 'alert')

  const h = document.createElement('h1')
  h.className = 't-display'
  h.textContent = 'This screen did not draw'
  wrap.append(h)

  const lead = document.createElement('p')
  lead.className = 't-lead'
  lead.textContent =
    'Something in the studio threw while building this view. Nothing you did is lost — '
    + 'the office and your projects are untouched, this is the page failing, not the work.'
  wrap.append(lead)

  const why = document.createElement('p')
  why.className = 'brokewhy'
  why.textContent = String(e?.message ?? e ?? 'no message')
  wrap.append(why)

  const row = document.createElement('div')
  row.className = 'emptydo'

  const home = document.createElement('button')
  home.className = 'btn primary'
  home.textContent = 'Back to the home dashboard'
  home.addEventListener('click', () => {
    state.view = 'portfolio'
    state.project = null
    state.label = null
    // Never sticky across projects (#154). A filter you forgot you set is how
    // a list appears empty, and an empty list reads as an office that did
    // nothing.
    state.facet = {}
    painting = false
    render()
  })
  row.append(home)

  const again = document.createElement('button')
  again.className = 'btn'
  again.textContent = 'Reload the studio'
  again.addEventListener('click', () => { location.reload() })
  row.append(again)

  wrap.append(row)
  root.append(wrap)
}

/**
 * The map's interactions (#25).
 *
 * Drag a card, drag the plane, zoom, select, and save where things ended up.
 *
 * ## Why this moves the DOM rather than re-rendering
 *
 * `render()` replaces every node in the shell. Doing that on pointermove would
 * be sixty rebuilds a second, and it would also destroy the node the pointer is
 * captured on — which is the same defect #197 spent four attempts on, in a
 * different costume. So a drag writes CSS custom properties straight onto the
 * card and recomputes only the lines attached to it; the state and the office
 * are told once, when the gesture ends.
 *
 * ## The grab that is not a click
 *
 * A card is both a button and a draggable object, and the browser will report
 * a click at the end of every drag. Four pixels of movement is the line: below
 * it the gesture opens the side panel, above it the gesture moved the card and
 * the click is swallowed. Without that, every rearrangement would also open a
 * panel over the thing just moved.
 */
function wirePlane(root) {
  $('[data-overview-add]', root)?.addEventListener('click', () => {
    state.tab = 'sources'
    state.mapPick = null
    rememberTab(state.project, state.tab)
    render()
  })

  for (const b of root.querySelectorAll('[data-overview]')) {
    b.addEventListener('click', () => {
      try {
        localStorage.setItem('studio.overview', b.dataset.overview)
      } catch {
        /* A private window cannot remember the choice. It can still make it. */
      }
      state.mapPick = null
      render()
    })
  }

  const port = $('[data-plane]', root)
  if (port === null) return
  const field = $('[data-field]', port)
  const slug = state.project
  if (field === null) return

  /** Field coordinates for every card, read from where they actually are. */
  const spots = () => {
    const at = {}
    for (const c of field.querySelectorAll('.mapcard')) {
      at[c.dataset.node] = {
        x: Number.parseFloat(c.style.getPropertyValue('--x')) || 0,
        y: Number.parseFloat(c.style.getPropertyValue('--y')) || 0,
      }
    }
    return at
  }

  const view = () => ({
    x: Number.parseFloat(field.style.getPropertyValue('--px')) || 0,
    y: Number.parseFloat(field.style.getPropertyValue('--py')) || 0,
    k: Number.parseFloat(field.style.getPropertyValue('--pk')) || 1,
  })

  const setView = (v) => {
    field.style.setProperty('--px', `${v.x}px`)
    field.style.setProperty('--py', `${v.y}px`)
    field.style.setProperty('--pk', String(v.k))
  }

  /** Redraw the lines touching one node, from where the cards are now. */
  const relines = (id) => {
    const at = spots()
    for (const path of field.querySelectorAll('.mapline')) {
      const [from, to] = (path.dataset.edge ?? '').split('|')
      if (id !== undefined && from !== id && to !== id) continue
      const a = at[from]
      const b = at[to]
      if (!a || !b) continue
      path.setAttribute('d', plane.pathFor(a, b))
    }
  }

  let saving = null
  /*
    Positions are the arrangement. The pan and the zoom are not.

    Grant asked for *"persistent arrangements so the dashboard stays how I
    organized it"*, and what he organises is where the cards are. Where the
    viewport happens to be sitting is navigation — and persisting it was
    actively wrong twice over. It made every render after the first one
    non-fresh, because the automatic fit wrote a view into the store, so a
    window that changed size never fitted again: the phone capture opened
    halfway across the plane with the left column sliced off. And a pan saved on
    a 1440px desktop is meaningless on a 390px phone, where the same numbers
    point at a different part of the map.

    So the view is recomputed on every open and saved nowhere, and the cards
    stay exactly where he put them. The column survives in `plane_layouts`
    because dropping it would be a migration for nothing.
  */
  const remember = () => {
    const at = spots()
    placed[slug] = { at, view: {} }
    try {
      localStorage.setItem(`studio.plane.${slug}`, JSON.stringify(at))
    } catch {
      /* Per-viewer convenience only. The office holds the real copy. */
    }
    if (saving !== null) clearTimeout(saving)
    /*
      One write per gesture, not one per pixel. Seven hundred milliseconds is
      long enough that dragging three cards in a row is a single save and short
      enough that closing the tab straight after a move keeps it.
    */
    saving = setTimeout(() => {
      if (!canWrite()) return
      void act('plane_layout_set', {
        p_project_id: byId(slug).id,
        p_at: at,
        p_view: {},
      }).catch(() => undefined)
    }, 700)
  }

  // --- moving one card ------------------------------------------------------
  for (const c of field.querySelectorAll('.mapcard')) {
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const k = view().k
      const from = { x: e.clientX, y: e.clientY }
      const was = {
        x: Number.parseFloat(c.style.getPropertyValue('--x')) || 0,
        y: Number.parseFloat(c.style.getPropertyValue('--y')) || 0,
      }
      let moved = false
      c.setPointerCapture(e.pointerId)
      c.classList.add('moving')

      const move = (m) => {
        const dx = (m.clientX - from.x) / k
        const dy = (m.clientY - from.y) / k
        if (!moved && Math.hypot(m.clientX - from.x, m.clientY - from.y) > 4) moved = true
        if (!moved) return
        c.style.setProperty('--x', `${Math.round(was.x + dx)}px`)
        c.style.setProperty('--y', `${Math.round(was.y + dy)}px`)
        relines(c.dataset.node)
      }
      const up = () => {
        c.removeEventListener('pointermove', move)
        c.removeEventListener('pointerup', up)
        c.removeEventListener('pointercancel', up)
        c.classList.remove('moving')
        if (moved) {
          remember()
          // Swallow the click the browser is about to report, once.
          c.addEventListener('click', (x) => { x.stopPropagation(); x.preventDefault() }, {
            capture: true, once: true,
          })
        }
      }
      c.addEventListener('pointermove', move)
      c.addEventListener('pointerup', up)
      c.addEventListener('pointercancel', up)
    })

    c.addEventListener('click', () => {
      state.mapPick = state.mapPick === c.dataset.node ? null : c.dataset.node
      render()
    })
  }

  // --- moving the plane -----------------------------------------------------
  port.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.mapcard, .planectl, .mapaside')) return
    const from = { x: e.clientX, y: e.clientY }
    const was = view()
    port.setPointerCapture(e.pointerId)
    port.classList.add('dragging')
    const move = (m) => {
      setView({ ...was, x: was.x + (m.clientX - from.x), y: was.y + (m.clientY - from.y) })
    }
    const up = () => {
      port.removeEventListener('pointermove', move)
      port.removeEventListener('pointerup', up)
      port.removeEventListener('pointercancel', up)
      port.classList.remove('dragging')
      remember()
    }
    port.addEventListener('pointermove', move)
    port.addEventListener('pointerup', up)
    port.addEventListener('pointercancel', up)
  })

  // --- zoom -----------------------------------------------------------------
  const zoomTo = (k, about) => {
    const v = view()
    const next = Math.min(1.8, Math.max(0.35, k))
    const box = port.getBoundingClientRect()
    const cx = (about?.x ?? box.width / 2)
    const cy = (about?.y ?? box.height / 2)
    // Keep whatever is under the pointer under the pointer. Without this the
    // plane appears to slide away from you every time you zoom.
    setView({
      k: next,
      x: cx - ((cx - v.x) / v.k) * next,
      y: cy - ((cy - v.y) / v.k) * next,
    })
    remember()
  }

  /*
    `floor` is the whole difference between the fit he ASKS for and the fit he
    is GIVEN.

    Zoom multiplies every font size on the plane. The automatic first view is a
    choice the product makes on his behalf, so it may not put text under the
    12px floor — the state line is 12px, and 0.85 renders it at 10.2, which
    `verify:map` measures and refuses. Pressing the fit button is a choice HE
    makes, and then showing everything is the point of the press.
  */
  const fit = (floor = 0.35) => {
    const box = port.getBoundingClientRect()
    const w = field.offsetWidth
    const h = field.offsetHeight
    if (w === 0 || h === 0) return
    /*
      Floored at 0.85 on purpose.

      Zoom is a multiplier on every font size on the plane, so a fit that goes
      low enough to show everything can take the 14px card name under the 12px
      floor the visual standard sets — and an unreadable overview is not an
      overview. Below that floor the map shows less and stays legible, and the
      plane is pannable, which is the affordance for the rest.
    */
    const k = Math.min(1.2, Math.max(floor, Math.min(box.width / w, box.height / h) * 0.96))
    /*
      Centred only on the axis where it actually fits.

      Centring a field TALLER than the port gives a negative offset, which puts
      the first row of cards above the top edge where they are clipped out of
      existence — the automatic view opening on a map whose first row is off
      screen. It was found by a drag test reporting that a card could not be
      moved: Playwright had its geometry, pressed the middle of it, and the
      pointer landed on the panel behind, because a clipped element keeps its
      rect and loses its pixels. CLAUDE.md already records that shape twice.

      So each axis is centred if there is room and pinned to the start if there
      is not, and what is off screen is below and to the right, where panning
      is the obvious thing to do.
    */
    const room = (span, size) => (span >= size ? (span - size) / 2 : 0)
    setView({ k, x: room(box.width, w * k), y: room(box.height, h * k) })
  }

  for (const b of port.querySelectorAll('[data-zoom]')) {
    b.addEventListener('click', async () => {
      const how = b.dataset.zoom
      if (how === 'in') zoomTo(view().k * 1.25)
      else if (how === 'out') zoomTo(view().k / 1.25)
      else if (how === 'fit') fit()
      else if (how === 'reset') {
        /*
          Back to the computed arrangement, which is a destructive-ish act on
          something he arranged deliberately — so it asks, the way every other
          irreversible control in this product does.
        */
        const yes = await sure('Put every card back where the studio would have put it?', 'Reset the map')
        if (!yes) return
        placed[slug] = { at: {}, view: {} }
        try {
          localStorage.removeItem(`studio.plane.${slug}`)
        } catch {
          /* fine */
        }
        if (canWrite()) {
          await act('plane_layout_reset', { p_project_id: byId(slug).id }).catch(() => undefined)
        }
        render()
      }
    })
  }

  port.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const box = port.getBoundingClientRect()
    zoomTo(view().k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), {
      x: e.clientX - box.left,
      y: e.clientY - box.top,
    })
  }, { passive: false })

  /*
    And from the keyboard, because a plane you can only reach with a pointer is
    a screen a keyboard user cannot use at all — section 30, and the port says
    so in its own label.
  */
  port.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 160 : 48
    const v = view()
    const go = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (go !== undefined) {
      e.preventDefault()
      setView({ ...v, x: v.x + go[0], y: v.y + go[1] })
      remember()
      return
    }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(v.k * 1.25) }
    else if (e.key === '-') { e.preventDefault(); zoomTo(v.k / 1.25) }
    else if (e.key === '0') { e.preventDefault(); fit() }
    else if (e.key === 'Escape' && state.mapPick !== null) { state.mapPick = null; render() }
  })

  /*
    Fit on the first paint, once, before anybody has moved anything.

    Done here rather than in the renderer because it needs the port's measured
    width, which does not exist until the html is in the document. `data-fit` is
    the renderer saying "nothing is saved for this project"; the attribute is
    removed immediately so a later render — a selection, a state change — never
    yanks the view back from wherever he has panned to.
  */
  if (port.hasAttribute('data-fit')) {
    port.removeAttribute('data-fit')
    // Never below 1.0 unasked. See `fit`.
    fit(1)
  }

  $('[data-aside-close]', port)?.addEventListener('click', () => {
    state.mapPick = null
    render()
  })

  for (const b of port.querySelectorAll('[data-map-go]')) {
    b.addEventListener('click', () => {
      const what = String(b.dataset.mapGo)
      const name = b.dataset.mapName ?? ''
      state.mapPick = null
      if (what === 'team') { state.tab = 'team'; state.sub = 'board' }
      else if (what === 'ask') { state.tab = 'team'; state.sub = 'chat' }
      else if (what === 'sources') state.tab = 'sources'
      else if (what === 'task') state.tab = 'tasks'
      else if (what === 'doc') {
        /*
          Open it if the title finds it, and land on the list if it does not.

          The map's documents come from the database and the page's list is
          positional with no id, so the title is the only field both shapes
          have. A miss is not a failure worth a message — the list is where you
          were going anyway — but it must not be silent about having tried,
          which is why the tab changes either way.
        */
        state.tab = 'documents'
        const doc = (byId(state.project).documents ?? []).find((d) => d.title === name)
        rememberTab(state.project, state.tab)
        render()
        if (doc !== undefined) openDoc(doc, $('.gallery') ?? document.body)
        return
      }
      rememberTab(state.project, state.tab)
      render()
    })
  }
}

function drawShell() {
  const root = $('#root')
  /*
    THE EXPERIMENTAL EXPERIENCE, and the only branch into it in this file.

    Everything below this point is the default studio and is untouched by the
    experiment. The early return is what makes that true structurally rather
    than by inspection: there is no path on which both shells draw, and no way
    for the experiment to half-apply to the product Grant uses.

    The document attribute is what scopes bc/*.css. It is REMOVED rather than
    set to 'default' on the other branch, because an attribute that is present
    with a different value still matches an attribute-presence selector, and
    somebody will eventually write one.
  */
  if (state.experience === 'basecamp') {
    document.documentElement.dataset.experience = 'basecamp'
    root.classList.remove('shut')
    root.innerHTML = bc.html()
    bcWire.wire(root)
    /*
      Returns WITHOUT calling keepUrl or restoreFocus: render() does both after
      drawShell in every case, and a redraw that replaces every node takes the
      keyboard with it unless restoreFocus runs. Doing the address here and
      skipping the focus restore is exactly the defect #147 records - a
      keyboard user returned to the top of the document after every action,
      with nothing anywhere reporting a fault.
    */
    return
  }
  delete document.documentElement.dataset.experience
  root.classList.toggle('shut', railShut())
  root.innerHTML = commandBar() + rail() + (
    state.view === 'project' ? dashboard()
    : state.view === 'lately' ? lately()
    : state.view === 'tasks' ? tasksView()
    : portfolio())
  // The room takes its colour from whatever is in front of you.
  ambient(state.view === 'project' ? byId(state.project).hue : PROJECTS[0].hue)
  breathe(root)
  scatter(root)
  /*
    Say so when what you are looking at is invented (#78 took this out).

    The "Prototype data" badge lived in the ribbon, and removing the ribbon
    removed the only place the studio admitted it was showing a mock. That is
    the one thing on the page that must never quietly disappear: without a
    token the studio renders FALLBACK_PROJECTS, and a design judged as a
    product is exactly how a page came to claim Supabase storage was at 82% of
    the free tier when the real figure was 4%.

    `verify:design` caught it, which is the check doing its job — it exists
    because this repository has shipped invented numbers before.

    A strip at the very top rather than back in a status bar he asked to
    remove: it appears only when the data is not real, so on a working office
    it is never there at all.
  */
  markMock(root)
  markStalled(root)
  markThinking(root)
  // The rail is rebuilt on every render, so the call button is a new element
  // each time and knows nothing. A live call must not be represented by a
  // button that looks idle (#101).
  syncCallButtons()
  paintSchemeButtons()
  /*
    The dock lives OUTSIDE `#root`, so `render()` never wipes it — that is the
    whole point of it (#103): a conversation you can leave open while you move
    around. This call only re-reads it, so the project name in its header
    follows whatever you are looking at.
  */
  paintDock()
  tickWaiting()

  for (const b of root.querySelectorAll('[data-go]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.view = b.dataset.go
        state.label = null
    // Never sticky across projects (#154). A filter you forgot you set is how
    // a list appears empty, and an empty list reads as an office that did
    // nothing.
    state.facet = {}
        render()
      })
      // After the transition, not inside it: a fetch in the middle of a view
      // transition holds the old frame on screen until it resolves.
      if (b.dataset.go === 'lately') void needLately()
      if (b.dataset.go === 'tasks') void needTasks()
    })
  }

  /*
    Ticking one off, from the portfolio (#173).

    `task_state` rather than a portfolio-specific action: it is the same row the
    project view ticks, which is the whole argument for aggregating rather than
    duplicating. It also means undo (#118) works here for free, because the
    inverse was recorded by the same RPC.
  */
  for (const b of root.querySelectorAll('[data-tick]')) {
    b.addEventListener('click', async () => {
      await attempt(b, 'Marking done…', () =>
        act('task_state', { p_task_id: b.dataset.tick, p_state: 'done' }),
      )
      await refresh()
    })
  }

  /*
    MY TASKS — the buckets, the composer and the tick (#259).

    The bucket is a local switch, so it does not go through `attempt`: nothing
    is written and nothing can be refused. It fetches on demand and the store
    remembers, so moving between Today and Overdue twice is two requests rather
    than four.
  */
  for (const b of root.querySelectorAll('[data-bucket]')) {
    b.addEventListener('click', () => {
      mine.bucket = b.dataset.bucket
      void needMine(mine.bucket)
      render()
    })
  }

  const add = $('[data-my-add]', root)
  add?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const title = String($('[data-my-title]', add)?.value ?? '').trim()
    if (title === '') { say(add, 'A task needs a title.', 'warn'); return }
    const due = String($('[data-my-due]', add)?.value ?? '')
    const project = String($('[data-my-project]', add)?.value ?? '')
    const done = await attempt(
      add.querySelector('button[type="submit"]'),
      'Adding…',
      async () =>
        await act('my_task_add', {
          p_title: title,
          // An empty date input is the empty string, and the RPC takes a DATE.
          // Passing '' would be a cast error reported to Grant as "the action
          // failed", which is the gateway's worst sentence.
          ...(due === '' ? {} : { p_due_on: due }),
          ...(project === '' ? {} : { p_project: project }),
        }),
      'Added.',
    )
    if (done?.ok === true) {
      const t = $('[data-my-title]', add)
      if (t) t.value = ''
      const d = $('[data-my-due]', add)
      if (d) d.value = ''
      forgetMine()
      void needMine(mine.bucket)
      render()
      // The field again, so a second task is one keystroke away rather than a
      // click. `render()` replaces the node, so this has to come after it.
      $('[data-my-title]')?.focus()
    }
  })

  /*
    Searching and sorting (#259).

    A form, so Return submits it — and `render()` replaces the input, so the
    value is read BEFORE the redraw and the focus is put back afterwards. A
    search box that loses the caret every time you press Return is one nobody
    uses twice.
  */
  const finder = $('[data-my-find]', root)
  finder?.addEventListener('submit', (e) => {
    e.preventDefault()
    mine.query = String($('[data-my-query]', finder)?.value ?? '').trim()
    void needMine(mine.bucket)
    render()
    const box = $('[data-my-query]')
    if (box !== null && box !== undefined) {
      box.focus()
      // The caret at the end rather than selecting the whole thing, so
      // refining a search is typing rather than retyping.
      box.setSelectionRange(box.value.length, box.value.length)
    }
  })
  $('[data-my-sort]', root)?.addEventListener('change', (e) => {
    mine.sort = String(e.target.value ?? 'smart')
    void needMine(mine.bucket)
    render()
  })
  $('[data-my-clear]', root)?.addEventListener('click', () => {
    mine.query = ''
    void needMine(mine.bucket)
    render()
  })

  for (const b of root.querySelectorAll('[data-my-open]')) {
    b.addEventListener('click', () => {
      mine.editing = mine.editing === b.dataset.myOpen ? null : b.dataset.myOpen
      render()
    })
  }

  for (const f of root.querySelectorAll('[data-my-save]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const id = f.dataset.mySave
      const labels = String($('[data-my-labels]', f)?.value ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x !== '')
      const remind = String($('[data-my-remind]', f)?.value ?? '')
      const every = String($('[data-my-repeat]', f)?.value ?? '')
      const from = String($('[data-my-repeat-from]', f)?.value ?? 'due')
      // The five that were write-once until 0504.
      const title = String($('[data-my-title-edit]', f)?.value ?? '').trim()
      const detail = String($('[data-my-detail]', f)?.value ?? '').trim()
      const dueOn = String($('[data-my-due-edit]', f)?.value ?? '')
      const priority = String($('[data-my-priority]', f)?.value ?? '')
      const proj = String($('[data-my-project-edit]', f)?.value ?? '')
      if (title === '') {
        // Said here as well as refused by the RPC. A form that posts and comes
        // back with an error for something the browser could see is a round
        // trip Grant waits for.
        say(f, 'A task needs a title.', 'warn')
        return
      }
      /*
        Empty means REMOVE here, and the RPC is told so explicitly.

        `my_task_set` treats a null argument as "leave it alone", which is what
        a partial update needs — so clearing the labels box has to be a
        different request from not touching it, and `p_clear` is how the office
        already says that (`hq_task_update` takes the same list).
      */
      const clear = [
        ...(labels.length === 0 ? ['labels'] : []),
        ...(remind === '' ? ['remind_at'] : []),
        ...(every === '' ? ['repeat'] : []),
        ...(detail === '' ? ['detail'] : []),
        ...(dueOn === '' ? ['due_on'] : []),
        ...(proj === '' ? ['project'] : []),
      ]
      const ok = await attempt(
        f.querySelector('button[type="submit"]'),
        'Saving…',
        async () =>
          await act('my_task_set', {
            p_task_id: id,
            ...(labels.length === 0 ? {} : { p_labels: labels }),
            /*
              As an INSTANT, not the box's wall-clock string. The input has no
              zone; Postgres would take one from its session, and "remind me at
              nine" arriving an hour out is a reminder nobody trusts.
            */
            ...(remind === '' ? {} : { p_remind_at: instantFrom(remind) }),
            ...(every === '' ? {} : { p_repeat_every: every, p_repeat_from: from }),
            p_title: title,
            ...(detail === '' ? {} : { p_detail: detail }),
            ...(dueOn === '' ? {} : { p_due_on: dueOn }),
            ...(priority === '' ? {} : { p_priority: Number(priority) }),
            ...(proj === '' ? {} : { p_project: proj }),
            p_clear: clear,
          }),
        'Saved.',
      )
      if (ok?.ok === true) {
        mine.editing = null
        forgetMine()
        void needMine(mine.bucket)
        render()
      }
    })
  }

  /*
    Removing one for good (#259, migration 0513).

    Confirmed, always — Grant: *"You should always check before making any
    destructive action with me."* And the sentence NAMES the subtasks, because
    `tasks_parent_task_id_fkey` is ON DELETE CASCADE and a confirmation that
    does not mention the three other rows about to go is not a confirmation.
    Equally it does not overstate: with no children it says so plainly, since
    a warning that cries wolf is one people learn to click through.
  */
  for (const b of root.querySelectorAll('[data-my-delete]')) {
    b.addEventListener('click', async () => {
      const kids = Number(b.dataset.kids ?? '0')
      if (
        !sure(
          `Delete “${b.dataset.name}”? ` +
            (kids === 0
              ? 'This cannot be undone.'
              : `Its ${String(kids)} subtask${kids === 1 ? '' : 's'} go with it. ` +
                'This cannot be undone.'),
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Deleting…',
        () => act('my_task_delete', { p_task_id: b.dataset.myDelete }),
        'Deleted.',
      )
      if (done) {
        mine.editing = null
        forgetMine()
        void needMine(mine.bucket)
        render()
      }
    })
  }

  /*
    Adding a subtask, inline, without leaving the list.

    A prompt rather than a second form: the only thing a subtask needs at birth
    is a name — it inherits its parent's project (0514) and can be opened and
    edited like any other task afterwards. A five-field form for one string is
    the thing #259 means by "fast creation".
  */
  for (const b of root.querySelectorAll('[data-my-sub]')) {
    b.addEventListener('click', async () => {
      const title = globalThis.prompt?.('What is the subtask?')
      if (title === null || title === undefined || title.trim() === '') return
      const done = await attempt(
        b,
        'Adding…',
        () => act('my_task_add', { p_title: title.trim(), p_parent: b.dataset.mySub }),
        'Added.',
      )
      if (done) {
        forgetMine()
        void needMine(mine.bucket)
        render()
      }
    })
  }

  /*
    Taking a subtask back out (#259, migration 0514).

    The half that matters more than the forward one: putting a task under
    another has a door — you create it there — and until this there was no way
    back except deleting it and typing it again. 0514's own drive block ends on
    the same control for the same reason.

    No picker for moving it under a DIFFERENT parent: that is a list of every
    other task, on a phone, to do something a delete and a re-add already does.
  */
  for (const b of root.querySelectorAll('[data-my-unsub]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Moving…',
        () => act('my_task_reparent', { p_task_id: b.dataset.myUnsub }),
        'On its own now.',
      )
      if (done) {
        mine.editing = null
        forgetMine()
        void needMine(mine.bucket)
        render()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-my-tick]')) {
    b.addEventListener('click', async () => {
      // Reopening as well as finishing. A tick that can only go one way turns
      // a mis-click into a row Grant has to find in the Done tab and cannot
      // put back — and `hq_task_state` has always taken either.
      const was = b.dataset.done === 'true'
      const ok = await attempt(
        b,
        was ? 'Reopening…' : 'Marking done…',
        async () =>
          await act('task_state', {
            p_task_id: b.dataset.myTick,
            p_state: was ? 'todo' : 'done',
          }),
        was ? 'Reopened.' : 'Done.',
      )
      if (ok !== null) {
        forgetMine()
        void needMine(mine.bucket)
        render()
      }
    })
  }

  /*
    Sources: connect and disconnect, for real (#68).

    The first two write actions the studio has ever had, and they are the right
    two to start with — a project's sources are the thing Grant changes most
    and the thing #62 already built the server half of.

    `hq_attach` takes a link and works the rest out: it reads
    `knowledge_connectors` to recognise the kind and delegates a Drive folder to
    the Drive path. §31 — an avoidable request for manual configuration is a
    design failure, so this asks for the link and nothing else.
  */
  for (const b of root.querySelectorAll('[data-add-source]')) {
    b.addEventListener('click', async () => {
      const field = b.closest('[data-saidwrap]')?.querySelector('[data-src-ref]')
      const ref = String(field?.value ?? '').trim()
      if (ref === '') {
        field?.focus()
        return
      }
      /*
        A connector if one claims it, a plain reference otherwise (#35).

        `hq_attach` reads `knowledge_connectors` and works out whether a link
        is a Notion database, a Drive folder or a notebook. Anything else — a
        website, an API, a competitor's pricing page — is not a connector and
        never will be, so it becomes a reference instead of an error.

        Tried in that order rather than by inspecting the URL here, because the
        registry is the thing that knows which links are claimed and this page
        would be a second copy of that knowledge, drifting.
      */
      const done = await attempt(b, 'Adding…', async () => {
        try {
          return await act('attach', { p_slug: b.dataset.addSource, p_ref: ref })
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error)
          // Only fall through when the refusal was "nothing here recognises
          // this". A connector that IS recognised and failed for its own
          // reason — a bad token, a page we cannot see — must keep saying so.
          if (!/not (?:a )?recognis|no connector|could not tell|unrecognis/i.test(why)) throw error
          return await act('reference_add', { p_slug: b.dataset.addSource, p_url: ref })
        }
      }, (r) => (r?.kind === undefined ? 'Connected.' : `Added as ${String(r.kind)}.`))
      if (done) {
        if (field) field.value = ''
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-unref]')) {
    b.addEventListener('click', async () => {
      // No confirmation. A reference is a pointer with nothing behind it, and
      // pasting the link again restores it exactly — asking would be ceremony
      // over an act that loses nothing.
      const done = await attempt(b, 'Removing…', () =>
        act('reference_remove', { p_reference_id: b.dataset.unref }), 'Removed.')
      if (done) await refresh()
    })
  }

  /*
    A new dashboard project, and only when he says so twice.

    `hq_create_project` without `p_force` returns CANDIDATES and creates
    nothing — 0153 built that deliberately, because three notebooks once existed
    for one intention. So the first press may come back with "did you mean one
    of these", and only a second, explicit press creates.
  */
  for (const b of root.querySelectorAll('[data-new-project]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('[data-saidwrap]')
      const name = String(wrap?.querySelector('[data-new-name]')?.value ?? '').trim()
      const ref = String(wrap?.querySelector('[data-new-ref]')?.value ?? '').trim()
      if (name === '' || ref === '') {
        say(b, 'A project needs a name and something to read from.', 'warn')
        return
      }
      const force = b.dataset.force === name

      if (!force && !sure(`Create a dashboard project called "${name}"?`)) return

      const made = await attempt(
        b,
        force ? 'Creating…' : 'Checking…',
        () => act('create_project', { p_name: name, p_connector: 'auto', p_ref: ref,
                                      ...(force ? { p_force: true } : {}) }),
        (r) => (r?.candidates?.length ? '' : 'Created.'),
      )
      /*
        Candidates came back, so nothing was created.

        Saying "already exists" would be wrong — these are near matches, not the
        same thing — and creating anyway would be the assumption he asked twice
        not to make. So it names them and arms the button to mean "yes, a new
        one" on the next press.
      */
      if (made?.candidates?.length) {
        b.dataset.force = name
        b.textContent = 'Create anyway'
        say(
          b,
          `We already have ${made.candidates.map((c) => c.name).join(', ')}. ` +
            'Press again if you want a new one as well.',
          'warn',
        )
        return
      }
      if (made) {
        b.dataset.force = ''
        b.textContent = 'Create'
        await refresh()
      }
    })
  }

  /*
    Rename in place, on the title itself.

    An edit-in-place rather than a pencil and a dialogue: there are four
    projects and the name is one field. Committed on blur or Enter, and Escape
    puts it back — which matters because a contenteditable that cannot be
    abandoned is a trap.
  */
  for (const h of root.querySelectorAll('[data-rename]')) {
    const was = h.textContent
    const commit = async () => {
      const now = h.textContent.trim()
      if (now === was || now === '') {
        h.textContent = was
        return
      }
      const done = await attempt(
        h,
        'Renaming…',
        () => act('rename_project', { p_slug: h.dataset.rename, p_name: now }),
        'Renamed.',
      )
      if (done) await refresh()
      else h.textContent = was
    }
    h.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); h.blur() }
      if (e.key === 'Escape') { h.textContent = was; h.blur() }
    })
    h.addEventListener('blur', commit)
  }

  for (const b of root.querySelectorAll('[data-decline]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Noting it…',
        () =>
          act('connection_choose', {
            p_slug: b.dataset.decline,
            p_connector: b.dataset.connector,
            p_choice: 'declined',
            p_reason: 'Decided from the dashboard.',
          }),
        `Noted — nothing will ask about ${b.dataset.name} on this project again.`,
      )
      if (done) await refresh()
    })
  }

  for (const b of root.querySelectorAll('[data-detach]')) {
    b.addEventListener('click', async () => {
      /*
        Confirmed, always. Grant: "You should always check before making any
        destructive action with me."

        Nothing is lost by disconnecting — ADR-0013 is explicit that the corpus
        a connector fed survives the connector being removed — and the sentence
        says so, because a confirmation that overstates the danger is one people
        learn to click through.
      */
      if (
        !sure(
          `Disconnect ${b.dataset.name}? The documents it already gave stay; ` +
            'nothing new comes in until it is connected again.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Disconnecting…',
        () => act('detach', { p_attachment_id: b.dataset.detach }),
        'Disconnected.',
      )
      if (done) await refresh()
    })
  }

  /*
    Bringing an archived project back (#276).

    Confirmed, even though nothing is destroyed: un-archiving restarts a
    project Grant deliberately put away, and the sentence says the one thing
    the RPC will NOT do — the automations it stopped stay stopped, and
    `unarchive_project` names them in `still_off` so the confirmation after the
    press can too. A duty that starts running again unasked is a worse surprise
    than one that does not.
  */
  for (const b of root.querySelectorAll('[data-unarchive]')) {
    b.addEventListener('click', async () => {
      if (!sure(`Bring ${b.dataset.name} back? Anything it had running stays stopped.`)) return
      const done = await attempt(
        b,
        'Bringing it back…',
        () => act('project_unarchive', { p_slug: b.dataset.unarchive }),
        (r) => {
          const off = Array.isArray(r?.still_off) ? r.still_off.length : 0
          return off === 0
            ? `${b.dataset.name} is back.`
            : `${b.dataset.name} is back. ${off} automation${off === 1 ? '' : 's'} stayed off.`
        },
      )
      if (done) {
        // The list is memoised and the project has just left it.
        recoverable = undefined
        await refresh()
      }
    })
  }

  /*
    Reconnecting one (#276, #118).

    No confirmation: this is the recovery, not the risk. Grant's standing rule
    is that a DESTRUCTIVE action asks first, and asking before undoing one
    teaches people to click through the dialog that matters.

    `p_reason` is left off, which clears `disabled_reason` — the column's own
    CHECK is `enabled or disabled_reason is not null`, so re-enabling and
    clearing the reason have to be the same statement, and `hq_reattach`
    already does both.
  */
  for (const b of root.querySelectorAll('[data-reattach]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Reconnecting…',
        () => act('reattach', { p_attachment_id: b.dataset.reattach }),
        `${b.dataset.name ?? 'It'} is connected again.`,
      )
      if (done) await refresh()
    })
  }

  /*
    Forgetting a signed-in site (#135, #276).

    Confirmed, because it is irreversible in the way that matters: the Vault
    row goes, and signing in again is a sign-in rather than an undo. The
    sentence says what survives — the office keeps what it already read — so
    the confirmation neither overstates nor understates it, which is the same
    argument the Disconnect wording makes.
  */
  for (const b of root.querySelectorAll('[data-forget-site]')) {
    b.addEventListener('click', async () => {
      if (
        !sure(
          `Forget the sign-in for ${b.dataset.name}? The office will not be able ` +
            'to open it again until you sign it in. Nothing it already read is removed.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Forgetting…',
        () => act('browser_session_forget', { p_session: b.dataset.forgetSite }),
        (r) => String(r?.note ?? 'Forgotten.'),
      )
      if (done) {
        // The block is drawn from a per-project store, not from the payload
        // `refresh()` reloads, so the row would still say "Signed in" until
        // something else asked. Dropped and re-asked instead.
        delete browserSites[b.dataset.projectSlug ?? state.project]
        await refresh()
      }
    })
  }

  // Project → dashboard. The cover art is the shared element: it grows and
  // moves to the hero slot, and the browser pairs them by view-transition-name.
  for (const b of root.querySelectorAll('[data-open]')) {
    if (!b.classList.contains('proj')) tiltable(b, { max: b.classList.contains('lead') ? 3.2 : 5 })
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.project = b.dataset.open
        state.view = 'project'
        state.tab = tabFor(state.project)
        // An attachment belongs to the project you were in. Carrying it across
        // would put a Legacy document on a Wellness message.
        state.attach = null
        markSeen(state.project)
        render()
      })
    })
  }

  /*
    Everything that lifts, tilts.

    One place, one list. The section work added five card types and none of them
    got this, so the team board and the in-tray sat flat in a product where
    every other card responds to the pointer — which reads as those screens
    being unfinished rather than as restraint.

    The angles are smaller than a project card's. A project card is an object
    you pick up; a job row is a line you read, and tilting it as far would turn
    a list into a fairground.
  */
  const TILT = [
    ['.module', { max: 3, scale: 1.006 }],
    ['.member', { max: 3.4, scale: 1.008 }],
    ['.job', { max: 2.2, scale: 1.004 }],
    ['.source', { max: 4, scale: 1.01 }],
    ['.wrow', { max: 1.8, scale: 1.003 }],
  ]
  for (const [sel, opts] of TILT) {
    for (const el of root.querySelectorAll(sel)) tiltable(el, opts)
  }
  /*
    And anything marked `data-lift`, which is how a new card joins without
    editing either this array or the CSS (#38). `data-tilt` names the angle;
    3 degrees is right for most things and is the default.
  */
  for (const el of root.querySelectorAll('[data-lift]')) {
    tiltable(el, { max: Number(el.dataset.tilt ?? 3), scale: 1.006 })
  }

  // Tasks complete optimistically: the row changes now, the network catches up.

  for (const b of root.querySelectorAll('[data-task]')) {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.task)
      state.done.has(i) ? state.done.delete(i) : state.done.add(i)
      const box = $('.box', b)
      spring(box, { transform: 'scale(0.8)' }, { transform: 'scale(1)' }, SPRING.snap)
      b.classList.toggle('done')
      const check = state.done.has(i)
      if (check && !$('svg', box)) {
        box.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="var(--on-accent)" stroke-width="3.4" stroke-linecap="round"
          stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>`
      } else if (!check) { box.innerHTML = '' }

      /*
        And then persist it (#11).

        The tick was a Set in browser memory and nothing else: it survived
        until the next render and never reached the office. `state.done` still
        exists because it is what makes the tick instant — the write is a round
        trip and a checkbox that waits for one feels broken — but it is now the
        optimistic half of a real write rather than the whole of it.

        A failure puts the tick back where it was and says so, because a
        checkbox that silently reverts is worse than one that never moved.
      */
      const id = b.dataset.taskId
      if (id === undefined || !canWrite()) return
      /*
        `refresh()`, not `afterWrite()`.

        `afterWrite` is defined inside the settings wiring and re-renders the
        SETTINGS SHEET — calling it from the project page threw
        "afterWrite is not defined" in the first end-to-end run, which is
        exactly why that run existed. `refresh()` re-reads the studio payload
        and repaints the page, which is what a task write needs.
      */
      act('task_state', { p_task_id: id, p_state: check ? 'done' : 'todo' })
        .then(() => refresh())
        .catch((err) => {
          check ? state.done.delete(i) : state.done.add(i)
          b.classList.toggle('done')
          box.innerHTML = check ? '' : box.innerHTML
          say(b, String(err.message ?? err), 'warn')
        })
    })
  }

  /*
    The empty states' own actions, and the Tasks header (#105).

    Every one of these was a bare button with no attribute. `task` opens the
    add-task form; anything else is a section to go to — "Bring documents in"
    goes to Sources, where attaching a connector is what actually puts
    documents in a project.
  */
  for (const b of root.querySelectorAll('[data-empty-do]')) {
    b.addEventListener('click', () => {
      const what = b.dataset.emptyDo
      if (what === 'task' || what === 'contact' || what === 'module') {
        const sel = what === 'contact' ? '[data-contact-form]' : '[data-task-form]'
        const first = what === 'contact' ? '[data-c-name]' : '[data-task-title]'
        const form = $(sel, root)
        if (form) {
          form.hidden = false
          /*
            #71. A module is a milestone, so it opens the same form with the box
            already ticked — and `task` UNTICKS it, because a form left ticked
            from the last press turns the next ordinary task into a heading
            silently. Set both ways, never only one.
          */
          const tick = $('[data-task-milestone]', root)
          if (tick) tick.checked = what === 'module'
          $(first, root)?.focus()
        }
        return
      }
      state.tab = what
      rememberTab(state.project, what)
      render()
    })
  }

  $('[data-c-cancel]', root)?.addEventListener('click', () => {
    const form = $('[data-contact-form]', root)
    if (form) form.hidden = true
  })

  $('[data-c-go]', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const val = (sel) => String($(sel, root)?.value ?? '').trim()
    const name = val('[data-c-name]')
    if (name === '') { say(b, 'A name, at least.', 'warn'); return }
    const done = await attempt(
      b,
      'Adding…',
      () => act('contact_add', {
        p_project: state.project,
        p_name: name,
        p_role: val('[data-c-role]') || null,
        p_org: val('[data-c-org]') || null,
        p_email: val('[data-c-email]') || null,
        p_phone: val('[data-c-phone]') || null,
        p_instagram: val('[data-c-insta]') || null,
        p_kind: val('[data-c-kind]') || 'person',
      }),
      `${name} is on ${byId(state.project).name}.`,
    )
    if (done) {
      const form = $('[data-contact-form]', root)
      if (form) form.hidden = true
      await refresh()
    }
  })

  $('[data-task-cancel]', root)?.addEventListener('click', () => {
    const form = $('[data-task-form]', root)
    if (form) form.hidden = true
  })

  $('[data-task-go]', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const title = String($('[data-task-title]', root)?.value ?? '').trim()
    if (title === '') { say(b, 'Say what needs doing.', 'warn'); return }
    const due = String($('[data-task-due]', root)?.value ?? '').trim()
    const who = String($('[data-task-who]', root)?.value ?? '').trim()
    const done = await attempt(
      b,
      'Adding…',
      () => act('task_add', {
        p_project: state.project,
        p_title: title,
        p_due_on: due === '' ? null : due,
        p_assignee: who === '' ? null : who,
        // #71. `hq_task_add` takes it since 0287; before that a module was
        // add-then-promote, and a refusal on the promote left a plain task on
        // the board that nobody had asked for.
        p_milestone: $('[data-task-milestone]', root)?.checked === true,
      }),
      $('[data-task-milestone]', root)?.checked === true ? 'Module added.' : 'Added.',
    )
    if (done) {
      const form = $('[data-task-form]', root)
      if (form) form.hidden = true
      await refresh()
    }
  })

  // The rail reaches People per project — which is now a tab on that project
  // rather than a view of its own, because People was never a separate place.
  for (const b of root.querySelectorAll('[data-people]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.project = b.dataset.people
        state.view = 'project'
        state.tab = 'contacts'
        state.label = null
    // Never sticky across projects (#154). A filter you forgot you set is how
    // a list appears empty, and an empty list reads as an office that did
    // nothing.
    state.facet = {}
        state.attach = null
        rememberTab(state.project, 'contacts')
        render()
      })
    })
  }

  /*
    The project switcher.

    Closing on the next click anywhere is registered on `document` with
    `{ once: true }` AFTER a stopPropagation on the opening press, so the press
    that opens it is not also the click that closes it.
  */
  const swBtn = $('[data-switch-open]', root)
  const swMenu = $('[data-switch-menu]', root)
  if (swBtn !== null && swMenu !== null) {
    swBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const open = swMenu.hidden
      swMenu.hidden = !open
      swBtn.setAttribute('aria-expanded', String(open))
      if (open) {
        document.addEventListener('click', () => {
          swMenu.hidden = true
          swBtn.setAttribute('aria-expanded', 'false')
        }, { once: true })
      }
    })
    swBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { swMenu.hidden = true; swBtn.setAttribute('aria-expanded', 'false') }
    })
  }

  wirePlane(root)

  $('[data-rail]', root)?.addEventListener('click', () => {
    try { localStorage.setItem('studio.rail', railShut() ? 'open' : 'shut') } catch { /* fine */ }
    render()
  })
  /*
    Call the team.

    This was DEAD. It wrote to `.talkstate`, an element removed from the rail at
    some point since, so the most prominent control in the interface — the one
    Grant asked to be prominent — did nothing at all when pressed. Nothing
    caught it: it renders, it passes every layout check, and it photographs
    perfectly. `npm run verify:controls` found it by pressing it.

    The prototype still has no call to place, so the honest behaviour is to say
    so ON the button, where the press happened, rather than in a status line
    somewhere else that may or may not exist. It reverts after a moment so the
    rail does not stay stuck mid-sentence.
  */
  /*
    Call the team, for real (#68).

    This was a stub that said "Calling Claire…" for two and a half seconds and
    did nothing — and before that it was genuinely dead, writing to an element
    that had been removed from the rail. It is the most prominent control in the
    interface, the one Grant asked to be prominent, and it is the last thing
    that kept the old page alive.

    Opened as a sheet rather than a route: a call is a thing you are doing
    while looking at something else, and navigating away from the project you
    were discussing to talk about it is exactly backwards.
  */
  /*
    Closing the sheet does not hang up (#101, #102).

    It used to be the only way a call ended, and it ended it by throwing away
    the reference rather than by stopping anything — the microphone stayed
    open with no interface attached to it. Now the call is a module-level
    singleton in `call.js`: the sheet attaches to it and detaches from it, and
    the only thing that stops a microphone is `endCall`.

    So the rail button opens the sheet whether or not a call is running, and
    the sheet's own microphone button is what starts and ends one. The rail
    button still shows the state, because `syncCallButtons` paints every
    element carrying `data-call`.
  */
  /*
    Editing a task (#106), from the row it is on.

    The id off the button rather than the index: `state.done` is keyed by
    position and the list reorders as tasks change state, so an index is the
    wrong task the moment anything moves.
  */
  for (const b of root.querySelectorAll('[data-task-pick]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.taskPick
      if (state.picked.has(id)) state.picked.delete(id)
      else state.picked.add(id)
      render()
    })
  }

  $('[data-picked-clear]', root)?.addEventListener('click', () => {
    state.picked.clear()
    render()
  })

  /*
    One write per row, reported honestly (#150).

    `Promise.all` would be faster and would throw away which row failed — and
    the issue is explicit that a half-succeeding batch must say which moved and
    which did not. So they go one at a time, each failure is caught and counted,
    and the sentence at the end is the truth rather than a yes or a no.

    Sequential also keeps the office's own rate limits out of this: six writes
    at once against a free tier is how a batch half-fails for a reason that has
    nothing to do with the rows.
  */
  const bulk = async (button, verb, run) => {
    const ids = [...state.picked]
    if (ids.length === 0) return
    const yes = await sure(`${verb} ${String(ids.length)} task${ids.length === 1 ? '' : 's'}?`, verb)
    if (!yes) return
    const said = $('[data-picked-said]', root)
    button.disabled = true
    let moved = 0
    const stuck = []
    for (const id of ids) {
      try {
        await run(id)
        moved += 1
        state.picked.delete(id)
        if (said !== null) said.textContent = `${moved} of ${ids.length}…`
      } catch (error) {
        stuck.push(error instanceof Error ? error.message : String(error))
      }
    }
    button.disabled = false
    await refresh()
    if (stuck.length > 0) {
      window.alert(
        `${moved} of ${ids.length} done. ${stuck.length} could not be: ${stuck[0]}`,
      )
    }
  }

  $('[data-picked-done]', root)?.addEventListener('click', async (e) => {
    await bulk(e.currentTarget, 'Mark done', async (id) =>
      await act('task_state', { p_task_id: id, p_state: 'done' }))
  })

  $('[data-picked-give]', root)?.addEventListener('click', async (e) => {
    const who = $('[data-picked-who]', root)?.value
    const name = crewBy(who)?.name ?? who
    await bulk(e.currentTarget, `Give to ${name}`, async (id) =>
      await act('task_update', { p_task_id: id, p_assignee: who }))
  })

  for (const b of root.querySelectorAll('[data-task-edit]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const p = byId(state.project)
      const t = p?.tasks.find((x) => x.id === b.dataset.taskEdit)
      if (p && t) taskSheet(t, p)
    })
  }

  // Changing how a project looks (#83), from the mark itself.
  for (const b of root.querySelectorAll('[data-look]')) {
    b.addEventListener('click', () => {
      const p = byId(b.dataset.look)
      if (p) lookSheet(p)
    })
  }

  /*
    Writing to the team, beside calling them (#103). Toggles rather than opens,
    because the rail entry is the only way back to a dock you shut with its own
    close button and the only way to shut one you opened.
  */
  $('[data-dock]', root)?.addEventListener('click', () => {
    rememberDock(!dockOpen())
    paintDock()
    if (dockOpen()) $('[data-docksay]')?.focus()
  })

  /*
    Pressing Call the team CALLS the team (#214).

    Grant, in full: *"When Call the Team is pressed: do not open a modal/dialog.
    Start the team voice/audio session directly. Change the button/icon state
    visually to indicate that a live call is active... The same button should
    function as a toggle: first click connect, second click disconnect. Stopping
    the call must genuinely terminate the audio/session, not merely hide UI.
    There should be no modal that remains stuck open."* And the sentence that
    says what he actually wants: *"The experience should feel like toggling a
    live microphone/call, not opening another page."*

    It used to open a sheet, and the sheet's own microphone placed the call - so
    the most prominent control in the product was two presses from doing the one
    thing its label promised, and the thing in between was a dialog.

    `toggleCall` was already there and already correct: #101 and #102 made
    `endCall` cancel the response at the server, clear the audio the server has
    already sent, tear down the peer connection and then silence the element, in
    that order. So stopping genuinely stops. What was missing was a control
    wired to it.

    The panel has not gone - it holds the transcript and the typed fallback -
    it has stopped being in the way. It opens from the command bar, which is
    where a surface you want occasionally and not every time belongs.
  */
  const call = $('[data-call]', root)
  call?.addEventListener('click', () => { toggleCall() })

  for (const b of root.querySelectorAll('[data-settings]')) {
    b.addEventListener('click', () => { settingsSheet(); sheet($('#settings'), true) })
  }

  for (const b of root.querySelectorAll('[data-filter]')) {
    b.addEventListener('click', () => { state.label = b.dataset.filter || null; render() })
  }
  for (const b of root.querySelectorAll('[data-facet]')) {
    b.addEventListener('click', () => {
      state.facet[b.dataset.facet] = b.dataset.facetValue || null
      render()
    })
  }
  for (const b of root.querySelectorAll('[data-label-edit]')) {
    b.addEventListener('click', () => { labelEditor() })
  }
  for (const b of root.querySelectorAll('[data-person]')) {
    tiltable(b, { max: 4 })
    b.addEventListener('click', () => {
      const c = byId(state.project).contacts.find((x) => x.name === b.dataset.person)
      if (c) openContact(c)
    })
  }

  for (const b of root.querySelectorAll('[data-contact]')) {
    b.addEventListener('click', () => openContact(byId(state.project).contacts[Number(b.dataset.contact)]))
  }

  /*
    Real pages, over the drawn ones.

    The drawn page is already in the DOM, so the gallery is complete before any
    PDF is fetched; each real render lands on top when it is ready. Nothing
    jumps, nothing is empty, and a file that will not parse simply never
    replaces its drawing.
  */
  /*
    The shelf's buttons move by one card plus its gap, so a press lands on a
    document rather than an arbitrary 300px into the row. `scrollBy` with
    smooth behaviour inherits the platform's own easing, which is closer to
    right than anything hand-rolled.
  */
  const surface = $('[data-surface]', root)
  if (surface) {
    canvasView.wire(surface, canvasView.positions(PROJECTS), null)
    for (const card of surface.querySelectorAll('[data-card]')) {
      card.addEventListener('click', () => {
        if (card.classList.contains('lifted')) return
        carry(null, null, () => {
          state.project = card.dataset.card
          state.view = 'project'
          state.tab = tabFor(state.project)
          state.attach = null
          render()
        })
      })
    }
  }

  /*
    The command bar's keyboard, and why it lives on `document`.

    A global shortcut has to work when focus is anywhere — including inside the
    chat composer — so the listener is on the document, added ONCE at start-up
    rather than per render. Attaching it in `render()` would add a duplicate on
    every paint, and by the tenth navigation one keypress would open the bar ten
    times.
  */
  const rowsNow = () => [...document.querySelectorAll('[data-cmd-row]')]
  for (const b of root.querySelectorAll('[data-cmd-row]')) {
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()   // keep focus in the input so a click behaves like Enter
      pickCommand(Number(b.dataset.cmdRow))
    })
  }
  const input = $('[data-cmd-input]', root)
  if (input !== null) {
    // Caret to the end: re-rendering on each keystroke resets it otherwise.
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    input.addEventListener('input', () => {
      state.cmd.q = input.value
      state.cmd.at = 0
      render()
      void lookInside(input.value)
    })
    input.addEventListener('keydown', (e) => {
      const n = rowsNow().length
      if (e.key === 'Escape') { e.preventDefault(); closeCmd(); render(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); state.cmd.at = (state.cmd.at + 1) % Math.max(n, 1); render(); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); state.cmd.at = (state.cmd.at - 1 + n) % Math.max(n, 1); render(); return }
      if (e.key === 'Enter') { e.preventDefault(); pickCommand(state.cmd.at) }
    })
  }
  $('[data-cmd-wrap]', root)?.addEventListener('mousedown', (e) => {
    if (e.target === $('[data-cmd-wrap]', root)) { closeCmd(); render() }
  })

  /*
    An empty state's team button actually sends the request (#40 idea 7).

    It does not open the chat and leave Grant to type — that would be the same
    manual step §31A calls a design failure, dressed as a shortcut. The message
    is composed, sent, and he lands on the thread watching it happen.
  */
  for (const b of root.querySelectorAll('[data-ask-team]')) {
    b.addEventListener('click', () => {
      if (state.view !== 'project') return
      chat.send(state.project, b.dataset.askTeam, null)
      state.tab = 'team'
      state.sub = 'chat'
      rememberTab(state.project, 'team')
      render()
    })
  }

  // A blocker goes to the job itself: AI Team, Active jobs, on that project.
  // Drawn by the home board's Waiting on you panel (#219); it was the ribbon's
  // route before the ribbon was removed.
  for (const b of root.querySelectorAll('[data-blocked]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.project = b.dataset.blocked
        state.view = 'project'
        state.tab = 'team'
        state.sub = 'jobs'
        rememberTab(state.project, 'team')
        render()
      })
    })
  }

  /*
    Tabs, the talk action, the composer and the in-tray decisions.

    All four are wired here rather than in their renderers because a full
    re-render replaces every node — a listener attached inside a template
    function would be lost on the next paint and silently stop working, which is
    exactly how the deleted `everyone()` bug hid for two commits.
  */
  /*
    Section switching is a transition, not a swap (#40 idea 6).

    `carry` with no element still starts a view transition, so every element
    carrying a `view-transition-name` on both sides is animated between its two
    positions — the Documents panel on Overview becomes the Documents gallery.
    Anything unnamed cross-fades, which is the right default for the rest.
  */
  /*
    Project Settings (#36), which is the only section with a payload of its own.

    Fetched on the press rather than with the shell, for the reason Lately and
    the portfolio task list are: it is a screen you navigate TO, and a settings
    screen folded into the first paint would be carried by every project switch
    for the loads that never open it.

    `void` because the tab must change now. Waiting on the fetch before
    switching would leave the press looking dead for as long as the office
    takes to answer.
  */
  for (const b of root.querySelectorAll('[data-setpane]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.setpane = b.dataset.setpane
        render()
      })
    })
  }
  if (state.tab === 'settings' && state.view === 'project') {
    const open = PROJECTS.find((x) => x.slug === state.project)
    if (open !== undefined) {
      void projectSettings.need(open, render)
      projectSettings.wire(root, open, people, render, () => { lookSheet(open) })
    }
  }

  for (const b of root.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.tab = b.dataset.tab
        // "Talk to the team" is one press: AI Team AND its Chat view.
        if (b.dataset.sub !== undefined) state.sub = b.dataset.sub
        rememberTab(state.project, state.tab)
        render()
      })
    })
  }

  // AI Team's own four. A bare data-sub also means "go to AI Team", so the
  // empty states can send you to the chat from anywhere.
  for (const b of root.querySelectorAll('[data-sub]:not([data-tab])')) {
    b.addEventListener('click', () => {
      carry(null, null, () => {
        state.sub = b.dataset.sub
        state.tab = 'team'
        rememberTab(state.project, 'team')
        render()
      })
    })
  }

  /*
    The project's waiting list (#151).

    `render()` rather than a class toggle, because the list is not in the DOM
    when collapsed — an eight-item panel above every project is a panel the eye
    learns to skip, and skipping is the one thing this must never teach.
  */
  /*
    Ask again (#215).

    The row holds the words, so this resends them rather than reconstructing
    them from the bubble above - which is escaped HTML by then, and which #197
    has already cleared from the composer.
  */
  for (const b of root.querySelectorAll('[data-chat-retry]')) {
    b.addEventListener('click', () => {
      void chat.retry(state.project, b.dataset.chatRetry, presented(), () => {
        keepingPlace(() => { render() })
      }).then(() => { keepingPlace(() => { render() }) })
    })
  }

  for (const b of root.querySelectorAll('[data-waiting-toggle]')) {
    b.addEventListener('click', () => {
      state.waitingOpen = !state.waitingOpen
      render()
    })
  }

  /*
    Answering one, in place.

    `attempt` disables the button, says the office's own sentence on a refusal,
    and re-enables — the pattern every action in the old page arrived at
    independently. On success the payload is re-read, which is what removes the
    item: the answer resolved the blocker, so `needs_me` no longer returns it
    and the bar shrinks or disappears by itself.
  */
  for (const b of root.querySelectorAll('[data-answer]')) {
    b.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      const said = await attempt(
        btn,
        'Sending…',
        () => act('answer_blocker', {
          p_blocker_id: btn.dataset.answer,
          p_answer: btn.dataset.answerWith,
        }),
        'Answered.',
      )
      if (said) await refresh()
    })
  }
  for (const f of root.querySelectorAll('[data-answer-form]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const answer = String(f.answer.value ?? '').trim()
      const go = $('button', f)
      if (answer === '') { say(go, 'Say what the answer is.', 'warn'); return }
      const said = await attempt(
        go,
        'Sending…',
        () => act('answer_blocker', { p_blocker_id: f.dataset.answerForm, p_answer: answer }),
        'Answered.',
      )
      if (said) await refresh()
    })
  }

  /*
    A blocked job's one action.

    The prototype cannot actually clear a blocker, and pretending otherwise
    would be the lying button again — so it says what would happen and to whom.
  */
  /*
    Stop a job that is running (#41's cancellation dimension).

    `stop_job` has existed at the gateway since the browser work and NOTHING
    has ever called it — `data-stop` elsewhere in this file is an unrelated
    click-propagation stopper, which is the kind of name collision that makes
    a grep look reassuring when it is not. So a job spending tokens on the
    wrong thing could only be waited out.

    The wording is the honest part. This is a REQUEST, not a kill: the runner
    reads a column between steps, so the job stops at its next checkpoint and
    a step already in flight finishes. Saying "Stopped" would be claiming
    something that has not happened yet, which is the whole failure this
    repository keeps finding.
  */
  /*
    Open the sign-in form, prefilled when the row knows the site (#135).

    Delegated over the CONTAINER rather than bound per button: the sessions
    list redraws whenever `needSites` answers, and a listener on each button
    would work exactly once — which this file has already paid for three times
    in one afternoon in the icon picker.
  */
  for (const b of root.querySelectorAll('[data-signin-open]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const form = $('[data-signin-form]', root)
      if (!form) return
      form.hidden = false
      const site = $('[data-si-site]', root)
      const purpose = $('[data-si-purpose]', root)
      if (site) site.value = b.dataset.site ?? ''
      if (purpose && (b.dataset.purpose ?? '') !== '') purpose.value = b.dataset.purpose
      // Focus the field that is still empty, which is the site on a fresh
      // form and the jar on a re-sign-in.
      const jar = $('[data-si-jar]', root)
      if ((b.dataset.site ?? '') === '') site?.focus()
      else jar?.focus()
    })
  }

  $('[data-si-cancel]', root)?.addEventListener('click', () => {
    const form = $('[data-signin-form]', root)
    const jar = $('[data-si-jar]', root)
    /*
      Clear the jar on cancel as well as on success. A pasted session left in
      a hidden textarea is a credential sitting in the DOM for as long as the
      page is open, and every screenshot of this screen would contain it.
    */
    if (jar) jar.value = ''
    if (form) form.hidden = true
  })

  $('[data-si-go]', root)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const val = (sel) => String($(sel, root)?.value ?? '').trim()
    const site = val('[data-si-site]').toLowerCase()
    const purpose = val('[data-si-purpose]')
    const jarField = $('[data-si-jar]', root)
    const jar = String(jarField?.value ?? '').trim()

    /*
      Say what is wrong BEFORE spending a round trip, and say it in the words
      the database would use, so the two cannot drift into disagreeing. The
      RPC refuses all three of these by name; these messages exist so a person
      is not taught to press a button that will be refused.
    */
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)) {
      say(b, 'Give me a host, like supplier.example.com.', 'warn')
      return
    }
    if (purpose.length < 12) {
      say(b, 'Say what the session is for, in a sentence — nobody can audit “research”.', 'warn')
      return
    }
    if (jar === '') {
      say(b, 'Paste the signed-in browser state.', 'warn')
      return
    }

    const done = await attempt(
      b,
      'Storing…',
      () => act('browser_session_establish', {
        p_project: state.project,
        p_site: site,
        p_purpose: purpose,
        p_jar: jar,
      }),
      (r) =>
        r?.error
          ? String(r.error)
          : `The office is signed in to ${site}. It reads and photographs there; it does not press anything.`,
    )
    /*
      Cleared whatever happened, including on a refusal. The value is a live
      session; leaving it in the field so the person can correct a typo in the
      SITE would mean keeping a credential on screen to fix something else.
    */
    if (jarField) jarField.value = ''
    if (done) {
      const form = $('[data-signin-form]', root)
      if (form) form.hidden = true
      delete browserSites[state.project]
      delete browserSeen[state.project]
      await refresh()
    }
  })

  for (const b of root.querySelectorAll('[data-stop-job]')) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const done = await attempt(
        b,
        'Asking…',
        () => act('stop_job', { p_job: b.dataset.stopJob }),
        (r) =>
          r?.ok === false
            ? String(r?.note ?? 'there was nothing to stop')
            : 'Asked it to stop — it will finish the step it is on and then halt.',
      )
      if (done) await refresh()
    })
  }

  /*
    Approve, and discard, for what the team made (#28, #276).

    Both actions have existed at the gateway since the import work and neither
    had ever been pressed. Approve is what puts a made document INTO the
    project — 0315 filters the gallery on exactly that state, so the row
    appearing in the gallery afterwards is the whole feedback.

    Discard confirms first. It is not irreversible — 0435 writes `archived`,
    deliberately, so the row and its provenance survive and ADR-0040's
    restoration path applies — but it removes something from in front of Grant
    on one press, and the confirmation says what it actually does rather than
    implying deletion.

    The store entry is dropped before the refresh so the queue is re-read
    rather than redrawn from the answer to a question asked before the press.
  */
  /*
    Outside providers: add one, offer a tool it advertises, stop using it
    (#265, #276).

    The inventory has been readable since #265 and nothing could act on it, so
    connecting the office to a new MCP server meant SQL. Three presses, and
    the vocabulary between them is the point: REGISTERING asks a provider what
    it can do, OFFERING puts one of those tools in front of Grant as a
    request, and only APPROVING it on the Governance page grants anything.
    ADR-0018 keeps those three apart and so does this.
  */
  for (const b of root.querySelectorAll('[data-register-provider]')) {
    b.addEventListener('click', async () => {
      const wrap = b.closest('.provadd')
      const name = (wrap?.querySelector('[data-prov-name]')?.value ?? '').trim()
      const endpoint = (wrap?.querySelector('[data-prov-endpoint]')?.value ?? '').trim()
      if (name === '' || endpoint === '') {
        say(b, 'Both a short name and an endpoint, please.', 'warn')
        return
      }
      const done = await attempt(
        b,
        'Asking it…',
        () => act('register_connector', { p_name: name, p_endpoint: endpoint }),
        (r) =>
          r?.error
            ? String(r.error)
            : `Registered. Nothing is granted yet — the office will list what it advertises.`,
      )
      if (done) {
        config.PROVIDERS.loaded = false
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-offer-tool]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Offering…',
        () => act('offer_connector_tool', { p_discovered: b.dataset.offerTool }),
        (r) =>
          r?.error
            ? String(r.error)
            : `Offered — ${b.dataset.offerName} is waiting for your approval under Governance.`,
      )
      if (done) {
        config.PROVIDERS.loaded = false
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-revoke-provider]')) {
    b.addEventListener('click', async () => {
      /*
        Confirmed, and the sentence says what actually happens: the provider
        stops being asked and every tool it delivered stops working. Nothing
        about the office's own history changes, which is why this is reversible
        by registering it again rather than destructive.
      */
      if (
        !sure(
          `Stop using ${b.dataset.providerName}? The office will not ask it anything ` +
            'again, and any tool it delivered stops working. You can add it back later.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Disconnecting…',
        () => act('revoke_connector', { p_provider: b.dataset.revokeProvider }),
        (r) => (r?.error ? String(r.error) : `${b.dataset.providerName} is disconnected.`),
      )
      if (done) {
        config.PROVIDERS.loaded = false
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-doc-approve]')) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const done = await attempt(
        b,
        'Approving…',
        () => act('document_approve', { p_document: b.dataset.docApprove }),
        (r) =>
          r?.ok === false
            ? String(r?.error ?? 'that could not be approved')
            : `Approved — ${b.dataset.docTitle} is in the project now.`,
      )
      if (done) {
        delete reviewing[state.project]
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-doc-discard]')) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (
        !sure(
          `Discard ${b.dataset.docTitle}? It leaves this list and does not ` +
            'join the project. Nothing is deleted — the document and where it ' +
            'came from are kept, and it can be brought back.',
        )
      ) {
        return
      }
      const done = await attempt(
        b,
        'Discarding…',
        () => act('document_discard', { p_document: b.dataset.docDiscard }),
        (r) =>
          r?.already === true
            ? 'That was already out of the project.'
            : `Discarded — ${b.dataset.docTitle} is out of the project.`,
      )
      if (done) {
        delete reviewing[state.project]
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-unblock]')) {
    b.addEventListener('click', () => {
      const row = workspace.rows(byId(state.project)).find((r) => r.id === b.dataset.unblock)
      state.attach = row === undefined ? null
        : { kind: 'request', id: row.id, title: row.ask }
      state.tab = 'team'
      state.sub = 'chat'
      rememberTab(state.project, 'team')
      render()
      const say = $('[data-say]')
      if (say !== null && row !== undefined) {
        say.value = `This is blocked on: ${row.blocked}. Can you sort it?`
        say.focus()
      }
    })
  }

  /*
    The light/dark shortcut, for real (#87).

    Nothing re-renders: the theme is tokens on the root element, so flipping the
    attribute repaints the whole page without touching a single node. Which is
    also why it must not call `render()` — that would throw away an open menu
    and any text being typed, to change a colour.
  */
  for (const b of root.querySelectorAll('[data-scheme-toggle]')) {
    b.addEventListener('click', () => {
      toggleScheme()
      paintSchemeButtons()
    })
  }

  /*
    "Talk to the team about this" (#27).

    `stopPropagation`, because the button sits beside a card that opens the
    document viewer and a bare click would do both. The attachment is put on
    state, the tab switches, and the composer takes focus — the whole action is
    one press and then typing.
  */
  /*
    Leave the conversation and go back to what you were reading (#97, #98).

    One handler for both controls in the bar. `state.attach` is cleared with
    the navigation because the attachment IS the conversation-about-this-thing;
    leaving it set would mean the next message you typed from Documents was
    silently still about the document you had walked away from.
  */
  /*
    A link inside a card that is itself a button (#100).

    Pressing the email opens the mail client; it must not ALSO open the person.
    One handler over everything marked `data-stop` rather than one per link.
  */
  for (const a of root.querySelectorAll('[data-stop]')) {
    a.addEventListener('click', (e) => { e.stopPropagation() })
  }

  for (const b of root.querySelectorAll('[data-back-out]')) {
    b.addEventListener('click', () => {
      const back = state.attach?.back
      state.attach = null
      state.tab = back?.tab ?? 'documents'
      state.sub = back?.sub ?? 'board'
      render()
    })
  }

  /*
    Open the menu, and only one at a time (#27).

    `state.sendFor` holds which asset's menu is open rather than a boolean,
    because two open menus on a gallery of thirty documents is a page nobody
    can read — and because the trigger needs `aria-expanded` and only the one
    that is open should say true.

    `stopPropagation` for the same reason the old single button had it: the
    card underneath opens the document, and pressing the send button is not
    pressing the card. #27 asks for this by name.
  */
  for (const b of root.querySelectorAll('[data-send-kind]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const key = `${b.dataset.sendKind}:${b.dataset.sendId}`
      state.sendFor = state.sendFor === key ? null : key
      render()
    })
  }

  /*
    A named action, straight to the office.

    No composer, no sentence to type: the RPC builds the instruction from the
    action and carries the asset's ID as a fact beside it. `attempt` handles the
    in-flight label and the failure text, the way every other write here does.
  */
  for (const b of root.querySelectorAll('[data-do-action]')) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const done = await attempt(
        b,
        'Sending…',
        () =>
          act('send_to_agent', {
            p_kind: b.dataset.doKind,
            p_id: b.dataset.doId,
            p_action: b.dataset.doAction,
          }),
        (r) => `${String(r?.action ?? 'Sent')} — it is with the team.`,
      )
      if (done) {
        state.sendFor = null
        await refresh()
      }
    })
  }

  for (const b of root.querySelectorAll('[data-talk-kind]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      /*
        Where we came from travels with the attachment (#97).

        Getting back from a document conversation was "unreliable" because two
        different things were wrong. This is the second: arriving here called
        `rememberTab(project, 'team')`, which PERSISTS the tab. So opening a
        conversation about a document silently changed where that project opens
        for ever after — you would come back tomorrow and land in Chat, having
        never chosen it. A side action must not rewrite a deliberate choice, so
        the remembered tab is left alone and the return path is carried instead.
      */
      state.attach = {
        kind: b.dataset.talkKind,
        id: b.dataset.talkId,
        title: b.dataset.talkTitle,
        back: { tab: state.tab, sub: state.sub },
      }
      state.tab = 'team'
      state.sub = 'chat'
      render()
      $('[data-say]')?.focus()
    })
  }

  /*
    Read the office's conversation the moment the chat is on screen.

    Fired and not awaited: the thread paints from whatever is already known and
    is replaced when the answer arrives, because a chat that shows nothing for
    a round trip reads as broken. A prototype project has no id and `load`
    returns null, leaving the local thread in charge — which is a supported way
    to look at this page, not a failure.
  */
  if (state.sub === 'chat' && !chat.isReal(state.project)) {
    void chat
      .load(state.project, byId(state.project)?.id, presented())
      .then((got) => { if (got !== null) render() })
  }

  /*
    On a phone, opening the chat brings the conversation to the top (#197).

    The chat is a sticky column that fills the screen once the project head has
    scrolled away — which is right while you are in it, and leaves you landing
    on a tab whose composer is 300px below the fold. Measured:
    `.composer` at y=1166 on an 844px screen before this, y=513 after.

    `block: 'start'` rather than a bare `scrollIntoView()`: the bare form stops
    the moment the element is technically visible, which for a fixed bottom nav
    is exactly where the nav is — the trap `.navgroup`'s own comment records.

    Once per opening, tracked on `state`, or every repaint would drag the page
    back while somebody is reading further up. `smooth` because the page has
    already been still for a moment and a jump reads as a reload.
  */
  if (state.sub === 'chat' && state.chatShown !== state.project) {
    state.chatShown = state.project
    if (window.matchMedia('(max-width: 860px)').matches) {
      $('.chatbody', root)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  } else if (state.sub !== 'chat') {
    state.chatShown = null
  }

  /*
    A repaint invalidates the box the recogniser is writing into (#196).

    The composer is rebuilt on every render — a pulse tick, a write, a tab
    change — and the recogniser holds a reference to the textarea it started
    with. After a rebuild that node is detached: the words keep arriving and
    nobody can see them, and the microphone is still open on a screen with no
    recording indicator on it, which is #102 exactly.

    So any render ends the dictation. Nothing is lost — `onchange` has been
    writing every update into `state.drafts`, and the fresh composer restores
    it — and the microphone is never held by a page that has moved on.
  */
  dictate.stop()

  /*
    The new-message affordance (#205).

    Wired before the composer because it belongs to the thread, and because it
    has to be drawn from `state.arrived` on EVERY render — the button is
    rebuilt with the rest of the page, so a badge set during one repaint would
    vanish on the next one if only the arrival path drew it.
  */
  const arrivedBtn = $('[data-arrived]', root)
  const threadEl = $('[data-thread]', root)
  if (arrivedBtn !== null && threadEl !== null) {
    noteArrivals()
    const showArrived = () => {
      const mine = state.arrived.project === state.project && state.arrived.n > 0
      arrivedBtn.hidden = !mine
      if (!mine) return
      const says = $('[data-arrived-says]', arrivedBtn)
      /*
        "Emma replied" beats "1 new message", which is #205's own wording, and
        it is worth the branch: a name tells you whether to look now.
      */
      const words =
        state.arrived.n === 1
          ? `${state.arrived.who} replied`
          : `${String(state.arrived.n)} new messages`
      if (says !== null) says.textContent = words
      arrivedBtn.setAttribute('aria-label', `${words} — jump to the newest`)
    }
    showArrived()

    /*
      It goes away when you get there yourself, which is the half that makes it
      unobtrusive: a badge you have to dismiss is a chore.

      `passive` because this never calls `preventDefault` and a scroll listener
      that might is a scroll listener the browser cannot optimise — on a phone
      that is the difference between a thread that glides and one that stutters.
    */
    threadEl.addEventListener(
      'scroll',
      () => {
        // Remembered on every scroll, so the resize handler has an answer that
        // describes the moment BEFORE the keyboard changed the geometry.
        state.threadAtEnd = lookingAtNewest(threadEl)
        if (atNewest(threadEl)) forgetArrivals()
      },
      { passive: true },
    )
    // And once now, because a conversation you have not scrolled at all is the
    // common case and it has never fired a scroll event.
    state.threadAtEnd = lookingAtNewest(threadEl)
    /*
      The keyboard opening must not hide the newest message (#197).

      `.chatbody` is sized in `dvh`, so the column shrinks by itself when the
      keyboard comes up — that is the whole of the keyboard handling and it
      needs no `visualViewport` listener. What it does NOT do is move the
      thread's own scroll: the box gets shorter around a scroll position that
      was correct for a taller box, and the message you were looking at slides
      out of view behind the composer.

      So: if you were at the newest message before the resize, you still are
      after it. If you were reading further up, you are left there — the same
      rule `keepingPlace` applies to arrivals, for the same reason.
    */
    const onResize = () => {
      /*
        Decided BEFORE the layout settles, applied after — and looked up fresh
        each time, which is the half that took a measurement to find.

        `atNewest` has to be asked while the old geometry is still true: once
        the box has shrunk around the old scrollTop the answer is already "no",
        and the handler would refuse to follow at exactly the moment following
        is the point.

        And the element cannot be the one captured when this was wired. A
        resize makes the studio re-render, which REPLACES the thread — so the
        captured node is detached by the time the handler runs, and setting
        `scrollTop` on it moves nothing at all. That is the eighteen-dead-panel-
        buttons shape: everything present, everything wired, nothing connected
        to what is on screen. Found by printing scrollHeight and seeing 261
        where 3,561 was expected — a different element entirely.

        Pinned on the next frame and again after a moment, because on iOS the
        keyboard animates in and the viewport passes through several heights
        before it settles.
      */
      /*
        The QUESTION is asked of the live element too, not only the answer.

        A first fix looked the thread up fresh inside `pin` and left the guard
        reading the captured node — which by then was detached, so `atNewest`
        measured a box that is not on the screen, said "no", and returned
        before pinning anything. Half a fix reads exactly like no fix: the
        scroll position stayed at zero and the message said the thread did not
        follow, which was true and for a different reason than the one already
        written down.
      */
      const now = $('[data-thread]')
      if (now === null) return
      if (state.threadAtEnd === false) return
      const pin = () => {
        const live = $('[data-thread]')
        if (live === null) return
        live.scrollTop = live.scrollHeight
      }
      pin()
      requestAnimationFrame(pin)
      window.setTimeout(pin, 180)
      window.setTimeout(pin, 420)
    }
    window.removeEventListener('resize', state.onResize ?? (() => {}))
    state.onResize = onResize
    window.addEventListener('resize', onResize, { passive: true })
    if (window.visualViewport !== undefined && window.visualViewport !== null) {
      /*
        And the visual viewport, which is the only thing that reports the
        keyboard on iOS. `resize` on `window` does not always fire when the
        keyboard opens there — the layout viewport is unchanged; it is the
        VISUAL one that shrinks, which is also what `dvh` tracks.
      */
      window.visualViewport.removeEventListener('resize', state.onResize2 ?? (() => {}))
      state.onResize2 = onResize
      window.visualViewport.addEventListener('resize', onResize, { passive: true })
    }

    /*
      And the PAGE's scroll, which is the one that moves on a phone. Without
      this the badge would appear correctly there and then never go away when
      the person scrolled down to the message it was pointing at.
    */
    const onPageScroll = () => {
      if (atNewest(threadEl)) forgetArrivals()
    }
    window.removeEventListener('scroll', state.onPageScroll ?? (() => {}))
    state.onPageScroll = onPageScroll
    window.addEventListener('scroll', onPageScroll, { passive: true })

    arrivedBtn.addEventListener('click', () => {
      /*
        Scroll whichever scroller is in charge. On a phone the thread has none
        of its own, so scrolling it does nothing at all and the button would
        look dead — pressed, dismissed, and you are still where you were.
      */
      if (threadEl.scrollHeight - threadEl.clientHeight > 8) {
        threadEl.scrollTo({ top: threadEl.scrollHeight, behavior: 'smooth' })
      } else {
        threadEl.scrollIntoView({ block: 'end', behavior: 'smooth' })
      }
      forgetArrivals()
      /*
        Focus follows the jump (#200): pressing a control that moves you
        somewhere and leaving focus behind on the now-hidden control is how
        focus ends up on `body`, which is the acceptance criterion this is
        answering. The last message takes it.
      */
      const last = threadEl.querySelector('.msg:last-of-type')
      if (last !== null) {
        last.setAttribute('tabindex', '-1')
        last.focus({ preventScroll: true })
      }
    })
  }

  const composer = $('[data-composer]', root)
  if (composer) {
    const say = $('[data-say]', composer)
    const thread = $('[data-thread]', root)
    /*
      A thread you have to scroll to read is a thread you do not read — so it
      opens at the bottom. But NOT while somebody is reading further up (#205).

      This line ran on every render, unconditionally, and it undid the whole
      point of `keepingPlace` for one frame: the jump to the bottom fired the
      thread's own scroll listener, which correctly concluded that the reader
      had reached the newest message and dismissed the badge — and only then
      did `keepingPlace` put the scroll back where it was. The badge could
      therefore never be seen, while every part of the mechanism behind it
      worked. A defect made entirely of two correct behaviours in the wrong
      order.
    */
    if (thread && state.wasReading !== true) thread.scrollTop = thread.scrollHeight

    // Grow to fit, up to a point. A one-line box for a paragraph is a box that
    // hides what you wrote from you.
    const fit = () => {
      say.style.height = 'auto'
      say.style.height = `${Math.min(say.scrollHeight, 160)}px`
    }
    /*
      An unsent draft survives a repaint, and a trip to another tab (#197).

      The composer is rebuilt on every render, and the studio renders on a
      pulse tick, on a write, and on every tab change — so a half-typed message
      was lost to a background refresh that had nothing to do with it. `pulse`
      already refuses to refetch while a textarea holds text, which covers the
      timer and not the other two.

      Kept on `state` and per project, not in localStorage: an unsent message is
      this session's business, and a draft that outlives the tab would reappear
      days later with no idea what it was about.
    */
    say?.addEventListener('input', () => {
      fit()
      state.drafts[state.project] = say.value
    })
    const draft = state.drafts[state.project]
    if (say !== null && typeof draft === 'string' && draft !== '' && say.value === '') {
      say.value = draft
      fit()
    }
    // Enter sends, Shift+Enter breaks the line — the convention everywhere else.
    say?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); composer.requestSubmit() }
    })

    composer.addEventListener('submit', (e) => {
      e.preventDefault()
      // Sending ends the dictation it came from — the words are already in the
      // box, and holding the microphone across a send is #102 again (#196).
      dictate.stop()
      const text = say.value.trim()
      if (text === '') return
      /*
        Shown instantly, asked behind it (#103).

        `send` writes what you typed plus a placeholder and returns; `ask`
        posts to the office and replaces the placeholder with what it actually
        said. A composer that waits for the network before showing your own
        words feels broken even when it is fast.
      */
      const about = state.attach
      const to = state.askWho ?? 'everyone'
      // Only when somebody is named. With "the whole team" there is nobody for
      // a companion to be a companion OF, and the control is not drawn.
      const also = to === 'everyone' ? [] : (state.askAlso ?? [])
      chat.send(state.project, text, about, to, also)
      // It has been said, so it is no longer a draft — without this it would
      // be restored into the empty composer on the very next render (#197).
      state.drafts[state.project] = ''
      state.attach = null
      // The selection is per MESSAGE, not a preference — the same reasoning
      // the comment above gives for not persisting the addressee. Two people
      // asked about one thing is not a standing instruction to ask them again.
      state.askAlso = []
      state.askAlsoOpen = false
      render()
      const t = $('[data-thread]')
      if (t) t.scrollTop = t.scrollHeight
      $('[data-say]')?.focus()
      void chat.ask(state.project, text, about, presented(), to, also, () => {
        // Sending -> waiting -> no answer yet. Each of those is a repaint, and
        // without this the row would say "Sending" until the answer landed.
        keepingPlace(() => { render() })
      }).then(async () => {
        /*
          Then re-read the office's own copy (#192).

          The turn's reply is what the office SAID; the conversation is what it
          has RECORDED, and they are not the same object — an answer delivered
          into Slack, or a message Grant typed there, only exists in the second.
          Reading it back is what makes this thread the record rather than a
          transcript of this browser.
        */
        await chat.load(state.project, byId(state.project)?.id, presented())
        /*
          Through `keepingPlace`, not a bare render (#205).

          This used to force the thread to the bottom when the answer landed.
          That is right most of the time — you asked, so you want the answer —
          and wrong in the case that matters: somebody who asked a question and
          then scrolled up to re-read what the answer is about gets the ground
          yanked from under them, which is precisely the annoyance #199 fixed
          everywhere else. `keepingPlace` still scrolls to the answer when you
          are at the bottom, which is almost always; when you are not, the
          badge says the answer is there.
        */
        keepingPlace(() => { render() })
      })
    })

    /*
      Remembered on `state`, not in localStorage.

      Who you are asking is a property of the conversation you are in the
      middle of, not a preference — carrying it across a reload would mean
      opening the studio tomorrow and silently addressing Emma because of
      something asked last night.
    */
    /*
      Redrawing the composer loses what is in the box, so it is carried across
      by hand here and in both handlers below — the draft store only saves on
      input, and a person who has typed a sentence and then picks an addressee
      must not watch it vanish.
    */
    const keepingText = (change) => {
      const keep = $('[data-say]')?.value ?? ''
      change()
      render()
      const box = $('[data-say]')
      if (box) {
        box.value = keep
        box.focus()
      }
    }

    $('[data-askwho]', composer)?.addEventListener('change', (e) => {
      const chosen = e.currentTarget.value
      keepingText(() => {
        state.askWho = chosen
        /*
          Changing WHO answers clears who else was asked (#26).

          The companions were picked relative to a person — "Emma, and Daniel
          too" — so keeping them after switching to Oliver would send a
          selection Grant never made. Clearing is the only reading that cannot
          be wrong, and reopening the row costs one press.
        */
        state.askAlso = []
      })
    })

    // The disclosure. Shut by default, so the common case — ask the team, say
    // nothing about who — is exactly as short as it was before #26's middle
    // option existed.
    $('[data-askalso-open]', composer)?.addEventListener('click', () => {
      keepingText(() => {
        state.askAlsoOpen = state.askAlsoOpen !== true
        if (state.askAlsoOpen !== true) state.askAlso = []
      })
    })

    for (const b of composer.querySelectorAll('[data-askalso]')) {
      b.addEventListener('click', () => {
        const slug = b.dataset.askalso
        keepingText(() => {
          const now = state.askAlso ?? []
          state.askAlso = now.includes(slug) ? now.filter((x) => x !== slug) : [...now, slug]
        })
      })
    }

    /*
      Dictation (#196).

      One press starts, the next stops; the words land in the box and nothing
      is sent. `dictate.stop()` releases the microphone rather than asking for
      one more result, because #102's defect was a microphone that stayed open
      after being switched off.

      Deliberately NOT calling `render()` while it runs. The studio rebuilds
      the composer on a pulse tick, a write and every tab change, and a repaint
      mid-sentence would swap out the textarea the recogniser is writing into.
      The button and the status line are updated in place instead — which is
      also why `pulse` already refuses to refetch while a textarea holds text.
    */
    const mic = $('[data-dictate]', composer)
    const dicsay = $('[data-dicsay]', composer)
    if (mic !== null && dictate.supported()) {
      const setSaying = (words) => {
        if (dicsay !== null) dicsay.textContent = words
      }
      const done = (reason) => {
        mic.setAttribute('aria-pressed', 'false')
        mic.classList.remove('on')
        mic.setAttribute('aria-label', 'Dictate a message')
        setSaying(reason === '' ? '' : reason)
        state.drafts[state.project] = say?.value ?? ''
        say?.focus()
      }
      mic.addEventListener('click', () => {
        if (dictate.active()) {
          dictate.stop()
          return
        }
        const began = dictate.start(say, {
          onchange: (value) => {
            fit()
            state.drafts[state.project] = value
          },
          onstop: done,
        })
        if (!began) {
          setSaying('Dictation could not start. Try again.')
          return
        }
        mic.setAttribute('aria-pressed', 'true')
        mic.classList.add('on')
        mic.setAttribute('aria-label', 'Stop dictating')
        setSaying('Listening. Press again to stop — nothing is sent until you do.')
      })
    }

    /*
      Send it again (#202).

      Delegated from the composer block because the button lives in a bubble
      inside the thread, which is rebuilt on every render — a listener bound to
      the button itself would be lost on the next repaint, and the repaint
      happens the moment the retry succeeds.
    */
    $('[data-thread]', root)?.addEventListener('click', (e) => {
      const btn = e.target.closest?.('[data-retry-send]')
      if (!btn) return
      const job = btn.getAttribute('data-retry-send')
      if (job === null || job === '') return
      btn.disabled = true
      btn.textContent = 'Sending…'
      void act('retry_send', { p_job_id: job })
        .then(async (r) => {
          /*
            The office's own sentence, not one invented here. `retry_job_deliveries`
            returns `says` precisely so the page does not have to guess whether
            one delivery was queued or four.
          */
          announce(r?.says ?? 'Queued again.')
          await chat.load(state.project, byId(state.project)?.id, tokenNow())
          keepingPlace(() => { render() })
        })
        .catch((err) => {
          btn.disabled = false
          btn.textContent = 'Try again'
          announce(`It could not be queued: ${err instanceof Error ? err.message : String(err)}`)
        })
    })

    $('[data-unattach]', composer)?.addEventListener('click', () => {
      state.attach = null
      render()
      $('[data-say]')?.focus()
    })
  }

  /*
    The review gate, and it lives in the office now (#28).

    `workspace.decide` wrote to `localStorage`, so the decision Grant made on a
    laptop was invisible on his phone and invisible to every agent — and the
    thing #28 calls "what moves an artifact into the project" moved nothing.
    Import creates the document; Drop and Undo set `reviewer_status`.
  */
  /*
    Preview before the decision (#28).

    The specification draws Preview / Discuss ABOVE the import gate, and the
    reason is the obvious one: approving something you have not opened is not a
    review gate. Discuss was already here as the named-action menu on the
    request (#27); Preview was not, so the only way to read an output before
    deciding on it was to import it first, which is the decision.

    The document is built the way `allDocs` builds an approved one, because an
    output awaiting review is not in the gallery yet - that is what it is
    waiting for - so there is nothing to look up. `fillDoc` fetches the body by
    id over the same API the gallery uses.
  */
  for (const b of root.querySelectorAll('[data-out-open]')) {
    b.addEventListener('click', () => {
      const r = workspace.rows(byId(state.project)).find((x) => x.id === b.dataset.outRow)
      if (!r?.output) return
      openDoc({ ...r.output, origin: `${crewBy(r.who).name} · ${r.delivered}` }, b)
    })
  }

  for (const b of root.querySelectorAll('[data-import]')) {
    b.addEventListener('click', () => {
      state.importing = { output: b.dataset.import, title: b.dataset.importTitle }
      importSheet(byId(state.project))
    })
  }
  for (const b of root.querySelectorAll('[data-drop]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Dropping…',
        () => act('output_decide', { p_output: b.dataset.drop, p_verdict: 'rejected' }),
        'Dropped. It stays on the record.',
      )
      if (done) await refresh()
    })
  }
  for (const b of root.querySelectorAll('[data-undecide]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Undoing…',
        () => act('output_decide', { p_output: b.dataset.undecide, p_verdict: 'pending' }),
        'Back in the waiting list.',
      )
      if (done) await refresh()
    })
  }

  // The old localStorage gate, still here for the mock rows that carry no
  // output id — the prototype data has no real outputs behind it.
  for (const b of root.querySelectorAll('[data-decide]')) {
    b.addEventListener('click', () => {
      const verdict = b.dataset.decide
      workspace.decide(state.project, b.dataset.rowId,
        verdict === 'approve' ? 'approved' : verdict === 'discard' ? 'discarded' : null)
      render()
    })
  }

  const board = $('[data-board]', root)
  if (board) {
    const p = byId(state.project)
    const mine = panels.layout(p)
    panels.wire(board, p, mine, render)
    markPanelScroll(board)
    $('[data-add-open]', root)?.addEventListener('click', (e) => {
      e.stopPropagation()
      const menu = $('[data-add-menu]', root)
      if (menu) menu.hidden = !menu.hidden
    })
    for (const b of root.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => {
        const kind = panels.KINDS.find((k) => k.id === b.dataset.add)
        // A new panel lands at the bottom of the shortest column, which is
        // where a person would have put it.
        const y = mine.reduce((m, s2) => Math.max(m, s2.y + s2.h), 0) + 20
        panels.save(p.slug, [...mine, { id: kind.id, x: 0, y, w: kind.w, h: kind.h }])
        render()
      })
    }
    $('[data-reset-panels]', root)?.addEventListener('click', () => {
      panels.reset(p.slug)
      render()
    })
    document.addEventListener('click', () => {
      const menu = $('[data-add-menu]')
      if (menu) menu.hidden = true
    }, { once: true })
  }

  /*
    The home board, wired through the same engine (#219).

    Its own block rather than a branch inside the project one: they share the
    engine and nothing else - different kinds, a different place to save to,
    and a different set of controls. Folding them together would mean four
    conditionals to save eight lines.
  */
  const homeBoard = $('[data-home-board]', root)
  if (homeBoard) {
    const mine = panels.homeLayout()
    panels.wire(homeBoard, { home: true }, mine, render)
    markPanelScroll(homeBoard)
    $('[data-home-add-open]', root)?.addEventListener('click', (e) => {
      e.stopPropagation()
      const menu = $('[data-home-add-menu]', root)
      if (menu) menu.hidden = !menu.hidden
    })
    for (const b of root.querySelectorAll('[data-home-add]')) {
      b.addEventListener('click', () => {
        const kind = panels.HOME_KINDS.find((k) => k.id === b.dataset.homeAdd)
        if (kind === undefined) return
        const y = mine.reduce((m, s2) => Math.max(m, s2.y + s2.h), 0) + 20
        panels.homeSave([...mine, { id: kind.id, x: 0, y, w: kind.w, h: kind.h }])
        render()
      })
    }
    $('[data-home-reset]', root)?.addEventListener('click', () => {
      panels.homeReset()
      render()
    })
    document.addEventListener('click', () => {
      const menu = $('[data-home-add-menu]')
      if (menu) menu.hidden = true
    }, { once: true })
  }

  /*
    Filtering what is open, on the home board (#219).

    Grant's list was due soon, overdue, priority, project, assigned agent and
    status. Four of those are columns the payload carries and those four are
    offered; priority is not a column `tasks` has, and a pill that silently
    matches everything is a control that lies.
  */
  for (const b of root.querySelectorAll('[data-home-tasks]')) {
    b.addEventListener('click', () => {
      state.homeTasks = b.dataset.homeTasks
      keepingPlace(() => { render() })
    })
  }

  const shelf = $('[data-shelf]', root)
  if (shelf) {
    const step = () => (shelf.firstElementChild?.getBoundingClientRect().width ?? 200) + 20
    $('[data-shelf-back]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: -step() * 2, behavior: 'smooth' }))
    $('[data-shelf-on]', root)?.addEventListener('click', () =>
      shelf.scrollBy({ left: step() * 2, behavior: 'smooth' }))
  }

  for (const b of root.querySelectorAll('[data-doc]')) {
    const docs = allDocs(byId(state.project))
    const doc = docs[Number(b.dataset.doc)]
    if (doc?.file) paint($('.page', b), doc.file, 320)
    tiltable($('.page', b), { max: 7, scale: 1.03 })
    b.addEventListener('click', () => openDoc(doc, b))
  }
}

/*
  Document card → viewer.

  The rendered page is the shared element and scales into place; the grid behind
  dims and does not move. Reference 4: the object you touched is the object you
  land in.
*/
/*
  The whole record, when you want it.

  A field with nothing in it is omitted rather than shown empty: "Phone —" tells
  you nothing that the absence of a phone row does not, and four of them make a
  contact look unfinished when it is simply a person whose number you do not
  have.
*/
/*
  Choosing how a project looks (#83).

  One sheet, three ways to answer, in the order a person would try them: pick a
  mark, colour it, or use a picture of your own. The fourth is Reset, because a
  choice you cannot undo is a choice people do not make.

  ## Resized in the browser, before it is sent

  A photo off a phone is twelve megapixels and four megabytes, and it is going
  to be drawn at 88px. Sending it would spend most of a free tier on pixels
  nobody sees. So it is drawn into a 256px canvas and encoded as WebP, which is
  typically ten to twenty KB, and the RPC refuses anything over 96 KB -- which
  can only happen if this resize did not run, and is worth failing loudly on.

  It is a data URL rather than Supabase Storage. Uploading from the browser
  would need a storage credential IN the browser, and there is one bearer token
  and CLAUDE.md forbids adding an auth system. Migration 0253 records the whole
  reasoning and the size it stops being right at.
*/
/*
  Editing a task (#106).

  `hq_task_add` could make one and `hq_task_state` could move it between the
  five states, and that was everything reachable. Renaming a task, moving its
  date, handing it to somebody, making it a subtask or a milestone: every column
  was in the table and nothing could touch any of them.

  ## One form, and the state is not in it

  `hq_task_state` owns `state`, because it also maintains `done_at` and enforces
  the reason a blocked task needs. The tick on the row is that control and it
  already works; putting a second one here would be two ways to write one column
  and they would disagree the first time one of them forgot the constraint.

  ## Removing is not the same as leaving alone

  Every field sends only what changed, and `p_clear` says what is being taken
  away — null cannot mean both. "This is not happening this week after all" is
  a due date REMOVED, which without `p_clear` there is no way to say.

  ## The date is `due_on`, not `due`

  `due` is already rendered as "Due 1 October" for the list. A date input cannot
  take that, and an editor that parsed a rendered string back into a date would
  be a bug waiting for a locale — so migration 0256 puts the raw values on the
  row beside the rendered ones.
*/
function taskSheet(t, p) {
  const v = $('#viewer')
  const others = p.tasks.filter((x) => x.id !== undefined && x.id !== t.id)
  v.innerHTML = `<div class="sheet ${esc(p.hue)}">
      <div class="chead">
        <span>
          <h2 class="t-title" style="margin:0">Edit this task</h2>
          <p class="t-meta" style="margin:4px 0 0">On ${esc(p.name)}. The tick on the
            row is what marks it done — this is everything else.</p>
        </span>
      </div>
      <form class="taskedit" data-task-edit-form data-saidwrap>
        <label class="field"><span class="t-label">Title</span>
          <input name="title" value="${esc(t.title ?? '')}" maxlength="200" required></label>
        <label class="field"><span class="t-label">Note</span>
          <textarea name="detail" rows="2" maxlength="2000"
            placeholder="The thing you did not have time to write down">${esc(t.note ?? '')}</textarea></label>
        <label class="field"><span class="t-label">Due</span>
          <input type="date" name="due_on" value="${esc(t.due_on ?? '')}"></label>
        <label class="field"><span class="t-label">Starts</span>
          <input type="date" name="starts_on" value="${esc(t.starts_on ?? '')}"></label>
        <label class="field"><span class="t-label">Who</span>
          <select name="assignee">
            <option value="">Nobody yet</option>
            ${CREW.map((c) => `<option value="${esc(c.slug)}"${
              c.slug === t.who ? ' selected' : ''
            }>${esc(c.name)}</option>`).join('')}
          </select></label>
        <label class="field"><span class="t-label">Under</span>
          <select name="parent">
            <option value="">Nothing — it stands on its own</option>
            ${others.map((x) => `<option value="${esc(x.id)}"${
              x.id === t.parent ? ' selected' : ''
            }>${esc(x.title)}</option>`).join('')}
          </select></label>
        <label class="field"><span class="t-label">Priority</span>
          <input type="number" name="priority" min="1" max="999"
            value="${esc(String(t.priority ?? 100))}"></label>
        <label class="field"><span class="t-label">Milestone</span>
          <span class="checkrow"><input type="checkbox" name="milestone"${
            t.milestone === true ? ' checked' : ''
          }> <span class="t-meta">A point the work is measured against, not a job to do</span></span></label>
        <div class="lookrow">
          <button class="btn primary" type="submit">Save</button>
          <button class="btn quiet" type="button" data-task-edit-close>Cancel</button>
          <span class="t-meta" data-said></span>
        </div>
      </form>
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`

  sheet(v, true)
  const shut = () => { sheet(v, false) }
  $('.close', v).addEventListener('click', shut)
  $('[data-task-edit-close]', v)?.addEventListener('click', shut)
  v.addEventListener('click', (e) => { if (e.target === v) shut() })

  const form = $('[data-task-edit-form]', v)
  form?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = new FormData(form)
    const said = (k) => String(f.get(k) ?? '').trim()
    const args = { p_task_id: t.id }
    const clear = []

    /*
      Only what CHANGED, and a field emptied is a clear.

      Sending every field on every save would work and would be wrong in one
      specific way: it would overwrite a value somebody else — an agent, the
      Telegram bot — changed between this sheet opening and Save being pressed.
      Sending only the edits makes the collision as narrow as the edit.
    */
    const was = (k, now) => (String(t[k] ?? '') === now ? null : now)
    const title = was('title', said('title'))
    if (title !== null && title !== '') args.p_title = title
    const detail = was('note', said('detail'))
    if (detail !== null) { detail === '' ? clear.push('detail') : (args.p_detail = detail) }
    for (const [field, key] of [['due_on', 'due_on'], ['starts_on', 'starts_on']]) {
      const now = was(field, said(field))
      if (now === null) continue
      now === '' ? clear.push(key) : (args[`p_${key}`] = now)
    }
    const who = was('who', said('assignee'))
    if (who !== null) { who === '' ? clear.push('assignee') : (args.p_assignee = who) }
    const parent = String(t.parent ?? '') === said('parent') ? null : said('parent')
    if (parent !== null) { parent === '' ? clear.push('parent') : (args.p_parent = parent) }
    const priority = Number(said('priority'))
    if (Number.isFinite(priority) && priority !== (t.priority ?? 100)) args.p_priority = priority
    const milestone = f.get('milestone') !== null
    if (milestone !== (t.milestone === true)) args.p_milestone = milestone
    if (clear.length > 0) args.p_clear = clear

    const button = $('button[type=submit]', form)
    if (Object.keys(args).length === 1) {
      say(button, 'Nothing changed.')
      return
    }
    const done = await attempt(button, 'Saving…', () => act('task_update', args), 'Saved.')
    if (done === null) return
    shut()
    await refresh()
  })
}

/*
  What the mark picker is currently showing (#221).

  Module-level rather than passed in, because `lookSheet` is re-entered from
  `set()` after every write — the sheet redraws itself so the preview is the
  stored value — and a search typed into a sheet that then redraws would be
  lost on the first press. Reset when the sheet is opened from the outside.
*/
let markQuery = ''
let markDomain = 'all'

/** The domains, from the library, in the order the build wrote them. */
const markDomains = () =>
  /*
    Sorted. The catalogue is ordered by icon id, so first-appearance order gave
    "people, health, time, travel, ai, creative, documents, business…" — which
    reads as a bug even though every chip works, because a person looking for
    "finance" scans for alphabetical order and does not find it.
  */
  [...new Set(icons.catalogue().map((i) => i.d))].filter((d) => d !== '').sort()

/*
  The grid, filtered.

  The thirty hand-drawn marks are shown FIRST and always, under 'all' and
  under no search that excludes them, because they are what every project that
  already has a mark is using and losing them behind a search would be a
  picker that cannot show you what you have.
*/
/*
  The whole picker, so the CATEGORIES redraw with the grid (#221).

  The first version redrew only the grid when the library landed, and the
  capture showed the consequence immediately: one chip reading "All" and
  nothing else, for ever, because `markDomains()` reads the catalogue and the
  catalogue is empty until the import resolves. A search box with no
  categories beside it looked like a deliberate design rather than a control
  that never arrived — which is the whole argument for opening the PNG rather
  than trusting that it compiles.
*/
function markPicker(p, hue) {
  const cats = ['all', ...markDomains()]
  return `<span class="iconfind">
      <input class="in" type="search" data-icon-search placeholder="Search 451 marks"
             aria-label="Search marks" value="${esc(markQuery)}">
      ${cats.length < 2 ? '' : `<span class="iconcats" role="group" aria-label="Icon categories">
        ${cats.map((d) => `<button class="seg ${d === markDomain ? 'on' : ''}"
            data-icon-domain="${esc(d)}" aria-pressed="${d === markDomain ? 'true' : 'false'}"
          >${esc(d === 'all' ? 'All' : d)}</button>`).join('')}
      </span>`}
    </span>
    <span class="iconpick ${esc(hue)}" data-icon-grid>${markGrid(p)}</span>`
}

function markGrid(p) {
  const q = markQuery.trim().toLowerCase()

  /*
    Gathered as data first, then rendered, so the roving tabindex can be
    decided once against the WHOLE filtered view (#121).

    The first draft decided it inside the map, which cannot answer the
    question it needs to: if the chosen mark is not in this filtered view,
    something else has to be the tab stop, and you only know that after you
    have looked at all of them. A grid where every button is -1 has no tab
    stop at all — filter the gallery and it leaves the tab order entirely.
  */
  const rows = []
  if (markDomain === 'all') {
    for (const k of icons.KEYS) {
      if (q === '' || k.includes(q)) rows.push({ k, label: k })
    }
  }
  for (const i of icons.catalogue()) {
    if (markDomain !== 'all' && i.d !== markDomain) continue
    if (q !== '' && !i.id.includes(q) && !i.t.some((t) => t.includes(q))) continue
    rows.push({ k: i.id, label: i.id.replace(/-/g, ' ') })
  }

  if (rows.length === 0) {
    return icons.ready()
      ? `<span class="t-meta">Nothing matches ${esc(markQuery)}.</span>`
      : '<span class="t-meta">Fetching the rest of the marks…</span>'
  }

  /*
    A ROVING tabindex, so the grid is one tab stop rather than 451.

    #221 took this grid from thirty-six marks to 451, and thirty-six was
    already the example #121 uses for why the studio is a mouse-only product.
    Four hundred and fifty one stops between the search box and the picture
    controls is not a slow keyboard path, it is a wall: nobody Tabs past it,
    so everything below it becomes unreachable without a pointer.

    The chosen mark is the stop when it is on screen, so Tab lands where the
    eye already is; otherwise the first one is. Arrows move it from there.
  */
  const at = Math.max(
    0,
    rows.findIndex((r) => r.k === p.icon),
  )
  return rows
    .map((r, n) => {
      const chosen = r.k === p.icon
      return `<button class="iconopt ${chosen ? 'on' : ''}"
        data-look-icon="${esc(r.k)}" aria-label="${esc(r.label)}" title="${esc(r.label)}"
        tabindex="${n === at ? '0' : '-1'}"
        aria-pressed="${chosen ? 'true' : 'false'}">${icons.svg(r.k, 22)}</button>`
    })
    .join('')
}

function lookSheet(p, keepSearch = false) {
  const v = $('#viewer')
  if (!keepSearch) {
    markQuery = ''
    markDomain = 'all'
  }
  /*
    Start the import the moment the sheet opens, and redraw the grid when it
    lands. Nothing else on the page waits for it — the thirty render at once,
    and the other 451 arrive a beat later.
  */
  void icons.load().then(() => {
    /*
      The whole picker, not just the grid. Losing focus here is not a cost:
      this runs once, a beat after the sheet opens, before anybody has typed.
      Every later redraw is the grid alone, for exactly the opposite reason.
    */
    const host = $('[data-icon-picker]', v)
    if (host !== null) host.innerHTML = markPicker(p, p.iconHue ?? p.hue)
  })
  const chosenHue = p.iconHue ?? p.hue
  v.innerHTML = `<div class="sheet ${esc(p.hue)}">
      <div class="chead">
        <span class="hero ${esc(p.hue)}" style="width:56px;height:56px;border-radius:14px">
          ${look(p, { dense: true, facts: p })}
        </span>
        <span>
          <h2 class="t-title" style="margin:0">How ${esc(p.name)} looks</h2>
          <p class="t-meta" style="margin:4px 0 0">A mark you pick, or a picture of
            your own. Leave it alone and it keeps the art the office generated.</p>
        </span>
      </div>

      <div class="field" style="margin-top:var(--s5);align-items:flex-start">
        <span class="t-label">Colour</span>
        <span class="huepick">
          ${icons.HUES.map((h) => `<button class="hueswatch ${esc(h)} ${
            h === chosenHue ? 'on' : ''
          }" data-look-hue="${esc(h)}" aria-label="${esc(h.slice(2))}"
             aria-pressed="${h === chosenHue ? 'true' : 'false'}"></button>`).join('')}
        </span>
      </div>

      <div class="field" style="margin-top:var(--s4);align-items:flex-start">
        <span class="t-label">Mark</span>
        <span style="display:grid;gap:var(--s3);min-width:0">
          <!--
            Search first, then the grid (#221). Four hundred and fifty one
            marks is more than anybody browses, and it is also more than
            anybody can find in by scrolling. The domains are lucide's own
            grouping, carried through the build so they are data rather than a
            second opinion.

            No backticks in this comment. It lives inside a template literal.
          -->
          <span data-icon-picker style="display:grid;gap:var(--s3);min-width:0">${
            markPicker(p, chosenHue)
          }</span>
        </span>
      </div>

      <div class="field" style="margin-top:var(--s4);align-items:flex-start">
        <span class="t-label">Picture</span>
        <span style="display:grid;gap:var(--s2);min-width:0">
          <span class="lookrow" data-saidwrap>
            <label class="btn" style="cursor:pointer">
              Choose an image
              <input type="file" accept="image/*" data-look-file hidden>
            </label>
            ${p.image ? '<button class="btn quiet" data-look-clear="image">Remove it</button>' : ''}
            <button class="btn quiet" data-look-clear="all">Back to the generated art</button>
          </span>
          <span class="t-meta" data-said>Resized to 256px here before it is sent, so a
            photo off a phone costs about fifteen kilobytes rather than four megabytes.</span>
        </span>
      </div>
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`

  sheet(v, true)
  $('.close', v).addEventListener('click', () => { sheet(v, false) })
  v.addEventListener('click', (e) => { if (e.target === v) sheet(v, false) })

  /*
    Every change writes and redraws immediately.

    No Save button: the sheet IS the preview, and a picker where you choose a
    mark and then have to confirm it makes you press twice to see one thing.
    `afterWrite` refetches, so what comes back is what the office stored rather
    than what the page hoped.
  */
  /*
    `refresh()`, not `afterWrite()`.

    `afterWrite` is the SETTINGS sheet's, and it re-reads the settings payload
    and redraws the settings sheet — from here it threw `afterWrite is not
    defined` and, had it been in scope, would have replaced this sheet with
    Settings. `refresh()` re-reads the studio payload, which is where a
    project's look lives. Found by pressing an icon rather than by reading it
    back: the mark under the pointer changed, because the page redraws
    optimistically, and the console said the write never completed.
  */
  const set = async (control, args) => {
    const ok = await attempt(control, 'Saving…', () =>
      act('project_look', { p_slug: p.slug, ...args }),
    )
    if (ok === null) return
    await refresh()
    const fresh = byId(p.slug)
    // `true`: keep whatever was searched for. Pressing a mark must not clear
    // the search that found it — the commonest next action is picking a
    // different one from the same results.
    if (fresh) lookSheet(fresh, true)
  }

  for (const b of v.querySelectorAll('[data-look-hue]')) {
    b.addEventListener('click', () => { void set(b, { p_hue: b.dataset.lookHue }) })
  }
  /*
    Delegated, because the grid redraws itself (#221).

    Binding each of four hundred and fifty one buttons worked while the set was
    thirty and fixed. Now a search or a category press replaces the grid's
    innerHTML, and every listener attached to the old nodes goes with it — the
    picker would work once and then be dead, which is the shape of defect
    `verify:controls` exists to catch and would not have caught here, because
    the audit presses each control from a fresh render.
  */
  $('[data-icon-picker]', v)?.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-look-icon]') : null
    if (b === null) return
    // Pressing the mark that is already on takes it off. A picker with no way
    // back to nothing is a picker you can only ever be wrong in.
    const same = b.dataset.lookIcon === p.icon
    void set(b, same ? { p_clear: ['icon'] } : { p_icon: b.dataset.lookIcon })
  })

  /*
    Search and category redraw the GRID only, never the sheet.

    Redrawing the sheet would take the focus out of the search box on every
    keystroke — #197's lesson about a redraw replacing the node you are
    standing on, in its smallest form.
  */
  const regrid = () => {
    const grid = $('[data-icon-grid]', v)
    if (grid !== null) grid.innerHTML = markGrid(p)
  }

  /*
    The arrows, which are what makes one tab stop honest (#121).

    A roving tabindex without them is worse than 451 stops: the grid becomes a
    gallery you can reach and cannot move inside. Left and Right walk the
    list; Up and Down move by a ROW, measured from the live layout rather
    than assumed, because the grid is `auto-fill` and the column count is five
    on a phone and eleven on a desktop — a hardcoded stride would be wrong on
    one of them and the wrong one would depend on who was looking.

    Home and End go to the ends. Enter and Space are not handled: these are
    real buttons, so the browser already presses them, and intercepting keys
    a native control handles is how a picker stops working for somebody using
    a switch or a screen reader.

    Bound on the PICKER, not on the grid — third time in this file today. The
    grid replaces its own innerHTML on every search, category press and when
    the library lands, so a listener on it survives until the first of those
    and then silently does nothing. It measured as "the arrows do not move
    focus", which reads like the handler being wrong rather than absent.
  */
  $('[data-icon-picker]', v)?.addEventListener('keydown', (e) => {
    const from = e.target instanceof Element ? e.target.closest('[data-look-icon]') : null
    if (from === null) return
    const all = [...v.querySelectorAll('[data-look-icon]')]
    const here = all.indexOf(from)
    if (here < 0) return

    // The real column count, from the rendered geometry. Two buttons on the
    // same row share a `top`, so the first one below it starts row two.
    const top = from.getBoundingClientRect().top
    const perRow = Math.max(
      1,
      all.findIndex((b) => b.getBoundingClientRect().top > top + 1) - all.findIndex(
        (b) => Math.abs(b.getBoundingClientRect().top - top) < 1,
      ),
    )

    const to = {
      ArrowRight: here + 1,
      ArrowLeft: here - 1,
      ArrowDown: here + perRow,
      ArrowUp: here - perRow,
      Home: 0,
      End: all.length - 1,
    }[e.key]
    if (to === undefined) return
    const next = all[Math.min(all.length - 1, Math.max(0, to))]
    if (next === undefined) return
    e.preventDefault()
    // Move the stop with the focus, or Tab would come back to where it was.
    from.setAttribute('tabindex', '-1')
    next.setAttribute('tabindex', '0')
    next.focus()
  })
  /*
    The search box and the chips are delegated on the PICKER, because the
    picker replaces its own innerHTML when the library lands — the same reason
    the grid is. A listener bound to a node that is about to be replaced is a
    control that works once.
  */
  $('[data-icon-picker]', v)?.addEventListener('input', (e) => {
    const box = e.target instanceof Element ? e.target.closest('[data-icon-search]') : null
    if (box === null) return
    markQuery = box.value
    regrid()
  })
  $('[data-icon-picker]', v)?.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-icon-domain]') : null
    if (b === null) return
    markDomain = b.dataset.iconDomain ?? 'all'
    for (const other of v.querySelectorAll('[data-icon-domain]')) {
      const on = other === b
      other.classList.toggle('on', on)
      other.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    regrid()
  })
  for (const b of v.querySelectorAll('[data-look-clear]')) {
    b.addEventListener('click', () => {
      void set(b, {
        p_clear: b.dataset.lookClear === 'all' ? ['icon', 'hue', 'image'] : ['image'],
      })
    })
  }

  const file = $('[data-look-file]', v)
  file?.addEventListener('change', async () => {
    const chosen = file.files?.[0]
    if (chosen === undefined) return
    const label = file.closest('label') ?? file
    try {
      const data = await shrink(chosen)
      await set(label, { p_image: data })
    } catch (e) {
      say(label, e instanceof Error ? e.message : 'That image could not be read.', 'bad')
    }
  })
}

/*
  A picture, made small enough to keep.

  256px on the long edge, centre-cropped to a square because every place a
  project is drawn is a square and letting the browser letterbox it puts grey
  bars inside a rounded mark.

  WebP with a JPEG fallback: `toDataURL` returns a PNG when it does not know the
  type asked for, and a 256px PNG photograph is four times the size of the WebP.
  Checking what came back is the only reliable way to know which you got.
*/
function shrink(fileBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileBlob)
    const img = new Image()
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read.')) }
    img.onload = () => {
      URL.revokeObjectURL(url)
      const side = 256
      const canvas = document.createElement('canvas')
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (ctx === null) { reject(new Error('This browser cannot resize the image.')); return }
      const crop = Math.min(img.naturalWidth, img.naturalHeight)
      ctx.drawImage(
        img,
        (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop,
        0, 0, side, side,
      )
      let out = canvas.toDataURL('image/webp', 0.82)
      if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.82)
      if (out.length > 98304) { reject(new Error('That image is still too large after resizing.')); return }
      resolve(out)
    }
    img.src = url
  })
}

function openContact(c) {
  const v = $('#viewer')
  const row = (label, value, href) =>
    value === '' || value === undefined
      ? ''
      : `<div class="field"><span class="t-label">${esc(label)}</span>${
          href ? `<a href="${esc(href)}${esc(value)}">${esc(value)}</a>` : `<span>${esc(value)}</span>`
        }</div>`

  v.innerHTML = `<div class="sheet ${c.hue}">
      <div class="chead">
        <span class="disc big">${esc(c.name[0])}</span>
        <span>
          <h2 class="t-title" style="margin:0">${esc(c.name)}</h2>
          <p class="t-meta" style="margin:4px 0 0">${esc(c.role)}${c.org ? ` · ${esc(c.org)}` : ''}</p>
        </span>
        <span class="stage s-${esc(c.stage)}">${esc(c.stage)}</span>
      </div>
      ${c.note ? `<p class="t-lead" style="margin:var(--s4) 0 0">${esc(c.note)}</p>` : ''}
      <div class="fields">
        ${row('Email', c.email, 'mailto:')}
        ${row('Phone', c.phone, 'tel:')}
        ${row('Where', c.where)}
        ${row('Last spoke', c.last)}
        ${row('Next', c.next ? `${c.next}${c.nextDue ? ` — ${c.nextDue}` : ''}` : '')}
      </div>
      ${(() => {
        const extra = people.fieldsOn(c)
        return extra.length === 0 ? '' : `<div class="fields">${extra.map((f, i) =>
          `<div class="field">
             <span class="t-label">${esc(f.label)}</span>
             <span class="withx">${esc(f.value)}
               <button class="x" data-drop-field="${i}" aria-label="Remove ${esc(f.label)}">×</button>
             </span>
           </div>`).join('')}</div>`
      })()}

      <!--
        Adding a field.

        Grant: *"metadata fields should be dynamically added/removed on the UI
        anyway"*. Two inputs and a button rather than a modal, because the whole
        interaction is "this person has a Zoom handle and there is nowhere to
        put it" and anything heavier than typing it in place is in the way.
      -->
      <form class="addfield" data-add-field>
        <input name="label" placeholder="Field name" aria-label="Field name" maxlength="32">
        <input name="value" placeholder="Value" aria-label="Value" maxlength="120">
        <button class="btn" type="submit">Add field</button>
      </form>

      <div class="field" style="margin-top:var(--s4);align-items:flex-start">
        <span class="t-label">Labels</span>
        <span class="tagpick">
          ${people.labels().map((l) => {
            const on = people.labelsFor(c).some((x) => x.id === l.id)
            return `<button class="tag ${l.hue} ${on ? 'on' : 'off'}"
                     data-toggle-label="${l.id}">${esc(l.name)}</button>`
          }).join('')}
          <button class="tag add" data-label-edit>Edit labels</button>
        </span>
      </div>

      ${
        c.docs.length === 0
          ? ''
          : `<div class="field" style="margin-top:var(--s4)">
               <span class="t-label">Documents</span>
               <span class="doclinks">${c.docs.map((d) => `<span class="link">${esc(d)}</span>`).join('')}</span>
             </div>`
      }
    </div>
    <button class="close" aria-label="Close">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>`
  carry(null, null, () => { sheet(v, true) })
  $('.close', v).addEventListener('click', () => { sheet(v, false) })
  v.addEventListener('click', (e) => { if (e.target === v) sheet(v, false) })

  /*
    Labels and fields go to the office now (#110, migration 0285), so every one
    of these is a round trip that can be refused. `after` redraws on success and
    says what the office said on a refusal — §5: the page repeats the RPC's
    words rather than inventing softer ones.
  */
  const again = (err) => {
    openContact(c)              // redraw the sheet
    render()                    // and the rows behind it
    sheet($('#viewer'), true)
    if (err) say($('.sheet', $('#viewer')), err.message, 'warn')
  }
  const send = (work) => {
    work().then(() => { again() }).catch((err) => { again(err) })
  }

  for (const b of v.querySelectorAll('[data-toggle-label]')) {
    b.addEventListener('click', () => { send(() => people.toggleLabel(c, b.dataset.toggleLabel)) })
  }
  for (const b of v.querySelectorAll('[data-drop-field]')) {
    b.addEventListener('click', () => { send(() => people.removeField(c, Number(b.dataset.dropField))) })
  }
  const form = $('[data-add-field]', v)
  form?.addEventListener('submit', (e) => {
    e.preventDefault()
    const label = form.label.value.trim()
    const value = form.value.value.trim()
    if (label === '') return
    send(() => people.addField(c, label, value))
  })
  for (const b of v.querySelectorAll('[data-label-edit]')) {
    b.addEventListener('click', () => { labelEditor(() => { openContact(c); sheet($('#viewer'), true) }) })
  }
}

/*
  Defining the labels themselves.

  Grant: *"let me define those labels myself in the UI"*. Rename in place,
  delete, add — and deleting one takes it off everybody rather than leaving an
  id nothing resolves. Colour is picked from the same six project hues, so a
  label he invents looks like it belongs.
*/
function labelEditor(after) {
  const v = $('#settings')
  const draw = () => {
    v.innerHTML = `<div class="sheet">
        <h2 class="t-title" style="margin:0">Labels</h2>
        <p class="t-meta" style="margin:6px 0 var(--s4)">Yours to name. Deleting one removes
          it from everybody.</p>
        <div class="labellist">
          ${people.labels().map((l) => `
            <div class="labelrow ${l.hue}">
              <span class="swatchdot"></span>
              <input value="${esc(l.name)}" data-rename="${l.id}" aria-label="Label name" maxlength="24">
              <button class="x" data-remove="${l.id}" aria-label="Delete ${esc(l.name)}">×</button>
            </div>`).join('')}
        </div>
        <form class="addfield" data-add-label style="margin-top:var(--s4)">
          <input name="name" placeholder="New label" aria-label="New label" maxlength="24">
          <button class="btn primary" type="submit">Add</button>
        </form>
      </div>
      <button class="close" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`

    /*
      Every one of these is a round trip since #110. A refusal — a duplicate
      name is the one that actually happens — is shown beside the list rather
      than swallowed, and the list is redrawn from what the office returned
      rather than from what was typed.
    */
    const send = (work) => {
      work()
        .then(() => { draw() })
        .catch((err) => { draw(); say($('.sheet', v), err.message, 'warn') })
    }

    for (const i of v.querySelectorAll('[data-rename]')) {
      i.addEventListener('change', () => {
        send(() => people.renameLabel(i.dataset.rename, i.value.trim() || 'Label'))
      })
    }
    for (const b of v.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', () => { send(() => people.removeLabel(b.dataset.remove)) })
    }
    const f = $('[data-add-label]', v)
    f?.addEventListener('submit', (e) => {
      e.preventDefault()
      const name = f.name.value.trim()
      if (name === '') return
      f.name.value = ''
      send(() => people.addLabel(name))
    })
    $('.close', v).addEventListener('click', () => { sheet(v, false); render(); after?.() })
  }
  draw()
  sheet(v, true)
}

/*
  Opening a document shows the document (#95, #96).

  It used to draw `pageSvg(doc.title, doc.kind)` — a GENERATED ILLUSTRATION of
  a page, the same drawing the grid thumbnail uses, at a larger size. The text
  was never rendered anywhere, at any length. Grant's issue said "show complete
  documents" and the honest reading of that was that it truncated; it did not
  truncate, it never showed any.

  The illustration is still what you see while the text is on its way, and it
  is still what you get for a document the office cannot read back — an audio
  file, or a Notion database container that is a folder rather than a page.
  It is a good drawing. It was only ever the wrong thing to stop at.

  The fetch is per document and deliberate: `hq_studio` carries up to 24
  documents per project and cannot carry their text — the longest document in
  the office is 180,000 characters. Metadata in the grid, content on open, the
  same shape `needLately()` uses.
*/
/**
 * What you can do to a document, in the sheet that opens it (#152).
 *
 * Grant: *"A document opens, and that is all it does. You can read it and talk
 * about it."* Four things reach `documents` now — rename, move, supersede and
 * pin — and they are here rather than on the card because a card with four
 * buttons on it is the opposite of what #25 just spent a morning establishing.
 *
 * Drawn only for a REAL document and only for a writer. The prototype's
 * documents are invented and have no id, so offering to rename one would be a
 * control that resolves, looks right and cannot work — the shape this
 * repository keeps finding. A reader sees the document and no controls, which
 * is the truth about what a reader can do.
 */
function docActions(doc) {
  if (doc.id === undefined || doc.id === null || !canWrite()) return ''
  const here = byId(state.project)
  const elsewhere = PROJECTS.filter((x) => x.slug !== state.project)
  const others = (here.documents ?? []).filter((d) => d.id !== undefined && d.id !== doc.id)
  const gone = doc.state === 'superseded'
  return `<div class="docacts" data-saidwrap>
    <button class="btn small ${doc.pinned === true ? 'primary' : 'quiet'}"
            data-doc-pin="${esc(doc.id)}" data-doc-pinned="${doc.pinned === true}"
            aria-pressed="${doc.pinned === true}">
      ${doc.pinned === true ? 'Pinned' : 'Pin this one'}</button>

    <span class="docact">
      <input data-doc-title value="${esc(doc.title)}" aria-label="The document's title">
      <button class="btn small" data-doc-rename="${esc(doc.id)}">Rename</button>
    </span>

    ${
      elsewhere.length === 0
        ? ''
        : `<span class="docact">
      <select data-doc-to aria-label="Move this document to another project">
        ${elsewhere.map((x) => `<option value="${esc(x.id ?? '')}">${esc(x.name)}</option>`).join('')}
      </select>
      <button class="btn small" data-doc-move="${esc(doc.id)}">Move</button>
    </span>`
    }

    ${
      gone
        ? `<button class="btn small" data-doc-restore="${esc(doc.id)}">This one is current again</button>`
        : others.length === 0
          ? ''
          : `<span class="docact">
      <select data-doc-by aria-label="The document that replaced this one">
        ${others.map((d) => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join('')}
      </select>
      <button class="btn small" data-doc-supersede="${esc(doc.id)}">Replaced by</button>
    </span>`
    }
    <span class="t-meta" data-said></span>
  </div>
  ${docOrganising(doc)}`
}

/**
 * Tags and collections, on the document itself (#276).
 *
 * `app.tag_document`, `app.put_in_collection` and `app.take_out_of_collection`
 * have been bound at the gateway since the document work and nothing in the
 * page named any of them, so the two ways of organising a library were things
 * an agent could do and Grant could not. Project Settings already told him
 * both were here — "on the document itself, which is where you are when you
 * decide" — and they were not.
 *
 * Separate from `docActions` rather than six more controls in the same row:
 * that row is four write actions on THIS document, and these two are about
 * where it sits among the others. The chips are the state, so a press that
 * adds a tag is visible as a tag rather than as a sentence about one.
 *
 * `doc.tags` and `doc.collections` come from `app.studio_documents` (0479). A
 * prototype document has neither and no id, so `docActions` has already
 * returned above and this is never reached for one.
 */
function docOrganising(doc) {
  const tags = Array.isArray(doc.tags) ? doc.tags : []
  const inCollections = Array.isArray(doc.collections) ? doc.collections : []
  const here = byId(state.project)
  // Every collection this project already has, so filing into an existing one
  // is a choice rather than a spelling test. Section 31: an avoidable request
  // for manual input is a design failure.
  const known = [...new Set((here.documents ?? []).flatMap((d) => d.collections ?? []))]
    .filter((n) => !inCollections.includes(n))
    .sort()

  const chip = (name, attr, label) =>
    `<span class="dchip">${esc(name)}
       <button class="chipx" ${attr}="${esc(doc.id)}" data-name="${esc(name)}"
               aria-label="${esc(label)}">&times;</button></span>`

  return `<div class="docorg">
    <div class="docorgrow" data-saidwrap>
      <span class="t-label">Tags</span>
      <div class="dchips">
        ${
          tags.length === 0
            ? '<span class="t-meta">None yet.</span>'
            : tags.map((t) => chip(t, 'data-doc-untag', `Remove the tag ${t}`)).join('')
        }
      </div>
      <span class="docact">
        <input data-doc-tag-new placeholder="A word" aria-label="A tag for this document"
               list="doc-tags-known">
        <datalist id="doc-tags-known">
          ${[...new Set((here.documents ?? []).flatMap((d) => d.tags ?? []))]
            .filter((t) => !tags.includes(t))
            .sort()
            .map((t) => `<option value="${esc(t)}"></option>`)
            .join('')}
        </datalist>
        <button class="btn small" data-doc-tag="${esc(doc.id)}">Tag it</button>
      </span>
      <span class="t-meta" data-said></span>
    </div>

    <div class="docorgrow" data-saidwrap>
      <span class="t-label">Collections</span>
      <div class="dchips">
        ${
          inCollections.length === 0
            ? '<span class="t-meta">Not filed anywhere.</span>'
            : inCollections
                .map((c) => chip(c, 'data-doc-uncollect', `Take it out of ${c}`))
                .join('')
        }
      </div>
      <span class="docact">
        <input data-doc-collection-new placeholder="A collection"
               aria-label="File this document into a collection" list="doc-collections-known">
        <datalist id="doc-collections-known">
          ${known.map((n) => `<option value="${esc(n)}"></option>`).join('')}
        </datalist>
        <button class="btn small" data-doc-collect="${esc(doc.id)}">File it</button>
      </span>
      <span class="t-meta" data-said></span>
    </div>
  </div>`
}

function openDoc(doc, from) {
  const v = $('#viewer')
  const head = `<div class="t-label">${esc(doc.origin)}</div>
      <h2 class="t-title" style="margin:var(--s2) 0 var(--s3)">${esc(doc.title)}</h2>
      <p class="t-meta">${esc(doc.size)}</p>`
  v.innerHTML = `<div class="sheet docsheet">
      <div class="sheethead">
        <span style="flex:1;min-width:0">${head}</span>
        <button class="close inhead" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      ${docActions(doc)}
      <div class="docbody" data-docbody>
        <div class="bigpage" data-bigpage>${pageSvg(doc.title, doc.kind)}</div>
      </div>
    </div>`
  if (doc.file) paint($('[data-bigpage]', v), doc.file, 760)
  // `.wpage` as well as `.page`: the in-tray draws the same generated sheet
  // under a different class, and Preview opens from there too (#28).
  const page = $('.page, .wpage', from)
  const shut = () => carry('doc-open', page, () => { sheet(v, false) })
  carry('doc-open', page, () => { sheet(v, true) })
  $('.close', v).addEventListener('click', shut)
  v.addEventListener('click', (e) => { if (e.target === v) shut() })
  wireDocActions(v, doc, shut)
  if (doc.id) void fillDoc(doc, $('[data-docbody]', v))
}

/*
  The four document writes (#152).

  Wired here rather than in `drawShell` because the sheet is built outside the
  render tree and `render()` never touches it — the same reason `openDoc`
  wires its own close button.

  Every one goes through `attempt`, which disables the control, says the
  office's own sentence on a refusal and re-enables on failure; and through
  `act`, whose one chokepoint offers #118's undo strip. So a move that is
  refused because a collection holds the document says exactly that, and a move
  that works can be taken back, without either behaviour being written here.
*/
function wireDocActions(v, doc, shut) {
  const box = $('[data-doc-title]', v)

  $('[data-doc-rename]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const title = String(box?.value ?? '').trim()
    if (title === '') { say(b, 'A document needs a title.', 'warn'); return }
    const done = await attempt(b, 'Renaming…',
      // `p_document`, not `p_document_id`: this is the argument the function
      // that already existed takes (0383).
      async () => await act('document_rename', { p_document: doc.id, p_title: title }),
      'Renamed.')
    if (done) { doc.title = title; await refresh() }
  })

  $('[data-doc-move]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const to = $('[data-doc-to]', v)?.value
    const name = PROJECTS.find((x) => x.id === to)?.name ?? 'the other project'
    /*
      Confirmed, and the sentence says which project it is LEAVING.

      The issue asks for that specifically, and Grant's standing rule is that
      anything destructive asks first. A move is not destruction, but it is a
      document disappearing from the list he is looking at, which is
      indistinguishable from one at the moment it happens.
    */
    const yes = await sure(`Move "${doc.title}" out of ${byId(state.project).name} and into ${name}?`, 'Move it')
    if (!yes) return
    const done = await attempt(b, 'Moving…',
      async () => await act('document_move', { p_document_id: doc.id, p_project_id: to }),
      (r) => `Moved to ${r?.to ?? name}.`)
    if (done) { shut(); await refresh() }
  })

  $('[data-doc-supersede]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const by = $('[data-doc-by]', v)?.value
    const done = await attempt(b, 'Marking…',
      async () => await act('document_supersede', { p_document_id: doc.id, p_by_document_id: by }),
      (r) => `Superseded by ${r?.by ?? 'the newer one'}.`)
    if (done) await refresh()
  })

  $('[data-doc-restore]', v)?.addEventListener('click', async (e) => {
    const done = await attempt(e.currentTarget, 'Restoring…',
      async () => await act('document_restore', { p_document_id: doc.id }),
      'This one is current again.')
    if (done) await refresh()
  })

  $('[data-doc-pin]', v)?.addEventListener('click', async (e) => {
    const b = e.currentTarget
    const now = b.dataset.docPinned !== 'true'
    const done = await attempt(b, now ? 'Pinning…' : 'Unpinning…',
      async () => await act('document_pin', { p_document_id: doc.id, p_pinned: now }),
      now ? 'Pinned.' : 'Unpinned.')
    if (done) {
      doc.pinned = now
      b.dataset.docPinned = String(now)
      b.textContent = now ? 'Pinned' : 'Pin this one'
      b.setAttribute('aria-pressed', String(now))
      b.classList.toggle('primary', now)
      b.classList.toggle('quiet', !now)
      await refresh()
    }
  })

  /*
    TAGS AND COLLECTIONS (#276).

    DELEGATED on the viewer, not bound per chip. `docorg()` replaces its own
    markup after every press, so a listener on each chip would work exactly
    once — the trap CLAUDE.md records three times in one afternoon, and the
    one the control audit cannot see, because it presses each control from a
    fresh render.

    The chips are redrawn from `doc` rather than from a reload: the RPCs answer
    with the new state, so the row is correct the moment the press returns and
    does not wait on a round trip to the whole project. `refresh()` still runs,
    for the other surfaces that count documents.
  */
  const redrawOrg = () => {
    const box = $('.docorg', v)
    if (box !== null) box.outerHTML = docOrganising(doc)
  }

  /*
    On the SHEET, not on the viewer. `#viewer` is one persistent element that
    every open reuses, so a listener bound to it survives the next document and
    the one after — `openDoc` already adds one per open for the backdrop, where
    the cost is calling `shut` twice. Here the cost would be the same press
    sent three times. `.docsheet` is rebuilt by every `openDoc`, and `.docorg`
    lives inside it, so a listener here is exactly one per open and still
    outlives the redraw.
  */
  const sheetEl = $('.docsheet', v)
  sheetEl?.addEventListener('click', async (e) => {
    const b = e.target.closest?.(
      '[data-doc-tag], [data-doc-untag], [data-doc-collect], [data-doc-uncollect]')
    if (b === null || b === undefined || !sheetEl.contains(b)) return

    if (b.hasAttribute('data-doc-tag') || b.hasAttribute('data-doc-untag')) {
      const adding = b.hasAttribute('data-doc-tag')
      const box = $('[data-doc-tag-new]', v)
      const tag = adding ? String(box?.value ?? '').trim() : String(b.dataset.name ?? '')
      if (tag === '') { say(b, 'A tag needs a word.', 'warn'); return }
      const done = await attempt(b, adding ? 'Tagging…' : 'Removing…',
        async () => await act('document_tag',
          { p_document: doc.id, p_tag: tag, p_on: adding }),
        adding ? `Tagged ${tag}.` : `${tag} removed.`)
      if (done) {
        // The RPC answers with the whole array, which is the one reading that
        // cannot disagree with the database. `tags` comes back lower-cased and
        // de-duplicated, so echoing what was typed would be a different word.
        doc.tags = Array.isArray(done.tags) ? done.tags : doc.tags
        if (box) box.value = ''
        redrawOrg()
        await refresh()
      }
      return
    }

    const filing = b.hasAttribute('data-doc-collect')
    const box = $('[data-doc-collection-new]', v)
    const name = filing ? String(box?.value ?? '').trim() : String(b.dataset.name ?? '')
    if (name === '') { say(b, 'A collection needs a name.', 'warn'); return }
    const done = await attempt(b, filing ? 'Filing…' : 'Taking it out…',
      async () => await act(filing ? 'collection_put' : 'collection_take',
        { p_document: doc.id, p_collection_name: name }),
      filing ? `Filed in ${name}.` : `Taken out of ${name}.`)
    if (done) {
      // `put_in_collection` answers with the collection's id and
      // `take_out_of_collection` with a note, so neither carries the list.
      // Kept locally and then reconciled by the reload, which is the only
      // thing that can see a collection created by the press.
      const was = Array.isArray(doc.collections) ? doc.collections : []
      doc.collections = filing
        ? [...new Set([...was, name])].sort()
        : was.filter((c) => c.toLowerCase() !== name.toLowerCase())
      if (box) box.value = ''
      redrawOrg()
      await refresh()
    }
  })
}

/*
  The text, once it arrives.

  Failure leaves the illustration in place and says so underneath, rather than
  emptying the sheet. A reader that goes blank on a network hiccup is worse
  than one that shows the drawing it already had.
*/
async function fillDoc(doc, host) {
  if (!host) return
  let full
  try {
    full = await read('document', doc.id)
  } catch (e) {
    host.insertAdjacentHTML('beforeend',
      `<p class="t-meta">Could not fetch this document — ${esc(String(e.message ?? e))}</p>`)
    return
  }
  if (!full || full.error) {
    host.insertAdjacentHTML('beforeend',
      `<p class="t-meta">${esc(full?.error ?? 'The office had nothing for this one.')}</p>`)
    return
  }

  /*
    A PDF goes to the browser's own reader, with a real link beside it (#96).

    A correction to what this comment used to say. It claimed PDF.js was out
    because there is no bundler — and `paint()`, forty lines up in this same
    file, has been rendering real first pages with `./vendor/pdf.mjs` since
    #23. The library is SELF-HOSTED, 330KB of it, precisely so the sandbox's
    inability to reach a CDN does not matter. The stated reason for choosing an
    iframe was not true.

    The iframe stays anyway, and now for a reason that holds: the browser's own
    reader has a page count, a search box, printing and text selection that a
    reimplementation would have to earn back, and on a desktop it is genuinely
    better than anything worth building here. `paint()` uses the library for
    what a library is good at — drawing one page as a cover — and this uses the
    reader for reading.

    The iframe is unreliable on iOS Safari, which is exactly why "Open the PDF
    in a new tab" is not a nicety: on a phone it is frequently the only thing
    that works. So it is a real link to the real file, prominent, not tucked
    away. Swapping the frame for a pdf.js viewer is now a real option rather
    than a blocked one, and it is a separate change with its own captures.
  */
  const mime = String(full.mime_type ?? '')
  const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(full.title ?? '')

  /*
    `full.url`, not `full.path`.

    The `files` bucket is private, so the storage path is useless to a browser.
    The edge function swaps it for a signed URL that lives ten minutes and
    drops the path from the response — the page gets something it can follow
    and learns nothing about how storage is laid out.
  */
  if (isPdf && full.url) {
    host.innerHTML = `<div class="pdfwrap"><iframe class="pdfframe" src="${esc(full.url)}"
        title="${esc(full.title)}"></iframe></div>
      <p class="docfoot"><a class="btn" href="${esc(full.url)}" target="_blank"
        rel="noopener">Open the PDF in a new tab</a></p>`
    return
  }

  /*
    Audio plays here rather than being described (#66 put one in the office).

    The one document in the office with a real file is a 940 KB audio overview,
    and until now opening it showed a drawing of a page.
  */
  if (mime.startsWith('audio/') && full.url) {
    host.innerHTML = `<audio class="docaudio" controls preload="none"
        src="${esc(full.url)}"></audio>
      <p class="docfoot t-meta">Audio. The office holds no transcript for this one.</p>`
    return
  }

  const text = String(full.content ?? '').trim()
  if (text === '') {
    host.insertAdjacentHTML('beforeend', `<p class="t-meta">${
      String(full.mime_type ?? '').startsWith('audio/')
        ? 'This one is audio, and the office could not produce a link for it.'
        : 'The office holds this document but has no text for it.'
    }</p>`)
    return
  }

  /*
    Paragraphs, escaped, not innerHTML of the content.

    Document text comes from Notion, Drive and the office's own agents. It is
    data, and putting it through innerHTML would let a document written by
    anything upstream execute in the studio. Split on blank lines, escape each
    piece — the whole document, no clamp, no max-height.
  */
  host.innerHTML = `<article class="doctext">${
    text.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')
  }</article>${
    full.mirrored
      ? '<p class="docfoot t-meta">The office wrote this into a connector and read it back. It is not new material.</p>'
      : ''
  }`
}

/*
  The global shortcut, registered ONCE.

  `render()` replaces every node in the shell, so a listener attached inside it
  is added again on every paint — by the tenth navigation one keypress would
  open the bar ten times. Anything global belongs here, outside the render.
*/
/*
  Lists that j and k walk (#121).

  Named by the attribute their rows already carry, so a list gains this the
  moment its rows carry one of them and nothing else on the page can be walked
  into by accident. The rail has its own arrow navigation and is deliberately
  not here: two mechanisms on one element is how a focus fight starts.
*/
const WALKABLE = ['doc', 'task', 'person']

/** Whether a keystroke belongs to whatever the person is typing into. */
const typingIn = (el) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT')

/*
  Drop a file onto a project (#126).

  Registered ONCE, outside the render, for the reason the global shortcut is:
  render() replaces every node in the shell, and a listener added inside it
  would be added again on every paint.

  ## Why the counter

  dragenter and dragleave fire for every element the pointer crosses, so a drag
  moving across the page fires leave and enter continuously and a naive handler
  flickers the overlay off and on the whole way. Counting depth and hiding only
  at zero is the answer that works with nested elements.

  ## What it refuses, and how it says so

  A reader has no token, so it says that rather than failing at the gateway. A
  drop with no project open has nowhere to go. The gateway handles the rest -
  8 MB, empty files, unreadable ones - and its refusals are sentences, shown as
  they are rather than re-worded here.

  No backticks in this comment.
*/
const droplayer = () => document.getElementById('droplayer')
let dragDepth = 0

const acceptDrop = async (files) => {
  const p = byId(state.project)
  if (p === undefined || p === null || !p.id) {
    say(document.body, 'Open a project first — a file has to land somewhere.', 'warn')
    return
  }
  if (!canWrite()) {
    say(document.body, 'Reading only. Add the team token in Settings to put files in.', 'warn')
    return
  }
  for (const file of files) {
    /*
      One at a time, deliberately. Each is its own row and its own refusal, and
      a batch that fails halfway with one message is a batch nobody can act on.
    */
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => { resolve(String(reader.result ?? '')) }
      reader.onerror = () => { resolve('') }
      reader.readAsDataURL(file)
    })
    if (base64 === '') {
      say(document.body, `${file.name} could not be read.`, 'warn')
      continue
    }
    const out = await act('document_upload', {
      p_project_id: p.id,
      p_name: file.name,
      p_mime: file.type || 'application/octet-stream',
      p_base64: base64,
    }).catch((e) => ({ error: String(e?.message ?? e) }))
    say(
      document.body,
      out?.error ? `${file.name}: ${out.error}` : `${file.name} is in ${p.name}.`,
      out?.error ? 'warn' : 'good',
    )
  }
  await refresh()
}

/*
  dragover must be prevented or the browser opens the file, which is the
  default and is the one behaviour a drop target must not have.
*/
document.addEventListener('dragover', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return
  e.preventDefault()
})
document.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return
  dragDepth += 1
  droplayer()?.removeAttribute('hidden')
})
document.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) droplayer()?.setAttribute('hidden', '')
})
document.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files ?? [])]
  dragDepth = 0
  droplayer()?.setAttribute('hidden', '')
  if (files.length === 0) return
  e.preventDefault()
  void acceptDrop(files)
})

document.addEventListener('keydown', (e) => {
  const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
  if (cmdK) { e.preventDefault(); state.cmd.open ? (closeCmd(), render()) : openCmd(); return }
  // Escape closes whatever is open, outermost first.
  if (e.key === 'Escape' && state.cmd.open) { closeCmd(); render() }

  /*
    Everything below is a BARE letter, so it must never fire while somebody is
    writing. A composer that swallows the j out of "project" is worse than no
    shortcut at all, and modifiers are excluded for the same reason: Control-J
    belongs to the browser.
  */
  if (typingIn(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return

  /*
    Slash focuses the search on this screen (#121).

    Most screens have no search field of their own - the command bar IS the
    product's search (#37) - so slash opens that rather than doing nothing,
    which is what a person who pressed it is asking for either way. Not while
    a sheet is open: `body.behind` is the signal for that, never the presence
    of a `.sheet` element, which the studio leaves in the tree with its box
    taken away.
  */
  if (e.key === '/') {
    const box = [...document.querySelectorAll('input[type="search"]')].find(
      (el) => el.getClientRects().length > 0,
    )
    if (box) { e.preventDefault(); box.focus(); return }
    if (!state.cmd.open && !document.body.classList.contains('behind')) {
      e.preventDefault()
      openCmd()
    }
    return
  }

  /*
    j and k walk the list the focused row belongs to.

    Arrows are left to the browser here on purpose: inside a scrolling gallery
    they scroll, and taking that away to move focus instead is a change a
    keyboard user did not ask for. j and k mean nothing else.
  */
  if (e.key === 'j' || e.key === 'k') {
    const from = document.activeElement
    if (!(from instanceof HTMLElement)) return
    const kind = WALKABLE.find((k) => from.dataset[k] !== undefined)
    if (kind === undefined) return
    const all = [...document.querySelectorAll(`[data-${kind}]`)].filter(
      (el) => el instanceof HTMLElement && el.getClientRects().length > 0,
    )
    const at = all.indexOf(from)
    const next = at === -1 ? undefined : all[at + (e.key === 'j' ? 1 : -1)]
    if (!(next instanceof HTMLElement)) return
    e.preventDefault()
    next.focus()
  }
})

apply()
/*
  Where a change to the look is sent (#124, ADR-0021).

  Installed AFTER the first `apply()`, and that order is load-bearing rather
  than tidy. `apply()` at boot is putting this browser's cached choice back on
  the document — it is not a change, and sending it would be a POST on every
  single page load of a value the office already has.

  The first draft installed it before, reasoning that one wasted write was
  cheaper than a window in which a press is not saved. Both halves were wrong:
  the window is empty because nothing can be pressed before the first frame,
  and the write was not merely wasted. `verify:offline` went from 23/23 to
  22/23 — "a first failure shows the outage strip" — because the boot write
  was now the first failure, so the one the suite triggered was the second.
  An unconditional side effect at boot perturbs anything that counts from the
  first one.

  `canWrite()` is asked at SEND time rather than here, because a token can
  arrive after boot: a reader who signs in should start saving without a
  reload. A reader who does not has nothing to save, which is the correct
  state and not a degraded one.
*/
saveWith((next) => {
  if (!canWrite()) return
  act('appearance_set', { p_settings: next }).catch(() => {
    // Fire and forget, per ADR-0021: the failure mode is "the other device is
    // behind", never "your choice vanished" — it is on screen and in this
    // browser either way.
  })
})

clock()

/*
  The route the browser arrived with (#157).

  Read BEFORE the first paint, so a bookmarked project opens on that project
  rather than opening the portfolio and jumping. Tried twice: the first attempt
  is against the prototype's projects, which is all the page holds before the
  office answers, and `wantedPath` keeps the address so the second attempt can
  be made against the real list the moment it lands. Without that, every deep
  link to a real project would land on the portfolio, because at the moment it
  is read the real project does not exist yet.
*/
/*
  What the OAuth callback sends back, and what to say about it (0486).

  Read once, said once, and then taken out of the address bar. Never trusted
  for anything but WORDS: the office decides whether Google is connected by
  reading `connection_health`, which the Connections tab shows underneath this
  — a query parameter is something anybody can type.
*/
function cameBackFromGoogle() {
  if (typeof location === 'undefined') return false
  let said
  try {
    said = new URLSearchParams(location.search)
  } catch {
    return false
  }
  const outcome = said.get('google')
  if (outcome === null) return false

  const withWhat = (said.get('with') ?? '').split(',').filter((x) => x !== '')
  const why = (said.get('why') ?? '').slice(0, 160)
  state.setting = 'connections'
  googleSaid =
    outcome === 'connected'
      ? {
          tone: 'good',
          text:
            withWhat.length === 0
              ? 'Google is connected.'
              : `Google is connected — ${withWhat.join(', ')}. The office will pick them up ` +
                'within the hour.',
        }
      : {
          tone: 'warn',
          text:
            outcome === 'refused'
              ? `Google did not grant it${why === '' ? '' : ` — ${why}`}. Nothing changed.`
              : `That did not finish${why === '' ? '' : ` — ${why}`}. Nothing changed, so ` +
                'trying again is safe.',
        }
  /*
    The address is cleaned HERE and the sheet is opened by the CALLER, after
    the first paint — Settings is a page rather than a route (#158), so it
    reads a shell that `render()` has to have drawn.

    A reload should not re-announce a connection made ten minutes ago, and a
    URL carrying `?google=connected` is one that gets bookmarked and pasted.
  */
  try {
    const clean = new URL(location.href)
    for (const k of ['google', 'with', 'why']) clean.searchParams.delete(k)
    history.replaceState({}, '', clean.pathname + clean.search)
  } catch {
    /* A page opened from a file has no history to write to. The banner still shows. */
  }
  return true
}

/*
  WHERE THE ADDRESS LIVES, and the one case where it is not the path.

  This studio is addressed by path, because it is served by a host that
  rewrites every dotless path to index.html (ADR-0002, vercel.json). That is
  the product and it does not change.

  A REVIEW BUILD has no such host. Published as a static bundle - to give Grant
  something he can click while a deploy is unreachable - there is no rewrite,
  so `/basecamp/p/x` would be a 404 rather than the page. `window.STUDIO_REVIEW`
  moves the address into the hash, which every static host serves correctly
  because it never reaches the host at all.

  It is a SECOND ADDRESSING VOCABULARY, which this repository has paid for
  before, so it is confined to three functions and set by nothing but that one
  global: with the flag unset, every line below behaves exactly as it did.
*/
const REVIEW = typeof window !== 'undefined' && window.STUDIO_REVIEW === true

/*
  WHERE A REVIEW BUILD STARTS, so the one screen it exists to show is the one
  it opens on rather than one click away.
*/
const START =
  typeof window !== 'undefined' && typeof window.STUDIO_START === 'string' && window.STUDIO_START !== ''
    ? window.STUDIO_START
    : '/basecamp'

const addressNow = () => {
  if (typeof location === 'undefined') return '/'
  if (!REVIEW) return location.pathname
  const h = location.hash.slice(1)
  /*
    ONLY A FRAGMENT THAT IS ONE OF OURS, which means it begins with a slash.

    A host may put its own fragment on the page - the artifact host does - and
    the first version returned whatever it found. `#artifact-abc` was therefore
    read as a route, matched nothing, and fell through to the DEFAULT studio:
    the review build opened on today's Team HQ and Grant reasonably said he was
    being shown the old interface. Anything that is not our shape is not an
    address, and the page starts where it was told to.
  */
  return h.startsWith('/') ? h : START
}

let wantedPath = addressNow()
if (goToPath(wantedPath)) wantedPath = null

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    /*
      Back and Forward move WITHIN the studio.

      `shownPath` is set from the event rather than left alone, so the paint
      that follows does not immediately push the entry we have just walked back
      out of — which would make Back appear not to work at all.
    */
    const path = e.state?.path ?? addressNow()
    shownPath = path
    goToPath(path)
    render()
  })
}

/*
  COMING BACK FROM GOOGLE (0486), read BEFORE the first paint.

  Two reasons it has to be here rather than where the office's payload lands.
  `keepUrl()` rewrites the address from the state on every render, so a query
  parameter not read before the first one is gone. And `live()` returns early
  when there is no token — so on a browser that was signed out, or whose token
  had expired while he was away at Google, the callback would have said
  nothing at all.

  It is words and nothing else. Whether Google is connected is read from
  `connection_health`, which is the card underneath.
*/
const backFromGoogle = cameBackFromGoogle()

/*
  HAND THE EXPERIMENTAL EXPERIENCE WHAT IT NEEDS, once, before the first paint.

  Dependency injection rather than an import back into this file: bc/* already
  imports office.js and data.js directly, and the only things it cannot reach
  on its own are this module's state, its repaint and its navigation. Passing
  them keeps the dependency one-way and keeps the branch in drawShell the only
  coupling in the other direction.
*/
const bcContext = {
  state,
  projects: () => PROJECTS,
  /*
    The project's conversation, from the studio's own chat module (#192).

    Exposed rather than reimplemented: `chat.js` holds the office's copy, the
    optimistic tail and the rule that the office's copy wins. A second reader
    in the experiment would be a second thing to keep in step.
  */
  /*
    Project home v2's expanded views. One flag, read by the shell, so opening
    and closing is a repaint rather than a navigation - which is what makes
    closing return "naturally to the underlying project homepage".
  */
  openExpanded: (id) => {
    state.bcExpanded = id
    render()
  },
  closeExpanded: () => {
    state.bcExpanded = null
    /*
      And the record with it. A modal closed on one task and reopened from the
      To-dos heading would otherwise come back showing that task rather than
      the list, which is the dialog remembering something the person has just
      dismissed.
    */
    state.bcTask = null
    state.bcContact = null
    state.bcContactAdd = false
    state.bcDoc = null
    render()
  },
  /*
    PROJECT SETTINGS, RENDERED AND WIRED BY ITS OWN MODULE.

    The experiment draws the same `project-settings.js` the default studio
    does - same renderer, same wiring, same writes - so there is no second
    implementation to drift, which is what "preserve existing settings
    functionality; avoid regressions" actually requires. Only the frame and
    the stylesheet are the experiment's.
  */
  needProjectSettings: (p) => {
    void projectSettings.need(p, render)
  },
  projectSettingsBody: (p) => projectSettings.section(p, state.setpane, people),
  wireProjectSettings: (root, p) => {
    projectSettings.wire(root, p, people, render, () => { lookSheet(p) })
  },
  setPane: (id) => {
    state.setpane = id
    render()
  },
  /*
    HOW THIS PROJECT LOOKS: the picker that already exists.

    `lookSheet` is the default studio's, it writes through `project_look`, and
    it holds 451 icons, the hues and an image upload. Rebuilding it here would
    be a second picker writing the same three columns - the settings decision
    again, for the same reason.
  */
  openLook: () => {
    const p = PROJECTS.find((x) => x.slug === state.project)
    if (p === undefined) return
    lookSheet(p)
  },
  /* The office's own settings, in the sheet that already holds them. */
  openGlobalSettings: (tab) => {
    if (typeof tab === 'string' && tab !== '') state.setting = tab
    settingsSheet()
    sheet($('#settings'), true)
  },
  chatFor: (slug) => chat.thread(slug),
  chatIsReal: (slug) => chat.isReal(slug),
  chatLoad: (slug) => chat.load(slug, PROJECTS.find((x) => x.slug === slug)?.id, presented()),
  chatSend: (slug, text) => chat.send(slug, text, null),
  /*
    WHERE THE VOICE NOTE IS TRANSCRIBED, and the token to do it with.

    Handed over rather than derived in the experience, because the endpoint and
    the token are this module's business and there must not be a second idea of
    either. `chat.js` already derives the voice endpoint from the API base the
    same way, which is why `/note` lands on the function the conversation
    already talks to.
  */
  voiceEndpoint: () => chat.endpoint(),
  /* The project's own name, for the transcriber's spelling hint. */
  projectName: (slug) => PROJECTS.find((x) => x.slug === slug)?.name ?? '',
  /* The office's own id for a project, which storage paths are filed under. */
  projectId: (slug) => PROJECTS.find((x) => x.slug === slug)?.id ?? '',
  officeToken: () => presented(),
  chatAsk: (slug, text, onState) => chat.ask(slug, text, null, presented(), undefined, undefined, onState),
  crew: CREW,
  tools: bc.TOOLS,
  /*
    Who is actually on a project, derived from its rows rather than stored.

    The payload carries no per-project roster, and the studio's own team
    surface derives it the same way (from who appears in the work). Deriving
    it twice is better than a second place for it to rot, which is the lesson
    0310 was spent on.
  */
  crewFor: (slug) => {
    const p = PROJECTS.find((x) => x.slug === slug)
    if (p === undefined) return []
    const slugs = new Set(
      [
        ...(p.tasks ?? []).map((t) => t.who),
        ...(p.activity ?? []).map((a) => a.who),
        ...(p.waiting ?? []).map((w) => w.who),
      ].filter((x) => typeof x === 'string' && x !== ''),
    )
    const seen = new Set()
    const out = []
    for (const s2 of slugs) {
      const person = crewBy(s2)
      if (person === undefined || seen.has(person.slug)) continue
      seen.add(person.slug)
      out.push(person)
    }
    return out
  },
  /*
    The personal list, or null while it is still coming.

    NULL AND EMPTY ARE DIFFERENT ANSWERS and the difference is the whole point:
    null draws a skeleton, an empty array says there is nothing on your list.
    `mine.trouble` is the third case - a read that FAILED - and it must never
    render as "nothing due", which is the defect #?? records about this exact
    store. The experience asks for the trouble flag and says it could not look.
  */
  myTasks: () => {
    // `mineKey()` takes no arguments — it reads `mine.bucket`, the query and
    // the sort, because the cache is keyed on the whole request (#259).
    const key = mineKey()
    const rows = mine.lists[key]
    if (mine.trouble[key] === true) return []
    return Array.isArray(rows) ? rows : null
  },
  myTasksTrouble: () => mine.trouble[mineKey()] === true,
  /*
    START THE FETCH, from the renderer, the way the default studio's review
    block does.

    Without this, opening /basecamp/tasks directly showed a skeleton that
    never resolved: `goAnywhere` kicked the read when you NAVIGATED there and
    nothing kicked it when you ARRIVED there, so a reload or a pasted link sat
    on shimmering bars for ever. CLAUDE.md is blunt about it — a skeleton that
    never resolves is broken, and the page has no way to tell a slow office
    from a dead one except by somebody having asked.

    `needMine` guards on the cache key and repaints when it lands, so calling
    it from a render is safe and cannot loop.
  */
  askForMyTasks: () => {
    void needMine(mine.bucket)
  },
  canWrite: () => canWrite(),
  refresh: () => refresh(),
  render,
  /*
    THE TEAM CONVERSATION (#103), reachable from the experiment too.

    The dock lives outside #root, so it already SURVIVES the experimental
    render — but surviving is not the same as being reachable, and a
    capability that exists in code and cannot be found is the regression the
    run's pre-mortem calls Failure E. The experience gets the same door the
    default rail has rather than a second conversation.
  */
  /*
    Open one task's record page. The tab stays `tasks`, so the address stays
    the tool's — the record is a state of the tool rather than a route of its
    own, which keeps §10.8's two-levels-never-three true of tasks as well.
  */
  openTask: (id) => {
    state.bcTask = id
    /*
      ON THE PROJECT HOME A RECORD HAS NOWHERE TO DRAW, and that is how eight
      dead controls shipped in one afternoon: the To-dos miniature's task
      titles and the Schedule miniature's agenda items both set the record and
      repainted a page that draws the board, so every one of them was a press
      that changed nothing. v2's rule is that a miniature acts, and the
      expanded view is where the record lives - so opening one from the home
      opens To-dos over the page with that record in it.
    */
    if (state.tab !== 'tasks') state.bcExpanded = 'tasks'
    // `keepUrl()` pushes from the state on the next paint, so opening a
    // record becomes a history entry and Back returns to the list.
    render()
  },
  /*
    One person, and the form that adds one. Both open the Contacts tool over
    the home for the same reason a task does.
  */
  openContact: (key) => {
    state.bcContact = key
    state.bcContactAdd = false
    if (state.tab !== 'contacts') state.bcExpanded = 'contacts'
    render()
  },
  openContactAdd: () => {
    state.bcContact = null
    state.bcContactAdd = true
    if (state.tab !== 'contacts') state.bcExpanded = 'contacts'
    render()
  },
  closeContact: () => {
    state.bcContact = null
    state.bcContactAdd = false
    render()
  },
  /*
    One document, as a record over the page. Used where a new tab is the wrong
    answer - a recording, or a document with no file behind it at all.
  */
  /*
    A COUNT, PRESSED. The filter and the expanded view are set together, so
    there is no state in which the to-dos are open under a filter the page
    cannot name.
  */
  openFiltered: (kind) => {
    state.bcFilter = kind
    state.bcTask = null
    state.bcExpanded = 'tasks'
    render()
  },
  clearFilter: () => {
    state.bcFilter = null
    render()
  },
  /* Mine / The team's. Pressing the half that is on clears it. */
  setMine: (kind) => {
    state.bcMine = kind === null || state.bcMine === kind ? null : kind
    render()
  },
  openSource: (key) => {
    state.bcSource = key
    state.bcSourceAdd = false
    if (state.tab !== 'sources') state.bcExpanded = 'sources'
    render()
  },
  openSourceAdd: () => {
    state.bcSource = null
    state.bcSourceAdd = true
    if (state.tab !== 'sources') state.bcExpanded = 'sources'
    render()
  },
  closeSource: () => {
    state.bcSource = null
    state.bcSourceAdd = false
    render()
  },
  openDocDetail: (ref, title) => {
    state.bcDoc = { ref, title }
    state.bcExpanded = 'document'
    render()
  },
  openDock: () => {
    rememberDock(true)
    paintDock()
  },
  /*
    A TOGGLE, because Grant asked for one in those words: *"Clicking it should
    open the team chat sidebar. Clicking the same button again should close the
    sidebar. The control therefore behaves as a genuine toggle."* The state is
    the dock's own, not a variable the button keeps, so a dock closed by its
    own X leaves the button telling the truth.
  */
  toggleDock: () => {
    const open = !dockOpen()
    rememberDock(open)
    paintDock()
    return open
  },
  dockIsOpen: () => dockOpen(),
  go: (path) => {
    goToPath(path)
    render()
  },
  /*
    Navigate anywhere, in or out of the experience.

    A path that does not carry the prefix leaves the experiment, and leaving is
    a real page load rather than a router hop - the two presentations put
    different attributes on the document root and the default studio expects to
    boot into its own shell.
  */
  goAnywhere: (path) => {
    if (String(path).startsWith('/basecamp')) {
      goToPath(path)
      if (state.view === 'tasks') void needMine(mine.bucket)
      render()
      return
    }
    window.location.assign(path)
  },
  /*
    Full search (§7.3, Shift+Enter).

    Promotes into the default studio's search rather than building a second
    one: search already spans documents, tasks, contacts, sources and outputs
    with access controls applied, and a parallel implementation would be a
    second answer to one question.
  */
  /*
    §7.3: Shift+Enter promotes the typed text into full search.

    This used to navigate to `/?q=…` in the default studio. NOTHING THERE
    READS `q` — and `keepUrl()` strips the query on the first paint anyway —
    so the keystroke went home and dropped what had been typed, which looks
    exactly like a search that found nothing. The experiment has its own
    search surface now and the query is carried on the state rather than in
    the address, because the address is rewritten from the state on every
    paint.
  */
  fullSearch: (q) => {
    state.bcQuery = q
    state.view = 'bcsearch'
    state.project = null
    render()
  },
}
bc.mount(bcContext)
bcJump.mount(bcContext)
bcWire.mount(bcContext)
/*
  WHICH MESSAGES HAVE A RECORDING, learned once.

  The thread renderer is synchronous and IndexedDB is not, so the keys are read
  at boot and the play control is drawn from that. A browser that cannot keep
  audio resolves false and simply never draws one, which is the honest state
  rather than a control that cannot work.
*/
void bcNotes.ready().then((ok) => {
  if (ok) render()
})

/*
  THE SIGN-IN LINK COMING BACK, TAKEN BEFORE ANYTHING IS DRAWN.

  Supabase returns the session in the URL fragment. It has to be adopted before
  the first render, or the page draws itself signed out, fires its reads with
  no credential, and only then notices -- which is a flash of "you are not
  signed in" on the one journey where the person demonstrably is.

  It also takes the token out of the address bar, because a URL with a session
  in it is a URL somebody pastes into a chat.
*/
/*
  WHERE THE BOARD'S ARRANGEMENT IS KEPT. The grid does the geometry and knows
  nothing about the office; this is the one place that joins them, the same
  shape as `onWrite` in `office.js`.
*/
bcGrid.persistence({
  save: (slug, panels) =>
    act('dashboard_layout_set', { p_slug: slug, p_panels: panels, p_surface: 'basecamp' }).catch(
      () => undefined,
    ),
  reset: (slug) =>
    act('dashboard_layout_reset', { p_slug: slug, p_surface: 'basecamp' }).catch(() => undefined),
})

bcSession.adopt()

render()

/*
  Settings is a page rather than a route (#158), so it opens after the paint
  rather than through the router — the sheet reads a shell that has to exist.
*/
if (backFromGoogle) {
  settingsSheet()
  sheet($('#settings'), true)
}

/*
  And then the real office, if it will have us (#68, ADR-0019).

  Rendered FIRST with whatever is in hand, then hydrated and rendered again.
  The other order — wait for the fetch, then paint — gives a blank screen for
  however long the network takes, and the whole argument for keeping the mock is
  that there is always something to look at.

  The token is the same one Team HQ uses. No new auth system: one bearer token,
  and the studio reads it from the same place rather than asking again.
*/
const API =
  window.HQ_API || 'https://baujwlzcziasnfhhkchg.supabase.co/functions/v1/hq-api'
// Same derivation the old page used: one base, and the OAuth start is a sibling
// function. Hardcoding a second URL is how the two drift on the day the project
// reference changes.
const GOOGLE_START = API.replace(/\/hq-api$/, '/google-oauth/start')

/*
  Re-read the office and repaint.

  After every write, rather than patching the state in place. Patching is faster
  and is how two things drift: the server decides what an attachment is called
  and whether it is enabled, and a page that guesses shows one thing while the
  database holds another. A round trip costs a moment and is always right.
*/
/*
  Payloads that belong to one screen rather than to the whole shell.

  The portfolio and every project come from one call, because the shell paints
  them all at once and a page that fetches per section feels broken while being
  correct. Lately is different: most visits never open it, and forty ledger rows
  and a dozen screenshots on every load is a cost paid by everyone for a page
  few of them want. So it is fetched when it is first asked for and kept.
*/

/*
  The portfolio task list (#173).

  Its own payload for the same reason Lately has one: it is a screen you
  navigate to, and folding it into `studio` would make every first paint pay for
  a list most loads never render.

  Unlike Lately it is also read for the RAIL — the count beside the nav item —
  so it is fetched once the shell is up rather than only when the screen is
  opened. A nav entry that says "Tasks" and nothing else cannot tell him whether
  to press it, and the whole complaint behind this issue is that work across
  projects is invisible until you go looking.
*/
/*
  A read that always settles (#219, and section 32).

  Both of the lazy payloads below are drawn on the home board now, so a fetch
  that never resolves is no longer a screen nobody is looking at - it is a panel
  reading "Reading what is open…" for ever on the first thing Grant sees. A
  skeleton that never resolves is broken, and the studio has no way to tell the
  difference between a slow office and a dead one except by deciding when to
  stop waiting.

  Twelve seconds, then the catch below runs and the panel says what it knows.
  It does not cancel the request - if the answer arrives later the next read
  takes it - it only stops the page pretending it is still coming.
*/
const settles = (p2, ms = 12_000) => Promise.race([
  p2,
  new Promise((_, no) => setTimeout(() => { no(new Error('the office did not answer in time')) }, ms)),
])

/**
 * The project's map, fetched once per project (#25).
 *
 * Two calls rather than one, because they answer different questions and fail
 * differently: the GRAPH is what the office knows about the project and a
 * failure there means there is nothing to draw, while the ARRANGEMENT is where
 * he put the cards and a failure there means draw them in the computed
 * positions. Folding them into one call would make a lost preference look like
 * a lost project.
 */
/**
 * Fetch a project's story once, then redraw (#156).
 *
 * Mirrors `needMap`, including the guard that makes it safe to call from a
 * renderer: the null is written BEFORE the await, so a second render while the
 * first request is in flight does not start a second request. A renderer that
 * fetches is only tolerable because of that line.
 */
/**
 * Fetch what the project's notebook has made, once, then redraw (#260).
 *
 * Mirrors `needHistory`, including the guard that makes it safe to call from a
 * renderer: the null is written BEFORE the await, so a second render while the
 * first request is in flight does not start a second one.
 *
 * Where it differs from `needHistory` is the fallback, and the difference is
 * deliberate. A story is a shape; an artifact is a link Grant would click, and
 * the Issue's own line is that a missing link capability must be reported
 * accurately rather than producing a fabricated one. So invented rows are
 * reached only with no token — the prototype, which says so on the page — and
 * a failure with a token renders nothing at all, which is the honest answer to
 * both "there are none" and "we could not ask".
 */
/*
  Signed-in sites, and what the office actually opened on them (#135, #16).

  A session, not a browser. The assessment this is built from separates
  persistent STATE, which is free, from persistent COMPUTE, which is not: what
  persists here is a cookie jar in the Vault, and every gather opens a fresh
  Chromium somewhere ephemeral and destroys it. So the heading is about SITES,
  not about a browser that is running, because there is never one running.

  Lives inside Sources rather than becoming a seventh project tab. A site the
  office is signed in to is a place the project reads from, the database now
  agrees (it is a knowledge connector as of migration 0445), and a tab costs
  every project a navigation target for a capability most of them will not use.

  Drawn only when the project has a session. An empty block under a populated
  one reads as a fault, which is the same rule the block above it follows.

  No backticks in this comment: template literal.
*/
function signedInSites(p) {
  const rows = browserSites[p.slug]
  if (rows === undefined) {
    needSites(p.slug)
    return ''
  }
  /*
    A project can be browsing a public page with no session at all, so "no
    sessions" is not "nothing to show" any more. Returning early on that would
    hide the live block and the Stop with it -- which is the found-nothing
    shape, in the one place it would cost Grant the ability to halt something.
  */
  if ((rows === null || rows.length === 0) && (browserNow[p.slug] ?? []).length === 0) return ''
  const seen = browserSeen[p.slug] ?? []
  const now = browserNow[p.slug] ?? []
  return `<section class="nbmade bsites">
    <!--
      RIGHT NOW (#135, #16).

      Grant asked for a browser he could see. Everything else in this section
      is past tense -- sites there is a session for, and pages already read --
      so a gather running this second appeared nowhere on the surface built to
      show browsing, and the only Stop in the product was on a different screen
      that does not say which site is being read.

      Drawn only when something is live. An empty "nothing is running" block on
      every project every day is a line nobody reads, and the rule this file
      already follows twice above.

      The wording of the button is the honest part and matches the jobs list:
      this is a REQUEST. The runner reads a column between steps, so the job
      stops at its next checkpoint and a step in flight finishes.

      No backticks in this comment: template literal.
    -->
    ${
      now.length === 0
        ? ''
        : `<h3 class="t-label">Right now</h3>
    <ul class="nbrows">${now
      .map(
        (r) => `<li class="nbrow bnow">
        <span class="nbkind bstate ${r.waiting_for_you ? 'b-needs_sign_in' : 'b-live'}">${
          r.waiting_for_you ? 'Waiting for you' : 'Reading'
        }</span>
        <span class="nbtitle">${esc(r.url ?? r.site ?? 'a page')}</span>
        <span class="t-meta">${r.since ? esc(when.words(r.since)) : ''}</span>
        ${
          canWrite() && r.job_id && !r.waiting_for_you
            ? r.stop_asked
              ? '<span class="t-meta">Stopping after this step</span>'
              : `<button class="btn quiet" data-stop-job="${esc(r.job_id)}"
                   title="Ask it to stop at its next checkpoint">Stop</button>`
            : ''
        }
      </li>`,
      )
      .join('')}</ul>`
    }
    ${
      (rows ?? []).length === 0
        ? ''
        : `<h3 class="t-label">Signed in to</h3>
    <p class="t-meta">Pages the office can read on your behalf. It reads and
      photographs; it does not press anything.${
        browserLeft === null
          ? ''
          : ` ${esc(String(browserLeft.left_minutes ?? 0))} of ${esc(
              String(browserLeft.cap_minutes ?? 0),
            )} free browser-minutes left today.`
      }</p>
    <ul class="nbrows">${rows
      .map(
        (b) => `<li class="nbrow">
        <span class="nbkind bstate b-${esc(b.state ?? 'live')}">${esc(SITE_SAID[b.state] ?? b.state ?? '')}</span>
        <span class="nbtitle">${esc(b.site ?? '')}</span>
        <span class="t-meta">${esc(b.purpose ?? '')}</span>
        <span class="t-meta">${
          b.last_alive_at ? `Last worked ${esc(when.words(b.last_alive_at))}` : 'Not used yet'
        }</span>
        <!--
          FORGET IT (#135, #276).

          A stored cookie jar Grant cannot revoke from the product is the wrong
          way round for anything holding a login, and until now the only way to
          take one back was SQL. Offered only while the session HOLDS a
          credential: once it is forgotten there is nothing left to forget, and
          a button that would answer "there is no session by that id" is the
          dead control this whole sweep is about.

          No backticks in this comment: template literal.
        -->
        ${
          canWrite() && b.session_id && b.has_credential
            ? `<button class="btn small quiet" data-forget-site="${esc(b.session_id)}"
                 data-name="${esc(b.site ?? 'that site')}">Forget it</button>`
            : canWrite()
              ? // No credential: the one thing to do here is give it one, and
                // until now the row said "Needs a sign-in" and offered nothing.
                `<button class="btn small" data-signin-open
                   data-site="${esc(b.site ?? '')}"
                   data-purpose="${esc(b.purpose ?? '')}">Sign in again</button>`
              : ''
        }
        <span class="t-meta" data-said></span>
      </li>`,
      )
      .join('')}</ul>`
    }
    ${
      seen.length === 0
        ? ''
        : `<h3 class="t-label bseen">Lately</h3>
    <ul class="nbrows">${seen
      .slice(0, 8)
      .map(
        (a) => `<li class="nbrow brow">
        <span class="nbkind">${esc(a.verb ?? '')}</span>
        <span class="nbtitle">${esc(a.url ?? '')}</span>
        <!--
          The detail only when it ADDS something. A successful read records the
          detail "read", which the verb column already says: two columns
          saying one word is a stutter on the desktop and a wasted line of
          three on a phone. Found by opening the capture.
        -->
        <span class="t-meta">${
          a.ok
            ? esc(a.detail && a.detail !== a.verb ? a.detail : '')
            : esc(`did not work — ${a.detail ?? 'no reason given'}`)
        }</span>
        <span class="t-meta">${esc(when.words(a.at))}</span>
        <!--
          THE PHOTOGRAPH (#16).

          The acceptance list asks for a recent screenshot, and the reader has
          returned one since the ledger existed: nothing rendered it, so the
          picture sat in the payload for the life of the feature. It is the
          only honest way to show what a headless agent saw — a line of text
          saying "read" is the office's word for it, and a photograph is not.

          The link is signed by the gateway and lives ten minutes, which is
          why it is not stored anywhere in the page: a stale one would 404
          silently and read as a screenshot that failed to arrive.

          No backticks in this comment: template literal.
        -->
        ${
          a.shot_url
            ? `<a class="bshot" href="${esc(a.shot_url)}" target="_blank" rel="noreferrer noopener"
                 title="What the office saw on this page">
                 <img src="${esc(a.shot_url)}" alt="A screenshot of ${esc(a.url ?? 'the page')}, taken when the office read it" loading="lazy">
               </a>`
            : ''
        }
      </li>`,
      )
      .join('')}</ul>`
    }
    ${
      canWrite()
        ? `<div class="tabhead"><span></span>
             <button class="btn" data-signin-open data-site="">Sign in to a site</button></div>`
        : ''
    }
    ${signInForm()}
  </section>`
}

/*
  SIGNING A SITE IN (#135, #16).

  `browser_session_establish` has existed at the gateway since the browser work
  and nothing has ever pressed it. It sat in the pressable baseline with a
  reason that turned out to be FALSE -- "blocked behind the Cloudflare account,
  because nothing can sign in until it exists". Nothing about this path needs
  Cloudflare: Grant signs in HIMSELF in his own browser, exports the session,
  and pastes it here; the runtime that later USES the jar sends it as a cookie
  header, which the fetch runtime does perfectly well. So the Sources panel
  listed the sites the office was signed in to and offered no way to sign one
  in, for the life of the feature.

  That is the second baselined entry in two days whose stated reason was
  wrong, and it is the more expensive kind: a documented excuse stops the next
  person looking.

  ## The rules this form obeys

  The office NEVER types a password, and this form never asks for one. What is
  pasted is a SESSION, which is a different risk from a credential and the only
  one #135 is willing to hold.

  The jar is a credential all the same, so: the field is never given a value
  from the page, it is cleared the moment the action returns, nothing about it
  is put in a data attribute, and the only place it is written is
  app.store_secret inside one SQL function. The page learns the session id and
  the site back, and nothing else.

  No backticks in any comment in this function: template literal.
*/
function signInForm() {
  if (!canWrite()) return ''
  return `<div class="taskform bsignin" data-signin-form hidden>
    <div class="hirerow">
      <label>The site
        <input data-si-site placeholder="supplier.example.com" autocomplete="off"></label>
      <label>What it is for
        <input data-si-purpose placeholder="Read the weekly order confirmations" autocomplete="off"></label>
    </div>
    <label class="sifull">The signed-in browser state
      <textarea data-si-jar rows="4" autocomplete="off" spellcheck="false"
        placeholder="Paste the exported storage state here"></textarea></label>
    <p class="t-meta">Sign in yourself, in your own browser, then export the session
      and paste it. The office never types a password and never asks for one. What
      you paste goes straight into the vault and is never shown again — not here,
      not in a log, not in a screenshot.</p>
    <span class="hireact">
      <span class="t-meta" data-said></span>
      <button class="btn primary" data-si-go>Sign it in</button>
      <button class="btn quiet" data-si-cancel>Cancel</button>
    </span>
  </div>`
}

/** The five states a session can be in, said in words rather than in enum. */
const SITE_SAID = {
  live: 'Signed in',
  needs_sign_in: 'Needs a sign-in',
  signed_out: 'Signed out',
  revoked: 'Revoked',
}

/*
  Asked once per project, and never invented.

  No prototype fallback at all, unlike the block above it. An invented
  signed-in session would be a claim that the office holds a credential for a
  site, which is the one kind of fiction a screenshot of this page must never
  contain — somebody reading it would believe a login exists.
*/
async function needSites(slug) {
  if (browserSites[slug] !== undefined) return
  const p = byId(slug)
  browserSites[slug] = null
  try {
    /*
      The budget comes back with the sessions, because the answer to "why did
      it not open anything" belongs on the same screen as the question. It is
      global rather than per project, since the cap is.
    */
    const [sessions, lately, budget, now] = await Promise.all([
      settles(read('browser_sessions', p.id)),
      settles(read('browser_lately', p.id)),
      settles(read('browser_budget')),
      settles(read('browser_now', p.id)),
    ])
    browserSites[slug] = Array.isArray(sessions) ? sessions : []
    browserSeen[slug] = Array.isArray(lately) ? lately : []
    browserNow[slug] = Array.isArray(now) ? now : []
    browserLeft = budget && typeof budget === 'object' ? budget : null
  } catch {
    browserSites[slug] = []
    browserSeen[slug] = []
    browserNow[slug] = []
  }
  render()
}

/*
  Asked once, and only for a writer (#276).

  The reader is global, so this is not keyed by project — a project you are
  trying to find is one you are not inside. It always awaits a fetch before
  redrawing, which is what keeps it safe to call from inside `render()`: the
  outer pass finishes first. A synchronous branch here would overwrite its own
  output, which CLAUDE.md records happening to `needMade`.
*/
async function needRecoverable() {
  if (recoverable !== undefined) return
  recoverable = null
  try {
    const rows = await read('archived')
    recoverable = Array.isArray(rows) ? rows : []
  } catch {
    recoverable = []
  }
  render()
}

/*
  Asked per job, once, and re-asked by `refresh()` clearing the store.

  Only for a job that is RUNNING: a finished job's steps are history and the
  Outputs tab is where its result lives, so fetching them would be one request
  per completed row for something nobody is waiting on.
*/
async function needProgress(jobId) {
  if (progress[jobId] !== undefined) return
  progress[jobId] = null
  try {
    const got = await read('job_progress', jobId)
    progress[jobId] = got && typeof got === 'object' ? got : null
  } catch {
    progress[jobId] = null
  }
  render()
}

async function needMade(slug) {
  if (notebookMade[slug] !== undefined) return
  const p = byId(slug)
  notebookMade[slug] = null
  /*
    The prototype invents; a signed-in page never does.

    `needHistory` mocks on ANY failure, which is right for a story and wrong
    here: a real user whose request failed would be shown links that do not
    exist, which is the fabricated link this Issue forbids by name. So the
    invented rows are reached only when there is no token at all — the state
    the page already announces with its own strip — and a failure with a token
    renders nothing.
  */
  try {
    const rows = await settles(read('project_artifacts', p.id))
    notebookMade[slug] = Array.isArray(rows) ? rows : []
  } catch {
    notebookMade[slug] = []
  }
  render()
}

/*
  Invented artifacts, so the design can be seen and captured.

  Only for a project the prototype shows as having a notebook — inventing an
  audio overview for a project with nothing attached would make the block look
  unconditional, and it is not. One row deliberately has no link, because the
  no-link case is the one worth judging and it is the one a happy mock hides.
*/
function mockMade(p) {
  const hasNotebook = (p.sources ?? []).some((x) =>
    `${x.name ?? ''} ${x.via ?? ''}`.toLowerCase().includes('notebook'),
  )
  if (!hasNotebook) return []
  return [
    {
      id: 'mock-1',
      kind: 'audio',
      title: `${p.name} — where it stands`,
      url: 'https://notebooklm.google.com/',
      openable: true,
      mine: true,
      state: 'ready',
    },
    {
      id: 'mock-2',
      kind: 'slides',
      title: 'The case, in twelve slides',
      url: 'https://notebooklm.google.com/',
      openable: true,
      mine: false,
      state: 'ready',
    },
    {
      id: 'mock-3',
      kind: 'mindmap',
      title: 'How the pieces relate',
      url: null,
      openable: false,
      mine: false,
      state: 'generating',
      detail: 'Finished in the notebook, but it gave no link the office can open.',
    },
  ]
}

/**
 * Fetch what is waiting for Grant's decision, once, then redraw (#28, #276).
 *
 * Mirrors `needMade`, including the guard that makes it safe to call from a
 * renderer: the null is written BEFORE the await, so a second render while the
 * first request is in flight does not start a second one.
 *
 * A failure renders nothing rather than a mock. The block carries two buttons
 * that CHANGE something, and drawing them over invented rows would be a
 * control that cannot do what it offers.
 */
async function needReview(slug) {
  if (reviewing[slug] !== undefined) return
  const p = byId(slug)
  reviewing[slug] = null
  try {
    const rows = await settles(read('review', p.id))
    reviewing[slug] = Array.isArray(rows) ? rows : []
  } catch {
    reviewing[slug] = []
  }
  render()
}

async function needHistory(slug) {
  if (stories[slug] !== undefined) return
  const p = byId(slug)
  stories[slug] = null
  try {
    const rows = await settles(read('history', p.id))
    stories[slug] = Array.isArray(rows) ? rows : []
  } catch {
    /*
      The prototype's own shapes, not an error state — exactly as `needMap`
      does, and for the reason written there: this screen is one Grant judges
      the direction from, and a panel saying "could not load" teaches nothing
      about whether the direction is right. #119's strip is what says the
      office is unreachable; saying it twice is noise.
    */
    stories[slug] = mockStory(p)
  }
  render()
}

/**
 * A plausible story from what the prototype already holds.
 *
 * NOT a second implementation of `app.project_history`: it derives nothing the
 * office derives, it invents a shape for invented projects so the design can
 * be seen and captured. `plane.mock` is the same thing for the map and set the
 * precedent.
 *
 * Ordered oldest first like the real one, so what a capture shows is what the
 * office would show.
 */
/**
 * A day, the same way for every line of a story (#156).
 *
 * The year only when it is not this one — a coaching course built over months
 * needs "3 Sep" for most of it and "3 Sep 2025" for the beginning, and putting
 * the year on every line to cover that makes forty lines wider for four.
 */
function shortDay(iso) {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const d = new Date(at)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  })
}

function mockStory(p) {
  /*
    Dated, spread backwards from today.

    The first version left `at` null and the capture showed a 74px empty
    gutter down the left of every line — the column the whole layout is built
    around, blank, in the one image anybody judges the design from. A story
    without dates is a list, and the dates are the thing that makes it read as
    a sequence, so a mock without them is a mock of a different component.
  */
  const day = 86_400_000
  let ago = 0
  const when = () => new Date(Date.now() - (ago += 3 + Math.floor(ago / 9)) * day).toISOString()
  const out = [{ at: null, kind: 'created', what: `${p.name} started`, detail: p.purpose ?? null }]
  for (const s of (p.sources ?? []).slice(0, 3)) {
    out.push({
      at: null,
      kind: 'attached',
      what: `${s.name ?? s.title ?? 'A source'} attached`,
      detail: s.connector ?? null,
    })
  }
  for (const d of (p.documents ?? []).slice(0, 3)) {
    out.push({
      at: d.at ?? null,
      kind: d.origin === 'made' ? 'made' : 'source',
      what: d.title,
      detail: d.origin === 'made' ? 'written by the team' : null,
    })
  }
  for (const t of (p.tasks ?? []).filter((x) => x.state === 'done').slice(0, 2)) {
    out.push({ at: null, kind: 'finished', what: t.title, detail: null })
  }
  /*
    Oldest first, and dated in that order: the entries are assembled by TYPE
    above, which is not the order they happened in, so dating them as they
    come out would put the project's start after its documents.
  */
  return out
    .reverse()
    .map((e) => ({ ...e, at: e.at ?? when() }))
    .reverse()
}

async function needMap(slug) {
  if (maps[slug] !== undefined) return
  const p = byId(slug)
  maps[slug] = null
  try {
    const graph = await settles(read('plane', p.id))
    maps[slug] = graph && Array.isArray(graph.nodes) ? graph : plane.mock(p, CREW)
  } catch {
    /*
      The prototype's own shapes, not an error state.

      This screen is the one Grant judges the direction from, and a map that
      says "could not load" teaches nothing about whether the direction is
      right. #119's strip is what says the office is unreachable; saying it
      twice is noise, and here it would cost the whole screen.
    */
    maps[slug] = plane.mock(p, CREW)
  }
  try {
    const saved = await settles(read('plane_layout', p.id))
    placed[slug] = { at: saved?.at ?? {}, view: saved?.view ?? {} }
  } catch {
    placed[slug] = { at: readLocalPlacement(slug), view: {} }
  }
  render()
}

/*
  Where he put the cards, when the office cannot be reached.

  A per-viewer convenience in browser storage, exactly as CLAUDE.md permits and
  bounds: it survives a republish, it never reaches another device, and every
  read is wrapped because a private window throws rather than returning null.
  The office's copy is the real one and wins whenever it answers.
*/
function readLocalPlacement(slug) {
  try {
    return JSON.parse(localStorage.getItem(`studio.plane.${slug}`) ?? '{}')
  } catch {
    return {}
  }
}

async function needMine(bucket) {
  /*
    Keyed on the whole request, not on the bucket (#259).

    Adding a search box to a cache keyed on the bucket name would have been
    silent and convincing: type anything, get the unsearched list back from
    the cache, and read it as a search that matches everything. The counts
    stay keyed on nothing, because they are about the buckets rather than
    about the query.
  */
  const key = mineKey()
  if (mine.lists[key] !== undefined) return
  mine.lists[key] = null
  try {
    const [rows, counts] = await Promise.all([
      settles(read('my_tasks', bucket, { q: mine.query, sort: mine.sort })),
      mine.counts === null ? settles(read('my_task_counts')) : Promise.resolve(mine.counts),
    ])
    /*
      `settles` answers null for a request that failed without throwing, so
      "not an array" is the same news as the catch below and must not become
      an empty list either — that is how a failed read became "nothing due
      today" in the first place.
    */
    if (Array.isArray(rows)) {
      mine.lists[key] = rows
      delete mine.trouble[key]
    } else {
      mine.lists[key] = []
      mine.trouble[key] = true
    }
    if (counts !== null && typeof counts === 'object') mine.counts = counts
  } catch {
    /*
      A FAILED READ IS NOT AN EMPTY LIST.

      This used to set an empty bucket, reasoning that #119's strip already
      says the office is unreachable and saying it twice is noise. That is
      sound for a TOTAL outage and wrong for a partial one: the counts and the
      list are two requests, so the counts can arrive while the list does not
      — and the screen then reads

          Today 3        (the tab)
          Nothing due today and no reminders.   (the body)

      with no strip, because the office IS reachable. Caught in a capture,
      where the two sat an inch apart contradicting each other.

      "Nothing due today" is a CLAIM about his own tasks. The same rule as the
      inbox: you may say you could not look; you may not say there is nothing
      there.
    */
    mine.trouble[key] = true
    mine.lists[key] = []
  }
  render()
}

/** Everything about my tasks is stale after a write, including the counts. */
function forgetMine() {
  for (const k of Object.keys(mine.lists)) delete mine.lists[k]
  mine.counts = null
}

/*
  Whether a read is actually out, which is what the loading sentence claims.

  Separate from `latest.tasks === null`, which cannot tell a read in flight
  from a read nobody started. Set before the await, for the same reason the
  null guard is: a second render while the first request is in flight must not
  start a second request, and must not report the panel as unasked either.
*/
let askedTasks = false

async function needTasks() {
  if (latest.tasks !== null) return
  askedTasks = true
  try {
    latest.tasks = await settles(read('portfolio_tasks'))
  } catch {
    // Left as an empty list rather than an error. A task screen that cannot
    // reach the office should say there is nothing to show; #119's strip is
    // what says the office is unreachable, and saying it twice is noise.
    latest.tasks = { counts: {}, tasks: [] }
  }
  render()
}

async function needLately() {
  if (latest.lately !== null) return
  try {
    latest.lately = await settles(read('lately'))
  } catch {
    // Left null. The view says there is nothing rather than showing an error,
    // which on a history page is nearly the same sentence.
    latest.lately = { office: [], building: {}, today: {} }
  }
  render()
}

async function refresh() {
  // A write can add a ledger row, so the kept copy is now behind. Ticking a
  // task is a write, so the task list is behind for exactly the same reason.
  latest.lately = null
  latest.tasks = null
  /*
    And every running job's step list, for the same reason: the press that
    triggered this refresh may well have been Stop, and a memoised progress
    line saying "on step three" beside a job that has just stopped is a
    reading that contradicts the row it sits in.
  */
  for (const k of Object.keys(progress)) delete progress[k]
  await Promise.all([
    hydrate(API, await presentedFresh()),
    // Both, together. Settings is a separate payload because it is a separate
    // screen and most visits never open it — but a write can change either, so
    // a refresh re-reads both rather than leaving one stale behind a tab.
    config.hydrateSettings(read),
    hydrateUsage(read),
  ])

  /*
    And the conversation, when one is on screen (#199).

    Here rather than in a path of its own, for the reason the pulse watcher
    already gives: `refresh` is the single route from "the data changed" to
    "the page shows it", and a second one would drift — the version that
    drifted being the rarely-exercised background path.

    Only when the chat is open. A conversation grows without bound and every
    other screen would be paying for a payload it does not draw.
  */
  if (state.sub === 'chat') {
    await chat.load(state.project, byId(state.project)?.id, tokenNow())
  }

  keepingPlace(() => { render() })
}

/** What this browser presents: a person's session if there is one. */
function tokenNow() {
  return presented()
}

/**
 * Redraw without moving the ground under someone who is reading.
 *
 * #199: an update must not yank the scroll away. The rule people expect from
 * every messaging app is "stick to the bottom if I am at the bottom, and
 * otherwise leave me exactly where I am" — being at the bottom is a statement
 * that you want the newest thing, and being anywhere else is a statement that
 * you are reading something.
 *
 * 40px of slack rather than an exact comparison: a thread that is one pixel
 * off the bottom because of a sub-pixel line height is a thread the person
 * thinks they are at the bottom of.
 */
/**
 * Are you looking at the newest message? (#205)
 *
 * Two scrollers, and which one is in charge depends on the width. On a desktop
 * the thread is a box with its own `max-height` and its own scrollbar. On a
 * phone it has neither — the conversation is in the page flow and the PAGE
 * scrolls, so `scrollHeight` equals `clientHeight` and the thread's own
 * numbers say "you are at the bottom" for ever.
 *
 * That is not a rounding error, it is the whole feature missing on the surface
 * that needs it most: on a phone the badge could never have appeared, and
 * every check written against the thread's own scroll would have passed while
 * it could not. Found by measuring rather than by reading the stylesheet —
 * 3561 tall in a 3561 box.
 *
 * 40px of slack for the same reason `keepingPlace` allows it: a thread one
 * pixel off the bottom because of a sub-pixel line height is a thread the
 * person believes they are at the bottom of.
 */
/*
  Were you looking at the newest message? — the question the keyboard asks.

  Deliberately NOT `atNewest`, which answers a related but different question
  for the arrival badge and includes a page-scroll branch. Here the thread's
  own scroller is the whole story:

    * no inner scroller means the conversation fits, so every message is on
      screen and the newest one is by definition the one you are looking at;
    * an inner scroller at its end means the same thing on purpose;
    * an inner scroller anywhere else means you are reading history, and the
      keyboard must not drag you away from it.

  Remembered rather than measured on demand, because by the time a `resize`
  event fires the layout has ALREADY changed — the box has shrunk around the
  old scroll position and every measurement describes the after, not the
  before. Two fixes were spent measuring at resize time before that was
  obvious.
*/
function lookingAtNewest(el) {
  if (el === null) return true
  const own = el.scrollHeight - el.clientHeight > 8
  if (!own) return true
  return el.scrollHeight - el.clientHeight - el.scrollTop < 40
}

function atNewest(threadEl) {
  if (threadEl === null) return true
  const ownScroller = threadEl.scrollHeight - threadEl.clientHeight > 8
  if (ownScroller) {
    return threadEl.scrollHeight - threadEl.clientHeight - threadEl.scrollTop < 40
  }
  // The page is the scroller: the newest message is at the thread's bottom
  // edge, so the question is whether that edge is on screen.
  return threadEl.getBoundingClientRect().bottom - window.innerHeight < 40
}

/*
  How long a request has been waiting, counted up (#215).

  One interval for the whole page, started when a waiting row appears and
  cleared when the last one goes, so an idle studio has no timer at all. It
  writes textContent rather than re-rendering: a render every second would
  fight the composer for focus and reset the caret, which is #197's lesson
  about a handler that redraws under somebody's hands.

  `when.words` is not used here on purpose. It rounds to "just now" and then to
  minutes, and the whole value of this line is in the first sixty seconds -
  "18s" is the difference between a page that is working and a page that is
  stuck.
*/
function tickWaiting() {
  const marks = document.querySelectorAll('[data-waiting-since]')
  if (marks.length === 0) {
    if (ageTimer !== null) { clearInterval(ageTimer); ageTimer = null }
    return
  }
  for (const el of marks) {
    const since = Number(el.dataset.waitingSince)
    if (!Number.isFinite(since)) continue
    const secs = Math.max(0, Math.round((Date.now() - since) / 1000))
    el.textContent = secs < 60
      ? `${secs}s`
      : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
  }
  if (ageTimer === null) ageTimer = setInterval(tickWaiting, 1000)
}

function keepingPlace(draw) {
  const before = $('[data-thread]')
  const was = before === null ? null : before.scrollTop
  const wasAtBottom = before !== null && atNewest(before)

  /*
    Whether a message that lands during this redraw should raise a badge (#205).

    The DECISION is here because only here can it be answered — after the
    redraw the old scroll position is gone. The DETECTION is somewhere else,
    in `noteArrivals`, because a reply can also land on a path that never
    comes through this function.

    Read once and cleared by whoever reads it, so a stale "you were scrolled
    up" cannot leak into an unrelated repaint half an hour later.
  */
  state.wasReading = before !== null && !wasAtBottom

  draw()

  const after = $('[data-thread]')
  if (after === null || was === null) {
    state.wasReading = false
    return
  }
  after.scrollTop = wasAtBottom ? after.scrollHeight : was
  if (wasAtBottom) forgetArrivals()
  state.wasReading = false
}

/**
 * What has arrived since the last time this ran (#205, #200).
 *
 * Called from the render path rather than from `keepingPlace`, because a reply
 * lands by two routes and only one of them goes through that function: the
 * background refresh does, and the composer's own round trip does not — it
 * calls `render` directly and then again when the answer replaces the
 * placeholder. Detection in `keepingPlace` alone would have missed the common
 * case entirely, which is the same shape as asserting at the wrong layer.
 *
 * Identity, not count. A message can arrive without the count changing: the
 * optimistic placeholder KEEPS ITS ID and merely stops being pending when the
 * real answer replaces it, so a length comparison sees nothing happen at the
 * exact moment the thing everybody is waiting for happens. So the witness is
 * the set of ids that are REAL — somebody else's words, not pending, not still
 * in flight — and anything newly in that set has arrived.
 */
function noteArrivals() {
  const now = chat.thread(state.project) ?? []
  /*
    Somebody else's words, and not a placeholder.

    Deliberately NOT also filtering `inflight`. `send` marks the optimistic
    placeholder both pending AND in flight, and `ask` clears only `pending`
    when the real answer replaces it — so excluding in-flight messages here
    excluded the arrival for ever, and the badge could never appear on the one
    path the product actually takes. What `inflight` was guarding against is
    your own optimistic copy, and `from !== 'grant'` already excludes that.
  */
  const real = now.filter((m) => m.from !== 'grant' && m.pending !== true)
  const ids = new Set(real.map((m) => String(m.id)))

  // First sight of a conversation is not an arrival — everything in it
  // arrived before you opened it, and a badge saying so on entry is the
  // "14 new messages" that greets you with your own history.
  if (state.seen.project !== state.project || state.seen.ids === null) {
    state.seen = { project: state.project, ids }
    return
  }

  const fresh = real.filter((m) => !state.seen.ids.has(String(m.id)))
  state.seen = { project: state.project, ids }
  if (fresh.length === 0) return

  const last = fresh[fresh.length - 1]
  const who = crewBy(last.from)?.name ?? 'The office'

  /*
    Announced whether or not it is visible (#200).

    `polite` rather than `assertive`: a reply is worth hearing at the next
    pause, and interrupting somebody mid-sentence is the behaviour that gets
    live regions switched off. Said even when the thread is at the bottom and
    the message is plainly on screen — a screen reader user has no "plainly".
  */
  announce(
    fresh.length === 1
      ? `${who} replied: ${String(last.text ?? '').slice(0, 160)}`
      : `${String(fresh.length)} new messages, the last from ${who}`,
  )

  // The badge only when it is needed. At the bottom the message is already on
  // screen, and a badge pointing at something you can see is noise.
  if (state.wasReading !== true) return
  const same = state.arrived.project === state.project
  state.arrived = {
    project: state.project,
    n: (same ? state.arrived.n : 0) + fresh.length,
    who,
  }
}

/**
 * Say something to a screen reader without saying it to anybody else (#200).
 *
 * One region, created once and reused, living outside the studio's own DOM so
 * a render cannot take it away mid-announcement — which is the classic way a
 * live region ends up announcing nothing: it is replaced in the same frame the
 * text is written into it, and the assistive technology never sees a change.
 *
 * Cleared before writing, because writing the same string twice is not a
 * change and a second identical arrival would be silent.
 */
function announce(words) {
  if (typeof document === 'undefined') return
  let region = document.getElementById('hq-announce')
  if (region === null) {
    region = document.createElement('div')
    region.id = 'hq-announce'
    region.className = 'aonly'
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('aria-atomic', 'true')
    document.body.appendChild(region)
  }
  region.textContent = ''
  // A tick later, or the clear and the write collapse into one mutation and
  // there is nothing for the screen reader to notice.
  window.setTimeout(() => { region.textContent = words }, 60)
}

/** Nothing is waiting below any more (#205). */
function forgetArrivals() {
  if (state.arrived.n === 0) return
  state.arrived = { project: null, n: 0, who: null }
  const badge = $('[data-arrived]')
  if (badge !== null) badge.hidden = true
}

async function live() {
  /*
    WHAT THIS BROWSER CAN PRESENT, not what is in one particular storage key.

    This read `hq.token` directly, so a browser holding a PERSON'S SESSION and
    no office key was read as holding nothing: the page drew the prototype and
    never asked the office at all -- no request, no 401, nothing in the network
    panel to explain it. The seam is `office.js`, which knows about both and
    refreshes a session that is nearly out.
  */
  const token = await presentedFresh()
  if (token === '') {
    /*
      Not a failure, and it must not read as one (#119). `state` stays
      `prototype`, which is the calm wording; `unreachable` is the alarming one
      and belongs only to a fetch that actually failed.
    */
    source.state = 'prototype'
    source.why = 'no token — showing the prototype'
    render()
    return
  }
  /*
    The studio payload first, then draw, then the rest (#119).

    This was one `Promise.all` over three fetches, so the page waited for the
    SLOWEST of them before drawing anything — and if one never answered, it
    never drew at all. `hydrate` has a ten-second deadline; the settings and
    usage payloads are separate modules and do not, so a hung office left the
    page on the default state indefinitely, saying "Prototype data", which is
    the calm wording. An outage was reading as normal for as long as it lasted.

    Found by `verify:offline`, which hangs every call and asserts the page says
    the office did not answer. It said the opposite.

    So: the payload that decides what is on screen is awaited and drawn, and the
    two that decorate Settings and Usage follow. They redraw when they arrive,
    and if they never do the page is still there and still honest.
  */
  await hydrate(API, token)
  /*
    How he chose to have it look, from the office (#124, ADR-0021).

    After the payload and before the redraw: the page has already applied this
    browser's cached copy at boot so there is no flash, and this is the record
    catching up with it. On the machine he last changed it on the two agree and
    nothing moves; on the other one the theme changes once, which is the whole
    point.

    It does NOT write back. `hydrateAppearance` suspends the sender for exactly
    that reason — applying what was just read would send it straight out again
    on every single page load.
  */
  hydrateAppearance(FROM_OFFICE.appearance)
  /*
    THE BOARD HE ARRANGED, FROM THE OFFICE (#341, ADR-0021, 0582).

    It was kept in `localStorage` only, so arranging the board on the desk and
    opening it on the phone showed two different boards -- and the panel that
    explained it said so out loud, because one row per (owner, project) was
    already taken by the default dashboard. 0582 put `surface` in the key and
    this is the reader.

    After the payload and before the redraw, and a project this session has
    already rearranged keeps what this session did: adopting the office's copy
    over a drop that has not landed yet is how a panel snaps back to where it
    was, which is ADR-0021's third rule and was a bug before it was one.
  */
  for (const p_ of PROJECTS) {
    if (Array.isArray(p_?.layout_board)) bcGrid.adopt(p_.slug, p_.layout_board)
  }
  /*
    Second attempt at the address the browser arrived with (#157).

    The first was made against the prototype's projects, before the office had
    answered, so a link to a real project could not resolve. Now it can — and
    only now, which is why this is here rather than at startup.
  */
  if (wantedPath !== null) {
    goToPath(wantedPath)
    wantedPath = null
    shownPath = null
  }
  render()
  /*
    The home board reads what is open and what just happened (#219), and both
    are lazy payloads that used to be fetched only when their own screen was
    opened. The home screen shows them now, so arriving is the trigger.
  */
  void needTasks()
  void needLately()
  /*
    And what has arrived since he last looked (#122). One query, on arrival,
    because the marks belong on the first screen he sees rather than on the
    second.
  */
  void (async () => {
    try {
      const [got, work] = await Promise.all([settles(read('unseen')), settles(read('team_work'))])
      Object.assign(unseen, got ?? {})
      Object.assign(teamWork, work ?? {})
      render()
    } catch {
      // No marks rather than a wrong mark. #119's strip already says when the
      // office cannot be reached, and a project wrongly flagged as having news
      // is worse than one not flagged at all.
    }
  })()
  /*
    And how he arranged it (#219, migration 0376).

    Its own read rather than a field on the studio payload, so a drag on this
    board is not a reason to re-read every project. Failure is silent and the
    default draws - a home screen that will not appear because its saved
    layout could not be fetched is worse than one that appears unarranged.
  */
  /*
    Whether the office can think, read on the way in and on every tick (#240).

    On the tick rather than only at load, because an open breaker closes on its
    own - the issue requires that the strip clears itself "without a reload if
    that is cheap", and `pulse.watch` already runs a refresh on a schedule, so
    it is cheap.
  */
  const readThinking = async () => {
    try {
      const h = (await read('thinking')) ?? {}
      const rows = Array.isArray(h.cannot_think) ? h.cannot_think : []
      const changed = rows.length !== health.cannotThink.length
      health.cannotThink = rows
      if (changed) render()
    } catch {
      /*
        Unknown, not healthy. A read that failed says nothing about the
        provider, and leaving the last answer up would be a stale alarm - which
        the health hydration guards against for the same reason two lines up.
      */
      if (health.cannotThink.length > 0) { health.cannotThink = []; render() }
    }
  }
  void readThinking()

  void read('workspace').then((w) => {
    panels.adoptHome(w)
    if (state.view === 'portfolio') render()
  }).catch(() => undefined)
  void Promise.allSettled([config.hydrateSettings(read), hydrateUsage(read)]).then(() => {
    render()
  })

  /*
    And then keep watching (#117).

    `refresh` rather than a bespoke update path: it is the same re-read every
    write already calls, so there is exactly one route from "the data changed"
    to "the page shows it". A second one would drift, and the version that
    drifted would be this one — the rarely-exercised background path.
  */
  /*
    The fourth argument is #153: relative times re-made from the instants in
    the DOM, on this tick and on no timer of its own. A second `setInterval`
    would be a second thing to leak and a second thing to forget to stop when
    the tab is hidden — both of which `pulse` already handles.
  */
  pulse.watch(API, token, refresh, () => { when.retime(document); void readThinking() })
}

/*
  The way back, wired once (#118).

  Registered here rather than at each of the fifteen write sites, because a
  per-button opt-in would have been forgotten by the third one. `act` calls this
  after every successful write; a result with no `undo` id offers nothing, which
  is most of them.

  `refresh` is passed so an undo redraws through the same path a write does.
*/
onWrite((_action, result) => {
  undo.offer(result, refresh)
})

live()

/*
  A door for the capture harness, and for nothing else (#135).

  `signedInSites` draws only when the project HAS a session, and the page will
  never invent one — an invented signed-in session is a claim that the office
  holds a credential for a site, and a screenshot of that would be believed.
  But a screen with no capture is a screen nobody is watching, and this
  repository lost a week of visual work to exactly that once.

  The provider grid (#265, #276) is here for a third reason: its three
  controls — add a provider, offer a tool, stop using one — are drawn only for
  a writer, and no provider is registered, so a capture without this shows an
  empty section and none of the three.

  The review queue (#276) is here for the same reason and it is the stronger
  case: the block draws only when the office has MADE something nobody has
  decided about, and it carries two buttons that change the project. The
  prototype must not invent those rows — a press on an invented document is a
  press that cannot work — so the only way the block is ever photographed is
  from here.

  So the store is reachable from a script running against a LOCAL server, and
  only there. `location.hostname` is the guard because it cannot be satisfied
  by anything the deployed page can be talked into: the origin is what it is.
  Nothing in the product reads this object.
*/
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  /*
    `projects` joins them for the document sheet's tags and collections (#276).
    Those controls are drawn only for a REAL document — a prototype one has no
    id, so offering to tag it would be a control that resolves and cannot work
    — and only for a writer. Both conditions are unsatisfiable in a capture
    without a door, and the block would then ship unlooked-at.
  */
  globalThis.__shots = {
    /*
      A REDRAW, for a check that needs one that nobody clicked.

      The experience rebuilds its whole shell for reasons that have nothing to
      do with what somebody is looking at - a lazy read landing, the call
      painter ticking, a store filling - and a rebuilt node is a fresh one. A
      check that wants to prove an open menu SURVIVES that cannot use a resize,
      because a resize does not redraw anything here; it has to cause the real
      thing. Exposed beside the other capture hooks rather than invented for
      one suite.
    */
    render,
    browserSites,
    browserSeen,
    reviewing,
    providers: config.PROVIDERS,
    projects: PROJECTS,
    // A running job's steps (#263, #276). The line is drawn only for a job
    // that is actually running AND only for a writer, so a capture without
    // this shows the Stop button with nothing beside it — which is the state
    // the change was made to end.
    progress,
    /*
      My Tasks (#259). The composer, the buckets and the editor are drawn only
      for a writer, and the list only for rows that exist — so a capture
      without this photographs "Sign in to see your own list", which is the one
      state the screen has that nobody needs a picture of.
    */
    mine,
    /*
      The rule the store keys its lists by, EXPORTED rather than restated
      (#259, migration 0504).

      `mine.lists` used to be keyed on the bucket name and is now keyed on the
      whole request — bucket, search and sort — because a cache keyed on the
      bucket hands back the unsearched list the moment you type. The capture
      harness seeds that store directly, and the moment the key changed it was
      writing to a name the renderer no longer reads: `rows: 3` in the
      diagnostic and `tasksInDom: 0` on the screen, which is exactly the
      "a list built twice will disagree" defect CLAUDE.md records.

      So the harness asks the product what its key is. One rule, one place.
    */
    mineKey,
    /*
      The two lazy reads the HOME BOARD waits on.

      `needTasks` and `needLately` are triggered by arriving on the portfolio,
      so for the first second or two the Tasks and Recent activity panels read
      "Reading what is open…" — and `npm run shots` fired its portfolio
      screenshot after a fixed 900ms pause. **Every capture of the front door
      has therefore photographed a panel mid-load**, and `npm run space`
      measured one: it reported 329px spare on a panel whose content was one
      line of placeholder text, and that number was nearly written up as an
      emptiness defect.

      Exposed rather than given a longer pause, for the reason the capture
      harness already learned about a settings pane: wait for the SECTION,
      never for a fixed time. A pause is a guess that gets slower machines
      wrong and a fast office wrong in the other direction.
    */
    latest,
    /*
      The SHELL state, so a harness can open the pane it needs to press in
      (#259, Phase 2).

      The provider controls live on Settings - Connections, which is a pane
      that fetches when it opens; CLAUDE.md records that a sandbox capture of
      one draws nothing and that the honest place to press such a control is a
      suite that can put the page in the right state. This is that door, behind
      the same localhost guard as everything else here, and the product reads
      none of it.
    */
    state,
    config,
    render,
  }
}
