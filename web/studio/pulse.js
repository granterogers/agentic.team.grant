/*
  The page notices when the office moves (#117).

  Grant's studio fetched once and never changed again. A job finishing, an
  output arriving, a task ticked from Telegram — none of it appeared until a
  reload, so the ribbon saying what the office is doing *right now* was only
  true at the moment the page loaded. It was a photograph, not a window.

  ## Why this is a poll and not Supabase Realtime

  Realtime was the obvious answer and it is not available here.

  A browser subscribing to Realtime needs the ANON KEY and RLS policies letting
  that key read `jobs`, `outputs` and `tasks`. The studio holds exactly one
  credential — `hq.api_token`, checked by `hq-api` — and CLAUDE.md is explicit
  that there is no new auth system. Adding the anon key would put a second
  credential path in the browser, and the policies it needs would make the
  office's work readable to anyone holding a key that is public by design.

  So the page asks a cheap question instead: `?section=pulse` returns five
  numbers and a timestamp, and the full payload is refetched only when they
  differ. Less elegant. It costs no credential and opens no door.

  ## Three rules that keep it from being annoying

  1. **Only while you are looking.** `visibilitychange` stops the timer when the
     tab goes to the background and asks IMMEDIATELY when it comes back — which
     is also the moment a person most wants the truth, having been away.

  2. **Never mid-gesture.** A repaint while a panel is being dragged would fight
     the drag, and a page that moves under your hand is worse than a stale one.
     `.lifted` is the studio's own marker for "something is being held" and the
     watcher waits for it to clear.

  3. **Never mid-sentence.** If a composer has text in it, the refetch waits.
     Losing a half-typed message to a background refresh is the kind of thing
     that stops people trusting a page.
*/

const EVERY = 20_000

/** The last digest we saw, as text. Compared whole; the fields do not matter. */
let seen = null
let timer = null
let running = false
/** The live poll, set by `watch`. Called when the tab comes back to the front. */
let ask = async () => {}

const onShow = () => {
  // Coming back to the tab is the moment the answer matters most, so ask at
  // once rather than waiting out the rest of an interval.
  if (!document.hidden) void ask()
}

/** Whether anything is being held or typed. Both mean "not now". */
const busy = () => {
  if (document.querySelector('.lifted') !== null) return true
  for (const box of document.querySelectorAll('textarea')) {
    if (box.value.trim() !== '') return true
  }
  return false
}

/**
 * Ask, and say whether it differs.
 *
 * Returns false on any failure rather than throwing. A poll is a background
 * convenience and must never be a way for the page to break — the office being
 * unreachable is #119's business and it already has words for it, so this stays
 * quiet and lets the next successful fetch speak.
 */
async function changed(endpoint, token) {
  try {
    const r = await fetch(`${endpoint}?section=pulse`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) return false
    const { data } = await r.json()
    if (data === undefined || data === null) return false
    /*
      `at` moves every single call, so it has to come out before comparing.
      Leaving it in would make every poll a change and the page would refetch
      the whole payload three times a minute for ever.
    */
    const { at: _ignored, ...digest } = data
    const now = JSON.stringify(digest)
    if (seen === null) {
      seen = now
      return false
    }
    if (now === seen) return false
    seen = now
    return true
  } catch {
    return false
  }
}

/**
 * Watch, and call `refresh` when the office has moved.
 *
 * `refresh` is the studio's own re-read — the same one every write already
 * calls — so there is one path from "the data changed" to "the page shows it",
 * and a realtime update cannot drift from a post-write update.
 */
export function watch(endpoint, token, refresh) {
  stop()
  if (token === '') return

  const tick = async () => {
    if (running || document.hidden) return
    running = true
    try {
      if (await changed(endpoint, token)) {
        /*
          Wait for the hand to come off before redrawing. Deferred rather than
          dropped: a change is still a change, and skipping it would mean the
          page stays stale for as long as somebody keeps typing.
        */
        while (busy()) await new Promise((r) => setTimeout(r, 1_500))
        await refresh()
      }
    } finally {
      running = false
    }
  }

  /*
    `ask` is assigned here rather than declared at module level with a stub,
    because a stub is what the first version had and it silently did nothing:
    `onShow` called a no-op, so coming back to the tab never asked and the
    whole visibility half of this file was decoration. A handler that closes
    over the real `tick` cannot have that bug.
  */
  ask = tick
  timer = setInterval(() => { void tick() }, EVERY)
  document.addEventListener('visibilitychange', onShow)
  // Prime the digest now, so the first real change is detected rather than
  // being swallowed as "the first answer we ever saw".
  void tick()
}

/** Stop watching. Called before starting, so `watch` is safe to call twice. */
export function stop() {
  if (timer !== null) clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onShow)
}

/** For a check: what the watcher currently believes the office looks like. */
export const digest = () => seen
