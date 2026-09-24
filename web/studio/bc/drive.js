/*
  BRINGING A FILE IN FROM GOOGLE DRIVE.

  Grant, 23 September: *"Add file/document → choose Google Drive →
  authenticate/connect if required → browse/search/select appropriate Drive
  item → choose item → associate/import/link it to the project → see it in Docs
  & Files → open it later. Do not build a fake list of Drive filenames. Do not
  hard-code Drive fixtures."*

  ## Nothing here knows anything about Drive

  Every listing comes from the office, which asks Drive with the office's own
  grant. This module has no credential, no Drive URL and no idea what a scope
  is - it asks for a section and draws what comes back. That is not tidiness:
  a page that could list Drive by itself would be a page holding something that
  could read Grant's whole drive, and §10 of the brief is explicit that the
  permanent credential never reaches browser code.

  ## What a pick does

  It records a REFERENCE. The file stays where it is; the project gains a
  document that knows which file it is and what kind of thing it is. Grant's
  §23, and the schema was already shaped for it.
*/
import { esc } from './parts.js'

/* What this module is showing, kept here rather than in the shell's state:
   the shell redraws for many reasons and none of them should lose the folder
   somebody has walked into. */
const state = {
  open: false,
  loading: false,
  error: '',
  q: '',
  folder: '',
  trail: [],
  files: [],
  picking: '',
}

export const isOpen = () => state.open
export const showing = () => state.files.slice()

export const close = () => {
  state.open = false
  state.error = ''
  state.q = ''
  state.folder = ''
  state.trail = []
  state.files = []
}

/**
 * Ask the office what is in Drive.
 *
 * `read` is handed in rather than imported so this module never decides how to
 * talk to the office - one place holds the token and the endpoint.
 */
export const browse = async (read, { folder = '', q = '' } = {}) => {
  state.open = true
  state.loading = true
  state.error = ''
  state.q = q
  state.folder = folder
  try {
    const answer = await read('drive', undefined, { folder, q })
    state.files = Array.isArray(answer?.files) ? answer.files : []
  } catch (e) {
    /*
      The office's own words. A Drive that will not answer, a grant that has
      been withdrawn and a connection that was never made are three different
      things, and only the office knows which.
    */
    state.error = e instanceof Error ? e.message : String(e)
    state.files = []
  } finally {
    state.loading = false
  }
}

/** Walk into a folder, remembering the way back. */
export const into = async (read, id, name) => {
  state.trail = [...state.trail, { id, name }]
  await browse(read, { folder: id })
}

/** Walk back out. An empty trail means the top of the drive. */
export const back = async (read) => {
  state.trail = state.trail.slice(0, -1)
  const to = state.trail.at(-1)
  await browse(read, { folder: to?.id ?? '' })
}

/**
 * Take one.
 *
 * `act` is handed in for the same reason `read` is. The office refuses a
 * folder, so nothing here has to decide what is pickable - it just does not
 * offer the control on one, which is the difference between a control that
 * refuses and a control that is not there.
 */
export const pick = async (act, projectId, file) => {
  state.picking = file.id
  try {
    const done = await act('drive_link', {
      p_project_id: projectId,
      p_connector: 'drive',
      p_external_ref: file.id,
      p_title: file.name,
      p_mime: file.mime,
      p_source_title: 'Google Drive',
    })
    if (done?.error !== undefined) {
      state.error = String(done.error)
      return null
    }
    return done
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e)
    return null
  } finally {
    state.picking = ''
  }
}

/*
  WHAT KIND OF THING IT IS, in words rather than in Google's MIME vocabulary.

  The same mapping the office uses when it files one (0537), because the two
  have to agree about what a spreadsheet is called - and this half is what
  somebody reads.
*/
const KIND = {
  'application/vnd.google-apps.folder': 'Folder',
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/vnd.google-apps.form': 'Google Form',
  'application/vnd.google-apps.script': 'Apps Script',
  'application/pdf': 'PDF',
}
export const kindOf = (mime) => {
  const named = KIND[mime]
  if (named !== undefined) return named
  if (String(mime).startsWith('image/')) return 'Image'
  if (String(mime).startsWith('audio/')) return 'Recording'
  if (String(mime).startsWith('video/')) return 'Video'
  if (String(mime).startsWith('text/')) return 'Text'
  return 'File'
}

