/*
  THE TO-DO PORT.

  Grant: *"The To-dos system is intended to interface with Vikunja. Architect
  the To-do implementation accordingly from the outset. Do not build a
  disconnected visual mock-up that subsequently needs to be rebuilt for Vikunja
  integration."*

  So the To-dos interface talks to THIS, and never to `act('task_state', …)`.
  One module names the operations a to-do interface needs; an ADAPTER satisfies
  them. Today the office's own task API is the adapter. A Vikunja adapter is a
  second implementation of this same surface and changes nothing above it.

  ## The mapping, taken from Vikunja's own OpenAPI document

  Fetched from `try.vikunja.io/api/v1/docs.json` rather than remembered, because
  CLAUDE.md records what guessing a column name costs and guessing another
  product's API is the same mistake with a network in between.

    port          this office (public.tasks)      Vikunja (models.Task)
    id            task_id (uuid)                  id (integer)
    title         title                           title
    note          detail                          description
    done          state = 'done'                  done (boolean)
    due           due_on (date)                   due_date (timestamp)
    starts        starts_on                       start_date
    assignee      assignee_staff (uuid)           assignees[] (users)
    labels        labels[]                        labels[]
    list          parent_task_id of a milestone   project_id / bucket_id
    stage         state enum                      bucket_id

  ## The two places a naive implementation WOULD need rewriting

  1. **A LIST IS NOT THE SAME KIND OF THING IN THE TWO SYSTEMS.** This office
     models a list as a MILESTONE TASK that other tasks name as their parent
     (0171: *"a milestone is a task with no work of its own that others hang
     off, rather than a separate table"*). Vikunja models it as a nested
     PROJECT (`parent_project_id`) or as a kanban BUCKET. So the port carries
     an OPAQUE list id and never exposes "the parent task" — an interface built
     on `parent_task_id` is one that has to be rebuilt, and that is precisely
     what Grant asked to avoid.

  2. **PRIORITY RUNS THE OTHER WAY.** In `public.tasks` a LOWER number is more
     important (the live rows are 20 and 100). In Vikunja a HIGHER number is.
     The port speaks in words — `urgent | high | normal | low` — so neither
     side's convention leaks into the interface, and the adapter that gets it
     backwards is the only thing that can be wrong.

  Nothing here is a mock: every call below reaches the office's real writers.
*/

import { act } from '../office.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

/* ======================================================================== *
 * The port: what a to-do interface needs, in its own vocabulary
 * ======================================================================== */

/** Every list on a project, with the tasks under it. Opaque list ids. */
export const lists = (p) => {
  const tasks = (p.tasks ?? []).filter((t) => t.milestone !== true)
  const named = new Map()
  for (const m of p.modules ?? []) {
    named.set(m.id ?? m.name, { id: String(m.id ?? m.name), name: m.name, tasks: [] })
  }
  const loose = []
  for (const t of tasks) {
    const bucket = t.parent !== null && t.parent !== undefined ? named.get(t.parent) : undefined
    if (bucket !== undefined) bucket.tasks.push(task(t))
    else loose.push(task(t))
  }
  const out = [...named.values()].filter((l) => l.tasks.length > 0)
  if (loose.length > 0) out.push({ id: '', name: 'Not in a list', tasks: loose, loose: true })
  return out
}

/*
  One task in the port's vocabulary. `ref` is what every write below takes: it
  is the office's uuid today and would be Vikunja's integer id tomorrow, and
  nothing above this file is allowed to care which.
*/
const PRIORITY = (n) => {
  const v = Number(n ?? 100)
  if (v <= 10) return 'urgent'
  if (v <= 20) return 'high'
  if (v <= 50) return 'normal'
  return 'low'
}

export const task = (t) => ({
  ref: t.id ?? '',
  title: t.title ?? '',
  note: t.note ?? '',
  done: (t.state_raw ?? t.state) === 'done' || t.state_raw === 'cancelled',
  stage: stageOf(t),
  due: t.due_on ?? null,
  dueWords: t.due ?? '',
  starts: t.starts_on ?? null,
  assignee: t.who ?? null,
  labels: Array.isArray(t.labels) ? t.labels : [],
  priority: PRIORITY(t.priority),
  blocked: t.blocked ?? null,
  mine: t.mine === true,
  /*
    WRITEABLE is not the same as OPENABLE. A prototype row carries no id, so it
    can be read and drawn and not changed — the distinction `taskKey` already
    makes one layer up, restated here because every write below needs it.
  */
  writeable: typeof t.id === 'string' && t.id !== '',
})

export const STAGES = ['todo', 'doing', 'blocked', 'done']

export const stageOf = (t) => {
  const raw = t.state_raw ?? (t.state === 'done' ? 'done' : t.state === 'doing' ? 'doing' : 'todo')
  if (raw === 'blocked' || (t.blocked && raw !== 'done')) return 'blocked'
  return raw === 'cancelled' ? 'done' : raw
}

/* ======================================================================== *
 * The adapter: the office's own task API
 *
 * Every function returns the office's answer, or throws with its words. None
 * of them invents a local store — there is one set of records and this is a
 * view over it, which is ADR-0041's rule and the reason a Vikunja adapter can
 * replace this file's second half alone.
 * ======================================================================== */

/** Mark done, or put back. The single most-used write in the whole interface. */
export const setDone = async (ref, done) =>
  act('task_state', { p_task_id: ref, p_state: done ? 'done' : 'todo' })

/** Move between stages. Blocking needs a reason, so it is not offered here. */
export const setStage = async (ref, stage) => {
  if (stage === 'blocked') {
    throw new Error('say what it is blocked on — that happens on the task itself')
  }
  return act('task_state', { p_task_id: ref, p_state: stage })
}

/**
 * Add a to-do, optionally into a list.
 *
 * Two calls, because the office's creator takes no parent and its updater
 * does. A Vikunja adapter would be one call — `PUT /projects/{id}/tasks` —
 * which is exactly the kind of difference a port exists to absorb.
 */
export const add = async ({ project, list, title, due, assignee }) => {
  const made = await act('task_add', {
    p_project: project,
    p_title: title,
    p_due_on: due === '' || due === undefined ? null : due,
    p_assignee: assignee === '' || assignee === undefined ? null : assignee,
    p_milestone: false,
  })
  const ref = made?.id ?? made?.task_id ?? ''
  if (list !== undefined && list !== '' && ref !== '') {
    await act('task_update', { p_task_id: ref, p_parent: list })
  }
  return { ...made, ref }
}

/** A new list. Here that is a milestone; in Vikunja it is a project or bucket. */
export const addList = async ({ project, name }) =>
  act('task_add', { p_project: project, p_title: name, p_milestone: true })

/**
 * Change a field. `clear` is how a field is EMPTIED, because null means
 * "leave it alone" to the office's updater — a distinction Vikunja does not
 * make and the adapter would therefore collapse.
 */
export const update = async (ref, patch = {}, clear = []) =>
  act('task_update', {
    p_task_id: ref,
    ...(patch.title === undefined ? {} : { p_title: patch.title }),
    ...(patch.note === undefined ? {} : { p_detail: patch.note }),
    ...(patch.due === undefined ? {} : { p_due_on: patch.due }),
    ...(patch.assignee === undefined ? {} : { p_assignee: patch.assignee }),
    ...(patch.list === undefined ? {} : { p_parent: patch.list }),
    ...(clear.length === 0 ? {} : { p_clear: clear }),
  })

/** Whether this browser may write at all. */
export const canWrite = () => ctx?.canWrite?.() === true
