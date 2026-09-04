/**
 * Staff avatars (§9).
 *
 * §9 makes the eight roles identities rather than function names: *"name,
 * title, avatar"*. Grant asked for "proper human avatars with unique profile
 * photos", and the useful part of that request is the reason behind it — a
 * team you address by name should look like a team, not like eight rows in a
 * table.
 *
 * ## Why these are illustrations and not photographs
 *
 * A photorealistic face implies a person. These roles are not people, and a
 * generated photo of a colleague who does not exist is the kind of thing that
 * is fine on a dashboard and not fine the moment a screenshot leaves it. §12
 * spends its whole length on not presenting inference as observation; putting
 * a fake photograph on an inference engine would undo that in one image.
 *
 * So: recognisably human portraits — head, shoulders, hair, features, varied
 * skin tones and presentation — drawn in a flat illustrative style that nobody
 * mistakes for a camera. That keeps what Grant actually wanted (distinct,
 * human, memorable) without the part that would misrepresent.
 *
 * ## Deterministic
 *
 * Every feature derives from a hash of the slug, so a role's face is stable
 * across regenerations and across machines. An avatar that changed on each
 * deploy would be worse than none: recognition is the entire function.
 */

/** FNV-1a. Small, stable, and not a security primitive — used only for spread. */
const hash = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** A deterministic stream of small numbers from one seed. */
const picker = (seed: number) => {
  let state = seed
  return {
    next: (n: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % n
    },
  }
}

const SKIN = [
  { base: '#f2c9a0', shade: '#dcae83' },
  { base: '#e3b088', shade: '#c9926a' },
  { base: '#c98d61', shade: '#ac7248' },
  { base: '#a26a42', shade: '#874f2c' },
  { base: '#7c4a25', shade: '#61371a' },
  { base: '#5a3418', shade: '#43250f' },
  { base: '#ffd9b8', shade: '#eabf98' },
  { base: '#8d5a34', shade: '#6f4222' },
] as const

const HAIR = [
  '#2b1b14',
  '#12100f',
  '#4a2f1d',
  '#7a4a22',
  '#a8642c',
  '#b8ab98',
  '#8a8f96',
  '#3d2b3a',
] as const

/** Backgrounds are role-tinted so the eight read as a set, not a jumble. */
const BACKDROPS = [
  ['#e8eef7', '#c9d8ef'],
  ['#eaf3ec', '#c8e2d1'],
  ['#f6eee7', '#e6d2bf'],
  ['#efeaf6', '#d6cbe9'],
  ['#fdf0ee', '#f3cfc8'],
  ['#e9f2f4', '#c5dfe4'],
  ['#f4f1e6', '#e0d8bd'],
  ['#eceaf0', '#d2cdd9'],
] as const

const CLOTHES = [
  '#3c5a7a',
  '#2f5d50',
  '#6b3f52',
  '#4a4468',
  '#7a5230',
  '#33556b',
  '#5b5f43',
  '#5a3f57',
] as const

/**
 * Hair, as a shape drawn over the skull.
 *
 * Eight silhouettes rather than one with a colour swap: colour alone reads as
 * the same person recoloured, which defeats the point at thumbnail size where
 * these are actually seen.
 */
const hairShape = (style: number, colour: string): string => {
  const c = `fill="${colour}"`
  switch (style) {
    case 0: // short crop
      return `<path ${c} d="M78 108c0-30 22-50 50-50s50 20 50 50c0 6-2 10-4 12-3-16-14-26-26-28-14-3-32 2-44 12-8 6-14 12-16 20-6-4-10-10-10-16z"/>`
    case 1: // tight curls, close to the head
      return `<g ${c}><circle cx="128" cy="62" r="17"/><circle cx="103" cy="70" r="16"/><circle cx="153" cy="70" r="16"/><circle cx="87" cy="88" r="15"/><circle cx="169" cy="88" r="15"/><circle cx="82" cy="109" r="13"/><circle cx="174" cy="109" r="13"/><circle cx="128" cy="76" r="16"/></g>`
    case 2: // bob, jaw length
      return `<path ${c} d="M74 118c0-34 24-58 54-58s54 24 54 58c0 22-4 38-8 46-3-8-4-24-4-40-14 8-30 12-42 12s-28-4-42-12c0 16-1 32-4 40-4-8-8-24-8-46z"/>`
    case 3: // long, past the shoulders
      return `<path ${c} d="M72 120c0-36 25-62 56-62s56 26 56 62c0 34-2 62-6 78-6-4-10-14-11-30-2-22-2-44-3-56-13 10-24 14-36 14s-23-4-36-14c-1 12-1 34-3 56-1 16-5 26-11 30-4-16-6-44-6-78z"/>`
    case 4: // side part with a sweep
      return `<path ${c} d="M76 112c0-32 24-54 52-54 26 0 48 16 52 42 1 8 0 14-2 18-4-14-12-22-22-26-16 6-40 10-56 22-9 7-14 14-16 22-5-6-8-14-8-24z"/>`
    case 5: // bun, hair pulled back
      return `<g ${c}><path d="M80 110c0-30 22-52 48-52s48 22 48 52c0 5-1 9-3 12-4-18-16-30-31-34-16-4-38 0-52 12-6 5-9 10-10 16-3-2-4-6-4-6z"/><circle cx="128" cy="42" r="16"/></g>`
    case 6: // buzz cut, following the skull
      return `<path ${c} d="M82 110c0-28 20-48 46-48s46 20 46 48c0 4-1 7-2 9-5-14-20-24-44-24s-39 10-44 24c-1-2-2-5-2-9z"/>`
    default: // shoulder-length waves
      return `<path ${c} d="M74 116c0-34 24-58 54-58s54 24 54 58c0 26-3 48-7 60-5-6-7-18-8-34-14 10-26 14-39 14s-25-4-39-14c-1 16-3 28-8 34-4-12-7-34-7-60z"/>`
  }
}

