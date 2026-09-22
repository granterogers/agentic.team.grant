/*
  The experimental Basecamp-inspired Team HQ — shell, Jump and surfaces.

  Reached only at the /basecamp path prefix. See bc/tokens.css for why this
  lives in its own directory and its own scope, and docs/basecamp/RUN-LEDGER.md
  for the decision record.

  ## What this module is, and is not

  It is a SECOND PRESENTATION of the same state. It imports the same office
  client and the same project data that the default studio uses, it writes
  through the same RPCs, and it reads the same canonical records. It holds no
  data of its own and no second task system. Where it cannot yet express a
  destination, it links into the default experience rather than hiding it -
  a capability that exists in code and cannot be found is the regression the
  run's pre-mortem calls Failure E.

  ## Dependency direction

  This module imports office.js and data.js directly, which is safe because
  neither imports app.js. What it needs FROM app.js - the state object, the
  repaint, the navigation helper - arrives through `mount()` once at boot, so
  there is no cycle and app.js keeps exactly one branch into here.

  ## Comments inside template literals

  A backtick inside a comment inside a template literal terminates the string
  and makes the whole module unparseable, which renders nothing and reports
  itself a long way from the cause. Plain words only inside a returned
  template.
*/

import { PROJECTS, source } from '../data.js'
import { act, attempt, canWrite, read } from '../office.js'
import * as compose from './compose.js'
import * as bcMini from './miniatures.js'
import * as todos from './todos.js'
import { breadcrumb, button, empty, errorState, esc, input, skeleton, status, tool } from './parts.js'

/*
  What app.js hands us at boot. Set once; never reassigned, so a stale
  reference cannot outlive a render.
*/
let ctx = null
export const mount = (c) => {
  ctx = c
  /*
    The miniatures and the compositions need the same context, and mounting
    them here rather than from app.js keeps the experiment's surface area to
    the files inside bc/ - which is what makes it deletable in one commit.
  */
  bcMini.mount(c)
  todos.mount(c)
  compose.mount(c)
}

const state = () => ctx.state
const go = (path) => ctx.go(path)
const repaint = () => ctx.render()

/** Every address in this experience carries the prefix. One place to change. */
const at = (p = '') => `/basecamp${p}`

/*
  ONE PLACE the project is read, and therefore one place the prototype's own
  memory is applied. See todos.overlay: it touches only rows that have no
  record behind them, so a signed-in session never sees it at all.
*/
const project = () => todos.overlay(PROJECTS.find((p) => p.slug === state().project) ?? PROJECTS[0])

/* ======================================================================== *
 * Tool definitions
 *
 * ONE LIST, read by the overview grid, the jump index and the breadcrumbs.
 * A row list built twice is a list that will disagree, and this repository has
 * already paid for that in the command bar.
 * ======================================================================== */

/**
 * The project's tools, in the order §8.2 recommends.
 *
 * `own` says whether this experience renders the surface itself or hands off
 * to the default studio. A handoff is an explicit, labelled destination, not a
 * gap - which is what keeps the preservation matrix honest.
 */
export const TOOLS = [
  /*
    TO-DOS, not Tasks. §6's rename, and it belongs HERE rather than on the
    surface: the route audit caught the heading saying "To-dos" while the
    breadcrumb and the jump index said "Tasks", which is 0311's two-words-for-
    one-thing arriving through a page title. One list, every caller.
  */
  { id: 'tasks', name: 'To-dos', own: true },
  /*
    §10 and §9. Two more views of the SAME to-dos, with their own addresses,
    because §5's two-level pattern means a miniature leads to the full tool
    and the board's full tool is not the to-do list. They hold no data of
    their own: the stages are the real `state` enum and the dates are
    `due_on` and `starts_on`, both already on every row.
  */
  { id: 'board', name: 'Card Table', own: true },
  /*
    §7. The project's conversation, which `web/studio/chat.js` already reads,
    sends and asks - `conversation_history` per project (#192). Another tool
    whose whole contract existed before this experience did.
  */
  { id: 'chat', name: 'Chat', own: true },
  { id: 'schedule', name: 'Schedule', own: true },
  { id: 'team', name: 'Agentic Team', own: true },
  /*
    And "Assets" is the same word twice with a marketing coat on. A document
    is a document; the gallery shows PDFs, written pages and uploads, and
    nobody calls one an asset out loud.
  */
  /*
    DOCS & FILES, which is what Grant calls it and what the home pane says.
    The tool said "Documents" while the pane said "Docs & Files" - the same
    two-words-for-one-thing the route audit caught between the heading and the
    breadcrumb, one screen over.
  */
  { id: 'documents', name: 'Docs & Files', own: true },
  { id: 'activity', name: 'Activity', own: true },
  { id: 'contacts', name: 'Contacts', own: true },
  /*
    "Integrations" is developer terminology on a project surface, which §15
    forbids. A person has SOURCES; what the office does with them is its
    business.
  */
  { id: 'sources', name: 'Sources', own: true },
  { id: 'settings', name: 'Project Settings', own: false },
]

/*
  WORK BOARD, PROJECT CHAT, ACTIVE JOBS AND OUTPUTS ARE NOT SECTIONS.

  They were listed here as four more tools with compatibility links to
  /p/:slug/board and friends — and none of those addresses exists. The default
  studio's `goToPath` only accepts a tab that is in SECTIONS, so all four fell
  through to the project overview: four links promising a destination, each
  one quietly delivering somewhere else. An offer may only promise what the
  press can perform, and a link is an offer.

  They are `TEAM_VIEWS` in app.js — the four sub-views of the AI Team section,
  and §10.8's own hierarchy says the same thing: two levels, never three. So
  they are reached through the team surface, which is where they live.
*/
export const TEAM_SUBVIEWS = [
  { id: 'board', name: 'Team board' },
  { id: 'chat', name: 'Team chat' },
  { id: 'jobs', name: 'Active jobs' },
  { id: 'outputs', name: 'Outputs' },
]

const toolById = (id) => TOOLS.find((t) => t.id === id) ?? null

/** Where a tool lives. An unowned tool is a real address in the default studio. */
const toolPath = (slug, id) => {
  const t = toolById(id)
  return t !== null && t.own ? at(`/p/${slug}/${id}`) : `/p/${slug}/${id}`
}

/* ======================================================================== *
 * Shell
 * ======================================================================== */

const trayItems = () => [
  { name: 'Home', to: at('/'), glyph: '⌂' },
  { name: 'My Tasks', to: at('/tasks'), glyph: '✓' },
  { name: 'Activity', to: at('/activity'), glyph: '≡' },
]

/*
  ASK THE TEAM APPEARS TWICE, and exactly one of them is ever visible.

  On a phone the top row has to hold Home, Jump and Attention in 390px; adding
  a fourth collapsed the centre column until the jump control read "J...". §6.1
  puts personal destinations in the tray, and the conversation is one - so the
  narrow layout moves it there rather than shrinking everything.

  Two elements rather than a conditional render because `wire()` queries the
  whole shell: both carry the same attribute, both get the same handler, and
  CSS decides which one exists at this width. A render-time branch would have
  to know the viewport, which is the thing CSS is for.
*/
/*
  WHICH DESTINATION IS THE ONE ON SCREEN.

  The experiment marked nothing as current — no `aria-current` anywhere —
  while the default studio's rail has marked it since it was written. Two
  costs, and the second is the one that was visible: a screen reader could
  not tell which destination it was standing in (§13 asks for `aria-current`
  on active navigation by name), and a press-everything audit found five
  controls that "changed nothing", because taking you where you already are
  IS nothing. A navigation control at its own destination should look like
  it is there, not like it is broken.
*/
const currentPath = () => {
  const s = state()
  if (s.view === 'tasks') return at('/tasks')
  if (s.view === 'lately') return at('/activity')
  if (s.view === 'bcsearch') return at('/search')
  if (s.view === 'project' && s.project !== null) {
    return s.tab === 'overview' ? at(`/p/${s.project}`) : at(`/p/${s.project}/${s.tab}`)
  }
  return at('/')
}
const isHere = (to) => currentPath() === to

/*
  ASK THE TEAM IS GONE (project home v2).

  Grant: *"Remove Ask the Team from the top of the interface. It duplicates the
  team communication functionality."* The blue Chat button on the project head
  opens the same sidebar, so two controls opened one thing - which is the
  duplication rule in the same specification, met by deletion rather than by
  renaming.
*/

/**
 * §6.1: a three-part sticky top row, and a persistent personal tray below the
 * content.
 *
 * The attention control on the right is the queue for blocked work and things
 * waiting on Grant - §6.1 says it must not become a permanent wide sidebar,
 * which is why it is a control with a count rather than a panel.
 */
const topRow = () => {
  const waiting = PROJECTS.reduce((n, p) => n + (p.waiting?.length ?? 0), 0)
  /*
    Where Attention would take you, computed here so the control can say
    whether you are already standing in it. With nothing waiting there is
    nowhere to go, and a control that cannot act says so rather than
    pretending: §13 asks a disabled control to explain itself where the
    ambiguity would block work.
  */
  /*
    WHICH PROJECT YOU ARE IN, carried by the shell rather than only by the
    title.

    The top row is sticky and the project title is not: scrolled down an
    overview, the shell read "Home / Jump to… / Ask the team / Attention" and
    nothing anywhere said which project this was. For a model whose central
    claim is that projects are stable containers (§1, §8), losing the
    container's name on scroll is the difference between a project-centred
    product and a dashboard with a large heading.

    §6.1 puts the jump control in the centre of the shell, which is where
    Basecamp carries this too — the control you press to go elsewhere is the
    one that should say where you are now.
  */
  const here = state().view === 'project' && state().project !== null ? project() : null
  const firstWaiting = PROJECTS.find((p) => (p.waiting ?? []).length > 0)
  const attentionTo = firstWaiting === undefined ? null : at(`/p/${firstWaiting.slug}/team`)
  return `<header class="bctop">
    <div class="bcleft">
      <!--
        A HOME ICON, not the word. Grant: the icon performs the same navigation
        without occupying space with the word. The accessible name stays, so
        nothing is lost to anyone reading the page aloud - which is the whole
        difference between removing a label and removing a word.
      -->
      <button type="button" class="bcbtn bcicon" data-bc-go="${at('/')}"
        aria-label="Home — all your projects"
        aria-current="${isHere(at('/')) ? 'page' : 'false'}">
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 10.5 12 3l9 7.5"></path>
          <path d="M5.5 9.5V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.5"></path>
        </svg>
      </button>
    </div>
    <button type="button" class="bcjump${here === null ? '' : ' bcjump--in'}" data-bc-jump
      aria-haspopup="dialog"
      aria-label="${esc(
        here === null
          ? 'Jump to a project, tool or record'
          : `You are in ${here.name}. Jump to a project, tool or record`,
      )}">
      <span>${esc(here === null ? 'Jump to…' : here.name)}</span><kbd>Shift J</kbd>
    </button>
    <div class="bcright">
      <button type="button" class="bcbtn" data-bc-attention
        ${attentionTo === null ? 'disabled' : ''}
        aria-current="${attentionTo !== null && isHere(attentionTo) ? 'page' : 'false'}"
        aria-label="${esc(
          waiting === 0
            ? 'Attention: nothing is waiting on you'
            : attentionTo !== null && isHere(attentionTo)
              ? `Attention: ${waiting} waiting on you, and you are looking at it`
              : `Attention: ${waiting} waiting on you`,
        )}">
        Attention${waiting === 0 ? '' : ` <span class="bcstatus bcstatus--waiting">${waiting}</span>`}
      </button>
    </div>
  </header>`
}

