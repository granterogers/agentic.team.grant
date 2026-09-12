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

/*
  The labels a contact shows, which is not the same as the labels applied to
  them (#107).

  Every chip above the Contacts grid read `0` while four contacts underneath it
  plainly said Referrer, Prospective client, Client and Past client. Nothing
  was broken: `role` is a field on the contact and a label is a separate thing
  nobody had ever applied, so both halves were telling the truth and the page
  as a whole was not. A chip reading zero says "there is nobody in this
  category", which was false, and a filter you believe is empty is a filter you
  never press.

  So a contact with no labels of its own shows the ones its ROLE already names.
  This is not invented data — `role` is on the record and on the card two lines
  below. It is reading what is there rather than asking to be told twice.

  The moment Grant applies a label to someone, his choice is the whole answer
  for that person: `applied` is checked first and a derived set never merges
  into it. Otherwise removing a label he did not choose would be impossible,
  which is the trap every "smart default" falls into.
*/
export const labelsFor = (contact) => {
  /*
    `undefined`, not "empty".

    A contact Grant has edited down to no labels at all must stay at none —
    falling back on an empty array would put the derived ones straight back and
    the label he removed would be unremovable. So the fallback happens only
    when nobody has ever decided.
  */
  if (read().applied[contact.name] !== undefined) return labelsOn(contact.name)
  const own = labelsOn(contact.name)
  if (own.length > 0) return own
  const said = `${contact.role ?? ''} ${contact.kind ?? ''}`.toLowerCase()
  if (said.trim() === '') return []
  // Whole words only: "Client" must not match inside another word, and a label
  // someone renames to something unrelated simply stops matching.
  return read().labels.filter((l) =>
    new RegExp(`\\b${l.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(said),
  )
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

/*
  `contact`, not `name`, so the first touch can start from what is on screen.

  Toggling a label off on a contact whose labels are DERIVED from its role
  (#107) was a no-op: the derived set is not in `applied`, so removing from an
  empty set removed nothing and the chip came straight back. Whichever way that
  is fixed, the rule has to be the same one a person would expect — the moment
  you touch a contact's labels they become yours, starting from exactly what
  you were looking at.
*/
export function toggleLabel(contact, id) {
  const name = typeof contact === 'string' ? contact : contact.name
  const s = read()
  const start =
    s.applied[name] ??
    (typeof contact === 'string' ? [] : labelsFor(contact).map((l) => l.id))
  const on = new Set(start)
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
