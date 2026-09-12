/*
  Thirty familiar marks, in the repository.

  Grant: *"Support uploading a custom image or choosing from approximately 30
  familiar SVG icons, with selectable icon colors."*

  ## Why they are here and not fetched

  There is no build step (ADR-0002, ADR-0011), the page is hand-written HTML,
  and the build sandbox cannot reach external hosts. An icon font or a CDN set
  would be invisible in every screenshot — which is exactly what happened to
  the typography until the fonts were self-hosted (#22) — and possibly invisible
  for real users behind a proxy. Thirty inline paths is a few KB and it always
  renders.

  ## One geometry, so a grid of them looks like a set

  Every one is a 24x24 viewBox, stroked rather than filled, `currentColor`,
  1.7px, round caps and joins. Mixing a filled glyph into a stroked set is the
  single fastest way to make thirty icons look like thirty icons from thirty
  places, and this repository has a WOW gate that a bag of clip art fails.

  Named for what a person would call the thing, not for the drawing: `course`
  rather than `mortarboard`, `money` rather than `banknote`. The key is stored
  in the database, so a rename here is a migration there — pick the word you
  would still use in a year.
*/

/** The paths, keyed. `d` is one or more `<path>` bodies; `x` is extra shapes. */
const P = {
  spark:    'M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z',
  course:   'M3 8.5L12 4l9 4.5-9 4.5zM7 11v4.6c0 .9 2.2 2.4 5 2.4s5-1.5 5-2.4V11',
  book:     'M4 5.5A1.5 1.5 0 015.5 4H19v14H5.5A1.5 1.5 0 004 19.5zM4 19.5A1.5 1.5 0 015.5 18H19v2.5',
  note:     'M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h4',
  camera:   'M4 8.5h3l1.5-2h7L17 8.5h3v10H4z',
  film:     'M3.5 5.5h17v13h-17zM8 5.5v13M16 5.5v13M3.5 12h17',
  mic:      'M12 3.5a2.6 2.6 0 00-2.6 2.6v5.2a2.6 2.6 0 005.2 0V6.1A2.6 2.6 0 0012 3.5zM18 11v.6a6 6 0 01-12 0V11M12 17.6v2.9',
  music:    'M9 18V6.5l9-2V16',
  brush:    'M14.5 4.5l5 5-7.5 7.5-5-5zM7 12l-2 5.5 5.5-2',
  palette:  'M12 3.5a8.5 8.5 0 000 17c1.4 0 2-.9 2-1.8 0-1.4-1.2-1.7-1.2-2.9 0-.8.7-1.3 1.6-1.3h1.5A4.6 4.6 0 0020.5 10c0-3.6-3.8-6.5-8.5-6.5z',
  target:   'M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3',
  compass:  'M14.6 9.4l-1.7 5.2-5.2 1.7 1.7-5.2z',
  map:      'M9 5.5L3.5 7.5v11L9 16.5l6 2 5.5-2v-11l-5.5 2zM9 5.5v11M15 7.5v11',
  flag:     'M6 20.5V4h11l-2 3.5L17 11H6',
  rocket:   'M12 3.5c3 2 4.5 5 4.5 8.5L12 16l-4.5-4c0-3.5 1.5-6.5 4.5-8.5zM8 15.5c-1.5.8-2 2-2 4 2 0 3.2-.5 4-2M16 15.5c1.5.8 2 2 2 4-2 0-3.2-.5-4-2',
  chart:    'M4 19.5h16M7.5 16.5v-5M12 16.5v-9M16.5 16.5v-3',
  money:    'M3.5 6.5h17v11h-17z',
  bag:      'M4.5 8h15l-1 12.5h-13zM8.5 8V6a3.5 3.5 0 017 0v2',
  people:   'M9 12a3.2 3.2 0 100-6.4A3.2 3.2 0 009 12zM3.5 19.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8M16 6.2a3.2 3.2 0 010 6.2M17.5 15.2c2 .5 3.5 2 3.5 4.3',
  chat:     'M21 11.5a8.4 8.4 0 01-9 8.4 9 9 0 01-3.9-.9L3 20.5l1.6-4.7A8.4 8.4 0 013.6 11 8.4 8.4 0 0112 2.6a8.4 8.4 0 019 8.9z',
  mail:     'M3.5 6h17v12h-17zM3.5 6.8l8.5 6 8.5-6',
  phone:    'M7.5 3.5h9v17h-9zM10.5 18h3',
  home:     'M4 10.5L12 4l8 6.5V20H4zM9.5 20v-6h5v6',
  building: 'M5 20.5V5h9v15.5M14 10h5v10.5M8 8.5h3M8 12h3M8 15.5h3M16.5 13h.5M16.5 16.5h.5',
  leaf:     'M20 4c-9 0-15 3.5-15 10a5 5 0 005 5c6 0 10-6 10-15zM8 19c1.5-4.5 4-7.5 8-10',
  sun:      'M12 3v2.2M12 18.8V21M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M3 12h2.2M18.8 12H21M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6',
  heart:    'M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0112 8.3a4.1 4.1 0 017.5 2.3C19.5 15.6 12 20 12 20z',
  clock:    'M12 6.5V12l3.5 2',
  calendar: 'M4 6.5h16v14H4zM8 3.5v4M16 3.5v4M4 11h16',
  folder:   'M3.5 6.5h6l2 2.5h9v10h-17z',
  tag:      'M11 3.5H20.5V13L12 21.5 3.5 13z',
  key:      'M14.5 3.5a6 6 0 00-5.4 8.6L3.5 17.7v3h3l.9-.9v-2h2v-2h2l1.4-1.4a6 6 0 001.7-10.9zM16.8 8.2h.01',
  lock:     'M6.5 10.5h11v10h-11zM9 10.5V7.5a3 3 0 016 0v3',
  globe:    'M3.5 12h17M12 3.5c2.4 2.3 3.7 5.4 3.7 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.7-5.4-3.7-8.5S9.6 5.8 12 3.5z',
  box:      'M12 3.5l8 4.2v8.6l-8 4.2-8-4.2V7.7zM4 7.7l8 4.3 8-4.3M12 12v8.5',
  tools:    'M14.5 4.5a4 4 0 005.2 5.2l-9 9a2.3 2.3 0 01-3.3-3.3zM6.5 4.5l3 3-2 2-3-3z',
}
/** Shapes a single path cannot express without getting silly. */
const X = {
  target:   '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  compass:  '<circle cx="12" cy="12" r="8.5"/>',
  camera:   '<circle cx="12" cy="13" r="3.4"/>',
  money:    '<circle cx="12" cy="12" r="2.6"/>',
  clock:    '<circle cx="12" cy="12" r="8.5"/>',
  globe:    '<circle cx="12" cy="12" r="8.5"/>',
  sun:      '<circle cx="12" cy="12" r="4"/>',
  music:    '<circle cx="7" cy="18" r="2.2"/><circle cx="16" cy="16" r="2.2"/>',
  key:      '<circle cx="14.5" cy="9.5" r="6"/>',
  tag:      '<circle cx="16.4" cy="7.6" r="1.4"/>',
}

/** Every key, in the order the picker draws them. */
export const KEYS = Object.keys(P)

/** The colours an icon may be. The palette hues, so a project still matches. */
export const HUES = ['p-rust', 'p-amber', 'p-moss', 'p-slate', 'p-iris', 'p-plum']

/** Whether a key is one of ours. Anything else is drawn as nothing. */
export const known = (key) => Object.hasOwn(P, key ?? '')

/**
 * One icon, as markup.
 *
 * `currentColor` throughout, so the colour is set by whatever draws it — the
 * cover sets it from the project's chosen hue and the picker sets it from the
 * swatch. An icon that carried its own fill could not be recoloured.
 */
export function svg(key, size = 24) {
  if (!known(key)) return ''
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${X[key] ?? ''}<path d="${P[key]}"/></svg>`
}
