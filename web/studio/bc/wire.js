/*
  Wiring for the experimental Basecamp-inspired Team HQ.

  Separated from shell.js because the two answer different questions: shell.js
  says what the page looks like, this says what pressing it does. Keeping them
  apart is also what makes the "every control has an effect" rule checkable -
  a data attribute rendered over there with no handler here is a dead control,
  and both halves are short enough to read side by side.

  Every mutation goes through `attempt()` from office.js, which is already the
  pending / success / recoverable-failure contract §12 asks for: it disables
  the control, says what it is doing, says what happened and re-enables. A
  second mechanism would be a second set of words for one thing.
*/

import { act, attempt, canWrite, read } from '../office.js'
import * as pdf from '../pdf.js'
import { callIsLive, syncCallButtons, toggleCall } from '../call.js'
import * as compose from './compose.js'
import * as grid from './layout.js'
import * as contacts from './contacts.js'
import * as todos from './todos.js'
import * as jump from './jump.js'

let ctx = null
export const mount = (c) => {
  ctx = c
  /*
    ONE key listener for the whole experience, on the document, attached once.

    `render()` replaces everything inside #root on every paint, so a listener
    bound to a node in there dies at the first redraw - a control that works
    exactly once, which this repository has shipped three times in one file.
    The document survives every render, and the handler asks the experience
    flag rather than assuming.
  */
  document.addEventListener('keydown', (e) => {
    if (ctx.state.experience !== 'basecamp') return
    jump.onKey(e)
  })
}

/**
 * Wire one freshly-drawn shell.
 *
 * Called after every paint, on nodes that are new every time - so handlers are
 * attached per render rather than delegated. That matches how the default
 * studio works and keeps the two comparable.
 */
export const wire = (root) => {
  // Navigation inside the experience.
  for (const b of root.querySelectorAll('[data-bc-go]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      ctx.goAnywhere(b.dataset.bcGo)
    })
  }

  /*
    Leaving the experience for the current Team HQ.

    A full page load rather than a router hop, deliberately: the two
    experiences put different attributes on the document root and the default
    studio expects to boot into its own shell. It is also the honest signal -
    you are going somewhere else, and the address bar says so.
  */
  for (const b of root.querySelectorAll('[data-bc-leave]')) {
    b.addEventListener('click', (e) => {
      e.preventDefault()
      window.location.assign(b.dataset.bcLeave)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-jump]')) {
    b.addEventListener('click', () => {
      jump.show(b)
    })
  }

  /*
    CHAT WITH TEAM IS A TOGGLE, and it says which way it is set.

    `aria-pressed` is painted from the dock's own state rather than flipped on
    each press, so closing the dock by its own X leaves the button honest -
    which is the difference between a toggle and a button that counts its own
    presses.
  */
  for (const b of root.querySelectorAll('[data-bc-dock]')) {
    b.setAttribute('aria-pressed', ctx.dockIsOpen?.() === true ? 'true' : 'false')
    b.addEventListener('click', () => {
      const open = ctx.toggleDock?.() ?? ctx.openDock()
      b.setAttribute('aria-pressed', open === true ? 'true' : 'false')
    })
  }

  for (const b of root.querySelectorAll('[data-bc-attention]')) {
    b.addEventListener('click', () => {
      /*
        The attention queue is the team surface of whichever project has
        something waiting - §6.1 says this control must not become a permanent
        sidebar, and a control that opens the place the work actually is beats
        a panel that lists it a second time.
      */
      const p = ctx.projects().find((x) => (x.waiting ?? []).length > 0)
      ctx.goAnywhere(p === undefined ? '/basecamp/' : `/basecamp/p/${p.slug}/team`)
    })
  }

  wireTasks(root)
  wireOutputs(root)
  wireSearch(root)
  wireDocs(root)
  wireArrange(root)
  wireBoard(root)
  wireDocsWorkspace(root)
  wireVoice(root)
  wireContacts(root)
  wirePageMenu(root)
  wireExpanded(root)
}

/* ----------------------------------------------------------------- search */

const wireSearch = (root) => {
  const box = root.querySelector('#bc-search-q')
  if (box !== null) {
    /*
      Filters as you type (§7.1's "immediately"), and the caret is put back
      where it was: `render()` replaces every node, so a redraw on each
      keystroke would otherwise send the cursor to the start of the box after
      the first letter.
    */
    box.addEventListener('input', () => {
      const where = box.selectionStart
      ctx.state.bcQuery = box.value
      ctx.render()
      const again = document.querySelector('#bc-search-q')
      if (again !== null) {
        again.focus()
        if (where !== null) again.setSelectionRange(where, where)
      }
    })
  }
  for (const b of root.querySelectorAll('[data-bc-kind]')) {
    b.addEventListener('click', () => {
      ctx.state.bcKind = b.dataset.bcKind
      ctx.render()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-only]')) {
    b.addEventListener('click', () => {
      const v = b.dataset.bcOnly
      ctx.state.bcOnly = v === '' ? null : v
      ctx.render()
    })
  }
}

/* ---------------------------------------------------------------- outputs */

/**
 * Add to project (§9, §17 phase 5).
 *
 * One action, `output_import`, which is the path the current Team HQ already
 * uses — not a second import. It is idempotent in the DATABASE, by a partial
 * unique index whose four migrations are recorded in CLAUDE.md, so the page's
 * job is not to enforce that but to stop offering a press that has already
 * happened, and to show the office's own words if it refuses.
 */
const wireOutputs = (root) => {
  for (const b of root.querySelectorAll('[data-bc-addtoproject]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcAddtoproject
      if (id === undefined || id === '') return
      const done = await attempt(
        b,
        'Adding…',
        /*
          The output and nothing else. The current Team HQ opens a sheet here
          and asks for a collection, tags, a task and a source — deliberately,
          because that is the only moment anybody chooses them. This
          experience does not yet have that sheet, so it imports with nothing
          chosen, which `import_output` accepts and which means "yes, and I
          have nothing to add". Offering the sheet is the next slice; offering
          a half-built sheet would be worse than offering none.
        */
        () => act('output_import', { p_output: id }),
        'Added to the project.',
      )
      if (done !== null) await ctx.refresh()
    })
  }
}

/* ------------------------------------------ the docs workspace (§21) ---- */

