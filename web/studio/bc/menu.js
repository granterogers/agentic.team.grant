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
