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

import { act, attempt, canWrite } from '../office.js'
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
}

/* ------------------------------------------------------------------ tasks */

const form = (root) => root.querySelector('[data-bc-taskform]')

const wireTasks = (root) => {
  for (const b of root.querySelectorAll('[data-bc-addtask]')) {
    b.addEventListener('click', () => {
      const f = form(root)
      if (f === null) return
      f.hidden = false
      // §10.2: inline Add expands in place and focuses the name field.
      f.querySelector('#bc-task-title')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-taskcancel]')) {
    b.addEventListener('click', () => {
      const f = form(root)
      if (f === null) return
      /*
        §10.2: Cancel restores the collapsed state and the previous focus
        WITHOUT creating a record. Clearing the fields matters as much as
        hiding them - a reopened form holding the abandoned text is a record
        half-created.
      */
      for (const i of f.querySelectorAll('input')) i.value = ''
      f.hidden = true
      root.querySelector('[data-bc-addtask]')?.focus()
    })
  }

  for (const b of root.querySelectorAll('[data-bc-tasksave]')) {
    b.addEventListener('click', async () => {
      const f = form(root)
      if (f === null) return
      const title = String(f.querySelector('#bc-task-title')?.value ?? '').trim()
      if (title === '') {
        /*
          §11.3: validation appears by the field. The message is placed rather
          than thrown into a toast, and focus moves to what has to be fixed.
        */
        showFieldError(f, 'bc-task-title', 'Say what needs doing.')
        return
      }
      clearFieldError(f, 'bc-task-title')
      const due = String(f.querySelector('#bc-task-due')?.value ?? '').trim()
      const who = String(f.querySelector('#bc-task-who')?.value ?? '').trim()
      const done = await attempt(
        b,
        'Adding…',
        () =>
          act('task_add', {
            p_project: ctx.state.project,
            p_title: title,
            p_due_on: due === '' ? null : due,
            p_assignee: who === '' ? null : who,
            p_milestone: false,
          }),
        'Added.',
      )
      if (done !== null) {
        for (const i of f.querySelectorAll('input')) i.value = ''
        f.hidden = true
        await ctx.refresh()
      }
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
        A DIFFERENT RPC from the project task above, on purpose. §2.4: a
        person's own list and a project's commitments are distinct domains with
        distinct ownership, and sharing one writer is how two domains quietly
        become one.
      */
      const done = await attempt(
        c,
        'Saving…',
        () => act('my_task_state', { p_task_id: id, p_state: wanted ? 'done' : 'todo' }),
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
