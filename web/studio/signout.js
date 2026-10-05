/*
  Signing out (#405), and what the browser is allowed to keep afterwards.

  A browser is a shared place: the next person to open it must not find the last
  person's conversations, drafts, voice recordings or cached pages. The rule is
  the INVERSE of a list of private keys, because a list of what to clear is a
  list of what somebody remembered, and the next store added is the one missed.

  ## What survives, and why

  Only an explicit allow-list of DEVICE preferences, none of which says anything
  about a person's work: how the screen looks (theme, density, wallpaper), whether
  the side rail and dock are open, and how the documents and composer are laid
  out. They describe this screen, not this person.

  ## What does not

  Everything else, by class rather than by name:
    - localStorage: every key not on the allow-list (the session, the legacy
      office key, the chat threads, the to-do and contact memory, the per-project
      tab and arrangement);
    - sessionStorage: all of it;
    - IndexedDB: every database (the voice recordings are in `bc.notes`);
    - Cache storage: every cache, and any service worker.
  The page then reloads, which is what empties the in-memory state: a stale
  module-level store is exactly the residue a list cannot see.

  ## The fence

  A request started by the person who has just gone may still be in flight. The
  epoch below moves the moment sign-out begins, and a response that finds it has
  moved is dropped rather than drawn.
*/

import * as notes from './bc/notestore.js'
import * as session from './session.js'

/** Device-level preferences that carry nothing about a person. */
export const DEVICE_KEYS = Object.freeze([
  'studio.appearance',
  'studio.rail',
  'studio.dock',
  'bc.compose',
  'bc.docsview',
])

/** Whether a response that began in an earlier epoch may still be used. */
export const current = (startedIn) => startedIn === session.epoch()

const wipeLocal = () => {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!DEVICE_KEYS.includes(key)) localStorage.removeItem(key)
    }
  } catch {
    /* storage blocked: nothing was kept either */
  }
  try {
    sessionStorage.clear()
  } catch {
    /* as above */
  }
}

const wipeDatabases = async () => {
  if (typeof indexedDB === 'undefined') return
  let names = ['bc.notes']
  try {
    const listed = (await indexedDB.databases?.()) ?? []
    names = [...new Set([...names, ...listed.map((d) => d.name).filter(Boolean)])]
  } catch {
    /* an older browser cannot list them: the one we know of is still deleted */
  }
  await Promise.all(
    names.map(
      (name) =>
        new Promise((resolve) => {
          try {
            const request = indexedDB.deleteDatabase(name)
            request.onsuccess = () => resolve(true)
            request.onerror = () => resolve(false)
            request.onblocked = () => resolve(false)
          } catch {
            resolve(false)
          }
        }),
    ),
  )
}

const wipeCaches = async () => {
  try {
    if (typeof caches !== 'undefined') {
      for (const key of await caches.keys()) await caches.delete(key)
    }
    if (navigator.serviceWorker?.getRegistrations) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
    }
  } catch {
    /* nothing to clear is not a failure */
  }
}

/**
 * Sign out: stop trusting anything in flight, clear every private store, and
 * come back to the signed-out page. `reload` is false only for a test that
 * wants to look at the page it is leaving.
 */
export async function signOut({ reload = true } = {}) {
  session.bump()
  session.forget()
  wipeLocal()
  // The page's own open IndexedDB connection would block the deletion below, so it is closed first.
  await notes.release().catch(() => {})
  await Promise.all([wipeDatabases(), wipeCaches()])
  // A second pass: a request that landed between the first and now may have written back.
  wipeLocal()
  if (reload) window.location.replace(`${window.location.pathname}`)
}
