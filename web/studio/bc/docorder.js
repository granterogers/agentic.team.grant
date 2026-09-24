/*
  What order the documents are in, and who decided it.

  §§25-38. Four modes, in both the miniature and the expanded view, sharing ONE
  custom order:

    Name           A to Z, by what the document is actually called
    Date uploaded  when this copy entered the office
    Date created   when the thing itself was made
    Custom         the order Grant put them in

  ## Why this is a module rather than two bits of the shell

  Because §30 is the whole requirement: *"The miniature and expanded views must
  NOT maintain independent custom orders... Both surfaces are views onto the
  SAME canonical ordering state."* Two renderers that each sort for themselves
  are two orders that will disagree, which this repository has already paid for
  with a row list built twice. There is one comparator set here and both call
  it.

  ## The custom order lives in the office

  ADR-0021's rule, which §22 says applies here too: an arrangement belongs to
  the PERSON and the project, not to the machine. `public.document_orders`
  holds a list of ids; anything not in the list is newer than the arrangement
  and sorts after it, which is also what a person expects of something they
  have not seen yet.

  `localStorage` is a cache in front of it so the renderer can stay
  synchronous, and the three rules are ADR-0021's, each of which was a bug
  before it was a rule: the office is read first, an empty list is a reset, and
  this session's own change outranks both until the next load.

  ## An automatic sort is a VIEW and never a write

  §32, and the subtlest thing here: choosing Name must not touch the custom
  order. So sorting by name computes an order and stores nothing; only a drag
  writes. Returning to Custom therefore returns to exactly what he arranged,
  however many times he has looked at it by date in between.

  ## The dates are allowed to be missing

  §§27-28, and 0583 has the reasoning: the office knows when a document was
  taken in and, for its own work, when it was written. It does NOT know when a
  document that came from a connector was originally created, and putting the
  row date there would be an upload date wearing another name. Missing sorts
  last, always, in both directions — a document with no date is not "oldest",
  it is unknown, and burying it at the end is the honest answer either way.
*/

/** The modes, in the order the control offers them. */
export const MODES = [
  { id: 'custom', name: 'Custom', hint: 'the order you put them in' },
  { id: 'name', name: 'Name', hint: 'A to Z' },
  { id: 'uploaded', name: 'Date uploaded', hint: 'newest first' },
  { id: 'created', name: 'Date created', hint: 'newest first' },
]

export const isMode = (id) => MODES.some((m) => m.id === id)

const MODE_KEY = (slug) => `bc.docsort.${slug}`
const ORDER_KEY = (slug) => `bc.docorder.${slug}`

/*
  WHICH MODE IS SHOWING is a view preference and stays in the browser. §31 is
  about the custom ORDER, which is his arrangement and belongs to him; how he
  happens to be looking at it this minute is not the same kind of fact, and
  syncing it would mean opening the phone changes what the desk is showing.
*/
export const mode = (slug) => {
  try {
    const held = globalThis.localStorage?.getItem(MODE_KEY(slug)) ?? ''
    return isMode(held) ? held : 'custom'
  } catch {
    return 'custom'
  }
}

export const setMode = (slug, id) => {
  if (!isMode(id)) return false
  try {
    globalThis.localStorage?.setItem(MODE_KEY(slug), id)
  } catch {
    /* A browser that cannot remember still sorts; it just forgets by morning. */
  }
  return true
}

/* --- the custom order ---------------------------------------------------- */

let keep = null
let forget = null

/** Tell this module how to put an order in the office. */
export const persistence = ({ save, reset } = {}) => {
  keep = typeof save === 'function' ? save : null
  forget = typeof reset === 'function' ? reset : null
}

/** Projects this session has rearranged, which the office must not overwrite. */
const mine = new Set()

/** Take the office's copy, unless this session has already changed it. */
export const adopt = (slug, ids) => {
  if (typeof slug !== 'string' || slug === '' || mine.has(slug)) return false
  if (!Array.isArray(ids) || ids.length === 0) return false
  try {
    globalThis.localStorage?.setItem(ORDER_KEY(slug), JSON.stringify(ids.map(String)))
    return true
  } catch {
    return false
  }
}

