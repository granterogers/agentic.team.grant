/*
  Generated cover art.

  Iteration 1 used flat colour blocks with a dot pattern, and that was the
  single worst thing about it: reference 5 of the board says *the artwork IS the
  interface*, so a coloured rectangle leaves the central idea of the whole
  direction untested.

  ## Why generate rather than illustrate

  A project has no artwork until Grant gives it some, and most never will. The
  choice is therefore between a placeholder that looks like a placeholder and
  one that looks deliberate. Generated art is deterministic from the slug — the
  same project always gets the same picture, so it becomes recognisable, which
  is the actual job of a cover (you navigate by recognising it, not by reading
  the title).

  ## What it draws

  Strata: overlapping translucent bands with drifting edges, in one hue at
  several lightnesses, screen-printed one over another. Chosen because it
  reads as *layers of material* — which is what a project here literally is —
  and because bands survive being cropped to any aspect ratio, which a
  composition with a subject does not.

  Everything is one inline SVG. No images, no requests, no library.
*/

/** A small deterministic PRNG, so a slug always draws the same picture. */
function seeded(slug) {
  let h = 2166136261
  for (const ch of slug) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13; h >>>= 0
    h ^= h >> 17
    h ^= h << 5; h >>>= 0
    return h / 4294967296
  }
}

/**
 * One band: a horizontal-ish ribbon whose top and bottom edges drift.
 *
 * Cubic curves rather than straight edges, because a straight band is a
 * rectangle and rectangles are what iteration 1 was criticised for.
 */
function band(rand, w, h, yTop, thickness) {
  const wobble = () => (rand() - 0.5) * h * 0.34
  const x1 = w * 0.33, x2 = w * 0.66
  const a = yTop + wobble()
  const b = yTop + wobble()
  const c = yTop + thickness + wobble()
  const d = yTop + thickness + wobble()
  return (
    `M -8 ${a.toFixed(1)} ` +
    `C ${x1} ${(a + wobble()).toFixed(1)}, ${x2} ${(b + wobble()).toFixed(1)}, ${w + 8} ${b.toFixed(1)} ` +
    `L ${w + 8} ${d.toFixed(1)} ` +
    `C ${x2} ${(d + wobble()).toFixed(1)}, ${x1} ${(c + wobble()).toFixed(1)}, -8 ${c.toFixed(1)} Z`
  )
}

/**
 * The cover for a project.
 *
 * `hue` is a CSS colour — the caller passes the project's own. Lightness
 * variation comes from opacity over the hue rather than from computed colours,
 * so the whole thing stays one hue and cannot drift into a second.
 */
export function coverSvg(slug, { w = 800, h = 400, dense = false } = {}) {
  const rand = seeded(slug)
  const count = dense ? 7 : 5
  const paths = []
  let y = -h * 0.15
  for (let i = 0; i < count; i += 1) {
    const thickness = h * (0.08 + rand() * 0.30)
    // Opacity descends down the stack so the composition has a light top and a
    // dense bottom — a horizon, rather than an even field.
    const opacity = (0.16 + rand() * 0.30).toFixed(2)
    paths.push(`<path d="${band(rand, w, h, y, thickness)}" fill="currentColor" opacity="${opacity}"/>`)
    y += thickness * (0.55 + rand() * 0.5)
  }
  // One thin bright line, placed on a band edge: the highlight that stops the
  // composition reading as mush, and the only crisp thing in it.
  const lineY = (h * (0.3 + rand() * 0.4)).toFixed(1)
  paths.push(
    `<path d="M -8 ${lineY} C ${w * 0.4} ${(Number(lineY) - h * 0.06).toFixed(1)}, ` +
      `${w * 0.7} ${(Number(lineY) + h * 0.05).toFixed(1)}, ${w + 8} ${lineY}" ` +
      `fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>`,
  )

  const id = `g-${slug.replace(/[^a-z0-9]/gi, '')}`
  // Two light sources placed by the seed, so no two covers are lit the same.
  const lx = (18 + rand() * 64).toFixed(0)
  const ly = (10 + rand() * 40).toFixed(0)

  return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"
       aria-hidden="true" focusable="false">
    <defs>
      <!-- The glow under everything: a soft light source, so the field is lit
           rather than filled. -->
      <radialGradient id="${id}-lit" cx="${lx}%" cy="${ly}%" r="82%">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.55"/>
        <stop offset="55%" stop-color="currentColor" stop-opacity="0.16"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </radialGradient>
      <!-- The sheen over everything: a raking highlight across the top left,
           which is what makes a flat shape look like a surface. -->
      <linearGradient id="${id}-sheen" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.30"/>
        <stop offset="42%" stop-color="#fff" stop-opacity="0.04"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.18"/>
      </linearGradient>
      <!-- Softened, not blurred. At 1.2% of height the bands dissolved into
           gradient washes and the strata reading was lost; 0.4% keeps the edges
           legible while taking the vector hardness off them. -->
      <filter id="${id}-soft"><feGaussianBlur stdDeviation="${(h * 0.004).toFixed(1)}"/></filter>
      <filter id="${id}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="${
          Math.floor(rand() * 100)
        }" result="n"/>
        <feColorMatrix in="n" type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.085"/></feComponentTransfer>
        <feComposite operator="in" in2="SourceGraphic"/>
      </filter>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#${id}-lit)"/>
    <!-- The strata, softened a touch so the edges read as depth of field
         rather than as vector cut-outs. -->
    <g filter="url(#${id}-soft)">${paths.join('')}</g>
    <rect width="${w}" height="${h}" fill="url(#${id}-sheen)"/>
    <rect width="${w}" height="${h}" filter="url(#${id})" opacity="0.95"/>
  </svg>`
}
