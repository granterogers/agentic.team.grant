/*
  The bytes of a PDF, kept on this device.

  A document's address is signed and lasts about ten minutes, so a PDF that was drawn once could not be drawn again after a
  reload: its link had gone, and the viewer fell back to the text the office had indexed. The bytes are kept here instead,
  keyed by the document, so opening it again needs no address at all. The address is asked for only the first time, or when
  the bytes are not on this device.

  Every operation may fail (private windows, blocked storage, an old browser), and then the caller simply has to fetch the
  address again. Nothing here throws.
*/

const DB = 'teamhq-documents'
const STORE = 'pdf'

let opened = null
const open = () => {
  if (opened !== null) return opened
  opened = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opened
}

const request = async (mode, make) => {
  const db = await open()
  if (db === null) return null
  return new Promise((resolve) => {
    try {
      const req = make(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** The bytes kept for this document, or null. */
export const kept = async (key) => {
  const row = await request('readonly', (s) => s.get(key))
  return row === null ? null : row.bytes
}

/** Keep the bytes of this document. Returns whether they were kept. */
export const keep = async (key, bytes) => {
  const saved = await request('readwrite', (s) => s.put({ bytes, at: Date.now() }, key))
  return saved !== null
}

/**
 * The bytes of a PDF: from this device when they are here, otherwise fetched from `url` and kept for next time. Rejects if
 * the file cannot be fetched, which is the one case the caller has to say something about.
 */
export const pdfBytes = async (key, url) => {
  const have = await kept(key)
  if (have !== null) return have
  const res = await fetch(url)
  if (!res.ok) throw new Error(`the file answered ${String(res.status)}`)
  const bytes = await res.arrayBuffer()
  await keep(key, bytes)
  return bytes
}