/*
  The view toggle, and adding a file.

  UPLOAD GOES THROUGH `document_upload`, which is the path the current Team HQ
  already uses (#126): the gateway takes base64, puts the bytes in the private
  bucket under `<project>/upload/<uuid>`, and records the document row. Nothing
  here invents a second way in.

  It refuses politely without a token rather than failing into nothing, and it
  says what it is doing while a large file encodes - a silent Add on a 4MB PDF
  reads as a control that did not work.
*/
const wireDocsWorkspace = (root) => {
  for (const b of root.querySelectorAll('[data-bc-docview]')) {
    b.addEventListener('click', () => {
      try {
        globalThis.localStorage?.setItem('bc.docsview', b.dataset.bcDocview ?? 'wall')
      } catch {
        /* A viewer who cannot store it still gets the default. */
      }
      ctx.render()
    })
  }

  const form = () => root.querySelector('[data-bc-uploadform]')
  for (const b of root.querySelectorAll('[data-bc-upload]')) {
    b.addEventListener('click', () => {
      const f = form()
      if (f === null) return
      f.hidden = false
      f.querySelector('input')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-uploadcancel]')) {
    b.addEventListener('click', () => {
      const f = form()
      if (f === null) return
      f.reset()
      f.hidden = true
      root.querySelector('[data-bc-upload]')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-uploadsave]')) {
    b.addEventListener('click', async () => {
      const f = form()
      if (f === null) return
      const input = f.querySelector('#bc-upload-file')
      const file = input?.files?.[0]
      if (file === undefined || file === null) {
        showFieldError(f, 'bc-upload-file', 'Choose a file first.')
        return
      }
      clearFieldError(f, 'bc-upload-file')
      if (!canWrite()) {
        showFieldError(f, 'bc-upload-file', 'This browser is read-only — sign in to add a file.')
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        async () => {
          const base64 = await asBase64(file)
          return act('document_upload', {
            p_project_id: ctx.projects().find((x) => x.slug === ctx.state.project)?.id,
            p_name: file.name,
            p_base64: base64,
          })
        },
        'Added to the project.',
      )
      if (done !== null) {
        f.reset()
        f.hidden = true
        await ctx.refresh()
      }
    })
  }
}

/*
  Base64 without loading the whole file into a string twice.

  `readAsDataURL` gives `data:<mime>;base64,<payload>` and the gateway wants
  the payload, so the prefix is cut at the first comma rather than by a regex
  over several megabytes of text.
*/
const asBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => {
      reject(new Error('that file could not be read'))
    }
    reader.onload = () => {
      const out = String(reader.result ?? '')
      const at = out.indexOf(',')
      resolve(at < 0 ? out : out.slice(at + 1))
    }
    reader.readAsDataURL(file)
  })

/* ---------------------------------- expanded views, as modals (v2) ------ */

/*
  Open, close, Escape, and the click on the backdrop. The focus goes into the
  dialog on open and back to what opened it on close, because a modal that
  leaves the keyboard behind the thing it covers is not a modal - the
  keyboard audit has a name for that and this repository has already paid for
  it once on the document viewer.
*/
const wireExpanded = (root) => {
  for (const b of root.querySelectorAll('[data-bc-expand]')) {
    b.addEventListener('click', () => {
      lastOpener = b.dataset.bcExpand ?? ''
      ctx.openExpanded?.(b.dataset.bcExpand)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-expclose]')) {
    b.addEventListener('click', () => {
      ctx.closeExpanded?.()
      /*
        Back to the control that opened it. `render()` has replaced every node,
        so the one to focus is found by what it opens rather than by a
        reference captured before the redraw - #197's lesson, which cost four
        attempts the first time.
      */
      document.querySelector(`[data-bc-expand="${lastOpener}"]`)?.focus()
    })
  }
  const box = root.querySelector('.bcexpbox')
  if (box !== null) box.querySelector('button, a, input, select')?.focus()
}

let lastOpener = ''

/* ----------------------------- the page menu, and the voice button ------ */

/*
  THE MICROPHONE STARTS A CALL AND NOTHING ELSE.

  Grant: *"Clicking the microphone should immediately activate the OpenAI voice
  interface / pure voice mode... Do not introduce an unnecessary intermediate
  screen or another custom chat interface."* So it calls `toggleCall`, which is
  the studio's own path - the one the existing call panel drives - and draws
  nothing of its own. Toggle rather than start, because a microphone that
  cannot stop the call it began is a control with no way out.
*/
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (document.querySelector('[data-bc-expanded]') === null) return
  ctx?.closeExpanded?.()
  document.querySelector(`[data-bc-expand="${lastOpener}"]`)?.focus()
})

/*
  The microphone beside Chat, and the state it has to show itself.

  `syncCallButtons()` paints every element carrying `data-call`, which this
  button deliberately does not: the default studio wires the FIRST such
  element to its own handler, so borrowing the attribute would have given the
  mic two handlers and made one press two toggles. The consequence was that
  pressing it changed the call and nothing on screen said so - a control the
  audit correctly read as dead. So it paints itself from the same source of
  truth the shared painter uses.
*/
const paintMic = (b) => {
  const live = callIsLive()
  b.classList.toggle('ringing', live)
  b.setAttribute('aria-pressed', live ? 'true' : 'false')
  b.setAttribute('aria-label', live ? 'End the call' : 'Talk to the team out loud')
  b.title = live ? 'End the call' : 'Start a voice call with the team'
}

const wireVoice = (root) => {
  for (const b of root.querySelectorAll('[data-bc-voice]')) {
    paintMic(b)
    b.addEventListener('click', () => {
      toggleCall()
      syncCallButtons()
      paintMic(b)
    })
  }
}

/* --------------------------------------------------------------- contacts */
/*
  v2: *"Clicking a contact should show useful information/details"* and *"the
  user should be able to add a new contact directly from the miniature"*. Both
  presses open the Contacts tool over the home rather than navigating away,
  which is what makes the miniature and the expanded view one tool.
*/
/*
  WRITING WITHOUT A TOKEN.

  `attempt()` refuses before it runs anything when there is no token - "Read
  only, no token in this browser" - which is right for a call that would reach
  the office and wrong for one that never leaves the browser. The tick already
  took this branch; the contact editor did not, so every save in the deployed
  preview did nothing at all and said nothing either, which is precisely the
  shape Grant reported about the checkboxes.

  A key beginning `p:` names a row with no record behind it, so the write is
  local by construction and the gate does not apply to it.
*/
const localKey = (key) => String(key ?? '').startsWith('p:')
const saidIn = (el, words) => {
  const say = el?.closest('form')?.querySelector('[data-bc-contact-said]')
  if (say !== null && say !== undefined) say.textContent = words
}

