/*
  Tool-specific miniatures for the experimental Basecamp-inspired Team HQ.

  WHY THIS FILE EXISTS. The reference slice rendered all six tool previews
  through one primitive — `row(title, meta, extra)` — so the six tiles on a
  project home were the same tile six times. Every tile was individually
  well-formed, which is why four capture passes never found it: the defect was
  that they were interchangeable. §20 of the redesign records that as a fact
  about the source rather than an impression.

  A miniature is a small, USEFUL version of its tool. To-dos look like lists
  with checkboxes; a card table looks like columns; a calendar looks like
  dates; documents look like documents; chat looks like speech; activity looks
  like a timeline. The content is the affordance — you read the project here,
  you do not read a menu that promises the project is somewhere else.

  WHAT IS REAL. Every field below comes from a reader that already exists:

    app.studio_tasks   state_raw, due_on, starts_on, priority, milestone,
                       parent, mine, labels, who, blocked   (0222, 0530)
    app.studio_modules id, n, name, state, docs, tasks      (0286)
    app.studio_activity / project story                      (0221)
    conversation_history (project-scoped)                    (gateway)

  So PROJECT -> LIST -> TASK needs no new backend contract: a module is a
  milestone task and a task names its parent. That was true since 0171 and the
  first slice did not look for it.

  THE ONE GENUINE GAP, stated on the surface rather than filled in: there is
  no events table. The office has dated WORK and no diary, so the calendar
  miniature says it is showing scheduled work.

  A NOTE ON COMMENTS. Every function here returns a template literal, and a
  backtick inside a comment inside a template literal terminates the string
  and makes the module unparseable. Plain words only inside a returned
  template.
*/

import * as contacts from './contacts.js'
import * as notes from './notestore.js'
import { MARKS } from '../logos/marks.js'
import * as when from '../when.js'
import { prose } from '../prose.js'
import * as todos from './todos.js'
import * as docorder from './docorder.js'
import { esc, status } from './parts.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

/* ======================================================================== *
 * People
 *
 * NO FACES ON THE PROJECT HOME (project home v2). Grant: *"Do not display
 * pictures or avatars of team members throughout the project homepage... Team
 * imagery belongs only where it is actually relevant to interaction with the
 * team."*
 *
 * `face()` stays, and is used where that is true - the chat, where a bubble
 * without a face is a wall of text, and nowhere else. A to-do row says who by
 * NAME, which is what a person reads anyway; a monogram beside it was decoration
 * that made eight rows look like a contact list.
 * ======================================================================== */

/**
 * A face, with a monogram behind it.
 *
 * The avatars live in Supabase storage. A face that fails to load must not
 * become a broken-image glyph beside a colleague's name, so the initial is
 * drawn underneath and the image simply covers it when it arrives. This is
 * also what makes a capture in a sandbox with no egress honest rather than
 * embarrassing.
 */
export const face = (person, size = 'sm') => {
  const name = person?.name ?? person?.slug ?? '?'
  const initial = String(name).trim().charAt(0).toUpperCase() || '?'
  const img =
    typeof person?.face === 'string' && person.face !== ''
      ? `<img src="${esc(person.face)}" alt="" loading="lazy" onerror="this.remove()">`
      : ''
  return `<span class="bcface bcface--${esc(size)}" data-initial="${esc(initial)}"
    title="${esc(name)}">${img}<span class="bcfacemono" aria-hidden="true">${esc(initial)}</span></span>`
}

/*
  EITHER SLUG, because a person here has two.

  The design gives each specialist a short slug (`claire`) and the office
  answers to a role slug (`chief-of-staff`); `data.js` keeps the real one as
  `staffSlug` precisely so a write can address it. This matched only the design
  slug, so anything carrying the office's own name -- an output's author, a
  waiting item's asker -- fell through to the raw string, and the team page
  showed "chief-of-staff · made · 19 Sep" in a column of Claires and Emmas.
  `crewBy` in data.js has matched both all along; this is the copy that did
  not.
*/
/* Somebody not on the roster is still a name, not a key: "priya" reads as
   Priya and "finance-director" as Finance director. */
export const pretty = (slug) => {
  const t = String(slug ?? '').replace(/[-_]+/g, ' ').trim()
  return t === '' ? '' : t.charAt(0).toUpperCase() + t.slice(1)
}
const person = (slug) =>
  (ctx?.crew ?? []).find((c) => c.slug === slug || c.staffSlug === slug) ??
  (slug ? { slug, name: pretty(slug) } : null)

/*
  Exported because §18's waiting record needs the same answer the miniatures
  give: a slug is a database key and "communications-director needs you" is not
  a sentence. Two copies of this would be two places for the roster lookup to
  disagree, which is the row-list-built-twice defect in a person's name.
*/
export const named = (slug) => person(slug)?.name ?? ''

/* ======================================================================== *
 * To-dos: PROJECT -> LIST -> TASK  (§6)
 * ======================================================================== */

const DONE = new Set(['done', 'cancelled'])
const isDone = (t) => DONE.has(t.state_raw ?? t.state ?? '')

/* Exported: the To-dos page read t.due, which prototype and office rows
   rarely carry, so its rows showed no date at all. One reader. */
export const dueWords = (t) => {
  const iso = t.due_on ?? null
  if (iso === null || iso === undefined || iso === '') return t.due ?? ''
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return t.due ?? ''
  const today = new Date()
  const days = Math.round((d.getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000)
  const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (days < 0) return `${label} · overdue`
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return label
}

/*
  EXPORTED, because §9's full Schedule needs the same answer and a second
  copy of "is this late" is a second thing to get wrong. The reader and the
  miniature disagreeing about which row is overdue would be the two-sources
  defect on the one fact a schedule exists to state.
*/
export const isLate = (t) => {
  const iso = t.due_on ?? null
  if (isDone(t) || iso === null || iso === undefined || iso === '') return false
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  return d.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/**
 * Group a project's tasks under its modules.
 *
 * A module is a milestone task (0286) and a task names its parent (0171), so
 * the hierarchy is derived, not stored twice. Anything whose parent is not a
 * module of this project falls into one honest group at the end rather than
 * disappearing: a task in no list is still work.
 */
export const listsOf = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  const mods = p.modules ?? []
  const byId = new Map()
  for (const m of mods) byId.set(m.id ?? m.name, { name: m.name, id: m.id ?? m.name, items: [] })
  const loose = []
  for (const t of tasks) {
    const key = t.parent ?? null
    const bucket = key !== null && byId.has(key) ? byId.get(key) : null
    if (bucket !== null) bucket.items.push(t)
    else loose.push(t)
  }
  const out = [...byId.values()].filter((l) => l.items.length > 0)
  if (loose.length > 0) out.push({ name: 'Not in a list', id: '', items: loose, loose: true })
  /*
    The same comparator the expanded list uses, so a tick cannot move a row in
    one view and leave it where it was in the other. Done-ness is not in it --
    that is the whole of §7.
  */
  for (const l of out) l.items.sort(todos.stableOrder)
  /*
    LISTS WITH OPEN WORK FIRST.
    Module order is the order Grant built the project in, which put a list of
    two struck-through completed tasks at the top of the first viewport - so
    the first thing the page said was what had already been finished. The
    order within a list is still the project's; only whether a list has
    anything left to do decides which list is read first. A finished list is
    kept rather than hidden, because finished work existing is part of what is
    happening here.
  */
  const openIn = (l) => l.items.filter((t) => !isDone(t)).length
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ao = openIn(a.l) === 0 ? 1 : 0
      const bo = openIn(b.l) === 0 ? 1 : 0
      return ao !== bo ? ao - bo : a.i - b.i
    })
    .map((x) => x.l)
}