const tray = () =>
  `<nav class="bctray" aria-label="Your things">
    <!--
      CHAT stays in the personal tray, renamed.

      The specification removes Ask the Team from the TOP of the interface,
      where it duplicated the project head's blue Chat button. The tray is the
      bottom, and it is the only way into the sidebar from the portfolio, where
      there is no project head at all - so removing it here would take the
      typed team chat away from a phone on the projects screen rather than
      removing a duplicate.
    -->
    <button type="button" class="bcnarrow-only" data-bc-dock>
      <span aria-hidden="true">✎</span><span>Chat</span>
    </button>
    ${trayItems()
      .map(
        (i) =>
          `<button type="button" data-bc-go="${esc(i.to)}"
            aria-current="${isHere(i.to) ? 'page' : 'false'}"><span aria-hidden="true">${
            i.glyph
          }</span><span>${esc(i.name)}</span></button>`,
      )
      .join('')}
  </nav>`

/* ======================================================================== *
 * Previews (§8.3)
 *
 * Current useful content, never decorative numbers. Each returns the INSIDE of
 * a preview tile; `tool()` wraps it.
 * ======================================================================== */

const row = (title, meta, extra = '', done = false) =>
  `<div class="bcprow${done ? ' bcprow--done' : ''}">
    <span class="bcptitle">${esc(title)}</span>
    ${meta === '' ? '' : `<span class="bcpmeta">${esc(meta)}</span>`}
    ${extra}
  </div>`

const nothing = (line) => `<div class="bcpmeta">${esc(line)}</div>`

/**
 * §8.3 Tasks: active items with assignee and nearest due date; completed work
 * recedes rather than disappearing, so the preview says what is happening
 * without pretending the finished work never existed.
 */
const tasksPreview = (p) => {
  const all = p.tasks ?? []
  if (all.length === 0) return nothing('No tasks yet on this project.')
  const open = all.filter((t) => t.state !== 'done')
  const done = all.filter((t) => t.state === 'done')
  const shown = open.slice(0, 5)
  return (
    shown
      .map((t) =>
        row(
          t.title,
          [t.who, t.due, t.note].filter((x) => x !== undefined && x !== null && x !== '').join(' · '),
          t.blocked ? status('Blocked', 'blocked') : '',
        ),
      )
      .join('') +
    (open.length > shown.length
      ? `<div class="bcmore">${esc(`${open.length - shown.length} more open`)}</div>`
      : '') +
    (done.length === 0
      ? ''
      : `<div class="bcmore">${esc(`${done.length} completed`)}</div>`)
  )
}

/**
 * §8.3 Agentic Team: roster state, running/waiting/blocked work and the latest
 * meaningful output. §10.8 forbids showing the ordinary project user worker
 * names, queue identifiers or orchestration internals - so this reads people
 * and work, and the diagnostic view stays behind Active jobs.
 */
const teamPreview = (p) => {
  const waiting = p.waiting ?? []
  const crew = (ctx.crewFor?.(p.slug) ?? []).slice(0, 4)
  const bits = []
  if (crew.length > 0) {
    bits.push(
      crew
        .map((c) =>
          row(
            c.name,
            [c.role, c.doing].filter(Boolean).join(' · '),
            c.state === 'working'
              ? status('Running', 'running')
              : c.state === 'blocked'
                ? status('Blocked', 'blocked')
                : '',
          ),
        )
        .join(''),
    )
  }
  if (waiting.length > 0) {
    bits.push(
      waiting
        .slice(0, 2)
        .map((w) => row(w.what, [w.who, w.when].filter(Boolean).join(' · '), status('Waiting for you', 'waiting')))
        .join(''),
    )
  }
  /*
    §8.3 asks the Agentic Team preview for the latest meaningful OUTPUT as
    well as the roster and the blockers. Without it the preview says who is
    here and never what they produced, which is the half Grant is actually
    waiting for.
  */
  const made = outputsOf(p)[0]
  if (made !== undefined) {
    bits.push(
      row(
        made.output.title,
        [made.who, made.delivered].filter(Boolean).join(' · '),
        made.output.imported === true ? status('In the project', 'done') : status('Ready for you', 'waiting'),
      ),
    )
  }
  if (bits.length === 0) return nothing('Nobody is assigned to this project yet.')
  return bits.join('')
}

/**
 * What the team has produced on this project, newest first.
 *
 * Read off the project's own `requests`, which is where a job, its
 * instruction, who did it, what it was derived from and the output it
 * produced all live together. That togetherness is the point: §9 requires an
 * agent output to name its originating job, its instruction, its input
 * sources and its time, and a reader that had to join four things would be a
 * reader that eventually shows three of them.
 */
const outputsOf = (p) =>
  (p.requests ?? []).filter((r) => r.output !== undefined && r.output !== null && r.output.id)

/** §8.3 Documents: latest document, title and what it is. */
const documentsPreview = (p) => {
  const docs = p.documents ?? []
  if (docs.length === 0) return nothing('Nothing filed on this project yet.')
  return (
    docs
      .slice(0, 5)
      .map((d) => row(d.title, [d.kind, d.origin, d.size].filter(Boolean).join(' · ')))
      .join('') +
    (docs.length > 5 ? `<div class="bcmore">${esc(`${docs.length - 5} more`)}</div>` : '')
  )
}

/** §8.3 Activity: day-grouped, human-readable, technical noise suppressed. */
const activityPreview = (p) => {
  const acts = p.activity ?? []
  if (acts.length === 0) return nothing('Nothing has happened here yet.')
  return acts
    .slice(0, 6)
    .map((a) => row(`${a.who ?? 'The team'} ${a.verb ?? 'changed'} ${a.what ?? ''}`.trim(), a.when ?? ''))
    .join('')
}

const contactsPreview = (p) => {
  const cs = p.contacts ?? []
  if (cs.length === 0) return nothing('No people recorded against this project.')
  return cs
    .slice(0, 5)
    .map((c) => row(c.name, [c.role, c.org].filter(Boolean).join(' · ')))
    .join('')
}

/**
 * §8.3 Sources: connection health and recently imported knowledge. Setup noise
 * is suppressed while things are healthy, which is the point of the section -
 * a healthy connector has nothing to say.
 */
const sourcesPreview = (p) => {
  const ss = p.sources ?? []
  if (ss.length === 0) return nothing('No sources connected to this project.')
  return ss
    .slice(0, 5)
    .map((s) =>
      row(
        s.name ?? s.title ?? s.kind ?? 'Source',
        [s.kind, s.last, s.detail].filter(Boolean).join(' · '),
        s.trouble ? status('Needs attention', 'blocked') : '',
      ),
    )
    .join('')
}

const PREVIEW = {
  tasks: tasksPreview,
  team: teamPreview,
  documents: documentsPreview,
  activity: activityPreview,
  contacts: contactsPreview,
  sources: sourcesPreview,
}

/* ======================================================================== *
 * Project overview (§8)
 * ======================================================================== */