const wireContacts = (root) => {
  for (const b of root.querySelectorAll('[data-bc-contact]')) {
    b.addEventListener('click', () => {
      ctx.openContact(b.dataset.bcContact)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-add]')) {
    b.addEventListener('click', () => {
      ctx.openContactAdd()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-close]')) {
    b.addEventListener('click', () => {
      ctx.closeContact()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contactadd-go]')) {
    b.addEventListener('click', async () => {
      const val = (id) => String(root.querySelector(`#${id}`)?.value ?? '').trim()
      const name = val('bc-c-name')
      const say = root.querySelector('[data-bc-contact-said]')
      if (name === '') {
        if (say !== null) say.textContent = 'A name, at least.'
        root.querySelector('#bc-c-name')?.focus()
        return
      }
      /*
        VALIDATED BEFORE IT IS SENT, by the port's own rules rather than by a
        second copy of them here. An email that is refused by the office after
        a round trip is an error message about a form the person has already
        left.
      */
      const fields = { name, role: val('bc-c-role'), org: val('bc-c-org') }
      for (const key of ['email', 'phone']) {
        const v = contacts.check(key, val(`bc-c-${key}`))
        if (!v.ok) {
          if (say !== null) say.textContent = v.why
          root.querySelector(`#bc-c-${key}`)?.focus()
          return
        }
        fields[key] = v.value
      }
      if (canWrite() !== true) {
        await contacts.add(ctx.state.project, fields)
        saidIn(b, `${name} is on this project.`)
        ctx.closeContact()
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        () => contacts.add(ctx.state.project, fields),
        `${name} is on this project.`,
      )
      if (done !== null) {
        ctx.closeContact()
        await ctx.refresh()
      }
    })
  }

  /*
    CORRECTING ONE. Every field on the record is read, validated and sent as a
    PATCH - only what changed - so editing the notes sends the notes.
  */
  for (const b of root.querySelectorAll('[data-bc-contact-save]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.bcContactSave ?? ''
      const form = b.closest('[data-bc-contactedit]')
      if (form === null) return
      const say = form.querySelector('[data-bc-contact-said]')
      const patch = {}
      for (const el of form.querySelectorAll('[data-bc-ctfield]')) {
        const field = el.dataset.bcCtfield
        const v = contacts.check(field, el.value)
        if (!v.ok) {
          if (say !== null) say.textContent = v.why
          el.focus()
          return
        }
        patch[field] = v.value
      }
      if (String(patch.name ?? '').trim() === '') {
        if (say !== null) say.textContent = 'A contact needs a name.'
        return
      }
      if (localKey(key)) {
        await contacts.save(ctx.state.project, key, patch)
        saidIn(b, 'Saved.')
        ctx.render()
        return
      }
      const done = await attempt(b, 'Saving…', () => contacts.save(ctx.state.project, key, patch), 'Saved.')
      if (done !== null) {
        ctx.render()
        await ctx.refresh()
      }
    })
  }

  /*
    A FACE. Downscaled in the browser before it is sent - see contacts.shrink,
    and 0534's 400KB cap, which is that decision made a rule.
  */
  for (const f of root.querySelectorAll('[data-bc-contact-image]')) {
    f.addEventListener('change', async () => {
      const key = f.dataset.bcContactImage ?? ''
      const file = f.files?.[0]
      const say = f.closest('form')?.querySelector('[data-bc-contact-said]')
      if (file === undefined) return
      try {
        const image = await contacts.shrink(file)
        if (localKey(key)) {
          await contacts.save(ctx.state.project, key, { image })
          ctx.render()
          return
        }
        const done = await attempt(
          f,
          'Adding the image…',
          () => contacts.save(ctx.state.project, key, { image }),
          'Image added.',
        )
        if (done !== null) {
          ctx.render()
          await ctx.refresh()
        }
      } catch (e) {
        if (say !== null) say.textContent = e instanceof Error ? e.message : 'That image could not be read.'
      }
    })
  }
  for (const b of root.querySelectorAll('[data-bc-contact-image-off]')) {
    b.addEventListener('click', async () => {
      const key = b.dataset.bcContactImageOff ?? ''
      if (localKey(key)) {
        await contacts.save(ctx.state.project, key, { image: '' })
        ctx.render()
        return
      }
      const done = await attempt(
        b,
        'Removing…',
        () => contacts.save(ctx.state.project, key, { image: '' }),
        'Image removed.',
      )
      if (done !== null) {
        ctx.render()
        await ctx.refresh()
      }
    })
  }
}

/*
  The three-dot menu that replaced "Change this page".

  Closes on Escape and on a press outside, because a menu that can only be
  closed by pressing the thing that opened it is a menu people leave open.
*/
const wirePageMenu = (root) => {
  const panel = root.querySelector('[data-bc-pagemenu-panel]')
  const trigger = root.querySelector('[data-bc-pagemenu]')
  if (panel === null || trigger === null) return

  const shut = () => {
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    panel.hidden = !panel.hidden
    trigger.setAttribute('aria-expanded', String(!panel.hidden))
    if (!panel.hidden) panel.querySelector('button')?.focus()
  })
  panel.addEventListener('click', (e) => {
    e.stopPropagation()
  })
  document.addEventListener('click', shut)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      shut()
      trigger.focus()
    }
  })

  /*
    Where the material comes from, which used to be a module. It opens as an
    expanded view rather than a page, which is the specification's rule for
    every expanded thing now.
  */
  for (const b of root.querySelectorAll('[data-bc-sources]')) {
    b.addEventListener('click', () => {
      shut()
      ctx.openExpanded?.('sources')
    })
  }
}

/* ------------------------------------------- arranging the home (§14) --- */

