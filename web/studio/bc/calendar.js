/*
  THE PROJECT CALENDAR.

  Grant, 4 October 2026: a real calendar - Day, Week and Month - that adapts to
  the size of the module it is in, belongs to its project, can show every
  project or the combined Google calendar, creates events that belong to the
  project they were made in, and keeps Google Calendar in step.

  What this replaces was honest about being less: it drew the project's
  to-dos on a month grid by their due dates and said "the office keeps no
  separate diary". That is still here as a layer (a to-do with a date appears on
  its day, and presses through to the to-do), but there is now somewhere for an
  event to live.

  ## Three sizes, one calendar

  A full month squeezed into a small module is unreadable, so the calendar asks
  how much room it has and chooses what to be:

    large   the whole thing: toolbar, Day / Week / Month, event chips
    medium  a condensed month with a dot for each busy day, and the agenda for
            the day that is picked underneath
    small   the agenda: what is coming up, in order

  The size is measured by a ResizeObserver and written to `data-size`; the three
  are drawn in the same markup and CSS chooses, so resizing a module never
  needs a redraw. The expanded view is always large.

  ## Where events come from

  Three adapters behind one interface, chosen by what is true, never by what is
  convenient:

    office   the project's events from the office (gateway section
             `project_events`, actions `event_add` / `event_update` /
             `event_delete` / `event_assign`). Native events sync toward
             Google Calendar from there.
    local    the office does not have the calendar yet (an older deployment):
             events are kept in this browser only, and the calendar SAYS so.
             Nothing pretends to be synchronised.
    sample   no one is signed in: invented events, so the design can be seen.
             Marked by the page's own "prototype data" strip.

  A to-do with a date is a different kind of thing and is never written to any
  of them: it is read from the project's tasks on every draw.

  Comments inside any template literal in this file use plain words.
*/

import { act, canWrite, read } from '../office.js'
import { esc } from './parts.js'
import * as todos from './todos.js'

let ctx = null
export const init = (c) => {
  ctx = c
}

/* ------------------------------------------------------------------ dates --- */

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseDay = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
export const addDays = (s, n) => {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return isoDay(d)
}
/** The Monday that starts the week a day is in. */
export const weekStart = (s) => addDays(s, -((parseDay(s).getDay() + 6) % 7))
export const addMonths = (s, n) => {
  const d = parseDay(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return isoDay(d)
}
const todayIso = () => isoDay(new Date())
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dowIndex = (s) => (parseDay(s).getDay() + 6) % 7
const timeWords = (min) => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${pad(h)}:${pad(m)}`
}
const dayWords = (s) => {
  const d = parseDay(s)
  return `${DOW_LONG[dowIndex(s)].slice(0, 3)} ${String(d.getDate())} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

/* ------------------------------------------------------------- UI state --- */

const PREF = (slug) => `bc.cal.${slug}`
const states = new Map()
export const uiOf = (slug) => {
  let s = states.get(slug)
  if (s === undefined) {
    s = { view: 'month', scope: 'project', cursor: todayIso(), sel: todayIso(), editing: null }
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(PREF(slug)) ?? 'null')
      if (raw !== null && typeof raw === 'object') {
        if (['day', 'week', 'month'].includes(raw.view)) s.view = raw.view
        if (['project', 'all', 'google'].includes(raw.scope)) s.scope = raw.scope
      }
    } catch {
      /* Defaults are fine. */
    }
    states.set(slug, s)
  }
  return s
}
const remember = (slug) => {
  const s = uiOf(slug)
  try {
    globalThis.localStorage?.setItem(PREF(slug), JSON.stringify({ view: s.view, scope: s.scope }))
  } catch {
    /* A viewer who cannot store a preference still has the calendar. */
  }
}

/* ------------------------------------------------------------- the events --- */

/** One event as the calendar reasons about it, from whatever an adapter returned. */
export const norm = (e) => {
  const allDay = e.all_day === true
  const sRaw = String(e.starts_at ?? '')
  const eRaw = String(e.ends_at ?? e.starts_at ?? '')
  let startDay
  let endDay
  let startMin = 0
  let endMin = 1440
  if (allDay) {
    startDay = sRaw.slice(0, 10)
    const endExclusive = eRaw.slice(0, 10)
    endDay = endExclusive > startDay ? addDays(endExclusive, -1) : startDay
  } else {
    const s = new Date(sRaw)
    const en = new Date(eRaw)
    startDay = isoDay(s)
    startMin = s.getHours() * 60 + s.getMinutes()
    const endsAtMidnight = en.getHours() === 0 && en.getMinutes() === 0 && en > s
    endDay = endsAtMidnight ? addDays(isoDay(en), -1) : isoDay(en)
    endMin = endsAtMidnight ? 1440 : en.getHours() * 60 + en.getMinutes()
    if (endDay === startDay && endMin <= startMin) endMin = Math.min(1440, startMin + 30)
  }
  return {
    id: String(e.id),
    title: String(e.title ?? '(no title)'),
    allDay,
    startDay,
    endDay: endDay < startDay ? startDay : endDay,
    startMin,
    endMin,
    source: e.source ?? 'team_hq',
    project: e.project_slug ?? null,
    projectName: e.project_name ?? null,
    sync: e.sync ?? 'local',
    url: e.external_url ?? null,
    channel: e.origin_channel ?? null,
    editable: e.editable !== false && e.source !== 'google',
    notes: e.notes ?? '',
    location: e.location ?? '',
    raw: e,
  }
}

