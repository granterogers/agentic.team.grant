/*
  KEEPING THE RECORDING, so a voice note is still a voice note tomorrow.

  Grant: *"Where appropriate, retain a playable representation of the original
  voice note."*

  ## Where it is kept, and why that is said out loud

  In this browser, in IndexedDB, beside nothing else. The office has no store
  for a recording yet - `documents` is for documents and the Supabase bucket
  is not wired to this path - and inventing one from an experimental branch
  would be a schema decision made by the UX workstream on a database it does
  not own. So the audio is local, it survives a refresh and a restart, and the
  page SAYS it is local rather than letting Grant assume the office has it.

  What the office has is the words: the transcript goes through the same
  conversational path a typed message takes, so the team can read, route and
  answer it from any surface. The recording is the thing you can play back;
  the transcript is the thing that is filed. That split is stated in the UI.

  ## Why a key set is held in memory

  The renderer is synchronous and IndexedDB is not. Asking "is there a
  recording for this message" while drawing a thread cannot await, so the keys
  are read once at boot and kept; the blob itself is only fetched when
  somebody presses play.
*/

const DB = 'bc.notes'
const STORE = 'notes'

let opening = null
const keys = new Set()
const urls = new Map()

const open = () => {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  opening ??= new Promise((resolve) => {
    let request
    try {
      request = indexedDB.open(DB, 1)
    } catch {
      /* Private windows and blocked storage both land here. */
      resolve(null)
      return
    }
    request.addEventListener('upgradeneeded', () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => resolve(null))
    request.addEventListener('blocked', () => resolve(null))
  })
  return opening
}

/**
 * Learn which messages have a recording.
 *
 * Called once at boot. Failing is not fatal and is not reported: a browser
 * that cannot keep the audio still sends voice notes perfectly well, and the
 * play control simply is not drawn - which is the honest state rather than a
 * control that cannot work.
 */
export async function ready() {
  const db = await open()
  if (db === null) return false
  return await new Promise((resolve) => {
    try {
      const all = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      all.addEventListener('success', () => {
        keys.clear()
        for (const k of all.result ?? []) keys.add(String(k))
        resolve(true)
      })
      all.addEventListener('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

/** Whether there is a recording for this message, answerable while drawing. */
export const has = (id) => keys.has(String(id))

/** How many are kept, for a check to read rather than believe. */
export const count = () => keys.size

/** Keep a recording against a message id. Returns whether it was kept. */
export async function keep(id, blob, meta = {}) {
  const db = await open()
  if (db === null) return false
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ blob, type: blob.type, ...meta, at: Date.now() }, String(id))
      tx.addEventListener('complete', () => {
        keys.add(String(id))
        resolve(true)
      })
      tx.addEventListener('error', () => resolve(false))
      tx.addEventListener('abort', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}

/**
 * A URL the page can play, or '' when there is nothing to play.
 *
 * Cached per id, because every `createObjectURL` is a handle the tab keeps
 * until it is revoked and this experience redraws its whole shell on every
 * navigation - so making one per render would leak one per render.
 */
export async function url(id) {
  const key = String(id)
  const already = urls.get(key)
  if (already !== undefined) return already
  const db = await open()
  if (db === null) return ''
  const row = await new Promise((resolve) => {
    try {
      const get = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      get.addEventListener('success', () => resolve(get.result ?? null))
      get.addEventListener('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
  if (row === null || !(row.blob instanceof Blob)) return ''
  const made = URL.createObjectURL(row.blob)
  urls.set(key, made)
  return made
}

/** Throw one away, handle and all. */
export async function forget(id) {
  const key = String(id)
  const made = urls.get(key)
  if (made !== undefined) {
    URL.revokeObjectURL(made)
    urls.delete(key)
  }
  keys.delete(key)
  const db = await open()
  if (db === null) return false
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.addEventListener('complete', () => resolve(true))
      tx.addEventListener('error', () => resolve(false))
    } catch {
      resolve(false)
    }
  })
}
