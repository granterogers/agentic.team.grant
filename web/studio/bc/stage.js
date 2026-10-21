/*
  THE WORKSPACE, WIRED.

  Pointer, keyboard and wheel behaviour for the freeform stage that
  `compose.js` draws and `layout.js` stores (4 October 2026). It is a module of
  its own because `wire.js` is already 3,000 lines and this is a coherent unit:
  everything here is about ONE element, `[data-bc-board]`, and nothing in it
  needs the rest of the page.

  The decisions worth stating, because each is a trap this repository has paid
  for:

   1. **A drag never re-renders.** The old board redrew the page on every
      drop, which resets every module's scroll position. Here a gesture paints
      inline styles directly, saves once on release, and the page is not
      redrawn at all. What was under the pointer is what is stored.

   2. **The header is both the press and the handle.** A pointer that moves
      more than four pixels is a drag and the click that follows is swallowed;
      one that does not is an ordinary press and opens the module. One element,
      two meanings, decided by what the person did.

   3. **Pointer capture** keeps the gesture with the module when the pointer
      leaves it, and gives touch and pen the same path as the mouse.

   4. **Zoom is applied by the page and committed late.** A trackpad pinch is
      dozens of wheel events a second; each one scaling the stage is cheap, and
      each one writing the document is not. The stage follows the gesture and
      the store hears about it 250ms after it stops.

   5. **Nothing here is allowed to take a note's text.** Reset, tidy and layout
      loading touch rectangles. The Post-it text lives in `layout.postits` and
      only `removePostit`, pressed on a note's own cross, deletes any of it.

  Comments inside any template literal in this file use plain words: a backtick
  inside one ends the string.
*/

import * as backdrop from './backdrop.js'
import * as cal from './calendar.js'
import * as grid from './layout.js'
import { NAMES, note } from './compose.js'
import { esc } from './parts.js'

const PHONE = '(max-width: 860px)'
/** Pixels kept under the stage for the tray and the page's own bottom margin. */
const RESERVE = 24
const SWALLOW_MS = 350

const calm = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

