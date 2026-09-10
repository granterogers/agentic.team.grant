/*
  Choosing how it looks.

  Grant: *"textures, colours, etc should all be adjustable in settings.. with a
  range of palettes and textures, etc to choose from"*.

  The whole mechanism is two attributes on `<html>`. skins.css does the rest,
  which is what makes adding a palette a block of CSS rather than a change to
  anything that renders.

  Remembered in localStorage: an appearance choice is per person and per device,
  and asking the server would mean a flash of the wrong theme on every load.
*/

export const PALETTES = [
  { id: 'paper', name: 'Paper', note: 'Warm off-white, forest green' },
  { id: 'slate', name: 'Slate', note: 'Cool grey, deep blue' },
  { id: 'clay', name: 'Clay', note: 'Terracotta and sand' },
  { id: 'ink', name: 'Ink', note: 'Near-black on cream' },
  { id: 'moss', name: 'Moss', note: 'Deep green and stone' },
]

export const TEXTURES = [
  { id: 'none', name: 'None', note: 'Colour only' },
  { id: 'grain', name: 'Grain', note: 'Fine paper fibre' },
  { id: 'plaster', name: 'Plaster', note: 'Mottled and uneven' },
  { id: 'canvas', name: 'Canvas', note: 'Woven, tight' },
  { id: 'linen', name: 'Linen', note: 'Soft irregular weave' },
  { id: 'stone', name: 'Stone', note: 'Coarse, with fracture' },
]

const KEY = 'studio.appearance'
const DEFAULTS = { palette: 'paper', texture: 'plaster', own: null, ownName: '' }

/*
  Grant's own texture.

  *"would be good to be able to upload my own custom background textures"* — so
  a file becomes a data URI, gets stored beside the palette choice, and is used
  in place of the built-in one. No upload, no server, no URL to rot: the image
  IS the setting.

  Capped at 1.5MB. localStorage is a few megabytes at best and a 12MP photo
  would silently blow it away along with every other preference; better to
  refuse with a reason. Downscaling happens on the way in, so a big photograph
  still works — it just arrives smaller than it left.
*/
export const OWN_TEXTURE_LIMIT = 1_500_000

/** Read a file, downscale it, and hand back a data URI — or an error to show. */
export async function readTexture(file) {
  if (!file.type.startsWith('image/')) return { error: 'That is not an image.' }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => { resolve(i) }
      i.onerror = () => { reject(new Error('could not read that image')) }
      i.src = url
    })
    // A background texture is tiled and sits at low opacity; past about 900px
    // the extra detail is invisible and the bytes are not.
    const max = 900
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale)
    c.height = Math.round(img.height * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    let out = c.toDataURL('image/jpeg', 0.72)
    if (out.length > OWN_TEXTURE_LIMIT) out = c.toDataURL('image/jpeg', 0.5)
    if (out.length > OWN_TEXTURE_LIMIT) {
      return { error: 'That image is too large even after shrinking. Try a smaller one.' }
    }
    return { data: out, name: file.name }
  } catch (e) {
    return { error: e.message }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** What is chosen. Falls back to the defaults, never to nothing. */
export function appearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      palette: PALETTES.some((p) => p.id === saved.palette) ? saved.palette : DEFAULTS.palette,
      texture: saved.texture === 'own' || TEXTURES.some((t) => t.id === saved.texture)
        ? saved.texture
        : DEFAULTS.texture,
      own: typeof saved.own === 'string' ? saved.own : null,
      ownName: saved.ownName ?? '',
    }
  } catch {
    // A private window, or storage blocked. A default is a fine answer.
    return { ...DEFAULTS }
  }
}

/** Put it on the document. Called on load, and on every change. */
export function apply(next = appearance()) {
  document.documentElement.dataset.palette = next.palette
  document.documentElement.dataset.texture = next.texture
  /*
    An uploaded texture is set as a variable rather than as another block in
    skins.css, because it is data and skins.css is design. `data-texture="own"`
    exists only so the picker can show which one is selected.
  */
  const root = document.documentElement
  if (next.texture === 'own' && next.own) {
    root.style.setProperty('--tex', `url("${next.own}")`)
    root.style.setProperty('--tex-size', '520px auto')
  } else {
    root.style.removeProperty('--tex')
    root.style.removeProperty('--tex-size')
  }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  return next
}
