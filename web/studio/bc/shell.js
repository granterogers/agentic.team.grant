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
import { breadcrumb, button, empty, errorState, esc, input, skeleton, status, tool } from './parts.js'

/*
  What app.js hands us at boot. Set once; never reassigned, so a stale
  reference cannot outlive a render.
*/
let ctx = null
export const mount = (c) => {
  ctx = c
}

const state = () => ctx.state
const go = (path) => ctx.go(path)
const repaint = () => ctx.render()

/** Every address in this experience carries the prefix. One place to change. */
const at = (p = '') => `/basecamp${p}`

const project = () => PROJECTS.find((p) => p.slug === state().project) ?? PROJECTS[0]

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
  { id: 'tasks', name: 'Tasks', own: true },
  { id: 'team', name: 'Agentic Team', own: true },
  { id: 'documents', name: 'Documents & Assets', own: true },
  { id: 'activity', name: 'Activity', own: true },
  { id: 'contacts', name: 'Contacts', own: true },
  { id: 'sources', name: 'Sources & Integrations', own: true },
  { id: 'board', name: 'Work Board', own: false },
  { id: 'chat', name: 'Project Chat', own: false },
  { id: 'jobs', name: 'Active jobs', own: false },
  { id: 'outputs', name: 'Outputs', own: false },
  { id: 'settings', name: 'Project Settings', own: false },
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
  return `<header class="bctop">
    <div class="bcleft">
      <button type="button" class="bcbtn" data-bc-go="${at('/')}">Home</button>
    </div>
    <button type="button" class="bcjump" data-bc-jump
      aria-haspopup="dialog" aria-label="Jump to a project, tool or record">
      <span>Jump to…</span><kbd>Shift J</kbd>
    </button>
    <div class="bcright">
      <button type="button" class="bcbtn" data-bc-attention
        aria-label="${esc(
          waiting === 0 ? 'Attention: nothing is waiting' : `Attention: ${waiting} waiting on you`,
        )}">
        Attention${waiting === 0 ? '' : ` <span class="bcstatus bcstatus--waiting">${waiting}</span>`}
      </button>
    </div>
  </header>`
}