export const wireStage = (root, ctx) => {
  const board = root.querySelector('[data-bc-board]')
  if (board === null) return
  const slug = board.dataset.bcBoard ?? ctx.state.project
  /* The dock lives in the shell's top bar (the project's tools), not in the board; the page's own head row is the older home. */
  const dock = document.querySelector('.bcgridtools') ?? document.querySelector('.bcworktools') ?? board.closest('.bchome') ?? root
  const stageEl = board.querySelector('.bcstage')
  const guides = board.querySelector('.bcguides')
  if (stageEl === null) return
  const stacked = () => globalThis.matchMedia?.(PHONE)?.matches === true
  /* A picture of the person's own is held in this browser: draw it once it is loaded. Built-in materials are drawn by the template. */
  if (grid.bgOf(slug)?.id === 'custom') {
    void backdrop.hydrate(board, slug).then((why) => {
      if (why !== '') board.setAttribute('data-bg-why', why)
    })
  }

  /* The view: zoom, and where the world origin sits on screen. Painted live, stored late. */
  let view = grid.viewOf(slug)
  let zoomLive = view.zoom
  let zoomTimer = null

  /* ------------------------------------------------------------- painting */

  const css = (el, r) => {
    el.style.left = `${String(r.x)}px`
    el.style.top = `${String(r.y)}px`
    el.style.width = `${String(r.w)}px`
    el.style.height = `${String(r.h)}px`
    if (r.z !== undefined) el.style.zIndex = String(r.z)
  }

  const modEl = (id) => stageEl.querySelector(`[data-mod="${id}"]`)
  const noteEl = (id) => stageEl.querySelector(`[data-bc-note-id="${id}"]`)

  const paintAll = () => {
    for (const m of grid.layout(slug)) {
      const el = modEl(m.id)
      if (el === null) continue
      css(el, m)
      const hue = grid.hueFor(m.id, m.tint)
      if (hue === '') {
        el.style.removeProperty('--bc-tint')
        el.classList.remove('bcmod--tinted')
      } else {
        el.style.setProperty('--bc-tint', hue)
        el.classList.add('bcmod--tinted')
      }
    }
    for (const n of grid.postits(slug)) {
      const el = noteEl(n.id)
      if (el !== null) css(el, n)
    }
    const quiet = dock.querySelector('[data-bc-viewreset]')
    if (quiet !== null) {
      if (grid.customised(slug)) quiet.removeAttribute('data-quiet')
      else quiet.setAttribute('data-quiet', '1')
    }
  }

  /*
    THE DOT GRID, DRAWN RATHER THAN TILED. A tiled radial gradient at a fractional step (24px at 64% is 15.36px) lands
    its dots on fractions of a pixel, so some are crisp and some are smears and the pattern looks broken as you zoom. Here
    every dot is placed in world units, snapped to a device pixel, and the density steps by powers of two so the spacing
    never drops below a readable distance. Every fourth dot each way is a little stronger, which gives the eye a ruler.
    The colour is whatever --bc-dot resolves to on the board, so a material and a scheme change it without code here.
  */
  const gridCv = board.querySelector('.bcgridcv')
  let gridQueued = false
  const drawGrid = () => {
    gridQueued = false
    if (gridCv === null || !board.isConnected || stacked()) return
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1)
    const w = board.clientWidth
    const h = board.clientHeight
    if (w < 2 || h < 2) return
    if (gridCv.width !== Math.round(w * dpr) || gridCv.height !== Math.round(h * dpr)) {
      gridCv.width = Math.round(w * dpr)
      gridCv.height = Math.round(h * dpr)
    }
    const c = gridCv.getContext('2d')
    if (c === null) return
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    const ink = globalThis.getComputedStyle(gridCv).color
    const z = view.zoom
    let mult = 1
    while (24 * mult * z < 18) mult *= 2
    const step = 24 * mult * z
    const ix0 = Math.floor(-view.x / step) - 1
    const iy0 = Math.floor(-view.y / step) - 1
    const cols = Math.ceil(w / step) + 3
    const rows = Math.ceil(h / step) + 3
    const snap = (v) => Math.round(v * dpr) / dpr
    /*
      A dot is drawn twice: first a slightly larger one in the opposite lightness, then the dot itself. Whatever the material
      (a dark slate, a pale stone, a photograph), one of the two always differs from what is under it, so the grid is always
      visible (Grant, 10 October). The halo's lightness comes from the dot's own colour.
    */
    const nums = (ink.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = ink.startsWith('color(') ? ((nums[0] ?? 0) + (nums[1] ?? 0) + (nums[2] ?? 0)) / 3 : ((nums[0] ?? 0) + (nums[1] ?? 0) + (nums[2] ?? 0)) / 765
    const haloInk = lum > 0.5 ? 'rgb(0 0 0)' : 'rgb(255 255 255)'
    const r = Math.max(0.9, Math.min(1.5, 0.8 + 0.5 * z))
    /* The project's grid-dot opacity setting, as a multiple of the original strength (Project settings, Appearance). */
    const rawGain = Number.parseFloat(globalThis.getComputedStyle(gridCv).getPropertyValue('--bc-dot-op'))
    const gain = Number.isFinite(rawGain) ? Math.max(0, rawGain) : 1
    for (const halo of [true, false]) for (const major of [false, true]) {
      c.fillStyle = halo ? haloInk : ink
      c.globalAlpha = Math.min(1, gain * (halo ? (major ? 0.32 : 0.22) : major ? 1 : 0.8))
      if (gain === 0) continue
      c.beginPath()
      for (let j = 0; j < rows; j++) {
        const iy = iy0 + j
        /* Half a step in: a dot never straddles the board's own edge at the origin, where it would be cut in two. */
        const y = snap(view.y + (iy + 0.5) * step)
        for (let i = 0; i < cols; i++) {
          const ix = ix0 + i
          if ((ix % 4 === 0 && iy % 4 === 0) !== major) continue
          const x = snap(view.x + (ix + 0.5) * step)
          const rr = (major ? r * 1.35 : r) + (halo ? 0.9 : 0)
          c.moveTo(x + rr, y)
          c.arc(x, y, rr, 0, Math.PI * 2)
        }
      }
      c.fill()
    }
    c.globalAlpha = 1
  }
  const queueGrid = () => {
    if (gridQueued) return
    gridQueued = true
    globalThis.requestAnimationFrame(drawGrid)
  }
  if (gridCv !== null && typeof MutationObserver === 'function') {
    /* A new material or a scheme change moves the dot colour; the board and the root are the two places that say so. */
    const watch = new MutationObserver(() => {
      if (!board.isConnected) return watch.disconnect()
      queueGrid()
    })
    /* `class` too: the board adds bcpanes--moving while a module is dragged, and the arrangement grid is drawn for that state. */
    watch.observe(board, { attributes: true, attributeFilter: ['data-bg', 'data-bg-tone', 'style', 'class'] })
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-scheme', 'data-palette'] })
  }

  /* One place writes the transform and the grid, so a pan, a zoom and a drag cannot disagree. */
  const paintView = () => {
    queueGrid()
    zoomLive = view.zoom
    grid.holdView(slug, view)
    stageEl.style.transform = `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.zoom)})`
    stageEl.style.setProperty('--bc-zoom', String(view.zoom))
    board.style.setProperty('--bc-gx', `${String(view.x)}px`)
    board.style.setProperty('--bc-gy', `${String(view.y)}px`)
    board.style.setProperty('--bc-gz', String(view.zoom))
    board.style.setProperty('--bc-gstep', `${String(grid.gridStep(view.zoom))}px`)
    const val = dock.querySelector('.bczoomval')
    if (val !== null) val.textContent = `${String(Math.round(view.zoom * 100))}%`
  }
  const commitView = () => {
    if (zoomTimer !== null) globalThis.clearTimeout(zoomTimer)
    zoomTimer = globalThis.setTimeout(() => {
      grid.setView(slug, view)
      paintAll()
    }, 250)
  }
  const setView = (v) => {
    view = v
    paintView()
    commitView()
  }
  const boardPoint = (e) => {
    const r = board.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /** Let a rearrangement ease into place rather than jump. */
  const glide = () => {
    if (calm()) return
    stageEl.classList.add('bcstage--glide')
    globalThis.setTimeout(() => {
      stageEl.classList.remove('bcstage--glide')
    }, 380)
  }

  /*
    FIT: measure the real room, tell the engine, repaint. Runs synchronously
    after the markup is in, so the first paint is already the measured one.
  */
  const fit = () => {
    if (stacked()) {
      board.classList.add('bcpanes--stack')
      board.style.height = ''
      stageEl.style.width = ''
      stageEl.style.height = ''
      stageEl.style.transform = ''
      return
    }
    board.classList.remove('bcpanes--stack')
    const top = board.getBoundingClientRect().top + (globalThis.scrollY ?? 0)
    const boxW = board.clientWidth
    const boxH = Math.max(420, Math.round((globalThis.innerHeight ?? 900) - top - RESERVE))
    /* The stage the engine lays defaults out on is the unzoomed window: a default must not move because somebody zoomed. */
    grid.setStage(boxW, boxH, true)
    const st = grid.stageSize()
    board.style.height = `${String(boxH)}px`
    stageEl.style.width = `${String(st.w)}px`
    stageEl.style.height = `${String(st.h)}px`
    paintView()
    paintAll()
  }

  /* --------------------------------------------------------------- gesture */

  /** One pointer gesture at a time. Held on the closure: a drag that starts on one header ends over another. */
  let live = null

  const drawGuides = (list) => {
    if (guides === null) return
    const st = grid.stageSize()
    guides.innerHTML = list
      .map((g) =>
        g.axis === 'x'
          ? `<i class="bcguide bcguide--x" style="left:${String(Math.round(g.at))}px;height:${String(st.h)}px"></i>`
          : `<i class="bcguide bcguide--y" style="top:${String(Math.round(g.at))}px;width:${String(st.w)}px"></i>`,
      )
      .join('')
  }

  const others = (id) => [
    ...grid.layout(slug).filter((m) => m.id !== id),
    ...grid.postits(slug).filter((n) => n.id !== id),
  ]

  const begin = (kind, handle, e, target) => {
    const el = target ?? handle.closest('[data-mod]')
    if (el === null) return
    const isNote = el.hasAttribute('data-bc-note-id')
    const id = isNote ? el.dataset.bcNoteId : el.dataset.mod
    const start = (isNote ? grid.postits(slug) : grid.layout(slug)).find((m) => m.id === id)
    if (start === undefined) return
    live = {
      kind,
      id,
      el,
      isNote,
      startX: e.clientX,
      startY: e.clientY,
      rect: start,
      moved: false,
      handle,
      next: start,
    }
    handle.setPointerCapture?.(e.pointerId)
    /* A drag must never select the text it passes over. */
    document.documentElement.classList.add('bc-dragging')
  }

  const during = (e) => {
    if (live === null) return
    const z = zoomLive
    const dx = (e.clientX - live.startX) / z
    const dy = (e.clientY - live.startY) / z
    if (!live.moved && Math.hypot(dx * z, dy * z) < 4) return
    if (!live.moved) {
      live.moved = true
      board.classList.add('bcpanes--moving')
      live.el.classList.add('bcmod--dragging')
    }
    const st = grid.stageSize()
    const want =
      live.kind === 'move'
        ? { ...live.rect, x: live.rect.x + dx, y: live.rect.y + dy }
        : { ...live.rect, w: live.rect.w + dx, h: live.rect.h + dy }
    /*
      ALT SWITCHES THE GUIDES OFF, for the moment somebody wants exactly where
      their hand put it. Without Alt they are gentle: six visible pixels, and
      only while something is within reach.
    */
    const snapped = e.altKey
      ? { rect: want, guides: [] }
      : grid.align(want, others(live.id), st, live.kind, 6 / z)
    const rect = grid.clampRect({ ...snapped.rect, id: live.id })
    live.next = rect
    css(live.el, rect)
    drawGuides(snapped.guides)
    e.preventDefault()
  }

  const finish = (e) => {
    if (live === null) return
    const was = live
    live = null
    board.classList.remove('bcpanes--moving')
    was.el.classList.remove('bcmod--dragging')
    document.documentElement.classList.remove('bc-dragging')
    drawGuides([])
    if (!was.moved) return
    if (was.isNote) {
      const id = grid.movePostit(slug, was.id, was.next)
      if (id !== was.id) was.el.dataset.bcNoteId = id
    } else {
      grid.place(slug, was.id, was.next)
    }
    paintAll()
    cal.recheck()
    /*
      SUPPRESS THE CLICK THAT FOLLOWS A DRAG. A pointerup after a real gesture
      is still followed by a click on the header, which would open the module
      the person has just finished moving.
    */
    const swallow = (c) => {
      c.stopPropagation()
      c.preventDefault()
    }
    was.el.addEventListener('click', swallow, { capture: true, once: true })
    globalThis.setTimeout(() => {
      was.el.removeEventListener('click', swallow, { capture: true })
    }, SWALLOW_MS)
    e?.preventDefault?.()
  }

  const bind = (handle) => {
    handle.addEventListener('pointermove', during)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }

  /* A press anywhere on a module brings it to the front. */
  const front = (el, isNote) => {
    const id = isNote ? el.dataset.bcNoteId : el.dataset.mod
    const all = [...grid.layout(slug), ...grid.postits(slug)]
    const top = Math.max(...all.map((m) => m.z ?? 0))
    const mine = all.find((m) => m.id === id)
    if (mine === undefined || mine.z === top || id === 'n_starter') return
    if (isNote) grid.movePostit(slug, id, {})
    else grid.raise(slug, id)
    paintAll()
  }

  for (const m of stageEl.querySelectorAll('[data-mod]')) {
    m.addEventListener('pointerdown', () => {
      front(m, false)
    })
  }

  for (const h of stageEl.querySelectorAll('.bcmodhead')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || stacked()) return
      /*
        A CONTROL INSIDE THE HEADER IS NOT THE HEADER. Grant, 22 September:
        "Do not allow interactive controls within the header, such as
        three-dot menus, to accidentally trigger expansion."
        The title's own button IS the header's target (its keyboard stop), so a
        press on the title still drags; every other control does not.
      */
      if (e.target.closest('button:not(.bcmodopen), a, input, select, [data-bc-modoff]') !== null)
        return
      begin('move', h, e)
    })
    bind(h)
  }
  for (const r of stageEl.querySelectorAll('[data-bc-resize]')) {
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      begin('size', r, e, r.closest('[data-mod]'))
    })
    bind(r)
    r.addEventListener('click', (e) => {
      e.stopPropagation()
    })
  }

  /* ----------------------------------------------------------------- keys */

  /*
    THE KEYBOARD CAN MOVE AND RESIZE TOO, because a workspace only a mouse can
    arrange is a workspace half the people cannot arrange. Alt with an arrow
    moves; Alt and Shift resizes. Twelve logical pixels a press, ninety with
    Ctrl held for a long way.
  */
  for (const h of stageEl.querySelectorAll('.bcmodhead')) {
    h.addEventListener('keydown', (e) => {
      const id = h.closest('[data-mod]')?.dataset.mod
      if (id === undefined) return
      if ((e.key === 'Enter' || e.key === ' ') && !e.altKey) {
        e.preventDefault()
        ctx.openExpanded?.(id)
        return
      }
      if (!e.altKey) return
      const unit = e.ctrlKey ? 90 : 12
      const step = {
        ArrowLeft: [-unit, 0],
        ArrowRight: [unit, 0],
        ArrowUp: [0, -unit],
        ArrowDown: [0, unit],
      }[e.key]
      if (step === undefined) return
      e.preventDefault()
      const now = grid.layout(slug).find((m) => m.id === id)
      if (now === undefined) return
      const want = e.shiftKey
        ? { w: now.w + step[0], h: now.h + step[1] }
        : { x: now.x + step[0], y: now.y + step[1] }
      grid.place(slug, id, want)
      paintAll()
      const rz = stageEl.querySelector(`[data-mod="${id}"] [data-bc-resize]`)
      rz?.setAttribute('aria-valuenow', String(grid.layout(slug).find((m) => m.id === id)?.w ?? 0))
    })
  }

  /* Putting one back, from the chips that appear when something is off the page. */
  for (const b of dock.querySelectorAll('[data-bc-arr-on]')) {
    b.addEventListener('click', () => {
      grid.add(slug, b.dataset.bcArrOn)
      ctx.render()
    })
  }

  /* Taking a module off the page, from the cross on its header. */
  for (const b of stageEl.querySelectorAll('[data-bc-modoff]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      grid.remove(slug, b.dataset.bcModoff)
      ctx.render()
    })
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }
  /* Maximise is the module's expanded view, so there is one implementation of it. */
  for (const b of stageEl.querySelectorAll('[data-bc-max]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      ctx.openExpanded?.(b.dataset.bcMax)
    })
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }

  /* ----------------------------------------------------------------- zoom */

  const centre = () => ({ x: board.clientWidth / 2, y: board.clientHeight / 2 })
  const zoomTo = (factor, at = centre()) => {
    setView(grid.zoomAt(view, factor, at.x, at.y))
  }

  for (const b of dock.querySelectorAll('[data-bc-zoom]')) {
    b.addEventListener('click', () => {
      const how = b.dataset.bcZoom
      stageEl.classList.add('bcstage--zooming')
      globalThis.setTimeout(() => {
        stageEl.classList.remove('bcstage--zooming')
      }, 260)
      if (how === 'reset') zoomTo(1 / view.zoom)
      else zoomTo(how === 'in' ? 1 + grid.ZOOM.step * 1.5 : 1 / (1 + grid.ZOOM.step * 1.5))
    })
  }

  /* Bring every module and note into view. */
  dock.querySelector('[data-bc-fit]')?.addEventListener('click', () => {
    stageEl.classList.add('bcstage--zooming')
    globalThis.setTimeout(() => {
      stageEl.classList.remove('bcstage--zooming')
    }, 260)
    setView(grid.fitView([...grid.layout(slug), ...grid.postits(slug)], board.clientWidth, board.clientHeight))
  })

  /*
    THE WHEEL BELONGS TO THE CANVAS, EXCEPT OVER CONTENT THAT SCROLLS.
    Over empty canvas or a module that has nothing to scroll, a mouse wheel
    zooms about the pointer. A pinch (a wheel event with ctrlKey) always zooms.
    A trackpad's two-finger scroll (small deltas, or any horizontal delta) pans.
    Over a list, document or conversation that can scroll, the wheel scrolls it:
    nobody should lose their place in a conversation to a zoom.
  */
  const scrollsHere = (t) => {
    for (let n = t; n !== null && n !== board; n = n.parentElement) {
      if (!(n instanceof Element)) break
      const cs = globalThis.getComputedStyle(n)
      if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return true
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true
    }
    return false
  }
  board.addEventListener(
    'wheel',
    (e) => {
      if (stacked()) return
      const pinch = e.ctrlKey || e.metaKey
      if (!pinch && scrollsHere(e.target)) return
      e.preventDefault()
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 40
      const trackpadScroll = !pinch && !notch && e.deltaMode === 0
      if (trackpadScroll || (e.shiftKey && !pinch)) {
        setView(grid.panBy(view, -(e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX), e.shiftKey && e.deltaX === 0 ? 0 : -e.deltaY))
        return
      }
      const unit = e.deltaMode === 1 ? 33 : 1
      /*
        The wheel zooms in 12px of travel: every 12px moves the zoom by 2%, so a notch is a run of small, even steps
        rather than one lurch. A pinch keeps its own rate, because a trackpad pinch already arrives in small pieces.
      */
      const factor = pinch
        ? Math.exp(-e.deltaY * unit * (notch ? 0.0015 : 0.01))
        : Math.exp(-((e.deltaY * unit) / 12) * 0.02)
      zoomTo(factor, boardPoint(e))
    },
    { passive: false },
  )

  /*
    PANNING: drag the empty canvas, or press the middle button anywhere, or hold
    Space and drag. Two touches pinch-zoom and pan together. A module's own
    header still moves the module: only a press that lands on bare canvas pans.
  */
  const touches = new Map()
  let panning = null
  let pinch = null
  let spaceDown = false
  const bare = (t) =>
    t.closest('[data-mod], .bcpostit, .bcpop, button, a, input, textarea, select, label') === null
  const startPan = (e) => {
    panning = { id: e.pointerId, sx: e.clientX, sy: e.clientY, from: view }
    board.setPointerCapture?.(e.pointerId)
    board.classList.add('bcpanes--panning')
    /* No text selection while the canvas is dragged: moving the pointer over the top bar used to highlight it. */
    document.documentElement.classList.add('bc-dragging')
    globalThis.getSelection?.()?.removeAllRanges()
  }
  board.addEventListener('pointerdown', (e) => {
    if (stacked()) return
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) {
        const [a, b] = [...touches.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        panning = null
        e.preventDefault()
        return
      }
    }
    const wanted = e.button === 1 || (e.button === 0 && (bare(e.target) || spaceDown))
    if (!wanted || panning !== null) return
    e.preventDefault()
    startPan(e)
  })
  board.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch !== null && touches.size >= 2) {
      const [a, b] = [...touches.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const r = board.getBoundingClientRect()
      let v = grid.zoomAt(view, d / pinch.d, m.x - r.left, m.y - r.top)
      v = grid.panBy(v, m.x - pinch.mx, m.y - pinch.my)
      pinch = { d, mx: m.x, my: m.y }
      setView(v)
      e.preventDefault()
      return
    }
    if (panning === null || e.pointerId !== panning.id) return
    view = { ...panning.from, x: panning.from.x + (e.clientX - panning.sx), y: panning.from.y + (e.clientY - panning.sy) }
    paintView()
  })
  const endPointer = (e) => {
    touches.delete(e.pointerId)
    if (touches.size < 2) pinch = null
    if (panning !== null && e.pointerId === panning.id) {
      panning = null
      board.classList.remove('bcpanes--panning')
      document.documentElement.classList.remove('bc-dragging')
      commitView()
    }
  }
  board.addEventListener('pointerup', endPointer)
  board.addEventListener('pointercancel', endPointer)
  const spaceKey = (e) => {
    if (e.code !== 'Space') return
    const t = e.target
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable], button, a')) return
    spaceDown = e.type === 'keydown'
    board.classList.toggle('bcpanes--grab', spaceDown)
  }
  document.addEventListener('keydown', spaceKey)
  document.addEventListener('keyup', spaceKey)

  /* -------------------------------------------------------------- the dock */

  const tidy = dock.querySelector('[data-bc-tidy]')
  tidy?.addEventListener('click', () => {
    glide()
    grid.autoArrange(slug)
    paintAll()
  })
  dock.querySelector('[data-bc-viewreset]')?.addEventListener('click', () => {
    grid.reset(slug)
    view = grid.viewOf(slug)
    /* A module that had been taken off comes back with the default, so the page needs drawing again. */
    if (grid.layout(slug).length !== stageEl.querySelectorAll('[data-mod]').length) {
      ctx.render()
      return
    }
    glide()
    fit()
  })

  /* ------------------------------------------------------------ popovers */

  let pop = null
  const shut = () => {
    if (pop !== null) pop.remove()
    pop = null
    dock.querySelector('[data-bc-layouts]')?.setAttribute('aria-expanded', 'false')
  }
  const outside = (e) => {
    if (pop !== null && !pop.contains(e.target) && e.target.closest('[data-bc-layouts], [data-bc-tint]') === null) shut()
  }
  document.addEventListener('pointerdown', outside, true)
  const onKey = (e) => {
    if (e.key === 'Escape' && pop !== null) {
      shut()
    }
  }
  document.addEventListener('keydown', onKey)
  /*
    These two listeners are on the document, which a redraw does not replace, so
    each draw would add another pair. They remove themselves the first time they
    run after the board they belong to has left the page.
  */
  const gone = () => {
    if (board.isConnected) return
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keydown', spaceKey)
    document.removeEventListener('keyup', spaceKey)
    document.removeEventListener('pointerdown', gone, true)
    shut()
  }
  document.addEventListener('pointerdown', gone, true)

  const popAt = (anchor, html, cls) => {
    shut()
    pop = document.createElement('div')
    pop.className = `bcpop ${cls}`
    pop.innerHTML = html
    /* Fixed and on the body: the board clips its contents (it is a viewport onto an infinite canvas), and the anchor may be above it. */
    pop.style.position = 'fixed'
    document.body.append(pop)
    const a = anchor.getBoundingClientRect()
    const w = pop.offsetWidth
    const h = pop.offsetHeight
    const vw = globalThis.innerWidth ?? 1200
    const vh = globalThis.innerHeight ?? 800
    const left = Math.max(6, Math.min(vw - w - 6, a.right - w))
    const below = a.bottom + 6
    const top = below + h > vh - 6 ? Math.max(6, a.top - h - 6) : below
    pop.style.left = `${String(Math.round(left))}px`
    pop.style.top = `${String(Math.round(top))}px`
    return pop
  }

  /* ---- the colour of a module */
  for (const b of stageEl.querySelectorAll('[data-bc-tint]')) {
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const id = b.dataset.bcTint
      const now = grid.layout(slug).find((m) => m.id === id)?.tint ?? null
      const sw = (t, label, hue) =>
        `<button type="button" class="bcswatch${t === now ? ' is-on' : ''}" data-tint="${esc(t ?? '')}"
          aria-label="${esc(label)}" aria-pressed="${t === now ? 'true' : 'false'}" title="${esc(label)}"
          style="--sw:${hue === '' ? 'transparent' : hue}"></button>`
      const custom = typeof now === 'string' && now.startsWith('#') ? now : '#8aa0b8'
      const p = popAt(
        b,
        `<div class="bcswatches" role="group" aria-label="Colour of ${esc(NAMES[id] ?? id)}">
          ${sw(null, 'No colour', '')}
          ${grid.TINTS.map((t) => sw(t.id, t.name, t.hue)).join('')}
          <label class="bcswatch bcswatch--custom" title="Choose any colour">
            <input type="color" value="${esc(custom)}" aria-label="Custom colour">
          </label>
        </div>`,
        'bcpop--tint',
      )
      const apply = (t) => {
        grid.setTint(slug, id, t)
        paintAll()
        for (const s of p.querySelectorAll('.bcswatch[data-tint]')) {
          const on = (s.dataset.tint || null) === t
          s.classList.toggle('is-on', on)
          s.setAttribute('aria-pressed', on ? 'true' : 'false')
        }
      }
      for (const s of p.querySelectorAll('.bcswatch[data-tint]')) {
        s.addEventListener('click', () => {
          apply(s.dataset.tint === '' ? null : s.dataset.tint)
        })
      }
      p.querySelector('input[type=color]')?.addEventListener('input', (ev) => {
        apply(ev.target.value)
      })
    })
  }

  /* ---- layouts, presets and the modules that are off the page */
  const layoutsBody = (renaming = '') => {
    const names = grid.layoutNames(slug)
    const off = grid.off(slug)
    return `<p class="bcpoplabel">Presets</p>
      <div class="bcpopgrid">${Object.entries(grid.PRESETS)
        .map(
          ([k, v]) =>
            `<button type="button" class="bcpopbtn" data-preset="${esc(k)}">${esc(v.name)}</button>`,
        )
        .join('')}</div>
      ${
        grid.fitsWindow(slug)
          ? ''
          : `<button type="button" class="bcpopbtn bcpopfit" data-fit-window>Fit my arrangement to this window</button>
             <p class="bcpopnote">Keeps its shape and saves the arrangement as it was under Your layouts first.</p>`
      }
      <p class="bcpoplabel">Your layouts</p>
      ${
        names.length === 0
          ? '<p class="bcpopnone">None saved yet.</p>'
          : names
              .map((n) =>
                n === renaming
                  ? `<form class="bcpoprow" data-rename="${esc(n)}"><input class="bcpopinput" value="${esc(n)}" maxlength="40" aria-label="New name for ${esc(n)}"><button class="bcpopbtn" type="submit">Rename</button></form>`
                  : `<div class="bcpoprow">
                      <button type="button" class="bcpopbtn bcpopname" data-load="${esc(n)}">${esc(n)}</button>
                      <button type="button" class="bcpopmini" data-rn="${esc(n)}" aria-label="Rename ${esc(n)}" title="Rename">Rename</button>
                      <button type="button" class="bcpopmini" data-del="${esc(n)}" aria-label="Delete layout ${esc(n)}" title="Delete this layout">Delete</button>
                    </div>`,
              )
              .join('')
      }
      <form class="bcpoprow" data-save>
        <input class="bcpopinput" maxlength="40" placeholder="Name this layout" aria-label="Name for the current layout">
        <button type="submit" class="bcpopbtn">Save</button>
      </form>
      ${
        off.length === 0
          ? ''
          : `<p class="bcpoplabel">Not on this page</p>
             <div class="bcpopgrid">${off
               .map(
                 (id) =>
                   `<button type="button" class="bcpopbtn" data-addback="${esc(id)}" aria-label="Put ${esc(NAMES[id] ?? id)} back on this page">+ ${esc(NAMES[id] ?? id)}</button>`,
               )
               .join('')}</div>
             <p class="bcpopnote">Taking a module off only hides it. Nothing in it is deleted.</p>`
      }`
  }
  const openLayouts = (anchor, renaming = '') => {
    const p = popAt(anchor, layoutsBody(renaming), 'bcpop--layouts')
    anchor.setAttribute('aria-expanded', 'true')
    const again = (r = '') => {
      openLayouts(anchor, r)
    }
    for (const b of p.querySelectorAll('[data-preset]')) {
      b.addEventListener('click', () => {
        glide()
        grid.applyPreset(slug, b.dataset.preset)
        view = grid.viewOf(slug)
        shut()
        ctx.render()
      })
    }
    p.querySelector('[data-fit-window]')?.addEventListener('click', () => {
      glide()
      grid.fitToWindow(slug)
      view = grid.viewOf(slug)
      shut()
      ctx.render()
    })
    for (const b of p.querySelectorAll('[data-load]')) {
      b.addEventListener('click', () => {
        glide()
        grid.loadLayout(slug, b.dataset.load)
        view = grid.viewOf(slug)
        shut()
        ctx.render()
      })
    }
    for (const b of p.querySelectorAll('[data-rn]')) {
      b.addEventListener('click', () => {
        again(b.dataset.rn)
      })
    }
    for (const b of p.querySelectorAll('[data-del]')) {
      b.addEventListener('click', () => {
        grid.deleteLayout(slug, b.dataset.del)
        again()
      })
    }
    for (const b of p.querySelectorAll('[data-addback]')) {
      b.addEventListener('click', () => {
        grid.add(slug, b.dataset.addback)
        shut()
        ctx.render()
      })
    }
    p.querySelector('form[data-save]')?.addEventListener('submit', (ev) => {
      ev.preventDefault()
      const name = ev.target.querySelector('input').value
      if (grid.saveLayout(slug, name) !== '') again()
    })
    for (const f of p.querySelectorAll('form[data-rename]')) {
      f.querySelector('input')?.focus()
      f.addEventListener('submit', (ev) => {
        ev.preventDefault()
        grid.renameLayout(slug, f.dataset.rename, f.querySelector('input').value)
        again()
      })
    }
  }
  dock.querySelector('[data-bc-layouts]')?.addEventListener('click', (e) => {
    if (pop !== null && pop.classList.contains('bcpop--layouts')) {
      shut()
      return
    }
    openLayouts(e.currentTarget)
  })

  /* ---------------------------------------------------------------- notes */

  const offerUndo = (gone) => {
    stageEl.querySelector('.bcpostitundo')?.remove()
    const bar = document.createElement('div')
    bar.className = 'bcpostitundo'
    bar.setAttribute('role', 'status')
    bar.innerHTML = '<span>Note removed.</span> <button type="button" class="bcpostitundobtn">Undo</button>'
    stageEl.append(bar)
    const clear = globalThis.setTimeout(() => {
      bar.remove()
    }, 7000)
    bar.querySelector('button').addEventListener('click', () => {
      globalThis.clearTimeout(clear)
      grid.restorePostit(slug, gone)
      bar.remove()
      ctx.render()
    })
  }

  const wireNote = (el) => {
    const grip = el.querySelector('[data-bc-note-grip]')
    const text = el.querySelector('.bcpostittext')
    const rz = el.querySelector('[data-bc-note-resize]')
    el.addEventListener('pointerdown', () => {
      front(el, true)
    })
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || stacked() || e.target.closest('button') !== null) return
      begin('move', grip, e, el)
    })
    bind(grip)
    /*
      THE KEYBOARD MOVES AND RESIZES A NOTE TOO, the same keys as a module (Alt and an arrow; Alt Shift to resize), so a
      note is not the one object on the page only a mouse can place.
    */
    grip.addEventListener('keydown', (e) => {
      if (!e.altKey) return
      const unit = e.ctrlKey ? 90 : 12
      const step = {
        ArrowLeft: [-unit, 0],
        ArrowRight: [unit, 0],
        ArrowUp: [0, -unit],
        ArrowDown: [0, unit],
      }[e.key]
      if (step === undefined) return
      e.preventDefault()
      const id = el.dataset.bcNoteId
      const now = grid.postits(slug).find((n) => n.id === id)
      if (now === undefined) return
      const want = e.shiftKey
        ? { x: now.x, y: now.y, w: now.w + step[0], h: now.h + step[1] }
        : { x: now.x + step[0], y: now.y + step[1], w: now.w, h: now.h }
      const next = grid.movePostit(slug, id, want)
      if (next !== id) {
        el.dataset.bcNoteId = next
        el.querySelector('.bcpostittext').dataset.bcNoteText = next
      }
      const moved = grid.postits(slug).find((n) => n.id === next)
      if (moved === undefined) return
      el.style.left = `${String(moved.x)}px`
      el.style.top = `${String(moved.y)}px`
      el.style.width = `${String(moved.w)}px`
      el.style.height = `${String(moved.h)}px`
    })
    rz.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || stacked()) return
      e.stopPropagation()
      begin('size', rz, e, el)
    })
    bind(rz)
    /*
      AUTOSAVE WHILE TYPING, no button and no modal. The store writes the
      browser immediately and the office 700ms after the last keystroke. The
      starter note becomes a real stored note on its first character, and the
      element is re-keyed so the next keystroke addresses the real one.
    */
    text.addEventListener('input', () => {
      const id = grid.setPostit(slug, el.dataset.bcNoteId, { text: text.value })
      if (id !== el.dataset.bcNoteId) {
        el.dataset.bcNoteId = id
        text.dataset.bcNoteText = id
      }
    })
    el.querySelector('[data-bc-note-add]').addEventListener('click', (e) => {
      e.stopPropagation()
      makeNote({ near: el.dataset.bcNoteId })
    })
    el.querySelector('[data-bc-note-del]').addEventListener('click', () => {
      // Taken off the page at once, and given back for a few seconds: a note is somebody's writing, and one stray press
      // on a 20px control must not be the end of it.
      const gone = grid.postits(slug).find((n) => n.id === el.dataset.bcNoteId)
      grid.removePostit(slug, el.dataset.bcNoteId)
      if (gone !== undefined && gone.text.trim() !== '') offerUndo(gone)
      el.classList.add('bcpostit--leaving')
      globalThis.setTimeout(
        () => {
          el.remove()
        },
        calm() ? 0 : 160,
      )
    })
  }
  for (const el of stageEl.querySelectorAll('.bcpostit')) wireNote(el)

  /* A new note: from the plus on a note (beside it), or from the empty canvas's chip (middle of what is on screen). */
  const makeNote = (opts) => {
    const n = grid.addPostit(slug, opts)
    const tpl = document.createElement('template')
    tpl.innerHTML = note(n).trim()
    const el = tpl.content.firstElementChild
    el.classList.add('bcpostit--new')
    stageEl.insertBefore(el, guides)
    wireNote(el)
    stageEl.querySelector('.bcnoteempty')?.remove()
    el.querySelector('.bcpostittext').focus()
  }
  for (const nb of stageEl.querySelectorAll('[data-bc-newnote]')) {
    nb.addEventListener('click', () => {
      const w = grid.toWorld(view, board.clientWidth / 2, board.clientHeight / 2)
      makeNote({ at: { x: w.x - grid.POSTIT_DEFAULT.w / 2, y: w.y - grid.POSTIT_DEFAULT.h / 2 } })
    })
  }

  fit()
  /*
    The window changing size re-measures. Registered once per board and removed
    when the board leaves the page, for the reason the listeners above are.
  */
  const onResize = () => {
    if (!board.isConnected) {
      globalThis.removeEventListener('resize', onResize)
      globalThis.removeEventListener('bc-dock-resized', onResize)
      return
    }
    fit()
  }
  globalThis.addEventListener('resize', onResize)
  /* The chat dock opening, closing or being resized changes the board's width without a window resize. */
  globalThis.addEventListener('bc-dock-resized', onResize)
  if (typeof ResizeObserver === 'function') new ResizeObserver(onResize).observe(board)
}
