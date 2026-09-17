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

  ## Persistence — the office, since #110 and migration 0285

  This used to be `localStorage`, and its own header used to promise that "the
  UI here is deliberately written against a store interface so swapping the
  backing is one file". This is that file, and the promise held: every read
  still goes through `labels()`, `labelsFor()` and `fieldsOn()`, and every write
  through `addLabel()`, `renameLabel()`, `removeLabel()`, `setLabels()` and
  `setFields()`.

  ADR-0021 is why. Grant, on #81: *"he uses more than one device and the whole
  point of arranging it is that it stays arranged."* A label he invented on the
  laptop was not there on the phone, and one cleared browser lost the lot.

  ## Reads are synchronous, writes are not

  Every renderer in `app.js` calls these while building a template literal, so a
  read cannot be a promise without rewriting the contacts tab. It does not need
  to be: the label set arrives with the rest of the studio payload — one fetch,
  not a second one that can fail on its own — and each contact carries its own
  labels and fields. So a read is a lookup in what the page already holds.

  Writes go to `office.act`, which is the one chokepoint undo hooks (#118). The
  caller awaits, then redraws.

  ## Keyed on the contact, never on the name

  The `localStorage` version keyed `applied` and `fields` on the contact's NAME,
  which was wrong the first time two people shared one. Both now travel on the
  contact record itself, so there is nothing left to key.
*/

import * as office from './office.js'

/** The six the design system defines. A label he invents looks like it belongs. */
export const HUES = ['p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum']

/*
  The label set Grant defined, mirrored from the studio payload.

  A module-level array rather than a getter over `data.js` because `people.js`
  is imported by `app.js` and importing `data.js` back would be a cycle. It is
  replaced in place, so a renderer holding a reference sees the new set.
*/
const LABELS = []

/**
 * Take the label set from the studio payload.
 *
 * Called by `data.js` on every hydrate. Absent — the prototype, or an office
 * that did not answer — leaves whatever is there, because an empty label set
 * renders as a contacts tab with no categories at all and that is
 * indistinguishable from a person who never defined any.
 */
export function hydrate(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return
  LABELS.length = 0
  for (const l of labels) LABELS.push(l)
}

export const labels = () => LABELS

/** The labels actually applied to a contact, resolved against the set. */
export const labelsOn = (contact) =>
  (contact?.labels ?? []).map((id) => LABELS.find((l) => l.id === id)).filter(Boolean)

/*
  The labels a contact SHOWS, which is not the same as the labels applied to
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
  for that person: a derived set never merges into it. Otherwise removing a
  label he did not choose would be impossible, which is the trap every "smart
  default" falls into.
*/
export const labelsFor = (contact) => {
  /*
    `labelsSet`, not "has no labels".

    A contact Grant has edited down to no labels at all must stay at none —
    falling back on an empty array would put the derived ones straight back and
    the label he removed would be unremovable. So the fallback happens only when
    nobody has ever decided, which is a flag on the contact (0285) because an
    absent link row says both things at once.
  */
  if (contact?.labelsSet === true) return labelsOn(contact)
  const own = labelsOn(contact)
  if (own.length > 0) return own
  const said = `${contact?.role ?? ''} ${contact?.kind ?? ''}`.toLowerCase()
  if (said.trim() === '') return []
  // Whole words only: "Client" must not match inside another word, and a label
  // someone renames to something unrelated simply stops matching.
  return LABELS.filter((l) =>
    new RegExp(`\\b${l.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(said),
  )
}

export const fieldsOn = (contact) => contact?.fields ?? []

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
//
// Each returns what the office said, and each updates the mirror from that
// answer rather than from what was asked for — the RPC is the authority (§5),
// and it is the half that knows the new id and refuses a duplicate name.

/** A new label. Returns its id, or throws with the office's own words. */
export async function addLabel(name, hue) {
  const said = await office.act('contact_label_add', { p_name: name, p_hue: hue ?? null })
  hydrate(said?.labels)
  return said?.label
}

export async function renameLabel(id, name) {
  const said = await office.act('contact_label_rename', { p_label_id: id, p_name: name })
  hydrate(said?.labels)
  return said
}

/** Deleting a label removes it from everyone, rather than leaving orphan ids. */
export async function removeLabel(id) {
  const said = await office.act('contact_label_remove', { p_label_id: id })
  /*
    `hydrate` refuses an empty set, and deleting the last label produces exactly
    that — so the emptying is done here, explicitly, where it is a fact rather
    than a failed fetch.
  */
  if (Array.isArray(said?.labels)) {
    LABELS.length = 0
    for (const l of said.labels) LABELS.push(l)
  }
  return said
}

/**
 * Toggle one label on a contact, sending the whole resulting set.
 *
 * A replacement rather than a delta, matching 0250's `p_panels`: idempotent,
 * exactly invertible, and impossible to half-apply.

  Toggling a label off on a contact whose labels are DERIVED from its role
  (#107) was a no-op: the derived set was not stored, so removing from an empty
  set removed nothing and the chip came straight back. The rule has to be the
  one a person would expect — the moment you touch a contact's labels they
  become yours, starting from exactly what you were looking at. That is what
  computing the start from `labelsFor` does, and the office records that a
  decision now exists.
 */
export async function toggleLabel(contact, id) {
  const on = new Set(labelsFor(contact).map((l) => l.id))
  on.has(id) ? on.delete(id) : on.add(id)
  return setLabels(contact, [...on])
}

export async function setLabels(contact, ids) {
  const said = await office.act('contact_labels_set', {
    p_contact_id: contact.id,
    p_labels: ids,
  })
  // The contact object the sheet is drawing from, so the redraw is immediate
  // rather than waiting on the next hydrate.
  contact.labels = Array.isArray(said?.labels) ? said.labels : ids
  contact.labelsSet = true
  return said
}

export async function addField(contact, label, value) {
  return setFields(contact, [...fieldsOn(contact), { label, value }])
}

export async function removeField(contact, index) {
  return setFields(
    contact,
    fieldsOn(contact).filter((_, i) => i !== index),
  )
}

export async function setFields(contact, fields) {
  const said = await office.act('contact_fields_set', {
    p_contact_id: contact.id,
    p_fields: fields,
  })
  contact.fields = Array.isArray(said?.fields) ? said.fields : fields
  return said
}
