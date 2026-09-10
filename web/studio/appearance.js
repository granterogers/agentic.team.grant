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
const DEFAULTS = { palette: 'paper', texture: 'plaster' }

/** What is chosen. Falls back to the defaults, never to nothing. */
export function appearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      palette: PALETTES.some((p) => p.id === saved.palette) ? saved.palette : DEFAULTS.palette,
      texture: TEXTURES.some((t) => t.id === saved.texture) ? saved.texture : DEFAULTS.texture,
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
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  return next
}
