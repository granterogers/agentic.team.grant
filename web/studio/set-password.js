/*
  CHOOSE A NEW PASSWORD, after a password reset link (owner decision, 15 October 2026).

  A reset link signs the browser in with a session marked `recovery` (flow.js). Until a new password is saved, that
  session is not used for anything else: this form covers the page. Saving calls the sign-in function's password_set,
  which asks Auth to change the password for that session. Cancelling signs this browser out.

  The form draws only when the held session says a password is owed, so an ordinary visit never sees it.
*/
import * as session from './session.js'

const ID = 'setpw-overlay'

const STYLE = `
#setpw-overlay { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 16px;
  background: rgba(0, 0, 0, 0.6); font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
#setpw-overlay .setpw-card { width: 100%; max-width: 380px; background: #fff; color: #1d1d1f; border-radius: 12px;
  padding: 24px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); }
#setpw-overlay h2 { font-size: 20px; margin: 0 0 8px; }
#setpw-overlay p { margin: 0 0 16px; font-size: 15px; }
#setpw-overlay label { display: block; font-size: 14px; margin: 0 0 4px; }
#setpw-overlay input { width: 100%; box-sizing: border-box; font-size: 16px; padding: 10px; margin: 0 0 14px;
  border: 1px solid #aeaeb2; border-radius: 8px; }
#setpw-overlay .setpw-actions { display: flex; gap: 8px; justify-content: flex-end; }
#setpw-overlay button { font-size: 16px; padding: 10px 16px; border-radius: 8px; border: 1px solid #0b5d58;
  background: #0b5d58; color: #fff; cursor: pointer; }
#setpw-overlay button.setpw-quiet { background: #fff; color: #0b5d58; }
#setpw-overlay button:disabled { opacity: 0.6; cursor: default; }
#setpw-overlay .setpw-said { min-height: 1.5em; color: #9b1c1c; font-size: 15px; margin: 12px 0 0; }
`

const card = () => `<form class="setpw-card" novalidate>
  <h2 id="setpw-title">Choose a new password</h2>
  <p>This replaces the old one. Choose something you have not used elsewhere.</p>
  <label for="setpw-new">New password</label>
  <input id="setpw-new" name="password" type="password" autocomplete="new-password" required>
  <label for="setpw-again">Type it again</label>
  <input id="setpw-again" name="again" type="password" autocomplete="new-password" required>
  <div class="setpw-actions">
    <button type="button" class="setpw-quiet" data-setpw-cancel>Sign out</button>
    <button type="submit" data-setpw-save>Save password</button>
  </div>
  <p class="setpw-said" role="status" aria-live="polite" data-setpw-said></p>
</form>`

/** Draw the form when a password is owed. Safe to call on every page load: it draws nothing otherwise. */
export const mountSetPassword = () => {
  if (!session.mustSetPassword() || document.getElementById(ID) !== null) return
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.append(style)
  const wrap = document.createElement('div')
  wrap.id = ID
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.setAttribute('aria-labelledby', 'setpw-title')
  wrap.innerHTML = card()
  document.body.append(wrap)

  const form = wrap.querySelector('form')
  const said = wrap.querySelector('[data-setpw-said]')
  const save = wrap.querySelector('[data-setpw-save]')
  const first = wrap.querySelector('#setpw-new')
  first?.focus()

  wrap.querySelector('[data-setpw-cancel]')?.addEventListener('click', () => {
    session.forget()
    window.location.reload()
  })

  form?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const password = first?.value ?? ''
    const again = wrap.querySelector('#setpw-again')?.value ?? ''
    if (password !== again) {
      if (said) said.textContent = 'The two passwords do not match.'
      return
    }
    if (save instanceof HTMLButtonElement) save.disabled = true
    if (said) said.textContent = ''
    try {
      await session.setPassword(password)
      wrap.remove()
      // The page was drawn while the reset session was held: reload so it shows the signed-in office.
      window.location.reload()
    } catch (error) {
      if (said) said.textContent = error instanceof Error ? error.message : 'The password could not be saved.'
      if (save instanceof HTMLButtonElement) save.disabled = false
    }
  })
}
