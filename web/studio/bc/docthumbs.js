/*
  SMALL REAL THUMBNAILS OF EXTERNAL DOCUMENTS, KEPT IN THIS BROWSER ONLY.

  Where this lives, and why. A tile for a PDF or an image that Team HQ reads from Drive on demand has no file of its own to
  draw a first page from: the original stays in Drive and nothing is copied. Rendering a PDF's first page on the server
  would be a rendering subsystem with a dependency, to serve a picture that this browser can make for itself with the
  pdf.js it already ships. So the viewer, which has the bytes in hand for the moment a person opens the document, makes a
  small JPEG of page one (or of the image), and keeps it here, on this device, keyed by the document and the SOURCE's
  modified time. Nothing is sent anywhere. Another device has none until it opens the document, and a tile with none
  shows the cached first words of the text, then the drawn page.

  The key includes the modified time, so a source that changed shows no stale picture: the tile falls back until the
  document is opened again. Bounded (a count and a size per entry), every read and write is guarded because storage can
  be blocked, full or absent, and the page must draw without it.

  Plain words in the comments of this file: it sits near template literals.
*/

const INDEX = 'hq.docthumbs.index'
const PREFIX = 'hq.docthumb.'
const MAX_ENTRIES = 60
const MAX_CHARS = 90_000

/** The same instant spelled two ways (a timestamp from the database and one from Drive) must key alike. */
const stamp = (mod) => {
  const t = Date.parse(String(mod ?? ''))
  return Number.isNaN(t) ? '' : String(t)
}

const keyOf = (id, mod) => `${PREFIX}${id}.${stamp(mod)}`

const readIndex = () => {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The thumbnail kept for this document at this source version, or null. */
export const get = (id, mod) => {
  if (String(id ?? '') === '' || stamp(mod) === '') return null
  try {
    const v = localStorage.getItem(keyOf(id, mod))
    return typeof v === 'string' && v.startsWith('data:image/') ? v : null
  } catch {
    return null
  }
}

/** Keep one. Replaces any older picture of the same document, and the oldest entries when over the bound. */
export const put = (id, mod, dataUrl) => {
  if (String(id ?? '') === '' || stamp(mod) === '') return false
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_CHARS) return false
  try {
    const key = keyOf(id, mod)
    let index = readIndex().filter((k) => {
      if (k !== key && k.startsWith(`${PREFIX}${id}.`)) {
        localStorage.removeItem(k)
        return false
      }
      return k !== key
    })
    index.push(key)
    while (index.length > MAX_ENTRIES) {
      const old = index.shift()
      if (old !== undefined) localStorage.removeItem(old)
    }
    localStorage.setItem(key, dataUrl)
    localStorage.setItem(INDEX, JSON.stringify(index))
    return true
  } catch {
    return false
  }
}

/** A picture (any URL the page may draw, a data or blob address) scaled to `width` CSS pixels and made a JPEG. */
export const shrink = async (src, width = 220) => {
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  await img.decode()
  const scale = Math.min(1, (width * 2) / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const context = canvas.getContext('2d', { alpha: false })
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.7)
}