/**
 * A collar, so the eight are not all wearing the same shirt.
 *
 * Drawn AFTER the neck and as a thin frame rather than a filled slab. The
 * first version filled a large white triangle at 0.9 opacity before the neck
 * was drawn, so the neck cut a notch out of it and the result read as a pale
 * wedge floating on the chest rather than as clothing.
 */
const collar = (style: number, cloth: string): string => {
  const shade = `<path fill="#000000" fill-opacity="0.13" d="M104 200c8 14 16 22 24 26 8-4 16-12 24-26l6 4c-9 18-19 28-30 33-11-5-21-15-30-33z"/>`
  switch (style % 3) {
    case 0: // open collar with visible undershirt
      return `${shade}<path fill="#efe9e0" fill-opacity="0.85" d="M108 200l20 24 20-24 8 5-28 31-28-31z"/><path fill="${cloth}" d="M112 196l16 19 16-19 5 3-21 25-21-25z"/>`
    case 1: // crew neck
      return `${shade}<path fill="none" stroke="#efe9e0" stroke-opacity="0.42" stroke-width="6" d="M100 199c9 13 18 20 28 20s19-7 28-20"/>`
    default: // lapels
      return `${shade}<path fill="#efe9e0" fill-opacity="0.85" d="M110 199l18 22 18-22 9 6-27 30-27-30z"/><path fill="#000000" fill-opacity="0.16" d="M108 196l20 24-5 6-24-24z"/>`
  }
}

export interface AvatarChoices {
  readonly skin: number
  readonly hair: number
  readonly hairStyle: number
  readonly backdrop: number
  readonly clothes: number
  readonly collar: number
  readonly glasses: boolean
  readonly beard: boolean
}

/**
 * Derive the features for a slug.
 *
 * Exported so the generator and its tests agree, and so a future role gets a
 * face without anyone choosing one.
 */
export const chooseFeatures = (slug: string): AvatarChoices => {
  const p = picker(hash(slug))
  return {
    skin: p.next(SKIN.length),
    hairStyle: p.next(8),
    hair: p.next(HAIR.length),
    backdrop: p.next(BACKDROPS.length),
    clothes: p.next(CLOTHES.length),
    collar: p.next(3),
    glasses: p.next(3) === 0,
    beard: p.next(4) === 0,
  }
}

/**
 * Render one portrait.
 *
 * `overrides` exists because a hash spreads features evenly and evenly is not
 * the same as well: two adjacent roles can land on near-identical faces, and
 * at 40px in a sidebar that is a bug. The generator diffs the set and pins the
 * collisions rather than reseeding until it gets lucky.
 */
