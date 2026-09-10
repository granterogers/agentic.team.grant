/*
  Projects on a surface, where you left them.

  #23 idea 9, and the one flagged as most likely to be wrong. The claim is that
  spatial memory does navigation's job better than a list does: you do not
  remember that Legacy Coaching Course is third, you remember it is over on the
  left near the window.

  ## Why it is a mode rather than the home screen

  Because the claim might be false, and a list is a perfectly good way to see
  three projects. The canvas is offered beside the portfolio, not instead of it,
  so it can be judged on use rather than on argument — and removed cheaply if
  it turns out to be a toy.

  ## Positions are his

  Dragged, remembered, and never rearranged by anything else. A surface that
  tidies itself is a surface you cannot remember, which defeats the entire
  point.
*/

const KEY = 'studio.canvas'

/** Where each project sits, keyed by slug. */
export function positions(projects) {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { saved = {} }
  const out = {}
  projects.forEach((p, i) => {
    // A first layout that is deliberately NOT a grid — a slight stagger, so the
    // surface reads as a desk from the first moment rather than as a table
    // waiting to be messed up.
    out[p.slug] = saved[p.slug] ?? {
      x: 60 + (i % 3) * 330 + (i % 2) * 28,
      y: 60 + Math.floor(i / 3) * 300 + (i % 3) * 34,
    }
  })
  return out
}

const save = (pos) => {
  try { localStorage.setItem(KEY, JSON.stringify(pos)) } catch { /* fine */ }
}

/**
 * Make the surface pannable and its cards draggable.
 *
 * Pointer Events throughout, so a mouse, a trackpad and a finger take the same
 * path — and `setPointerCapture` so a fast drag that leaves the element does
 * not drop the card mid-air, which is the single most common way hand-rolled
 * dragging feels broken.
 */
export function wire(surface, pos, onMoved) {
  let panning = null
  let dragging = null

  const view = { x: 0, y: 0 }
  const paint = () => {
    surface.style.transform = `translate3d(${view.x}px, ${view.y}px, 0)`
  }

  // --- panning the surface ---------------------------------------------------
  const stage = surface.parentElement
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-card]')) return        // a card handles its own
    panning = { x: e.clientX - view.x, y: e.clientY - view.y }
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('grabbing')
  })
  stage.addEventListener('pointermove', (e) => {
    if (panning === null) return
    view.x = e.clientX - panning.x
    view.y = e.clientY - panning.y
    paint()
  })
  const endPan = () => { panning = null; stage.classList.remove('grabbing') }
  stage.addEventListener('pointerup', endPan)
  stage.addEventListener('pointercancel', endPan)

  // --- dragging a card -------------------------------------------------------
  for (const card of surface.querySelectorAll('[data-card]')) {
    const slug = card.dataset.card
    card.addEventListener('pointerdown', (e) => {
      dragging = {
        slug,
        dx: e.clientX - pos[slug].x,
        dy: e.clientY - pos[slug].y,
        moved: false,
      }
      card.setPointerCapture(e.pointerId)
      card.classList.add('lifted')
    })
    card.addEventListener('pointermove', (e) => {
      if (dragging === null || dragging.slug !== slug) return
      const x = e.clientX - dragging.dx
      const y = e.clientY - dragging.dy
      // A few pixels of slop before it counts as a drag, or every click on a
      // card would also nudge it a pixel and then not open it.
      if (Math.abs(x - pos[slug].x) + Math.abs(y - pos[slug].y) > 4) dragging.moved = true
      pos[slug] = { x, y }
      card.style.left = `${x}px`
      card.style.top = `${y}px`
    })
    const drop = () => {
      if (dragging === null) return
      const wasMoved = dragging.moved
      card.classList.remove('lifted')
      dragging = null
      if (wasMoved) { save(pos); onMoved?.(slug) }
    }
    card.addEventListener('pointerup', (e) => {
      const wasMoved = dragging?.moved === true
      drop()
      // A drag is not a click. Without this, letting go after moving a card
      // opens the project you were only trying to tidy.
      if (wasMoved) { e.preventDefault(); e.stopPropagation() }
    })
    card.addEventListener('pointercancel', drop)
  }

  paint()
}
