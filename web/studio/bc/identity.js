/*
  ONE IDENTITY FOR EVERY MODULE AND TOOL (11 October 2026).

  A module's icon and colour are drawn on the dashboard (the title of each minimised module), in the Jump command overlay and
  anywhere else a tool is named. They come from here, once, so changing one changes them all. The colours are the curated hues
  of layout.js (the same ones the colour popover offers); an unknown id falls back to a neutral mark and the slate hue rather than
  to nothing, so a tool added tomorrow is drawn the day it exists.

  Icons are small outline drawings on a 24 grid, in the page's own stroke style. Comments here avoid backticks.
*/

import * as grid from './layout.js'

const ICONS = {
  tasks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8M13 12h8M13 18h8"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v10"/>',
  documents: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
  schedule: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  contacts: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  team: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/><path d="M4 9.5a2.4 2.4 0 1 1 3-2.3M20 9.5a2.4 2.4 0 1 0-3-2.3"/>',
  sources: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  /* Places and actions Jump offers that are not project tools. */
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mytasks: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  project: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  layout: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  action: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7M12 16h.01"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  found: '<path d="m9 18 6-6-6-6"/>',
}

/** The hue each id is drawn in (a CSS colour), from the same table the dashboard's modules use. */
const HUES = {
  ...Object.fromEntries(Object.keys(grid.DEFAULT_TINT).map((k) => [k, grid.tintHue(grid.DEFAULT_TINT[k])])),
  chat: grid.tintHue('indigo'),
  team: grid.tintHue('moss'),
  sources: grid.tintHue('slate'),
  settings: grid.tintHue('slate'),
  home: grid.tintHue('sky'),
  search: grid.tintHue('sky'),
  mytasks: grid.tintHue('sky'),
  project: grid.tintHue('slate'),
  layout: grid.tintHue('violet'),
  action: grid.tintHue('amber'),
  ask: grid.tintHue('indigo'),
  person: grid.tintHue('moss'),
  found: grid.tintHue('slate'),
}

export const known = (id) => ICONS[id] !== undefined
/** The colour for an id; the slate hue when the id is not known. */
export const hue = (id) => HUES[id] ?? grid.tintHue('slate')
/** The icon markup for an id at a size, drawn in currentColor; a neutral mark when the id is not known. */
export const svg = (id, size = 16) =>
  `<svg class="bcmodicon" viewBox="0 0 24 24" width="${String(size)}" height="${String(size)}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] ?? ICONS.project}</svg>`