const overview = (p) => {
  /*
    ONLY THE TOOLS THIS GRID HAS A TILE FOR.

    This is the pre-§21 home, kept reachable so the two compositions can be
    compared - and it read `TOOLS.filter(t => t.own)` straight into
    `PREVIEW[t.id]`, so the moment §10 and §9 added the Card Table and the
    Schedule it threw "PREVIEW[t.id] is not a function" and rendered NOTHING.
    Found because the capture harness prints page errors; no check would have
    caught it, because a screen that throws has no overflow, no contrast
    failure and no dead control.

    Filtered rather than given two new tiles: this grid is the BEFORE in a
    comparison, and quietly improving it would spoil the only evidence for
    what §21 changed. The tools it has no tile for are listed below with the
    other hand-offs, which is where anything without a surface here belongs.
  */
  const owned = TOOLS.filter((t) => t.own && PREVIEW[t.id] !== undefined)
  const others = TOOLS.filter((t) => !t.own || PREVIEW[t.id] === undefined)
  const acts = p.activity ?? []
  const latest = acts[0]
  return `<div class="bchome">${projectHeader(p, latest)}
    <div class="bcgrid">
      ${owned
        .map((t) => {
          const body = PREVIEW[t.id](p)
          return tool({
            name: t.name,
            to: toolPath(p.slug, t.id),
            summary: summaryFor(t.id, p),
            body,
          })
        })
        .join('')}
    </div>
    <section class="bctool bcblock">
      <h2>Everything else on this project</h2>
      <p class="bcpmeta bcprose bcgap">
        These open in the current Team HQ. Nothing has moved; this experience
        has not built its own surface for them yet.
      </p>
      <div class="bcinline-list">
        ${others
          .map((t) =>
            t.own === true
              ? /*
                  A tool this experience DOES serve gets its own address, not
                  the hand-off. Sending the Card Table to the current Team HQ
                  would be a link that lies about where it goes - the defect
                  the route audit exists for, arriving through a list that was
                  written when everything here was a hand-off.
                */
                `<a href="${esc(at(`/p/${p.slug}/${t.id}`))}" data-bc-go="${esc(at(`/p/${p.slug}/${t.id}`))}">${esc(t.name)}</a>`
              : `<a href="${esc(toolPath(p.slug, t.id))}" data-bc-leave="${esc(
                  toolPath(p.slug, t.id),
                )}">${esc(t.name)}</a>`,
          )
          .join('')}
      </div>
    </section></div>`
}

/** The accessible summary a preview announces. §8.2 point 4. */
const summaryFor = (id, p) => {
  const n = {
    tasks: (p.tasks ?? []).filter((t) => t.state !== 'done').length,
    team: (p.waiting ?? []).length,
    documents: (p.documents ?? []).length,
    activity: (p.activity ?? []).length,
    contacts: (p.contacts ?? []).length,
    sources: (p.sources ?? []).length,
  }[id]
  const word = {
    tasks: n === 1 ? '1 open task' : `${n} open tasks`,
    team: n === 0 ? 'nothing waiting on you' : n === 1 ? '1 thing waiting on you' : `${n} things waiting on you`,
    documents: n === 1 ? '1 document' : `${n} documents`,
    activity: n === 0 ? 'no recent activity' : 'recent activity',
    contacts: n === 1 ? '1 person' : `${n} people`,
    sources: n === 1 ? '1 source' : `${n} sources`,
  }[id]
  return `${word}. Opens the ${toolById(id)?.name ?? id} tool.`
}

/**
 * §8.1: presence, exceptional status, options, title, short description and a
 * concise recent-activity sentence - in that priority order, and compressed on
 * a phone so the first module clears the fold.
 */
const projectHeader = (p, latest) => {
  const waiting = (p.waiting ?? []).length
  return `<div class="bcprojhead">
    <div class="bceyebrow">
      ${(ctx.crewFor?.(p.slug) ?? [])
        .slice(0, 5)
        .map((c) => esc(c.name))
        .join(', ') || 'No one assigned'}
      ${waiting === 0 ? '' : status(waiting === 1 ? '1 thing waiting' : `${waiting} things waiting`, 'waiting')}
      <span class="bcactions">
        ${button('Project settings', { 'data-bc-leave': `/p/${p.slug}/settings` })}
      </span>
    </div>
    <h1>${esc(p.name)}</h1>
    ${p.purpose ? `<p class="bcdesc">${esc(p.purpose)}</p>` : ''}
    ${
      latest
        ? `<p class="bcpmeta bclatest">Latest: ${esc(
            `${latest.who ?? 'the team'} ${latest.verb ?? 'changed'} ${latest.what ?? ''}`.trim(),
          )} · ${esc(latest.when ?? '')}</p>`
        : ''
    }
  </div>`
}

/* ======================================================================== *
 * Portfolio (home)
 * ======================================================================== */

const portfolio = () => {
  if (PROJECTS.length === 0) {
    return `<h1 class="bcsectiontitle">Your projects</h1>
      ${empty(
        {
          title: 'No projects yet',
          body: 'A project is the container everything else lives in — documents, tasks, the team working on it and everything they produce.',
        },
        '',
      )}`
  }
  return `<h1 class="bcsectiontitle">Your projects</h1>
    <div class="bcgrid bcgrid--projects">
      ${PROJECTS.map((p) => {
        const open = (p.tasks ?? []).filter((t) => t.state !== 'done').length
        const waiting = (p.waiting ?? []).length
        return tool({
          name: p.name,
          to: at(`/p/${p.slug}`),
          summary: `${open === 1 ? '1 open task' : `${open} open tasks`}, ${
            (p.documents ?? []).length
          } documents. Opens the project.`,
          body: `${p.purpose ? `<div class="bcpexcerpt">${esc(p.purpose)}</div>` : ''}
            ${waiting === 0 ? '' : `<div class="bcgap">${status(waiting === 1 ? '1 thing waiting on you' : `${waiting} things waiting on you`, 'waiting')}</div>`}
            ${tasksPreview(p)}`,
        })
      }).join('')}
    </div>`
}

/* ======================================================================== *
 * Tool surfaces
 * ======================================================================== */

const crumbFor = (p, toolId) =>
  breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById(toolId)?.name ?? toolId },
  ])

/**
 * §10.2 Tasks.
 *
 * Project commitments. NOT the personal My Tasks list, which is a different
 * domain with a different owner and lives at /basecamp/tasks - §2.4 and §10.2
 * both forbid merging them, and the two surfaces deliberately look related
 * without sharing a record.
 */
/*
  §6 — A PROJECT HAS LISTS, AND A LIST HAS TASKS.

  This surface was a flat bag of rows with completed work at the bottom, which
  is not what a to-do tool is: the real thing groups work under named lists,
  and the list is how a person finds anything once a project has more than a
  dozen tasks.

  IT NEEDED NO NEW BACKEND CONTRACT, which is the finding worth keeping. A
  list is a MILESTONE task (`is_milestone`, 0171) and a task names its list
  through `parent_task_id`; `app.studio_modules` has returned the milestones
  per project since 0286 and `app.studio_tasks` has returned `milestone` and
  `parent` on every row since 0530. The hierarchy has been in the database for
  months. `listsOf` derives it rather than storing it a second time, which is
  0310's rule.

  The one place the office's API does not line up: `hq_task_add` takes no
  parent and `hq_task_update` does. So adding to a list is two calls, and if
  the second fails the task exists and is simply unlisted - which is visible,
  recoverable and honest, and better than not offering it at all.
*/

/** One list's add-a-task form. Per list, because §10.2 expands IN PLACE. */
const taskAddForm = (listId) => {
  const k = listId === '' ? 'loose' : listId
  return `<form class="bcaddform" data-bc-taskform="${esc(k)}" hidden>
    ${input({ id: `bc-task-title-${k}`, label: 'What needs doing', name: 'title', autocomplete: 'off' })}
    ${input({ id: `bc-task-due-${k}`, label: 'Due date', name: 'due', type: 'date' })}
    ${input({ id: `bc-task-who-${k}`, label: 'Assigned to', name: 'who', autocomplete: 'off', hint: 'A team member’s name, or leave it unassigned.' })}
    <div class="bcrow">
      ${button('Add this task', { kind: 'primary', 'data-bc-tasksave': esc(k) })}
      ${button('Cancel', { 'data-bc-taskcancel': esc(k) })}
    </div>
  </form>`
}

const taskList = (p, g, whole = false) => {
  const all = p.tasks ?? []
  const open = g.items.filter((t) => (t.state_raw ?? t.state) !== 'done' && (t.state_raw ?? '') !== 'cancelled')
  const done = g.items.filter((t) => (t.state_raw ?? t.state) === 'done' || t.state_raw === 'cancelled')
  const k = g.id === '' ? 'loose' : g.id
  return `<section class="bctasklist" data-bc-tasklist="${esc(k)}">
    <header class="bctasklisthead">
      <h2>${esc(g.name)}</h2>
      <span class="bclistcount">${esc(`${done.length}/${g.items.length}`)}</span>
      ${
        g.loose === true || (whole && g.items.length === 0)
          ? ''
          : `<span class="bcactions">${button('Add a task', { 'data-bc-addtask': esc(k) })}</span>`
      }
    </header>
    ${g.loose === true ? `<p class="bcpmeta">Work that is not in a list yet.</p>` : taskAddForm(g.id)}
    <div class="bclist">
      ${open.map((t) => taskRow(t, all.indexOf(t), g.name)).join('')}
      ${
        g.items.length === 0
          ? whole
            ? /*
                §12: AN EMPTY TOOL SAYS WHAT THE AREA IS FOR and offers one
                next action. The list rewrite replaced the real empty state
                with the line "Nothing in this list yet", which says what is
                absent and not what the area is for - and the states audit
                caught it in one run. A bare sentence is not an empty state.
              */
              empty(
                {
                  title: 'No to-dos yet',
                  body: 'To-dos are what this project has committed to doing — each one with somebody on it and a date if it has one. Lists are how they divide up once there are enough to need dividing.',
                },
                button('Add a task', { kind: 'primary', 'data-bc-addtask': esc(g.id === '' ? 'loose' : g.id) }),
              )
            : `<p class="bcpmeta">Nothing in this list yet.</p>`
          : open.length === 0 && done.length === 0
            ? `<p class="bcpmeta">Everything in this list is done.</p>`
            : ''
      }
      ${
        done.length === 0
          ? ''
          : `<details class="bcdone">
              <summary class="bcmore">${esc(
                done.length === 1 ? '1 completed task' : `${done.length} completed tasks`,
              )}</summary>
              ${done.map((t) => taskRow(t, all.indexOf(t), g.name)).join('')}
            </details>`
      }
    </div>
  </section>`
}

const tasksSurface = (p) => {
  const all = p.tasks ?? []
  const groups = bcMini.listsOf(p)
  /*
    "NO LISTS" IS NOT "NO GROUPS".

    `listsOf` returns a group called "Not in a list" for work that belongs to
    none - correct, because a task in no list is still work. So a project with
    no lists at all comes back with exactly one group, the loose one, and the
    loose group deliberately carries no Add control: adding INTO "not in a
    list" is not a thing a person means.

    The first draft guarded on `groups.length === 0`, which therefore never
    fired, and the surface offered no way to add a task on any project without
    lists - the journey found it in one run. What decides is whether any NAMED
    list exists.
  */
  const named = groups.filter((g) => g.loose !== true)
  return `${crumbFor(p, 'tasks')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('tasks')?.name ?? 'To-dos')}</h1>
      <!--
        ADD A TASK IS THE PRIMARY ACTION HERE. Grant: *"Change Add a List to
        Add a Task unless there is a genuine separate list-creation function
        that requires a distinct command."* There is one - a list is a
        milestone task that others hang off (0171) and creating one is a
        different write - so it is kept, and demoted. What was wrong was the
        ORDER: the first thing offered on a to-do screen was a way to make a
        container rather than a way to make a to-do.
      -->
      <span class="bcactions">
        ${button('Add a Task', { kind: 'primary', 'data-bc-addtask': esc(named[0]?.id === undefined || named[0]?.id === '' ? 'loose' : named[0].id) })}
        ${button('New list', { 'data-bc-addlist': '1' })}
      </span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      What this project has committed to, in its lists. Your own list is under
      My Tasks, and what the team is running is under Agentic Team — three
      different things.
    </p>
    <form class="bcaddform" data-bc-listform hidden>
      ${input({ id: 'bc-list-name', label: 'What is this list called', name: 'name', autocomplete: 'off', hint: 'A stage, a workstream, a module — whatever the work actually divides into.' })}
      <div class="bcrow">
        ${button('Add this list', { kind: 'primary', 'data-bc-listsave': '1' })}
        ${button('Cancel', { 'data-bc-listcancel': '1' })}
      </div>
    </form>
    ${
      named.length === 0
        ? /*
            NO LISTS YET, and a task must still be addable.

            The first draft put an empty state here whose only control was Add
            a list, so a project with no to-dos could not be given a to-do
            without first being given a structure - and the journey suite hit
            it in one run. Basecamp does put every task in a list; making the
            list COMPULSORY before the first task is a different decision, and
            a worse one. So there is always one group, named for what it is,
            and organising later is the person's business.
          */
          taskList(
            p,
            {
              name: 'Everything on this project',
              id: '',
              items: all.filter((t) => t.milestone !== true),
            },
            true,
          )
        : groups.map((g) => taskList(p, g)).join('')
    }`
}

/*
  A STABLE LOCAL KEY, which is not the same thing as the office's id.

  Every task can be OPENED, because a record page is a view of data already in
  hand. Not every task can be CHANGED: the prototype projects this studio
  falls back to when there is no token carry no ids, and a write needs one.

  Conflating the two cost a whole screen. The Open control was drawn only when
  `t.id` existed, so in a signed-out browser it never rendered — and the
  record page was therefore in no capture at all, on any viewport. A screen
  with no capture is a screen nobody is watching, and this one had been
  written, wired and checked without anybody ever looking at it.

  So the key is the id where there is one and the position where there is
  not, and the controls that need canonical identity say so themselves.
*/
/*
  ONE KEY FOR A TASK, ANYWHERE IN THE EXPERIENCE.

  This was `t.id ?? at-<index>` while the miniatures had none at all - and the
  moment the miniature rows became openable and tickable, an index-based key
  here and a title-based one there would have been two keys for one row: a
  tick in the miniature and a tick on the surface would have remembered two
  different things, and opening a task from the board would have found
  nothing. An index is the wrong basis anyway, because filtering a list
  changes it. The port owns the key now, and takes the whole task.
*/
const taskKey = (t) => todos.keyOf(t)

/*
  A PERSON'S NAME, NOT THEIR SLUG. The rows read "emma" and "oliver" while
  the project home two clicks away read "Emma" and "Oliver", because the
  miniatures resolve the slug through the roster and this surface printed the
  column. Same defect as printing `connector` on the sources tile: the record
  is not the vocabulary.
*/
const whoName = (slug) =>
  slug === null || slug === undefined || slug === ''
    ? ''
    : ((ctx?.crew ?? []).find((c) => c.slug === slug)?.name ?? slug)

const norm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const repeatsList = (note, listName) => {
  const a = norm(note)
  const b = norm(listName)
  if (a === '' || b === '') return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/*
  THE ROW DOES NOT REPEAT ITS LIST.

  Every row read "emma - Ideal Client Avatar" inside the list called Ideal
  Client Avatar, ten times down the page, because the note carries the module
  name. The list is the heading above it; saying it again on each child spends
  the whole meta line on something already known.
*/
const taskRow = (t, i = 0, listName = '') => {
  const isDone = t.state === 'done'
  const id = t.id ?? ''
  const key = taskKey(t)
  return `<div class="bcitem${isDone ? ' bcitem--done' : ''}" data-bc-task="${esc(key)}">
    <!--
      THE TICK IS WRAPPED so its hit area can be 44px without the tick itself
      being 44px. Measured at 28x28 on a phone, which is the size of finding
      that never shows in a screenshot and always shows in somebody's thumb.
      A label containing its own input toggles it on press, so this is the
      hit area growing rather than a second control being introduced.
    -->
    <label class="bctickhit">
      <!--
        NOT DISABLED WHEN THERE IS NO RECORD. The same correction as in the
        miniature and for the same reason: every row a visitor without an
        office token can see carried no id, so the whole surface was a
        picture. The write still only happens where there is something to
        write to; where there is not, the prototype remembers.
      -->
      <input type="checkbox" class="bccheck" ${isDone ? 'checked' : ''}
        data-bc-tick="${esc(key)}"
        aria-label="${esc(`${isDone ? 'Completed' : 'Not completed'}: ${t.title}`)}">
    </label>
    <div class="bcitembody">
      <!--
        THE TITLE IS THE LINK, which is both the grammar section 10.2 describes
        and a far larger target than a word at the other end of the row.

        It was a separate Open control, and five of them stacked read as a
        column of the same word repeated - the row's actual content pushed
        left while the thing you press said nothing about where it goes.
      -->
      <button type="button" class="bcitemtitle bcitemlink" data-bc-task-open="${esc(key)}">${esc(t.title)}</button>
      <span class="bcitemmeta">${esc(
        /*
          The guard stays for the near-miss case: a note that merely BEGINS
          with the list's name ("Client Vision & Journey Mapping" under
          "Client Vision & Journey") is the same repetition with four extra
          characters, and an exact comparison let all of those through.
        */
        [whoName(t.who), t.due, repeatsList(t.note, listName) ? '' : t.note]
          .filter((x) => x !== undefined && x !== null && x !== '')
          .join(' · '),
      )}</span>
      ${t.blocked ? `<span class="bcitemmeta">${status('Blocked', 'blocked')} ${esc(t.blocked)}</span>` : ''}
    </div>
    <span></span>
  </div>`
}

/**
 * One task, as a record page (§9, §17 phase 4).
 *
 * THE SHARED RECORD GRAMMAR, in the order §9 sets: breadcrumb and actions,
 * title and status, who and when, the content, then the structured metadata
 * and the relationships. A message, a document, an event and an agent output
 * would all use this order — that sameness is the point, and is why the order
 * is written down rather than chosen per object.
 *
 * Assignment and the due date are edited HERE rather than in a settings maze,
 * which is §8.1's argument applied one level down: the controls belong beside
 * the thing they change.
 */
const taskRecord = (p) => {
  const wanted = String(state().bcTask ?? '')
  const t = (p.tasks ?? []).find((x) => taskKey(x) === wanted)
  if (t === undefined) {
    return `${crumbFor(p, 'tasks')}
      ${errorState(
        'That task is not on this project any more. It may have been removed, or the list may have moved on.',
        button('Back to Tasks', { 'data-bc-go': at(`/p/${p.slug}/tasks`) }),
      )}`
  }
  const done = t.state === 'done'
  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById('tasks')?.name ?? 'To-dos', to: at(`/p/${p.slug}/tasks`) },
    { name: t.title },
  ])}
    <div class="bcrecordhead">
      <h1>${esc(t.title)}</h1>
      <span class="bcactions">
        ${
          t.blocked
            ? status('Blocked', 'blocked')
            : done
              ? status('Done', 'done')
              : status('Open')
        }
      </span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      A commitment on ${esc(p.name)}. Not a job the team is running, and not
      an item on your own list — those are different things with different
      owners.
    </p>

    <h2 class="bcsubhead">Details</h2>
    <form class="bcaddform bcgap-l" data-bc-taskedit="${esc(String(t.id ?? ''))}">
      ${input({
        id: 'bc-edit-who',
        label: 'Assigned to',
        name: 'who',
        value: t.who ?? '',
        autocomplete: 'off',
        hint: 'A team member’s name, or leave it unassigned.',
      })}
      ${input({ id: 'bc-edit-due', label: 'Due date', name: 'due', type: 'date', value: isoDay(t.due) })}
      <div class="bcrow">
        ${button('Save', {
          kind: 'primary',
          'data-bc-tasksave-edit': String(t.id ?? ''),
          disabled: t.id === undefined || t.id === null || t.id === '',
        })}
        ${button(done ? 'Reopen' : 'Mark done', {
          'data-bc-taskdone': String(t.id ?? ''),
          'data-bc-want': done ? 'todo' : 'done',
          disabled: t.id === undefined || t.id === null || t.id === '',
        })}
      </div>
      ${
        t.id === undefined || t.id === null || t.id === ''
          ? `<p class="bcpmeta bcprose">These are the studio's example projects, which have no
             records behind them, so there is nothing to change. Sign in and the
             same controls write to the real project.</p>`
          : ''
      }
    </form>

    ${
      t.note || t.blocked
        ? `<h2 class="bcsubhead">Notes</h2>
           ${t.note ? `<p class="bcpmeta bcprose">${esc(t.note)}</p>` : ''}
           ${t.blocked ? `<p class="bcpmeta bcprose">${status('Blocked', 'blocked')} ${esc(t.blocked)}</p>` : ''}`
        : ''
    }

    <h2 class="bcsubhead">Discussion and history</h2>
    <p class="bcpmeta bcprose">
      Comments on a task, and its relations to documents and jobs, live in the
      current Team HQ. This experience has not built its own surface for them,
      so it sends you there rather than showing a copy that could disagree.
    </p>
    <div class="bcinline-list">
      <a href="/p/${esc(p.slug)}/tasks" data-bc-leave="/p/${esc(p.slug)}/tasks">Open in the current Team HQ</a>
    </div>`
}