/** The panel. Empty string when it is not open, so it is never furniture. */
export const panel = () => {
  if (!state.open) return ''
  const trail = state.trail
  return `<section class="bcdrive" data-bc-drivepanel>
    <div class="bcdrivehead">
      <h2 class="bcsubhead">Your Google Drive</h2>
      <button type="button" class="bcbtn" data-bc-driveclose>Close</button>
    </div>
    <div class="bcdriverow">
      ${
        trail.length === 0
          ? ''
          : `<button type="button" class="bcbtn" data-bc-driveback>Back</button>`
      }
      <span class="bcdrivewhere">${
        trail.length === 0
          ? 'Everything, most recent first'
          : esc(trail.map((t) => t.name).join(' / '))
      }</span>
      <input class="bcinput bcdrivesearch" type="search" id="bc-drive-q"
        placeholder="Search your drive" value="${esc(state.q)}"
        aria-label="Search your Google Drive">
      <button type="button" class="bcbtn" data-bc-drivesearch>Search</button>
    </div>
    ${
      state.error !== ''
        ? `<p class="bcdriveerror" role="status">${esc(state.error)}</p>`
        : state.loading
          ? `<p class="bcpmeta">Looking…</p>`
          : state.files.length === 0
            ? `<p class="bcpmeta">Nothing here.${
                state.q === '' ? '' : ' Try a different search.'
              }</p>`
            : `<ul class="bcdrivelist">${state.files
                .map(
                  (f) => `<li class="bcdriveitem">
                    ${
                      f.isFolder
                        ? `<button type="button" class="bcdriveopen" data-bc-drivein="${esc(f.id)}"
                             data-bc-drivename="${esc(f.name)}">
                             <span class="bcdriveicon" aria-hidden="true">▸</span>
                             <span class="bcdrivename">${esc(f.name)}</span>
                             <span class="bcdrivekind">Folder</span>
                           </button>`
                        : `<span class="bcdriveopen bcdriveopen--file">
                             <span class="bcdriveicon" aria-hidden="true">•</span>
                             <span class="bcdrivename">${esc(f.name)}</span>
                             <span class="bcdrivekind">${esc(kindOf(f.mime))}</span>
                           </span>
                           <button type="button" class="bcbtn bcbtn--primary bcdriveadd"
                             data-bc-drivepick="${esc(f.id)}"
                             data-bc-drivename="${esc(f.name)}"
                             data-bc-drivemime="${esc(f.mime)}">Add</button>`
                    }
                  </li>`,
                )
                .join('')}</ul>`
    }
    <p class="bcpmeta bcprose">
      The file stays in your Drive. This project keeps a link to it, so opening
      it here opens the real thing.
    </p>
  </section>`
}

/*
  WHERE A LINKED FILE REALLY LIVES.

  Derived, never stored: a Drive URL follows from the id and the kind, so
  keeping one in the database would be a second copy of a fact the row already
  carries. ONE function, so the gallery, the record and anything added later
  cannot disagree about where a spreadsheet opens.

  The kind is the office's own word (0537), which is what makes this possible
  without Google's MIME vocabulary reaching the page.
*/
const OPENS = {
  'google-doc': (id) => `https://docs.google.com/document/d/${id}/edit`,
  'google-sheet': (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  'google-slides': (id) => `https://docs.google.com/presentation/d/${id}/edit`,
  'google-form': (id) => `https://docs.google.com/forms/d/${id}/edit`,
}

/**
 * The address a linked document opens at, or '' when there is not one.
 *
 * Returns '' rather than guessing for a connector this does not know: a link
 * that goes somewhere wrong is worse than a document that opens its details,
 * which is what the page already does when there is nothing to open.
 */
export const opensAt = (doc) => {
  const connector = String(doc?.connector ?? '')
  const ref = String(doc?.ref ?? doc?.external_ref ?? '')
  if (connector !== 'drive' || ref === '') return ''
  const kind = String(doc?.kind ?? doc?.docType ?? '')
  const known = OPENS[kind]
  /* Anything Drive holds as a real file - a PDF, an image, a recording - opens
     at the same /file/d/<id>/view whatever it is. */
  return known === undefined ? `https://drive.google.com/file/d/${ref}/view` : known(ref)
}
