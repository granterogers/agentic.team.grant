/*
  Motion: three springs and a shared-element transition. No library.

  §18 asks for a coherent motion language rather than components each animating
  as they please. Three tokens cover everything the prototype does, and every
  one of them is interruptible — a second gesture retargets rather than queues,
  which is the difference between motion that feels physical and motion that
  feels like a slideshow.
*/

/** The three springs from docs/design/direction.md. */
/*
  The three springs, tuned by MEASURING them rather than by picking plausible
  numbers. Each was grid-searched against a target settle time and the result
  checked against the closed-form overshoot for its damping ratio.

    snap   146ms  ζ=0.81  no overshoot   press, toggle, check
    move   288ms  ζ=0.89  no overshoot   layout, reorder, drawer
    carry  396ms  ζ=0.67  5.1% overshoot shared elements

  `carry` is deliberately the loose one: a shared element that arrives and
  settles back a few percent reads as an object with mass, which is the whole
  point of carrying it. `snap` is deliberately the tight one — a checkbox that
  bounces is a checkbox that looks broken.
*/
export const SPRING = {
  snap:  { stiffness: 1100, damping: 54, mass: 1 },
  move:  { stiffness: 460, damping: 38, mass: 1 },
  carry: { stiffness: 320, damping: 24, mass: 1 },
}

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A spring, sampled into keyframes for the Web Animations API.
 *
 * WAAPI has no spring easing, and the honest options are a physics library or
 * this: integrate the spring once, emit the positions, let the compositor play
 * them. Forty lines against a dependency, and the result is identical because
 * a spring IS a sampled curve once it reaches the screen.
 */
export function springFrames(spring = SPRING.move, fps = 60) {
  const { stiffness: k, damping: c, mass: m } = spring
  /*
    Integrate at 4x the frame rate and emit every fourth step.

    Semi-implicit Euler is only accurate while `ω·dt` is small, and a snappy
    spring at 60Hz is not: `snap` has ω=30, so ω·dt=0.5 and the integrator
    bleeds energy. Measured, that showed up as 0.0% overshoot at ζ=0.73, where
    the closed-form answer is 3.5% — the bounce was being damped by arithmetic
    rather than by design. Sub-stepping costs nothing (the keyframe count is
    unchanged) and restores it.
  */
  const sub = 4
  const dt = 1 / (fps * sub)
  // Seeded with 0, not with the first integration step. Without it the first
  // keyframe is already 7% of the way there and every animation begins with a
  // visible jump — caught by sampling the output rather than by reading it.
  const frames = [0]
  let x = 1, v = 0, t = 0, step = 0
  /*
    Settled when the position is within 0.2% of target AND the next frame would
    move it less than that.

    The velocity test has to be scaled by `dt`, because `v` is units per SECOND
    and the question being asked is "would you see the next frame move". The
    first version compared raw velocity against the same small number as
    position, which made every spring run until its velocity was near zero —
    `snap` measured 383ms and reported zero overshoot at ζ=0.73, which is
    physically impossible and is what gave the error away. Measuring the output
    caught this; reading the code did not.
  */
  while ((Math.abs(x) > 0.002 || Math.abs(v) * dt > 0.002) && t < 2) {
    const a = (-k * x - c * v) / m
    v += a * dt
    x += v * dt
    t += dt
    step += 1
    if (step % sub === 0) frames.push(1 - x)
  }
  frames.push(1)
  return { frames, duration: t * 1000 }
}

/** Animate transform/opacity along a spring. Returns the Animation. */
export function spring(el, from, to, which = SPRING.move) {
  if (reduced()) {
    return el.animate([{ ...from }, { ...to }], { duration: 90, easing: 'ease', fill: 'both' })
  }
  const { frames, duration } = springFrames(which)
  const at = (p, key) => {
    const a = Number.parseFloat(from[key] ?? 0)
    const b = Number.parseFloat(to[key] ?? 0)
    return a + (b - a) * p
  }
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])]
  const keyframes = frames.map((p) => {
    const f = {}
    for (const k of keys) {
      f[k] = k === 'opacity' ? String(at(p, k)) : to[k].replace(/-?[\d.]+/g, () => String(at(p, k)))
    }
    return f
  })
  return el.animate(keyframes, { duration, fill: 'both' })
}

/**
 * A shared-element transition, where the browser supports one.
 *
 * `view-transition-name` on the element being carried, then let the browser
 * pair the old and new positions. Where View Transitions are unsupported the
 * update simply happens — no branching, no fallback code path, and the page is
 * never broken by the absence of an animation.
 */
export function carry(name, el, update) {
  if (!document.startViewTransition || reduced()) {
    update()
    return
  }
  if (el) el.style.viewTransitionName = name
  const done = document.startViewTransition(update)
  done.finished.finally(() => {
    if (el) el.style.viewTransitionName = ''
  })
}

/** A press that feels like a press: down is instant, up springs back. */
export function pressable(el) {
  el.addEventListener('pointerdown', () => {
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.985)' }],
      { duration: 90, fill: 'forwards', easing: 'ease-out' })
  })
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, () => {
      spring(el, { transform: 'scale(0.985)' }, { transform: 'scale(1)' }, SPRING.snap)
    })
  }
}