/*
  A REAL TICK, in the miniature.

  Project home v2: *"Each to-do should have a functional checkbox. Clicking the
  checkbox in the miniature immediately marks the task as complete. The user
  should not need to open the expanded view simply to complete a task."*

  So this is an `input[type=checkbox]` carrying the task's REF, not a drawn
  span — and the ref comes from the port, which is what keeps this line the
  same whether the office or Vikunja is answering. A prototype row has no ref
  and the box is disabled, which is the precedent the tasks surface already
  set: openable is not the same as writeable.
*/
const taskLine = (t) => {
  const done = isDone(t)
  const who = named(t.who)
  const due = dueWords(t)
  /*
    THE BOX IS NEVER DISABLED, and the title is a control.

    It used to be disabled whenever the row had no id, which is every row a
    visitor without an office token can see - so on the deployed preview the
    whole module was a picture. The write still only happens where there is
    something to write to; where there is not, the prototype remembers
    (todos.overlay), which is the difference between an interface that is
    honest about having no records and one that is not interactive at all.
  */
  const key = todos.keyOf(t)
  return `<li class="bctask${done ? ' bctask--done' : ''}">
    <label class="bctickhit">
      <input type="checkbox" class="bccheck" ${done ? 'checked' : ''}
        data-bc-tick="${esc(key)}"
        aria-label="${esc(`${done ? 'Completed' : 'Not completed'}: ${t.title}`)}">
    </label>
    <button type="button" class="bctasktitle bclinky" data-bc-task-open="${esc(key)}">${esc(t.title)}</button>
    ${who === '' ? '' : `<span class="bctaskwho">${esc(who)}</span>`}
    ${due === '' ? '' : `<span class="bctaskdue${isLate(t) ? ' bctaskdue--late' : ''}">${esc(due)}</span>`}
    ${t.local === true ? '<span class="bclocalmark">This browser</span>' : ''}
    ${t.blocked ? status('Blocked', 'blocked') : ''}
  </li>`
}

/**
 * §6. Lists with their names, their progress and their tasks under them —
 * which is the structure a to-do tool has and a flat bag of rows does not.
 */
/*
  Mine and the team's, counted. `app.studio_tasks` returns `mine` per row -
  ADR-0041's flag for a task assigned to a person rather than to the office -
  so the split is a read, not a second list. It says nothing at all when the
  project has no personal tasks, because "Mine 0" is a row of furniture.
*/
/*
  §21 names "To-dos - Mine / Team" as a requirement of the pane, so it is
  always answered when there is open work.

  The first version hid the line when nothing was assigned to Grant, on the
  reasoning that "0 yours" is furniture. It is not: "none of this is on you"
  is a real answer to the question the line exists to ask, and hiding it makes
  a named requirement look unbuilt on exactly the projects where the answer is
  most reassuring.
*/
/*
  MINE AND THE TEAM'S, AS A SWITCH.

  Grant's own list of what a miniature must do includes "switch Mine/Team". It
  was a sentence in the module header: two true numbers and no way to act on
  either. Both halves are filters now, they say which one is on, and pressing
  the one that is on clears it - which is what a person expects of a pair of
  toggles and is one press fewer than hunting for a "show all".
*/
export const mineAndTeam = (p) => {
  const open = (p.tasks ?? []).filter((t) => t.milestone !== true && !isDone(t))
  if (open.length === 0) return ''
  const mine = open.filter((t) => t.mine === true).length
  const on = ctx?.state?.bcMine ?? null
  const half = (kind, n, label) =>
    `<button type="button" class="bcsplitbtn${on === kind ? ' bcsplitbtn--on' : ''}"
      data-bc-mine="${esc(kind)}" aria-pressed="${on === kind ? 'true' : 'false'}">${esc(
        `${String(n)} ${label}`,
      )}</button>`
  return `<span class="bcsplit2">
    ${half('mine', mine, 'yours')}
    ${half('theirs', open.length - mine, "the team's")}
  </span>`
}

export const todosMini = (whole, { lists = 2, per = 3 } = {}) => {
  const p = narrowFor(whole)
  const groups = listsOf(p)
  if (groups.length === 0) {
    const flat = (p.tasks ?? []).filter((t) => t.milestone !== true)
    /*
      AN EMPTY FILTER IS NOT AN EMPTY PROJECT.

      "No to-dos on this project yet" is true of a project with none and false
      of a project whose to-dos are all the team's while Yours is switched on -
      and the second is one press away from the first, so the wrong sentence
      is the likelier one. A filtered empty says which filter emptied it and
      offers the way out.
    */
    if (flat.length === 0) {
      const on = ctx?.state?.bcFilter ?? ctx?.state?.bcMine ?? null
      const f = on === null ? undefined : FILTERS[on]
      const whole_ = (whole.tasks ?? []).filter((t) => t.milestone !== true)
      if (f !== undefined && whole_.length > 0) {
        return `<p class="bcmpty">Nothing here under ${esc(f.name)}.
          <button type="button" class="bclinky" data-bc-filter-off="1">Show everything</button></p>`
      }
      return emptyWith('No to-dos on this project yet.', 'Add a to-do', `/basecamp/p/${whole.slug}/tasks`)
    }
    return `<ul class="bctasks">${flat.slice(0, per * lists).map(taskLine).join('')}</ul>`
  }
  /*
    EVERY LIST AND EVERY TASK, and the pane scrolls.

    Grant, 22 September: *"Remove patterns such as One More being used merely
    because additional content does not fit. Modules containing more data than
    their visible area should instead become internally scrollable."* The
    `lists` and `per` arguments are a CEILING now rather than a page size -
    they stop a project with four hundred tasks building four hundred rows
    into a pane nobody has scrolled to - and they are set well above what a
    default pane shows, so making the pane taller reveals more.
  */
  const shown = groups.slice(0, lists)
  return `<div class="bclists">
    ${shown
      .map((g) => {
        const done = g.items.filter(isDone).length
        /*
          COMPLETING SOMETHING DOES NOT MOVE IT.

          §7: "Currently ticking a To-do can move it. Do not do that.
          Completion should update visual state, update canonical backend
          state, update counts -- but retain the task's position."

          This line used to read [...open, ...done], which put every completed
          row at the end of its list. So ticking the third of five sent it to
          the bottom, and with the pane showing a few rows it left the pane
          altogether and everything below slid up: the tick read as a delete.
          The office's own ordering does the same thing one layer down, which
          is why `stableOrder` exists and why 0579 put `created` in the payload
          for it to sort by.

          The EXPANDED list still gathers completed work under a Done heading.
          That is not the same behaviour by accident: Grant asked for it on 23
          September, in the same breath as asking that finished work stay
          visible, and a full-height list has room to say both things.
        */
        const first = g.items.slice(0, per)
        return `<section class="bclist">
          <header class="bclisthead">
            <h3>${esc(g.name)}</h3>
            <span class="bclistcount">${esc(`${done}/${g.items.length}`)}</span>
          </header>
          <ul class="bctasks">${first.map(taskLine).join('')}</ul>
        </section>`
      })
      .join('')}
  </div>`
}

/* ======================================================================== *
 * Card table: a compressed workflow state  (§10)
 * ======================================================================== */

const STAGES = [
  { id: 'todo', name: 'Not started' },
  { id: 'doing', name: 'In progress' },
  { id: 'blocked', name: 'Stuck' },
  { id: 'done', name: 'Done' },
]

/**
 * §10. A COMPRESSED WORKFLOW STATE, which is a different drawing from a board.
 *
 * The first version put the real cards in four columns, and in a third-width
 * pane that is 70px a column: every title wrapped to one character per line,
 * which is CLAUDE.md's #67 arriving through a grid instead of through an
 * invisible button. Grant's own reference settles what it should be - his
 * Basecamp miniature is five tinted vertical bars with the stage name turned
 * on its side and a count above it, and not one card.
 *
 * It says the same thing in a fifth of the room: where the work has piled up.
 * The cards are the full tool's job.
 */