/*
  THE BOARD IS DRAGGED AND RESIZED, not reordered by buttons.

  Grant, 22 September: *"Implement proper drag-and-drop module repositioning;
  dynamic module resizing; sensible minimum sizes; sensible maximum sizes;
  collision prevention; responsive rearrangement; persistence... Do not
  substitute crude up/down controls for genuine spatial rearrangement."*

  Three decisions here are worth stating because each of them is a trap this
  repository has already paid for:

  1. **The header is both the press and the drag handle.** A separate grip is
     what CLAUDE.md records as eighteen buttons that looked fine and did
     nothing - they sat inside the handle, a drag began, and the DOM the click
     was travelling towards no longer existed. Here a pointer that MOVES more
     than four pixels becomes a drag and the click is suppressed; a pointer
     that does not is an ordinary press and opens the module. One element,
     two meanings, decided by what the person actually did.

  2. **Pointer events, captured.** `setPointerCapture` keeps the gesture with
     the module even when the pointer leaves it, which is most of a drag; it
     also gives touch and pen the same path as the mouse for nothing.

  3. **The preview is the real grid.** Dragging writes the rectangle into the
     live layout and repaints the board's inline styles directly, without a
     render - so what is under the pointer is the actual arrangement, including
     the modules that have been pushed down, rather than a ghost that tells
     the truth only when it lands.
*/

/** Where the pointer is, in grid units, relative to a board element. */
const gridAt = (board, clientX, clientY) => {
  const box = board.getBoundingClientRect()
  const cols = grid.COLS
  const gap = Number.parseFloat(getComputedStyle(board).gap) || 0
  const colW = (box.width - gap * (cols - 1)) / cols
  const rowH = grid.ROW + gap
  return {
    col: Math.round((clientX - box.left) / (colW + gap)),
    row: Math.round((clientY - box.top) / rowH),
    colW,
    rowH,
  }
}

/** Paint one module's rectangle without a render. */
const paintRect = (board, list) => {
  for (const m of list) {
    const el = board.querySelector(`[data-mod="${m.id}"]`)
    if (el === null) continue
    el.style.gridColumn = `${String(m.x + 1)}/span ${String(m.w)}`
    el.style.gridRow = `${String(m.y + 1)}/span ${String(m.h)}`
  }
  board.style.setProperty(
    '--bc-rows',
    String(list.reduce((n, m) => Math.max(n, m.y + m.h), 0)),
  )
}

const wireBoard = (root) => {
  const board = root.querySelector('[data-bc-board]')
  if (board === null) return
  const slug = board.dataset.bcBoard ?? ctx.state.project

  /*
    ONE POINTER GESTURE AT A TIME, and the element it belongs to. Held on the
    closure rather than on the module, because a drag that starts on one
    header and ends over another is the ordinary case.
  */
  let live = null

  const begin = (kind, el, e) => {
    const mod = el.closest('[data-mod]')
    if (mod === null) return
    const id = mod.dataset.mod
    const start = grid.layout(slug).find((m) => m.id === id)
    if (start === undefined) return
    live = { kind, id, mod, startX: e.clientX, startY: e.clientY, rect: start, moved: false }
    el.setPointerCapture?.(e.pointerId)
  }

  const during = (e) => {
    if (live === null) return
    const dx = e.clientX - live.startX
    const dy = e.clientY - live.startY
    if (!live.moved && Math.hypot(dx, dy) < 4) return
    if (!live.moved) {
      live.moved = true
      board.classList.add('bcpanes--moving')
      live.mod.classList.add('bcmod--dragging')
    }
    const { colW, rowH } = gridAt(board, e.clientX, e.clientY)
    const dCol = Math.round(dx / (colW + (Number.parseFloat(getComputedStyle(board).gap) || 0)))
    const dRow = Math.round(dy / rowH)
    const want =
      live.kind === 'move'
        ? { x: live.rect.x + dCol, y: Math.max(0, live.rect.y + dRow) }
        : { w: live.rect.w + dCol, h: live.rect.h + dRow }
    paintRect(board, grid.place(slug, live.id, want))
    e.preventDefault()
  }

  const finish = (e) => {
    if (live === null) return
    const was = live
    live = null
    board.classList.remove('bcpanes--moving')
    was.mod.classList.remove('bcmod--dragging')
    if (!was.moved) return
    /*
      SUPPRESS THE CLICK THAT FOLLOWS A DRAG. A pointerup after a real gesture
      is still followed by a click on the header, which would open the module
      the person has just finished moving.
    */
    const swallow = (c) => {
      c.stopPropagation()
      c.preventDefault()
    }
    was.mod.addEventListener('click', swallow, { capture: true, once: true })
    globalThis.setTimeout(() => {
      was.mod.removeEventListener('click', swallow, { capture: true })
    }, 350)
    ctx.render()
    e?.preventDefault?.()
  }

  for (const h of board.querySelectorAll('.bcmodhead')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      /*
        A CONTROL INSIDE THE HEADER IS NOT THE HEADER. Grant asked for exactly
        this: "Do not allow interactive controls within the header, such as
        three-dot menus, to accidentally trigger expansion."
      */
      if (e.target.closest('button, a, input, select, [data-bc-modoff]') !== null) return
      begin('move', h, e)
    })
    h.addEventListener('pointermove', during)
    h.addEventListener('pointerup', finish)
    h.addEventListener('pointercancel', finish)
  }
  for (const r of board.querySelectorAll('[data-bc-resize]')) {
    r.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      begin('size', r, e)
    })
    r.addEventListener('pointermove', during)
    r.addEventListener('pointerup', finish)
    r.addEventListener('pointercancel', finish)
    r.addEventListener('click', (e) => {
      e.stopPropagation()
    })
  }

  /*
    THE KEYBOARD CAN MOVE AND RESIZE TOO, because a workspace only a mouse can
    arrange is a workspace half the people cannot arrange. Alt with an arrow
    moves; Alt and Shift resizes. Held on the header, which is already the
    focusable thing.
  */
  for (const h of board.querySelectorAll('.bcmodhead')) {
    h.addEventListener('keydown', (e) => {
      const id = h.closest('[data-mod]')?.dataset.mod
      if (id === undefined) return
      if ((e.key === 'Enter' || e.key === ' ') && !e.altKey) {
        e.preventDefault()
        ctx.openExpanded?.(id)
        return
      }
      if (!e.altKey) return
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
        e.key
      ]
      if (step === undefined) return
      e.preventDefault()
      const now = grid.layout(slug).find((m) => m.id === id)
      if (now === undefined) return
      const want = e.shiftKey
        ? { w: now.w + step[0], h: now.h + step[1] }
        : { x: now.x + step[0], y: Math.max(0, now.y + step[1]) }
      grid.place(slug, id, want)
      ctx.render()
      document.querySelector(`[data-mod="${id}"] .bcmodhead`)?.focus()
    })
  }

  /* Taking a module off the page, from the cross on its header. */
  for (const b of board.querySelectorAll('[data-bc-modoff]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      grid.remove(slug, b.dataset.bcModoff)
      ctx.render()
    })
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
    })
  }
}

