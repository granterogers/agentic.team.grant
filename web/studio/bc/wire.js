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