/** Events that touch a day, all-day first, then by start. */
export const onDay = (list, day) =>
  list
    .filter((e) => e.startDay <= day && day <= e.endDay)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMin - b.startMin || a.title.localeCompare(b.title))

/** The to-dos of a project that have a date, as calendar items. */
export const taskItems = (p) =>
  (p.tasks ?? [])
    .filter((t) => t.milestone !== true)
    .map((t) => ({ t, day: String(t.due_on ?? t.starts_on ?? '').slice(0, 10) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day))
    .map(({ t, day }) => ({
      id: `task:${String(t.id ?? t.key ?? t.title)}`,
      title: t.title,
      allDay: true,
      startDay: day,
      endDay: day,
      startMin: 0,
      endMin: 1440,
      source: 'task',
      project: null,
      sync: 'none',
      editable: false,
      task: t,
    }))

const cache = new Map()
let sampleList = null
const localKey = (slug) => `bc.events.${slug}`

const readLocal = (slug) => {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(localKey(slug)) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
const writeLocal = (slug, list) => {
  try {
    globalThis.localStorage?.setItem(localKey(slug), JSON.stringify(list))
  } catch {
    /* Held for this session only. */
  }
}

/*
  Invented events for the prototype, relative to today so the calendar always
  has a week worth looking at. They are never sent anywhere.
*/
const samples = (slug) => {
  const t = todayIso()
  const at = (d, h, m = 0) => new Date(`${addDays(t, d)}T${pad(h)}:${pad(m)}:00`).toISOString()
  return [
    { id: 'sample-1', title: 'Interview: first client', starts_at: at(1, 10), ends_at: at(1, 11), all_day: false, location: 'Video call', notes: 'Prototype event.', source: 'team_hq', project_slug: slug, sync: 'local' },
    { id: 'sample-2', title: 'Weekly planning', starts_at: at(0, 9, 30), ends_at: at(0, 10, 15), all_day: false, source: 'team_hq', project_slug: slug, sync: 'local' },
    { id: 'sample-3', title: 'Venue walk-through', starts_at: at(3, 14), ends_at: at(3, 15, 30), all_day: false, location: 'The venue', source: 'team_hq', project_slug: slug, sync: 'local' },
    { id: 'sample-4', title: 'Course launch window', starts_at: `${addDays(t, 6)}T00:00:00.000Z`, ends_at: `${addDays(t, 9)}T00:00:00.000Z`, all_day: true, source: 'team_hq', project_slug: slug, sync: 'local' },
    { id: 'sample-5', title: 'Dentist (Google)', starts_at: at(2, 8), ends_at: at(2, 9), all_day: false, source: 'google', project_slug: null, sync: 'external', editable: false },
    { id: 'sample-6', title: 'Client check-in', starts_at: at(1, 10, 30), ends_at: at(1, 11, 15), all_day: false, source: 'team_hq', project_slug: slug, sync: 'local' },
  ]
}

/** Which adapter is in charge for this project right now. */
const modeOf = (slug) => cache.get(`mode|${slug}`) ?? (canWrite() ? 'office' : 'sample')

const windowFor = (cursor) => {
  const from = addMonths(`${cursor.slice(0, 7)}-01`, -1)
  const to = addMonths(`${cursor.slice(0, 7)}-01`, 2)
  return { from, to }
}

const keyOf = (slug, scope, from) => `${slug}|${scope}|${from}`

/** The events for what is on screen, and whether they have arrived. */
export const eventsFor = (slug) => {
  const s = uiOf(slug)
  const w = windowFor(s.cursor)
  const key = keyOf(slug, s.scope, w.from)
  const mode = modeOf(slug)
  if (mode === 'sample') {
    sampleList ??= samples(slug)
    return { state: 'ready', mode, list: sampleList.map(norm) }
  }
  if (mode === 'local') {
    return { state: 'ready', mode, list: readLocal(slug).map(norm) }
  }
  const hit = cache.get(key)
  if (hit === undefined) {
    cache.set(key, { state: 'loading', list: [] })
    void fetchWindow(slug, s.scope, w, key)
    return { state: 'loading', mode, list: [] }
  }
  return { state: hit.state, mode, list: hit.list.map(norm), error: hit.error }
}

const fetchWindow = async (slug, scope, w, key) => {
  try {
    const out = await read('project_events', undefined, { project: slug, from: w.from, to: w.to, scope })
    cache.set(key, { state: 'ready', list: Array.isArray(out?.events) ? out.events : [] })
  } catch (e) {
    const said = String(e?.message ?? e)
    /*
      THE OFFICE DOES NOT KNOW THIS SECTION YET. An older deployment answers an
      unknown section with a refusal naming it; that is the one failure that
      means "use the local adapter", and anything else is a real error shown as
      one rather than quietly demoted.
    */
    if (/unknown section|not a section|no such section|project_events/i.test(said)) {
      cache.set(`mode|${slug}`, 'local')
    } else {
      cache.set(key, { state: 'error', list: [], error: said })
    }
  }
  ctx?.render?.()
}

const forget = (slug) => {
  for (const k of [...cache.keys()]) if (k.startsWith(`${slug}|`)) cache.delete(k)
}

/** The events this browser already holds for a project, without asking for more. For search. */
export const knownEvents = (slug) => {
  const mode = modeOf(slug)
  if (mode === 'sample') return (sampleList ?? samples(slug)).map(norm)
  if (mode === 'local') return readLocal(slug).map(norm)
  const out = []
  for (const [k, v] of cache) if (k.startsWith(`${slug}|`) && Array.isArray(v?.list)) out.push(...v.list.map(norm))
  const seen = new Set()
  return out.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

/** Open the editor for a new event, from anywhere (the command palette). */
export const newEvent = (slug) => {
  const p = ctx?.projects?.().find((q) => q.slug === slug) ?? { slug, tasks: [] }
  openEditor(p, null, { day: todayIso() })
}

/** Open one event's editor by id (a search result). */
export const openEvent = (slug, id) => {
  const p = ctx?.projects?.().find((q) => q.slug === slug) ?? { slug, tasks: [] }
  const found = eventsFor(slug).list.find((x) => x.id === id)
  if (found !== undefined) openEditor(p, found, null)
}

/** Forget every cached window and the sample list (tests). */
export const reset = () => {
  cache.clear()
  states.clear()
  sampleList = null
}

/* ------------------------------------------------------------------ writes --- */

const stamp = (day, min) => new Date(`${day}T${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`).toISOString()

/** The fields of an event form, as the gateway wants them. */
const payloadOf = (f) => {
  const allDay = f.allDay === true
  if (allDay) {
    return {
      p_title: f.title,
      p_all_day: true,
      p_starts_at: `${f.startDay}T00:00:00.000Z`,
      p_ends_at: `${addDays(f.endDay < f.startDay ? f.startDay : f.endDay, 1)}T00:00:00.000Z`,
      p_notes: f.notes,
      p_location: f.location,
    }
  }
  const s = f.startMin
  const e = Math.max(f.endMin, s + 5)
  return {
    p_title: f.title,
    p_all_day: false,
    p_starts_at: stamp(f.startDay, s),
    p_ends_at: stamp(f.endDay >= f.startDay ? f.endDay : f.startDay, e),
    p_notes: f.notes,
    p_location: f.location,
  }
}

const newLocalId = () => `local-${Math.random().toString(36).slice(2, 10)}`

/** Create, update or delete. Returns { ok } or { error } and never throws. */
export const write = async (slug, kind, f) => {
  const mode = modeOf(slug)
  try {
    if (mode === 'office') {
      if (kind === 'add') await act('event_add', { p_slug: slug, ...payloadOf(f) })
      else if (kind === 'update') await act('event_update', { p_event: f.id, ...payloadOf(f) })
      else if (kind === 'delete') await act('event_delete', { p_event: f.id })
      else if (kind === 'assign') {
        const raw = f.id.startsWith('g:') ? f.id.slice(2) : f.id
        const cut = raw.lastIndexOf(':')
        await act('event_assign', { p_calendar_id: raw.slice(0, cut), p_event_id: raw.slice(cut + 1), p_slug: f.project })
      } else if (kind === 'unassign') {
        const raw = f.id.startsWith('g:') ? f.id.slice(2) : f.id
        const cut = raw.lastIndexOf(':')
        await act('event_unassign', { p_calendar_id: raw.slice(0, cut), p_event_id: raw.slice(cut + 1) })
      }
      forget(slug)
    } else {
      const list = mode === 'sample' ? (sampleList ??= samples(slug)) : readLocal(slug)
      if (kind === 'add') {
        list.push({ id: newLocalId(), source: 'team_hq', project_slug: slug, sync: 'local', ...rawOf(f) })
      } else if (kind === 'update') {
        const i = list.findIndex((x) => String(x.id) === f.id)
        if (i >= 0) list[i] = { ...list[i], ...rawOf(f) }
      } else if (kind === 'delete') {
        const i = list.findIndex((x) => String(x.id) === f.id)
        if (i >= 0) list.splice(i, 1)
      }
      if (mode === 'local') writeLocal(slug, list)
    }
    ctx?.render?.()
    return { ok: true }
  } catch (e) {
    return { error: String(e?.message ?? e) }
  }
}

const rawOf = (f) => {
  const p = payloadOf(f)
  return { title: p.p_title, all_day: p.p_all_day, starts_at: p.p_starts_at, ends_at: p.p_ends_at, notes: p.p_notes, location: p.p_location }
}

/* --------------------------------------------------------------- rendering --- */

const chip = (e, day, compact, noTime = false) => {
  const time = noTime || e.allDay || e.startDay !== day ? '' : `<span class="bccal2t">${timeWords(e.startMin)}</span>`
  if (e.source === 'task') {
    return `<button type="button" class="bccal2chip bccal2chip--task" data-bc-task-open="${esc(taskKeyOf(e.task))}" title="${esc(`To-do: ${e.title}`)}">
      <span class="bccal2tick" aria-hidden="true"></span>${esc(e.title)}</button>`
  }
  return `<button type="button" class="bccal2chip bccal2chip--${esc(e.source === 'google' ? 'google' : 'own')}${compact ? ' bccal2chip--compact' : ''}"
    data-cal-ev="${esc(e.id)}" title="${esc(e.title)}">${time}${esc(e.title)}</button>`
}

const taskKeyOf = (t) => todos.keyOf(t)

const monthCells = (cursor) => {
  const first = `${cursor.slice(0, 7)}-01`
  const gridStart = weekStart(first)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

const monthBody = (list, s, dense) => {
  const today = todayIso()
  const month = s.cursor.slice(0, 7)
  const cells = monthCells(s.cursor)
  const cap = dense ? 0 : 3
  return `<div class="bccal2month${dense ? ' bccal2month--dense' : ''}" role="grid" aria-label="${esc(`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`)}">
    ${DOW_LONG.map((d) => `<span class="bccal2dow" role="columnheader">${esc(dense ? d.charAt(0) : d.slice(0, 3))}</span>`).join('')}
    ${cells
      .map((day) => {
        const evs = onDay(list, day)
        const out = day.slice(0, 7) !== month
        const cls = ['bccal2cell']
        if (day === today) cls.push('is-today')
        if (out) cls.push('is-out')
        if (day === s.sel) cls.push('is-sel')
        if (evs.length > 0) cls.push('has')
        const shown = evs.slice(0, cap)
        const more = evs.length - shown.length
        return `<div class="${cls.join(' ')}" role="gridcell" data-cal-day="${day}">
          <button type="button" class="bccal2num" data-cal-pick="${day}" aria-label="${esc(`${dayWords(day)}${evs.length > 0 ? `, ${String(evs.length)} ${evs.length === 1 ? 'item' : 'items'}` : ''}`)}">${String(parseDay(day).getDate())}</button>
          ${dense ? '' : `<div class="bccal2chips">${shown.map((e) => chip(e, day, true)).join('')}${more > 0 ? `<button type="button" class="bccal2more" data-cal-open-day="${day}">+${String(more)} more</button>` : ''}</div>`}
          ${dense && evs.length > 0 ? `<span class="bccal2dots" aria-hidden="true">${evs.slice(0, 3).map((e) => `<i class="bccal2dot bccal2dot--${esc(e.source === 'google' ? 'google' : e.source === 'task' ? 'task' : 'own')}"></i>`).join('')}</span>` : ''}
        </div>`
      })
      .join('')}
  </div>`
}

/** Greedy lanes, so two events at the same hour sit side by side rather than on top of each other. */
export const lanes = (items) => {
  const sorted = [...items].sort((a, b) => a.sMin - b.sMin || b.eMin - a.eMin)
  const ends = []
  const out = sorted.map((it) => {
    let lane = ends.findIndex((end) => end <= it.sMin)
    if (lane === -1) {
      lane = ends.length
      ends.push(it.eMin)
    } else ends[lane] = it.eMin
    return { ...it, lane }
  })
  /* A cluster shares one width: the widest overlap it contains. */
  return out.map((it) => {
    const overlapping = out.filter((o) => o.sMin < it.eMin && it.sMin < o.eMin)
    const width = Math.max(...overlapping.map((o) => o.lane)) + 1
    return { ...it, width }
  })
}

const HOUR = 48

const timeGrid = (list, days, s) => {
  const today = todayIso()
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return `<div class="bccal2tg" style="--hour:${String(HOUR)}px;--cols:${String(days.length)}" data-cal-tg>
    <div class="bccal2tghead">
      <span class="bccal2gutter"></span>
      ${days
        .map(
          (d) => `<button type="button" class="bccal2dayhead${d === today ? ' is-today' : ''}" data-cal-pick="${d}">
            <span class="bccal2dn"><span class="bccal2dnl">${esc(DOW_LONG[dowIndex(d)].slice(0, 3))}</span><span class="bccal2dns">${esc(DOW_LONG[dowIndex(d)].charAt(0))}</span></span><span class="bccal2dd">${String(parseDay(d).getDate())}</span></button>`,
        )
        .join('')}
    </div>
    <div class="bccal2allday">
      <span class="bccal2gutter bccal2gl">all day</span>
      ${days.map((d) => `<div class="bccal2adcell" data-cal-day="${d}">${onDay(list, d).filter((e) => e.allDay).map((e) => chip(e, d, true)).join('')}</div>`).join('')}
    </div>
    <div class="bccal2scroll" data-cal-scroll>
      <div class="bccal2body">
        <div class="bccal2hours">${hours.map((h) => `<span class="bccal2hl" style="top:${String(h * HOUR)}px">${h === 0 ? '' : pad(h)}</span>`).join('')}</div>
        ${days
          .map((d) => {
            const timed = onDay(list, d).filter((e) => !e.allDay)
            const items = lanes(
              timed.map((e) => ({ e, sMin: e.startDay === d ? e.startMin : 0, eMin: e.endDay === d ? e.endMin : 1440 })),
            )
            const now = new Date()
            return `<div class="bccal2col${d === today ? ' is-today' : ''}" data-cal-day="${d}" data-cal-slot>
              ${hours.map((h) => `<i class="bccal2line" style="top:${String(h * HOUR)}px"></i>`).join('')}
              ${items
                .map(
                  (it) => `<button type="button" class="bccal2blk bccal2blk--${esc(it.e.source === 'google' ? 'google' : 'own')}"
                    data-cal-ev="${esc(it.e.id)}"
                    style="top:${String(Math.round((it.sMin / 60) * HOUR))}px;height:${String(Math.max(20, Math.round(((it.eMin - it.sMin) / 60) * HOUR) - 2))}px;left:calc(${String((it.lane / it.width) * 100)}% + 2px);width:calc(${String(100 / it.width)}% - 4px)"
                    title="${esc(`${timeWords(it.sMin)}-${timeWords(it.eMin)} ${it.e.title}`)}">
                    <span class="bccal2bt">${esc(timeWords(it.sMin))}</span> ${esc(it.e.title)}</button>`,
                )
                .join('')}
              ${d === today ? `<i class="bccal2now" style="top:${String(Math.round(((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR))}px" aria-hidden="true"></i>` : ''}
            </div>`
          })
          .join('')}
      </div>
    </div>
  </div>`
}

const agenda = (list, from, count, empty) => {
  const days = []
  for (let i = 0; i < 60 && days.length < count; i += 1) {
    const d = addDays(from, i)
    const evs = onDay(list, d)
    if (evs.length > 0) days.push([d, evs])
  }
  if (days.length === 0) return `<p class="bccal2empty">${esc(empty)}</p>`
  return `<div class="bccal2agenda">${days
    .map(
      ([d, evs]) => `<section class="bccal2ag">
        <h3 class="bccal2agh${d === todayIso() ? ' is-today' : ''}">${esc(d === todayIso() ? 'Today' : dayWords(d))}</h3>
        ${evs
          .map(
            (e) => `<div class="bccal2agrow">
              <span class="bccal2agt">${e.allDay ? 'all day' : esc(timeWords(e.startMin))}</span>
              ${chip(e, d, false, true)}
              ${e.source === 'google' ? '<span class="bccal2src" title="From Google Calendar">Google</span>' : ''}
            </div>`,
          )
          .join('')}
      </section>`,
    )
    .join('')}</div>`
}

const titleOf = (s) => {
  const c = parseDay(s.cursor)
  if (s.view === 'month') return `${MONTHS[c.getMonth()]} ${String(c.getFullYear())}`
  if (s.view === 'day') return `${DOW_LONG[dowIndex(s.cursor)]} ${String(c.getDate())} ${MONTHS[c.getMonth()]} ${String(c.getFullYear())}`
  const a = parseDay(weekStart(s.cursor))
  const b = parseDay(addDays(weekStart(s.cursor), 6))
  return a.getMonth() === b.getMonth()
    ? `${String(a.getDate())}-${String(b.getDate())} ${MONTHS[a.getMonth()]} ${String(a.getFullYear())}`
    : `${String(a.getDate())} ${MONTHS[a.getMonth()].slice(0, 3)} - ${String(b.getDate())} ${MONTHS[b.getMonth()].slice(0, 3)} ${String(b.getFullYear())}`
}

const toolbar = (s, mode) => `<div class="bccal2bar">
    <span class="bccal2nav">
      <button type="button" class="bccal2btn bccal2btn--icon" data-cal-nav="prev" aria-label="Previous">&lsaquo;</button>
      <button type="button" class="bccal2btn" data-cal-nav="today">Today</button>
      <button type="button" class="bccal2btn bccal2btn--icon" data-cal-nav="next" aria-label="Next">&rsaquo;</button>
    </span>
    <h2 class="bccal2title" aria-live="polite">${esc(titleOf(s))}</h2>
    <span class="bccal2views" role="group" aria-label="View">
      ${['day', 'week', 'month'].map((v) => `<button type="button" class="bccal2btn bccal2btn--seg${s.view === v ? ' is-on' : ''}" data-cal-view="${v}" aria-pressed="${s.view === v ? 'true' : 'false'}">${v.charAt(0).toUpperCase()}${v.slice(1)}</button>`).join('')}
    </span>
    <label class="bccal2scope"><span class="bcvh">Which calendar</span>
      <select data-cal-scope aria-label="Which calendar">
        <option value="project"${s.scope === 'project' ? ' selected' : ''}>This project</option>
        <option value="all"${s.scope === 'all' ? ' selected' : ''}>All projects</option>
        <option value="google"${s.scope === 'google' ? ' selected' : ''}>Google / combined</option>
      </select>
    </label>
    <button type="button" class="bccal2btn bccal2btn--primary" data-cal-new>New event</button>
  </div>
  ${
    mode === 'local'
      ? '<p class="bccal2note" role="status">These events are kept in this browser only. They are not in the office and not in Google Calendar yet.</p>'
      : ''
  }`

/**
 * The calendar for a project, as markup.
 *
 * `full` is the expanded view; otherwise the module's own size decides what it
 * shows. Everything is drawn once and CSS chooses, so resizing never redraws.
 */
export const block = (p, { full = false } = {}) => {
  const s = uiOf(p.slug)
  const ev = eventsFor(p.slug)
  const tasks = s.scope === 'project' ? taskItems(p) : []
  const list = [...ev.list, ...tasks]
  const today = todayIso()
  const days =
    s.view === 'day' ? [s.cursor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart(s.cursor), i))
  const selected = onDay(list, s.sel)
  const loading = ev.state === 'loading' ? '<p class="bccal2status" role="status">Loading events…</p>' : ''
  const failed = ev.state === 'error' ? `<p class="bccal2status bccal2status--bad" role="alert">${esc(`Could not load the events: ${ev.error ?? 'unknown error'}`)}</p>` : ''
  const size = full ? 'large' : (sizes.get(p.slug) ?? 'small')
  return `<div class="bccal2 ${full ? 'bccal2--full' : ''}" data-bc-cal="${esc(p.slug)}" data-size="${size}" data-view="${esc(s.view)}">
    ${size === 'large' ? `<div class="bccal2large">
      ${toolbar(s, ev.mode)}${loading}${failed}
      ${s.view === 'month' ? monthBody(list, s, false) : timeGrid(list, days, s)}
    </div>` : ''}
    ${size === 'medium' ? `<div class="bccal2medium">
      <div class="bccal2minibar">
        <button type="button" class="bccal2btn bccal2btn--icon" data-cal-nav="prev" aria-label="Previous month">&lsaquo;</button>
        <span class="bccal2minititle">${esc(`${MONTHS[parseDay(s.cursor).getMonth()]} ${String(parseDay(s.cursor).getFullYear())}`)}</span>
        <button type="button" class="bccal2btn bccal2btn--icon" data-cal-nav="next" aria-label="Next month">&rsaquo;</button>
        <button type="button" class="bccal2btn bccal2btn--primary bccal2btn--small" data-cal-new>New</button>
      </div>
      ${monthBody(list, { ...s, view: 'month' }, true)}
      <div class="bccal2day"><h3 class="bccal2agh">${esc(s.sel === today ? 'Today' : dayWords(s.sel))}</h3>
        ${selected.length === 0 ? '<p class="bccal2empty">Nothing on this day.</p>' : selected.map((e) => `<div class="bccal2agrow"><span class="bccal2agt">${e.allDay ? 'all day' : esc(timeWords(e.startMin))}</span>${chip(e, s.sel, false, true)}</div>`).join('')}
      </div>
    </div>` : ''}
    ${size === 'small' ? `<div class="bccal2small">
      ${agenda(list, today, 6, 'Nothing coming up.')}
      <button type="button" class="bccal2btn bccal2btn--small" data-cal-new>New event</button>
    </div>` : ''}
  </div>`
}

/* ------------------------------------------------------------------ wiring --- */

/* A dense month needs about 330px under its header before the day's list has room, so below that the agenda is the honest answer. */
const sizeOf = (w, h) => (w >= 560 && h >= 380 ? 'large' : w >= 300 && h >= 380 ? 'medium' : 'small')

const observers = new WeakMap()
/** The size class each project's module was last measured at. Only the matching variant is drawn, so no hidden duplicate controls sit in the page. */
const sizes = new Map()

const fmtTimeInput = (min) => timeWords(min)
const minOfInput = (v) => {
  const [h, m] = String(v || '0:0').split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

let dialog = null
const closeDialog = () => {
  dialog?.remove()
  dialog = null
  document.removeEventListener('keydown', onDialogKey, true)
}
const onDialogKey = (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeDialog()
  }
}

/** The event editor: a dialog on the body, so no module's clipping can hide it. */
const openEditor = (p, existing, seed) => {
  closeDialog()
  const slug = p.slug
  const projects = ctx?.projects?.() ?? []
  const e = existing
  const external = e !== null && !e.editable
  const day = e?.startDay ?? seed?.day ?? todayIso()
  const f = {
    title: e?.title ?? '',
    allDay: e?.allDay ?? seed?.allDay ?? false,
    startDay: day,
    endDay: e?.endDay ?? day,
    startMin: e?.startMin ?? seed?.min ?? 9 * 60,
    endMin: e !== null ? e.endMin : (seed?.min ?? 9 * 60) + 60,
    notes: e?.notes ?? '',
    location: e?.location ?? '',
  }
  dialog = document.createElement('div')
  dialog.className = 'bccal2dlg'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', e === null ? 'New event' : external ? 'Event from Google Calendar' : 'Edit event')
  dialog.innerHTML = `<div class="bccal2back" data-cal-close></div>
    <form class="bccal2form" novalidate>
      <h2 class="bccal2fh">${esc(e === null ? 'New event' : external ? 'Google Calendar event' : 'Event')}</h2>
      <label class="bccal2fl">Title<input name="title" value="${esc(f.title)}" maxlength="200" ${external ? 'disabled' : 'required'} autocomplete="off"></label>
      <label class="bccal2check"><input type="checkbox" name="allDay" ${f.allDay ? 'checked' : ''} ${external ? 'disabled' : ''}> All day</label>
      <div class="bccal2row">
        <label class="bccal2fl">Starts<input type="date" name="startDay" value="${esc(f.startDay)}" ${external ? 'disabled' : ''}></label>
        <label class="bccal2fl bccal2time">At<input type="time" name="startTime" value="${esc(fmtTimeInput(f.startMin))}" ${external ? 'disabled' : ''}></label>
      </div>
      <div class="bccal2row">
        <label class="bccal2fl">Ends<input type="date" name="endDay" value="${esc(f.endDay)}" ${external ? 'disabled' : ''}></label>
        <label class="bccal2fl bccal2time">At<input type="time" name="endTime" value="${esc(fmtTimeInput(f.endMin === 1440 ? 1439 : f.endMin))}" ${external ? 'disabled' : ''}></label>
      </div>
      <label class="bccal2fl">Where<input name="location" value="${esc(f.location)}" maxlength="200" ${external ? 'disabled' : ''}></label>
      <label class="bccal2fl">Notes<textarea name="notes" rows="3" maxlength="2000" ${external ? 'disabled' : ''}>${esc(f.notes)}</textarea></label>
      ${
        external
          ? `<label class="bccal2fl">Belongs to
              <select name="project">
                <option value="">Nowhere yet (stays in Google)</option>
                ${projects.map((q) => `<option value="${esc(q.slug)}"${q.slug === (e.project ?? '') ? ' selected' : ''}>${esc(q.name)}</option>`).join('')}
              </select></label>
             ${e.url ? `<a class="bccal2link" href="${esc(e.url)}" target="_blank" rel="noopener">Open in Google Calendar</a>` : ''}`
          : `<p class="bccal2hint">${esc(
              modeOfSlug(slug) === 'office'
                ? 'This event belongs to this project and is sent to Google Calendar when Google is connected.'
                : modeOfSlug(slug) === 'sample'
                  ? 'Prototype data: nothing here is saved anywhere.'
                  : 'Kept in this browser only until the office is updated.',
            )}</p>`
      }
      <p class="bccal2err" role="alert" hidden></p>
      <div class="bccal2acts">
        ${e !== null && !external ? '<button type="button" class="bccal2btn bccal2btn--danger" data-cal-del>Delete</button>' : ''}
        <span class="bccal2sp"></span>
        <button type="button" class="bccal2btn" data-cal-close>Cancel</button>
        <button type="submit" class="bccal2btn bccal2btn--primary">${external ? 'Save' : e === null ? 'Add event' : 'Save'}</button>
      </div>
    </form>`
  document.body.append(dialog)
  document.addEventListener('keydown', onDialogKey, true)
  const form = dialog.querySelector('form')
  const err = dialog.querySelector('.bccal2err')
  const say = (m) => {
    err.textContent = m
    err.hidden = m === ''
  }
  const sync = () => {
    const all = form.elements.allDay.checked
    for (const n of ['startTime', 'endTime']) form.elements[n].closest('.bccal2time').hidden = all
  }
  form.elements.allDay.addEventListener('change', sync)
  sync()
  for (const b of dialog.querySelectorAll('[data-cal-close]')) b.addEventListener('click', closeDialog)
  dialog.querySelector('[data-cal-del]')?.addEventListener('click', async () => {
    const r = await write(slug, 'delete', { id: e.id })
    if (r.error) say(r.error)
    else closeDialog()
  })
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    say('')
    if (external) {
      const target = form.elements.project.value
      const r =
        target === ''
          ? await write(slug, 'unassign', { id: e.id })
          : await write(slug, 'assign', { id: e.id, project: target })
      if (r.error) say(r.error)
      else closeDialog()
      return
    }
    const title = form.elements.title.value.trim()
    if (title === '') {
      say('Give the event a title.')
      form.elements.title.focus()
      return
    }
    const next = {
      id: e?.id,
      title,
      allDay: form.elements.allDay.checked,
      startDay: form.elements.startDay.value || todayIso(),
      endDay: form.elements.endDay.value || form.elements.startDay.value || todayIso(),
      startMin: minOfInput(form.elements.startTime.value),
      endMin: minOfInput(form.elements.endTime.value),
      notes: form.elements.notes.value,
      location: form.elements.location.value,
    }
    if (!next.allDay && (next.endDay < next.startDay || (next.endDay === next.startDay && next.endMin <= next.startMin))) {
      say('The event has to end after it starts.')
      return
    }
    const r = await write(slug, e === null ? 'add' : 'update', next)
    if (r.error) say(r.error)
    else closeDialog()
  })
  form.elements[external ? 'project' : 'title'].focus()
}

const modeOfSlug = (slug) => modeOf(slug)

/** Attach the calendar's behaviour inside a freshly drawn root. */
export const wire = (root) => {
  for (const el of root.querySelectorAll('[data-bc-cal]')) {
    const slug = el.dataset.bcCal
    const p = ctx?.projects?.().find((q) => q.slug === slug) ?? { slug, tasks: [] }
    const s = uiOf(slug)
    const redraw = () => {
      remember(slug)
      ctx?.render?.()
    }

    /* Size: measured, and written where CSS can read it. Expanded views stay large. */
    if (!el.classList.contains('bccal2--full')) {
      const host = el.closest('.bcmodbody') ?? el.parentElement
      const apply = () => {
        const r = host.getBoundingClientRect()
        const z = Number.parseFloat(globalThis.getComputedStyle(el.closest('.bcstage') ?? document.body).getPropertyValue('--bc-zoom')) || 1
        const now = sizeOf(r.width / z, r.height / z)
        if (r.width < 8 || now === (sizes.get(slug) ?? 'small')) return
        /* Never redraw in the middle of a drag: the redraw would take the pointer's capture with it. The drag's end asks again. */
        if (document.documentElement.classList.contains('bc-dragging')) return
        /* A different size is a different drawing: remember it and draw again, once. */
        sizes.set(slug, now)
        ctx?.render?.()
      }
      apply()
      if (typeof ResizeObserver === 'function') {
        observers.get(el)?.disconnect()
        const ro = new ResizeObserver(apply)
        ro.observe(host)
        observers.set(el, ro)
      }
    }

    for (const b of el.querySelectorAll('[data-cal-nav]')) {
      b.addEventListener('click', () => {
        const how = b.dataset.calNav
        const step = how === 'next' ? 1 : -1
        if (how === 'today') {
          s.cursor = todayIso()
          s.sel = s.cursor
        } else if (s.view === 'month' || el.dataset.size === 'medium') {
          s.cursor = addMonths(s.cursor, step)
          s.sel = s.cursor
        } else s.cursor = addDays(s.cursor, step * (s.view === 'week' ? 7 : 1))
        redraw()
      })
    }
    for (const b of el.querySelectorAll('[data-cal-view]')) {
      b.addEventListener('click', () => {
        s.view = b.dataset.calView
        redraw()
      })
    }
    el.querySelector('[data-cal-scope]')?.addEventListener('change', (e) => {
      s.scope = e.target.value
      redraw()
    })
    for (const b of el.querySelectorAll('[data-cal-pick]')) {
      b.addEventListener('click', () => {
        s.sel = b.dataset.calPick
        if (el.dataset.size === 'large' || b.closest('.bccal2tghead') !== null) {
          s.cursor = s.sel
          if (b.closest('.bccal2tghead') !== null && s.view === 'week') s.view = 'day'
          else if (s.view === 'month' && el.dataset.size === 'large') s.view = 'day'
        }
        redraw()
      })
    }
    for (const b of el.querySelectorAll('[data-cal-open-day]')) {
      b.addEventListener('click', () => {
        s.cursor = b.dataset.calOpenDay
        s.sel = s.cursor
        s.view = 'day'
        redraw()
      })
    }
    for (const b of el.querySelectorAll('[data-cal-new]')) {
      b.addEventListener('click', () => {
        openEditor(p, null, { day: s.sel })
      })
    }
    for (const b of el.querySelectorAll('[data-cal-ev]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        const found = eventsFor(slug).list.find((x) => x.id === b.dataset.calEv)
        if (found !== undefined) openEditor(p, found, null)
      })
    }
    /* Pressing an empty hour in Day or Week starts an event at that hour. */
    for (const col of el.querySelectorAll('[data-cal-slot]')) {
      col.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-cal-ev]') !== null) return
        const r = col.getBoundingClientRect()
        const z = r.height / (24 * HOUR)
        const min = Math.max(0, Math.min(23 * 60, Math.round(((e.clientY - r.top) / z / HOUR) * 60 / 15) * 15))
        openEditor(p, null, { day: col.dataset.calDay, min })
      })
    }
    /* A time grid opens at the working day rather than at midnight. */
    const sc = el.querySelector('[data-cal-scroll]')
    if (sc !== null && sc.dataset.set !== '1') {
      sc.scrollTop = 7 * HOUR
      sc.dataset.set = '1'
    }
  }
}

/** Ask every calendar module whether its size class has changed (after a drag or resize ends). */
export const recheck = () => {
  for (const el of document.querySelectorAll('.bcstage [data-bc-cal]')) {
    const host = el.closest('.bcmodbody') ?? el.parentElement
    const slug = el.dataset.bcCal
    const r = host.getBoundingClientRect()
    const z = Number.parseFloat(globalThis.getComputedStyle(el.closest('.bcstage') ?? document.body).getPropertyValue('--bc-zoom')) || 1
    const now = sizeOf(r.width / z, r.height / z)
    if (r.width >= 8 && now !== (sizes.get(slug) ?? 'small')) {
      sizes.set(slug, now)
      ctx?.render?.()
      return
    }
  }
}

export { sizeOf }
