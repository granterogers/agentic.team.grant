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

import * as menu from './menu.js'
import { PROJECTS, SOURCE_STATE, source } from '../data.js'
import { act, attempt, canWrite, read } from '../office.js'
import * as compose from './compose.js'
import * as identity from './identity.js'
import { MARKS } from '../logos/marks.js'
import * as bcMini from './miniatures.js'
import * as cal from './calendar.js'
import * as docsrc from './docsources.js'
import * as finder from './finder.js'
import * as websrc from './websources.js'
import * as when from '../when.js'
import * as session from '../session.js'
import * as bcDocOrder from './docorder.js'
import * as stopping from './stopping.js'
import * as contacts from './contacts.js'
import * as people from '../people.js'
import * as bcDrive from './drive.js'
import * as todos from './todos.js'
import * as account from './account.js'
import { breadcrumb, button, empty, errorState, esc, input, skeleton, status, tool } from './parts.js'
import * as activity from './activity.js'
import { driveFolder } from './drivefolder.js'

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
  activity.configure({
    esc,
    read,
    crew: () => ctx?.crew ?? [],
    projects: () => PROJECTS,
    avatar: (person, size) => avatar(person, size),
    go: (to) => ctx.goAnywhere(to),
    repaintShell: () => ctx.render(),
    // The office's existing activity rows, for when the ledger is off. The gateway's `lately` section is office-wide and already folds
    // repeats and leaves out test traffic; a project page, and the moment before it arrives, use each project's own activity.
    rows: (scope) => {
      ctx?.askActivity?.()
      const lately = ctx?.officeActivity?.() ?? null
      if (scope === '' && Array.isArray(lately)) return lately
      return PROJECTS.filter((p) => scope === '' || p.slug === scope).flatMap((p) => (Array.isArray(p.activity) ? p.activity : []).map((a) => ({ ...a, project: p.name })))
    },
    today: () => ctx?.activityToday?.() ?? null,
  })
  contacts.mount(c)
  compose.mount(c)
  account.mount(c)
  cal.init(c)
  docsrc.init(c)
  websrc.init(c)
  c.find = (q) => searchHits(q, 'Everything', null)
  finder.onArrive(() => {
    c.render()
    c.jumpRefresh?.()
  })
}

const state = () => ctx.state
const go = (path) => ctx.go(path)
const repaint = () => ctx.render()

/** Every address in this experience carries the prefix. One place to change. */
// Team HQ's addresses are the site's own (#382).
const at = (p = '') => (p === '' ? '/' : p)

/*
  ONE PLACE the project is read, and therefore one place the prototype's own
  memory is applied. See todos.overlay: it touches only rows that have no
  record behind them, so a signed-in session never sees it at all.
*/
/*
  ONE PLACE the project is read, and therefore one place each prototype memory
  is applied. Both touch only rows that have no record behind them, so a
  signed-in session sees neither.
*/
/*
  AND IT MAY LEGITIMATELY BE NOBODY.

  `PROJECTS[0]` is undefined when the office has no projects -- which is not an
  edge case, it is every office on its first morning. The overlays passed the
  undefined straight through, `topRow` read `.name` off it, and the whole
  screen rendered as "This screen did not draw" for a signed-in person whose
  only mistake was being new. `body()` already had an honest empty state for
  this and never got the chance to show it.

  So the absence is stated once, here, rather than guessed at by each caller.
*/
const project = () => {
  const found = PROJECTS.find((p) => p.slug === state().project) ?? PROJECTS[0]
  return found === undefined ? null : contacts.overlay(todos.overlay(found))
}

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
  /*
    PROJECT SETTINGS IS THE EXPERIENCE'S OWN SURFACE NOW.

    Grant, 22 September: *"Project Settings is still exposing the
    old-fashioned/legacy interface. Do not continue mixing the redesigned
    project UI with legacy screens... stop dropping the user into an obviously
    legacy-looking interface; make Project Settings visually coherent with the
    new application; preserve existing settings functionality; avoid
    regressions."*

    Note what preserving the functionality and avoiding regressions RULES OUT:
    re-authoring eight hundred lines of settings controls in a second
    vocabulary. So the surface renders `project-settings.js` - the same
    renderer, the same wiring, the same writes - inside this experience's
    shell, and a scoped stylesheet gives its markup this experience's
    typography, spacing, panels, borders and controls. The information
    architecture is untouched, which he asked for in the same breath.
  */
  { id: 'settings', name: 'Project Settings', own: true },
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

/*
  THE TRAY'S MARKS ARE ONE DRAWN SET, not four characters from four fonts.
  They were the text glyphs for a pencil, a house, a tick and a triple bar:
  each a different weight and optical size, 8px tall on a phone, and the
  pencil stood for Chat. Same geometry as icons.js - 24 grid, stroked,
  currentColor, round joins - so the tray reads as one object.
*/
const trayMark = (d) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const TRAY_MARKS = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
  home: '<path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.5 9.2V20h13V9.2"/><path d="M10 20v-5.5h4V20"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.2 12.2 2.6 2.6 5-5.4"/>',
  activity: '<path d="M3 12h4l2.5-6.5 5 13L17 12h4"/>',
}
const trayItems = () => [
  { name: 'Home', to: at('/'), glyph: trayMark(TRAY_MARKS.home) },
  { name: 'My Tasks', to: at('/tasks'), glyph: trayMark(TRAY_MARKS.tasks) },
  { name: 'Activity', to: at('/activity'), glyph: trayMark(TRAY_MARKS.activity) },
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

/*
  THE PROJECT MENU PANEL. Projects first (the active one marked), then Create
  project, then the personal destinations that used to live in the tray. The
  portfolio screen, the Jump dialog and the tray are gone: this is the one
  place to move between projects.
*/
/*
  The projects, from the title of the project you are in. Pressing that title opens them, and the list ends with the way to
  this project's overview, which the title itself used to be (Grant, 20 October 2026). The burger keeps the moves inside a
  project.
*/
const switcherPanel = (here) => {
  const projects = listed()
  const row = (p) =>
    `<button type="button" role="menuitem" class="bcmenuitem" data-bc-go="${esc(at(`/p/${p.slug}`))}" aria-current="${here !== null && here.slug === p.slug ? 'page' : 'false'}"><span class="bcmenumark" aria-hidden="true">${compose.projectMark(p, 18)}</span><span class="bcmenuname">${esc(p.name)}</span></button>`
  return `<div class="bcmenupanel bcswitch" id="bc-switch" role="menu" aria-label="Projects"${menu.isSwitching() ? '' : ' hidden'}>
    <p class="bcmenuhead">Projects</p>
    ${
      projects.length === 0
        ? `<p class="bcmenunone">${source.state === 'unreachable' ? 'Your projects could not be loaded.' : 'No projects yet.'}</p>`
        : `<div class="bcmenulist">${projects.map(row).join('')}</div>`
    }
    ${
      here === null
        ? ''
        : `<hr class="bcmenusep"><button type="button" role="menuitem" class="bcmenuitem" data-bc-go="${esc(at(`/p/${here.slug}`))}"><span class="bcmenuname">Overview of ${esc(here.name)}</span></button>`
    }
  </div>`
}

const menuPanel = () => {
  const here = state().view === 'project' ? state().project : null
  const projects = listed()
  const mine = canWrite()
  /* The module's own icon and colour, from the same identity table the dashboard draws its modules from (no second list). */
  const rowMark = (id) =>
    identity.known(id) ? `<span class="bcmenuicon" style="--bc-tint:${identity.hue(id)}">${identity.svg(id, 16)}</span>` : ''
  const item = (to, label, mark = '') =>
    `<button type="button" role="${menu.isMaking() ? 'button' : 'menuitem'}" class="bcmenuitem" data-bc-go="${esc(to)}"
      aria-current="${isHere(to) ? 'page' : 'false'}">${mark}<span class="bcmenuname">${esc(label)}</span></button>`
  const firstRunShown = projects.length === 0 && source.live === true && mine && state().view === 'home'
  /* Always in the page, hidden until opened: the button's aria-controls always names something that exists. */
  return `<div class="bcmenupanel" id="bc-menu" role="${menu.isMaking() ? 'dialog' : 'menu'}" aria-label="${menu.isMaking() ? 'New project' : 'Projects and navigation'}"${menu.isOpen() ? '' : ' hidden'}>
    ${
      /* On a phone the top bar has no room for the address, so the menu, which every screen can open, says who is signed in. */
      session.signedIn() && !session.isSample() && session.knownEmail() !== ''
        ? `<p class="bcmenuwho" title="${esc(session.knownEmail())}">Signed in as <span data-bc-menuwho>${esc(session.knownEmail())}</span></p>`
        : ''
    }
    ${
      firstRunShown
        ? ''
        : mine
          ? menu.isMaking()
            ? account.newProject({ open: true })
            : `<button type="button" role="menuitem" class="bcmenuitem bcmenucreate" data-bc-menu-new>
                <span class="bcmenuplus" aria-hidden="true">+</span><span class="bcmenuname">Create project</span>
              </button>`
          : `<button type="button" role="menuitem" class="bcmenuitem bcmenucreate" data-bc-signin-first disabled
              title="Sign in to create a project"><span class="bcmenuplus" aria-hidden="true">+</span><span class="bcmenuname">Create project (sign in first)</span></button>`
    }
    ${
      mine
        ? `<button type="button" role="menuitem" class="bcmenuitem bcmenurestore" data-bc-menu-restore>
             <span class="bcmenuplus" aria-hidden="true">↑</span><span class="bcmenuname">Restore a project from an archive</span>
           </button>
           <input type="file" accept=".zip,application/zip" multiple hidden data-bc-restore-file aria-label="Archive to restore, or every part of a project set">
           <p class="bcmenunone" role="status" aria-live="polite" data-bc-restore-said>${esc(compose.restoreSaid())}</p>`
        : ''
    }
    ${
      here === null
        ? ''
        : `<p class="bcmenuhead">In this project</p>
    <div class="bcmenulist" data-bc-menu-modules>${Object.entries(compose.NAMES)
      .map(
        ([id, name]) =>
          `<button type="button" role="${menu.isMaking() ? 'button' : 'menuitem'}" class="bcmenuitem" data-bc-expand="${esc(id)}">${rowMark(id)}<span class="bcmenuname">${esc(name)}</span></button>`,
      )
      .join('')}${item(at(`/p/${here}/chat`), 'Team Chat', rowMark('chat'))}<button type="button" role="${menu.isMaking() ? 'button' : 'menuitem'}" class="bcmenuitem" data-bc-sources="1">${rowMark('sources')}<span class="bcmenuname">Sources</span></button></div>`
    }
    <hr class="bcmenusep">
    <button type="button" role="${menu.isMaking() ? 'button' : 'menuitem'}" class="bcmenuitem bcmenuglobal" data-bc-global-menu="1"
      title="Global Settings: the whole office, outside any project"><span class="bcmenuname">Global Settings</span></button>
  </div>`
}

/**
 * §6.1: a three-part sticky top row, and a persistent personal tray below the
 * content.
 *
 * The attention control on the right is the queue for blocked work and things
 * waiting on Grant - §6.1 says it must not become a permanent wide sidebar,
 * which is why it is a control with a count rather than a panel.
 */
const workTools = () => {
  const s = state()
  if (s.view !== 'project' || s.tab !== 'overview') return ''
  const p = project()
  if (p === null || p === undefined) return ''
  return compose.chosen() === 'c' ? compose.workTools(p) : ''
}

/*
  Who is signed in, in the corner. A signed-in person sees their address; the Sample Office says so, because it has no
  address of its own. The address is asked for once per page load and written into the label in place, so the header is
  not redrawn to show it.
*/
let whoAsked = false
const askWho = () => {
  if (whoAsked || !session.signedIn() || session.isSample()) return
  whoAsked = true
  void session.whoami().then((email) => {
    const el = document.querySelector('[data-bc-who]')
    if (el !== null && email !== '') {
      el.textContent = email
      el.title = email
    }
    const menuEl = document.querySelector('[data-bc-menuwho]')
    if (menuEl !== null && email !== '') menuEl.textContent = email
  })
}
const whoLabel = () => (session.isSample() ? 'Sample office · read only' : session.knownEmail())

const topRow = () => {
  askWho()
  const who = session.signedIn() ? whoLabel() : ''
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
  /*
    ONE ROW. On the freeform workspace the project's counters, workspace tools, Chat with Team, the microphone and the
    project menu are drawn here, between the project's name and the office controls, instead of as a second band
    under the bar (Grant, 10 October: the top of the screen took too much height and was two different shades).
  */
  const work = workTools()
  return `<header class="bctop${work === '' ? '' : ' bctop--work'}">
    <div class="bcleft">
      <button type="button" class="bcbtn bcicon bcburger" data-bc-menu
        aria-haspopup="menu" aria-expanded="${menu.isOpen() ? 'true' : 'false'}" aria-controls="bc-menu"
        aria-label="Projects and navigation" title="Projects and navigation">
        <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
          <path class="bcb1" d="M4 7h16"></path><path class="bcb2" d="M4 12h16"></path><path class="bcb3" d="M4 17h16"></path>
        </svg>
      </button>
      ${menuPanel()}
    </div>
    <div class="bchere${here === null ? ' bchere--none' : ''}" role="status"
      aria-label="${esc(here === null ? 'No project selected' : `You are in ${here.name}`)}">
      ${here === null
        ? '<span class="bcjumpname">No project open</span>'
        : `<button type="button" class="bchere-link" data-bc-switch aria-haspopup="menu" aria-controls="bc-switch"
            aria-expanded="${menu.isSwitching() ? 'true' : 'false'}" title="Switch project, or open ${esc(here.name)}'s overview">
            <span class="bcjumpmark" aria-hidden="true">${compose.projectMark(here, 18)}</span>
            <span class="bcjumpname">${esc(here.name)}</span>
            <span class="bcswitchchev" aria-hidden="true">▾</span>
          </button>${switcherPanel(here)}`}
    </div>
    ${work}
    <div class="bcright">
      <!-- The build's version, on every screen and in the Sample: the one place a person can always see what they are running. -->
      ${buildVersionMark()}
      <!--
        Light or dark, on every screen, always at the top right (Grant, 14 October 2026). Both glyphs are drawn and the CSS
        shows the one that switches to the OTHER scheme, so the button needs no state from the render. It writes the same
        stored choice as the Appearance tab.
      -->
      <button type="button" class="bcschemebtn" data-bc-schemetoggle aria-label="Switch between light and dark" title="Switch between light and dark">
        <svg class="bcschemeicon bcschemeicon--moon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"></path></svg>
        <svg class="bcschemeicon bcschemeicon--sun" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
      </button>
      ${source.state === 'prototype' && !connecting() ? '<a class="bcsignlink" href="?welcome">Sign in</a>' : ''}
      ${session.signedIn() ? `<span class="bcwho" data-bc-who title="${esc(who)}">${esc(who)}</span>` : ''}
      <!--
        THE OFFICE'S OWN SETTINGS, OUTSIDE ANY PROJECT.

        §14: "PROJECT SETTINGS affect only the current project. GLOBAL /
        APPLICATION SETTINGS affect the application/user generally. Global
        settings should have their own three-dot control in the TOP-RIGHT,
        OUTSIDE the project window/container. The visual hierarchy must make
        scope obvious."

        They used to be the last entry in the PROJECT's menu, which is the
        confusion Grant is naming: a menu that offers both scopes is a menu
        that makes you guess which one you are editing. Here it is in the
        shell's own row, which is drawn on every screen and belongs to no
        project, so where the control lives is the answer to what it changes.

        Plain words in this comment: it sits inside a template literal.
      -->
      ${
        canWrite()
          ? `<button type="button" class="bcbtn bcsignout" data-bc-signout="1"
        title="${account.leaveWords().title}"
        aria-label="${account.leaveWords().label}"><svg class="bcsoicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/>
        </svg><span class="bcsotext">${account.leaveWords().text}</span></button>`
          : ''
      }
    </div>
  </header>`
}

const tray = () =>
  `<nav class="bctray" aria-label="Your things">
    ${buildVersionMark('tray')}
    <!--
      CHAT stays in the personal tray, renamed.

      The specification removes Ask the Team from the TOP of the interface,
      where it duplicated the project head's blue Chat button. The tray is the
      bottom, and it is the only way into the sidebar from the portfolio, where
      there is no project head at all - so removing it here would take the
      typed team chat away from a phone on the projects screen rather than
      removing a duplicate.
    -->
    <button type="button"${state().view === 'project' ? ' class="bcnarrow-only"' : ''} data-bc-dock>
      <span aria-hidden="true">${trayMark(TRAY_MARKS.chat)}</span><span>Chat</span>
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
          /* A name and a date, not a database key and a stale sentence: this
             printed the slug ("claire") and t.due, which disagreed with the
             same task's date on the project home. */
          [whoName(t.who), bcMini.dueWords(t), t.note].filter((x) => x !== undefined && x !== null && x !== '').join(' · '),
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
        .map((w) => row(w.what, [whoName(w.who), w.when].filter(Boolean).join(' · '), status('Waiting for you', 'waiting')))
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
        [whoName(made.who), made.delivered].filter(Boolean).join(' · '),
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

/**
 * WORK IN FLIGHT, which is the other half of the same list (§20.2).
 *
 * `app.studio_requests` already folds every non-terminal state -- queued,
 * running, waiting on something outside, waiting on a person, retrying,
 * paused -- into one word, `working`. So the data for Active jobs has been in
 * the payload all along; what the team surface said was that this experience
 * had not built a surface for them, which was true and is the last of §20's
 * four escapes to close.
 */
const runningOn = (p) => (p.requests ?? []).filter((r) => r.state === 'working')


/** §8.3 Documents: latest document, title and what it is. */
const documentsPreview = (p) => {
  /*
    The minimised tile shares the expanded view's filter (21 October 2026): the same chips, the same state per project, so
    the two views always agree. Each row says where its document came from.
  */
  const all = p.documents ?? []
  if (all.length === 0) return nothing('Nothing filed on this project yet.')
  const f = docsrc.filterOf(p.slug)
  const docs = f.source !== undefined && f.source !== 'all' ? all.filter((d) => docsrc.sourceOf(d) === f.source) : all
  const by = new Map()
  for (const d of all) by.set(docsrc.sourceOf(d), (by.get(docsrc.sourceOf(d)) ?? 0) + 1)
  const chip = (id, label, n) =>
    `<button type="button" class="bcsrcchip${f.source === id ? ' is-on' : ''}" data-bc-docsrc="${esc(id)}"
      aria-pressed="${f.source === id ? 'true' : 'false'}">${esc(label)}${n === undefined ? '' : ` <span class="bcsrcn">${String(n)}</span>`}</button>`
  const chips = `<span class="bcsrcchips bcsrcchips--tile" role="group" aria-label="Where they came from">${chip('all', 'All', all.length)}${docsrc.SOURCES.filter((s) => by.has(s.id))
    .map((s) => chip(s.id, s.short, by.get(s.id)))
    .join('')}</span>`
  const rows = docs
    .slice(0, 5)
    .map((d) => row(d.title, [docsrc.nameOfSource(docsrc.sourceOf(d)), d.kind, d.size].filter(Boolean).join(' · ')))
    .join('')
  if (docs.length === 0) return `${chips}${nothing('No documents from this source in this project.')}`
  return (
    chips +
    rows +
    (docs.length > 5 ? `<div class="bcmore">${esc(`${docs.length - 5} more`)}</div>` : '')
  )
}

/** §8.3 Activity: day-grouped, human-readable, technical noise suppressed. */
const activityPreview = (p) => {
  const acts = p.activity ?? []
  if (acts.length === 0) return nothing('Nothing has happened here yet.')
  return acts
    .slice(0, 6)
    .map((a) => row(`${whoName(a.who) || 'The team'} ${a.verb ?? 'changed'} ${a.what ?? ''}`.trim(), a.when ?? ''))
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
  const ss = (p.sources ?? []).filter((s) => !hiddenFromSources(s))
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
        The rest of this project's tools.
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
              : /*
                  AND THERE IS NO OTHER BRANCH ANY MORE (§20).

                  This was a hand-off: a tool without its own surface here got
                  a link into the current Team HQ. Every tool in the list is
                  owned now, so it had not fired in weeks -- but it is exactly
                  the shape §20 forbids, waiting for the next tool somebody
                  adds without a surface. A tool with nowhere to go is not
                  offered, which makes building the surface the only way to put
                  one on this list.
                */
                '',
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
        <!--
          INSIDE THE EXPERIENCE. This was the last hand-off to the legacy
          settings screen, left behind when the surface came in-house - which
          is the shape Grant asked to look for: "If one legacy screen remains,
          inspect navigation routes that can unexpectedly expose other legacy
          UI." Two doors onto one screen, and only one of them had been moved.
        -->
        ${button('Project settings', { 'data-bc-go': at(`/p/${p.slug}/settings`) })}
      </span>
    </div>
    <h1>${esc(p.name)}</h1>
    ${p.purpose ? `<p class="bcdesc">${esc(p.purpose)}</p>` : ''}
    ${
      latest
        ? `<p class="bcpmeta bclatest">Latest: ${esc(
            `${whoName(latest.who) || 'the team'} ${latest.verb ?? 'changed'} ${latest.what ?? ''}`.trim(),
          )} · ${esc(latest.when ?? '')}</p>`
        : ''
    }
  </div>`
}

