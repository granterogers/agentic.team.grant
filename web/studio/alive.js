/*
  The things that make it feel like an object rather than a picture of one.

  Grant: *"pushed a lot further .. get creative!"*

  Four behaviours, all transform-and-opacity only, all switched off under
  `prefers-reduced-motion`. Each one is a real physical cue rather than an
  effect: light moves when you move, surfaces turn towards you, material drifts,
  and paper stacks unevenly.
*/

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Tilt towards the pointer, and catch the light while doing it.
 *
 * The single strongest "this is a physical thing" cue available in a browser:
 * a surface that turns to face you, with a specular highlight that slides
 * across it as it turns. Both driven by the same two numbers, so the light and
 * the geometry agree — which is what stops it looking like two separate
 * effects layered up.
 *
 * Rotation is deliberately small (max 5°). Past about 8° a card stops reading
 * as a surface catching light and starts reading as a novelty.
 */
export function tiltable(el, { max = 5, scale = 1.012 } = {}) {
  if (reduced()) return
  let raf = 0

  const move = (e) => {
    const r = el.getBoundingClientRect()
    // −1 … 1 from the centre of the element.
    const px = (e.clientX - r.left) / r.width * 2 - 1
    const py = (e.clientY - r.top) / r.height * 2 - 1
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      el.style.transform =
        `perspective(1100px) rotateY(${(px * max).toFixed(2)}deg) ` +
        `rotateX(${(-py * max).toFixed(2)}deg) scale(${scale}) translateZ(0)`
      // The highlight sits where the pointer is, so the light source is the
      // cursor. Percentages rather than pixels so it survives a resize.
      el.style.setProperty('--gx', `${(((px + 1) / 2) * 100).toFixed(1)}%`)
      el.style.setProperty('--gy', `${(((py + 1) / 2) * 100).toFixed(1)}%`)
      el.style.setProperty('--glare', '1')
    })
  }

  const leave = () => {
    cancelAnimationFrame(raf)
    el.style.transform = ''
    el.style.setProperty('--glare', '0')
  }

  el.addEventListener('pointermove', move)
  el.addEventListener('pointerleave', leave)
  // A touch is a tap, not a hover: tilting under a finger the user cannot see
  // past is worse than not tilting.
  el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') leave() })
}

/**
 * The page takes a faint tint from whatever is in front of you.
 *
 * Opening a project shifts the whole ground a few percent towards that
 * project's hue. It is barely perceptible in a screenshot and very perceptible
 * when it changes, which is the point: the room changes colour when you walk
 * into a different one.
 */
export function ambient(hueClass) {
  document.documentElement.dataset.tint = hueClass ?? ''
}

/**
 * Living artwork.
 *
 * Each cover's strata drift at their own rate, seeded from the element's
 * position in the DOM so no two are in phase. Very slow — a full cycle is
 * around a minute — so it never reads as animation, only as the page not being
 * quite still.
 */
export function breathe(root = document) {
  if (reduced()) return
  for (const [i, art] of [...root.querySelectorAll('.art > g')].entries()) {
    art.animate(
      [
        { transform: 'translate3d(0,0,0) scale(1.04)' },
        { transform: `translate3d(${i % 2 ? '-' : ''}1.2%, -0.8%, 0) scale(1.07)` },
        { transform: 'translate3d(0,0,0) scale(1.04)' },
      ],
      { duration: 42_000 + i * 5_500, iterations: Number.POSITIVE_INFINITY, easing: 'ease-in-out' },
    )
  }
}

/**
 * Paper stacks unevenly.
 *
 * Each document sheet gets a fixed sub-degree rotation from its index, so a row
 * of them reads as a pile someone put down rather than as a grid someone
 * aligned. Fixed rather than random, because a card that rotates differently on
 * every render is a card that jitters when anything re-renders.
 */
export function scatter(root = document) {
  for (const [i, page] of [...root.querySelectorAll('.doc .page')].entries()) {
    const tilt = (((i * 37) % 7) - 3) * 0.22
    page.style.setProperty('--rest-tilt', `${tilt.toFixed(2)}deg`)
  }
}