/*
  A date input wants yyyy-mm-dd, and the payload's `due` is prose — "Due 16
  September" — because that is what the list renders. Anything that is not
  already a machine date is left empty rather than guessed at: a wrong date
  silently pre-filled into a form is worse than an empty one, because it is
  the value that gets saved when somebody presses Save without looking.
*/
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '')

/** §10.8 Agentic Team, as a project tool. */
const teamSurface = (p) => {
  const crew = ctx.crewFor?.(p.slug) ?? []
  const waiting = p.waiting ?? []
  return `${crumbFor(p, 'team')}
    <div class="bcrecordhead"><h1>Agentic Team</h1></div>
    <h2 class="bcsubhead">Who is on this</h2>
    ${
      crew.length === 0
        ? empty({ title: 'Nobody assigned yet', body: 'Assign a specialist and their work appears here.' })
        : `<div class="bclist">${crew
            .map(
              (c) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(c.name)}</span>
                  <span class="bcitemmeta">${esc([c.role, c.doing].filter(Boolean).join(' · '))}</span>
                </div>
                <span>${
                  c.state === 'working'
                    ? status('Running', 'running')
                    : c.state === 'blocked'
                      ? status('Blocked', 'blocked')
                      : status('Idle')
                }</span>
              </div>`,
            )
            .join('')}</div>`
    }
    <h2 class="bcsubhead">Waiting for you</h2>
    ${
      waiting.length === 0
        ? `<p class="bcpmeta bcprose">Nothing is waiting on a decision from you.</p>`
        : `<div class="bclist">${waiting
            .map(
              (w) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(w.what)}</span>
                  <span class="bcitemmeta">${esc([w.who, w.when, w.why].filter(Boolean).join(' · '))}</span>
                </div>
                <span>${status('Waiting for you', 'waiting')}</span>
              </div>`,
            )
            .join('')}</div>`
    }
    <h2 class="bcsubhead">What the team has made</h2>
    ${
      outputsOf(p).length === 0
        ? `<p class="bcpmeta bcprose">Nothing produced on this project yet.</p>`
        : `<div class="bclist">${outputsOf(p).map((r) => outputRow(r)).join('')}</div>`
    }
    <h2 class="bcsubhead">Running work</h2>
    <p class="bcpmeta bcprose bcgap">
      The team board, the team chat, running jobs with their stop controls and
      the outputs they produce are all in the current Team HQ. This experience
      has not built its own surface for them yet, so it sends you to the real
      one rather than showing a copy.
    </p>
    <div class="bcinline-list">
      ${TEAM_SUBVIEWS.map(
        (v) =>
          `<a href="/p/${esc(p.slug)}/team" data-bc-leave="/p/${esc(p.slug)}/team">${esc(v.name)}</a>`,
      ).join('')}
    </div>`
}

