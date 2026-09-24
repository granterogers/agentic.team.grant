/*
  Times that stay true while the page is open.

  Issue #153, from #137 item 5.

  ## The quiet lie

  "3 days ago", "2 hours ago", "just now" — every one of them was computed in
  SQL when the payload was built. Before #117 that was harmless: a page lived
  for a minute. With the watcher the studio can be open all afternoon, and those
  strings go quietly wrong while Grant is looking at them. A feed that says
  "2 minutes ago" about something from breakfast is worse than one with no
  times, because he has no reason to doubt it.

  ## One function, not eight

  The other half of the Issue, and the more valuable one:

    > *It also makes every relative time in the product derive from one function
    > instead of from whichever SQL built that section, which is how "This week"
    > and "3 days ago" came to disagree in the first place.*

  The projections carry the INSTANT. The words are made here, once. A section
  that wants a relative time asks `stamp()` and gets a `<time>` element; nothing
  anywhere else decides what "recent" means.

  ## Why a real `<time>` element

  Three things fall out of it and none of them is decoration:

    * the exact instant is in the DOM, so the words can be re-made from it
      without another fetch;
    * `title` carries the full date, so a relative string is never the only
      truth available — hover and you get "Fri 12 Sep 2026 at 14:22";
    * a screen reader and a copy-paste both get something meaningful.

  ## Re-rendered on #117's tick, and on no timer of its own

  A second `setInterval` would be a second thing to leak, a second thing to
  forget to stop when the tab is hidden, and a second cadence for the page to
  update on. `pulse.js` already ticks every twenty seconds and already stops
  when the tab is not visible; `retime()` rides it.
*/

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * The words for an instant, relative to now.
 *
 * Whole units and no decimals: "1 hour ago", never "1.4 hours ago". A person
 * reading a feed wants to know roughly when, and a decimal reads as precision
 * that the underlying number does not have.
 */
export function words(iso, now = Date.now()) {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''

  const ms = now - at
  /*
    The future is possible and must not render as "-3 minutes ago".

    A due date, a scheduled step, and a clock a few seconds out between the
    browser and the server all land here. Under a minute either way is "just
    now", which absorbs the clock skew case entirely.
  */
  if (ms < -MINUTE) return inWords(-ms)
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return plural(Math.floor(ms / MINUTE), 'minute')
  if (ms < DAY) return plural(Math.floor(ms / HOUR), 'hour')
  if (ms < 30 * DAY) return plural(Math.floor(ms / DAY), 'day')
  /*
    Beyond a month the relative form stops helping. "47 days ago" is a number
    somebody has to do arithmetic on; "12 Sep" is the answer they wanted.
  */
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

const plural = (n, unit) => `${String(n)} ${unit}${n === 1 ? '' : 's'} ago`

const inWords = (ms) =>
  ms < HOUR
    ? `in ${String(Math.floor(ms / MINUTE))} min`
    : ms < DAY
      ? `in ${String(Math.floor(ms / HOUR))}h`
      : `in ${String(Math.floor(ms / DAY))} days`

/** The full date, for the tooltip. Never abbreviated — this is the fallback. */
export function exact(iso) {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  return new Date(at).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * The instant, to the second, for a log rather than for prose.
 *
 * Grant, 23 September, about Activity: *"verify exact DATE + HH:MM:SS"*. A
 * relative phrase is the right thing in a sentence and the wrong thing in a
 * history somebody is auditing - "2d ago" cannot be compared with anything,
 * and two events an hour apart read as the same moment. This is the other
 * half, and it is deliberately not a replacement: the day still groups the
 * list, and this is what each row carries.
 */
export function precise(iso) {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const d = new Date(at)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return `${date} · ${time}`
}

/**
 * A `<time>` element that can be re-made later.
 *
 * `fallback` is what the server already rendered. Used when the instant is
 * missing or unparseable, so a projection that has not been given its `_at` key
 * yet degrades to exactly what it showed before rather than to nothing — which
 * is what makes this safe to roll through the projections one at a time.
 */
export function stamp(iso, fallback = '') {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) {
    return fallback === '' ? '' : escapeText(fallback)
  }
  const at = new Date(iso).toISOString()
  return (
    `<time data-rel datetime="${at}" title="${escapeText(exact(iso))}">` +
    `${escapeText(words(iso))}</time>`
  )
}

/*
  Its own escape rather than app.js's `esc`.

  Importing `esc` would make this module depend on the 6,000-line file that
  imports it, and everything here is a date the browser formatted — but
  `fallback` is server text, so it is escaped on the same path as everything
  else rather than trusted because it usually happens to be safe.
*/
const escapeText = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

/**
 * Re-make the words on every `<time data-rel>` under `root`.
 *
 * Called from `pulse.js`'s tick, which already runs every twenty seconds and
 * already stops while the tab is hidden. Touching only `textContent` and only
 * when it changed: a feed of forty rows redrawn wholesale twenty times a minute
 * would fight the caret, the selection and every open sheet.
 */
export function retime(root = document) {
  const now = Date.now()
  for (const el of root.querySelectorAll('time[data-rel][datetime]')) {
    const said = words(el.getAttribute('datetime'), now)
    if (said !== '' && said !== el.textContent) el.textContent = said
  }
}
