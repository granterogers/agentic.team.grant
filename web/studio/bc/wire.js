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
import * as compose from './compose.js'
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

  for (const b of root.querySelectorAll('[data-bc-dock]')) {
    b.addEventListener('click', () => {
      ctx.openDock()
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
  wireDocsWorkspace(root)
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

/* ------------------------------------------- arranging the home (§14) --- */

/*
  Every press here rewrites ONE list of module ids and repaints. There is no
  path from this panel to any record, which is §14's requirement met
  structurally rather than by being careful.
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

  const move = (id, by) => {
    const ids = compose.arrangement(slug)
    const at = ids.indexOf(id)
    const to = at + by
    if (at < 0 || to < 0 || to >= ids.length) return
    ids.splice(to, 0, ids.splice(at, 1)[0])
    compose.arrange(slug, ids)
    ctx.render()
    reopen()
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

  for (const b of root.querySelectorAll('[data-bc-arr-up]')) {
    b.addEventListener('click', () => {
      move(b.dataset.bcArrUp, -1)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-down]')) {
    b.addEventListener('click', () => {
      move(b.dataset.bcArrDown, 1)
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-off]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.bcArrOff
      compose.arrange(slug, compose.arrangement(slug).filter((x) => x !== id))
      ctx.render()
      reopen()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-on]')) {
    b.addEventListener('click', () => {
      compose.arrange(slug, [...compose.arrangement(slug), b.dataset.bcArrOn])
      ctx.render()
      reopen()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-arr-reset]')) {
    b.addEventListener('click', () => {
      compose.arrangeReset(slug)
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

  for (const fig of root.querySelectorAll('[data-bc-doc]')) {
    const ref = fig.dataset.bcDoc ?? ''
    if (ref === '') continue
    fig.classList.add('bcdoc--openable')
    fig.addEventListener('click', () => {
      void openDoc(ref, fig.dataset.bcDocTitle ?? 'document')
    })
  }
}

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
  const file = await fileFor(ref)
  if (file === null) return
  if (file.url !== '') {
    openInTab(file.url)
    return
  }
  /*
    No file, but real words. A blob is the honest way to put them in a tab:
    it is the document's own content, not a rendering of it, and it needs no
    route this experience has not built.
  */
  const text = String(file.content ?? '')
  if (text === '') return
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
const form = (el, root) =>
  el.closest('[data-bc-tasklist]')?.querySelector('[data-bc-taskform]') ??
  root.querySelector('[data-bc-taskform]')

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
  for (const sel of root.querySelectorAll('[data-bc-move]')) {
    const was = sel.value
    sel.addEventListener('change', async () => {
      const id = sel.dataset.bcMove
      if (id === undefined || id === '') return
      const wanted = sel.value
      const cardEl = sel.closest('[data-bc-card]')
      cardEl?.classList.add('bcitem--pending')
      const done = await attempt(
        sel,
        'Moving…',
        () => act('task_state', { p_task_id: id, p_state: wanted }),
        'Moved.',
      )
      cardEl?.classList.remove('bcitem--pending')
      if (done === null) {
        sel.value = was
        return
      }
      await ctx.refresh()
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

  for (const c of root.querySelectorAll('[data-bc-tick]')) {
    c.addEventListener('change', async () => {
      const id = c.dataset.bcTick
      if (id === '') return
      const wanted = c.checked
      /*
        §12 optimistic mutation: mark the row pending, reconcile with the
        server, roll back VISIBLY on failure. The checkbox is put back to what
        the server still believes rather than left showing a change that did
        not happen - a tick that survives a failed write is the product lying
        about canonical state.
      */
      const rowEl = c.closest('.bcitem')
      rowEl?.classList.add('bcitem--pending')
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