/**
 * One output, with its provenance and the one thing you can do with it.
 *
 * §9's agentic addition, in full: the originating job's instruction, who ran
 * it, what it was derived from, and when. An output card that names only its
 * title is the provenance loss the run's pre-mortem calls Failure L — and the
 * moment it becomes a project document is exactly when that trail has to
 * survive, because afterwards nobody can reconstruct it.
 *
 * ADD TO PROJECT IS OFFERED ONCE. An output already in the project says so
 * and offers nothing, which is the honest reading of an idempotent operation:
 * pressing again would succeed and change nothing, and a control that appears
 * to act and does not is worse than one that is not there. The database
 * enforces the idempotency (a partial unique index, 0317 through 0322); this
 * is the page not asking for something it has already been given.
 */
const outputRow = (r) => {
  const done = r.output.imported === true
  const ready = r.state === 'review' && !done
  return `<div class="bcitem" data-bc-output="${esc(r.output.id)}">
    <span></span>
    <div class="bcitembody">
      <span class="bcitemtitle">${esc(r.output.title)}</span>
      <span class="bcitemmeta">${esc(
        [r.who, r.output.kind, r.output.size, r.delivered].filter(Boolean).join(' · '),
      )}</span>
      ${r.ask ? `<span class="bcitemmeta">Asked: ${esc(r.ask)}${r.from ? ` — ${esc(r.from)}` : ''}</span>` : ''}
      ${
        (r.derived ?? []).length === 0
          ? ''
          : `<span class="bcitemmeta">From ${esc((r.derived ?? []).join(', '))}</span>`
      }
    </div>
    <span>${
      done
        ? status('In the project', 'done')
        : ready
          ? button('Add to project', { kind: 'primary', 'data-bc-addtoproject': r.output.id })
          : status('Running', 'running')
    }</span>
  </div>`
}

/*
  §21 — THE FULL DOCS AND FILES WORKSPACE.

  Two views of one list, because they answer different questions: a thumbnail
  wall answers "which one was it" and a list answers "what is here, and when".
  Grant asked for both, real previews in both, and a way to add a file.

  The view choice is a per-viewer convenience - which of two ways you like to
  look at a shelf - so it lives in this browser rather than in the office.
  That is the opposite call from the arrangement of the home, and deliberately:
  one is a preference about looking, the other is a layout he composed.

  THE SAME `p.documents` THE HOME PANE READS. There is no second document
  store and no fixture invented to make either look fuller.
*/

const docsView = () => {
  try {
    return globalThis.localStorage?.getItem('bc.docsview') === 'list' ? 'list' : 'wall'
  } catch {
    return 'wall'
  }
}

const docRow = (d, i) => {
  const ref = d.file ?? (d.id ? `id:${d.id}` : '')
  return `<div class="bcitem${ref === '' ? '' : ' bcdoc--openable'}" data-bc-doc="${esc(ref)}"
    data-bc-doc-title="${esc(d.title ?? '')}">
    <span class="bcrowthumb bcthumb" data-bc-thumb="${esc(ref)}" data-bc-thumb-i="${esc(String(i))}">
      ${(Array.isArray(d.lines) && d.lines.length > 0 ? d.lines : [92, 100, 84, 96])
        .slice(0, 4)
        .map((w) => `<span class="bcpline" style="width:${Math.max(24, Math.min(100, Number(w) || 80))}%"></span>`)
        .join('')}
    </span>
    <div class="bcitembody">
      <span class="bcitemtitle">${esc(d.title)}</span>
      <span class="bcitemmeta">${esc([d.kind, d.origin, d.size, d.when].filter(Boolean).join(' · '))}</span>
    </div>
    <span class="bcpmeta">${ref === '' ? '' : 'Opens in a new tab'}</span>
  </div>`
}

const documentsSurface = (p) => {
  const docs = p.documents ?? []
  const view = docsView()
  return `${crumbFor(p, 'documents')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('documents')?.name ?? 'Docs &amp; Files')}</h1>
      <span class="bcactions">
        <span class="bcseg" role="group" aria-label="How to show these">
          <!--
            The words true and false, as strings. The attribute helper renders
            a boolean true as a BARE attribute, which is right for disabled and
            wrong for aria-pressed: a bare one is the empty string, which is not
            a valid value, so the control announced no state at all and the
            control audit reported it as a press that changes nothing. A toggle
            that cannot say which way it is set is the same defect whether a
            person reads it or a screen reader does.
          -->
          ${button('Thumbnails', { 'data-bc-docview': 'wall', 'aria-pressed': view === 'wall' ? 'true' : 'false' })}
          ${button('List', { 'data-bc-docview': 'list', 'aria-pressed': view === 'list' ? 'true' : 'false' })}
        </span>
        ${button('Add a file', { kind: 'primary', 'data-bc-upload': '1' })}
      </span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      Everything filed on this project — what the team wrote, what you uploaded
      and anything brought in from a connected source. Opening one opens the
      real file in a new tab.
    </p>
    <form class="bcaddform" data-bc-uploadform hidden>
      <label class="bcfield">
        <span class="bclabel" for="bc-upload-file">The file</span>
        <input class="bcinput" type="file" id="bc-upload-file" name="file">
      </label>
      <div class="bcrow">
        ${button('Add it', { kind: 'primary', 'data-bc-uploadsave': '1' })}
        ${button('Cancel', { 'data-bc-uploadcancel': '1' })}
      </div>
    </form>
    ${
      docs.length === 0
        ? empty(
            {
              title: 'Nothing filed yet',
              body: 'Documents the team writes, files you upload and anything imported from a connected source all land here — each one as itself, not as a row in a table.',
            },
            button('Add a file', { kind: 'primary', 'data-bc-upload': '1' }),
          )
        : view === 'list'
          ? `<div class="bclist">${docs.map((d, i) => docRow(d, i)).join('')}</div>`
          : `<div class="bcdocs bcdocs--wall">${bcMini.docThumbs(docs)}</div>`
    }`
}

/*
  One person, as a record.

  Contacts was a read-only list of three lines per person, and v2 asks for two
  things it could not do: "clicking a contact should show useful information"
  and "the user should be able to add a new contact directly from the
  miniature". Both are views of ONE tool - the miniature, this list, the
  record and the form share `p.contacts` and the same two state fields, so
  there is no second copy of anybody to disagree with the first.
*/
const contactKey = (c, i) => String(i)

