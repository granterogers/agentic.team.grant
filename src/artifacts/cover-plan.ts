/**
 * Decisions the cover makes before it draws anything, kept pure so a test can drive them with a number.
 *
 *   - `logoPlate`: whether a logo needs a plate behind it, and what colour. Decided from the logo's own pixels (the
 *     mean luminance of its opaque pixels, read once in `image.ts`) against the colour of the field it sits on.
 *     Never from the file name, never from a guess about "brand colours".
 *   - `logoBox`: how large the logo is drawn, with a floor so it stays readable and a ceiling so it never dominates.
 *   - `TITLE_STEPS`: the sizes a long title steps down through before it is cut.
 *
 * Deterministic: the same logo, field and palette always give the same answer.
 */

import type { PdfImage } from './image.ts'
import type { Rgb } from './pdf.ts'
import { contrast } from './style.ts'

const grey = (linear: number): Rgb => {
  // linear luminance back to a sRGB grey, so the shared WCAG `contrast` can be asked about it
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055
  const v = Math.min(1, Math.max(0, c))
  return { b: v, g: v, r: v }
}

export interface LogoPlate {
  /** The plate colour, or null when the logo is drawn straight on the field. */
  readonly plate: Rgb | null
  /** Why, in a few words, for a note or a test. */
  readonly why: string
}

/**
 * @param band  true when the field is the dark primary band; false when it is the light wash.
 * @param field the colour of the field behind the masthead.
 * @param paper the page colour (the light plate).
 * @param dark  the dark plate: the palette's primary where it is dark enough, else its ink.
 */
export function logoPlate(
  image: Pick<PdfImage, 'luma' | 'smask'>,
  band: boolean,
  field: Rgb,
  paper: Rgb,
  dark: Rgb,
): LogoPlate {
  // A logo with no transparency is a rectangle that carries its own background: nothing can vanish into the field.
  // On a band it keeps the paper plate it has always had, so the rectangle is framed rather than butted to the colour.
  if (image.smask === undefined || image.luma === undefined)
    return band
      ? { plate: paper, why: 'opaque logo framed on the band' }
      : { plate: null, why: 'opaque logo needs no plate' }

  // "Light" is a property of most of the visible pixels, not of their average: a dark wordmark beside an orange tile
  // averages mid-grey and is perfectly legible on a pale field, while a white mark is lost on it.
  const light = image.luma.light >= LIGHT_SHARE
  const logo = grey(image.luma.mean)
  if (band) {
    // A light logo that stands off the band is best straight on it (a white mark on a dark band); one that does not
    // gets the dark plate. Everything else keeps the paper plate it has always had, so a dark or mid logo is legible
    // on any band colour.
    if (light)
      return contrast(logo, field) >= 3
        ? { plate: null, why: 'light logo stands off the band' }
        : { plate: dark, why: 'light logo on a dark plate' }
    return { plate: paper, why: 'logo on a paper plate' }
  }
  if (light) return { plate: dark, why: 'light logo on a dark plate' }
  return { plate: null, why: 'logo stands off the field' }
}

/** A logo is "light" when at least this share of its visible pixels is pale. */
export const LIGHT_SHARE = 0.6

/** The logo's drawn size in points: inside 150 x 52, kept to its proportions, never smaller than it can be read. */
export const LOGO_MAX = { h: 52, w: 150 } as const
export const LOGO_WIDE_MAX_W = 230
export const LOGO_MIN_H = 22
/** Under this height even the widened box leaves a logo nobody can read: it is left off, with a note. */
export const LOGO_FLOOR_H = 10

export function logoBox(image: { readonly width: number; readonly height: number }): {
  readonly w: number
  readonly h: number
  readonly tooThin: boolean
} {
  const aspect = image.width / image.height
  let s = Math.min(LOGO_MAX.w / image.width, LOGO_MAX.h / image.height)
  let w = image.width * s
  let h = image.height * s
  if (h < LOGO_MIN_H) {
    // a wide strip: take more width so its height reaches the floor, but never more than the widened ceiling
    w = Math.min(LOGO_WIDE_MAX_W, LOGO_MIN_H * aspect)
    s = w / image.width
    h = image.height * s
  }
  return { h, tooThin: h < LOGO_FLOOR_H, w }
}

/** Title sizes, largest first: [size, leading, most lines allowed at that size]. The last step is the floor. */
export const TITLE_STEPS: readonly (readonly [number, number, number])[] = [
  [30, 36, 2],
  [25, 30, 3],
  [22, 27, 4],
  [20, 24, 5],
]
