/*
  THE SPATIAL TRANSITION BETWEEN A CARD AND ITS MAXIMISED VIEW.

  Grant, 4 October 2026: smooth spatial transition is a general Team HQ design
  principle. A maximised module must not pop into existence - it grows FROM the
  card it was on, and when it is put away it settles back TOWARDS that card.
  Restrained, physically coherent, responsive, and silent under
  prefers-reduced-motion.

  The technique is FLIP: measure where the card is, let the dialog be laid out
  where it really goes, then animate the dialog from the card's rectangle to its
  own with a transform. Nothing is animated that is not already in its final
  place, so there is no layout work during the transition and the dialog's
  content never reflows.

  The page redraws wholesale (`#root` is replaced), so the card's rectangle is
  remembered BEFORE the state changes and played AFTER the draw. Both halves are
  one-shot: a redraw that lands while the dialog is open (a fetch finishing)
  must not play the entrance again.
*/

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const EASE_IN = 'cubic-bezier(0.4, 0, 0.8, 0.4)'

const calm = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

let from = null

const cardFor = (id) =>
  document.querySelector(`.bcstage [data-mod="${id}"]`) ??
  document.querySelector(`.bcunder [data-mod="${id}"]`) ??
  document.querySelector(`[data-mod="${id}"]`)

const rectOf = (el) => {
  if (el === null) return null
  const r = el.getBoundingClientRect()
  return r.width < 8 || r.height < 8 ? null : { x: r.x, y: r.y, w: r.width, h: r.height }
}

/** Remember where the card is. Call BEFORE the expanded state is set. */
export const remember = (id) => {
  from = rectOf(cardFor(id))
}

const flip = (box, a, b) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const sx = a.w / b.w
  const sy = a.h / b.h
  return [
    { transformOrigin: '0 0', transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(sx)}, ${String(sy)})` },
    { transformOrigin: '0 0', transform: 'none' },
  ]
}

/** Play the entrance, if a card was remembered and motion is welcome. */
export const play = (root) => {
  const card = from
  from = null
  const box = root.querySelector('.bcexp .bcexpbox')
  if (box === null || card === null || calm() || typeof box.animate !== 'function') return
  const to = box.getBoundingClientRect()
  if (to.width < 8) return
  box.animate(flip(box, card, { x: to.x, y: to.y, w: to.width, h: to.height }), {
    duration: 380,
    easing: EASE_OUT,
  })
  root.querySelector('.bcexp .bcexpback')?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 300,
    easing: 'ease-out',
  })
  root.querySelector('.bcexp .bcexpbody')?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], {
    duration: 380,
    easing: 'ease-out',
  })
}

/**
 * Put the dialog away, back towards its card, then call `done`.
 *
 * `done` is always called, exactly once, even when there is nothing to animate
 * or the animation is interrupted: a close that waits on an animation that
 * never finishes is a dialog that cannot be closed.
 */
export const exit = (id, done) => {
  const box = document.querySelector('.bcexp .bcexpbox')
  const card = rectOf(cardFor(id))
  let called = false
  const finish = () => {
    if (called) return
    called = true
    done()
  }
  if (box === null || card === null || calm() || typeof box.animate !== 'function') {
    finish()
    return
  }
  const to = box.getBoundingClientRect()
  const motion = box.animate(
    [...flip(box, card, { x: to.x, y: to.y, w: to.width, h: to.height })].reverse().map((f, i) => ({
      ...f,
      opacity: i === 0 ? 1 : 0.25,
    })),
    { duration: 260, easing: EASE_IN, fill: 'forwards' },
  )
  document.querySelector('.bcexp .bcexpback')?.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 240,
    fill: 'forwards',
  })
  motion.onfinish = finish
  motion.oncancel = finish
  globalThis.setTimeout(finish, 420)
}