const contactRecord = (p, c) => {
  const lines = [
    ['What they are here', [c.role, c.org].filter(Boolean).join(' · ')],
    ['Where', c.where ?? ''],
    ['Email', c.email ?? ''],
    ['Phone', c.phone ?? ''],
    ['Last heard from', c.last ?? ''],
    ['Next', [c.next, c.nextDue].filter(Boolean).join(' · ')],
  ].filter(([, v]) => v !== '')
  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById('contacts')?.name ?? 'Contacts', to: at(`/p/${p.slug}/contacts`) },
    { name: c.name },
  ])}
    <div class="bcrecordhead">
      <h1>${esc(c.name)}</h1>
      <span class="bcactions">${button('Back to Contacts', { 'data-bc-contact-close': '1' })}</span>
    </div>
    <dl class="bcfacts bcgap-l">
      ${lines
        .map(
          ([k, v]) =>
            `<div class="bcfact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`,
        )
        .join('')}
    </dl>
    ${c.note ? `<h2 class="bcsubhead">Notes</h2><p class="bcpmeta bcprose">${esc(c.note)}</p>` : ''}
    ${
      (c.docs ?? []).length === 0
        ? ''
        : `<h2 class="bcsubhead">What they sent</h2>
           <!--
             A STACKED LIST, not the inline one. bcinline-list is a flex row
             built for hand-off links, and two document titles laid side by
             side in it read as one title: the first capture of this record
             said "Whats App Audio From Ben  WhatsApp from Ben" on a single
             line. Line breaks are not a list and neither is a row of them.
           -->
           <ul class="bcsentlist">${(c.docs ?? [])
             .map((d) => `<li>${esc(d)}</li>`)
             .join('')}</ul>`
    }`
}

const contactForm = (p) => `${breadcrumb([
  { name: p.name, to: at(`/p/${p.slug}`) },
  { name: toolById('contacts')?.name ?? 'Contacts', to: at(`/p/${p.slug}/contacts`) },
  { name: 'Add Contact' },
])}
  <div class="bcrecordhead"><h1>Add Contact</h1></div>
  <form class="bcaddform bcgap-l" data-bc-contactform="1">
    <!--
      Paired, because five full-width boxes down a 1000px dialog is a form
      that looks longer than it is. A name and what somebody is to the project
      are read together, and so are an email and a phone.
    -->
    <div class="bcformrow">
      ${input({ id: 'bc-c-name', label: 'Name', name: 'name', autocomplete: 'off' })}
      ${input({ id: 'bc-c-role', label: 'What they are to this project', name: 'role', autocomplete: 'off' })}
    </div>
    <div class="bcformrow">
      ${input({ id: 'bc-c-email', label: 'Email', name: 'email', type: 'email', autocomplete: 'off' })}
      ${input({ id: 'bc-c-phone', label: 'Phone', name: 'phone', autocomplete: 'off' })}
    </div>
    ${input({ id: 'bc-c-org', label: 'Where they work', name: 'org', autocomplete: 'off' })}
    <div class="bcrow">
      ${button('Add', { kind: 'primary', 'data-bc-contactadd-go': '1', disabled: !canWrite() })}
      ${button('Cancel', { 'data-bc-contact-close': '1' })}
    </div>
    ${
      canWrite()
        ? ''
        : `<p class="bcpmeta bcprose">These are the studio's example projects, which have no
           records behind them. Sign in and the same form writes to the real
           project.</p>`
    }
  </form>`

const contactsSurface = (p) => {
  const cs = p.contacts ?? []
  if (state().bcContactAdd === true) return contactForm(p)
  const wanted = state().bcContact
  if (wanted !== null && wanted !== undefined) {
    const c = cs.find((x, i) => contactKey(x, i) === String(wanted))
    if (c !== undefined) return contactRecord(p, c)
    /*
      A key that names nobody is the project having moved on, not a crash: the
      list is the honest answer and it is one press from here anyway.
    */
  }
  return `${crumbFor(p, 'contacts')}
    <div class="bcrecordhead">
      <h1>Contacts</h1>
      <span class="bcactions">${button('Add Contact', { 'data-bc-contact-add': '1' })}</span>
    </div>
    ${
      cs.length === 0
        ? empty({ title: 'No people recorded', body: 'People connected to this project appear here.' })
        : `<div class="bclist">${cs
            .map(
              (c, i) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <button type="button" class="bcitemtitle bcitemlink" data-bc-contact="${esc(contactKey(c, i))}">${esc(c.name)}</button>
                  <span class="bcitemmeta">${esc(
                    [c.role, c.org, c.where, c.last].filter(Boolean).join(' · '),
                  )}</span>
                </div>
                <span></span>
              </div>`,
            )
            .join('')}</div>`
  }`
}

/*
  §15 — WHAT THE OFFICE CAN SEE, IN A PERSON'S WORDS.

  Three things were wrong here and each is named by §15. The meta line printed
  `s.kind` straight from the record, so "connector" and "reference" - words
  nobody outside this repository uses - were on a project surface. The heading
  said "Integrations". And every source that was not in trouble was labelled
  **Connected**, including a reference, which is a link to something to read
  and is connected to nothing: that is faking integration availability, which
  §15 forbids by name and which would have had Grant believing the office was
  watching a page it has never fetched.

  It shares the miniature's vocabulary rather than restating it, and it says
  what each source IS rather than asserting a connection it cannot verify.
*/
const sourcesSurface = (p) => {
  const ss = p.sources ?? []
  return `${crumbFor(p, 'sources')}
    <div class="bcrecordhead"><h1>${esc(toolById('sources')?.name ?? 'Sources')}</h1></div>
    <p class="bcpmeta bcprose bcgap-l">
      Where this project's material comes from. A connected service is one the
      team can read; something to read is a link somebody left for it.
    </p>
    ${
      ss.length === 0
        ? empty({
            title: 'Nothing is connected yet',
            body: 'A connected notebook, drive folder or workspace lets the team read what is already written down. Until then it works from what is filed here.',
          })
        : `<div class="bcsources bcsources--full">${ss
            .map((s) => {
              const trouble = s.health === 'blocked' || s.trouble === true
              const connected = s.kind === 'connector'
              return `<div class="bcsource${trouble ? ' bcsource--trouble' : ''}">
                <span class="bcsourcename">${esc(s.name ?? s.title ?? 'A source')}</span>
                <span class="bcsourcewhat">${esc(s.what ?? s.detail ?? '')}</span>
                <span class="bcsourcewhen">${
                  trouble
                    ? status(esc(s.problem ?? 'Needs attention'), 'blocked')
                    : esc(
                        connected
                          ? ['Connected', s.last ? `last read ${s.last}` : 'not read yet'].join(' · ')
                          : 'Something to read',
                      )
                }</span>
              </div>`
            })
            .join('')}</div>`
    }`
}

/*
  §12 — ACTIVITY IS A STORY, and time is its axis.

  It rendered a flat list of sentences with the time as a trailing grey
  fragment, and it printed the raw slug: "emma pulled the WS02 client list".
  The same two defects as the to-do rows, on the surface whose whole subject
  is when things happened.
*/
const activitySurface = (p) => {
  const acts = p.activity ?? []
  return `${crumbFor(p, 'activity')}
    <div class="bcrecordhead"><h1>${esc(toolById('activity')?.name ?? 'Activity')}</h1></div>
    <p class="bcpmeta bcprose bcgap-l">
      What has happened on this project, most recent first.
    </p>
    ${
      acts.length === 0
        ? empty({ title: 'Nothing yet', body: 'What people and the team do on this project is listed here.' })
        : bcMini.timelineMini(p, { items: acts.length })
    }`
}

const STAGE = [
  { id: 'todo', name: 'Not started' },
  { id: 'doing', name: 'In progress' },
  { id: 'blocked', name: 'Stuck' },
  { id: 'done', name: 'Done' },
]

const MOVABLE = [
  { id: 'todo', name: 'Not started' },
  { id: 'doing', name: 'In progress' },
  { id: 'done', name: 'Done' },
]

const stageOf = (t) => {
  const raw = t.state_raw ?? (t.state === 'done' ? 'done' : t.state === 'doing' ? 'doing' : 'todo')
  if (raw === 'blocked' || (t.blocked && raw !== 'done')) return 'blocked'
  return raw === 'cancelled' ? 'done' : raw
}

const card = (p, t, i) => {
  const id = t.id ?? ''
  const key = taskKey(t)
  const list = (p.modules ?? []).find((m) => (m.id ?? m.name) === t.parent)
  return `<article class="bcbcard" data-bc-card="${esc(key)}">
    <button type="button" class="bcitemtitle bcitemlink" data-bc-task-open="${esc(key)}">${esc(t.title)}</button>
    <div class="bcbmeta">
      ${list === undefined ? '' : `<span class="bcbwhere">${esc(list.name)}</span>`}
      ${t.due ? `<span class="bcbdue">${esc(t.due)}</span>` : ''}
    </div>
    <!--
      DISABLED, NOT ABSENT, when the row has no canonical id - which is the
      precedent the tick above already sets, and for the same reason. Drawing
      it only for a row that can be written meant §10's whole interaction
      appeared in no capture on any viewport, because the prototype rows a
      signed-out browser falls back to carry no ids. A screen with no capture
      is a screen nobody is watching, and a CONTROL with no capture is the
      same thing one level down.
    -->
    <label class="bcbmove">
      <span class="bclabel">Where this is</span>
      <select class="bcinput" ${id === '' ? 'disabled' : ''} data-bc-move="${esc(id)}">
        ${MOVABLE.map(
          (m) =>
            `<option value="${esc(m.id)}" ${stageOf(t) === m.id ? 'selected' : ''}>${esc(m.name)}</option>`,
        ).join('')}
      </select>
    </label>
  </article>`
}

const boardSurface = (p) => {
  const all = (p.tasks ?? []).filter((t) => t.milestone !== true)
  return `${crumbFor(p, 'board')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('board')?.name ?? 'Card Table')}</h1>
      <span class="bcactions">${button('The list instead', { 'data-bc-go': at(`/p/${p.slug}/tasks`) })}</span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      The same to-dos, by where the work has got to. Moving a card changes the
      to-do — there is one set of records behind both views.
    </p>
    ${
      all.length === 0
        ? empty(
            {
              title: 'Nothing on the board yet',
              body: 'A card is a to-do, and the column it is in is how far it has got. Add the first to-do and it appears here.',
            },
            button('Go to the to-dos', { kind: 'primary', 'data-bc-go': at(`/p/${p.slug}/tasks`) }),
          )
        : `<div class="bcboard">
            ${STAGE.map((st) => {
              const items = all.filter((t) => stageOf(t) === st.id)
              return `<section class="bcbcol" data-stage="${esc(st.id)}">
                <header class="bcbcolhead">
                  <h2>${esc(st.name)}</h2>
                  <span class="bccolcount">${items.length}</span>
                </header>
                ${
                  items.length === 0
                    ? `<p class="bcpmeta">${esc(
                        st.id === 'blocked'
                          ? 'Nothing is stuck. A to-do is blocked from its own page, where there is room to say what it is waiting on.'
                          : 'Nothing here.',
                      )}</p>`
                    : items.map((t) => card(p, t, all.indexOf(t))).join('')
                }
              </section>`
            }).join('')}
          </div>`
    }`
}

