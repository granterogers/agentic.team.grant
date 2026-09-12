/*
  Taking something back (#118).

  Every write in the studio landed immediately and the only route out of a
  mistake was to do the opposite by hand — rename it again, re-tick the task,
  re-pick the icon, re-attach the source. **People use a product more freely
  when they know they can get back**, and this is the largest change in
  confidence available for the least code.

  ## Nothing on this page decides what is undoable

  The strip appears because the server said so. Every write that has an exact
  inverse records it at the moment it still knows the previous value and answers
  with an `undo` id (migrations 0263-0265); this module shows a strip when one
  comes back and sends it to `hq_undo` when it is pressed. It has no list of
  undoable actions, no idea what any of them mean, and no way to be wrong about
  either.

  That is §5's rule for channel adapters applied to a page, and it is load
  bearing here rather than decorative: the inverse cannot be derived from what
  was requested, because by then the previous value is gone. Anything in this
  file that tried to work out what to undo would be working from the wrong
  information.

  ## One strip, replaced rather than stacked

  Three stacked strips is a notification centre, and a notification centre is
  something you learn to ignore. The most recent write is the one you might
  regret, so the next offer replaces the last.

  ## Outside `#root`

  Like the dock. The studio re-renders `#root` wholesale on every navigation and
  after every write, so a strip inside it would vanish the moment the page
  redrew — which is exactly the moment after a write, which is exactly when the
  strip exists. Moving between tabs while deciding whether to undo is a normal
  thing to do.
*/

import { act } from './office.js'

/** How long an offer stays on screen. The server's own window is longer, so a
 *  press right at the edge of this still lands rather than reporting `expired`
 *  for a button that was on screen when it was pressed. */
const SHOWN = 11_000

let timer = null
let current = null

const el = () => document.getElementById('undobar')

const hide = () => {
  const bar = el()
  if (bar === null) return
  bar.hidden = true
  bar.innerHTML = ''
  current = null
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/**
 * What to call this, from what the server sent back.
 *
 * The description is written by the RPC that performed the write, in its own
 * words — *"Renamed to Legacy Coaching Course"*, *"Detached the Drive folder"* —
 * because the RPC is the only thing that knows what actually changed. A page
 * that composed its own sentence here would drift from the truth the first time
 * an action did something slightly different from what the button said.
 */
const wording = (result) => {
  if (typeof result?.note === 'string' && result.note !== '') return result.note
  return 'Done'
}

/**
 * Offer to take back whatever just happened.
 *
 * Called for every write, from `act()`, so no button anywhere has to remember
 * this exists. A result with no `undo` field offers nothing and that is the
 * common case — most writes are not reversible and the honest answer is
 * silence, not a disabled button.
 */
export function offer(result, refresh) {
  const id = result?.undo
  if (typeof id !== 'string' || id === '') return
  const bar = el()
  if (bar === null) return

  current = id
  bar.hidden = false
  /*
    Plain words inside the HTML comments in this file and in `app.js`: a
    backtick inside an HTML comment inside a template literal ends the string
    and the file becomes unparseable, which renders nothing at all.
  */
  bar.innerHTML = `<span class="undoword">${wording(result)}</span>
    <button class="undogo" data-undo type="button">Undo</button>
    <button class="undoshut" data-undo-dismiss type="button" aria-label="Dismiss">&times;</button>`

  bar.querySelector('[data-undo-dismiss]')?.addEventListener('click', hide)
  bar.querySelector('[data-undo]')?.addEventListener('click', async (event) => {
    const press = event.currentTarget
    press.disabled = true
    press.textContent = 'Undoing…'
    try {
      /*
        `act` is used rather than a bare fetch, so an undo goes through the same
        door as every other write — the same token, the same 401 handling, the
        same unwrapping of an RPC that refuses on its own terms.

        It cannot loop: `hq_undo` sets a transaction-local flag that stops the
        reversal recording an undo of its own, so the result it returns carries
        no `undo` id for `act` to offer.
      */
      const said = await act('undo', { p_action_id: current })
      hide()
      if (typeof refresh === 'function') await refresh()
      if (said?.ok === false) window.alert(said.note ?? 'That could not be undone.')
    } catch (error) {
      // Left on screen deliberately. A failed undo is the one case where the
      // offer must survive the press: the thing is still changed, and hiding
      // the way back would be the worst possible response to it.
      press.disabled = false
      press.textContent = 'Undo'
      const word = bar.querySelector('.undoword')
      if (word !== null) {
        word.textContent = error instanceof Error ? error.message : String(error)
        bar.classList.add('bad')
      }
    }
  })

  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(hide, SHOWN)
}

/** For a check, and for anything that needs to know whether one is up. */
export const showing = () => current