/** The stored custom order, or an empty list when he has not made one. */
export const custom = (slug) => {
  try {
    const raw = globalThis.localStorage?.getItem(ORDER_KEY(slug)) ?? ''
    if (raw === '') return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

/** Write one, here and at the office. */
export const remember = (slug, ids) => {
  const clean = [...new Set(ids.map(String).filter((id) => id !== ''))]
  try {
    globalThis.localStorage?.setItem(ORDER_KEY(slug), JSON.stringify(clean))
  } catch {
    /* As above: it still applies to this render. */
  }
  mine.add(slug)
  /*
    Not awaited, deliberately. An order that stuck on screen and failed to
    reach the office is better than a gesture that waits for a round trip, and
    the next load reconciles them.
  */
  if (keep !== null) void keep(slug, clean)
  return clean
}

export const forgetCustom = (slug) => {
  try {
    globalThis.localStorage?.removeItem(ORDER_KEY(slug))
  } catch {
    /* Already the default. */
  }
  mine.add(slug)
  if (forget !== null) void forget(slug)
}

/* --- the comparators ----------------------------------------------------- */

const idOf = (d) => String(d?.id ?? '')

/**
 * A name, compared the way a person reads one.
 *
 * `localeCompare` with `numeric` so "Chapter 2" comes before "Chapter 10",
 * and with `sensitivity: 'base'` so case and accents do not split a list into
 * two alphabets. §26 asks for these to be defined and tested, because the
 * default answers are all wrong in an obvious way.
 */
const byName = (a, b) =>
  String(a?.title ?? '').localeCompare(String(b?.title ?? ''), 'en', {
    numeric: true,
    sensitivity: 'base',
  })

/**
 * A date, newest first, with MISSING ALWAYS LAST.
 *
 * Not "missing is oldest". A document whose date the office does not know is
 * not old; it is unknown, and sorting it among the dated ones would be the
 * invention §15 forbids, expressed as a position rather than as a number.
 */
const byDate = (field) => (a, b) => {
  const x = a?.[field] ?? null
  const y = b?.[field] ?? null
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  return String(y).localeCompare(String(x))
}

/**
 * The tiebreak, and the reason two renders never disagree.
 *
 * `added` is the office's own row date and is always present; the id is the
 * last resort so that even two documents recorded in the same transaction have
 * a stable order. §26: "Use a deterministic secondary key so equal names do
 * not randomly change order between renders."
 */
const settle = (a, b) => {
  const added = String(b?.added ?? '').localeCompare(String(a?.added ?? ''))
  if (added !== 0) return added
  return idOf(a).localeCompare(idOf(b))
}

const then = (first) => (a, b) => {
  const answer = first(a, b)
  return answer === 0 ? settle(a, b) : answer
}

/**
 * The documents in the order this surface should draw them.
 *
 * Pure: it reads the mode and the stored order and returns a new array. It
 * writes nothing, which is what makes switching to Name and back safe.
 */
export const ordered = (slug, docs, which) => {
  const list = Array.isArray(docs) ? [...docs] : []
  const how = isMode(which) ? which : mode(slug)
  if (how === 'name') return list.sort(then(byName))
  if (how === 'uploaded') return list.sort(then(byDate('uploaded')))
  if (how === 'created') return list.sort(then(byDate('created')))

  /*
    CUSTOM. The stored list decides, and anything absent from it is newer than
    the arrangement — so it goes after, in the office's own order, rather than
    at the front where it would push his arrangement down the screen.
  */
  const wanted = custom(slug)
  if (wanted.length === 0) return list.sort(then(byDate('added')))
  const rank = new Map(wanted.map((id, i) => [id, i]))
  return list.sort((a, b) => {
    const x = rank.get(idOf(a))
    const y = rank.get(idOf(b))
    if (x !== undefined && y !== undefined) return x - y
    if (x !== undefined) return -1
    if (y !== undefined) return 1
    return settle(a, b)
  })
}

/**
 * Move one document to where another one is, and remember the whole order.
 *
 * Takes the list as currently DRAWN, so a drag in a date view arranges what he
 * can see rather than what the stored list happens to say — and the result
 * becomes the custom order, because rearranging by hand is what Custom means.
 */
export const moveWithin = (slug, drawn, movedId, ontoId) => {
  const ids = drawn.map(idOf).filter((id) => id !== '')
  const from = ids.indexOf(String(movedId))
  const onto = ids.indexOf(String(ontoId))
  if (from < 0 || onto < 0 || from === onto) return null
  ids.splice(onto, 0, ...ids.splice(from, 1))
  return remember(slug, ids)
}

/** Move one document one place up or down, for anybody who cannot drag (§52). */
export const nudge = (slug, drawn, movedId, by) => {
  const ids = drawn.map(idOf).filter((id) => id !== '')
  const from = ids.indexOf(String(movedId))
  if (from < 0) return null
  const to = Math.max(0, Math.min(ids.length - 1, from + by))
  if (to === from) return null
  ids.splice(to, 0, ...ids.splice(from, 1))
  return remember(slug, ids)
}
