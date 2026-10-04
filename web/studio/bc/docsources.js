/*
  DOCUMENTS ARE A VIEW ACROSS SOURCES, NOT A BUCKET.

  Grant, 4 October 2026: Documents is a unified view over a connected Google
  Drive folder, NotebookLM-related material where it is genuinely available,
  files uploaded to the office, documents the team generated, and whatever
  providers come later. It is not the same thing as Supabase storage - an
  external file does not have to be copied in to be searched, read and
  previewed. A very small, quiet indicator says where each one comes from;
  nothing shouts a provider's logo.

  This module is the whole of the "what is this, where is it from, which of
  these are the same thing" logic, kept pure so the same answer drives the
  filter chips, the sort, the indicator and the tests.

  ## Source

  The newer `project_documents` payload names the source outright (`source`).
  The older studio payload carries only a human label in `origin` ("Yours", the
  name of whoever wrote it, or a connector's name), so a source is INFERRED
  from the evidence that is there and never guessed: when nothing says, it is
  `other`, which has no indicator and no filter chip of its own.

  ## Same thing, once

  Two entries are the same logical document only when something says so
  unambiguously: the office named the same `canonical_id`, or both carry the
  same `connector` AND `external_ref`. A title is never evidence - two
  different files called "Report" stay two files, which the tests hold as a
  negative control. Fuzzy merging a person's documents is a worse failure than
  showing a duplicate.

  Comments inside any template literal in this file use plain words.
*/

import { MARKS } from '../logos/marks.js'
import { canWrite, read } from '../office.js'

/** The sources, in the order the filter offers them. */
export const SOURCES = [
  { id: 'drive', name: 'Google Drive', short: 'Drive', mark: 'drive' },
  { id: 'upload', name: 'Uploaded', short: 'Uploaded', mark: null },
  { id: 'generated', name: 'Generated', short: 'Generated', mark: null },
  { id: 'notebook', name: 'NotebookLM', short: 'Notebook', mark: 'notebooklm' },
  { id: 'notion', name: 'Notion', short: 'Notion', mark: 'notion' },
  { id: 'web', name: 'Saved web page', short: 'Web', mark: null },
  { id: 'other', name: 'Other', short: 'Other', mark: null },
]

const nameOfSource = (id) => SOURCES.find((s) => s.id === id)?.name ?? 'Other'

/** The source of one document, from the best evidence it carries. */
export const sourceOf = (d) => {
  const named = String(d?.source ?? '').toLowerCase()
  if (SOURCES.some((s) => s.id === named)) return named
  const connector = String(d?.connector ?? '').toLowerCase()
  if (connector === 'drive' || connector === 'google_drive') return 'drive'
  if (connector === 'notebooklm') return 'notebook'
  if (connector === 'notion') return 'notion'
  if (connector === 'browser') return 'web'
  if (connector === 'upload') return 'upload'
  if (d?.origin_kind === 'made' || d?.kind === 'made') return 'generated'
  const label = String(d?.origin ?? '')
  if (label === 'Yours') return 'upload'
  if (/google\s*drive|^drive$/i.test(label)) return 'drive'
  if (/notebook\s*lm|notebook/i.test(label)) return 'notebook'
  if (/notion/i.test(label)) return 'notion'
  if (/web|browser|saved page/i.test(label)) return 'web'
  return 'other'
}

/** The kind of file, in the words a filter uses. */
export const TYPES = [
  { id: 'pdf', name: 'PDFs' },
  { id: 'doc', name: 'Documents' },
  { id: 'sheet', name: 'Spreadsheets' },
  { id: 'slides', name: 'Slides' },
  { id: 'image', name: 'Images' },
  { id: 'audio', name: 'Audio' },
  { id: 'other', name: 'Other' },
]

export const typeOf = (d) => {
  const mime = String(d?.mime ?? d?.mime_type ?? '').toLowerCase()
  const title = String(d?.title ?? '').toLowerCase()
  const kind = String(d?.kind ?? '').toLowerCase()
  if (mime === 'application/pdf' || /\.pdf$/.test(title) || kind === 'pdf') return 'pdf'
  if (mime.startsWith('audio/') || kind === 'audio' || /\.(wav|mp3|m4a|ogg|flac|opus)$/.test(title)) return 'audio'
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic)$/.test(title)) return 'image'
  if (/spreadsheet|excel|csv/.test(mime) || /\.(xlsx?|csv|tsv|ods)$/.test(title)) return 'sheet'
  if (/presentation|powerpoint/.test(mime) || /\.(pptx?|key|odp)$/.test(title)) return 'slides'
  if (/document|text\/|msword|markdown/.test(mime) || /\.(docx?|txt|md|rtf|odt)$/.test(title) || kind === 'doc' || kind === 'made') return 'doc'
  return 'other'
}

