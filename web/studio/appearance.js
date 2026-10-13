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
/*
  How much room the layout takes (#124).

  Grant, in the review: "Improve space usage throughout — less decoration,
  less clutter." Answered as a control rather than as a guess, because picking
  a tighter rhythm and hoping is how that request gets re-litigated a month
  later.

  Two, not three. A middle setting would need a third scale nobody has a
  reason for, and the honest question is only "is there too much air".
*/
export const DENSITIES = [
  { id: 'comfortable', name: 'Comfortable', note: 'Room to breathe.' },
  { id: 'compact', name: 'Compact', note: 'More on the screen at once.' },
]

/*
  Looks, glass and depth (aesthetic sprint, 9 October 2026). A look is what the surfaces are made of (the canvas, the
  face of a module); the accent is the other choice and the two never touch. 'silver' (Slate & Silver) is the default. The
  retired 'original' look (orange and brown) is no longer offered; a saved 'original' reads as 'silver' (see appearance()).
*/
/* `faces` is [canvas, surface] in each scheme, only so the picker can draw a small preview; the CSS is the source of truth (bc/refine.css). */
export const LOOKS = [
  { id: 'silver', name: 'Slate & Silver', note: 'Cooler, neutral greys', faces: { dark: ['#0d1114', '#1c2227'], light: ['#e2e5e9', '#fbfcfd'] } },
  { id: 'forest', name: 'Forest', note: 'Deep green faces', faces: { dark: ['#0a1511', '#18291f'], light: ['#d2d6cb', '#eef0e8'] } },
  { id: 'graphite', name: 'Warm Graphite', note: 'Warm charcoal and parchment', faces: { dark: ['#131110', '#262220'], light: ['#d9d4cd', '#f2efea'] } },
]
export const GLASS = [
  { id: 'off', name: 'Solid', note: 'Menus are opaque' },
  { id: 'soft', name: 'Soft', note: 'A hint of the board behind menus' },
  { id: 'rich', name: 'Rich', note: 'Frosted, the board shows through' },
]
export const DEPTHS = [
  { id: 'flat', name: 'Flat', note: 'Hairline shadows' },
  { id: 'soft', name: 'Soft', note: 'Gently raised' },
  { id: 'deep', name: 'Deep', note: 'A pronounced lift' },
]

/*
  The recommended appearance (October 2026 redesign): Slate & Silver, Light, the slate-blue accent and a clean canvas with no
  texture. A fresh visitor gets exactly this. A browser that already stored a choice keeps it; "Reset to recommended" on the
  Appearance tab restores it. The project's own grid and module opacity are reset in that project's appearance sheet.
*/
const DEFAULTS = {
  palette: 'slate',
  texture: 'none',
  own: null,
  ownName: '',
  scheme: 'light',
  density: 'comfortable',
  look: 'silver',
  glass: 'soft',
  depth: 'soft',
}

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

/* The recommended appearance, for the "Reset to recommended" action. Stored as a fresh choice, so a reset is never a silent no-op. */
export function resetToRecommended() {
  apply({ ...DEFAULTS })
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
      density: DENSITIES.some((d) => d.id === saved.density) ? saved.density : DEFAULTS.density,
      // The retired Original look maps to its successor; every other saved preference is read as it was.
      look: saved.look === 'original' ? 'silver' : LOOKS.some((x) => x.id === saved.look) ? saved.look : DEFAULTS.look,
      glass: GLASS.some((x) => x.id === saved.glass) ? saved.glass : DEFAULTS.glass,
      depth: DEPTHS.some((x) => x.id === saved.depth) ? saved.depth : DEFAULTS.depth,
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
    Density is written even when it is the default, unlike `scheme`.

    `scheme` deletes the attribute for 'system' because every dark block in
    skins.css is guarded `:not([data-scheme="light"])` and a third value would
    read as neither. Density has no such guard — one block keys on
    `[data-density="compact"]` and everything else is the base scale — so
    writing 'comfortable' is simply true, and an attribute that is always
    present is one an audit can read to find out which density it is looking
    at.
  */
  document.documentElement.dataset.density = next.density
  /* Always written, like density, so an audit can read which look, glass and depth it is looking at. */
  document.documentElement.dataset.look = next.look ?? DEFAULTS.look
  document.documentElement.dataset.glass = next.glass ?? DEFAULTS.glass
  document.documentElement.dataset.depth = next.depth ?? DEFAULTS.depth
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
  /*
    And out to the office, which is where it actually lives (ADR-0021).

    localStorage is the CACHE — it is what makes the interface instant and
    what keeps the choice when the page is opened signed-out — and the row is
    the record. Without this the setting is right on this laptop and absent on
    the phone, which ADR-0021 calls out as invisible to every other suite: a
    page that saves only locally captures perfectly and is wrong only on a
    second device, which no capture run has.

    Fire and forget, and injected rather than imported: this module is loaded
    by the settings pane, by the boot path and by the audits, and only the
    app knows whether there is a token to write with. A failure leaves the
    change on screen and in this browser, so the failure mode is "the other
    device is behind" rather than "your choice vanished".
  */
  if (send !== null) send(next)
  return next
}

/**
 * Where a change should be sent, set once by the app at boot.
 *
 * Null until then, and null for ever in a page with no token — which is not a
 * degraded state but the correct one: a reader has nothing to save.
 */
let send = null
export function saveWith(fn) {
  send = typeof fn === 'function' ? fn : null
}

/**
 * What the office says, merged over what this browser remembered.
 *
 * The office wins on the keys it carries, because it is the record. Keys it
 * does not carry keep their local value, so a browser that has chosen a
 * texture does not lose it to an office row written before textures existed —
 * the merge is how a cache in front of a record behaves, rather than a
 * replacement that would make every new key a data loss.
 *
 * Applied WITHOUT sending, or hydrating would write back what it just read on
 * every page load.
 */
export function hydrate(fromOffice) {
  if (fromOffice === null || typeof fromOffice !== 'object') return appearance()
  const was = send
  send = null
  try {
    return apply({ ...appearance(), ...fromOffice })
  } finally {
    send = was
  }
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
