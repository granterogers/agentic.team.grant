/*
  WHETHER GOOGLE DRIVE IS CONNECTED, for the Drive folder controls (21 October 2026).

  The office answers `google_connection` with a state, and `ok` is the only one that means connected (the same reading the
  Settings tile uses). Null until the office has answered. The Drive buttons are drawn disabled until it says true, so
  nothing offers a folder the office cannot read.

  The answer changes the buttons IN PLACE. It does not redraw the page: a redraw while the page is still wiring itself
  tears the header down under the person's hand. It is asked once per page load, so a person who connects Google in
  Settings reloads the page to see the buttons turn on.
*/

export const driveFolder = { connected: null }

let asked = false

/** Enables or disables the Drive controls on the page, and clears the hint once they are usable. */
export function paintDriveFolder() {
  if (typeof document === 'undefined') return
  const on = driveFolder.connected === true
  for (const b of document.querySelectorAll('[data-bc-drive-folder], [data-bc-drive-save]')) {
    if (on) b.removeAttribute('disabled')
    else b.setAttribute('disabled', '')
  }
  for (const s of document.querySelectorAll('[data-bc-drive-said]')) {
    if (on) s.textContent = ''
  }
}

/** Asks the office once. The answer is painted onto the buttons already on the page. */
export function loadDriveFolder(read) {
  if (asked) return
  asked = true
  const answer = (connected) => {
    driveFolder.connected = connected
    paintDriveFolder()
  }
  read('google_connection').then(
    (r) => answer(r?.state === 'ok'),
    () => answer(false),
  )
}
