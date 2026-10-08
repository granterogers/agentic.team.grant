/*
  The Team Chat dock's width (8 October 2026).

  The dock is a fixed column on the right, outside the canvas, so it is never
  scaled by canvas zoom and a canvas pan cannot move it. Its width is a CSS
  variable, --dock-w, that the dock and the page padding beside it both read, so
  they cannot disagree. The grip on its left edge drags it; the arrow keys move
  it for anyone without a pointer; double press resets it. The width is stored
  in this browser, per person, because it is a preference about this screen and
  not a fact about a project.

  The dock's contents are replaced on every paint, so the grip is re-attached
  after each one and the drag listens on the document, not on the grip: a
  message arriving mid-drag must not end the gesture.
*/

const KEY = 'bc.dockw'
export const MIN = 280
export const DEFAULT = 340
const MAX_FRACTION = 0.7
const MAX_ABS = 760

export const clamp = (w, viewport = globalThis.innerWidth ?? 1440) =>
  Math.round(Math.max(MIN, Math.min(MAX_ABS, viewport * MAX_FRACTION, Number.isFinite(w) ? w : DEFAULT)))

const stored = () => {
  try {
    const n = Number(globalThis.localStorage?.getItem(KEY))
    return Number.isFinite(n) && n > 0 ? n : DEFAULT
  } catch {
    return DEFAULT
  }
}

let width = clamp(stored())

const apply = () => {
  document.documentElement.style.setProperty('--dock-w', `${String(width)}px`)
  window.dispatchEvent(new Event('bc-dock-resized'))
}
const save = () => {
  try {
    globalThis.localStorage?.setItem(KEY, String(width))
  } catch {
    // a preference that cannot be kept is still honoured for this session
  }
}
export const widthNow = () => width
export const setWidth = (w, keep = true) => {
  width = clamp(w)
  apply()
  if (keep) save()
}

let wired = false
const stretch = (box) => {
  box.style.height = 'auto'
  box.style.height = `${String(Math.min(box.scrollHeight, 150))}px`
}

/** Called after every dock paint: the grip, and the composer that grows with what is typed. */
export const mount = (dock) => {
  if (!wired) {
    wired = true
    apply()
    globalThis.addEventListener('resize', () => {
      const next = clamp(width)
      if (next !== width) setWidth(next, false)
    })
  }
  if (dock.querySelector('.dockgrip') === null) {
    const g = document.createElement('div')
    g.className = 'dockgrip'
    g.setAttribute('role', 'separator')
    g.setAttribute('aria-orientation', 'vertical')
    g.setAttribute('aria-label', 'Resize the conversation. Drag, or use the left and right arrow keys')
    g.setAttribute('aria-valuemin', String(MIN))
    g.setAttribute('aria-valuenow', String(width))
    g.tabIndex = 0
    g.title = 'Drag to resize. Double press to reset'
    dock.prepend(g)
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const startW = width
      document.documentElement.classList.add('bc-dockdragging')
      const move = (ev) => {
        setWidth(startW + (startX - ev.clientX), false)
        g.setAttribute('aria-valuenow', String(width))
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', up)
        document.documentElement.classList.remove('bc-dockdragging')
        save()
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', up)
    })
    g.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 80 : 20
      if (e.key === 'ArrowLeft') setWidth(width + step)
      else if (e.key === 'ArrowRight') setWidth(width - step)
      else if (e.key === 'Home') setWidth(DEFAULT)
      else return
      e.preventDefault()
      g.setAttribute('aria-valuenow', String(width))
    })
    g.addEventListener('dblclick', () => {
      setWidth(DEFAULT)
      g.setAttribute('aria-valuenow', String(width))
    })
  } else {
    dock.querySelector('.dockgrip')?.setAttribute('aria-valuenow', String(width))
  }
  const box = dock.querySelector('[data-docksay]')
  if (box !== null && box.dataset.grows !== '1') {
    box.dataset.grows = '1'
    box.addEventListener('input', () => {
      stretch(box)
    })
  }
  if (box !== null) stretch(box)
}

/** Ask the composer to re-measure after its text was set by code (a dictated phrase, a restored draft). */
export const regrow = (dock) => {
  const box = dock.querySelector('[data-docksay]')
  if (box !== null) stretch(box)
}
