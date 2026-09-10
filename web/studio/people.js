/*
  Labels you define, and fields you add.

  Grant: *"metadata fields should be dynamically added/removed on the UI
  anyway"* and *"the ability to attach tags/labels and let me define those
  labels myself in the UI (e.g. client, coach, colleague, lead)"*.

  Both are the same underlying point: the shape of a contact is his, not mine.
  A fixed set of fields and a fixed set of categories is a form somebody else
  designed, and it is wrong the first time he wants to record something I did
  not think of — a Zoom handle, a partner's name, which cohort someone was in.

  ## What is fixed and what is not

  Fixed: name, and the handful of fields every contact record needs to be
  reachable — email, phone, where. Those earn their place by being universal.

  Not fixed: labels, and any field beyond that. Both live here, both are
  editable, and neither requires a deploy.

  ## Persistence

  localStorage in the prototype, because the point of M0 is proving the
  experience before building the machinery. The real shape is filed as #25 —
  `contact_labels`, `contact_label_links` and a `fields jsonb` column — and the
  UI here is deliberately written against a store interface so swapping the
  backing is one file.
*/

const KEY = 'studio.people'

/** The labels Grant starts with. Every one of them is his to rename or delete. */
const SEED_LABELS = [
  { id: 'client', name: 'Client', hue: 'p-moss' },
  { id: 'lead', name: 'Lead', hue: 'p-amber' },
  { id: 'coach', name: 'Coach', hue: 'p-iris' },
  { id: 'colleague', name: 'Colleague', hue: 'p-slate' },
  { id: 'referrer', name: 'Referrer', hue: 'p-rust' },
]

export const HUES = ['p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum']

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      labels: Array.isArray(raw.labels) && raw.labels.length > 0 ? raw.labels : SEED_LABELS,
      // { [contactName]: string[] } — keyed by name in the prototype; by
      // contact_id once #25 lands.
      applied: raw.applied ?? {},
      // { [contactName]: [{ label, value }] }
      fields: raw.fields ?? {},
    }
  } catch {
    return { labels: SEED_LABELS, applied: {}, fields: {} }
  }
}

const write = (state) => {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* not fatal */ }
  return state
}

export const labels = () => read().labels
export const labelsOn = (name) => {
  const s = read()
  return (s.applied[name] ?? []).map((id) => s.labels.find((l) => l.id === id)).filter(Boolean)
}
export const fieldsOn = (name) => read().fields[name] ?? []

/** A new label. The id is derived once and never changes, so a rename is safe. */
export function addLabel(name, hue) {
  const s = read()
  const id = `l${Date.now().toString(36)}`
  s.labels = [...s.labels, { id, name, hue: hue ?? HUES[s.labels.length % HUES.length] }]
  write(s)
  return id
}

export function renameLabel(id, name) {
  const s = read()
  s.labels = s.labels.map((l) => (l.id === id ? { ...l, name } : l))
  return write(s)
}

/** Deleting a label removes it from everyone, rather than leaving orphan ids. */
export function removeLabel(id) {
  const s = read()
  s.labels = s.labels.filter((l) => l.id !== id)
  for (const who of Object.keys(s.applied)) {
    s.applied[who] = (s.applied[who] ?? []).filter((x) => x !== id)
  }
  return write(s)
}

export function toggleLabel(name, id) {
  const s = read()
  const on = new Set(s.applied[name] ?? [])
  on.has(id) ? on.delete(id) : on.add(id)
  s.applied[name] = [...on]
  return write(s)
}

export function addField(name, label, value) {
  const s = read()
  s.fields[name] = [...(s.fields[name] ?? []), { label, value }]
  return write(s)
}

export function removeField(name, index) {
  const s = read()
  s.fields[name] = (s.fields[name] ?? []).filter((_, i) => i !== index)
  return write(s)
}