/** A document with the fields the controls need worked out once. */
export const enrich = (d) => ({
  ...d,
  src: sourceOf(d),
  typeKey: typeOf(d),
  bytes: Number.isFinite(d?.size_bytes) ? d.size_bytes : Number.isFinite(d?.bytes) ? d.bytes : null,
  modified: d?.modified_at ?? d?.modified ?? null,
})

/**
 * One entry per logical document.
 *
 * Only an explicit identity merges: the same `canonical_id`, or the same
 * (connector, external_ref) pair. The survivor keeps the richest of the
 * entries (the one that holds the file, then the one that was imported) and
 * remembers every source the document is represented through in `alsoIn`.
 */
export const dedupe = (docs) => {
  const keyOf = (d) => {
    if (d?.canonical_id !== undefined && d.canonical_id !== null && d.canonical_id !== '') return `c:${String(d.canonical_id)}`
    const connector = String(d?.connector ?? '')
    const ref = String(d?.external_ref ?? d?.ref ?? '')
    return connector !== '' && ref !== '' ? `x:${connector}:${ref}` : ''
  }
  const groups = new Map()
  const out = []
  for (const d of docs) {
    const k = keyOf(d)
    if (k === '') {
      out.push({ ...d, alsoIn: d.alsoIn ?? [] })
      continue
    }
    const at = groups.get(k)
    if (at === undefined) {
      groups.set(k, out.length)
      out.push({ ...d, alsoIn: d.alsoIn ?? [] })
    } else {
      const keep = out[at]
      const better = (d.imported === true && keep.imported !== true) || (d.file && !keep.file)
      const survivor = better ? { ...d, alsoIn: keep.alsoIn } : keep
      const other = better ? keep : d
      out[at] = {
        ...survivor,
        alsoIn: [...new Set([...(survivor.alsoIn ?? []), sourceOf(other), ...(other.alsoIn ?? [])])].filter((s) => s !== sourceOf(survivor)),
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ filter --- */

const KEY = (slug) => `bc.docfilter.${slug}`
const mem = new Map()

export const filterOf = (slug) => {
  let f = mem.get(slug)
  if (f === undefined) {
    f = { source: 'all', type: 'all', q: '' }
    try {
      const raw = JSON.parse(globalThis.localStorage?.getItem(KEY(slug)) ?? 'null')
      if (raw !== null && typeof raw === 'object') {
        if (raw.source === 'all' || SOURCES.some((s) => s.id === raw.source)) f.source = raw.source
        if (raw.type === 'all' || TYPES.some((t) => t.id === raw.type)) f.type = raw.type
      }
    } catch {
      /* Defaults are fine. */
    }
    mem.set(slug, f)
  }
  return f
}

export const setFilter = (slug, patch) => {
  const f = { ...filterOf(slug), ...patch }
  mem.set(slug, f)
  try {
    globalThis.localStorage?.setItem(KEY(slug), JSON.stringify({ source: f.source, type: f.type }))
  } catch {
    /* A browser that cannot remember still filters. */
  }
  return f
}

export const resetFilters = () => {
  mem.clear()
}

/** What survives a filter. `q` matches the title, the origin line and the tags, never the whole body. */
export const applyFilter = (docs, f) => {
  const q = String(f.q ?? '')
    .trim()
    .toLowerCase()
  return docs.filter((d) => {
    if (f.source !== 'all' && d.src !== f.source && !(d.alsoIn ?? []).includes(f.source)) return false
    if (f.type !== 'all' && d.typeKey !== f.type) return false
    if (q === '') return true
    return q.split(/\s+/).every((w) => hay(d).includes(w))
  })
}

/** How many of each source, so only the sources that are present are offered. */
export const counts = (docs) => {
  const by = new Map()
  for (const d of docs) by.set(d.src, (by.get(d.src) ?? 0) + 1)
  return by
}

/** The words a search matches on, lower-cased once. */
export const hay = (d) =>
  `${String(d?.title ?? '')} ${String(d?.origin ?? '')} ${(d?.tags ?? []).join(' ')} ${nameOfSource(d?.src ?? sourceOf(d))}`.toLowerCase()

/* ------------------------------------------------------------- indicators --- */

const glyph = (body) =>
  `<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const GLYPHS = {
  upload: glyph('<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>'),
  generated: glyph('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  web: glyph('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  other: '',
}

/**
 * The indicator: twelve pixels and a tooltip. A document that is also held
 * through another source gets a second, smaller dot rather than a second logo.
 */
export const mark = (d, esc) => {
  const id = d.src ?? sourceOf(d)
  if (id === 'other') return ''
  const s = SOURCES.find((x) => x.id === id)
  const brand = s?.mark === null || s?.mark === undefined ? null : MARKS[s.mark]
  const inner = brand === null ? (GLYPHS[id] ?? '') : brand.svg.replace(/width="22" height="22"/, 'width="12" height="12"')
  const also = (d.alsoIn ?? []).length > 0 ? ` and ${(d.alsoIn ?? []).map(nameOfSource).join(', ')}` : ''
  return `<span class="bcdocsrc bcdocsrc--${esc(id)}" title="${esc(`${nameOfSource(id)}${also}`)}" role="img" aria-label="${esc(`Source: ${nameOfSource(id)}${also}`)}">${inner}</span>`
}

/**
 * Where the SOURCE itself can be opened, or '' when it cannot be said safely.
 *
 * A link the office did not give and cannot derive is not guessed: Drive
 * files have a stable address from their id, every other source needs the
 * office to say (`external_url`).
 */
export const sourceUrl = (d) => {
  const given = String(d?.external_url ?? d?.url_source ?? '')
  if (/^https?:\/\//i.test(given)) return given
  const ref = String(d?.external_ref ?? d?.ref ?? '')
  if (d?.src === 'drive' && ref !== '') return `https://drive.google.com/file/d/${ref}/view`
  return ''
}

export { nameOfSource }

/* ------------------------------------------------- the unified list, from the office --- */

/*
  When signed in, the office's own `project_documents` is the list: one item per
  logical document, deduplicated where identity is certain, with source, size,
  dates, version count and import state worked out in the database. It is read
  lazily, once per project, and the page falls back to the studio payload's
  `documents` until it arrives or when the office does not have it (an older
  deployment) - so nothing here can make a project's documents disappear.
*/

let redraw = null
export const init = (c) => {
  redraw = c?.render ?? null
}
const lists = new Map()

const sizeLabel = (it) => {
  if (Number.isFinite(it.words) && it.words >= 100) return `${Math.round(it.words).toLocaleString('en-GB')} words`
  if (Number.isFinite(it.size_bytes) && it.size_bytes >= 1024) {
    const kb = it.size_bytes / 1024
    return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`
  }
  return ''
}

/** An office item in the shape the rest of the page already draws. */
export const fromItem = (it) => ({
  id: it.id,
  title: it.title,
  kind: it.kind === 'audio' ? 'audio' : it.source === 'generated' ? 'made' : it.mime === 'application/pdf' || it.kind === 'pdf' ? 'pdf' : 'doc',
  origin: it.source === 'upload' ? 'Yours' : (it.produced_by ?? nameOfSource(it.source ?? 'other')),
  size: sizeLabel(it),
  uploaded: it.added_at ?? null,
  added: it.added_at ?? null,
  modified: it.modified_at ?? null,
  source: it.source,
  connector: it.connector ?? '',
  external_ref: it.external_ref ?? '',
  external_url: it.external_url ?? '',
  mime: it.mime ?? '',
  size_bytes: it.size_bytes ?? null,
  imported: it.imported === true,
  import_available: it.import_available === true,
  import_state: it.import_state ?? 'none',
  version_count: it.version_count ?? 1,
  current_version: it.current_version ?? 1,
  alsoIn: Array.isArray(it.also_in) ? it.also_in : [],
  tags: it.tags ?? [],
  indexed: it.indexed === true,
  duplicates: it.duplicates ?? [],
  fromOffice: true,
})

/** The office's list for a project, or null while it is not (yet) available. */
export const officeList = (slug) => {
  if (!canWrite()) return null
  const hit = lists.get(slug)
  if (hit === undefined) {
    lists.set(slug, { state: 'loading', docs: [] })
    read('project_documents', undefined, { slug })
      .then((out) => {
        lists.set(slug, { state: 'ready', docs: Array.isArray(out?.documents) ? out.documents.map(fromItem) : [] })
      })
      .catch(() => {
        lists.set(slug, { state: 'off', docs: [] })
      })
      .finally(() => {
        redraw?.()
      })
    return null
  }
  return hit.state === 'ready' ? hit.docs : null
}

/** Forget a project's list so the next draw asks again (after an import, a new version). */
export const forgetList = (slug) => {
  lists.delete(slug)
}
