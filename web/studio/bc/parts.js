/*
  Shared primitives for the experimental Basecamp-inspired Team HQ.

  §17 phase 1: Button, IconButton, Input, Menu, Sheet, Breadcrumb,
  RecordActions, Status, EmptyState, ErrorState and Skeleton, built once and
  consumed everywhere, so that §9's promise — every record page feels related —
  is structural rather than a thing each renderer has to remember.

  A NOTE ON COMMENTS IN THIS FILE. Every function here returns a template
  literal, and a backtick inside a comment inside a template literal terminates
  the string and makes the module unparseable — which renders nothing and
  announces itself a long way from the cause. This repository has paid for that
  five times. Comments inside a returned template use plain words only.
*/

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

/** Attribute soup from a plain object, skipping null and undefined. */
const attrs = (o = {}) =>
  Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? esc(k) : `${esc(k)}="${esc(v)}"`))
    .join(' ')

/**
 * A button.
 *
 * `kind` is one of primary, outline, danger or plain. §4.2 asks for sentence
 * case and a plain verb; that is the caller's business, but the height, radius
 * and 44px hit target are not, which is the whole reason this exists.
 */
export const button = (label, o = {}) => {
  const { kind = 'plain', ...rest } = o
  const cls = `bcbtn${kind === 'plain' ? '' : ` bcbtn--${kind}`}`
  return `<button type="button" class="${cls}" ${attrs(rest)}>${esc(label)}</button>`
}

/**
 * An icon-only control.
 *
 * `label` is REQUIRED and becomes the accessible name. §15: every icon-only
 * action has one. Passing an empty string is a defect, not a style, so it is
 * cheaper to fail here than to find it in an audit.
 */
export const iconButton = (glyph, label, o = {}) => {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('an icon-only control needs an accessible name')
  }
  return `<button type="button" class="bcicon" aria-label="${esc(label)}" ${attrs(o)}>${glyph}</button>`
}

/**
 * A labelled input.
 *
 * §11.3 forbids placeholder-only labelling for consequential fields, so the
 * label is not optional and is rendered as a real element rather than as an
 * aria-label — a visible label survives a screenshot, a translation and a
 * person who has forgotten what the field was for.
 */
export const input = (o = {}) => {
  const { id, label, error = null, hint = null, ...rest } = o
  const described = [error ? `${id}-err` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')
  return `<div class="bcfield">
    <label class="bclabel" for="${esc(id)}">${esc(label)}</label>
    <input class="bcinput" id="${esc(id)}" ${attrs({
      ...rest,
      'aria-invalid': error ? 'true' : null,
      'aria-describedby': described === '' ? null : described,
    })}>
    ${hint ? `<span class="bclabel" id="${esc(id)}-hint">${esc(hint)}</span>` : ''}
    ${error ? `<span class="bcerror" id="${esc(id)}-err">${esc(error)}</span>` : ''}
  </div>`
}

/**
 * The breadcrumb and record action bar of §6.3.
 *
 * One order for every object type — project, then optional containing tool,
 * then the record — because the specification's whole argument is that a
 * different toolbar arrangement per object is what makes a product feel
 * assembled rather than designed.
 */
export const breadcrumb = (trail, actions = '') =>
  `<nav class="bccrumb" aria-label="Breadcrumb">
    ${trail
      .map((t, i) =>
        t.to === undefined
          ? `<span aria-current="page">${esc(t.name)}</span>`
          : `<a href="${esc(t.to)}" data-bc-go="${esc(t.to)}">${esc(t.name)}</a>${
              i < trail.length - 1 ? '<span class="bcsep" aria-hidden="true">/</span>' : ''
            }`,
      )
      .join('')}
    ${actions === '' ? '' : `<span class="bcactions">${actions}</span>`}
  </nav>`

/**
 * A state chip.
 *
 * §15: never encode agent or job state by colour alone. The word is always
 * present and the dot is decoration, which is why the dot carries
 * aria-hidden and the text does not.
 */
export const status = (word, kind = '') =>
  `<span class="bcstatus${kind === '' ? '' : ` bcstatus--${kind}`}">
    <span class="bcdot" aria-hidden="true"></span>${esc(word)}
  </span>`

/**
 * §12 empty: say what the area is for and offer one next action. Never imply
 * an error, and never decorate with a meaningless chart.
 */
export const empty = (what, action = '') =>
  `<div class="bcempty"><b>${esc(what.title)}</b><span>${esc(what.body)}</span>${action}</div>`

/**
 * §12 error: keep the user's input, explain in plain language, offer Retry
 * when it is safe. The caller supplies the retry control because only the
 * caller knows whether retrying is safe.
 */
export const errorState = (message, retry = '') =>
  `<div class="bcerrorstate" role="alert"><b>That did not work</b><span>${esc(message)}</span>${retry}</div>`

/**
 * §12 loading: a shape-matched skeleton, shown only after 250ms and only where
 * the shape is predictable. `lines` is how many rows the real content will
 * have, so the page does not jump when it arrives.
 */
export const skeleton = (lines = 3) =>
  `<div class="bcskelwrap" aria-hidden="true">${Array.from(
    { length: lines },
    (_, i) =>
      `<div class="bcskel" style="height:${i === 0 ? 18 : 13}px;width:${
        [92, 74, 84, 61, 79][i % 5]
      }%;margin:${i === 0 ? '0' : '10px'} 0 0"></div>`,
  ).join('')}</div>`

/**
 * A tool block on the overview (§8.2).
 *
 * Every block is a heading plus ONE large preview link, and the preview's
 * accessible name announces the tool and what the preview is summarising —
 * point 4 of §8.2, and the difference between a screen reader hearing
 * "button" nine times and hearing what each one opens.
 */
export const tool = (o) => {
  const { name, to, summary, body, count = null } = o
  return `<section class="bctool">
    <h2><a href="${esc(to)}" data-bc-go="${esc(to)}">${esc(name)}</a>${
      count === null ? '' : ` <span class="bcmore">${esc(count)}</span>`
    }</h2>
    <button type="button" class="bcpreview" data-bc-go="${esc(to)}"
      aria-label="${esc(`${name}. ${summary}`)}">${body}</button>
  </section>`
}