/* ======================================================================== *
 * Portfolio (home)
 * ======================================================================== */

/*
  THE PROJECTS A PERSON SEES. Every office has one catch-all project called Unnamed, where conversations that belong to
  no project are filed. Empty, it is plumbing, and showing it made a brand-new office look as if it already had a
  project and hid the first-run screen. Once something is filed there it is real work, so it is listed.
*/
const filedUnder = (p) =>
  (p.tasks ?? []).length +
    (p.documents ?? []).length +
    (p.activity ?? []).length +
    (p.contacts ?? []).length +
    (p.waiting ?? []).length >
  0
const listed = () => PROJECTS.filter((p) => p.slug !== 'unnamed' || filedUnder(p))
/*
  The build's version, from config.js (generated from package.json). It is drawn in the top-right corner of the home board only,
  which is the only screen with no project open. Absolutely placed, so it takes no room from the header's title.
*/
const buildVersionMark = (where = 'bar') => {
  const version = typeof window.HQ_VERSION === 'string' ? window.HQ_VERSION : ''
  return version === ''
    ? ''
    : `<span class="bcver bcver--${where}" title="Team HQ version ${esc(version)}">v${esc(version)}</span>`
}

/*
  THE NO-PROJECT SCREEN (completion pass, D3). With no project open a person sees what they can do next: their projects
  as cards to open, or, with none yet, the one step that starts their office. It is not a blank canvas with a sentence on it.
*/
const emptyProjects = () => {
  const mine = listed()
  if (mine.length === 0) {
    return `<h2 class="bcnoproj-title" id="bcnoproj-title">No projects yet</h2>
    <p class="bcnoproj-lede">A project holds its own documents, tasks, calendar and team. Start one, and the team can begin work on it.</p>
    <div class="bcnoproj-actions">
      <button type="button" class="bcbtn bcbtn--primary" data-bc-menu-open>Create a project</button>
    </div>`
  }
  return `<h2 class="bcnoproj-title" id="bcnoproj-title">Choose a project</h2>
    <p class="bcnoproj-lede">Each project has its own documents, tasks, calendar and team. Open one to carry on, or start a new one.</p>
    <ul class="bcnoproj-grid" aria-label="Your projects">${mine
      .map(
        (p) => `<li><button type="button" class="bcnoproj-card" data-bc-go="${esc(at(`/p/${p.slug}`))}">
        <span class="bcnoproj-mark" aria-hidden="true">${compose.projectMark(p, 28)}</span>
        <span class="bcnoproj-name">${esc(p.name)}</span>
        <span class="bcnoproj-open">Open <span aria-hidden="true">→</span></span>
      </button></li>`,
      )
      .join('')}</ul>
    <div class="bcnoproj-actions">
      <button type="button" class="bcbtn" data-bc-menu-open>Open the project menu</button>
    </div>`
}

