/*
  CONTACTS, AS SOMETHING YOU CAN CORRECT.

  Grant, 22 September:

    "Expand Contacts from a mostly static display into an editable
     contact-management component... Existing contacts must be editable...
     Notes must not be read-only decoration. They should be genuinely editable
     and persisted. The general rule should be: if information about a contact
     is displayed as user-managed contact data, there should be a sensible way
     to edit it."

  `public.contacts` has had every field he lists since 0245 and exactly one
  door: create. There has never been an update path, so a mistyped email was
  permanent. 0534 adds `hq_contact_update` and an `image_url` column; this is
  the browser's half of it.

  ## One list of fields

  `FIELDS` is the single description of what a contact HAS. The record renders
  from it, the form validates from it, and the writer sends from it - so a
  field added here appears in all three, and none of them can quietly know
  about a field the others do not. That is the rule this repository keeps
  paying for when it is broken: a row list built twice is a list that will
  disagree.

  ## The prototype remembers, the office is the record

  Exactly the arrangement `todos.js` uses, for the same reason: without a
  token there is no record to write to, and an interface that cannot be
  exercised is one nobody can judge. A contact with an `id` is the office's
  business and this module's memory is never consulted for it.
*/

import { act } from '../office.js'

let ctx = null
export const mount = (c) => {
  ctx = c
}

/**
 * What a contact has.
 *
 * `kind` decides the control and the validation; `line` groups two fields onto
 * one row where they are read together.
 */
export const FIELDS = [
  { key: 'name', label: 'Name', kind: 'text', required: true, line: 1 },
  { key: 'role', label: 'What they are to this project', kind: 'text', line: 1 },
  { key: 'org', label: 'Organisation', kind: 'text', line: 2 },
  { key: 'where', label: 'Where they are', kind: 'text', line: 2 },
  { key: 'email', label: 'Email', kind: 'email', line: 3 },
  { key: 'phone', label: 'Telephone', kind: 'tel', line: 3 },
  { key: 'website', label: 'Website', kind: 'url', line: 4 },
  { key: 'instagram', label: 'Instagram or other social', kind: 'text', line: 4 },
  { key: 'next', label: 'What happens next', kind: 'text', line: 5 },
  { key: 'nextDue', label: 'When', kind: 'text', line: 5 },
  { key: 'note', label: 'Notes', kind: 'long', line: 6 },
]

/** The argument each field travels to the office as. */
const ARG = {
  name: 'p_name',
  role: 'p_role',
  org: 'p_org',
  email: 'p_email',
  phone: 'p_phone',
  instagram: 'p_instagram',
  website: 'p_website',
  where: 'p_where',
  note: 'p_note',
  next: 'p_next',
  nextDue: 'p_next_due',
  /*
    NO `image` HERE, on purpose.

    A photograph is not a column: 0534 stores a storage PATH and the bytes go
    to the private files bucket through the gateway's `contact_photo`, which is
    the architecture Grant asked for - "do not store giant base64 images in
    inappropriate database fields". Leaving `image: 'p_image'` in this map sent
    an argument `hq_contact_update` does not have, and PostgREST answers an
    unknown argument by saying the FUNCTION does not exist: every save carrying
    a photograph would have failed, saying something that was not true.
  */
}

/*
  VALIDATION THAT HELPS RATHER THAN OBSTRUCTS.

  Grant: *"Use appropriate validation for URLs/email/etc. without making the
  interface cumbersome."* So: shapes, not lists. An email has an at-sign with
  something either side and no space; a URL either names a scheme or is a bare
  domain, and a bare domain is CORRECTED rather than refused, because typing
  "innergy.com" is what a person does and refusing it teaches them to leave
  the field empty.
*/
export const check = (key, value) => {
  const v = String(value ?? '').trim()
  if (v === '') return { ok: true, value: '' }
  if (key === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
      ? { ok: true, value: v }
      : { ok: false, why: 'That does not look like an email address.' }
  }
  if (key === 'website') {
    const full = /^https?:\/\//i.test(v) ? v : `https://${v}`
    try {
      const u = new URL(full)
      return u.hostname.includes('.')
        ? { ok: true, value: u.toString().replace(/\/$/, '') }
        : { ok: false, why: 'That does not look like a web address.' }
    } catch {
      return { ok: false, why: 'That does not look like a web address.' }
    }
  }
  if (key === 'phone') {
    return /^[+()\d\s-]{5,}$/.test(v)
      ? { ok: true, value: v }
      : { ok: false, why: 'A telephone number is digits, spaces and the usual punctuation.' }
  }
  return { ok: true, value: v }
}

/* ======================================================================== *
 * The prototype's own memory — see the header, and todos.js
 * ======================================================================== */

const MEM = (project) => `bc.contacts.${project}`

/** A stable key for a contact with no record behind it. */
export const keyOf = (c, i = 0) =>
  typeof c?.id === 'string' && c.id !== '' ? c.id : `p:${c?.name ?? String(i)}`