/* ======================================================================== *
 * §9 — the Schedule
 *
 * Temporal, and honest about what it is: the office has dated WORK and no
 * events table, so this shows scheduled work and says so rather than looking
 * like a diary Grant can trust for his appointments. The dates are `due_on`
 * and `starts_on`, both already returned by `app.studio_tasks`.
 * ======================================================================== */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const monthGrid = (ym, marks, today) => {
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < lead; i += 1) cells.push('<span class="bccal-pad"></span>')
  for (let d = 1; d <= len; d += 1) {
    const iso = `${ym}-${String(d).padStart(2, '0')}`
    const n = marks.get(iso) ?? 0
    const cls = ['bccal-day']
    if (n > 0) cls.push('bccal-day--has')
    if (iso === today) cls.push('bccal-day--today')
    cells.push(
      `<span class="${cls.join(' ')}"${n > 0 ? ` title="${esc(n === 1 ? '1 thing due' : `${n} things due`)}"` : ''}>${d}</span>`,
    )
  }
  return `<div class="bccal">
    <div class="bccalmonth">${esc(`${MONTHS[m - 1]} ${String(y)}`)}</div>
    <div class="bccalgrid">
      ${DOW.map((d) => `<span class="bccal-dow">${esc(d)}</span>`).join('')}
      ${cells.join('')}
    </div>
  </div>`
}

const scheduleSurface = (p) => {
  const all = (p.tasks ?? []).filter((t) => t.milestone !== true)
  const dated = all
    .map((t) => ({ t, iso: String(t.due_on ?? t.starts_on ?? '').slice(0, 10) }))
    .filter((x) => x.iso !== '' && !Number.isNaN(new Date(`${x.iso}T00:00:00Z`).getTime()))
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  const undated = all.filter((t) => String(t.due_on ?? t.starts_on ?? '') === '')
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const marks = new Map()
  for (const { iso } of dated) marks.set(iso, (marks.get(iso) ?? 0) + 1)
  /*
    The months that HAVE something in them, plus this one. A month stepper
    would need state the router does not carry, and scrolling a short list of
    real months is a better answer than paging through empty ones.
  */
  const months = [...new Set([today.slice(0, 7), ...dated.map((x) => x.iso.slice(0, 7))])].sort()
  const byMonth = new Map()
  for (const d of dated) {
    const k = d.iso.slice(0, 7)
    if (!byMonth.has(k)) byMonth.set(k, [])
    byMonth.get(k).push(d)
  }
  return `${crumbFor(p, 'schedule')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('schedule')?.name ?? 'Schedule')}</h1>
      <span class="bcactions">${button('The list instead', { 'data-bc-go': at(`/p/${p.slug}/tasks`) })}</span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      When this project's work is due. The office keeps no separate diary, so
      everything here is scheduled work rather than an appointment — and a
      to-do with no date is at the foot of the page rather than invented onto
      one.
    </p>
    ${
      dated.length === 0 && undated.length === 0
        ? empty(
            {
              title: 'Nothing is scheduled',
              body: 'A to-do with a date appears here, on its day. Give one a date and this fills in.',
            },
            button('Go to the to-dos', { kind: 'primary', 'data-bc-go': at(`/p/${p.slug}/tasks`) }),
          )
        : months
            .map((ym) => {
              const items = byMonth.get(ym) ?? []
              return `<section class="bcmonth">
                ${monthGrid(ym, marks, today)}
                <div class="bcagenda">
                  ${
                    items.length === 0
                      ? `<p class="bcpmeta">Nothing is due this month.</p>`
                      : items
                          .map(
                            ({ t, iso }) => `<div class="bcagendaitem${bcMini.isLate(t) ? ' bcagendaitem--late' : ''}">
                              <span class="bcagendadate">
                                <span class="bcagendadd">${esc(String(Number(iso.slice(8, 10))))}</span>
                                <span class="bcagendamm">${esc(MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3))}</span>
                              </span>
                              <button type="button" class="bcitemtitle bcitemlink bcagendawhat"
                                data-bc-task-open="${esc(taskKey(t))}">${esc(t.title)}</button>
                              <!--
                                IN WORDS AS WELL AS IN COLOUR. A date box with
                                a different border is not a statement anybody
                                can read out, and the one thing a schedule owes
                                a person is which of these is already late.
                              -->
                              ${bcMini.isLate(t) ? status('Overdue', 'blocked') : ''}
                              ${t.who ? `<span class="bcagendawho">${esc(whoName(t.who))}</span>` : ''}
                            </div>`,
                          )
                          .join('')
                  }
                </div>
              </section>`
            })
            .join('') +
          (undated.length === 0
            ? ''
            : `<section class="bcundated">
                <h2>No date yet</h2>
                <div class="bclist">
                  ${undated.map((t) => taskRow(t, all.indexOf(t))).join('')}
                </div>
              </section>`)
    }`
}


/* ======================================================================== *
 * §7 — the project's Chat
 *
 * The team, present: a face, a name and a time against every line, which is
 * what makes a room feel occupied. A list of assignees does not.
 *
 * NO NEW CONTRACT AND NO SECOND STORE. `web/studio/chat.js` is the studio's
 * own conversation module - it reads the office's `conversation_history` for
 * a project, keeps the optimistic tail, and sends through the same path the
 * default Team HQ uses. This surface renders it. A second chat store would be
 * the copy that rots, which is 0310's whole argument.
 * ======================================================================== */

const chatSurface = (p) => {
  const said = ctx?.chatFor?.(p.slug) ?? []
  const shown = said.length > 0 ? said : (p.chat ?? [])
  const real = ctx?.chatIsReal?.(p.slug) === true
  return `${crumbFor(p, 'chat')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('chat')?.name ?? 'Chat')}</h1>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      What has been said about ${esc(p.name)}. The same conversation the team
      sees, wherever it was said from — here, Telegram or Slack.
    </p>
    ${
      shown.length === 0
        ? empty(
            {
              title: 'Nothing has been said here yet',
              body: 'Ask the team something about this project and it starts the conversation. Everything said about it, on any surface, appears here.',
            },
            '',
          )
        : `<div class="bcchat bcchat--full">
            ${shown.map((m) => bcMini.said_(m)).join('')}
          </div>`
    }
    ${
      real || shown.length === 0
        ? ''
        : /*
            SAYING SO, because the alternative is a fiction presented as his
            conversation. A signed-out browser has no thread to read, and the
            prototype one stands in for the shape; §11's rule is that the page
            says which it is rather than letting him assume.
          */
          `<p class="bcpmeta bcgap">This is an example conversation. Sign in and the
            office's own record replaces it.</p>`
    }
    <form class="bcaddform bcsay" data-bc-sayform>
      ${input({ id: 'bc-say', label: `Ask the team about ${p.name}`, name: 'say', autocomplete: 'off' })}
      <div class="bcrow">
        ${button('Send', { kind: 'primary', 'data-bc-say': '1' })}
      </div>
    </form>`
}

const SURFACE = {
  overview,
  tasks: (p) => (state().bcTask === null || state().bcTask === undefined ? tasksSurface(p) : taskRecord(p)),
  team: teamSurface,
  documents: documentsSurface,
  contacts: contactsSurface,
  sources: sourcesSurface,
  activity: activitySurface,
  board: boardSurface,
  schedule: scheduleSurface,
  chat: chatSurface,
}

/* ======================================================================== *
 * Personal surfaces
 * ======================================================================== */

/**
 * My Tasks - a person's own list, across projects.
 *
 * DELIBERATELY A SEPARATE SURFACE from any project's Tasks tool. §2.4: project
 * commitments, a person's private list and agent execution jobs are three
 * domains; relationships may connect them and their ownership does not merge.
 */
const myTasks = () => {
  /*
    THREE ANSWERS, AND THEY ARE NOT THE SAME ANSWER.

    Not signed in: there is no list to read, and saying so is honest. A
    skeleton here would be a promise of something that is never coming, and
    an empty list would be a claim about a list nobody looked at.

    Still coming: a skeleton, because the shape is predictable.

    Could not be read: say that. You may say you could not look; you may not
    say there is nothing there.

    The first version of this had only the middle two, so a signed-out browser
    sat on shimmering bars for ever — which is what a skeleton that never
    resolves looks like from the outside, and it was in a capture nobody had
    opened.
  */
  const signedIn = ctx.canWrite?.() === true
  if (signedIn) ctx.askForMyTasks?.()
  const mine = signedIn ? (ctx.myTasks?.() ?? null) : []
  /*
    A READ THAT FAILED IS NOT AN EMPTY LIST.

    The default studio has already shipped the other version of this: a failed
    fetch rendered as "Nothing due today" under a tab reading "Today 3". You
    may say you could not look; you may not say there is nothing there.
  */
  const trouble = signedIn && ctx.myTasksTrouble?.() === true
  return `<h1 class="bcsectiontitle">My Tasks</h1>
    <p class="bcpmeta bcprose bcgap-l">
      Your own list. Separate from what any project has committed to, and from
      what the team is running.
    </p>
    ${
      !signedIn
        ? empty({
            title: 'Sign in to see your list',
            body: 'My Tasks is your own list, kept by the office. This browser has no token, so there is nothing to read — the projects above are the studio’s examples.',
          })
        : trouble
          ? errorState('Your list could not be read just now.', button('Try again', { 'data-bc-go': at('/tasks') }))
          : mine === null
        ? skeleton(4)
        : mine.length === 0
          ? empty({ title: 'Nothing on your list', body: 'Things you take on yourself collect here.' })
          : `<div class="bclist">${mine
              .map(
                (t) => `<div class="bcitem${t.state === 'done' ? ' bcitem--done' : ''}">
                  <input type="checkbox" class="bccheck" ${t.state === 'done' ? 'checked' : ''}
                    data-bc-mytick="${esc(t.id ?? '')}"
                    aria-label="${esc(`${t.state === 'done' ? 'Completed' : 'Not completed'}: ${t.title}`)}">
                  <div class="bcitembody">
                    <span class="bcitemtitle">${esc(t.title)}</span>
                    <span class="bcitemmeta">${esc([t.due, t.project].filter(Boolean).join(' · '))}</span>
                  </div>
                  <span></span>
                </div>`,
              )
              .join('')}</div>`
    }`
}

const allActivity = () => {
  const rows = PROJECTS.flatMap((p) => (p.activity ?? []).map((a) => ({ ...a, project: p.name })))
  return `<h1 class="bcsectiontitle">Activity</h1>
    ${
      rows.length === 0
        ? empty({ title: 'Nothing yet', body: 'What happens across your projects is listed here.' })
        : `<div class="bclist">${rows
            .map(
              (a) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(
                    `${a.who ?? 'The team'} ${a.verb ?? 'changed'} ${a.what ?? ''}`.trim(),
                  )}</span>
                  <span class="bcitemmeta">${esc([a.project, a.when].filter(Boolean).join(' · '))}</span>
                </div>
                <span></span>
              </div>`,
            )
            .join('')}</div>`
    }`
}