const tray = () =>
  `<nav class="bctray" aria-label="Your things">
    ${trayItems()
      .map(
        (i) =>
          `<button type="button" data-bc-go="${esc(i.to)}"><span aria-hidden="true">${
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
  if (bits.length === 0) return nothing('Nobody is assigned to this project yet.')
  return bits.join('')
}

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
  const owned = TOOLS.filter((t) => t.own)
  const others = TOOLS.filter((t) => !t.own)
  const acts = p.activity ?? []
  const latest = acts[0]
  return `${projectHeader(p, latest)}
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
    <section class="bctool" style="margin-top:var(--bc-8)">
      <h2>Everything else on this project</h2>
      <p class="bcpmeta" style="margin:0 0 var(--bc-2)">
        These open in the current Team HQ. Nothing has moved; this experience
        has not built its own surface for them yet.
      </p>
      <div class="bctray" style="justify-content:flex-start;padding:0">
        ${others
          .map(
            (t) =>
              `<a href="${esc(toolPath(p.slug, t.id))}" data-bc-leave="${esc(
                toolPath(p.slug, t.id),
              )}">${esc(t.name)}</a>`,
          )
          .join('')}
      </div>
    </section>`
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
            ${waiting === 0 ? '' : `<div style="margin:var(--bc-2) 0">${status(waiting === 1 ? '1 thing waiting on you' : `${waiting} things waiting on you`, 'waiting')}</div>`}
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
const tasksSurface = (p) => {
  const all = p.tasks ?? []
  const open = all.filter((t) => t.state !== 'done')
  const done = all.filter((t) => t.state === 'done')
  return `${crumbFor(p, 'tasks')}
    <div class="bcrecordhead">
      <h1>Tasks</h1>
      <span class="bcactions">${button('Add a task', { kind: 'primary', 'data-bc-addtask': '1' })}</span>
    </div>
    <p class="bcpmeta" style="margin:0 0 var(--bc-4)">
      What this project has committed to. Your own list is under My Tasks, and
      what the team is running is under Agentic Team — three different things.
    </p>
    <form class="bcaddform" data-bc-taskform hidden style="display:grid;gap:var(--bc-3);margin-bottom:var(--bc-6);padding:var(--bc-4);border:1px solid var(--bc-border-control);border-radius:var(--bc-r-control)">
      ${input({ id: 'bc-task-title', label: 'What needs doing', name: 'title', autocomplete: 'off' })}
      ${input({ id: 'bc-task-due', label: 'Due date', name: 'due', type: 'date' })}
      ${input({ id: 'bc-task-who', label: 'Assigned to', name: 'who', autocomplete: 'off', hint: 'A team member’s name, or leave it unassigned.' })}
      <div style="display:flex;gap:var(--bc-2)">
        ${button('Add this task', { kind: 'primary', 'data-bc-tasksave': '1' })}
        ${button('Cancel', { 'data-bc-taskcancel': '1' })}
      </div>
    </form>
    ${
      all.length === 0
        ? empty(
            {
              title: 'No tasks yet',
              body: 'Tasks are what this project has committed to doing. Add the first one.',
            },
            button('Add a task', { kind: 'primary', 'data-bc-addtask': '1' }),
          )
        : `<div class="bclist">
            ${open.map((t) => taskRow(t)).join('')}
            ${
              done.length === 0
                ? ''
                : `<details style="margin-top:var(--bc-4)">
                    <summary class="bcmore" style="cursor:pointer">${esc(
                      done.length === 1 ? '1 completed task' : `${done.length} completed tasks`,
                    )}</summary>
                    ${done.map((t) => taskRow(t)).join('')}
                  </details>`
            }
          </div>`
    }`
}

const taskRow = (t) => {
  const isDone = t.state === 'done'
  const id = t.id ?? ''
  return `<div class="bcitem${isDone ? ' bcitem--done' : ''}" data-bc-task="${esc(id)}">
    <input type="checkbox" class="bccheck" ${isDone ? 'checked' : ''}
      ${id === '' ? 'disabled' : ''}
      data-bc-tick="${esc(id)}"
      aria-label="${esc(`${isDone ? 'Completed' : 'Not completed'}: ${t.title}`)}">
    <div class="bcitembody">
      <span class="bcitemtitle">${esc(t.title)}</span>
      <span class="bcitemmeta">${esc(
        [t.who, t.due, t.note].filter((x) => x !== undefined && x !== null && x !== '').join(' · '),
      )}</span>
      ${t.blocked ? `<span class="bcitemmeta">${status('Blocked', 'blocked')} ${esc(t.blocked)}</span>` : ''}
    </div>
    <span></span>
  </div>`
}

/** §10.8 Agentic Team, as a project tool. */
const teamSurface = (p) => {
  const crew = ctx.crewFor?.(p.slug) ?? []
  const waiting = p.waiting ?? []
  return `${crumbFor(p, 'team')}
    <div class="bcrecordhead"><h1>Agentic Team</h1></div>
    <h2 style="font:var(--bc-tool-heading);color:var(--bc-section-accent);margin:0 0 var(--bc-2)">Who is on this</h2>
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
    <h2 style="font:var(--bc-tool-heading);color:var(--bc-section-accent);margin:var(--bc-8) 0 var(--bc-2)">Waiting for you</h2>
    ${
      waiting.length === 0
        ? `<p class="bcpmeta">Nothing is waiting on a decision from you.</p>`
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
    <p class="bcmore" style="margin-top:var(--bc-8)">
      Running jobs, stop controls and outputs stay in the current Team HQ:
      <a href="/p/${esc(p.slug)}/jobs" data-bc-leave="/p/${esc(p.slug)}/jobs">Active jobs</a> ·
      <a href="/p/${esc(p.slug)}/outputs" data-bc-leave="/p/${esc(p.slug)}/outputs">Outputs</a>
    </p>`
}

const documentsSurface = (p) => {
  const docs = p.documents ?? []
  return `${crumbFor(p, 'documents')}
    <div class="bcrecordhead"><h1>Documents &amp; Assets</h1></div>
    ${
      docs.length === 0
        ? empty({
            title: 'Nothing filed yet',
            body: 'Documents the team writes, files you upload and anything imported from a connected source all land here.',
          })
        : `<div class="bclist">${docs
            .map(
              (d) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(d.title)}</span>
                  <span class="bcitemmeta">${esc(
                    [d.kind, d.origin, d.size, d.when].filter(Boolean).join(' · '),
                  )}</span>
                </div>
                <span></span>
              </div>`,
            )
            .join('')}</div>`
    }`
}

