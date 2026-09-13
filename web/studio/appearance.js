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

/*
  Real materials, generated once and committed (#206).

  These replaced five `feTurbulence` filters. Grant, twice: "forget the SVG and
  AI generate some really beautiful textures, like stone or wood or whatever".
  Named for what they actually are, because "Grain" and "Stone" described two
  settings of the same noise function.

  Marble and leather were generated and rejected before this list: marble's
  veining is a COMPOSITION and cropped to a button it is a smear, and leather
  at 10% grey is indistinguishable from plaster.
*/
export const TEXTURES = [
  { id: 'none', name: 'None', note: 'Colour only' },
  { id: 'plaster', name: 'Plaster', note: 'Lime-washed, trowelled' },
  { id: 'paper', name: 'Paper', note: 'Cold-press, toothed' },
  { id: 'travertine', name: 'Travertine', note: 'Stone, softly pitted' },
  { id: 'oak', name: 'Oak', note: 'Quarter-sawn grain' },
  { id: 'linen', name: 'Linen', note: 'Woven, slubbed' },
  { id: 'concrete', name: 'Concrete', note: 'Board-formed, fine' },
  { id: 'granite', name: 'Granite', note: 'Crystalline, even speckle' },
  { id: 'basalt', name: 'Basalt', note: 'Riven, cleaved' },
  { id: 'sandstone', name: 'Sandstone', note: 'Fine even grain' },
  { id: 'terrazzo', name: 'Terrazzo', note: 'Chips in matrix' },
  { id: 'steel', name: 'Steel', note: 'Brushed, directional' },
]

const KEY = 'studio.appearance'
/*
  `scheme` is the third state, and 'system' is the honest default (#87).

  Not a boolean. "Dark: on/off" forces a person who is happy following their
  operating system to pick a side, and then the studio is the one app on the
  machine that does not go dark at sunset with everything else.
*/
export const SCHEMES = [
  { id: 'system', name: 'Follow the system' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
]

/*
  Dark concrete, on Grant's instruction (#206):

    "let's go for a dark concrete for now just to ensure that it can be changed
     within the settings later on"

  The point is as much the mechanism as the look — a default that is three
  stored values rather than three constants, so changing his mind later is
  three clicks in Appearance and no code.

  `scheme: 'dark'` rather than `'system'` is the one that overrides something
  he might not expect: it ignores the operating system's preference until he
  sets it back. That is what he asked for and it is the first control in the
  panel.
*/
const DEFAULTS = { palette: 'slate', texture: 'concrete', own: null, ownName: '', scheme: 'dark' }

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
      scheme: SCHEMES.some((x) => x.id === saved.scheme) ? saved.scheme : DEFAULTS.scheme,
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
    Absent means "follow the system", and absent has to mean literally absent:
    every dark block in skins.css is guarded `:not([data-scheme="light"])`, so
    writing `data-scheme="system"` would read as neither light nor dark and
    quietly work by accident. Delete the attribute instead.

    `color-scheme` goes with it so the browser's own furniture — scrollbars,
    form controls, the canvas behind the page — follows the choice. Without it
    a dark page keeps white scrollbars.
  */
  if (next.scheme === 'system') {
    delete document.documentElement.dataset.scheme
    document.documentElement.style.colorScheme = 'light dark'
  } else {
    document.documentElement.dataset.scheme = next.scheme
    document.documentElement.style.colorScheme = next.scheme
  }
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


/*
  What the shortcut does (#87).

  Grant: *"Ensure the dark-mode shortcut performs its intended action."*

  From 'system' it goes to whatever the system is NOT, which is what a person
  pressing a sun icon means: they can see the current theme and they want the
  other one. Guessing 'dark' unconditionally would be a no-op for anyone
  already in dark mode, and a control that does nothing on the first press is
  the bug being fixed.
*/
export function systemPrefersDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches }
  catch { return false }
}

/** The theme actually on screen right now, whatever produced it. */
export function activeScheme(now = appearance()) {
  return now.scheme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : now.scheme
}

/** Flip it, and return what it became. */
export function toggleScheme() {
  const now = appearance()
  const next = activeScheme(now) === 'dark' ? 'light' : 'dark'
  apply({ ...now, scheme: next })
  return next
}
