/*
  What the team produced, and what it was asked.

  Grant: *"I need all the files, et cproduced by the team to have its own
  workspaced. / so there should be a dedciate dashboard per project as its own
  tab where the teams inputs and outputs can esaily be seen and coordinated"*.

  ## Why this is not the documents shelf with a filter

  A file Oliver made and a file Grant uploaded look identical on the shelf, one
  line of small text apart. That loses the only fact that matters about a
  produced file: something is waiting for him to look at it. Separating them is
  not tidiness — it is the difference between a library and an in-tray.

  ## Why a row pairs the request with the artifact

  The activity feed shows outputs with no visible request. The job queue shows
  requests with no visible output. Neither answers *"why does this file exist"*,
  which is the question that makes an artifact usable. A row here is:

      what was asked  →  who took it  →  what came back  →  what you do now

  ## The review gate

  An agent producing something must never silently change the project. Output
  lands in `review`; approving is what moves it in. That gate IS the
  coordination in Grant's sentence — the two-column layout is just how you see
  it. See `docs/spec/project-dashboard-ia-2026-09-10.md` §4.
*/

const KEY = 'studio.workspace'

const store = () => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

const put = (next) => {
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* not fatal */ }
}

/** Grant's decision on one output, if he has made one. */
export const decision = (slug, id) => store()[`${slug}/${id}`] ?? null

export function decide(slug, id, verdict) {
  const next = store()
  if (verdict === null) delete next[`${slug}/${id}`]
  else next[`${slug}/${id}`] = verdict
  put(next)
}

/**
 * The rows for a project: request, worker, artifact, state.
 *
 * `state` is the artifact's own state overlaid with Grant's decision, so an
 * approved item reads as approved without the mock data having to be rewritten.
 */
export function rows(project) {
  return (project.requests ?? []).map((r) => ({
    ...r,
    state: decision(project.slug, r.id) ?? r.state,
  }))
}

/** Split for the two halves of the tab. Waiting first — it is the reason to look. */
export function split(project) {
  const all = rows(project)
  return {
    all,
    waiting: all.filter((r) => r.state === 'review'),
    working: all.filter((r) => r.state === 'working'),
    settled: all.filter((r) => r.state === 'approved' || r.state === 'discarded'),
  }
}

/** Approved outputs join the project's documents. Nothing else does. */
export const approved = (project) =>
  rows(project).filter((r) => r.state === 'approved' && r.output)

export const STATE = {
  working: { name: 'In hand', hue: 'p-amber' },
  review: { name: 'Needs you', hue: 'p-rust' },
  approved: { name: 'In the project', hue: 'p-moss' },
  discarded: { name: 'Dropped', hue: 'p-slate' },
}