const portfolio = () => {
  // A signed-in person whose office has nothing in it yet is shown the one next step, not an empty list.
  if (listed().length === 0 && source.live === true && canWrite()) return account.firstRun()
  // A read that failed is not an office with nothing in it: say so, and offer to try again (#426).
  if (listed().length === 0 && source.state === 'unreachable') {
    return errorState('Your projects could not be loaded just now.', button('Try again', { 'data-bc-retry-office': '1' }))
  }
  /*
    NO PROJECT SELECTED: an empty canvas, not a screen of its own. The page is
    the workspace, so with nothing chosen it shows the dotted canvas and one
    sentence inviting the person to pick or make a project.
  */
  return `<h1 class="bcvh">Team HQ</h1>
  <section class="bcnoproj" aria-labelledby="bcnoproj-title">
    ${emptyProjects()}
  </section>`
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

/*
  WHO A TASK IS FOR, as a choice of the team rather than a box to type in.
  Shared by the record and the add form so the two cannot drift. The value
  is the office's own name for the person (staffSlug), because hq_task_add
  and hq_task_update resolve p_assignee against public.staff.slug and refuse
  anything else - a free-text box only worked if somebody typed a role slug.
  Anybody the row names who is not on the team stays selectable, so opening
  a record can never silently reassign it.
*/
const assigneePicker = (id, current) => {
  const crew = ctx?.crew ?? []
  const now = String(current ?? '')
  const known = crew.some((c) => c.slug === now || c.staffSlug === now)
  const opts = crew
    .map((c) => {
      const v = c.staffSlug ?? c.slug
      const on = now !== '' && (c.slug === now || c.staffSlug === now)
      return `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(c.role ? `${c.name} · ${c.role}` : c.name)}</option>`
    })
    .join('')
  return `<div class="bcfield">
    <label class="bclabel" for="${esc(id)}">Assigned to</label>
    <select class="bcinput bcselect" id="${esc(id)}" name="who">
      <option value=""${now === '' ? ' selected' : ''}>Nobody yet</option>
      ${opts}
      ${known || now === '' ? '' : `<option value="${esc(now)}" selected>${esc(bcMini.pretty(now))}</option>`}
    </select>
  </div>`
}

/** One list's add-a-task form. Per list, because §10.2 expands IN PLACE. */
const taskAddForm = (listId) => {
  const k = listId === '' ? 'loose' : listId
  return `<form class="bcaddform" data-bc-taskform="${esc(k)}" hidden>
    ${input({ id: `bc-task-title-${k}`, label: 'What needs doing', name: 'title', autocomplete: 'off' })}
    ${input({ id: `bc-task-due-${k}`, label: 'Due date', name: 'due', type: 'date' })}
    ${assigneePicker(`bc-task-who-${k}`, '')}
    <div class="bcrow">
      ${button('Add this task', { kind: 'primary', 'data-bc-tasksave': esc(k) })}
      ${button('Cancel', { 'data-bc-taskcancel': esc(k) })}
    </div>
  </form>`
}

/** Whether a to-do is finished with, however the office happens to say so. */
const done_ = (t) =>
  (t.state_raw ?? t.state) === 'done' || (t.state_raw ?? '') === 'cancelled'

const taskList = (p, g, whole = false) => {
  const all = p.tasks ?? []
  const open = g.items.filter((t) => !done_(t))
  const done = g.items.filter((t) => done_(t))
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
      <!--
        COMPLETED WORK STAYS ON THE PAGE.

        Grant, 23 September: "Clicking/completing a to-do must not make it
        unexpectedly disappear. Completed items should remain visible and
        clearly display a completed/done state."

        It used to go into a collapsed drawer, so ticking something made it
        vanish from where it was and reappear only if you went looking for a
        summary line called "1 completed task". That is the defect: the tick
        LOOKED like it had deleted the row.

        Done work now sits where it always was, after the open work, under a
        quiet heading and wearing the done state - struck through, dimmed, its
        box ticked. The heading is drawn only when there IS some, so an
        untouched list carries no furniture.
      -->
      ${
        done.length === 0
          ? ''
          : `<h3 class="bcdonehead">${esc(
              /*
                THE NOUN FIRST, AND A REAL HEADING.

                "2 done" is the shape of a FILTER - a count beside a noun, like
                "3 late" or "12 open tasks" - and `verify:basecamp-affordance`
                said so: something that looks pressable and is not. It is a
                section heading over rows that are right underneath it, so it
                is written as one, and it is an element a screen reader can
                navigate to rather than a paragraph in bold.
              */
              done.length === 1 ? 'Done (1)' : `Done (${String(done.length)})`,
            )}</h3>
            <div class="bcdonelist">
              ${done.map((t) => taskRow(t, all.indexOf(t), g.name)).join('')}
            </div>`
      }
    </div>
  </section>`
}

/*
  THE FILTER THE COUNTS OPEN, applied HERE rather than in each renderer.

  Grant: *"Verify the count corresponds to the records displayed."* The only
  way to make that true rather than checked is for one predicate to produce
  both, so the surface narrows the project by `bcMini.FILTERS` - the same
  table `stateLine` counts from - and then renders the narrowed project as it
  always did. A filtered project is still a project: the lists, the add
  controls and the completed drawers all still work, because nothing below
  knows it happened.
*/
/** What the surface says it is showing, and the way back to everything. */
const filterBar = (p) => {
  const kind = state().bcFilter ?? state().bcMine
  const f = kind === null || kind === undefined ? undefined : bcMini.FILTERS[kind]
  if (f === undefined) return ''
  const n = bcMini.filtered(p, kind).length
  return `<div class="bcfilterbar" data-bc-filterbar="${esc(String(kind))}">
    <!-- A sentence, not a key and a value: "Showing late · 1" reads; "Late:1" did not. -->
    <span class="bcstatus bcstatus--waiting">${esc(`Showing ${f.name.charAt(0).toLowerCase()}${f.name.slice(1)} · ${String(n)}`)}</span>
    ${button('Show everything', { 'data-bc-filter-off': '1' })}
  </div>`
}

const tasksSurface = (whole) => {
  const p = bcMini.narrowFor(whole)
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
    <!--
      LATE, STUCK AND OPEN, BESIDE THE TO-DOS THEY COUNT.

      They used to sit in the project header, directly above a To-dos panel
      listing the same work - the redundancy Grant asked to have removed. They
      are filters as well as counts, so removing them would have removed the
      only way to narrow this list; they are here instead, where the to-dos
      are, which is also where the narrowing they perform makes sense.
    -->
    ${bcMini.taskCounts(whole)}
    ${filterBar(whole)}
    <p class="bcpmeta bcprose bcgap-l">
      Everything this project has committed to, by list. Your own tasks live in My Tasks.
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
    : /* Either slug: the office names people by role slug, the design by short slug. */
      ((ctx?.crew ?? []).find((c) => c.slug === slug || c.staffSlug === slug)?.name ?? bcMini.pretty(slug))

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
/*
  CHIPS FOR WHAT THE RECORD ACTUALLY HOLDS: priority (only when it is not the ordinary 100), stage, labels. Nothing is drawn
  for a field the task does not carry, so a card never shows an invented value.
*/
const taskChips = (t, isDone) => {
  const pr = todos.task(t).priority
  const stage = todos.stageOf(t)
  const chips = []
  if (pr === 'urgent' || pr === 'high') chips.push(`<span class="bctchip bctchip--${pr}">${pr === 'urgent' ? 'Urgent' : 'High priority'}</span>`)
  if (!isDone && stage === 'doing') chips.push('<span class="bctchip bctchip--doing">In progress</span>')
  if (isDone) chips.push('<span class="bctchip bctchip--done">Done</span>')
  for (const l of (Array.isArray(t.labels) ? t.labels : []).slice(0, 4)) chips.push(`<span class="bctchip">${esc(String(l))}</span>`)
  return chips.length === 0 ? '' : `<span class="bctchips">${chips.join('')}</span>`
}

const taskRow = (t, i = 0, listName = '') => {
  /*
    THE SAME PREDICATE THE LIST SPLITS ON.

    This said `t.state === 'done'` while the split above says
    `(t.state_raw ?? t.state) === 'done' || state_raw === 'cancelled'` - two
    ways of asking one question, and a row that satisfied one and not the other
    would sit under the done heading without wearing the done state. One
    answer, used by both.
  */
  const isDone = done_(t)
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
      ${t.local === true ? '<span class="bclocalmark">Kept in this browser</span>' : ''}
      <span class="bcitemmeta">${esc(
        /*
          The guard stays for the near-miss case: a note that merely BEGINS
          with the list's name ("Client Vision & Journey Mapping" under
          "Client Vision & Journey") is the same repetition with four extra
          characters, and an exact comparison let all of those through.
        */
        [whoName(t.who), repeatsList(t.note, listName) ? '' : t.note]
          .filter((x) => x !== undefined && x !== null && x !== '')
          .join(' · '),
      )}</span>
      ${t.blocked ? `<span class="bcitemmeta">${status('Blocked', 'blocked')} ${esc(t.blocked)}</span>` : ''}
      ${taskChips(t, isDone)}
    </div>
    <!--
      THE DATE, in the row's last column, which was an empty span. It read
      t.due, which rows rarely carry, so no row on this page showed when
      anything was due - the overdue one looked exactly like the undated
      ones. The miniature's reader, so both say the same words.
    -->
    ${(() => {
      const due = isDone ? '' : bcMini.dueWords(t)
      return due === ''
        ? '<span></span>'
        : `<span class="bcitemdue${bcMini.isLate(t) ? ' bcitemdue--late' : ''}">${esc(due)}</span>`
    })()}
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
  const key = taskKey(t)
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
    <h2 class="bcsubhead">Details</h2>
    <form class="bcaddform bcgap-l" data-bc-taskedit="${esc(key)}">
      <!--
        A PICKER, NOT A SLUG BOX. It was free text pre-filled with the
        database key ("emma"), so the field showed a developer's word and
        accepted any typo as an assignee. The options are the team; each
        carries the office's own name for the person, which is what a write
        has to address. Anybody the row names who is not on the team stays
        selectable, so opening a record can never silently reassign it.
      -->
      ${input({ id: 'bc-edit-title', label: 'What needs doing', name: 'title', autocomplete: 'off', value: t.title })}
      ${assigneePicker('bc-edit-who', t.who)}
      <!--
        The date the row actually carries. This read t.due, which is prose
        ("Due 16 September") or absent, so a task due today opened with an
        empty date field - and Save would then have CLEARED the date.
      -->
      ${input({ id: 'bc-edit-due', label: 'Due date', name: 'due', type: 'date', value: isoDay(String(t.due_on ?? t.due ?? '').slice(0, 10)) })}
      <!--
        NOT DISABLED FOR A PROTOTYPE ROW - the third and last instance of the
        same defect, found by grepping for the shape rather than by waiting
        for Grant to press one. The controls carry the port's key, so a row
        with a record writes to the office and a row without is remembered
        here, exactly as the tick and the card table are.
      -->
      <div class="bcrow">
        ${button('Save', { kind: 'primary', 'data-bc-tasksave-edit': key })}
        ${button(done ? 'Reopen' : 'Mark done', {
          'data-bc-taskdone': key,
          'data-bc-want': done ? 'todo' : 'done',
        })}
        ${
          t.local === true || t.id === undefined || t.id === null || t.id === ''
            ? ''
            : button('Remove task', { kind: 'danger', 'data-bc-taskremove': key })
        }
      </div>
      ${
        t.local === true || t.id === undefined || t.id === null || t.id === ''
          ? `<p class="bcpmeta bcprose">These are example projects, which have no
             records behind them, so changes here are kept in this browser. Sign
             in and the same controls write to the real project.</p>`
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
      Comments and linked documents for a task aren't available yet.
      To talk it through, use Chat with Team.
    </p>`
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
/* ======================================================================== *
 * THE TEAM SCREEN IS WHERE THE TEAM IS CONFIGURED  (§16)
 * ======================================================================== *
 *
 * §16: "Grant's current requirement is that the Team screen IS the place where
 * the AI team assigned to the project is configured... This must NOT merely be
 * cosmetic profile editing. It needs to affect the underlying agentic system...
 * Trace the existing canonical agent/expertise/routing architecture before
 * implementing. Do NOT build a parallel frontend-only agent model."
 *
 * NOTHING HERE IS NEW. Every control writes through a function the office
 * already had:
 *
 *   who is on the project   `set_project_staff`, which writes `project_staff`
 *   their words             `hq_staff_update`, whose `p_skills` writes
 *                           `staff.expertise` -- the column `who_knows_about`
 *                           matches on, so this is the routing requirement and
 *                           not a profile field
 *   bringing somebody in    `hq_staff_hire`
 *   standing somebody down  `hq_staff_retire`
 *
 * AND THE ROSTER IS READ FROM THE TABLE THAT DECIDES IT. `crewFor` derives one
 * from whoever appears in the project's tasks, activity and waiting items --
 * a record of activity wearing the name of a team. A specialist assigned and
 * not yet used was invisible on the very screen where you assign people.
 *
 * §17 makes this screen an intentional exception to the identity restriction:
 * names belong here. That is not licence to put them back anywhere else.
 */

/** Three answers, not two: 'asking', 'failed', or the roster itself. */
const assignment = (p) => ctx.assignedFor?.(p.slug) ?? 'asking'

const personRow = (p, c, on) => {
  const words = Array.isArray(c.skills) ? c.skills : []
  return `<div class="bcitem" data-bc-person="${esc(c.slug)}">
    <span></span>
    <div class="bcitembody">
      <span class="bcitemtitle">${esc(c.name ?? c.slug)}</span>
      <span class="bcitemmeta">${esc(c.title ?? '')}</span>
      ${
        words.length === 0
          ? `<span class="bcitemmeta">No subject words yet, so nothing routes here by subject</span>`
          : /*
              THE FIRST EIGHT, AND A COUNT. Grace owns twenty subject words and
              Daniel fifteen; drawn in full they are a wall of chips that makes
              the roster unreadable and buries the controls beside it. The
              editor shows every one, which is where you go to change them.
            */
            `<span class="bcitemmeta bcwords">${words
              .slice(0, 8)
              .map((w) => `<span class="bcword">${esc(w)}</span>`)
              .join('')}${
              words.length > 8
                ? `<span class="bcword bcword--more">${esc(`+${String(words.length - 8)} more`)}</span>`
                : ''
            }</span>`
      }
    </div>
    <span class="bcactions">
      ${button('Edit', { 'data-bc-person-edit': esc(c.slug) })}
      ${
        on
          ? button('Take off', { 'data-bc-person-off': esc(c.slug) })
          : button('Put on', { kind: 'primary', 'data-bc-person-on': esc(c.slug) })
      }
    </span>
  </div>`
}

/*
  THE EDITOR. One form, and every field goes to `hq_staff_update` in one call,
  because a person who corrects a title and adds a subject word should not have
  to press twice.

  Subject words are a comma-separated list on purpose: that is the shape the
  RPC takes, and inventing a tag widget over it would put a parser between
  Grant and the office for no gain -- #130's defect with a nicer surface.
*/
const personEditor = (c) => `<form class="bcaddform bcgap-l" data-bc-personform="${esc(c.slug)}">
  <div class="bcformrow">
    ${input({ id: 'bc-p-name', label: 'Name', name: 'name', value: c.name ?? '', maxlength: '40' })}
    ${input({ id: 'bc-p-title', label: 'Role', name: 'title', value: c.title ?? '', maxlength: '80' })}
  </div>
  ${input({ id: 'bc-p-pronouns', label: 'Pronouns', name: 'pronouns', value: c.pronouns ?? '', maxlength: '24' })}
  <label class="bclabel" for="bc-p-remit">What they are responsible for</label>
  <textarea class="bcinput" id="bc-p-remit" name="remit" rows="3">${esc(c.responsibilities ?? '')}</textarea>
  <label class="bclabel" for="bc-p-skills">Subject words</label>
  <textarea class="bcinput" id="bc-p-skills" name="skills" rows="2"
    >${esc((Array.isArray(c.skills) ? c.skills : []).join(', '))}</textarea>
  <p class="bcpmeta bcprose">
    Comma separated, and these are not decoration: the office matches what you
    ask against these words to decide who the work reaches. Thirty is the most
    one person can usefully own.
  </p>
  <p class="bcpmeta bcprose">
    Which model answers is chosen by the office for each kind of work, not set for a person, and how far they may act on
    their own is set in Autonomy and approvals. Neither is on this form, because neither is stored against a person.
  </p>
  <label class="bclabel" for="bc-p-style">How they write</label>
  <textarea class="bcinput" id="bc-p-style" name="style" rows="2">${esc(c.communication_style ?? '')}</textarea>
  <div class="bcformacts">
    ${button('Save', { kind: 'primary', 'data-bc-person-save': esc(c.slug) })}
    ${button('Cancel', { 'data-bc-person-cancel': '1' })}
    ${c.permanent === true ? '' : button('Stand them down', { 'data-bc-person-retire': esc(c.slug) })}
  </div>
  <span class="bcsaidhere" data-bc-person-said role="status" aria-live="polite"></span>
</form>`

const hireForm = () => `<form class="bcaddform bcgap-l" data-bc-hireform="1">
  <div class="bcformrow">
    ${input({ id: 'bc-h-name', label: 'First name', name: 'name', maxlength: '40', placeholder: 'Priya' })}
    ${input({ id: 'bc-h-title', label: 'Role', name: 'title', maxlength: '80', placeholder: 'Partnerships Director' })}
  </div>
  <label class="bclabel" for="bc-h-why">What they are for</label>
  <textarea class="bcinput" id="bc-h-why" name="why" rows="3"
    placeholder="Why the team needs somebody this project does not already have."></textarea>
  <!--
    A HIRE CARRIES AN END, and that is the office's design rather than this
    form's caution: the hire function requires one and so does the gateway, and
    a scheduled sweep is what eventually acts on it. Somebody brought in
    for a piece of work should stop being on the roster when the work is over,
    or the roster becomes a list of everybody who was ever needed.

    Ninety days is offered, not imposed -- it is a date field and Grant can put
    any date in it.
  -->
  ${input({
    id: 'bc-h-until',
    label: 'Until',
    name: 'until',
    type: 'date',
    value: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  })}
  <p class="bcpmeta bcprose">
    Somebody brought in this way is temporary. On that date they come off the
    roster unless you say otherwise.
  </p>
  <div class="bcformacts">
    ${button('Bring them in', { kind: 'primary', 'data-bc-hire-save': '1' })}
    ${button('Cancel', { 'data-bc-person-cancel': '1' })}
  </div>
  <span class="bcsaidhere" data-bc-person-said role="status" aria-live="polite"></span>
</form>`

const teamSurface = (p) => {
  const waiting = p.waiting ?? []
  const held = assignment(p)
  const ready = held !== 'asking' && held !== 'failed' && held !== null
  const people = ready ? held.people : []
  const on = ready ? held.on : []
  const onProject = people.filter((c) => on.includes(c.slug) && c.active !== false)
  const offProject = people.filter((c) => !on.includes(c.slug) && c.active !== false)
  const editing = state().bcPerson
  const person = editing === null || editing === undefined
    ? undefined
    : people.find((c) => c.slug === String(editing))
  return `${crumbFor(p, 'team')}
    <div class="bcrecordhead">
      <h1>Agentic Team</h1>
      <span class="bcactions">${button('Bring someone in', { 'data-bc-hire': '1' })}</span>
    </div>
    ${
      state().bcHire === true
        ? `<h2 class="bcsubhead">Somebody new</h2>${hireForm()}`
        : person !== undefined
          ? `<h2 class="bcsubhead">${esc(person.name ?? person.slug)}</h2>${personEditor(person)}`
          : ''
    }
    <h2 class="bcsubhead">Who is on this</h2>
    ${
      held === 'failed'
        ? errorState('The office could not say who is on this project.')
        : !ready && (typeof p.id !== 'string' || p.id === '')
          ? /*
              AN EXAMPLE PROJECT HAS NOBODY TO ASK. The office is addressed by
              the project's uuid and the studio's examples have none, so the
              question was never sent and "Asking the office..." stayed on
              screen for ever - a loading state that could not finish. The
              example's own team is drawn instead, read-only, and says so.
            */
            `<div class="bclist">${(ctx?.crewFor?.(p.slug) ?? [])
              .map(
                (c) => `<div class="bcitem">
                  ${bcMini.face(c, 'md')}
                  <div class="bcitembody">
                    <span class="bcitemtitle">${esc(c.name ?? c.slug)}</span>
                    <span class="bcitemmeta">${esc(c.role ?? '')}</span>
                  </div>
                  <span></span>
                </div>`,
              )
              .join('')}</div>
             <p class="bcpmeta bcprose">This is the example project's team. Sign in to see and change who works on your projects.</p>`
        : !ready
          ? `<p class="bcpmeta bcprose" role="status">Asking the office who is on this project…</p>`
          : onProject.length === 0
            ? empty({
                title: 'Nobody is on this project yet',
                body: 'Put a specialist on it and what you ask will start reaching them by subject.',
              })
            : `<div class="bclist">${onProject.map((c) => personRow(p, c, true)).join('')}</div>`
    }
    ${
      !ready || offProject.length === 0
        ? ''
        : `<h2 class="bcsubhead">Everybody else in the office</h2>
           <div class="bclist">${offProject.map((c) => personRow(p, c, false)).join('')}</div>`
    }
    <h2 class="bcsubhead">Waiting for you</h2>
    ${
      waiting.length === 0
        ? `<p class="bcpmeta bcprose">Nothing is waiting on a decision from you.</p>`
        : `<div class="bclist">${waiting
            .map(
              /*
                A ROW, NOT A NOTICE. §18's journey begins with opening the
                item, so the row is the control that opens it -- it was a div
                with a pill on it, which is the whole complaint.
              */
              (w) => `<button type="button" class="bcitem bcitem--press" data-bc-waitopen="${esc(String(w.id))}">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(w.what)}</span>
                  <span class="bcitemmeta">${esc([bcMini.named(w.who), w.when, w.why].filter(Boolean).join(' · '))}</span>
                </div>
                <span>${w.overdue === true ? status('Overdue', 'blocked') : status('Waiting for you', 'waiting')}</span>
              </button>`,
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
    ${
      runningOn(p).length === 0
        ? `<p class="bcpmeta bcprose">Nothing is running on this project right now.</p>`
        : `<div class="bclist">${runningOn(p)
            .map(
              (r) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(r.ask ?? 'Work')}</span>
                  <span class="bcitemmeta">${esc(
                    [
                      bcMini.named(r.who) || r.who,
                      typeof r.askedAt === 'string' ? `started ${when.words(r.askedAt)}` : r.asked,
                      /*
                        WHY IT IS NOT MOVING, when that is the answer. A job
                        waiting on a person reads as a job that has stalled
                        unless the reason is on the row -- and the reason is
                        the blocker's own requested action, which is the same
                        sentence §18's record is headed by.
                      */
                      typeof r.blocked === 'string' && r.blocked !== ''
                        ? `waiting: ${r.blocked}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  )}</span>
                </div>
                <span class="bcactions">
                  ${
                    /*
                      A PILL THAT SAYS RUNNING ABOUT WORK THAT IS WAITING IS A
                      STATUS LIGHT THAT LIES.

                      `studio_requests` folds six states into `working`, which
                      is right for the filter and wrong for the label: a job
                      waiting on a person or on something outside is not
                      running, and the row already carries the reason. Stop is
                      still offered, because a job waiting on something that
                      will never come is exactly one somebody wants to stop.
                    */
                    stopping.wasAsked(r.id)
                      ? status('Asked to stop', 'blocked')
                      : `${
                          typeof r.blocked === 'string' && r.blocked !== ''
                            ? status('Waiting', 'waiting')
                            : status('Running', 'running')
                        }
                         ${button('Stop', { 'data-bc-stopjob': esc(String(r.id)) })}`
                  }
                </span>
              </div>`,
            )
            .join('')}</div>`
    }
    <!--
      NO WAY OUT OF THE NEW INTERFACE (§20).

      This block used to be four links into the current Team HQ, with a
      paragraph admitting it: "This experience has not built its own surface
      for them yet, so it sends you to the real one rather than showing a
      copy." Grant read that as unacceptable, and he is right -- a product that
      hands you to its predecessor four times on one screen is not a product.

      Two of the four were never missing. Team chat is the Chat tool and Team
      board is the Card Table, both of which this experience has had all along;
      the links were simply pointing at the old addresses. Outputs is the block
      directly above this one, and opening one now works (§19).

      Active jobs is the one that is genuinely not built here yet, and it says
      so in its own words rather than being dressed as a link somewhere.
    -->
    <div class="bcinline-list">
      <a href="${esc(at(`/p/${p.slug}/chat`))}" data-bc-go="${esc(at(`/p/${p.slug}/chat`))}">Team chat</a>
      <a href="${esc(at(`/p/${p.slug}/board`))}" data-bc-go="${esc(at(`/p/${p.slug}/board`))}">Team board</a>
    </div>
    <p class="bcpmeta bcprose bcgap">
      Everything the team has made is above, and opens here.
    </p>`
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
/*
  WHAT WAS ASKED, IN WORDS A PERSON USES (closure, 4 October).

  The Team page printed "Asked: office.instruction" and "Asked: office.synthesise" under every result: the name of the job that
  made it, which is the office's plumbing and means nothing to the person it is shown to. A kind the page knows is said in words;
  a dotted kind it does not know is left out (nothing is better than the machine's name); and a real sentence is shown as written.
*/
const ASKED_IN_WORDS = {
  'office.instruction': 'your message',
  'office.synthesise': 'pulling the answers together',
  'office.provision_channels': 'setting up a channel',
  'office.pursue': 'working through the steps',
  'office.extract_tasks': 'reading the project for work to do',
}
const askedWords = (ask) => {
  const said = String(ask ?? '').trim()
  if (said === '') return ''
  if (Object.hasOwn(ASKED_IN_WORDS, said)) return ASKED_IN_WORDS[said]
  return /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/.test(said) ? '' : said
}

const outputRow = (r) => {
  const done = r.output.imported === true
  const ready = r.state === 'review' && !done
  /*
    THE TITLE OPENS IT (§19).

    "Interaction must NOT be limited to `Add to project`. Clicking an output
    should allow Grant to OPEN and VIEW the artifact directly." It could not be
    opened at all: importing it and deciding on it were both verdicts on
    something nobody could see. 0584 is the reader and this is the way in.

    Add to project stays where it is meaningful, which is §19's other half.
  */
  return `<div class="bcitem" data-bc-output="${esc(r.output.id)}">
    <span></span>
    <div class="bcitembody">
      <button type="button" class="bcitemtitle bcitemlink" data-bc-output-open="${esc(r.output.id)}"
        aria-label="${esc(`Open ${r.output.title}`)}">${esc(r.output.title)}</button>
      <!--
        THE PERSON'S NAME, not their database key. Every other row on this
        surface resolves the slug -- the roster above, the waiting list, the
        running list -- and this one printed "oliver" in a column of Claires
        and Emmas. One shared lookup, so a fourth list cannot disagree with the
        other three.
      -->
      <span class="bcitemmeta">${esc(
        [bcMini.named(r.who) || r.who, r.output.kind, r.output.size, r.delivered]
          .filter(Boolean)
          .join(' · '),
      )}</span>
      ${askedWords(r.ask) !== '' ? `<span class="bcitemmeta">Asked: ${esc(askedWords(r.ask))}${r.from ? ` — ${esc(r.from)}` : ''}</span>` : ''}
      ${
        (r.derived ?? []).length === 0
          ? ''
          : `<span class="bcitemmeta">From ${esc((r.derived ?? []).join(', '))}</span>`
      }
    </div>
    <span>${
      /*
        A PILL THAT SAYS RUNNING ABOUT FINISHED WORK IS A STATUS LIGHT THAT
        LIES -- and this one said it about everything it did not recognise.

        `studio_requests` returns four states: working, review, approved and
        discarded. Only the first is running. The fallback painted the other
        two as running as well, so the team page showed three outputs marked
        Running directly above a Running work section correctly reporting that
        nothing was. Two sections of one screen disagreeing, and the one that
        was wrong was the one with the confident green dot.

        An unrecognised state shows as itself rather than as a guess, because
        a word nobody has styled is a smaller lie than the wrong word.
      */
      done
        ? status('In the project', 'done')
        : ready
          ? button('Add to project', { kind: 'primary', 'data-bc-addtoproject': r.output.id })
          : r.state === 'working'
            ? status('Running', 'running')
            : r.state === 'approved'
              ? status('Accepted', 'done')
              : r.state === 'discarded'
                ? status('Set aside')
                : status(String(r.state ?? 'unknown'))
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
  /*
    THE SAME REFERENCE THE GALLERY USES, and the row is a control.

    It was `d.file ?? id:<id> ?? ''` here as well - two copies of one rule,
    which is how "some assets can be clicked and others cannot" was true in
    two views at once. `bcMini.docRef` is the one place now, and the row
    presses like the tile does.
  */
  const ref = bcMini.docRef(d)
  /* Draggable for the same reason the tile is, and with the same separation:
     the row carries the drag, the control inside it carries the press. */
  return `<div class="bcitem bcdoc--openable" data-bc-doc="${esc(ref)}" data-bc-dochay="${esc(docsrc.hay(d))}"
    data-bc-docid="${esc(String(d.id ?? ''))}" data-bc-docproject="${esc(String(d.project ?? ''))}" draggable="true"
    data-bc-doc-title="${esc(d.title ?? '')}">
    <!--
      THE SAME DRAWING THE GALLERY USES. This row drew four lines of text
      unconditionally, so an audio file, a spreadsheet and a photograph were
      all little written pages here while the gallery showed each of them as
      what it is. Two views of one list, disagreeing.
    -->
    ${bcMini.thumbFace(d, i, 'bcrowthumb')}
    <div class="bcitembody">
      <button type="button" class="bcitemtitle bcitemlink" data-bc-doc-open="${esc(ref)}"
        data-bc-doc-title="${esc(d.title ?? '')}">${esc(d.title)}</button>
      <span class="bcitemmeta">${docsrc.mark(d, esc)}${esc([bcMini.kindWordOf(d), d.origin, d.size, d.when].filter(Boolean).join(' · '))}${docsrc.versionChip(d, esc)}${docsrc.projectChip(d, esc)}</span>
    </div>
    <span class="bcpmeta">${esc(opensAs(d))}</span>
  </div>`
}

/*
  WHAT PRESSING THIS WILL DO, said before it is pressed.

  Every row used to read "Opens in a new tab", including the rows that had no
  file and could not open at all. A row that promises the wrong thing is worse
  than one that promises nothing, and this is the same rule as an offer only
  promising what the press can perform.
*/
/*
  The word map lived here AND in `miniatures.js`, so the gallery and the list
  could describe one document with two different nouns. `bcMini.kindWordOf`
  answers for both, from the same evidence the thumbnail is drawn from.
*/

const opensAs = (d) => {
  if (bcMini.isAudioDoc(d)) return 'Plays here'
  if (d.file !== undefined && d.file !== null && d.file !== '') return 'Opens in a new tab'
  if (d.id !== undefined && d.id !== null && d.id !== '') return 'Opens in a new tab'
  return 'Details'
}

/*
  THE FILTER BAR: search, where it came from, what kind of file.

  Only the sources that actually have a document are offered, with a count, so
  the bar describes this project rather than every connector there could be.
  The state is a per-viewer convenience (which way you like to look at a shelf),
  so it lives in this browser, and it is read here and written by wire.js, which
  is the one place that touches it.
*/
const docFilterBar = (p, every, f) => {
  const by = docsrc.counts(every)
  const present = docsrc.SOURCES.filter((s) => by.has(s.id))
  const types = docsrc.TYPES.filter((t) => every.some((d) => d.typeKey === t.id))
  const chip = (id, label, n) =>
    `<button type="button" class="bcsrcchip${f.source === id ? ' is-on' : ''}" data-bc-docsrc="${esc(id)}"
      aria-pressed="${f.source === id ? 'true' : 'false'}">${esc(label)}${n === undefined ? '' : ` <span class="bcsrcn">${String(n)}</span>`}</button>`
  return `<div class="bcdocfilter" role="search" aria-label="Find and filter these documents">
    <label class="bcdocfind"><span class="bcvh">Search these documents</span>
      <input type="search" class="bcinput bcdocq" data-bc-docq placeholder="Search by name, source or tag" value="${esc(f.q)}" autocomplete="off">
    </label>
    <span class="bcsrcchips" role="group" aria-label="Where they came from">
      ${chip('all', 'All', every.length)}
      ${present.map((s) => chip(s.id, s.short, by.get(s.id))).join('')}
    </span>
    ${
      (listed().length > 1)
        ? `<label class="bcdoctype"><span class="bcvh">Which projects</span>
            <select class="bcdocsortpick" data-bc-docscope aria-label="Which projects">
              <option value="project"${f.scope === 'all' ? '' : ' selected'}>This project</option>
              <option value="all"${f.scope === 'all' ? ' selected' : ''}>All projects</option>
            </select></label>`
        : ''
    }
    ${
      types.length > 1
        ? `<label class="bcdoctype"><span class="bcvh">Kind of file</span>
            <select class="bcdocsortpick" data-bc-doctype aria-label="Kind of file">
              <option value="all">All types</option>
              ${types.map((t) => `<option value="${esc(t.id)}"${f.type === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select></label>`
        : ''
    }
  </div>`
}

const documentsSurface = (p) => {
  /*
    THE SAME ORDER THE MINIATURE USES (§§30, 34).

    Both surfaces ask `docorder`, so they are two views of one arrangement
    rather than two implementations of it -- which is §30's requirement stated
    as an architecture rather than as a promise.
  */
  const f = docsrc.filterOf(p.slug)
  /*
    ALL PROJECTS (HQ-DOC-015: sort and filter by project). The same logical list, assembled from every project's own
    documents, each carrying its project's name. Nothing is merged across projects: the same Drive file in two
    projects is two items, because a project is part of what a document in Team HQ belongs to.
  */
  const several = listed().length > 1
  const scopeAll = several && f.scope === 'all'
  const every = scopeAll
    ? listed().flatMap((q) => bcMini.docsOf(q).map((d) => ({ ...d, project: q.slug, projectName: q.name })))
    : bcMini.docsOf(p)
  // A custom order is one project's arrangement; across projects the honest default is by project.
  const how = scopeAll && bcDocOrder.mode(p.slug) === 'custom' ? 'project' : bcDocOrder.mode(p.slug)
  const docs = bcDocOrder.ordered(p.slug, docsrc.applyFilter(every, f), how)
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
        ${bcMini.sortControl(p.slug, how, 'full', scopeAll)}
        ${button('Add a file', { kind: 'primary', 'data-bc-upload': '1' })}
      </span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      What the team wrote, what you uploaded, and what came in from connected sources.
    </p>
    ${docFilterBar(p, every, f)}
    <!--
      WHERE THE FILE IS COMING FROM.

      Grant asked for a friendly source choice rather than a file input: from
      this computer, or from Google Drive. Only sources that really work are
      offered - a tile for something the office cannot do would be the fake
      integration his own brief forbids - so this list is two, and grows when a
      connector does.
    -->
    <form class="bcaddform" data-bc-uploadform hidden>
      <!-- bcpickfrom, not bcsources: that name is the Sources list, and one
           class for both made the list lay itself out as this picker grid. -->
      <div class="bcpickfrom">
        <button type="button" class="bcsourcepick" data-bc-from="computer">
          <span class="bcsourcepickname">From this computer</span>
          <span class="bcsourcepickwhat">A file you have here</span>
        </button>
        <button type="button" class="bcsourcepick" data-bc-from="drive">
          <span class="bcsourcepickname">From Google Drive</span>
          <span class="bcsourcepickwhat">Browse your drive and pick one</span>
        </button>
      </div>
      <label class="bcfield" data-bc-fromcomputer hidden>
        <span class="bclabel" for="bc-upload-file">The file</span>
        <input class="bcinput" type="file" id="bc-upload-file" name="file">
      </label>
      <div class="bcrow">
        ${button('Add it', { kind: 'primary', 'data-bc-uploadsave': '1' })}
        ${button('Cancel', { 'data-bc-uploadcancel': '1' })}
      </div>
    </form>
    ${bcDrive.panel()}
    ${
      docs.length === 0 && every.length > 0
        ? empty(
            {
              title: 'Nothing matches',
              body: 'No document fits that search and those filters. Clear them to see everything again.',
            },
            button('Clear filters', { 'data-bc-docclear': '1' }),
          )
        : docs.length === 0
        ? empty(
            {
              title: 'Nothing filed yet',
              body: 'Documents the team writes, files you upload and anything imported from a connected source all land here — each one as itself, not as a row in a table.',
            },
            button('Add a file', { kind: 'primary', 'data-bc-upload': '1' }),
          )
        : view === 'list'
          ? `<div class="bclist" data-bc-docdrop="${esc(p.slug)}">${docs.map((d, i) => docRow(d, i)).join('')}</div><p class="bcpmeta" data-bc-docnone hidden>No document fits that search.</p>`
          : `<div class="bcdocs bcdocs--wall" data-bc-docdrop="${esc(p.slug)}">${bcMini.docThumbs(docs)}</div><p class="bcpmeta" data-bc-docnone hidden>No document fits that search.</p>`
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
/*
  THE KEY IS THE PORT'S, so the miniature, the list and the record all mean the
  same person by it - and so a contact with a record behind it is addressed by
  its id rather than by where it happens to sit in a list that sorts by name.
*/
const contactKey = (c, i) => contacts.keyOf(c, i)

/*
  A CONTACT'S PHOTOGRAPH ARRIVES AS `photo`, NOT `image`.

  `app.studio_contacts` projects `photo_path`, the gateway signs it and hands
  it over as `photo`; the miniature has read that key correctly all along. This
  read `image`, which only the prototype's local data-URL path ever sets -- so
  a real photograph rendered in the miniature and vanished in the record, two
  views of one person disagreeing about whether there is a picture of them.
  Both keys are taken, because the prototype still supplies `image` and a
  capture with no face in it is a capture nobody can judge.
*/
const faceOf = (c) => {
  const url = typeof c?.photo === 'string' && c.photo !== '' ? c.photo : ''
  if (url !== '') return url
  return typeof c?.image === 'string' && c.image !== '' ? c.image : ''
}

const avatar = (c, size = 56) =>
  faceOf(c) !== ''
    ? `<img class="bcface bcface--photo" src="${esc(faceOf(c))}" alt="" width="${String(size)}" height="${String(size)}" loading="lazy" decoding="async">`
    : `<span class="bcface bcface--mono" aria-hidden="true">${esc(
        String(c.name ?? '?')
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w.charAt(0).toUpperCase())
          .join(''),
      )}</span>`

/*
  ONE PERSON, EDITABLE IN PLACE.

  Grant: *"Existing contacts must be editable... change existing data; add
  missing data; replace/remove the image; add or update website/social
  information; edit notes; correct details later."* So this is a form rather
  than a list of facts with an Edit button somewhere: every field a person can
  see is the field they change, which is his general rule stated as markup.

  Rendered from `contacts.FIELDS`, so a field added to the port appears here,
  is validated here and is sent from here without three separate edits.
*/
const contactRecord = (p, c, i) => {
  const key = contactKey(c, i)
  const lines = []
  for (const f of contacts.FIELDS) {
    const at = lines.find((l) => l.n === f.line)
    if (at === undefined) lines.push({ n: f.line, fields: [f] })
    else at.fields.push(f)
  }
  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById('contacts')?.name ?? 'Contacts', to: at(`/p/${p.slug}/contacts`) },
    { name: c.name },
  ])}
    <div class="bcrecordhead">
      <span class="bcpersonhead">
        ${avatar(c, 56)}
        <h1>${esc(c.name)}</h1>
      </span>
      <span class="bcactions">${button('Back to Contacts', { 'data-bc-contact-close': '1' })}</span>
    </div>

    <form class="bcaddform bcgap-l" data-bc-contactedit="${esc(key)}">
      <!--
        ONE FACE. The header already shows the person's photograph or
        monogram; a second, larger copy above the fields made the record open
        on the same face twice. The row keeps only what changes it.
      -->
      <div class="bcimagerow">
        <span class="bcimageacts">
          <label class="bcbtn bcbtn--file">
            <span>${esc(faceOf(c) !== '' ? 'Replace the image' : 'Add an image')}</span>
            <input type="file" accept="image/*" data-bc-contact-image="${esc(key)}" hidden>
          </label>
          ${
            faceOf(c) !== ''
              ? button('Remove it', { 'data-bc-contact-image-off': esc(key) })
              : ''
          }
        </span>
      </div>
      ${lines
        .map(
          /*
            GROUPED BY WHAT A PERSON ASKS: who is this, how do I reach them,
            what happens next. Eleven boxes in a row read as a database form;
            the same boxes under three plain headings read as a person.
          */
          (l) => `${
            { 1: 'Who they are', 3: 'How to reach them', 5: 'Next step' }[l.n] === undefined
              ? ''
              : `<h2 class="bcctgroup">${esc({ 1: 'Who they are', 3: 'How to reach them', 5: 'Next step' }[l.n])}</h2>`
          }<div class="${l.fields.length > 1 ? 'bcformrow' : ''}">
            ${l.fields
              .map((f) =>
                f.kind === 'long'
                  ? `<label class="bcfield">
                      <span class="bclabel" for="bc-ct-${esc(f.key)}">${esc(f.label)}</span>
                      <textarea class="bcinput" id="bc-ct-${esc(f.key)}" rows="4"
                        data-bc-ctfield="${esc(f.key)}">${esc(c[f.key] ?? '')}</textarea>
                    </label>`
                  : input({
                      id: `bc-ct-${f.key}`,
                      label: f.label,
                      name: f.key,
                      type: f.kind === 'text' ? 'text' : f.kind,
                      value: c[f.key] ?? '',
                      autocomplete: 'off',
                      'data-bc-ctfield': f.key,
                    }),
              )
              .join('')}
          </div>`,
        )
        .join('')}
      <div class="bcrow">
        ${button('Save changes', { kind: 'primary', 'data-bc-contact-save': esc(key) })}
        ${button('Remove contact', { 'data-bc-contact-away': esc(key) })}
        <span class="bcsaidhere" data-bc-contact-said role="status" aria-live="polite"></span>
      </div>
    </form>`
}

/*
  ADDING ONE. Four fields rather than eleven: Grant asked that nothing be
  compulsory, and a form of eleven boxes is a form nobody fills in. Everything
  else is one press away on the record, which is now editable - which is what
  makes a short creation form the right answer rather than a lossy one.
*/
const contactForm = (p) => `${breadcrumb([
  { name: p.name, to: at(`/p/${p.slug}`) },
  { name: toolById('contacts')?.name ?? 'Contacts', to: at(`/p/${p.slug}/contacts`) },
  { name: 'Add Contact' },
])}
  <div class="bcrecordhead"><h1>Add Contact</h1></div>
  <form class="bcaddform bcgap-l" data-bc-contactform="1">
    <div class="bcformrow">
      ${input({ id: 'bc-c-name', label: 'Name', name: 'name', autocomplete: 'off' })}
      ${input({ id: 'bc-c-role', label: 'What they are to this project', name: 'role', autocomplete: 'off' })}
    </div>
    <div class="bcformrow">
      ${input({ id: 'bc-c-email', label: 'Email', name: 'email', type: 'email', autocomplete: 'off' })}
      ${input({ id: 'bc-c-phone', label: 'Telephone', name: 'phone', type: 'tel', autocomplete: 'off' })}
    </div>
    ${input({ id: 'bc-c-org', label: 'Organisation', name: 'org', autocomplete: 'off' })}
    <div class="bcrow">
      ${button('Add', { kind: 'primary', 'data-bc-contactadd-go': '1' })}
      ${button('Cancel', { 'data-bc-contact-close': '1' })}
      <span class="bcsaidhere" data-bc-contact-said role="status" aria-live="polite"></span>
    </div>
  </form>`

const contactsSurface = (p) => {
  const cs = p.contacts ?? []
  if (state().bcContactAdd === true) return contactForm(p)
  const wanted = state().bcContact
  if (wanted !== null && wanted !== undefined) {
    const i = cs.findIndex((x, n) => contactKey(x, n) === String(wanted))
    if (i !== -1) return contactRecord(p, cs[i], i)
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
        : `<div class="bcctgrid" data-bc-ctgrid>${cs.map((c, i) => contactCard(p, c, i)).join('')}</div>`
  }`
}

/*
  A CONTACT AS A CARD (11 October 2026): the maximised Contacts view used to be one long row per person, an avatar at the far left and
  an email at the far right with the width between them empty. A card shows what the office actually holds about the person, and only
  that: nothing is invented, so a field the record does not have is simply not drawn.

    - who: photograph or monogram, name, role, organisation, where;
    - labels: the ones applied, or the ones the role already names (people.labelsFor);
    - how to reach them: email and telephone as real links, website, social;
    - recent interaction: when they were last in touch, and the next step with its date;
    - associations: the other projects this person is also on, found by the same email (or, without one, the same name).
*/
const sameContact = (a, b) => {
  const ea = String(a?.email ?? '').trim().toLowerCase()
  const eb = String(b?.email ?? '').trim().toLowerCase()
  if (ea !== '' && eb !== '') return ea === eb
  return ea === '' && eb === '' && String(a?.name ?? '').trim().toLowerCase() === String(b?.name ?? '').trim().toLowerCase() && String(a?.name ?? '').trim() !== ''
}
const otherProjectsOf = (p, c) =>
  PROJECTS.filter((q) => q.slug !== p.slug && q.slug !== 'unnamed' && (q.contacts ?? []).some((x) => sameContact(x, c))).map((q) => q.name)

const contactCard = (p, c, i) => {
  const key = contactKey(c, i)
  const labels = people.labelsFor(c)
  const also = otherProjectsOf(p, c)
  const site = String(c.website ?? '').trim()
  const row = (label, inner) => `<div class="bcctrow"><dt>${esc(label)}</dt><dd>${inner}</dd></div>`
  const rows = [
    c.email ? row('Email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`) : '',
    c.phone ? row('Phone', `<a href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>`) : '',
    site ? row('Website', /^https?:\/\//i.test(site) ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(site.replace(/^https?:\/\//i, ''))}</a>` : esc(site)) : '',
    c.instagram ? row('Social', esc(c.instagram)) : '',
    c.last ? row('Last contact', esc(c.last)) : '',
    c.next ? row('Next step', `${esc(c.next)}${c.nextDue ? ` <span class="bcctdue">${esc(c.nextDue)}</span>` : ''}`) : '',
  ].join('')
  return `<article class="bcctcard" data-bc-ctcard="${esc(key)}">
    <header class="bcctcardhead">
      ${avatar(c, 52)}
      <div class="bcctwho">
        <button type="button" class="bcctname bcitemlink" data-bc-contact="${esc(key)}">${esc(c.name)}</button>
        <span class="bcctrole">${esc([c.role, c.org].filter(Boolean).join(' · '))}</span>
        ${c.where ? `<span class="bcctwhere">${esc(c.where)}</span>` : ''}
      </div>
    </header>
    ${labels.length === 0 ? '' : `<ul class="bcctlabels" aria-label="Labels">${labels.map((l) => `<li class="bcctlabel ${esc(l.hue ?? '')}">${esc(l.name)}</li>`).join('')}</ul>`}
    ${rows === '' ? '' : `<dl class="bcctrows">${rows}</dl>`}
    ${c.note ? `<p class="bcctnote">${esc(String(c.note).length > 140 ? `${String(c.note).slice(0, 138)}…` : c.note)}</p>` : ''}
    <footer class="bcctfoot">
      <span class="bcctproj"><span class="bcctprojlabel">On</span> ${[p.name, ...also].map((n) => `<span class="bcctprojchip">${esc(n)}</span>`).join('')}</span>
    </footer>
  </article>`
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
/*
  SOURCES: A GALLERY, A RECORD, AND A WAY TO ADD ONE.

  Grant, 23 September: *"Clicking an existing source must do something useful.
  Add Source must work. Source details must show real known metadata rather
  than invented information."*

  It was five rows of text with nothing pressable and no way to add anything -
  a whole surface with zero interaction, which is the plainest false
  affordance this pass found. Three parts now, and the third is the one that
  needs care: what the office KNOWS about a source is a small set of facts,
  and a detail page is an invitation to invent the rest. So the record prints
  the fields that exist and says plainly when one does not, which is why a
  reference shows no "last read" rather than showing "never".
*/
const sourceKey = (s, i) => String(s?.id ?? s?.name ?? s?.title ?? i)

/*
  WHAT THIS CONNECTION IS ACTUALLY POINTING AT  (§22)

  §22: "`Connected` alone is insufficient. Show enough information to
  understand WHAT is connected... The Sources page should answer: what is this
  connection actually pointing at? at a glance."

  It did not. A row said the attachment's NAME and then the raw value of
  `project_attachments.role` -- so Grant's real Notion databases read
  "Projects / home / Connected", which names no service, and "home" is a
  database enum on a person's screen. The service was in the payload the whole
  time, as `via`, and nothing drew it.

  One assembly, two callers: the row and the record. A row list built twice is
  a list that will disagree, and the record already had its own phrasing for
  the same fact.

  ROLES ARE TRANSLATED, NOT LISTED AWAY. The three the table permits are
  source, home and mirror, and an unrecognised one falls through as itself
  rather than vanishing -- a vocabulary the office grows should show up as an
  odd word, not as a blank line.
*/
const ROLE_SAYS = {
  source: 'read for material',
  home: 'where new material is filed',
  mirror: 'kept in step with what the office holds',
}

/**
 * @param withService - false where the service is already named beside it,
 *   which is the record: "What it is: Notion" then "What it gives this
 *   project: Notion, read for material" says Notion twice. One function with a
 *   parameter rather than two that will drift.
 */
const sourceSays = (s, { withService = true } = {}) => {
  if (s?.kind !== 'connector') return s?.what ?? s?.detail ?? ''
  const role = typeof s?.what === 'string' ? s.what : ''
  const said = ROLE_SAYS[role] ?? role
  if (!withService) return said
  return [s?.via ?? '', said].filter((x) => String(x ?? '') !== '').join(' · ')
}

const sourceRow = (s, i) => {
  const trouble = s.health === 'blocked' || s.trouble === true
  const connected = s.kind === 'connector'
  return `<button type="button" class="bcsource bcsource--press${trouble ? ' bcsource--trouble' : ''}"
    data-bc-source="${esc(sourceKey(s, i))}">
    ${bcMini.sourceMark(s)}
    <span class="bcsourcename">${esc(s.name ?? s.title ?? 'A source')}</span>
    <span class="bcsourcewhat">${esc(sourceSays(s))}</span>
    <span class="bcsourcewhen" data-tone="${trouble ? 'trouble' : connected ? 'on' : 'link'}">${
      trouble
        ? status(esc(s.problem ?? 'Needs attention'), 'blocked')
        : esc(
            connected
              ? ['Connected', s.last ? `last read ${s.last}` : 'not read yet'].join(' · ')
              : 'A link to read',
          )
    }</span>
  </button>`
}

const sourcesSurface = (p) => {
  const ss = (p.sources ?? []).filter((s) => !hiddenFromSources(s))
  if (state().bcSourceAdd === true) return addSourceSurface(p)
  const wanted = state().bcSource
  if (wanted !== null && wanted !== undefined) {
    const i = ss.findIndex((x, n) => sourceKey(x, n) === String(wanted))
    if (i !== -1) return sourceRecord(p, ss[i])
  }
  return `${crumbFor(p, 'sources')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('sources')?.name ?? 'Sources')}</h1>
      <span class="bcactions">${button('Add Google Drive folder', {
        'data-bc-drive-folder': '1',
        disabled: driveFolder.connected !== true,
        title: driveFolder.connected === true ? 'Watch a Google Drive folder for this project' : 'Connect Google Drive first, in Settings',
      })}${button('Add Source', { kind: 'primary', 'data-bc-source-add': '1' })}</span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      Where this project's material comes from: services the team can read,
      and links left for it.
    </p>
    ${
      ss.length === 0
        ? empty(
            {
              title: 'Nothing is connected yet',
              body: 'A connected notebook, drive folder or workspace lets the team read what is already written down. Until then it works from what is filed here.',
            },
            button('Add Source', { kind: 'primary', 'data-bc-source-add': '1' }),
          )
        : `<div class="bcsources bcsources--full">${ss.map((s, i) => sourceRow(s, i)).join('')}</div>`
    }
    ${websrc.block(p)}`
}

/** One source, with the facts the office actually holds about it. */
const sourceRecord = (p, s) => {
  const connected = s.kind === 'connector'
  const trouble = s.health === 'blocked' || s.trouble === true
  /*
    WHAT IS VISIBLE THROUGH THIS CONNECTION (21 October 2026): the documents this project holds from it, the same list Docs &
    Files shows, filtered to this one connection. Nothing else is on the page; the facts that were here are not shown.
  */
  const visible = visibleThrough(p, s)
  const url = s.url ?? (s.kind === 'reference' ? (s.name ?? '') : '')
  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById('sources')?.name ?? 'Sources', to: at(`/p/${p.slug}/sources`) },
    { name: s.name ?? s.title ?? 'A source' },
  ])}
    <div class="bcrecordhead">
      <span class="bcpersonhead">
        ${bcMini.sourceMark(s)}
        <h1>${esc(s.name ?? s.title ?? 'A source')}</h1>
      </span>
      <span class="bcactions">${button('Back to Sources', { 'data-bc-source-close': '1' })}</span>
    </div>
    ${
      url === '' || !/^https?:\/\//i.test(String(url))
        ? ''
        : `<div class="bcrow bcgap-l">
            ${button('Open it', { kind: 'primary', 'data-bc-doc-tab': esc(String(url)) })}
          </div>`
    }
    ${
      connected
        ? `<p class="bcpmeta bcgap-l">${trouble ? esc(s.problem ?? 'Needs attention') : 'Connected'}${s.last ? ` · last read ${esc(s.last)}` : ''}</p>`
        : ''
    }
    <h2 class="bcsubhead bcgap-l">In this connection</h2>
    ${liveItems(s)}
    <h2 class="bcsubhead">In this project</h2>
    ${
      visible.length === 0
        ? s.gave !== undefined && s.gave !== null && Number(s.gave) > 0
          ? `<p class="bcpmeta bcprose">The office counts ${esc(String(s.gave))} documents from this connection. Their list is not on this page yet: it needs the connection's own read.</p>`
          : '<p class="bcpmeta bcprose">Nothing from this connection is in this project yet.</p>'
        : `<p class="bcpmeta">${esc(String(visible.length))} ${visible.length === 1 ? 'item' : 'items'}</p>
          <ul class="bcvislist">${visible
            .map(
              (d) => `<li><span class="bcvisname">${esc(d.title ?? d.name ?? 'A document')}</span>
                <span class="bcpmeta">${esc(String(docsrc.typeOf(d) ?? ''))}</span></li>`,
            )
            .join('')}</ul>`
    }`
}

/**
 * What the connection itself holds, read live (21 October 2026). The page asks for it when the record is drawn
 * (wire.js fills the placeholder), so the record opens at once and the list follows. Drive reads the watched folder;
 * Notion and NotebookLM are asked of the office.
 */
const liveItems = (s) => {
  const key = bcMini.markKeyFor(s)
  if (key === 'drive') {
    // A watched folder is named either by its address or by its bare id (the office's external_ref).
    const named = String(s.external_url ?? s.url ?? s.external_ref ?? s.ref ?? '')
    const folder = /folders\/([A-Za-z0-9_-]+)/.exec(named)?.[1] ?? (/^[A-Za-z0-9_-]{10,}$/.test(named) ? named : '')
    return `<div class="bcconnitems" data-bc-conn-items data-connector="drive" data-folder="${esc(folder)}">
      <p class="bcpmeta">Reading the watched folder…</p></div>`
  }
  if (key === 'notion' || key === 'notebooklm') {
    return `<div class="bcconnitems" data-bc-conn-items data-connector="${esc(key)}">
      <p class="bcpmeta">Asking ${esc(key === 'notion' ? 'Notion' : 'NotebookLM')} what it holds…</p></div>`
  }
  return '<p class="bcpmeta">This connection has no live list yet.</p>'
}

/**
 * The Stripe reference is removed from the Sources views for now (21 October 2026): it is hidden, not deleted. The row
 * is a stored reference, and deleting it is a production write that has not been named.
 */
const hiddenFromSources = (s) => /(^|\.)stripe\.com(\/|$)/i.test(String(s?.url ?? s?.name ?? s?.title ?? ''))

/** The documents this project holds through one connection: the Docs & Files list, filtered to it. */
const visibleThrough = (p, s) => {
  const want = docsrc.sourceOf({ connector: s.connector ?? '', origin: s.name ?? s.title ?? '' })
  return (p.documents ?? []).filter((d) => docsrc.sourceOf(d) === want)
}

/*
  ADDING ONE: the gallery Grant described, built from the marks the studio
  already has, plus the one kind of source a project can add by itself.

  A connected SERVICE is not something a project can switch on: one account
  serves every project, the credential lives in the office, and the place that
  holds it is Settings. So a service tile says whether the office has it and
  takes you to the place that changes that, rather than offering a connection
  it cannot make. A LINK is the project's own, and `reference_add` has existed
  at the gateway all along - so that half is a field and a button.
*/
const addSourceSurface = (p) => {
  const known = [
    { key: 'drive', name: 'Google Drive', what: 'A folder the team watches for new files' },
    { key: 'notion', name: 'Notion', what: 'Pages the office can read and write' },
    { key: 'notebooklm', name: 'NotebookLM', what: 'A notebook of sources' },
    { key: 'github', name: 'GitHub', what: 'A repository' },
    { key: 'mcp', name: 'An MCP server', what: 'Anything that speaks MCP' },
    { key: 'upload', name: 'Upload a file', what: 'A document handed straight to the project' },
  ]
  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: toolById('sources')?.name ?? 'Sources', to: at(`/p/${p.slug}/sources`) },
    { name: 'Add Source' },
  ])}
    <div class="bcrecordhead">
      <h1>Add Source</h1>
      <span class="bcactions">${button('Back to Sources', { 'data-bc-source-close': '1' })}</span>
    </div>

    <h2 class="bcsubhead">Something to read</h2>
    <p class="bcpmeta bcprose">
      A page, a document, anything with an address. It belongs to this project
      and the team reads it when the work needs it.
    </p>
    <form class="bcaddform bcgap-l" data-bc-sourceform="1">
      ${input({ id: 'bc-src-url', label: 'The address', name: 'url', autocomplete: 'off', hint: 'For example innergy.com/journey-vs-destination' })}
      <div class="bcrow">
        ${button('Add it', { kind: 'primary', 'data-bc-source-save': '1' })}
        <span class="bcsaidhere" data-bc-source-said role="status" aria-live="polite"></span>
      </div>
    </form>

    <h2 class="bcsubhead">A Google Drive folder</h2>
    <p class="bcpmeta bcprose bcgap-l">
      The team watches the folder for new files, and asks before it reads any of them. Google Drive has to be connected first.
    </p>
    <div class="bcrow bcgap-l">
      ${button('Choose a folder on this PC', {
        kind: 'primary',
        'data-bc-drive-choose': '1',
        disabled: driveFolder.connected !== true,
        title: driveFolder.connected === true ? 'Pick your Google Drive folder, for example your Google Drive desktop folder' : 'Connect Google Drive first, in Settings',
      })}
    </div>
    <p class="bcpmeta bcprose" data-bc-drive-note>
      Pick the folder in your Google Drive desktop app. Team HQ checks its files against Google Drive before it watches anything. Chrome and Edge only.
    </p>
    <div class="bcdrivecheck" data-bc-drive-result role="status" aria-live="polite"></div>
    <p class="bcpmeta bcprose bcgap-l">Or paste the folder's address:</p>
    <form class="bcaddform bcgap-l" data-bc-drivefolderform="1">
      ${input({ id: 'bc-drive-folder', label: 'The folder address', name: 'folder', autocomplete: 'off', hint: 'Open the folder in Google Drive and copy the address from the browser bar' })}
      <div class="bcrow">
        ${button('Watch this folder', { kind: 'primary', 'data-bc-drive-save': '1', disabled: driveFolder.connected !== true })}
        <span class="bcsaidhere" data-bc-drive-said role="status" aria-live="polite">${
          driveFolder.connected === true ? '' : 'Connect Google Drive first, in Settings, then come back here.'
        }</span>
      </div>
    </form>

    <h2 class="bcsubhead">A connected service</h2>
    <p class="bcpmeta bcprose bcgap-l">
      One account serves every project, so a service is connected once for the
      whole office and then attached to the projects that need it.
    </p>
    <div class="bcservices">
      ${known
        .map(
          (k) => `<button type="button" class="bcservice" data-bc-service="${esc(k.key)}">
            <span class="bcservicemark" style="color:${esc(MARKS[k.key]?.tint ?? 'currentColor')}">${
              MARKS[k.key]?.svg ?? ''
            }</span>
            <span class="bcservicename">${esc(k.name)}</span>
            <span class="bcservicewhat">${esc(k.what)}</span>
            <span class="bcserviceadd">Set up</span>
          </button>`,
        )
        .join('')}
    </div>`
}

/*
  §12 — ACTIVITY IS A STORY, and time is its axis.

  It rendered a flat list of sentences with the time as a trailing grey
  fragment, and it printed the raw slug: "emma pulled the WS02 client list".
  The same two defects as the to-do rows, on the surface whose whole subject
  is when things happened.
*/
/*
  FILTERS FOR THE ACTIVITY LIST (4 October). Only the filters the data can
  honestly answer are offered: a filter whose every result would be empty is a
  dead control. Who did it is read from `who` (Grant, or a member of the team),
  the door it came through from `via`, and what it touched from `category`.
*/
const ACT_FILTERS = [
  { id: 'all', name: 'Everything', test: () => true },
  { id: 'people', name: 'People', test: (a) => ['grant', 'you'].includes(String(a.who ?? '').toLowerCase()) },
  { id: 'team', name: 'The team', test: (a) => !['grant', 'you', ''].includes(String(a.who ?? '').toLowerCase()) },
  { id: 'integration', name: 'Integrations', test: (a) => ['ChatGPT', 'Claude', 'External assistant', 'Telegram', 'Slack', 'Voice'].includes(String(a.via ?? '')) },
  { id: 'sync', name: 'Sync', test: (a) => a.category === 'sync' || /sync/i.test(String(a.via ?? '')) },
  { id: 'document', name: 'Documents', test: (a) => a.category === 'document' },
  { id: 'task', name: 'Tasks', test: (a) => a.category === 'task' },
  { id: 'calendar', name: 'Calendar', test: (a) => a.category === 'calendar' },
  /* Offered only when a record carries a severity: a filter nothing can match is a dead control. */
  { id: 'problems', name: 'Problems', test: (a) => ['warn', 'warning', 'error', 'failed'].includes(String(a.severity ?? '').toLowerCase()) },
]
/* TIME RANGE, from the instant a record carries. A range is offered only when some record has one. */
const ACT_RANGES = [
  { id: 'any', name: 'Any time', days: 0 },
  { id: 'day', name: 'Last 24 hours', days: 1 },
  { id: 'week', name: 'Last 7 days', days: 7 },
]
const inRange = (a, days) => {
  if (days === 0) return true
  const t = a.at ? Date.parse(a.at) : Number.NaN
  return !Number.isNaN(t) && Date.now() - t <= days * 86400000
}
const activitySurface = (p) => {
  const acts = p.activity ?? []
  const offered = ACT_FILTERS.filter((f) => f.id === 'all' || acts.some(f.test))
  const want = state().bcActFilter ?? 'all'
  const on = offered.some((f) => f.id === want) ? want : 'all'
  const test = (offered.find((f) => f.id === on) ?? offered[0]).test
  const rangeOffered = acts.some((a) => a.at && !Number.isNaN(Date.parse(a.at)))
  const rangeOn = rangeOffered ? (ACT_RANGES.find((r) => r.id === (state().bcActRange ?? 'any')) ?? ACT_RANGES[0]) : ACT_RANGES[0]
  const shown = acts.filter(test).filter((a) => inRange(a, rangeOn.days))
  return `${crumbFor(p, 'activity')}
    <div class="bcrecordhead"><h1>${esc(toolById('activity')?.name ?? 'Activity')}</h1></div>
    <p class="bcpmeta bcprose bcgap-l">
      What has happened on this project, most recent first. Each line says who did it and, where it is known, which door it came through.
    </p>
    ${
      offered.length > 1
        ? `<div class="bcsrcchips bcactfilter" role="group" aria-label="Filter the activity">${offered
            .map(
              (f) =>
                `<button type="button" class="bcsrcchip${f.id === on ? ' is-on' : ''}" data-bc-actf="${esc(f.id)}" aria-pressed="${f.id === on ? 'true' : 'false'}">${esc(f.name)}${f.id === 'all' ? '' : ` <span class="bcsrcn">${String(acts.filter(f.test).length)}</span>`}</button>`,
            )
            .join('')}</div>`
        : ''
    }
    ${
      rangeOffered
        ? `<div class="bcsrcchips bcactfilter" role="group" aria-label="Time range">${ACT_RANGES.map(
            (r) =>
              `<button type="button" class="bcsrcchip${r.id === rangeOn.id ? ' is-on' : ''}" data-bc-actr="${esc(r.id)}" aria-pressed="${r.id === rangeOn.id ? 'true' : 'false'}">${esc(r.name)}</button>`,
          ).join('')}</div>`
        : ''
    }
    ${
      acts.length === 0
        ? empty({ title: 'Nothing yet', body: 'What people and the team do on this project is listed here.' })
        : shown.length === 0
          ? empty({ title: 'Nothing matches', body: 'Nothing on this project fits that filter.' }, button('Show everything', { 'data-bc-actf': 'all', 'data-bc-actr': 'any' }))
          : bcMini.timelineMini({ ...p, activity: shown }, { items: shown.length })
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
  const key = taskKey(t)
  const list = (p.modules ?? []).find((m) => (m.id ?? m.name) === t.parent)
  const stage = stageOf(t)
  /*
    A CARD IS DRAGGED, and the select stays.

    Grant: *"Cards must be dynamically draggable between columns. Moving a
    card must update its actual underlying state rather than merely animating
    the UI."* Dragging is the gesture; the select is how the same move is made
    with a keyboard, with a screen reader, and on a touch device where a drag
    inside a scrolling column is a fight with the page. Two controls, one
    writer - `todos.setStage` for a row with a record, the prototype's memory
    for one without - so they cannot disagree.
  */
  return `<article class="bcbcard" data-bc-card="${esc(key)}" data-stage="${esc(stage)}"
    draggable="true" tabindex="0" aria-label="${esc(`${t.title} — ${stage}`)}">
    <button type="button" class="bcitemtitle bcitemlink" data-bc-task-open="${esc(key)}">${esc(t.title)}</button>
    <div class="bcbmeta">
      ${list === undefined ? '' : `<span class="bcbwhere">${esc(list.name)}</span>`}
      ${bcMini.dueWords(t) ? `<span class="bcbdue${bcMini.isLate(t) ? ' bcbdue--late' : ''}">${esc(bcMini.dueWords(t))}</span>` : ''}
    </div>
    <label class="bcbmove">
      <span class="bcvh">Where this is</span>
      <!--
        A CARD THAT IS STUCK MUST SAY SO IN ITS OWN CONTROL. Stuck is not a
        value this select may SET - the office refuses it without a reason -
        but leaving it out entirely meant a stuck card's select fell to its
        first option and read "Not started", which is the control contradicting
        the column it is sitting in. It is offered as a disabled option:
        selectable never, visible always.

        Plain words only in here. A backtick inside an HTML comment inside a
        template literal ends the string, and this is the sixth time in this
        repository.
      -->
      <select class="bcinput bcbsel" data-bc-move="${esc(key)}"
        aria-label="${esc(`Where ${t.title} has got to`)}">
        ${
          stage === 'blocked'
            ? `<option value="blocked" selected disabled>Stuck</option>`
            : ''
        }
        ${MOVABLE.map(
          (m) =>
            `<option value="${esc(m.id)}" ${stage === m.id ? 'selected' : ''}>${esc(m.name)}</option>`,
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
      <span class="bcactions">${button('The list instead', { kind: 'outline', 'data-bc-go': at(`/p/${p.slug}/tasks`) })}</span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      The same to-dos, by stage. Drag a card to another column, or choose its stage on the card.
    </p>
    ${
      all.length === 0
        ? empty(
            {
              title: 'No cards yet',
              body: 'A card is a to-do, and the column it sits in shows how far it has got. Add a to-do and it appears here as a card.',
            },
            button('Go to the to-dos', { kind: 'primary', 'data-bc-go': at(`/p/${p.slug}/tasks`) }),
          )
        : `<div class="bcboard">
            ${STAGE.map((st) => {
              const items = all.filter((t) => stageOf(t) === st.id)
              return `<section class="bcbcol" data-stage="${esc(st.id)}" data-bc-drop="${esc(st.id)}"
                aria-label="${esc(`${st.name} — ${String(items.length)} card(s)`)}">
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

const scheduleSurface = (p) => {
  const all = (p.tasks ?? []).filter((t) => t.milestone !== true)
  const undated = all.filter((t) => String(t.due_on ?? t.starts_on ?? '') === '')
  return `${crumbFor(p, 'schedule')}
    <div class="bcrecordhead">
      <h1>${esc(toolById('schedule')?.name ?? 'Schedule')}</h1>
      <span class="bcactions">${button('The list instead', { kind: 'outline', 'data-bc-go': at(`/p/${p.slug}/tasks`) })}</span>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      This project's events and the to-dos that fall due, by day, week or month. To-dos without a date are listed at the foot.
    </p>
    ${cal.block(p, { full: true })}
    ${
      undated.length === 0
        ? ''
        : `<section class="bcundated">
                <h2>No date yet</h2>
                <p class="bcpmeta bcprose">
                  Work with nothing to be due by. Giving one a date puts it on
                  the month above.
                </p>
                <div class="bclist">
                  ${undated
                    .map(
                      (t) => `<div class="bcitem bcundatedrow">
                        <span></span>
                        <div class="bcitembody">
                          <button type="button" class="bcitemtitle bcitemlink"
                            data-bc-task-open="${esc(taskKey(t))}">${esc(t.title)}</button>
                          ${t.who ? `<span class="bcitemmeta">${esc(whoName(t.who))}</span>` : ''}
                        </div>
                        <!--
                          THE DATE IS GIVEN HERE, on the row that lacks it.

                          Grant's own journey for this screen is: open a dated
                          item, open No date yet, assign a date, change it,
                          save, refresh, reopen. Everything but the assigning
                          worked, and it worked by opening the record - which
                          is two screens away from the list of exactly the
                          things that need one. It saves on change: there is no
                          other field, so a Save button would be a second press
                          that can only ever mean yes.
                        -->
                        <label class="bcduecell">
                          <span class="bcvh">${esc(`When ${t.title} is due`)}</span>
                          <input class="bcinput bcdueinput" type="date"
                            data-bc-setdue="${esc(taskKey(t))}" value="">
                        </label>
                      </div>`,
                    )
                    .join('')}
                </div>
              </section>`
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
  ctx?.needChat?.(p.slug)
  const said = ctx?.chatFor?.(p.slug) ?? []
  /* The room is the chief of staff's: one filter, shared with the dock preview (bcMini.roomVoices). */
  const shown = bcMini.roomVoices(said.length > 0 ? said : (p.chat ?? []))
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
    <form class="bcsay" data-bc-sayform>
      <label class="bcvh" for="bc-say">${esc(`Message the team about ${p.name}`)}</label>
      <!--
        ONE COMPOSER, SHAPED LIKE ONE. It was a labelled one-line field above
        a row holding a 44px Voice note and a 32px Send, so the two actions
        were different heights and neither sat with the text. Now a single
        surface: the text grows with what is typed, and the actions sit on its
        own bottom edge.

        A TEXTAREA, because a message can be more than one line - and Enter
        still sends, Shift+Enter makes the new line (Grant, 23 September, for
        the dock; the same rule here so the two chats agree).
      -->
      <div class="bcsaybox">
        <textarea class="bcsayinput" id="bc-say" name="say" rows="1" autocomplete="off"
          placeholder="${esc(`Ask the team about ${p.name}…`)}"></textarea>
        <div class="bcsaybar">
          <!--
            THE VOICE NOTE, and it is deliberately HERE rather than at the top
            of the project. Grant drew that line himself: the microphone inside
            the chat sends a voice message, and the one on the project head
            opens a live conversation. Its place is what says which it is.

            A MICROPHONE, NOT A RED DOT. The idle control carried a red dot,
            which is the universal sign for already recording - so the
            control said "on" before it had been pressed. The dot now appears
            only while it actually records.
          -->
          <button type="button" class="bcnotemic" data-bc-note="idle"
            aria-label="Record a voice note">
            <svg class="bcnotemicicon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
              stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3"></rect>
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"></path>
              <path d="M12 18v3"></path>
            </svg>
            <span class="bcnotemicdot" aria-hidden="true"></span>
            <span class="bcnotemictxt">Voice note</span>
          </button>
          <span class="bcsayhint" aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
          ${button('Send', { kind: 'primary', 'data-bc-say': '1' })}
        </div>
      </div>
      <!--
        One panel, three states, because a recorder that appears in a different
        place depending on what it is doing is a recorder you have to look for.
        Empty and hidden until the microphone is pressed.
      -->
      <div class="bcnote" data-bc-notepanel hidden></div>
    </form>`
}

/*
  ONE DOCUMENT, WHEN A NEW TAB IS THE WRONG ANSWER.

  Grant, 22 September: *"unsupported preview formats should still have a
  sensible open/download/details action"*, and *"audio should have usable
  playback"*. Two cases a new tab cannot serve:

   - a recording. Sending somebody to a bare browser tab with an audio element
     in it loses the project, the title and the way back. It plays here.
   - a document with no file behind it at all - most of the gallery on a
     project whose material lives in a connected notebook. There is nothing to
     open, and the honest answer is to say what is known about it rather than
     to do nothing, which is what "some assets cannot be clicked" actually
     was.
*/
/*
  WHAT THE TEAM MADE, OPEN (§19).

  The provenance is beside the body rather than under it, because §9's argument
  is that an output naming only its title loses the trail at the moment it
  becomes a document -- and this is the last screen before that happens.

  The body is drawn as paragraphs. CLAUDE.md records what one tag does to it:
  HTML collapses whitespace, so a body rendered in a single element loses every
  newline, and #186's whole outcome was invisible on the dashboard for weeks
  because of it while Telegram and Slack showed it correctly the entire time.
*/
const outputRecord = (p) => {
  const id = state().bcOutput
  const got = ctx.outputBody?.(id)
  const back = button('Back to the team', { 'data-bc-output-close': '1' })

  if (got === undefined || got === 'asking') {
    return `${crumbFor(p, 'team')}
      <div class="bcrecordhead"><h1>Opening…</h1><span class="bcactions">${back}</span></div>
      <p class="bcpmeta">Reading what the team wrote.</p>`
  }
  if (got === null) {
    return `${crumbFor(p, 'team')}
      <div class="bcrecordhead"><h1>Could not open it</h1><span class="bcactions">${back}</span></div>
      <p class="bcpmeta">The office did not answer for that one. Nothing here is a guess at
        what it said.</p>`
  }

  const said = String(got.body ?? '')
  const paras = said.split(/\n{2,}/).filter((x) => x.trim() !== '')
  const sources = Array.isArray(got.sources) ? got.sources : []
  return `${crumbFor(p, 'team')}
    <div class="bcrecordhead">
      <h1>${esc(String(got.title ?? 'What the team made'))}</h1>
      <span class="bcactions">
        ${
          got.imported === true
            ? status('In the project', 'done')
            : button('Add to project', { kind: 'primary', 'data-bc-addtoproject': esc(String(got.id)) })
        }
        ${back}
      </span>
    </div>
    <p class="bcpmeta">${esc(
      [
        got.who ? `Written by ${whoName(String(got.who))}` : '',
        got.made ? when.words(String(got.made)) : '',
        got.evidence ? `Evidence: ${String(got.evidence)}` : '',
        typeof got.confidence === 'number' ? `Confidence ${String(got.confidence)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    )}</p>
    ${
      got.asked === null || got.asked === undefined || String(got.asked) === ''
        ? ''
        : `<p class="bcpmeta bcprose">Asked for: ${esc(String(got.asked))}</p>`
    }
    <div class="bcprose bcoutputbody">
      ${
        paras.length === 0
          ? `<p class="bcpmeta">This one has no body. The office recorded the work and not
              the words, which is a real state rather than a failure to load.</p>`
          : paras.map((x) => `<p>${esc(x)}</p>`).join('')
      }
    </div>
    ${
      sources.length === 0
        ? `<p class="bcpmeta">Nothing cited.</p>`
        : `<p class="bcpmeta">Read: ${esc(sources.map((x) => String(x)).join(', '))}</p>`
    }`
}

/*
  A requested import that is still waiting. When the office has tried to fetch the file and could not, it says why and
  offers the press again (the same press: it starts a new fetch only when none is running). When nothing has failed it
  says the office is fetching, rather than the older "the next time it reads this file", which promised a read nothing
  had scheduled. Plain words in this comment: it sits near template literals.
*/
const importWaiting = (d) =>
  d.import_error
    ? `<span class="bcpmeta bcximporterr">The office could not fetch this file yet: ${esc(d.import_error)}</span>
       ${button('Try the import again', { 'data-bc-docimport': esc(String(d.id)) })}`
    : '<span class="bcpmeta">Import requested. The office is fetching the file and will keep a copy in Team HQ when it arrives.</span>'

const documentRecord = (p) => {
  const want = state().bcDoc
  const docs = bcMini.docsOf(p)
  /*
    THE REFERENCE IS THE FILE, AND TWO DOCUMENTS CAN POINT AT ONE FILE.

    Matching on the reference alone opened the FIRST document holding that
    file, so pressing the second one showed somebody else's record - the same
    title, the same buttons, quietly the wrong row. The press carries the title
    it was drawn with, so both are asked for first and the reference alone is
    only the fallback, for a press that arrived without one.
  */
  const both = docs.find(
    (x) => bcMini.docRef(x) === want?.ref && (x.title ?? '') === (want?.title ?? ''),
  )
  const d =
    both ??
    docs.find((x) => (x.title ?? '') === (want?.title ?? '') && (want?.title ?? '') !== '') ??
    docs.find((x) => bcMini.docRef(x) === want?.ref) ??
    null
  if (d === null) {
    return `${crumbFor(p, 'documents')}
      ${errorState(
        'That file is not on this project any more. It may have been removed, or the gallery may have moved on.',
        button('Back to Docs & Files', { 'data-bc-go': at(`/p/${p.slug}/documents`) }),
      )}`
  }
  const e = docsrc.enrich(d)
  const isAudio = bcMini.isAudioDoc(d)
  const file = d.file ?? ''
  const ref = bcMini.docRef(d)
  const when_ = (iso) => (iso === null || iso === undefined || iso === '' ? '' : when.precise(iso))
  const facts = [
    ['What it is', bcMini.kindWordOf(d)],
    ['Source', docsrc.nameOfSource(e.src)],
    ['Size', d.size ?? ''],
    ['Where it came from', d.origin ?? ''],
    ['Added', when_(d.uploaded ?? d.added) || (d.when ?? '')],
    ['Modified', when_(e.modified)],
    ['Written', when_(d.created)],
    ['Version', d.pending_version ? (docsrc.versionLabel(d)?.text ?? '') : d.version_count > 1 ? `${String(d.current_version ?? d.version_count)} of ${String(d.version_count)}` : ''],
    ['Also held in', (e.alsoIn ?? []).map(docsrc.nameOfSource).join(', ')],
    ['In Team HQ', e.src === 'drive' || e.src === 'notebook' || e.src === 'notion' || e.src === 'web' ? (d.imported === true ? 'A durable copy is kept' : 'Read from the source; no copy kept') : ''],
  ].filter(([, v]) => v !== '' && v !== undefined)
  const sourceHref = docsrc.sourceUrl(e)
  const canImport =
    String(d.id ?? '') !== '' &&
    (d.fromOffice === true ? d.import_available === true && d.import_state !== 'imported' : ['drive', 'notebook', 'notion', 'web'].includes(e.src) && d.imported !== true)
  const importPending = d.import_state === 'pending'
  /*
    READ ON DEMAND, OR IMPORTED. An external document Team HQ holds no file of is read from its source when this opens
    (the gateway decides what that means for the format); an imported one is Team HQ's own copy. Neither is the other,
    and the line under the title says which, quietly, so a person is never left guessing whether a copy exists.
  */
  const onDemand =
    d.fromOffice === true &&
    d.imported !== true &&
    d.hasFile !== true &&
    String(d.id ?? '') !== '' &&
    ['drive', 'notebook', 'notion', 'web'].includes(e.src)
  const sourceName = docsrc.nameOfSource(e.src)
  const provenanceLine =
    d.imported === true && d.fromOffice === true
      ? '<p class="bcpvline" data-bc-pvline="imported">Imported copy · kept in Team HQ, whatever happens to the original</p>'
      : onDemand
        ? `<p class="bcpvline" data-bc-pvline="ondemand">${esc(e.src === 'drive' ? 'Read from Google Drive on demand' : `Text indexed from ${sourceName}`)} · not copied to Team HQ</p>`
        : ''
  return `<div class="bcrecordhead">
      <h1>${esc(d.title ?? 'Document')}</h1>
      <span class="bcactions">
        ${sourceHref === '' ? '' : `<a class="bcbtn bcbtn--outline" href="${esc(sourceHref)}" target="_blank" rel="noopener" data-bc-opensource>Open source</a>`}
        ${canImport ? (importPending ? importWaiting(d) : button('Import to Team HQ', { 'data-bc-docimport': esc(String(d.id)) })) : ''}
      </span>
    </div>
    ${provenanceLine}
    <div class="bcdocgrid">
      <div class="bcdocpreview" role="region" tabindex="0" aria-label="${esc(`Preview of ${d.title ?? 'the document'}`)}" data-bc-docpreview="${esc(ref)}" data-bc-docaudio="${isAudio ? '1' : ''}" data-bc-doctitle="${esc(d.title ?? '')}"${
        onDemand && !isAudio
          ? ` data-bc-docmode="ondemand" data-bc-docid="${esc(String(d.id))}" data-bc-docproject="${esc(String(p.slug ?? ''))}" data-bc-docsourcename="${esc(sourceName)}" data-bc-docsourceurl="${esc(sourceHref)}" data-bc-docimportable="${canImport && !importPending ? '1' : ''}"`
          : ''
      }>
        ${
          isAudio && file !== ''
            ? `<div class="bcplayer">
                <audio controls preload="metadata" src="${esc(file)}" data-bc-audio="1"
                  aria-label="${esc(`Play ${d.title ?? 'the recording'}`)}"></audio>
              </div>`
            : '<p class="bcpmeta" data-bc-docpreviewnote>Loading the preview…</p>'
        }
      </div>
      <aside class="bcdocside" aria-label="About this document">
        <h2 class="bcsubhead">Details</h2>
        <dl class="bcfacts">
          ${facts.map(([k, v]) => `<div class="bcfact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
        </dl>
        <div class="bcrow bcdocacts">
          ${!isAudio && file !== '' ? button('Open the file', { 'data-bc-doc-tab': esc(file) }) : ''}
          ${file !== '' ? button('Download', { 'data-bc-doc-save': esc(file), 'data-bc-doc-title': esc(d.title ?? '') }) : ''}
        </div>
        <p class="bcpmeta" data-bc-docsay role="status"></p>
        <div class="bcdocversions" data-bc-docversions="${esc(String(d.id ?? ''))}" hidden></div>
        ${e.src === 'generated' && String(d.id ?? '') !== '' ? `<div class="bcdocstyle" data-bc-docstyle="${esc(String(d.id))}" data-bc-docproject="${esc(String(p.slug ?? ''))}" hidden></div>` : ''}
      </aside>
    </div>`
}

/*
  PROJECT SETTINGS, INSIDE THE EXPERIENCE.

  `projectSettings.section` returns the whole pane including its own tab strip;
  this adds the record head the rest of the experience uses and nothing else,
  because anything added here would be the IA expanding, which Grant ruled out
  for this pass.
*/
const settingsSurface = (p) => {
  ctx?.needProjectSettings?.(p)
  return `${crumbFor(p, 'settings')}
    <div class="bcrecordhead">
      <h1>Project Settings</h1>
    </div>
    <p class="bcpmeta bcprose bcgap-l">
      Settings for ${esc(p.name)} alone. What the whole office does — the team,
      its behaviour, what it is connected to — is under Settings for everything.
    </p>
    <div class="bcsetframe">${ctx?.projectSettingsBody?.(p) ?? ''}</div>`
}

/* ======================================================================== *
 * WAITING FOR YOU, RESOLVED RATHER THAN DISPLAYED  (§18)
 * ======================================================================== *
 *
 * §18: "Items marked Waiting for you currently tell Grant something needs him
 * without providing a useful resolution path... Do not merely display status.
 * Trace the canonical waiting/decision/approval architecture. Use the real
 * underlying state."
 *
 * THE CANONICAL ARCHITECTURE WAS ALREADY THERE, WHICH IS THE POINT. A blocker
 * is a row in `public.blockers`; `app.studio_waiting` already carries what was
 * asked, why it is needed, who asked, what delay costs, the deadline, whether
 * the work can continue without an answer, and -- the part that makes this a
 * decision rather than a message -- `approval_options`, the answers the
 * handler that raised it can actually act on. `hq_answer_blocker` is a gateway
 * action and has been since 0289.
 *
 * So nothing here invents a parallel approval system. What was missing was the
 * screen: the team surface listed each item as three lines of grey text with a
 * pill reading "Waiting for you" and no way to answer, which is precisely the
 * "merely display status" the section forbids.
 *
 * WHY THE OPTIONS ARE BUTTONS AND NOT A TEXT BOX WHEN THEY EXIST. The RPC
 * refuses an answer the blocker did not offer, deliberately: an answer the
 * handler cannot act on would resolve the row and strand the job, and the
 * interface would report success. Offering a field beside the buttons would be
 * offering something the office is going to refuse -- the dead-control shape
 * this repository keeps paying for. A blocker with no options wants words, and
 * gets a field.
 */

/** The one this person is looking at, or undefined. */
const waitingOf = (p) => {
  const id = state().bcWaiting
  if (id === null || id === undefined) return undefined
  return (p.waiting ?? []).find((w) => String(w.id) === String(id))
}

const waitingRecord = (p) => {
  const w = waitingOf(p)
  /*
    A blocker that is no longer in the list has been answered -- by this person
    somewhere else, by a colleague, or by the job withdrawing it. That is the
    good ending, not a crash, and the honest screen says so rather than
    rendering an empty record.
  */
  if (w === undefined) {
    return `${crumbFor(p, 'team')}
      <div class="bcrecordhead"><h1>Waiting for you</h1></div>
      ${empty(
        {
          title: 'This one is settled',
          body: 'It has been answered or withdrawn, so there is nothing left to decide here.',
        },
        button('Back to the team', { 'data-bc-waitclose': '1', kind: 'primary' }),
      )}`
  }

  const facts = [
    ['Asked by', bcMini.named(w.who) || 'The team'],
    ['Asked', typeof w.at === 'string' ? when.words(w.at) : (w.when ?? '')],
    ['Needed by', typeof w.due === 'string' ? when.words(w.due) : 'No deadline given'],
    [
      'Meanwhile',
      w.blocks === true
        ? 'The work has stopped until you answer'
        : 'The team is carrying on without this',
    ],
  ].filter(([, v]) => String(v ?? '') !== '')

  const options = Array.isArray(w.options) ? w.options.filter((o) => String(o ?? '') !== '') : []

  return `${breadcrumb([
    { name: p.name, to: at(`/p/${p.slug}`) },
    { name: 'Agentic Team', to: at(`/p/${p.slug}/team`) },
    { name: w.what },
  ])}
    <!--
      A SENTENCE, NOT A TITLE. Every other record here is headed by a name: a
      person, a document, a task. A blocker is headed by its requested action,
      which is free text the raising agent wrote and which the table allows up
      to two thousand characters of. At the record scale of 800 weight and
      36px, an ordinary one took four lines of a phone and pushed the facts,
      the cost and both answers below the fold -- the modifier gives it the
      scale a sentence wants at every width, rather than making phones a
      special case for something that is wrong on a desktop too.
    -->
    <div class="bcrecordhead bcrecordhead--ask">
      <h1>${esc(w.what)}</h1>
      <span class="bcactions">
        ${w.overdue === true ? status('Overdue', 'blocked') : status('Waiting for you', 'waiting')}
        ${button('Back to the team', { 'data-bc-waitclose': '1' })}
      </span>
    </div>

    ${
      typeof w.why === 'string' && w.why !== ''
        ? `<p class="bcprose bcwaitwhy">${esc(w.why)}</p>`
        : ''
    }
    ${
      typeof w.cost === 'string' && w.cost !== ''
        ? `<p class="bcprose bcwaitcost"><b>If this waits:</b> ${esc(w.cost)}</p>`
        : ''
    }

    <dl class="bcwaitfacts">
      ${facts
        .map(
          ([k, v]) => `<div class="bcwaitfact">
            <dt>${esc(k)}</dt>
            <dd>${esc(String(v))}</dd>
          </div>`,
        )
        .join('')}
    </dl>

    <h2 class="bcsubhead">Your answer</h2>
    <form class="bcwaitanswer" data-bc-waitform="${esc(String(w.id))}">
      ${
        /*
          BUTTONS, AND NO TEXT FIELD BESIDE THEM.

          A first draft offered a textarea when a blocker named no options,
          because `app.studio_waiting` says in its own comment that "empty
          means it wants words rather than a button, and the page draws a
          field". The table disagrees: `blockers_has_an_option` is a CHECK that
          every blocker carries at least one approval option, so the empty case
          cannot exist and the field could never have been used -- a control
          nothing can reach, which is a claim that a control exists.

          The comment is now the only thing wrong, and this is not the file to
          fix it in. What is left is the branch a person can actually be shown:
          a blocker whose options went missing is reported as something this
          screen cannot answer, rather than being given a field the office
          would refuse.
        */
        options.length > 0
          ? `<p class="bcpmeta bcprose">Pick one. The team acts on it as soon as you do.</p>
             <div class="bcwaitoptions">
               ${options
                 .map((o, i) =>
                   button(o, {
                     'data-bc-waitanswer': esc(String(o)),
                     kind: i === 0 ? 'primary' : 'plain',
                   }),
                 )
                 .join('')}
             </div>`
          : `<p class="bcpmeta bcprose">This one arrived without the answers it accepts, so it cannot be settled here. Ask the team in chat and they can withdraw it.</p>`
      }
      <span class="bcsaidhere" data-bc-waitsaid role="status" aria-live="polite"></span>
    </form>`
}

const SURFACE = {
  overview,
  tasks: (p) => (state().bcTask === null || state().bcTask === undefined ? tasksSurface(p) : taskRecord(p)),
  /*
    Three states of one surface. An output record and a waiting record are both
    "the team page, looking at one thing", which is why they are states here
    rather than routes: the breadcrumb goes back to the team page and the rail
    keeps saying Agentic Team, which is where the person still is.
  */
  team: (p) => {
    if (state().bcWaiting !== null && state().bcWaiting !== undefined) return waitingRecord(p)
    return state().bcOutput === null || state().bcOutput === undefined
      ? teamSurface(p)
      : outputRecord(p)
  },
  documents: documentsSurface,
  contacts: contactsSurface,
  sources: sourcesSurface,
  // The ledger's timeline when it is on for this office and answers; otherwise the older page, whole (see activity.js).
  activity: (p) =>
    activity.render(p.slug, () => activitySurface(p), () => `${crumbFor(p, 'activity')}
    <div class="bcrecordhead"><h1>${esc(toolById('activity')?.name ?? 'Activity')}</h1></div>
    <p class="bcpmeta bcprose bcgap-l">
      What has happened on this project, most recent first. Each line says who did it and, where it is known, which door it came through.
    </p>`),
  board: boardSurface,
  schedule: scheduleSurface,
  chat: chatSurface,
  document: documentRecord,
  output: outputRecord,
  settings: settingsSurface,
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
  /*
    ONE ROW, TWO PLACES (#450). The Today list shows what is due; a repeating reminder that was just ticked has its next time days
    away and is in no list this page draws, so the Stop repeating press could not be reached until it fell due again. Open series
    are therefore ALSO listed below, from the same gateway section, without a tick (ticking a future time is not the ask).
  */
  const stopSeries = (t) =>
    t.repeats?.series === true && String(t.id ?? '') !== ''
      ? button('Stop repeating', {
          kind: 'danger',
          'data-bc-mystopseries': String(t.id),
          'aria-label': `Stop repeating: ${t.title}`,
        })
      : '<span></span>'
  const myMeta = (t) =>
    esc([bcMini.dueWords(t), typeof t.project === 'string' ? t.project : (t.project?.name ?? ''), t.repeats?.series === true ? 'repeats' : ''].filter(Boolean).join(' · '))
  const nextWords = (t) => {
    const at = new Date(t.remind_at ?? '')
    const when = Number.isNaN(at.getTime())
      ? ''
      : at.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    return esc(
      [when === '' ? '' : `next ${when}`, t.repeats?.every ? `every ${String(t.repeats.every)}` : '', typeof t.project === 'string' ? t.project : (t.project?.name ?? '')]
        .filter(Boolean)
        .join(' · '),
    )
  }
  const seriesBelow = (() => {
    if (!signedIn || trouble) return []
    const all = ctx.myRepeating?.()
    if (!Array.isArray(all)) return []
    const shown = new Set((Array.isArray(mine) ? mine : []).map((t) => String(t.id ?? '')))
    return all.filter((t) => !shown.has(String(t.id ?? '')))
  })()
  return `<h1 class="bcsectiontitle">My Tasks</h1>
    <p class="bcpmeta bcprose bcgap-l">
      Your own list. Separate from what any project has committed to, and from
      what the team is running.
    </p>
    ${
      !signedIn
        ? empty({
            title: 'Sign in to see your list',
            body: 'My Tasks is your own list, kept by the office and separate from any project’s to-dos. Sign in above and it appears here.',
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
                    <span class="bcitemmeta">${myMeta(t)}</span>
                  </div>
                  <!--
                    STOPPING A RECURRING REMINDER IS ITS OWN PRESS (owner decision, 7 October 2026). Ticking a series off
                    completes that time only, so the series needs a way to end that is not the tick. Drawn for a series
                    only, and only where the row has an id to write to. No backticks in this comment. Template literal.
                  -->
                  ${stopSeries(t)}
                </div>`,
              )
              .join('')}</div>`
    }
    ${
      seriesBelow.length === 0
        ? ''
        : `<h2 class="bcsubhead">Repeating reminders</h2>
          <p class="bcpmeta bcprose bcgap-l">These come back on their own. Stop one here without waiting for it to fall due.</p>
          <div class="bclist" data-bc-series-list>${seriesBelow
            .map(
              (t) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(t.title)}</span>
                  <span class="bcitemmeta">${nextWords(t)}</span>
                </div>
                ${stopSeries(t)}
              </div>`,
            )
            .join('')}</div>`
    }`
}

const allActivity = () => {
  /*
    Newest first ACROSS projects. This was each project's list one after the
    other, so the page read as "everything in the first project, then
    everything in the second" and a person could not tell what had just
    happened. Items with no instant keep their place after the dated ones.
  */
  /*
    THE LEDGER, WHEN IT IS ON AND ANSWERED (docs/activity-ledger/). Its rows already span the whole office, newest first, with the
    project named in each, so they replace the per-project lists wholesale rather than being merged into them: merging two accounts
    of the same events is how one fact appears twice. `ctx.ledgerActivity()` is null when it is switched off, unanswered or empty,
    which leaves exactly the behaviour below. A ledger sentence already carries its actor ("You said yes: ..."), so the name goes in
    front only for a specialist or an outside worker (`line.byline`).
  */
  const fromLedger = ctx?.ledgerActivity?.() ?? null
  const rows = (fromLedger !== null
    ? fromLedger.slice(0, 80)
    : PROJECTS.flatMap((p) => (p.activity ?? []).map((a) => ({ ...a, project: p.name })))
        .map((a, i) => ({ a, i, t: a.at ? Date.parse(a.at) : Number.NaN }))
        .sort((x, y) => (Number.isNaN(y.t) ? -1 : 0) - (Number.isNaN(x.t) ? -1 : 0) || (y.t || 0) - (x.t || 0) || x.i - y.i)
        .map((x) => x.a)
        .slice(0, 80))
  const titleOf = (a) =>
    a.line !== undefined
      ? `${a.line.byline === '' ? '' : `${a.line.byline}: `}${a.line.sentence}`.trim()
      : `${whoName(a.who) || 'The team'} ${a.verb ?? 'changed'} ${a.what ?? ''}`.trim()
  return `<h1 class="bcsectiontitle">Activity</h1>
    ${
      rows.length === 0
        ? empty({ title: 'Nothing yet', body: 'What happens across your projects is listed here.' })
        : `<div class="bclist">${rows
            .map(
              (a) => `<div class="bcitem bcitem--log">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(titleOf(a))}</span>
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
  THE MATCH, MARKED. Escaped FIRST and the query matched against the escaped
  text, so a query can only ever wrap text in <mark> - never add markup of
  its own. Case-insensitive, every occurrence.
*/
const marked = (text, query) => {
  const safe = esc(text)
  const needle = esc(String(query ?? '').trim())
  if (needle === '') return safe
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return safe.replace(re, (m) => `<mark class="bcmark">${m}</mark>`)
}

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

const KINDS = ['Everything', 'Tasks', 'Documents', 'People', 'Sources', 'Outputs', 'Projects', ...finder.KINDS]

const searchHits = (q, kind, only) => {
  const needle = q.trim().toLowerCase()
  if (needle === '') return []
  const hits = []
  const want = (k) => kind === 'Everything' || kind === k
  const match = (...bits) => bits.filter(Boolean).join(' ').toLowerCase().includes(needle)

  for (const p of PROJECTS) {
    if (only !== null && p.slug !== only) continue
    if (want('Projects') && p.slug !== 'unnamed' && match(p.name, p.purpose)) {
      hits.push({ kind: 'Project', project: p.name, title: p.name, excerpt: p.purpose ?? '', who: '', when: '', to: at(`/p/${p.slug}`) })
    }
    if (want('Tasks')) {
      for (const t of p.tasks ?? []) {
        if (!match(t.title, t.note, t.who)) continue
        hits.push({ kind: 'Task', project: p.name, open: { type: 'task', key: todos.keyOf(t) }, title: t.title, excerpt: t.note ?? '', who: whoName(t.who), when: bcMini.dueWords(t), to: at(`/p/${p.slug}/tasks`) })
      }
    }
    if (want('Documents')) {
      for (const d of bcMini.docsOf(p)) {
        if (!match(d.title, d.kind, d.origin, docsrc.nameOfSource(d.src))) continue
        hits.push({ kind: d.src === 'web' ? 'Web page' : 'Document', project: p.name, open: { type: 'doc', ref: bcMini.docRef(d), title: d.title }, title: d.title, excerpt: [d.kind, d.size].filter(Boolean).join(' · '), who: d.origin ?? '', when: d.when ?? '', to: at(`/p/${p.slug}/documents`) })
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
        hits.push({ kind: 'Output', project: p.name, title: r.output.title, excerpt: r.ask ?? '', who: whoName(r.who), when: r.delivered ?? '', to: at(`/p/${p.slug}/team`) })
      }
    }
  }

  if (want('People')) {
    for (const c of ctx.crew ?? []) {
      if (!match(c.name, c.role, (c.expertise ?? []).join(' '))) continue
      hits.push({ kind: 'Specialist', project: '', title: c.name, excerpt: c.role ?? '', who: '', when: '', to: at('/') })
    }
  }
  hits.push(
    ...finder.extra(q, kind, only, {
      projects: () => PROJECTS,
      knownEvents: (slug) => cal.knownEvents(slug),
      chatFor: (slug) => ctx?.chatFor?.(slug) ?? [],
    }),
  )
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
        ${listed().map(
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
                    <span class="bcitemtitle">${marked(h.title, q)}</span>
                    ${h.excerpt ? `<span class="bcitemmeta">${marked(h.excerpt, q)}</span>` : ''}
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

/*
  THE SURFACE BEHIND AN OPEN DIALOG IS INERT.

  THE DEFECT THIS FIXES, measured rather than guessed: with a contact open
  full screen there were EIGHT contact rows in the document - four in the
  dialog and four on the page behind it, because the surface goes on rendering
  its own list underneath. So half the time a press landed on the copy behind,
  where the backdrop swallowed it; and the page behind was what scrolled,
  which is why scrolling a long contact appeared to jump back to the top - the
  dialog had not moved at all, the page had.

  `inert` is the whole fix and it is one word: the subtree stops taking
  pointer events, stops being focusable, and leaves the accessibility tree, so
  a duplicate row behind a dialog can no longer be pressed, tabbed to or read
  out. The scroll lock is the other half - with the page unable to scroll, the
  wheel goes to the dialog, which is where the content the person is reading
  actually is.
*/
const behind = (markup) => {
  /*
    ONLY WHILE A DIALOG IS ACTUALLY OPEN.

    The first version marked this inert unconditionally, which made the WHOLE
    PAGE unclickable whenever no dialog was up - every control on every project
    surface, reported by the contacts suite within seconds as a press that
    could not land. `inert` is exactly as absolute as it sounds.
  */
  const open = state().bcExpanded
  const shut = open === null || open === undefined || open === ''
  return shut ? markup : `<div class="bcunder" inert>${markup}</div>`
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
      <button type="button" class="bcexpx" data-bc-expclose="1" aria-label="Close" title="Close">
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
  if (s.view === 'lately') return activity.render('', () => allActivity(), () => '<h1 class="bcsectiontitle">Activity</h1>')
  if (s.view === 'project') {
    const p = project()
    if (p === null || p === undefined) {
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
      if (pick !== 'grid') return `${behind(compose.COMPOSITIONS[pick](p))}${expandedOverlay(p)}`
    }
    /*
      THE OVERLAY BELONGS TO EVERY PROJECT SURFACE, not only to the home.

      It was appended to the composition alone, so `openDocDetail` on the Docs
      and Files surface set the state, the page repainted, and nothing drew:
      four documents "did nothing" when pressed, which is the exact defect
      this run is fixing, arriving through the fix for it. A dialog that only
      exists on one route is a dialog every other route cannot open.
    */
    const render = SURFACE[s.tab] ?? overview
    return `${behind(render(p))}${expandedOverlay(p)}`
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
/*
 * WHAT IS ON SCREEN, WHEN IT IS NOT THE OFFICE.
 *
 * Found by refusing every read with a token in the browser and looking at what
 * came back: four contacts, with names, roles, towns and email addresses, and
 * nothing anywhere saying they were invented. The default studio has said this
 * since #119 and this experience never had; a signed-in person whose office had
 * gone down would have read the prototype as their own records.
 *
 * ONE STRIP IN THE FRAME rather than a notice per surface: every surface in
 * here draws from the same arrays, so the question "is this real" is answered
 * once or it will be answered inconsistently. The retry is drawn only where
 * retrying can help - there is nothing to try with on the prototype state, and
 * a control that cannot do its job is a false affordance the gate would catch.
 */
/*
  SIGNED IN AND STILL CONNECTING IS NOT "PROTOTYPE DATA".

  With a credential in the browser and the first answer not back yet,
  `source.state` is still 'prototype' (nothing has been asked yet), so a
  person on a slow connection was shown the invented projects under
  "Prototype data - sign in to see your office", with a sign-in form - while
  their own office was simply loading. This experience can tell the two
  apart, because canWrite() knows a credential is present: it says it is
  connecting and draws a neutral outline of the page until the answer lands.
*/
const connecting = () => source.live !== true && source.state === 'prototype' && canWrite() === true

const connectingOutline = () => `<div class="bcconnecting" aria-busy="true" aria-live="polite">
    <span class="bcvh">Loading your office</span>
    <div class="bcconnectingbar">
      <button type="button" class="bcplusbtn" disabled aria-label="Arrange this page: available once your office has loaded" title="Arranging is available once your office has loaded">+</button>
      <span class="bcconnectingnote t-meta">Arranging the page becomes available once your modules have loaded.</span>
    </div>
    <div class="bcskel bcskel--head"></div>
    <div class="bcskelgrid">${'<div class="bcskel bcskel--pane"></div>'.repeat(6)}</div>
  </div>`

const notLive = () => {
  /*
    OFFLINE FIRST, whatever the office last said. Nothing listened for the
    browser losing its connection, so a page open when the network dropped
    kept looking current until some later read failed - and a change made in
    that window looked saved. The browser knows at once; so does this strip.
  */
  if (globalThis.navigator?.onLine === false) {
    return `<div class="bcnotlive bcnotlive--bad" role="status">
      <b>You're offline</b>
      <span>What you see was current when the connection dropped. Changes can't reach the office until it's back.</span>
    </div>`
  }
  /*
    A restore the office refused because the browser is no longer signed in (#471). It is said here, whatever the state,
    because the sign-out that caused it has already redrawn the project menu where a restore sentence would have been.
  */
  const refused = compose.restoreRefused()
  if (refused !== '') {
    return `<div class="bcnotlive bcnotlive--bad" role="alert" data-bc-restore-refused>
      <b>Your archive was not restored</b>
      <span>${esc(refused)}</span>
    </div>`
  }
  if (source.live === true) return ''
  /*
    While a signed-in person's office is still answering, say so. This sits before the prototype check: the office has not
    answered yet, so the state is still 'prototype', and the strip used to be skipped exactly when it was needed (23 October
    2026: the page showed "Sign in" beside the email with grey placeholders, and no sentence said the office was loading).
  */
  if (connecting()) {
    return `<div class="bcnotlive bcnotlive--wait" role="status">
      <span class="bcspin" aria-hidden="true"></span>
      <b>Connecting to your office</b>
      <span>Your projects appear here the moment it answers. The menus and the team chat work meanwhile.</span>
    </div>`
  }
  /* The prototype and the Sample are played as ordinary projects: no banner says they are not the real office (Grant, 14 Oct 2026). */
  if (source.state === 'prototype') return ''
  const s = SOURCE_STATE[source.state] ?? SOURCE_STATE.prototype
  const canRetry = source.state === 'unreachable' || source.state === 'stale'
  /*
    Offered when there is no token and when one was refused - the two states a
    person can actually do something about. Not on "the office answered once
    and has stopped", which is an outage and signing in again cannot help.
  */
  const signedOut = source.state === 'prototype' || source.state === 'refused'
  return `<div class="bcnotlive${s.tone === '' ? '' : ' bcnotlive--bad'}" role="status">
    <b>${esc(s.label)}</b>
    <span>${esc(s.say)}</span>
    ${canRetry && typeof source.why === 'string' && source.why !== '' ? `<span data-bc-why>${esc(source.why)}</span>` : ''}
    ${canRetry ? button('Try again', { 'data-bc-retry-office': '1' }) : ''}
    <!--
      SIGNING IN, and there is no office token in it anywhere.

      Grant, 24 September: "He does not want an office-token interaction in the
      normal user experience AT ALL... If an internal credential/token is
      required for secure communication with the office, that is an
      IMPLEMENTATION DETAIL."

      So this is an ordinary login. An address, a link in the mail, and the
      session that comes back belongs to the person rather than to the office.
      Nothing here is pasted, nothing is copied, nothing is approved anywhere
      else, and the word token does not appear.

      The office answers the same way for every address, so the sentence after
      pressing never says whether anybody by that name is known here.

      No backticks anywhere in this comment: it lives inside a template literal
      and one here ends the string.
    -->
    <form class="bcsignin" data-bc-signinform${signedOut ? '' : ' hidden'}>
      <label class="bcvh" for="bc-email">Your email address</label>
      <input class="bcinput bcsignininput" id="bc-email" type="email"
        name="email" autocomplete="email" spellcheck="false"
        placeholder="you@example.com">
      ${button('Email me a link', { kind: 'primary', 'data-bc-signin': '1' })}
      <span class="bcsigninsaid" data-bc-signin-said role="status"></span>
    </form>
  </div>`
}

export const html = () => {
  // Arriving, and setting up the office, are their own screens with none of the shell's navigation (bc/account.js).
  const screen = account.mode()
  if (screen === 'entry') return account.entry()
  if (screen === 'setup') return account.setup()
  return shell()
}

const shell = () =>
  `<a class="bcskip" href="#bcmain">Skip to main content</a>
  ${account.sampleBar()}
  ${(menu.sync(currentPath()), topRow())}
  ${notLive()}
  <main class="bcmain" id="bcmain" tabindex="-1">${connecting() ? connectingOutline() : body()}</main>
  ${tray()}`

/*
  The dock's voice-note control: the same button the Chat page's composer
  draws (same attribute, same states), icon-only because the dock's row is
  380px and already holds the text and Send.
*/
export const dockDictateButton = (supported, title) => `<button type="button" class="bcdictate" data-dock-dictate
    aria-pressed="false" aria-label="Dictate a message" title="${esc(title)}"${supported ? '' : ' disabled'}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"></path>
      <path d="M12 18v3"></path>
    </svg>
    <span class="bcdictatedot" aria-hidden="true"></span>
  </button>`