/*
  THE COUNTS, ON ONE LINE, for the module header.

  The board reads left to right and its last two columns are Stuck and Done -
  which in a third-width pane are below the fold until somebody scrolls. The
  pane is right to be a board rather than a summary, and the glance is right
  to be answerable without scrolling, so the summary rides in the HEADER where
  it costs no height. The same decision, for the same reason, as Mine / Team
  on the To-dos module.
*/
export const cardsCount = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  if (tasks.length === 0) return ''
  const at = (id) =>
    tasks.filter((t) => {
      const st = t.state_raw ?? (t.state === 'done' ? 'done' : t.state === 'doing' ? 'doing' : 'todo')
      if (id === 'blocked') return st === 'blocked' || (t.blocked ? st !== 'done' : false)
      if (id === 'todo') return st === 'todo' && !t.blocked
      return st === id
    }).length
  return STAGES.map((st) => `${String(at(st.id))} ${st.name.toLowerCase()}`).join(' · ')
}

export const cardsMini = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  if (tasks.length === 0) return emptyWith('Nothing on the board yet.', 'Add a to-do', `/basecamp/p/${p.slug}/tasks`)
  const at = (id) =>
    tasks.filter((t) => {
      const st = t.state_raw ?? (t.state === 'done' ? 'done' : t.state === 'doing' ? 'doing' : 'todo')
      if (id === 'blocked') return st === 'blocked' || (t.blocked ? st !== 'done' : false)
      if (id === 'todo') return st === 'todo' && !t.blocked
      return st === id
    })
  /*
    COLUMNS WITH CARDS IN THEM, not four bars with numbers on.

    Grant, 22 September: *"The Card Table module currently appears to be
    interactive but clicking it can do nothing."* It was a bar chart of four
    counts - decorative by §17's own definition, and there was nothing in it
    to press. The miniature is the board now: the same columns, the same
    colours, the same cards, fewer of them. Every card opens its to-do and
    the whole thing scrolls, so a busy column is not a summary line.
  */
  return `<div class="bcminiboard">
    ${STAGES.map((st) => {
      const items = at(st.id)
      /*
        A DROP TARGET, the same one the full board uses.

        Grant, 23 September: *"Cards/elements within the miniature Card Table
        should support appropriate drag-and-drop/reordering... Prevent
        accidental opening/clicking while dragging."*

        `data-bc-drop` and `data-bc-card` are the full board's own attributes,
        so the wiring that already moves a card between columns moves these
        too - one mechanism on two surfaces rather than a second
        implementation that would drift from it.
      */
      return `<section class="bcminicol" data-stage="${esc(st.id)}" data-bc-drop="${esc(st.id)}">
        <header class="bcminicolhead">
          <span class="bcminicolname">${esc(st.name)}</span>
          <span class="bcminicoln">${esc(String(items.length))}</span>
        </header>
        ${
          items.length === 0
            ? `<p class="bcminiempty">—</p>`
            : items
                .map(
                  (t) => `<button type="button" class="bcminicard"
                    data-bc-card="${esc(todos.keyOf(t))}"
                    data-bc-task-open="${esc(todos.keyOf(t))}"
                    draggable="true"
                    aria-label="${esc(`${t.title} — ${st.name}`)}">${esc(t.title)}</button>`,
                )
                .join('')
        }
      </section>`
    }).join('')}
  </div>`
}

/* ======================================================================== *
 * Calendar: temporal  (§9)
 * ======================================================================== */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * §9. Dated work, shown as dates.
 *
 * A month strip with the days that carry work marked, and the next few items
 * as a dated agenda beside it. The honest caveat is on the surface: the office
 * has no events table, so this is scheduled WORK and not a diary, and saying
 * so is cheaper than a calendar Grant reasonably reads as his appointments.
 */