const contactsSurface = (p) => {
  const cs = p.contacts ?? []
  return `${crumbFor(p, 'contacts')}
    <div class="bcrecordhead"><h1>Contacts</h1></div>
    ${
      cs.length === 0
        ? empty({ title: 'No people recorded', body: 'People connected to this project appear here.' })
        : `<div class="bclist">${cs
            .map(
              (c) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(c.name)}</span>
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

const sourcesSurface = (p) => {
  const ss = p.sources ?? []
  return `${crumbFor(p, 'sources')}
    <div class="bcrecordhead"><h1>Sources &amp; Integrations</h1></div>
    ${
      ss.length === 0
        ? empty({
            title: 'No sources connected',
            body: 'A connected notebook, drive folder or workspace lets the team read what is already written down.',
          })
        : `<div class="bclist">${ss
            .map(
              (s) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(s.name ?? s.title ?? s.kind ?? 'Source')}</span>
                  <span class="bcitemmeta">${esc([s.kind, s.last, s.detail].filter(Boolean).join(' · '))}</span>
                </div>
                <span>${s.trouble ? status('Needs attention', 'blocked') : status('Connected', 'done')}</span>
              </div>`,
            )
            .join('')}</div>`
    }`
}

const activitySurface = (p) => {
  const acts = p.activity ?? []
  return `${crumbFor(p, 'activity')}
    <div class="bcrecordhead"><h1>Activity</h1></div>
    ${
      acts.length === 0
        ? empty({ title: 'Nothing yet', body: 'What people and the team do on this project is listed here.' })
        : `<div class="bclist">${acts
            .map(
              (a) => `<div class="bcitem">
                <span></span>
                <div class="bcitembody">
                  <span class="bcitemtitle">${esc(
                    `${a.who ?? 'The team'} ${a.verb ?? 'changed'} ${a.what ?? ''}`.trim(),
                  )}</span>
                  <span class="bcitemmeta">${esc(a.when ?? '')}</span>
                </div>
                <span></span>
              </div>`,
            )
            .join('')}</div>`
    }`
}

const SURFACE = {
  overview,
  tasks: tasksSurface,
  team: teamSurface,
  documents: documentsSurface,
  contacts: contactsSurface,
  sources: sourcesSurface,
  activity: activitySurface,
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
  const mine = ctx.myTasks?.() ?? null
  /*
    A READ THAT FAILED IS NOT AN EMPTY LIST.

    The default studio has already shipped the other version of this: a failed
    fetch rendered as "Nothing due today" under a tab reading "Today 3". You
    may say you could not look; you may not say there is nothing there.
  */
  const trouble = ctx.myTasksTrouble?.() === true
  return `<h1 class="bcsectiontitle">My Tasks</h1>
    <p class="bcpmeta" style="margin:0 0 var(--bc-4)">
      Your own list. Separate from what any project has committed to, and from
      what the team is running.
    </p>
    ${
      trouble
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
 * Body selection
 * ======================================================================== */

const body = () => {
  const s = state()
  if (s.view === 'tasks') return myTasks()
  if (s.view === 'lately') return allActivity()
  if (s.view === 'project') {
    const p = project()
    if (p === undefined) {
      return errorState('That project could not be found.', button('Back to your projects', { 'data-bc-go': at('/') }))
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