/* ======================================================================== *
 * Full search (§7.4)
 * ======================================================================== */

/*
  WHY THIS EXISTS RATHER THAN A REDIRECT.

  Shift+Enter promoted the query to `/?q=…` in the default studio. Nothing
  there reads `q` — and `keepUrl()` strips the query on the first paint
  anyway — so the keystroke navigated home and dropped what had been typed.
  An offer may only promise what the press can perform, and a search box that
  silently discards a search is the worst version of that: it looks like it
  worked.

  §7.4's requirements, and what each is met by here:

  - filters for object type and project: both, as chips;
  - results show type, project, title, a useful excerpt, owner and date;
  - spans documents, project tasks, contacts, sources, agents and outputs.

  Everything searched is already in hand from the studio payload, so this adds
  no fetch and cannot disagree with what the rest of the experience is
  showing. Access control is the office's: this searches what it sent us.
*/

const KINDS = ['Everything', 'Tasks', 'Documents', 'People', 'Sources', 'Outputs', 'Projects']

const searchHits = (q, kind, only) => {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  const hits = []
  const want = (k) => kind === 'Everything' || kind === k
  const match = (...bits) => bits.filter(Boolean).join(' ').toLowerCase().includes(needle)

  for (const p of PROJECTS) {
    if (only !== null && p.slug !== only) continue
    if (want('Projects') && match(p.name, p.purpose)) {
      hits.push({ kind: 'Project', project: p.name, title: p.name, excerpt: p.purpose ?? '', who: '', when: '', to: at(`/p/${p.slug}`) })
    }
    if (want('Tasks')) {
      for (const t of p.tasks ?? []) {
        if (!match(t.title, t.note, t.who)) continue
        hits.push({ kind: 'Task', project: p.name, title: t.title, excerpt: t.note ?? '', who: t.who ?? '', when: t.due ?? '', to: at(`/p/${p.slug}/tasks`) })
      }
    }
    if (want('Documents')) {
      for (const d of p.documents ?? []) {
        if (!match(d.title, d.kind, d.origin)) continue
        hits.push({ kind: 'Document', project: p.name, title: d.title, excerpt: [d.kind, d.size].filter(Boolean).join(' · '), who: d.origin ?? '', when: d.when ?? '', to: at(`/p/${p.slug}/documents`) })
      }
    }
    if (want('People')) {
      for (const c of p.contacts ?? []) {
        if (!match(c.name, c.role, c.org)) continue
        hits.push({ kind: 'Contact', project: p.name, title: c.name, excerpt: [c.role, c.org].filter(Boolean).join(' · '), who: '', when: c.last ?? '', to: at(`/p/${p.slug}/contacts`) })
      }
    }
    if (want('Sources')) {
      for (const so of p.sources ?? []) {
        const name = so.name ?? so.title ?? so.kind ?? ''
        if (!match(name, so.kind, so.detail)) continue
        hits.push({ kind: 'Source', project: p.name, title: name, excerpt: so.detail ?? so.kind ?? '', who: '', when: so.last ?? '', to: at(`/p/${p.slug}/sources`) })
      }
    }
    if (want('Outputs')) {
      for (const r of outputsOf(p)) {
        if (!match(r.output.title, r.ask, r.who)) continue
        hits.push({ kind: 'Output', project: p.name, title: r.output.title, excerpt: r.ask ?? '', who: r.who ?? '', when: r.delivered ?? '', to: at(`/p/${p.slug}/team`) })
      }
    }
  }

  if (want('People')) {
    for (const c of ctx.crew ?? []) {
      if (!match(c.name, c.role, (c.expertise ?? []).join(' '))) continue
      hits.push({ kind: 'Specialist', project: '', title: c.name, excerpt: c.role ?? '', who: '', when: '', to: at('/') })
    }
  }
  return hits
}

const search = () => {
  const s = state()
  const q = s.bcQuery ?? ''
  const kind = s.bcKind ?? 'Everything'
  const only = s.bcOnly ?? null
  const hits = searchHits(q, kind, only)
  return `<h1 class="bcsectiontitle">Search</h1>
    <form class="bcaddform bcgap-l" data-bc-searchform>
      ${input({ id: 'bc-search-q', label: 'Search everything', name: 'q', value: q, autocomplete: 'off' })}
      <div class="bcinline-list" role="group" aria-label="Filter by type">
        ${KINDS.map(
          (k) =>
            `<button type="button" data-bc-kind="${esc(k)}" aria-pressed="${k === kind ? 'true' : 'false'}">${esc(k)}</button>`,
        ).join('')}
      </div>
      <div class="bcinline-list" role="group" aria-label="Filter by project">
        <button type="button" data-bc-only="" aria-pressed="${only === null ? 'true' : 'false'}">Every project</button>
        ${PROJECTS.map(
          (p) =>
            `<button type="button" data-bc-only="${esc(p.slug)}" aria-pressed="${only === p.slug ? 'true' : 'false'}">${esc(p.name)}</button>`,
        ).join('')}
      </div>
    </form>
    ${
      q.trim() === ''
        ? empty({
            // Not "Search everything" — that is the field's own label eighty
            // pixels above it, and the same four words twice reads as nobody
            // having looked at the screen.
            title: 'What you can search',
            body: 'Projects, their tasks and documents, the people on them, what they are connected to, and what the team has produced.',
          })
        : hits.length === 0
          ? empty({
              title: 'Nothing matches that',
              body: `No project, task, document, person, source or output matches “${q.trim()}”. This searches what the office has sent this browser — it is not a claim about what does not exist anywhere.`,
            })
          : `<p class="bcpmeta bcprose bcgap-l">${esc(
              hits.length === 1 ? '1 result' : `${hits.length} results`,
            )}</p>
            <div class="bclist">${hits
              .map(
                (h) => `<button type="button" class="bcitem bcresult" data-bc-go="${esc(h.to)}">
                  <span class="bcstatus">${esc(h.kind)}</span>
                  <span class="bcitembody">
                    <span class="bcitemtitle">${esc(h.title)}</span>
                    ${h.excerpt ? `<span class="bcitemmeta">${esc(h.excerpt)}</span>` : ''}
                    <span class="bcitemmeta">${esc(
                      [h.kind === 'Project' ? '' : h.project, h.who, h.when].filter(Boolean).join(' · '),
                    )}</span>
                  </span>
                  <span></span>
                </button>`,
              )
              .join('')}</div>`
    }`
}

/* ======================================================================== *
 * Body selection
 * ======================================================================== */

/* ======================================================================== *
 * EXPANDED — a module's full version, as a modal over the project home
 *
 * Project home v2: *"When a module needs its expanded view, it should open as
 * a pop-up/modal overlay, rather than navigating away to a completely separate
 * page. The expanded interface should have an appropriately positioned X for
 * closing it. Closing it should return naturally to the underlying project
 * homepage."*
 *
 * ONE IMPLEMENTATION, TWO CONTAINERS. The expanded view is the SAME renderer
 * the address already used - `tasksSurface`, `documentsSurface` and the rest -
 * drawn inside a dialog instead of in the page. It is not a second
 * implementation of each tool, which the specification forbids in the contacts
 * section by name and which is what a modal built beside a page always becomes.
 *
 * The addresses still work, because a deep link to a tool is a different thing
 * from a press on the home, and losing one to gain the other would be trading
 * a defect for a defect.
 * ======================================================================== */

const EXPANDED_NAME = {
  tasks: 'To-dos',
  board: 'Card Table',
  documents: 'Docs & Files',
  schedule: 'Schedule',
  team: 'The team',
  contacts: 'People',
  sources: 'Where the material comes from',
  activity: 'Latest activity',
}

const expandedOverlay = (p) => {
  const id = state().bcExpanded
  if (id === null || id === undefined || id === '') return ''
  const render = SURFACE[id]
  if (render === undefined) return ''
  return `<div class="bcexp" data-bc-expanded="${esc(id)}">
    <div class="bcexpback" data-bc-expclose="1"></div>
    <div class="bcexpbox" role="dialog" aria-modal="true"
      aria-label="${esc(EXPANDED_NAME[id] ?? id)}">
      <button type="button" class="bcexpx" data-bc-expclose="1" aria-label="Close">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18"></path>
        </svg>
      </button>
      <div class="bcexpbody">${render(p)}</div>
    </div>
  </div>`
}

const body = () => {
  const s = state()
  if (s.view === 'bcsearch') return search()
  if (s.view === 'tasks') return myTasks()
  if (s.view === 'lately') return allActivity()
  if (s.view === 'project') {
    const p = project()
    if (p === undefined) {
      return errorState('That project could not be found.', button('Back to your projects', { 'data-bc-go': at('/') }))
    }
    /*
      The overview is the surface under §21's experiment, so a viewer who has
      chosen a composition gets it INSTEAD of the shipped grid - through the
      real shell, the real header and the real routing, because a composition
      judged in a harness is a composition judged somewhere nobody stands.
      Every other tab is untouched.
    */
    if (s.tab === 'overview') {
      const pick = compose.chosen()
      if (pick !== 'grid') return `${compose.COMPOSITIONS[pick](p)}${expandedOverlay(p)}`
    }
    const render = SURFACE[s.tab] ?? overview
    return render(p)
  }
  return portfolio()
}

/**
 * The whole experience, as one string.
 *
 * `#root` is replaced wholesale by the caller exactly as the default studio
 * does, so the persistent elements OUTSIDE it - the dock, the undo bar, the
 * settings and document viewers, the drop layer - keep their lifecycle. That
 * is a structural requirement of this page, not a detail.
 */
export const html = () =>
  `<a class="bcskip" href="#bcmain">Skip to main content</a>
  ${topRow()}
  <main class="bcmain" id="bcmain" tabindex="-1">${body()}</main>
  ${tray()}`