/*
  The panel that puts a module back and resets the page. Everything it used to
  do with Up, Down and Remove is done on the board itself now.
*/
const wireArrange = (root) => {
  const panel = root.querySelector('[data-bc-arrange-panel]')
  const slug = ctx.state.project

  for (const b of root.querySelectorAll('[data-bc-arrange]')) {
    b.addEventListener('click', () => {
      if (panel === null) return
      panel.hidden = !panel.hidden
      b.setAttribute('aria-expanded', String(!panel.hidden))
      if (!panel.hidden) panel.querySelector('button')?.focus()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-close]')) {
    b.addEventListener('click', () => {
      if (panel !== null) panel.hidden = true
      root.querySelector('[data-bc-arrange]')?.focus()
    })
  }

  /*
    The panel is inside the thing being redrawn, so a press closes it unless it
    is reopened - and a control that undoes itself on every use reads as
    broken. #197's lesson in miniature: anything that must survive a redraw has
    to be put back after it.
  */
  const reopen = () => {
    const again = document.querySelector('[data-bc-arrange-panel]')
    if (again !== null) again.hidden = false
  }

  for (const b of root.querySelectorAll('[data-bc-arr-on]')) {
    b.addEventListener('click', () => {
      grid.add(slug, b.dataset.bcArrOn)
      ctx.render()
      reopen()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-reset]')) {
    b.addEventListener('click', () => {
      grid.reset(slug)
      ctx.render()
      reopen()
    })
  }
}

/* ------------------------------------------------------- docs and files */

/*
  §21 — THE REAL FIRST PAGE, AND A NEW TAB.

  Two jobs, both against machinery that already exists:

  PAINTING. `pdf.js` renders page one of a PDF to a canvas with a self-hosted
  pdf.mjs (#23). Its `paint()` is additive by contract - the drawn page is
  already on screen and the real one replaces it once it has decoded - so a
  file that 404s, will not parse, or has no worker leaves the drawing in place
  rather than a broken image. Nothing here needs a try/catch around that;
  `paint` swallows its own failure on purpose.

  OPENING. The storage bucket is private, so a document's URL is signed for ten
  minutes and minted per request (#96). That means the link CANNOT be an href
  written at render time: it would be stale before most people pressed it. The
  press fetches a fresh one and opens it, which is what the gateway's own
  comment says the page should do.

  A document the office wrote has no file at all. Its content is real text, so
  it opens as a blob in a new tab rather than being refused - the alternative
  is a thumbnail you cannot click, which is the dead control this repository
  keeps paying for.
*/
const wireDocs = (root) => {
  for (const host of root.querySelectorAll('[data-bc-thumb]')) {
    const ref = host.dataset.bcThumb ?? ''
    if (ref === '' || host.classList.contains('bcthumb--object')) continue
    void paintThumb(host, ref)
  }

  /*
    EVERY DOCUMENT PRESSES. What the press DOES depends on what exists behind
    it, and that decision is in `openDoc` rather than here, so the gallery and
    the list cannot disagree about what a given file does.
  */
  for (const b of root.querySelectorAll('[data-bc-doc-open]')) {
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      const fig = b.closest('[data-bc-doc]')
      void openDoc(
        b.dataset.bcDocOpen ?? '',
        b.dataset.bcDocTitle ?? fig?.dataset.bcDocTitle ?? 'document',
      )
    })
  }
  /*
    And the whole row or tile is still a target, for the person who presses the
    thumbnail rather than the words - as long as they did not press the button
    inside it, which has already handled it.
  */
  for (const fig of root.querySelectorAll('[data-bc-doc]')) {
    const ref = fig.dataset.bcDoc ?? ''
    if (ref === '') continue
    fig.addEventListener('click', (e) => {
      if (e.target.closest('[data-bc-doc-open]') !== null) return
      void openDoc(ref, fig.dataset.bcDocTitle ?? 'document')
    })
  }

  /* The detail view's own two actions. */
  for (const b of root.querySelectorAll('[data-bc-doc-tab]')) {
    b.addEventListener('click', () => {
      openInTab(b.dataset.bcDocTab ?? '')
    })
  }
  for (const b of root.querySelectorAll('[data-bc-doc-save]')) {
    b.addEventListener('click', () => {
      const href = b.dataset.bcDocSave ?? ''
      if (href === '') return
      /*
        A DOWNLOAD IS A LINK WITH A `download` ATTRIBUTE. Fetching the bytes
        and making a blob would work and would also pull the whole file
        through this tab's memory for no reason; the attribute asks the
        browser to save what it was going to stream anyway.
      */
      const a = document.createElement('a')
      a.href = href
      a.download = (b.dataset.bcDocTitle ?? 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim()
      a.style.display = 'none'
      document.body.append(a)
      a.click()
      a.remove()
    })
  }
}

/** Audio, by what the reference actually is rather than by the row's label. */
const isAudioRef = (ref) => /\.(wav|mp3|m4a|ogg|oga|aac|flac|opus|weba)(\?|$)/i.test(ref)

/** The file a reference points at, or null. Never throws. */
const fileFor = async (ref) => {
  if (!ref.startsWith('id:')) return { url: ref, mime: /\.pdf$/i.test(ref) ? 'application/pdf' : '' }
  try {
    const full = await read('document', ref.slice(3))
    if (full === null || full === undefined || full.error) return null
    return { url: full.url ?? '', mime: String(full.mime_type ?? ''), content: full.content ?? '', title: full.title ?? '' }
  } catch {
    return null
  }
}

const paintThumb = async (host, ref) => {
  const file = await fileFor(ref)
  if (file === null || file.url === '') return
  const isPdf = file.mime === 'application/pdf' || /\.pdf$/i.test(file.url)
  if (isPdf) {
    await pdf.paint(host, file.url, 220)
    return
  }
  if (file.mime.startsWith('image/')) {
    const img = document.createElement('img')
    img.className = 'realpage'
    img.alt = ''
    img.decoding = 'async'
    img.src = file.url
    img.addEventListener('load', () => {
      host.replaceChildren(img)
    })
  }
}

/*
  A REAL LINK, CLICKED, rather than `window.open`.

  `window.open(url, '_blank', 'noopener')` opened a tab whose location came
  back as ":" - the feature string makes Chromium treat the call differently
  and the navigation never happened, so the press produced an empty tab. An
  anchor with `target` and `rel` is what a link IS: it navigates, it is not
  caught by a popup blocker the way a scripted open can be, and `noopener`
  stays a real attribute rather than a string that has to be parsed.
*/
const openInTab = (href) => {
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
}

const openDoc = async (ref, title) => {
  /*
    FOUR ANSWERS, one of which used to be silence.

    A reference beginning `d:` names a document with no file and no record -
    there is nothing to fetch and nothing to open, and the honest answer is
    the details rather than nothing happening. That silence was most of
    Grant's *"some PDFs can be clicked while other assets cannot"*.
  */
  if (ref === '' || ref.startsWith('d:')) {
    ctx.openDocDetail?.(ref, title)
    return
  }
  if (isAudioRef(ref)) {
    /* A recording plays HERE, with the project still around it. */
    ctx.openDocDetail?.(ref, title)
    return
  }
  const file = await fileFor(ref)
  if (file === null) {
    ctx.openDocDetail?.(ref, title)
    return
  }
  if (file.url !== '') {
    if (isAudioRef(file.url) || String(file.mime ?? '').startsWith('audio/')) {
      ctx.openDocDetail?.(ref, title)
      return
    }
    openInTab(file.url)
    return
  }
  /*
    No file, but real words. A blob is the honest way to put them in a tab:
    it is the document's own content, not a rendering of it, and it needs no
    route this experience has not built.
  */
  const text = String(file.content ?? '')
  if (text === '') {
    ctx.openDocDetail?.(ref, title)
    return
  }
  const blob = new Blob([`${title}\n\n${text}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  openInTab(url)
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 60_000)
}

/* ------------------------------------------------------------------ tasks */

/*
  THE FORM IN THE SAME LIST, not the first one on the page.

  §6 gave the surface a form per list, because §10.2's "expands in place" is
  only true if the place is the list you pressed. `root.querySelector` would
  have opened the first list's form whichever list was pressed - the kind of
  defect that works perfectly with one list on screen and is wrong with two,
  which is exactly the shape a prototype with one list hides.
*/
/*
  AND THE HEAD'S Add a Task IS NOT INSIDE ANY LIST, so `closest` finds nothing
  for it. It names the list it means in its own attribute, which is the only
  thing that works for a control that sits above all of them - the fallback to
  "the first form on the page" is kept for the empty state, where there is
  exactly one.
*/
const form = (el, root) => {
  const inside = el.closest('[data-bc-tasklist]')?.querySelector('[data-bc-taskform]')
  if (inside !== null && inside !== undefined) return inside
  const named = el.dataset?.bcAddtask
  if (named !== undefined && named !== '') {
    const owner = root.querySelector(`[data-bc-tasklist="${named}"] [data-bc-taskform]`)
    if (owner !== null) return owner
  }
  return root.querySelector('[data-bc-taskform]')
}

const wireTasks = (root) => {
  for (const b of root.querySelectorAll('[data-bc-addtask]')) {
    b.addEventListener('click', () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      f.hidden = false
      // §10.2: inline Add expands in place and focuses the name field.
      f.querySelector('input')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-taskcancel]')) {
    b.addEventListener('click', () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      /*
        §10.2: Cancel restores the collapsed state and the previous focus
        WITHOUT creating a record. Clearing the fields matters as much as
        hiding them - a reopened form holding the abandoned text is a record
        half-created.
      */
      for (const i of f.querySelectorAll('input')) i.value = ''
      f.hidden = true
      b.closest('[data-bc-tasklist]')?.querySelector('[data-bc-addtask]')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-tasksave]')) {
    b.addEventListener('click', async () => {
      const f = form(b, root)
      if (f === null || f === undefined) return
      const key = String(f.dataset.bcTaskform ?? '')
      const titleField = `bc-task-title-${key}`
      const title = String(f.querySelector(`#${titleField}`)?.value ?? '').trim()
      if (title === '') {
        /*
          §11.3: validation appears by the field. The message is placed rather
          than thrown into a toast, and focus moves to what has to be fixed.
        */
        showFieldError(f, titleField, 'Say what needs doing.')
        return
      }
      clearFieldError(f, titleField)
      const due = String(f.querySelector(`#bc-task-due-${key}`)?.value ?? '').trim()
      const who = String(f.querySelector(`#bc-task-who-${key}`)?.value ?? '').trim()
      /*
        WITHOUT A TOKEN THE PROTOTYPE KEEPS IT. Same branch as the tick and the
        contact editor: `attempt` refuses before it runs anything when there is
        no office to write to, which is correct for a call that would leave
        the browser and useless for a person judging the preview. The row has
        no id, so nothing that writes to the office can ever be handed it.
      */
      if (canWrite() !== true) {
        todos.addLocal(ctx.state.project, { title, list: key, due, assignee: who })
        for (const i of f.querySelectorAll('input')) i.value = ''
        /*
          AND IT SAYS WHERE IT WENT. A local row that appears exactly as a real
          one would is the prototype quietly claiming to be the office, which
          is the one thing this repository has spent a certification campaign
          refusing to do. The form stays open with the sentence in it; nothing
          was sent anywhere.
        */
        ctx.render()
        return
      }
      const done = await attempt(
        b,
        'Adding…',
        async () => {
          const made = await act('task_add', {
            p_project: ctx.state.project,
            p_title: title,
            p_due_on: due === '' ? null : due,
            p_assignee: who === '' ? null : who,
            p_milestone: false,
          })
          /*
            TWO CALLS, because `hq_task_add` takes no parent and
            `hq_task_update` does. Only when the form belongs to a real list:
            `loose` is the group for work that is in none, and nothing there
            should be given a parent.

            If the second call fails the task EXISTS and is unlisted, which is
            visible on this very screen under "Not in a list" and is the
            recoverable direction. The alternative was not offering it.
          */
          const id = made?.id ?? made?.task_id ?? ''
          if (key !== 'loose' && key !== '' && id !== '') {
            await act('task_update', { p_task_id: id, p_parent: key })
          }
          return made
        },
        'Added.',
      )
      if (done !== null) {
        for (const i of f.querySelectorAll('input')) i.value = ''
        f.hidden = true
        await ctx.refresh()
      }
    })
  }

  /* ------------------------------------------------------- saying (§7) --- */

  /*
    ONE SEND PATH, the studio's own. `chatSend` puts the message on screen
    immediately and `chatAsk` asks the office; both come from `chat.js`, which
    already owns the optimistic tail, the retry row and the rule that the
    office's copy wins when it lands. Re-implementing either here would be the
    second copy that drifts.

    The draft is cleared on send, which #197 established, and the answer
    arrives through the same repaint the default Team HQ uses.
  */
  for (const b of root.querySelectorAll('[data-bc-say]')) {
    b.addEventListener('click', async () => {
      const f = root.querySelector('[data-bc-sayform]')
      if (f === null) return
      const box = f.querySelector('#bc-say')
      const text = String(box?.value ?? '').trim()
      if (text === '') {
        showFieldError(f, 'bc-say', 'Say something first.')
        return
      }
      clearFieldError(f, 'bc-say')
      if (!canWrite()) {
        showFieldError(f, 'bc-say', 'This browser is read-only — sign in to ask the team.')
        return
      }
      if (box !== null) box.value = ''
      ctx.chatSend?.(ctx.state.project, text)
      ctx.render()
      await ctx.chatAsk?.(ctx.state.project, text, () => {
        ctx.render()
      })
    })
  }

  /* ----------------------------------------------------- a list (§6) ----- */

  const listForm = () => root.querySelector('[data-bc-listform]')

  for (const b of root.querySelectorAll('[data-bc-addlist]')) {
    b.addEventListener('click', () => {
      const f = listForm()
      if (f === null) return
      f.hidden = false
      f.querySelector('#bc-list-name')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-listcancel]')) {
    b.addEventListener('click', () => {
      const f = listForm()
      if (f === null) return
      for (const i of f.querySelectorAll('input')) i.value = ''
      f.hidden = true
      root.querySelector('[data-bc-addlist]')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-listsave]')) {
    b.addEventListener('click', async () => {
      const f = listForm()
      if (f === null) return
      const name = String(f.querySelector('#bc-list-name')?.value ?? '').trim()
      if (name === '') {
        showFieldError(f, 'bc-list-name', 'Give the list a name.')
        return
      }
      clearFieldError(f, 'bc-list-name')
      /*
        A LIST IS A MILESTONE TASK. `p_milestone: true` is the whole of it -
        0171's own comment says a milestone is "a task with no work of its own
        that others hang off, rather than a separate table", and 0287 taught
        `hq_task_add` to create one. No new contract, no second table.
      */
      const done = await attempt(
        b,
        'Adding…',
        () =>
          act('task_add', {
            p_project: ctx.state.project,
            p_title: name,
            p_milestone: true,
          }),
        'List added.',
      )
      if (done !== null) {
        for (const i of f.querySelectorAll('input')) i.value = ''
        f.hidden = true
        await ctx.refresh()
      }
    })
  }

  /*
    §10: MOVING A CARD IS CHANGING THE TO-DO.

    One writer, `task_state`, which is the same one the tick uses - ADR-0041's
    "one set of writers". The select is put back to what the office still
    believes when the write fails, for the reason the tick is: a card that
    stays where you dropped it after a failed write is the product lying about
    canonical state.

    `blocked` is not in the options, because `hq_task_state` refuses it
    without a reason and an offer may only promise what the press can perform.
  */
  /*
    ONE MOVE, TWO GESTURES. `moveCard` is what both the select and the drag
    call, so a card cannot end up somewhere the record does not agree with.
    A row with an id writes to the office; one without is the prototype's own
    memory, exactly as the tick is.
  */
  const moveCard = async (key, wanted, cardEl, control) => {
    if (key === undefined || key === '') return false
    cardEl?.classList.add('bcitem--pending')
    if (key.startsWith('p:')) {
      todos.rememberStage(ctx.state.project, key, wanted)
      cardEl?.classList.remove('bcitem--pending')
      ctx.render()
      return true
    }
    const done = await attempt(
      control ?? cardEl,
      'Moving…',
      () => todos.setStage(key, wanted),
      'Moved.',
    )
    cardEl?.classList.remove('bcitem--pending')
    if (done === null) return false
    await ctx.refresh()
    return true
  }

  for (const sel of root.querySelectorAll('[data-bc-move]')) {
    const was = sel.value
    sel.addEventListener('change', async () => {
      const ok = await moveCard(sel.dataset.bcMove, sel.value, sel.closest('[data-bc-card]'), sel)
      if (!ok) sel.value = was
    })
  }

  /*
    DRAGGING A CARD BETWEEN COLUMNS.

    The native drag-and-drop API rather than the pointer gesture the module
    board uses, and the difference is deliberate: a module is moved to a
    POSITION, which needs continuous geometry, and a card is moved to a
    COLUMN, which is a drop target the browser can hit-test for nothing. It
    also gives the cursor, the drag image and the Escape-to-cancel behaviour
    people already know.

    The column under the pointer says so, because a drop target that looks
    identical to every other column is a gesture taken on faith.
  */
  for (const c of root.querySelectorAll('[data-bc-card]')) {
    c.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', c.dataset.bcCard ?? '')
      if (e.dataTransfer !== null && e.dataTransfer !== undefined) {
        e.dataTransfer.effectAllowed = 'move'
      }
      c.classList.add('bcbcard--dragging')
    })
    c.addEventListener('dragend', () => {
      c.classList.remove('bcbcard--dragging')
      for (const col of root.querySelectorAll('[data-bc-drop]')) {
        col.classList.remove('bcbcol--over')
      }
    })
  }
  for (const col of root.querySelectorAll('[data-bc-drop]')) {
    col.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (e.dataTransfer !== null && e.dataTransfer !== undefined) {
        e.dataTransfer.dropEffect = 'move'
      }
      col.classList.add('bcbcol--over')
    })
    col.addEventListener('dragleave', (e) => {
      /*
        `dragleave` fires when the pointer crosses into a CHILD as well, which
        made the column flicker and, worse, lose its highlight while the
        pointer was still inside it. Asking where the pointer actually is
        settles it.
      */
      if (col.contains(e.relatedTarget)) return
      col.classList.remove('bcbcol--over')
    })
    col.addEventListener('drop', async (e) => {
      e.preventDefault()
      col.classList.remove('bcbcol--over')
      const key = e.dataTransfer?.getData('text/plain') ?? ''
      const wanted = col.dataset.bcDrop ?? ''
      const cardEl = root.querySelector(`[data-bc-card="${key}"]`)
      /*
        A DROP INTO THE COLUMN IT CAME FROM IS NOT A MOVE. Writing it anyway
        would spend a round trip and, on a real record, put a state change in
        the ledger that nothing changed.
      */
      if (cardEl?.dataset.stage === wanted) return
      if (wanted === 'blocked') {
        /*
          `hq_task_state` refuses `blocked` without a reason, so dropping into
          Stuck opens the task where there is room to say what it is waiting
          on. An offer may only promise what the press can perform.
        */
        ctx.openTask(key)
        return
      }
      await moveCard(key, wanted, cardEl, null)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-task-open]')) {
    b.addEventListener('click', () => {
      ctx.openTask(b.dataset.bcTaskOpen)
    })
  }

  for (const b of root.querySelectorAll('[data-bc-tasksave-edit]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcTasksaveEdit
      const who = String(root.querySelector('#bc-edit-who')?.value ?? '').trim()
      const due = String(root.querySelector('#bc-edit-due')?.value ?? '').trim()
      /*
        `p_clear` is how the office is told to EMPTY a field, because null
        means "leave it alone" to `hq_task_update` — so clearing the assignee
        by sending null would silently do nothing and look like a failed save.
      */
      const clear = []
      if (who === '') clear.push('assignee')
      if (due === '') clear.push('due_on')
      const done = await attempt(
        b,
        'Saving…',
        () =>
          act('task_update', {
            p_task_id: id,
            p_assignee: who === '' ? null : who,
            p_due_on: due === '' ? null : due,
            p_clear: clear,
          }),
        'Saved.',
      )
      if (done !== null) await ctx.refresh()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-taskdone]')) {
    b.addEventListener('click', async () => {
      const done = await attempt(
        b,
        'Saving…',
        () => act('task_state', { p_task_id: b.dataset.bcTaskdone, p_state: b.dataset.bcWant }),
        b.dataset.bcWant === 'done' ? 'Done.' : 'Put back.',
      )
      if (done !== null) await ctx.refresh()
    })
  }

  /*
    THE TICK, and the one decision that makes it work everywhere.

    `data-bc-tick` carries the port's KEY, not the office's id — so a row with
    a record behind it writes to the office, and a row without one is
    remembered by the prototype. Which of the two it is, is decided by the key
    itself rather than by a flag, because the key IS the office's id whenever
    there is one.

    The optimistic contract is unchanged: mark the row pending, reconcile,
    and roll the box back VISIBLY if the write did not happen. A tick that
    survives a failed write is the product lying about canonical state.
  */
  for (const c of root.querySelectorAll('[data-bc-tick]')) {
    c.addEventListener('change', async () => {
      const key = c.dataset.bcTick ?? ''
      if (key === '') return
      const wanted = c.checked
      const rowEl = c.closest('.bcitem') ?? c.closest('.bctask')
      rowEl?.classList.add('bcitem--pending')
      if (key.startsWith('p:')) {
        todos.rememberDone(ctx.state.project, key, wanted)
        rowEl?.classList.remove('bcitem--pending')
        ctx.render()
        return
      }
      const done = await attempt(
        c,
        'Saving…',
        () => todos.setDone(key, wanted),
        wanted ? 'Done.' : 'Put back.',
      )
      rowEl?.classList.remove('bcitem--pending')
      if (done === null) {
        c.checked = !wanted
        return
      }
      await ctx.refresh()
    })
  }

  for (const c of root.querySelectorAll('[data-bc-mytick]')) {
    c.addEventListener('change', async () => {
      const id = c.dataset.bcMytick
      if (id === '') return
      const wanted = c.checked
      const rowEl = c.closest('.bcitem')
      rowEl?.classList.add('bcitem--pending')
      /*
        THE SAME WRITER as the project task above, and that is deliberate.

        The first draft of this called `my_task_state`, reasoning that two
        domains need two writers. There is no such action: the gateway would
        have refused it, so the tick on a personal task could never have
        worked - an offer promising what no press can perform, which is the
        defect this repository keeps paying for.

        ADR-0041 decided the opposite and says why: a personal task IS a row
        in `public.tasks` with `assigned_to_human = true`, so there is no
        second id space and no second set of writers. What stays distinct is
        OWNERSHIP and LIFECYCLE - whose list it is on, who may change it, and
        which surface it appears on - and §2.4 asks for exactly that, not for
        a duplicated write path. `task_state` already does both kinds.
      */
      const done = await attempt(
        c,
        'Saving…',
        () => act('task_state', { p_task_id: id, p_state: wanted ? 'done' : 'todo' }),
        wanted ? 'Done.' : 'Put back.',
      )
      rowEl?.classList.remove('bcitem--pending')
      if (done === null) {
        c.checked = !wanted
        return
      }
      await ctx.refresh()
    })
  }
}

const showFieldError = (f, id, message) => {
  const field = f.querySelector(`#${id}`)
  if (field === null) return
  field.setAttribute('aria-invalid', 'true')
  let err = f.querySelector(`#${id}-live-err`)
  if (err === null) {
    err = document.createElement('span')
    err.className = 'bcerror'
    err.id = `${id}-live-err`
    field.after(err)
    field.setAttribute('aria-describedby', `${id}-live-err`)
  }
  err.textContent = message
  field.focus()
}

const clearFieldError = (f, id) => {
  const field = f.querySelector(`#${id}`)
  field?.removeAttribute('aria-invalid')
  f.querySelector(`#${id}-live-err`)?.remove()
}

export const readOnly = () => !canWrite()