export const renderAvatar = (slug: string, overrides: Partial<AvatarChoices> = {}): string => {
  const f = { ...chooseFeatures(slug), ...overrides }
  const skin = SKIN[f.skin % SKIN.length] as { base: string; shade: string }
  const hair = HAIR[f.hair % HAIR.length] as string
  const [bg1, bg2] = BACKDROPS[f.backdrop % BACKDROPS.length] as readonly [string, string]
  const cloth = CLOTHES[f.clothes % CLOTHES.length] as string
  const id = slug.replace(/[^a-z0-9]/g, '')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Illustrated portrait for ${slug}">
  <defs>
    <radialGradient id="bg${id}" cx="50%" cy="38%" r="72%">
      <stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/>
    </radialGradient>
    <clipPath id="clip${id}"><circle cx="128" cy="128" r="128"/></clipPath>
  </defs>
  <g clip-path="url(#clip${id})">
    <rect width="256" height="256" fill="url(#bg${id})"/>

    <!-- neck first, then body, then collar. The reverse order put the collar
         under the neck and produced a pale wedge where clothing should be. -->
    <path fill="${skin.shade}" d="M110 164h36v40c0 9-8 14-18 14s-18-5-18-14z"/>
    <path fill="${cloth}" d="M40 256c0-44 34-64 88-64s88 20 88 64z"/>
    <path fill="#000000" fill-opacity="0.09" d="M40 256c0-44 34-64 88-64v64z"/>
    ${collar(f.collar, cloth)}

    <!-- head -->
    <ellipse cx="128" cy="120" rx="49" ry="57" fill="${skin.base}"/>
    <!-- Soft edge shading. Written first as a filled half-ellipse over the
         right side of the face, which rendered as a hard vertical seam down
         the middle of every portrait - the kind of thing that is invisible in
         the path data and unmissable in a contact sheet. -->
    <ellipse cx="152" cy="126" rx="30" ry="52" fill="${skin.shade}" fill-opacity="0.22"/>
    <ellipse cx="128" cy="168" rx="30" ry="14" fill="${skin.shade}" fill-opacity="0.16"/>
    <!-- ears -->
    <ellipse cx="79" cy="124" rx="9" ry="13" fill="${skin.base}"/>
    <ellipse cx="177" cy="124" rx="9" ry="13" fill="${skin.shade}"/>

    ${hairShape(f.hairStyle, hair)}

    <!-- brows -->
    <path stroke="${hair}" stroke-width="5" stroke-linecap="round" fill="none" d="M104 110c5-4 14-4 19 0"/>
    <path stroke="${hair}" stroke-width="5" stroke-linecap="round" fill="none" d="M133 110c5-4 14-4 19 0"/>
    <!-- eyes -->
    <ellipse cx="113" cy="124" rx="7" ry="8" fill="#ffffff"/>
    <ellipse cx="143" cy="124" rx="7" ry="8" fill="#ffffff"/>
    <circle cx="114" cy="125" r="4" fill="#2a2118"/>
    <circle cx="144" cy="125" r="4" fill="#2a2118"/>

    <!-- Beard before the mouth, so the mouth stays visible. The other way
         round, a beard swallowed the whole lower face.
         Two small sideburn accents were removed after rasterising at 512px:
         they read as connected shading at 150px and as floating dark shards at
         full size. Worth the note because it is the second time these have
         only been wrong at a size nobody was looking at. -->
    ${
      f.beard
        ? `<path fill="${hair}" fill-opacity="0.95" d="M92 154c2 8 4 14 7 19 7 14 18 22 29 22s22-8 29-22c3-5 5-11 7-19 1 12 0 21-4 29-7 15-19 24-32 24s-25-9-32-24c-4-8-5-17-4-29z"/>`
        : ''
    }

    <!-- nose and mouth -->
    <path stroke="${skin.shade}" stroke-width="4" stroke-linecap="round" fill="none" d="M128 130v12l-6 4"/>
    <path stroke="${f.beard ? '#c08074' : '#8d4f43'}" stroke-width="4" stroke-linecap="round" fill="none" d="M117 158c7 6 15 6 22 0"/>

    ${
      f.glasses
        ? `<g fill="none" stroke="#3a3a3a" stroke-width="4" stroke-opacity="0.85">
             <rect x="98" y="112" width="30" height="24" rx="9"/>
             <rect x="130" y="112" width="30" height="24" rx="9"/>
             <path d="M128 122h2"/><path d="M98 120l-14 4"/><path d="M160 120l14 4"/>
           </g>`
        : ''
    }
  </g>
</svg>`
}

/**
 * Features pinned by hand, where the hash produced a clash.
 *
 * A hash spreads features evenly, and evenly is not the same as well: two of
 * the eight roles landed on the same skin, hair and hairstyle, which is
 * invisible in the code and unmissable in a row of 44px thumbnails. Pinned
 * rather than reseeded, because reseeding until the spread looks right hides
 * which roles collided and re-hides it the next time the set changes.
 */
export const AVATAR_OVERRIDES: Readonly<Record<string, Partial<AvatarChoices>>> = {
  'communications-director': { skin: 1, hair: 6, hairStyle: 3, glasses: true },
  'quality-director': { skin: 3, hair: 5, hairStyle: 0 },
}

/** The features actually used for a slug, overrides applied. */
export const featuresFor = (slug: string): AvatarChoices => ({
  ...chooseFeatures(slug),
  ...AVATAR_OVERRIDES[slug],
})

/**
 * What makes two portraits "the same person" at thumbnail size.
 *
 * Backdrop, clothing and collar are deliberately excluded: they are not what
 * distinguishes a face, and counting them would let two identical faces in
 * different shirts pass as distinct.
 */
export const identityKey = (slug: string): string => {
  const f = featuresFor(slug)
  return `${String(f.skin)}/${String(f.hair)}/${String(f.hairStyle)}/${String(f.glasses)}/${String(f.beard)}`
}

/** Render with overrides applied. The normal entry point. */
export const avatarFor = (slug: string): string => renderAvatar(slug, AVATAR_OVERRIDES[slug] ?? {})

export { BACKDROPS, CLOTHES, HAIR, SKIN }
