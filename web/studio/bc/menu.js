/*
  The project menu (8 October 2026): the hamburger in the top-left corner.

  It replaces the Home button, the Home screen's project list, the Jump To
  dialog and the bottom tray. Its open state lives here, on the module, because
  `render()` replaces everything inside #root on every paint: a flag on a node
  would be lost the first time the office answered while the menu was open.
  The shell draws the panel from this state, `wire.js` flips it, and the panel
  closes itself when the address changes, when Escape is pressed, or when
  anything outside it is pressed.
*/

let open = false
let making = false
let lastPath = ''

export const isOpen = () => open
export const isMaking = () => making

export const setOpen = (v) => {
  open = v === true
  if (!open) making = false
}
export const setMaking = (v) => {
  making = v === true
  if (making) open = true
}

/** Called on every draw with the current address: a navigation closes the menu. */
export const sync = (path) => {
  if (path !== lastPath) {
    lastPath = path
    open = false
    making = false
  }
}

/*
  CLOSING WITH A TRANSITION, THE WAY THE MAXIMISED VIEW DOES IT (bc/expand.js): THE CLOSE IS INSTANT AND THE MOTION IS A GHOST.
  The panel is drawn from this module's state on every paint, so closing is a redraw and the node it would animate is gone with
  it. A picture of the panel (a clone, fixed, pointer events off) lifts away on its own and removes itself, while the real menu is
  already shut: the page underneath is live at once, aria-expanded is false at once, and nothing that asks "is it closed" has to
  wait on motion. The button's cross folds back into three lines on the freshly drawn button. Reduced motion draws no ghost.
  `done` always runs, exactly once, immediately.
*/
const LEAVE_MS = 160
export const closeAnimated = (done) => {
  const panel = typeof document === 'undefined' ? null : document.querySelector('.bcmenupanel:not([hidden])')
  const calm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
  let ghost = null
  if (panel !== null && !calm && typeof panel.cloneNode === 'function') {
    const r = panel.getBoundingClientRect()
    ghost = panel.cloneNode(true)
    ghost.removeAttribute('id')
    for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.setAttribute('data-bc-menu-ghost', '')
    ghost.removeAttribute('role')
    /* Not the panel's own class: a page and its checks ask for ".bcmenupanel" and must find one, the real one. The look is copied. */
    const cs = globalThis.getComputedStyle(panel)
    ghost.className = 'bcmenupanel-ghost bcmenupanel--leaving'
    for (const k of ['backgroundColor', 'backgroundImage', 'borderTop', 'borderRadius', 'boxShadow', 'padding', 'transformOrigin'])
      ghost.style[k] = cs[k]
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${String(r.left)}px`,
      top: `${String(r.top)}px`,
      width: `${String(r.width)}px`,
      height: `${String(r.height)}px`,
      margin: '0',
      zIndex: '70',
      pointerEvents: 'none',
      maxHeight: 'none',
      overflow: 'hidden',
      boxSizing: 'border-box',
    })
  }
  setOpen(false)
  done()
  if (ghost === null) return
  document.body.append(ghost)
  document.querySelector('[data-bc-menu]')?.setAttribute('data-closing', '')
  globalThis.setTimeout(() => {
    ghost.remove()
    document.querySelector('[data-bc-menu]')?.removeAttribute('data-closing')
  }, LEAVE_MS + 40)
}