export const calendarMini = (p, { items = 4 } = {}) => {
  const dated = (p.tasks ?? [])
    .filter((t) => t.milestone !== true)
    .map((t) => ({ t, iso: String(t.due_on ?? t.starts_on ?? '').slice(0, 10) }))
    .filter((x) => x.iso !== '' && !Number.isNaN(new Date(`${x.iso}T00:00:00Z`).getTime()))
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0))
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const first = new Date(Date.UTC(y, m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const len = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const marks = new Set(dated.filter((x) => x.iso.slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}`).map((x) => Number(x.iso.slice(8, 10))))
  const today = now.getUTCDate()
  const cells = []
  for (let i = 0; i < lead; i += 1) cells.push('<span class="bccal-pad"></span>')
  for (let d = 1; d <= len; d += 1) {
    const cls = ['bccal-day']
    if (marks.has(d)) cls.push('bccal-day--has')
    if (d === today) cls.push('bccal-day--today')
    cells.push(`<span class="${cls.join(' ')}">${d}</span>`)
  }
  return `<div class="bccalwrap">
    <div class="bccal" role="presentation">
      <div class="bccalmonth">${esc(first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))}</div>
      <div class="bccalgrid">
        ${DAYS.map((d) => `<span class="bccal-dow">${esc(d.charAt(0))}</span>`).join('')}
        ${cells.join('')}
      </div>
    </div>
    <div class="bcagenda">
      ${
        dated.length === 0
          ? emptyWith('Nothing on this project has a date yet.', 'Give a to-do a date', `/basecamp/p/${p.slug}/schedule`)
          : dated
              .slice(0, items)
              .map(
                ({ t, iso }) => `<div class="bcagendaitem${isLate(t) ? ' bcagendaitem--late' : ''}">
                  <span class="bcagendadate">
                    <span class="bcagendadd">${esc(String(Number(iso.slice(8, 10))))}</span>
                    <span class="bcagendamm">${esc(new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }))}</span>
                  </span>
                  <!--
                    Clickable, because v2 says the schedule must work in
                    miniature: *"Clicking Schedule or its contents should
                    actually perform an action rather than doing nothing."*
                    It opens the to-do the date belongs to.
                  -->
                  <button type="button" class="bcitemtitle bclinky bcagendawhat"
                    data-bc-task-open="${esc(todos.keyOf(t))}">${esc(t.title)}</button>
                  ${t.who ? `<span class="bcagendawho">${esc(named(t.who) || t.who)}</span>` : ''}
                </div>`,
              )
              .join('')
      }
      <p class="bccalnote">Scheduled work. The office keeps no separate diary.</p>
    </div>
  </div>`
}

/* ======================================================================== *
 * Chat: the team, present  (§7)
 * ======================================================================== */

/**
 * §7. Speech, with a face, a name and a time against every line — which is
 * what makes a room feel occupied. A name in a meta string does not.
 */
/*
  ONE BUBBLE RENDERER for the miniature and the tool.

  `chat.js` speaks `from` and `at`; the prototype thread speaks `who` and
  `when`. Two vocabularies for one thing is 0311's lesson, and the answer is
  not a translation table on each caller: the renderer takes either and the
  callers stop knowing about it.
*/
export const said_ = (m) => {
  const who = m.who ?? m.from ?? ''
  const mine = who === 'grant'
  const when_ = m.when ?? m.at ?? ''
  return `<div class="bcsaid${mine ? ' bcsaid--mine' : ''}">
    ${face(mine ? { name: 'Grant', slug: 'grant' } : person(who))}
    <div class="bcsaidbody">
      <span class="bcsaidwho">${esc(mine ? 'You' : named(who) || who)}</span>${
        mine || !person(who)?.role ? '' : `<span class="bcsaidrole">${esc(person(who).role)}</span>`
      }
      <!--
        THE TIME, as a person reads it.

        This escaped whatever it was handed, and what the office and the
        optimistic tail both hand it is an ISO instant - so every line of the
        conversation was stamped with a raw instant like
        2026-09-23T10:14:17.560Z. The studio's own stamp helper renders "4
        minutes ago", with the exact instant in its title and the relative
        marker the studio already re-times on a tick. The prototype rows carry
        words like "yesterday" and fall through the fallback unchanged.

        No backticks in this comment: it lives inside a template literal, and
        one here ends the string. That is how this file broke a moment ago.
      -->
      <span class="bcsaidwhen">${when.stamp(when_, when_)}</span>
      <!--
        THE BODY KEEPS ITS SHAPE. One escaped string in one paragraph tag
        collapsed every newline, so a reply written as three short paragraphs
        or a numbered list read here as one run-on block. The same renderer
        the studio uses: paragraphs, line breaks, and a real ordered list.
      -->
      <div class="bcsaidtext">${prose(m.text ?? '')}</div>
      <!--
        PLAY IT BACK, only where there is something to play.

        A voice note reaches the team as words, because that is what the
        office can read, route and answer. The recording is kept in this
        browser and this is where it is offered - drawn only when the store
        actually holds one, so it can never be a control that does nothing.
      -->
      ${
        notes.has(m.id ?? '')
          ? `<button type="button" class="bcsaidplay" data-bc-noteplay="${esc(m.id ?? '')}">
               <span aria-hidden="true">▶</span> Play the recording
             </button>`
          : ''
      }
    </div>
  </div>`
}

export const chatMini = (p, { lines = 3 } = {}) => {
  /*
    THE OFFICE'S OWN THREAD when there is one, the prototype's when there is
    not. `chat.thread` is the record - a message Grant sent from Slack is in
    it and was never in this browser - and it is empty in a signed-out
    browser, which is every capture this repository takes. Falling back to the
    invented thread is what keeps §7's grammar visible in a capture; falling
    back to it when a REAL one exists would be showing him a fiction over his
    own conversation, which is why the real one wins whenever it has anything.
  */
  const real = ctx?.chatFor?.(p.slug) ?? []
  const said = (real.length > 0 ? real : (p.chat ?? [])).slice(-lines)
  if (said.length === 0) {
    return `<p class="bcmpty">Nothing has been said on this project yet. Ask the team a
      question and it starts here.</p>`
  }
    return `<div class="bcchat">
    ${said.map((m) => said_(m)).join('')}
    <p class="bcmore bcdocsall">
      <button type="button" class="bclinky" data-bc-dock="1">Talk to the team</button>
    </p>
  </div>`
}

/* ======================================================================== *
 * The agentic team, as participants  (§8)
 * ======================================================================== */

/**
 * §8. Colleagues, not telemetry.
 *
 * A face, a name, what they are doing in a sentence, and — when it exists —
 * the thing they have handed back. No worker names, no queue identifiers, no
 * orchestration internals; those stay behind Active jobs where a person who
 * wants them can ask.
 */
export const crewMini = (p, { people = 4 } = {}) => {
  const crew = (ctx?.crewFor?.(p.slug) ?? []).slice(0, people)
  const waiting = p.waiting ?? []
  const made = (p.requests ?? []).filter((r) => r.output?.id)[0]
  if (crew.length === 0 && waiting.length === 0) {
    return `<p class="bcmpty">Nobody is working on this project yet.</p>`
  }
  return `<div class="bccrew">
    ${crew
      .map(
        (c) => `<div class="bcmate">
          <div class="bcmatebody">
            <span class="bcmatename">${esc(c.name)}</span>
            <span class="bcmatedoing">${esc(c.doing ?? c.role ?? '')}</span>
          </div>
          ${c.state === 'working' ? status('Working', 'running') : c.state === 'blocked' ? status('Stuck', 'blocked') : ''}
        </div>`,
      )
      .join('')}
    ${waiting
      .slice(0, 2)
      .map(
        /*
          PRESSABLE, because §18's journey starts by opening the item and this
          is where most people meet one: the board, not the team page. It was a
          div, so the only thing a person could do with the news that something
          needed them was read it again.
        */
        (w) => `<button type="button" class="bcmate bcmate--asks bcmate--press" data-bc-waitopen="${esc(String(w.id ?? ''))}">
          <div class="bcmatebody">
            <span class="bcmatename">${esc(named(w.who) || 'The team')} needs you</span>
            <span class="bcmatedoing">${esc(w.what ?? '')}</span>
          </div>
          ${w.overdue === true ? status('Overdue', 'blocked') : status('Waiting for you', 'waiting')}
        </button>`,
      )
      .join('')}
    ${
      made === undefined
        ? ''
        : `<div class="bcmate bcmate--made">
            <span class="bcmadepage" aria-hidden="true"></span>
            <div class="bcmatebody">
              <span class="bcmatename">${esc(made.output.title)}</span>
              <span class="bcmatedoing">${esc([named(made.who), made.delivered].filter(Boolean).join(' · '))}</span>
            </div>
            ${made.output.imported === true ? status('In the project', 'done') : status('Ready for you', 'waiting')}
          </div>`
    }
  </div>`
}

/* ======================================================================== *
 * Documents: they look like documents  (§11)
 * ======================================================================== */

/*
  §21 — DOCS AND FILES ARE VISUAL OBJECTS, NOT RECORDS.

  Grant's correction, against his own Basecamp screenshot: the project home
  carries a recognisable Docs & Files pane, and the reference shows three
  actual thumbnails side by side - a file-type tile, a rendered text page and a
  cover image. Not a count, not a list of filenames with an Open button, not an
  icon that takes you elsewhere.

  THE REAL PAGE IS RENDERED, and none of that machinery is new: `pdf.js`
  (#23) already renders page one of a PDF to a canvas using a SELF-HOSTED
  pdf.mjs, and the gateway already mints a ten-minute signed URL for any
  document with a file (#96), because the storage bucket is private. This pane
  draws `page.js`'s placeholder immediately and lets the real page replace it
  when it arrives - which is `paint()`'s own contract, so the pane is never
  empty, never jumps, and a file that will not parse degrades to the drawing
  rather than to a broken image.

  ONE SOURCE. This is a VIEW over `p.documents`, the same array the full
  Documents workspace reads. There is no second document store and no
  duplicated fixture to make the home look busy.
*/

const KINDWORD = {
  pdf: 'PDF',
  doc: 'Document',
  made: 'Written by the team',
  slides: 'Slides',
  mindmap: 'Mind map',
  audio: 'Audio',
  image: 'Image',
  sheet: 'Spreadsheet',
}

/*
  A document that is not a page gets an OBJECT rather than a drawn page.

  Basecamp's own pane shows a green spreadsheet tile beside two real pages, and
  that is the honest treatment: a sheet has no first page worth rendering and a
  recording has none at all. Drawing lines of fake text on top of an audio file
  would be a picture of a document that does not exist.
*/
const FACE = {
  audio: { glyph: 'audio', tone: 'a' },
  sheet: { glyph: 'sheet', tone: 's' },
  mindmap: { glyph: 'map', tone: 'm' },
  slides: { glyph: 'slides', tone: 'p' },
  image: { glyph: 'image', tone: 'i' },
  video: { glyph: 'video', tone: 'v' },
  /*
    THE DELIBERATE FALLBACK, for a file whose first page cannot be drawn and
    whose type is not one of the five above - an archive, an installer, a
    format nobody here has met. Grant asked for one in those words, and the
    alternative is the drawn page, which would be this office asserting that a
    zip file is a written document.
  */
  file: { glyph: 'file', tone: 'f' },
}

/*
  A DOCUMENT'S FACE IS DECIDED BY WHAT THE FILE IS, NOT BY THE FOUR WORDS THE
  PAYLOAD HAPPENS TO CARRY.

  `app.studio_documents` maps every document in the office onto exactly four
  kinds - `audio`, `made`, `pdf` and `doc` - so a spreadsheet, a slide deck, a
  photograph and a video all arrive here as `doc`. The tile then drew LINES OF
  TEXT on them, which is the one thing the comment above this map forbids: a
  picture of a document that does not exist. A photograph of the venue was
  rendered as a page of writing.

  Widening the RPC's four words would not fix it either, because the office
  cannot know the type of a file it has never fetched. So the face is derived,
  here, from three pieces of evidence in order of authority: the kind if it is
  one this map names, then the media type, then the file's own extension. The
  painter downstream has one more piece - the type the gateway returns when the
  file is actually fetched - and may correct the face with it.
*/
const EXT = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  svg: 'image', avif: 'image', heic: 'image', bmp: 'image', tif: 'image', tiff: 'image',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', odp: 'slides', key: 'slides',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video', mpg: 'video', mpeg: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio', oga: 'audio',
  aac: 'audio', flac: 'audio', opus: 'audio', weba: 'audio',
  /*
    A PAGE, explicitly. These are things whose first page is worth drawing, and
    naming them means the `file` fallback below can be the answer for an
    extension nobody listed rather than the drawn page being it.
  */
  pdf: '', doc: '', docx: '', odt: '', rtf: '', txt: '', md: '', markdown: '',
  html: '', htm: '', pages: '',
}

/** The extension of a name or URL, lower case, without the dot. */
const extOf = (name) => {
  const clean = String(name ?? '').split(/[?#]/)[0] ?? ''
  const last = clean.slice(clean.lastIndexOf('/') + 1)
  const dot = last.lastIndexOf('.')
  return dot <= 0 ? '' : last.slice(dot + 1).toLowerCase()
}

/*
  AND THE CAPTION SAYS THE SAME THING THE TILE DOES.

  The word under a thumbnail came from `KINDWORD[d.kind]`, which is the same
  four words - so with the tile corrected, a photograph showed a photograph and
  said "Document" underneath it, a spreadsheet showed a spreadsheet and said
  "Document", and an archive said "Document" too. A label disagreeing with the
  picture beside it is worse than both being wrong, because each is then
  evidence that the other is broken. There were two copies of the word map as
  well, here and in the list view.
*/
const FACEWORD = {
  audio: 'Audio',
  sheet: 'Spreadsheet',
  map: 'Mind map',
  slides: 'Slides',
  image: 'Image',
  video: 'Video',
  file: 'File',
}

/**
 * Is this a recording?
 *
 * Three places asked and two of them asked the kind: `opensAs` promised "opens
 * in a new tab" and the detail view withheld the player, so a .m4a arriving as
 * a `doc` - which is what the office emits for anything that is not already
 * marked audio - reached a details page with nothing to press. `openDoc` alone
 * read the extension and routed it there correctly, which is how it came to be
 * a page with no player rather than a file that did nothing.
 */
export const isAudioDoc = (d) => faceOf(d)?.glyph === 'audio'

/** The words for a document, tile and row alike. */
export const kindWordOf = (d) => {
  const kind = String(d?.kind ?? 'doc')
  const face = faceOf(d)
  if (face !== undefined) return FACEWORD[face.glyph] ?? KINDWORD[kind] ?? kind
  return KINDWORD[kind] ?? kind
}

/**
 * The face a media type and a filename earn, or undefined for a drawn page.
 *
 * Exported because the painter asks the same question again once it has the
 * real media type from the gateway, and two functions answering it separately
 * is how the gallery and the list came to disagree in the first place.
 */
export const faceFor = (mime, name) => {
  const m = String(mime ?? '').toLowerCase()
  if (m.startsWith('audio/')) return FACE.audio
  if (m.startsWith('image/')) return FACE.image
  if (m.startsWith('video/')) return FACE.video
  if (m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv') return FACE.sheet
  if (m.includes('presentation') || m.includes('powerpoint')) return FACE.slides
  if (m === 'application/pdf' || m.startsWith('text/') || m.includes('word') || m.includes('opendocument.text')) {
    return undefined
  }
  const ext = extOf(name)
  if (ext === '') return m === '' ? undefined : FACE.file
  const known = EXT[ext]
  if (known === '') return undefined
  if (known !== undefined) return FACE[known]
  return FACE.file
}

/**
 * What THIS document looks like. The kind first, because a document the office
 * wrote has no filename to read and its kind is the only evidence there is.
 */
export const faceOf = (d) => {
  const kind = String(d?.kind ?? '')
  if (FACE[kind] !== undefined) return FACE[kind]
  if (kind === 'pdf' || kind === 'made') return undefined
  return faceFor(d?.mime ?? d?.mime_type ?? '', d?.file ?? d?.title ?? '')
}

/*
  A GLYPH RATHER THAN A WORD ON THE TILE.

  Grant: *"broken/missing thumbnails should have attractive fallbacks."* A
  grey word in a box is not a fallback, it is the absence of one - and the
  word is repeated directly underneath in the caption, so the tile said
  nothing the line below it did not. These are the same stroke weight and the
  same geometry as the rest of the experience's icons.
*/
const GLYPH = {
  audio: `<svg viewBox="0 0 48 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2.2" stroke-linecap="round">
      <path d="M4 16h3M11 10v12M18 5v22M25 12v8M32 7v18M39 13v6M46 16h-2"></path>
    </svg>`,
  sheet: `<svg viewBox="0 0 40 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round">
      <rect x="3" y="3" width="34" height="26" rx="3"></rect>
      <path d="M3 12h34M15 12v17M26 12v17"></path>
    </svg>`,
  map: `<svg viewBox="0 0 40 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round">
      <circle cx="20" cy="16" r="5"></circle>
      <circle cx="6" cy="6" r="3"></circle><circle cx="34" cy="7" r="3"></circle>
      <circle cx="7" cy="26" r="3"></circle><circle cx="33" cy="25" r="3"></circle>
      <path d="M16 13L9 8M24 13l7-4M16 19l-6 5M24 19l6 4"></path>
    </svg>`,
  slides: `<svg viewBox="0 0 40 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round">
      <rect x="3" y="4" width="34" height="20" rx="3"></rect>
      <path d="M14 29h12M20 24v5M10 12h12M10 17h8"></path>
    </svg>`,
  image: `<svg viewBox="0 0 40 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round">
      <rect x="3" y="4" width="34" height="24" rx="3"></rect>
      <circle cx="13" cy="12" r="3"></circle>
      <path d="M5 24l9-8 7 6 5-4 9 8"></path>
    </svg>`,
  video: `<svg viewBox="0 0 40 32" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round">
      <rect x="3" y="5" width="24" height="22" rx="3"></rect>
      <path d="M27 13l10-5v16l-10-5z"></path>
    </svg>`,
  file: `<svg viewBox="0 0 32 40" class="bcglyph" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linejoin="round">
      <path d="M6 3h14l8 8v26a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2z"></path>
      <path d="M20 3v8h8"></path>
    </svg>`,
}

/** The glyph a face draws, so the painter can dress a tile it has corrected. */
export const glyphFor = (face) => (face === undefined ? '' : (GLYPH[face.glyph] ?? ''))

/*
  ONE REFERENCE PER DOCUMENT, and never an empty one.

  This is the whole of Grant's *"some PDFs can be clicked while other assets
  cannot"*. The reference was `d.file ?? id:<id> ?? ''`, and both callers
  then refused to make a document openable when it came back empty - so the
  avatar document, the interview questions, the questionnaire and the voice
  note were all inert, while the three rows that happen to carry a sample PDF
  worked. Every document has a reference now: the file if it has one, the
  record if it has one, and otherwise its own title, which opens the details.
  What a press DOES still depends on what exists; whether it presses at all
  no longer does.
*/
export const docRef = (d) =>
  d?.file ?? (d?.id ? `id:${d.id}` : `d:${d?.title ?? ''}`)

/** The drawn page, from the document's own line lengths where it has them. */
const drawnPage = (d, most = 9) => {
  const lines = (Array.isArray(d.lines) && d.lines.length > 0 ? d.lines : [92, 100, 96, 84, 98, 70, 90]).slice(0, most)
  return `<span class="bcpage" aria-hidden="true">
    ${lines
      .map((w) => `<span class="bcpline" style="width:${Math.max(24, Math.min(100, Number(w) || 80))}%"></span>`)
      .join('')}
  </span>`
}

/**
 * The thumbnail itself: a drawn page, or the object a thing with no page is.
 *
 * ONE DRAWING, TWO VIEWS. The gallery tile called `FACE[kind]` and the list
 * row unconditionally drew lines of text, so the same spreadsheet was a green
 * object in one view and a written page in the other - the row list built
 * twice, with a picture on it. `extra` is the only thing that differs.
 */
export const thumbFace = (d, i, extra = '') => {
  const object = faceOf(d)
  const ref = docRef(d)
  const tone = object === undefined ? '' : ` bcthumb--object bcthumb--${esc(object.tone)}`
  return `<span class="bcthumb${tone}${extra === '' ? '' : ` ${esc(extra)}`}"
    data-bc-thumb="${esc(ref)}" data-bc-thumb-i="${esc(String(i))}">
    ${object === undefined ? drawnPage(d, extra === 'bcrowthumb' ? 4 : 9) : (GLYPH[object.glyph] ?? '')}
  </span>`
}

/*
  THE ORDERING CONTROL, one definition for both surfaces.

  A native `select`: it is compact, it is keyboard-operable and screen-reader
  announced without a line of code, and §25 asked for no unnecessary chrome. A
  custom menu would have been three controls, a popover and a keyboard model,
  all to do what this does.

  The label is visually hidden rather than absent: "Custom" on its own tells
  somebody reading the page aloud nothing about what it orders.
*/
export const sortControl = (slug, how, where) => `<span class="bcdocsort">
    <!--
      A VISIBLE WORD before the value. The select said only "Custom", which
      names a value and not the question; the full label stays for a screen
      reader, and the eye gets "Order".
    -->
    <span class="bcdocsortword" aria-hidden="true">Order</span>
    <label class="bcvh" for="bc-docsort-${esc(where)}-${esc(slug)}">Order these documents by</label>
    <select class="bcdocsortpick" id="bc-docsort-${esc(where)}-${esc(slug)}"
      data-bc-docsort="${esc(slug)}">
      ${docorder.MODES.map(
        (m) =>
          `<option value="${esc(m.id)}"${m.id === how ? ' selected' : ''}>${esc(m.name)}</option>`,
      ).join('')}
    </select>
  </span>`

const thumb = (d, i) => {
  const ref = docRef(d)
  /*
    A FIGURE WITH A BUTTON IN IT, not a clickable div. The press was on the
    figure, which is not focusable and not announced as a control, so the
    whole gallery was unreachable by keyboard and silent to a screen reader.
  */
  /*
    DRAGGABLE, AND STILL A BUTTON (§§29, 35).

    Click opens, drag reorders, and the two must not be confused -- which is
    the Card Table's defect in another costume. The figure carries the drag and
    the button inside it carries the press, so the browser does the separation
    for us: a gesture that becomes a drag never delivers a click.

    The id is on the figure as `data-bc-docid` rather than reusing the ref,
    because the ref is what OPENS a document and the id is what ORDERS it, and
    a title is not unique.
  */
  return `<figure class="bcdoc bcdoc--openable" data-bc-doc="${esc(ref)}" data-bc-doc-title="${esc(d.title ?? '')}"
    data-bc-docid="${esc(String(d.id ?? ''))}" draggable="true">
    <button type="button" class="bcdocpress" data-bc-doc-open="${esc(ref)}"
      aria-label="${esc(`Open ${d.title ?? 'document'}`)}">
      ${thumbFace(d, i)}
      <figcaption>
        <span class="bcdoctitle">${esc(d.title)}</span>
        <span class="bcdocmeta">${esc([kindWordOf(d), d.size].filter(Boolean).join(' · '))}</span>
      </figcaption>
    </button>
  </figure>`
}

/**
 * §21. The Docs and Files pane: real thumbnails of the project's real files.
 *
 * `items` is deliberately generous - the pane has to be INFORMATIVE, and three
 * covers under a heading is a sample rather than a section.
 */
/** The thumbnails alone, so the full workspace and the pane share one drawing. */
/*
  AN EMPTY MODULE OFFERS THE ONE THING THAT WOULD FILL IT. A box with a single
  grey sentence in it is calm and says nothing about what to do next; six of
  them on a new project read as a page that has not loaded. One link each, to
  the place that adds the thing, drawn with the same data-bc-go the docs pane
  already uses so the wiring is the router's own.
*/
const emptyWith = (line, label, to) =>
  `<div class="bcmptywrap"><p class="bcmpty">${esc(line)}</p>
    <a class="bcmptyact" href="${esc(to)}" data-bc-go="${esc(to)}">${esc(label)}</a></div>`

export const docThumbs = (docs) => docs.map((d, i) => thumb(d, i)).join('')

export const docsMini = (p, { items = 6 } = {}) => {
  const docs = p.documents ?? []
  if (docs.length === 0) {
    return emptyWith(
      'Nothing filed on this project yet. What you upload, or the team writes, appears here.',
      'Add a file',
      `/basecamp/p/${p.slug}/documents`,
    )
  }
  /*
    §21 asks the pane for an obvious route to ALL of them, in those words. The
    heading is a link, which is the two-level pattern - and a small grey
    uppercase heading is not an obvious route, so the count at the foot says
    where it goes instead of only how many are left. One affordance doing both
    jobs beats a count beside a link that repeats it.
  */
  /*
    The prefix, written once here rather than asked of a context that does not
    carry it. `shell.js` and `compose.js` each have their own `at()`; a third
    caller guessing at a helper that is not on ctx would have produced a link
    to `undefined`.
  */
  const to = `/basecamp/p/${p.slug}/documents`
  /*
    THE SAME ORDER THE EXPANDED VIEW USES (§§30, 33).

    Both surfaces ask `docorder` rather than sorting for themselves, so they
    are two views of one arrangement instead of two implementations of it. The
    control is a native select: compact, keyboard-operable for nothing, and
    §25 asked for no unnecessary chrome.
  */
  const how = docorder.mode(p.slug)
  const shown = docorder.ordered(p.slug, docs, how)
  return `<div class="bcdocs" data-bc-docdrop="${esc(p.slug)}">
    ${shown.slice(0, items).map((d, i) => thumb(d, i)).join('')}
    <p class="bcmore bcdocsall">
      <a href="${esc(to)}" data-bc-go="${esc(to)}">${esc(
        docs.length > items
          ? `View all ${docs.length} Docs & Files`
          : 'View all Docs & Files',
      )}</a>
      ${sortControl(p.slug, how, 'mini')}
    </p>
  </div>`
}

/* ======================================================================== *
 * Activity: a chronological story  (§12)
 * ======================================================================== */

/**
 * §12. Time is the axis, not a trailing grey fragment.
 *
 * Grouped by day with the day as a structural element, and a continuous rule
 * down the side so the eye reads it as a sequence. The first slice rendered
 * the same six sentences here and on the full surface; the miniature is a
 * shorter TIMELINE rather than a shorter LIST, which is the difference between
 * a preview and a duplicate.
 */
/*
  ACTIVITY: AN AUDITABLE TIME, AND A ROW THAT OPENS WHAT IT NAMES.

  Grant, 23 September: *"open linked records; verify exact DATE + HH:MM:SS;
  ensure raw internal slugs do not leak into human-facing prose."* Three
  things, and each was genuinely wrong:

   - the row carried "2h ago" and nothing else. A relative phrase cannot be
     compared with anything and two events an hour apart read as one moment.
     The live payload has carried the instant since 0288 (`at`); the prototype
     did not, which is the second-vocabulary trap this file's own comment
     about Drive's last-read warns about - so the prototype carries instants
     now too and a capture shows what Grant gets;
   - `named(a.who) || a.who` printed the raw slug whenever the roster did not
     know somebody. The fallback is a readable name now, and the slug never
     reaches the page;
   - nothing was openable. A row opens the document or the to-do it NAMES,
     matched against what the project actually holds - and where nothing
     matches it stays plain text rather than becoming a link to a guess.
*/
const prettyWho = (who) => {
  const name = named(who)
  if (name !== '' && name !== who) return name
  /* A slug is not prose: "chief-of-staff" becomes "Chief Of Staff". */
  return String(who ?? '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** What this event points at, if the project holds something by that name. */
const eventTarget = (p, a) => {
  const what = String(a.what ?? '').toLowerCase()
  if (what === '') return null
  for (const d of p.documents ?? []) {
    const title = String(d.title ?? '').toLowerCase()
    if (title !== '' && what.includes(title)) return { kind: 'doc', ref: docRef(d), title: d.title }
  }
  for (const t of (p.tasks ?? []).filter((x) => x.milestone !== true)) {
    const title = String(t.title ?? '').toLowerCase()
    if (title !== '' && what.includes(title)) return { kind: 'task', ref: todos.keyOf(t), title: t.title }
  }
  return null
}

export const timelineMini = (p, { items = 5 } = {}) => {
  const acts = (p.activity ?? []).slice(0, items)
  if (acts.length === 0) return `<p class="bcmpty">Nothing has happened here yet.</p>`
  const days = []
  for (const a of acts) {
    const day = a.at ? when.words(a.at) : (a.when ?? '')
    const last = days[days.length - 1]
    if (last !== undefined && last.when === day) last.items.push(a)
    else days.push({ when: day, items: [a] })
  }
  return `<ol class="bctimeline">
    ${days
      .map(
        (d) => `<li class="bcday">
          <span class="bcdaywhen">${esc(d.when || 'Earlier')}</span>
          <ul class="bcdayitems">
            ${d.items
              .map((a) => {
                const target = eventTarget(p, a)
                const words = `${a.verb ?? 'changed'} ${a.what ?? ''}`.trim()
                const stamp = a.at ? when.precise(a.at) : ''
                const body = `<b>${esc(prettyWho(a.who) || 'The team')}</b> ${esc(words)}`
                return `<li class="bcevent">
                  <span class="bcdot" aria-hidden="true"></span>
                  <span class="bceventbody">
                    ${
                      target === null
                        ? `<span class="bceventwhat">${body}</span>`
                        : `<button type="button" class="bceventwhat bceventwhat--press" ${
                            target.kind === 'doc'
                              ? `data-bc-doc-open="${esc(target.ref)}" data-bc-doc-title="${esc(target.title)}"`
                              : `data-bc-task-open="${esc(target.ref)}"`
                          }>${body}</button>`
                    }
                    ${stamp === '' ? '' : `<time class="bceventat" datetime="${esc(String(a.at))}">${esc(stamp)}</time>`}
                  </span>
                </li>`
              })
              .join('')}
          </ul>
        </li>`,
      )
      .join('')}
  </ol>`
}

/* ======================================================================== *
 * The state of the project, in one line  (§2)
 * ======================================================================== */

/**
 * §2's five-to-ten second question, answered from real rows.
 *
 * Late work, stuck work and things waiting on Grant, in that order, because
 * that is the order he can act on them in. "On track" is only said when all
 * three are genuinely zero — an encouraging summary over a late project is the
 * one thing a state line must never do.
 */
/*
  THE COUNTS ARE CONTROLS, and this is what they were not.

  Grant, 23 September: *"These top-level project indicators must be real
  navigation/filter controls. Click each. Verify the count corresponds to the
  records displayed. Then open those records... No decorative counters."*

  Every one of them was a `span`. They counted real things and did nothing -
  the most prominent false affordance in the product, at the top of the page
  Grant looks at first. Each is a button that opens the To-dos in its own
  filter now, and the filter is computed from the SAME predicate the count is,
  so a count that disagrees with what opens is impossible by construction
  rather than by care.
*/
export const FILTERS = {
  late: { name: 'Late', of: (t) => !isDone(t) && isLate(t) },
  stuck: { name: 'Stuck', of: (t) => !isDone(t) && (Boolean(t.blocked) || t.state_raw === 'blocked') },
  open: { name: 'Open', of: (t) => !isDone(t) },
  mine: { name: 'Yours', of: (t) => !isDone(t) && t.mine === true },
  theirs: { name: "The team's", of: (t) => !isDone(t) && t.mine !== true },
}

/** Every task a filter matches, from the project the page is holding. */
export const filtered = (p, kind) => {
  const f = FILTERS[kind]
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  return f === undefined ? tasks : tasks.filter(f.of)
}

/*
  THE PROJECT AS THE FILTER LEAVES IT.

  Lives here, beside the filters themselves, because BOTH the miniature and
  the full surface have to narrow and they must narrow identically - a
  miniature that ignored the switch while the surface obeyed it is two answers
  to one question, which is the defect this file has been paying off all week.
  The head counts deliberately do NOT use it: a count of what is left after
  filtering by itself is always the same number.
*/
export const narrowFor = (p) => {
  const kind = ctx?.state?.bcFilter ?? ctx?.state?.bcMine ?? null
  const f = kind === null ? undefined : FILTERS[kind]
  if (f === undefined) return p
  return {
    ...p,
    tasks: (p.tasks ?? []).filter((t) => t.milestone === true || f.of(t)),
  }
}

/*
  THE SAME CHIP THE STATUS HELPER DRAWS, with the dot, so a pressable state
  and an unpressable one are the same object. `status()` cannot be reused
  directly because it renders a span and this has to be a button; what it
  CONTAINS is copied deliberately rather than approximated.
*/
const countChip = (kind, label, tone) =>
  `<button type="button" class="bcstatus bcstatus--${esc(tone)} bcstatus--press"
    data-bc-filter="${esc(kind)}"><span class="bcdot" aria-hidden="true"></span>${esc(label)}</button>`

/*
  TWO LINES, BECAUSE THEY ANSWER TWO QUESTIONS AND ONLY ONE OF THEM WAS
  REDUNDANT.

  Grant, 23 September: remove the redundant Tasks summary from the project
  header. The header carried "1 late · 1 stuck · 8 open tasks" directly above a
  To-dos panel listing those same to-dos, which is the redundancy - and in the
  same row sat "1 thing needs you", which is the TEAM's finished work waiting
  to be read. That is not a to-do count and nothing else on the home says it,
  so deleting the row wholesale would have removed the one thing in it that was
  not a repetition.

  So they are separated. The counts move to the to-dos surface, where the
  to-dos are and where narrowing by them makes sense; the team's work stays in
  the header, where it is the only mention of it.
*/

/** The team's finished work, waiting to be read. Not a to-do count. */
export const needsYouLine = (p) => {
  /*
    THREE COUNTERS, AND NONE OF THEM IS "OPEN TASKS".

    Grant, 23 September, removed "1 late - 1 stuck - 8 open tasks" from this
    header because the open count repeated the To-dos panel beneath it. His
    24 September brief then names Needs you, Late and Stuck as the counters
    that matter at the top of a project: readable at a glance, each one
    pressable, calm at zero. Both are honoured by what is here - the
    redundant open count stays gone; late and stuck come back, because
    nothing else on the home says either.

    A zero is drawn, muted and NOT a button: "0 late" is reassurance, and a
    press that can only open an empty list is a dead end. A large count caps
    at 99+ so the group keeps its width.
  */
  const waiting = (p.waiting ?? []).length
  const late = filtered(p, 'late').length
  const stuck = filtered(p, 'stuck').length
  const shown = (n) => (n > 99 ? '99+' : String(n))
  const one = (n, word, tone, attr) => {
    const inner = `<span class="bccountn">${esc(shown(n))}</span><span class="bccountw">${esc(word)}</span>`
    if (n === 0) return `<span class="bccount bccount--zero">${inner}</span>`
    return `<button type="button" class="bccount bccount--${esc(tone)}" ${attr}>${inner}</button>`
  }
  return `<div class="bcstate bccounts" role="group" aria-label="What needs attention on this project">
    ${one(waiting, waiting === 1 ? 'needs you' : 'need you', 'waiting', 'data-bc-waiting="1"')}
    ${one(late, 'late', 'late', 'data-bc-filter="late"')}
    ${one(stuck, 'stuck', 'stuck', 'data-bc-filter="stuck"')}
  </div>`
}

/** Late, stuck and open - each a filter, beside the to-dos they narrow. */
export const taskCounts = (p) => {
  /*
    THE SAME COUNTER GROUP AS THE PROJECT HOME, so "late" looks like one
    thing wherever it is counted. It was a pair of 12px pills beside a bare
    count here and three weighted counters on the home. Open stays on this
    page - it is the size of the list below, which the home does not show.
  */
  const late = filtered(p, 'late').length
  const stuck = filtered(p, 'stuck').length
  const open = filtered(p, 'open').length
  const shown = (n) => (n > 99 ? '99+' : String(n))
  const one = (n, word, tone, kind) => {
    const inner = `<span class="bccountn">${esc(shown(n))}</span><span class="bccountw">${esc(word)}</span>`
    if (n === 0) return `<span class="bccount bccount--zero">${inner}</span>`
    return `<button type="button" class="bccount bccount--${esc(tone)}" data-bc-filter="${esc(kind)}">${inner}</button>`
  }
  return `<div class="bcstate bccounts" role="group" aria-label="How these to-dos stand">
    ${one(late, 'late', 'late', 'late')}
    ${one(stuck, 'stuck', 'stuck', 'stuck')}
    ${one(open, 'open', 'open', 'open')}
  </div>`
}

/* ======================================================================== *
 * Contacts: the people the project is about  (§9's record grammar)
 * ======================================================================== */

/**
 * People, as people.
 *
 * A face and a name, and beneath it the two things a person is actually asked:
 * who is this, and what happens next. The stage, the email and the phone
 * belong on the record, not on the home.
 */
/*
  A CONTACT'S FACE, where there is one.

  Grant, 23 September: "Minimized/miniature contact entries should display the
  contact's profile photograph/avatar when available. Maintain a sensible
  fallback where no photograph exists."

  The fallback is initials on a tint derived from the name, which is what the
  full record already does - so a person looks like the same person in both
  places, and a contact with no photograph still reads as somebody rather than
  as a missing image.

  `object-fit: cover` and a fixed box, because a photograph from a phone is
  four thousand pixels of portrait and would otherwise decide the row's height.
*/
const initials_ = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')

const face_ = (c) => {
  const photo = typeof c?.photo === 'string' && c.photo !== '' ? c.photo : ''
  if (photo !== '') {
    return `<img class="bcmateface" src="${esc(photo)}" alt="" loading="lazy" decoding="async">`
  }
  return `<span class="bcmateface bcmateface--none" aria-hidden="true">${esc(initials_(c?.name))}</span>`
}

export const contactsMini = (p, { items = 4 } = {}) => {
  const cs = p.contacts ?? []
  if (cs.length === 0) return emptyWith('Nobody is recorded against this project yet.', 'Add a contact', `/basecamp/p/${p.slug}/contacts`)
  /*
    v2: *"Clicking a contact should show useful information/details... The user
    should be able to add a new contact directly from the miniature."* So each
    row is a control that opens the person, and the pane carries Add.
  */
  return `<div class="bccrew">
    ${cs
      .slice(0, items)
      .map(
        /*
          THE CONTACT'S OWN KEY, not its position in the list.

          This passed the INDEX - "0", "1" - while everything that opens a
          contact looks one up by `contacts.keyOf`, which is the office id or
          a name. So the lookup found nobody, the record fell back to the
          list, and pressing a person in the miniature merely opened the
          Contacts panel: exactly what Grant reported. One key, from one
          place, used by the miniature and the full list alike.
        */
        (c, i) => `<button type="button" class="bcmate bcmate--press"
          data-bc-contact="${esc(contacts.keyOf(c, i))}">
          ${face_(c)}
          <span class="bcmatebody">
            <span class="bcmatename">${esc(c.name)}</span>
            <span class="bcmatedoing">${esc([c.role, c.org].filter(Boolean).join(' · '))}</span>
          </span>
          ${c.next ? `<span class="bcnext">${esc(c.next)}</span>` : ''}
        </button>`,
      )
      .join('')}
    <p class="bcmore bcdocsall">
      <button type="button" class="bclinky" data-bc-contact-add="1">Add Contact</button>
    </p>
  </div>`
}

/* ======================================================================== *
 * Sources: where the material comes from  (§15)
 * ======================================================================== */

/*
  A PERSON'S WORDS, NOT A RECORD'S. `kind` is `connector`, `reference`,
  `upload`; §15 forbids developer terminology on a project surface and the
  first slice printed the column raw. Anything unmapped falls back to the
  service's own name rather than to the word `connector`, because a name a
  person recognises is better than a category they do not.
*/
const SOURCEWORD = {
  connector: 'Connected',
  reference: 'Something to read',
  upload: 'Uploaded here',
}

/**
 * §15. What the office can see, said plainly.
 *
 * A healthy connection has very little to say, which is the point — so a
 * quiet row is one word and a date, and the only row that raises its voice is
 * one that needs Grant. No keys, no scopes, no OAuth vocabulary: none of
 * those belong on a project surface and there is nowhere here they could
 * appear from.
 */
/*
  THE MARK A SOURCE IS RECOGNISED BY — and it is the studio's own.

  Grant, 22 September: *"Add the appropriate logo/icon next to each source...
  The source should be recognizable visually as well as by name."* And on the
  23rd: *"rounded-square tile + correct recognizable logo + service name +
  clear Add state. No generic placeholder symbols where a proper service
  identity should exist."*

  The first pass drew five marks HERE. That was a second set of service logos
  in a product that already had twelve in `web/studio/logos/marks.js` - drawn
  on a common 24px grid at a common weight, in `currentColor`, with each
  brand's tint and a licence file beside them, for reasons that file sets out
  at length. Two tables of logos is the row-list-built-twice defect with
  branding attached: they would drift, and half the services would have a mark
  in one place and an initial in the other.

  So there is one table, it is the one that already existed, and this maps a
  SOURCE onto it. The match is on the connector id where there is one and on
  the name otherwise, because a reference has no connector and a person still
  reads "Zoom" in a URL.
*/
const MARK_KEY = [
  ['notebooklm', 'notebooklm'],
  ['notebook', 'notebooklm'],
  ['google drive', 'drive'],
  ['drive', 'drive'],
  ['notion', 'notion'],
  ['github', 'github'],
  ['slack', 'slack'],
  ['telegram', 'telegram'],
  ['zoom', 'zoom'],
  ['supabase', 'supabase'],
  ['openrouter', 'openrouter'],
  ['browser', 'browser'],
  ['mcp', 'mcp'],
  ['upload', 'upload'],
]

export const markKeyFor = (s) => {
  const hay = `${String(s?.connector ?? '')} ${String(s?.name ?? s?.title ?? '')}`.toLowerCase()
  for (const [needle, key] of MARK_KEY) {
    if (hay.includes(needle)) return key
  }
  return null
}

export const sourceMark = (s) => {
  const key = markKeyFor(s)
  const mark = key === null ? undefined : MARKS[key]
  const name = String(s?.name ?? s?.title ?? '?')
  if (mark === undefined) {
    /*
      A lettered tile is a fallback and says so by being plainly not a logo; a
      blank space is the absence of one. A reference to somebody's own website
      has no service identity to get right, which is the case this covers.
    */
    return `<span class="bcsrcmark bcsrcmark--letter" aria-hidden="true">${esc(
      name.trim().charAt(0).toUpperCase() || '?',
    )}</span>`
  }
  return `<span class="bcsrcmark" aria-hidden="true" style="color:${esc(mark.tint)}">${mark.svg}</span>`
}

export const sourcesMini = (p, { items = 4 } = {}) => {
  const ss = p.sources ?? []
  if (ss.length === 0) {
    return `<p class="bcmpty">Nothing is connected to this project yet, so the team is
      working from what is filed here.</p>`
  }
  return `<div class="bcsources">
    ${ss
      .slice(0, items)
      .map((s) => {
        const trouble = s.health === 'blocked' || s.trouble
        return `<div class="bcsource${trouble ? ' bcsource--trouble' : ''}">
          ${sourceMark(s)}
          <span class="bcsourcename">${esc(s.name ?? s.title ?? 'A source')}</span>
          <span class="bcsourcewhat">${esc(s.what ?? '')}</span>
          <span class="bcsourcewhen">${esc(
            trouble ? (s.problem ?? 'Needs attention') : [SOURCEWORD[s.kind] ?? '', s.last].filter(Boolean).join(' · '),
          )}</span>
        </div>`
      })
      .join('')}
  </div>`
}
