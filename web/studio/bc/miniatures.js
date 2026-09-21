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

import { esc, status } from './parts.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

/* ======================================================================== *
 * People
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

const person = (slug) =>
  (ctx?.crew ?? []).find((c) => c.slug === slug) ?? (slug ? { slug, name: slug } : null)

const named = (slug) => person(slug)?.name ?? ''

/* ======================================================================== *
 * To-dos: PROJECT -> LIST -> TASK  (§6)
 * ======================================================================== */

const DONE = new Set(['done', 'cancelled'])
const isDone = (t) => DONE.has(t.state_raw ?? t.state ?? '')

const dueWords = (t) => {
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

const taskLine = (t) => {
  const done = isDone(t)
  const who = named(t.who)
  const due = dueWords(t)
  return `<li class="bctask${done ? ' bctask--done' : ''}">
    <span class="bctick${done ? ' bctick--on' : ''}" aria-hidden="true"></span>
    <span class="bctasktitle">${esc(t.title)}</span>
    ${who === '' ? '' : `<span class="bctaskwho">${face(person(t.who))}</span>`}
    ${due === '' ? '' : `<span class="bctaskdue${isLate(t) ? ' bctaskdue--late' : ''}">${esc(due)}</span>`}
    ${t.blocked ? status('Blocked', 'blocked') : ''}
  </li>`
}

/**
 * §6. Lists with their names, their progress and their tasks under them —
 * which is the structure a to-do tool has and a flat bag of rows does not.
 */
export const todosMini = (p, { lists = 2, per = 3 } = {}) => {
  const groups = listsOf(p)
  if (groups.length === 0) {
    const flat = (p.tasks ?? []).filter((t) => t.milestone !== true)
    if (flat.length === 0) return `<p class="bcmpty">No to-dos on this project yet.</p>`
    return `<ul class="bctasks">${flat.slice(0, per * lists).map(taskLine).join('')}</ul>`
  }
  const shown = groups.slice(0, lists)
  const rest = groups.length - shown.length
  return `<div class="bclists">
    ${shown
      .map((g) => {
        const done = g.items.filter(isDone).length
        const open = g.items.filter((t) => !isDone(t))
        const first = [...open, ...g.items.filter(isDone)].slice(0, per)
        return `<section class="bclist">
          <header class="bclisthead">
            <h4>${esc(g.name)}</h4>
            <span class="bclistcount">${esc(`${done}/${g.items.length}`)}</span>
          </header>
          <ul class="bctasks">${first.map(taskLine).join('')}</ul>
          ${g.items.length > first.length ? `<p class="bcmore">${esc(`${g.items.length - first.length} more in this list`)}</p>` : ''}
        </section>`
      })
      .join('')}
    ${rest > 0 ? `<p class="bcmore">${esc(rest === 1 ? '1 more list' : `${rest} more lists`)}</p>` : ''}
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
 * §10. The stages are the real enum — todo, doing, blocked, done, cancelled —
 * so nothing here is invented vocabulary. Compressed: the column, its count
 * and the work at the top of it, which is what a board says from a distance.
 */
export const cardsMini = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  if (tasks.length === 0) return `<p class="bcmpty">Nothing on the board yet.</p>`
  const at = (id) =>
    tasks.filter((t) => {
      const s = t.state_raw ?? (t.state === 'done' ? 'done' : t.state === 'doing' ? 'doing' : 'todo')
      if (id === 'blocked') return s === 'blocked' || (t.blocked ? s !== 'done' : false)
      if (id === 'todo') return s === 'todo' && !t.blocked
      return s === id
    })
  return `<div class="bccols">
    ${STAGES.map((st) => {
      const items = at(st.id)
      return `<section class="bccol" data-stage="${esc(st.id)}">
        <header class="bccolhead">
          <h4>${esc(st.name)}</h4>
          <span class="bccolcount">${items.length}</span>
        </header>
        ${
          items.length === 0
            ? `<p class="bccolempty">—</p>`
            : items
                .slice(0, 2)
                .map(
                  (t) => `<article class="bccard">
                    <span class="bccardtitle">${esc(t.title)}</span>
                    ${t.who ? face(person(t.who)) : ''}
                  </article>`,
                )
                .join('') +
              (items.length > 2 ? `<p class="bcmore">${esc(`+${items.length - 2}`)}</p>` : '')
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
          ? `<p class="bcmpty">Nothing on this project has a date yet.</p>`
          : dated
              .slice(0, items)
              .map(
                ({ t, iso }) => `<div class="bcagendaitem${isLate(t) ? ' bcagendaitem--late' : ''}">
                  <span class="bcagendadate">
                    <span class="bcagendadd">${esc(String(Number(iso.slice(8, 10))))}</span>
                    <span class="bcagendamm">${esc(new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short' }))}</span>
                  </span>
                  <span class="bcagendawhat">${esc(t.title)}</span>
                  ${t.who ? face(person(t.who)) : ''}
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
  const when = m.when ?? m.at ?? ''
  return `<div class="bcsaid${mine ? ' bcsaid--mine' : ''}">
    ${face(mine ? { name: 'Grant', slug: 'grant' } : person(who))}
    <div class="bcsaidbody">
      <span class="bcsaidwho">${esc(mine ? 'You' : named(who) || who)}</span>
      <span class="bcsaidwhen">${esc(when)}</span>
      <p class="bcsaidtext">${esc(m.text ?? '')}</p>
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
    ${said
      .map(
        (m) => said_(m),
      )
      .join('')}
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
          ${face(c, 'md')}
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
        (w) => `<div class="bcmate bcmate--asks">
          ${face(person(w.who), 'md')}
          <div class="bcmatebody">
            <span class="bcmatename">${esc(named(w.who) || 'The team')} needs you</span>
            <span class="bcmatedoing">${esc(w.what ?? '')}</span>
          </div>
          ${status('Waiting for you', 'waiting')}
        </div>`,
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

const KINDWORD = { pdf: 'PDF', doc: 'Document', made: 'Written by the team', slides: 'Slides', mindmap: 'Mind map' }

/**
 * §11. A page, not a row.
 *
 * The lines are drawn from the record's own `lines` when it has them, so two
 * documents do not look alike, and the kind is said in words a person uses
 * rather than as a file extension shown raw.
 */
export const docsMini = (p, { items = 3 } = {}) => {
  const docs = p.documents ?? []
  if (docs.length === 0) return `<p class="bcmpty">Nothing filed on this project yet.</p>`
  return `<div class="bcdocs">
    ${docs
      .slice(0, items)
      .map((d) => {
        const lines = Array.isArray(d.lines) && d.lines.length > 0 ? d.lines.slice(0, 7) : [88, 100, 94, 80, 96, 62]
        return `<figure class="bcdoc">
          <span class="bcpage" aria-hidden="true">
            ${lines.map((w) => `<span class="bcpline" style="width:${Math.max(24, Math.min(100, Number(w) || 80))}%"></span>`).join('')}
          </span>
          <figcaption>
            <span class="bcdoctitle">${esc(d.title)}</span>
            <span class="bcdocmeta">${esc([KINDWORD[d.kind] ?? d.kind, d.size].filter(Boolean).join(' · '))}</span>
          </figcaption>
        </figure>`
      })
      .join('')}
    ${docs.length > items ? `<p class="bcmore">${esc(`${docs.length - items} more filed`)}</p>` : ''}
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
export const timelineMini = (p, { items = 5 } = {}) => {
  const acts = (p.activity ?? []).slice(0, items)
  if (acts.length === 0) return `<p class="bcmpty">Nothing has happened here yet.</p>`
  const days = []
  for (const a of acts) {
    const when = a.when ?? ''
    const last = days[days.length - 1]
    if (last !== undefined && last.when === when) last.items.push(a)
    else days.push({ when, items: [a] })
  }
  return `<ol class="bctimeline">
    ${days
      .map(
        (d) => `<li class="bcday">
          <span class="bcdaywhen">${esc(d.when || 'Earlier')}</span>
          <ul class="bcdayitems">
            ${d.items
              .map(
                (a) => `<li class="bcevent">
                  ${a.who ? face(person(a.who)) : '<span class="bcdot" aria-hidden="true"></span>'}
                  <span class="bceventwhat"><b>${esc(named(a.who) || a.who || 'The team')}</b>
                    ${esc(`${a.verb ?? 'changed'} ${a.what ?? ''}`.trim())}</span>
                </li>`,
              )
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
export const stateLine = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  const late = tasks.filter(isLate)
  const stuck = tasks.filter((t) => !isDone(t) && (t.blocked || t.state_raw === 'blocked'))
  const waiting = p.waiting ?? []
  const open = tasks.filter((t) => !isDone(t))
  const bits = []
  if (waiting.length > 0) bits.push(status(waiting.length === 1 ? '1 thing needs you' : `${waiting.length} things need you`, 'waiting'))
  if (late.length > 0) bits.push(status(late.length === 1 ? '1 late' : `${late.length} late`, 'blocked'))
  if (stuck.length > 0) bits.push(status(stuck.length === 1 ? '1 stuck' : `${stuck.length} stuck`, 'blocked'))
  if (bits.length === 0 && open.length > 0) bits.push(status('On track', 'done'))
  return `<div class="bcstate">
    ${bits.join('')}
    <span class="bcstatecount">${esc(
      open.length === 0 ? 'nothing open' : open.length === 1 ? '1 open task' : `${open.length} open tasks`,
    )}</span>
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
export const contactsMini = (p, { items = 4 } = {}) => {
  const cs = p.contacts ?? []
  if (cs.length === 0) return `<p class="bcmpty">Nobody is recorded against this project yet.</p>`
  return `<div class="bccrew">
    ${cs
      .slice(0, items)
      .map(
        (c) => `<div class="bcmate">
          ${face({ name: c.name }, 'md')}
          <div class="bcmatebody">
            <span class="bcmatename">${esc(c.name)}</span>
            <span class="bcmatedoing">${esc([c.role, c.org].filter(Boolean).join(' · '))}</span>
          </div>
          ${c.next ? `<span class="bcnext">${esc(c.next)}</span>` : ''}
        </div>`,
      )
      .join('')}
    ${cs.length > items ? `<p class="bcmore">${esc(`${cs.length - items} more`)}</p>` : ''}
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
          <span class="bcsourcename">${esc(s.name ?? s.title ?? 'A source')}</span>
          <span class="bcsourcewhat">${esc(s.what ?? '')}</span>
          <span class="bcsourcewhen">${esc(
            trouble ? (s.problem ?? 'Needs attention') : [SOURCEWORD[s.kind] ?? '', s.last].filter(Boolean).join(' · '),
          )}</span>
        </div>`
      })
      .join('')}
    ${ss.length > items ? `<p class="bcmore">${esc(`${ss.length - items} more`)}</p>` : ''}
  </div>`
}