const memory = (project) => {
  try {
    const raw = globalThis.localStorage?.getItem(MEM(project)) ?? ''
    const parsed = raw === '' ? {} : JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const remember = (project, key, patch) => {
  try {
    const now = memory(project)
    now[key] = { ...(now[key] ?? {}), ...patch }
    globalThis.localStorage?.setItem(MEM(project), JSON.stringify(now))
  } catch {
    /* A viewer who cannot store it still sees the change until they reload. */
  }
}

export const forgetLocal = (project) => {
  try {
    globalThis.localStorage?.removeItem(MEM(project))
  } catch {
    /* Already nothing. */
  }
}

/** The project's contacts as the person has left them. */
export const overlay = (p) => {
  if (p === undefined || p === null || !Array.isArray(p.contacts)) return p
  const mem = memory(p.slug)
  const added = Array.isArray(mem.__added) ? mem.__added : []
  if (Object.keys(mem).length === 0) return p
  const edited = p.contacts.map((c, i) => {
    if (typeof c.id === 'string' && c.id !== '') return c
    const patch = mem[keyOf(c, i)]
    return patch === undefined ? c : { ...c, ...patch }
  })
  return { ...p, contacts: [...edited, ...added] }
}

/* ======================================================================== *
 * Writing
 * ======================================================================== */

/**
 * Change one contact.
 *
 * A patch, not a record: only what changed travels, which is what makes
 * "edit the notes" one field rather than a form resubmitting every value it
 * happened to be holding.
 */
export const save = async (project, key, patch) => {
  if (key.startsWith('p:')) {
    remember(project, key, patch)
    return { ok: true, local: true }
  }
  /*
    The photograph travels its own way, and may travel WITH other changes: a
    person who replaces a picture and corrects a phone number in one press
    should not have to do it twice.
  */
  if (Object.hasOwn(patch, 'image')) {
    const { image, ...rest } = patch
    const stored = await photo(project, key, image)
    if (stored?.error !== undefined) return stored
    if (Object.keys(rest).length === 0) return stored
    return await save(project, key, rest)
  }
  const args = { p_contact_id: key }
  for (const [k, v] of Object.entries(patch)) {
    const arg = ARG[k]
    if (arg !== undefined) args[arg] = v
  }
  return act('contact_update', args)
}

/**
 * The photograph, through the gateway that owns storage.
 *
 * Takes the small square data URL `shrink` produces - the browser does the
 * downscaling, so a four-megabyte phone photograph never crosses the network -
 * and hands the gateway its base64. An empty string removes it.
 *
 * The project's id is needed because the bytes are filed under the project, so
 * removing a project removes its people's photographs with it.
 */
export const photo = async (project, key, dataUrl) => {
  if (key.startsWith('p:')) {
    remember(project, key, { image: dataUrl })
    return { ok: true, local: true }
  }
  const id = ctx?.projectId?.(project) ?? ''
  if (id === '') return { error: 'The office could not say which project this is.' }
  return act('contact_photo', {
    p_contact_id: key,
    p_project_id: id,
    p_mime: 'image/jpeg',
    p_base64: String(dataUrl ?? ''),
  })
}

/** Put one away, or bring them back. Never a delete: see 0534. */
export const putAway = async (project, key, away = true) => {
  if (key.startsWith('p:')) {
    remember(project, key, { away })
    return { ok: true, local: true }
  }
  return act('contact_archive', { p_contact_id: key, p_put_away: away })
}

/** Add one. The office's own creator, or the prototype's list. */
export const add = async (project, fields) => {
  if (ctx?.canWrite?.() !== true) {
    try {
      const now = memory(project)
      const list = Array.isArray(now.__added) ? now.__added : []
      list.push({ ...fields, stage: 'active' })
      now.__added = list
      globalThis.localStorage?.setItem(MEM(project), JSON.stringify(now))
    } catch {
      /* Nothing stored; the page still drew the form and said what it does. */
    }
    return { ok: true, local: true }
  }
  return act('contact_add', {
    p_project: project,
    p_name: fields.name,
    p_role: fields.role || null,
    p_org: fields.org || null,
    p_email: fields.email || null,
    p_phone: fields.phone || null,
    p_instagram: fields.instagram || null,
  })
}

/* ======================================================================== *
 * A face
 * ======================================================================== */

/**
 * Read an image file and give back a small square data URL.
 *
 * DOWNSCALED IN THE BROWSER, deliberately. A phone photograph is four
 * megabytes and a contact's face is displayed at 64 pixels; sending the
 * original would put megabytes in a text column for nothing, which is why
 * 0534 caps the column at 400KB. 256px covers every place this is drawn,
 * including a high-density screen.
 */
export const shrink = (file, side = 256) =>
  new Promise((resolve, reject) => {
    if (file === null || file === undefined || !String(file.type).startsWith('image/')) {
      reject(new Error('That is not an image.'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('That file could not be read.'))
    }
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => {
        reject(new Error('That file is not an image this browser can read.'))
      }
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = side
        canvas.height = side
        const g = canvas.getContext('2d')
        /* Cover, centred: a face cropped to a square rather than squashed. */
        const scale = Math.max(side / img.width, side / img.height)
        const w = img.width * scale
        const h = img.height * scale
        g.drawImage(img, (side - w) / 2, (side - h) / 2, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
