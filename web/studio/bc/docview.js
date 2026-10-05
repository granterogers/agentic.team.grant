/*
  THE DOCUMENT VIEWER, AND THE CONTROLS AROUND A LIST OF DOCUMENTS.

  Grant, 4 October 2026: a document should be quickly viewable inside Team HQ -
  PDFs, images, text - with its metadata beside it, a very small indicator of
  where it came from, an "Open source" for the cases that need the original, and
  an explicit Import that makes a durable Team HQ copy. Routine viewing must not
  require opening Google Drive.

  The viewer reads the file through the same `document` section the thumbnails
  use (`fileFor`, handed in), so there is one place that decides where a
  document's bytes are. What it shows, in order of preference:

    a PDF        its first pages, rendered here
    an image     the image
    audio        the player the record already draws
    readable text  the text the office holds (for an external document this is
                 the extracted text it cached - the document is read, not copied)
    nothing      a plain statement that there is no preview, and the way to the
                 source or the file

  Import is only ever pressed: nothing here imports on its own, and a document
  that is already imported is not offered it again. The gateway action may not
  exist in an older office; its refusal is shown in words next to the button.

  Comments inside any template literal in this file use plain words.
*/

import { act, read } from '../office.js'
import * as pdf from '../pdf.js'
import * as docsrc from './docsources.js'
import { esc } from './parts.js'

const TEXT_LIMIT = 9000

const say = (host, text, tone = '') => {
  const el = host.closest('.bcdocgrid')?.querySelector('[data-bc-docsay]')
  if (el === null || el === undefined) return
  el.textContent = text
  el.dataset.tone = tone
}

/** Fill a preview host with the best view of the document there is. */
const paintPreview = async (host, fileFor) => {
  const ref = host.dataset.bcDocpreview ?? ''
  if (host.dataset.bcDocaudio === '1') return
  const note = host.querySelector('[data-bc-docpreviewnote]')
  const none = (why) => {
    host.innerHTML = `<p class="bcpmeta bcdocnopreview">${esc(why)}</p>`
  }
  if (ref === '' || ref.startsWith('d:')) {
    none(
      'There is no file behind this one to open - it is a record of something the office knows about rather than something it holds. What it knows is beside it.',
    )
    return
  }
  const file = await fileFor(ref)
  if (file === null) {
    none('There is nothing to preview here. The office holds a record of this document, not its contents.')
    return
  }
  const mime = String(file.mime ?? '').toLowerCase()
  const url = String(file.url ?? '')
  const isPdf = mime === 'application/pdf' || /\.pdf(\?|$)/i.test(url)
  const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)
  if (url !== '' && isPdf) {
    try {
      const { pages, total } = await pdf.pages(url, 760, 6)
      host.innerHTML = `<div class="bcdocpages">${pages
        .map((p, i) => `<img class="bcdocpage" alt="${esc(`Page ${String(i + 1)} of ${String(total)}`)}" src="${esc(p.src)}" loading="lazy">`)
        .join('')}</div>${total > pages.length ? `<p class="bcpmeta">${esc(`Showing the first ${String(pages.length)} of ${String(total)} pages. Open the file for the rest.`)}</p>` : ''}`
      return
    } catch {
      /* Fall through to the text, then to the honest "no preview". */
    }
  }
  if (url !== '' && isImage) {
    host.innerHTML = `<img class="bcdocimage" alt="${esc(host.dataset.bcDoctitle ?? 'Document image')}" src="${esc(url)}">`
    return
  }
  const text = String(file.content ?? '').trim()
  if (text !== '') {
    const cut = text.length > TEXT_LIMIT
    host.innerHTML = `<pre class="bcdoctext" tabindex="0" aria-label="Text of the document">${esc(cut ? `${text.slice(0, TEXT_LIMIT)}…` : text)}</pre>${
      cut ? '<p class="bcpmeta">That is the beginning. The whole text is held and searchable.</p>' : ''
    }`
    return
  }
  if (note !== null) note.remove()
  none(
    url === ''
      ? 'This document is held at its source and the office has no readable text of it yet.'
      : 'This kind of file has no preview here. Open the file to see it.',
  )
}

/** The version history, drawn only when the office has one to show. */
const paintVersions = async (host, ctx) => {
  const id = host.dataset.bcDocversions ?? ''
  if (id === '') return
  let out = null
  try {
    out = await read('document_versions', id)
  } catch {
    return
  }
  const versions = Array.isArray(out?.versions) ? out.versions : []
  if (versions.length < 2) return
  host.hidden = false
  /*
    EACH VERSION SAYS ITS OWN STATE. Approval belongs to a version: the approved one is current, a draft beside it is
    pending until a person approves it, and an earlier draft that a newer one replaced is kept as history, unnumbered.
  */
  const stateOf = (v) => (v.is_earlier_draft ? 'Earlier draft' : v.state === 'approved' ? 'Approved' : v.state === 'review' ? 'In review' : v.state === 'archived' ? 'Replaced' : 'Draft')
  host.innerHTML = `<h2 class="bcsubhead">Versions</h2>
    <ol class="bcversions" reversed>${versions
      .slice()
      .sort((a, b) => (b.version ?? 0.5) - (a.version ?? 0.5))
      .map(
        (v) => `<li class="bcversion${v.is_current ? ' is-current' : ''}${v.is_pending ? ' is-pending' : ''}">
          <span class="bcvn">${v.version === null || v.version === undefined ? '·' : `v${esc(String(v.version))}`}</span>
          <span class="bcvstate bcvstate--${esc(v.is_earlier_draft ? 'earlier' : String(v.state ?? ''))}">${esc(stateOf(v))}</span>
          <span class="bcvw">${esc(String(v.updated_at ?? v.created_at ?? '').slice(0, 10))}${v.produced_by ? ` · ${esc(String(v.produced_by))}` : ''}</span>
          ${
            v.is_current
              ? '<span class="bcvcur">current</span>'
              : v.is_pending
                ? `<button type="button" class="bcversionbtn" data-bc-docapprove="${esc(String(v.document_id))}" title="Makes this the current version. The approved version is kept in the history.">Approve this version</button>`
                : v.can_roll_back_to === false || v.version === null || v.version === undefined
                  ? ''
                  : `<button type="button" class="bcversionbtn" data-bc-docrestore="${esc(String(v.document_id))}" title="Brings this version back as a new version. Nothing is deleted.">Return to this version</button>`
          }
        </li>`,
      )
      .join('')}</ol>`
  for (const b of host.querySelectorAll('[data-bc-docapprove]')) {
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await act('document_approve', { p_document: b.dataset.bcDocapprove })
        docsrc.forgetList(ctx.state.project)
        ctx.render?.()
      } catch (e) {
        b.disabled = false
        say(b, String(e?.message ?? e), 'bad')
      }
    })
  }
  /* Bound here, after the list exists: it is drawn when the office answers, which is after the page was wired. */
  for (const b of host.querySelectorAll('[data-bc-docrestore]')) {
    b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await act('document_rollback', { p_document_id: b.dataset.bcDocrestore })
        docsrc.forgetList(ctx.state.project)
        ctx.render?.()
      } catch (e) {
        b.disabled = false
        say(b, String(e?.message ?? e), 'bad')
      }
    })
  }
}

/*
  USE THIS REPORT'S STYLE FOR THE PROJECT (0970).

  Drawn only for a report the office made that has a record of how it was made (the gateway answers has_provenance).
  Nothing is read out of the PDF: the office kept the style the report was set in, and this copies it into the
  project's own style. It asks before replacing a style the project already has, and a report made before the style was
  recorded says so on the press and changes nothing.
*/
const paintStyle = async (host, ctx) => {
  const id = host.dataset.bcDocstyle ?? ''
  const slug = host.dataset.bcDocproject ?? ''
  if (id === '' || slug === '') return
  let prov = null
  try {
    prov = await read('document_provenance', id)
  } catch {
    return
  }
  if (prov?.has_provenance !== true) return
  host.hidden = false
  host.innerHTML = `<h2 class="bcsubhead">Style</h2>
    <p class="bcpmeta">${
      prov.has_style_snapshot === true
        ? 'The style this report was set in was kept. You can make it the style for new reports in this project.'
        : 'This report was made before its style was recorded, so there is no style to keep from it.'
    }</p>
    <div class="bcrow bcdocacts"><button type="button" class="bcversionbtn" data-bc-docstyleuse>Use this report's style for the project</button></div>
    <div class="bcdocstyleask" data-bc-docstyleask hidden></div>
    <p class="bcpmeta" role="status" data-bc-docstylesay></p>`
  const sayStyle = (text, tone = '') => {
    const el = host.querySelector('[data-bc-docstylesay]')
    el.textContent = text
    el.dataset.tone = tone
  }
  const ask = host.querySelector('[data-bc-docstyleask]')
  const use = host.querySelector('[data-bc-docstyleuse]')
  const press = async (confirm) => {
    use.disabled = true
    ask.hidden = true
    sayStyle('Saving the style…')
    try {
      const out = await act('style_adopt_from_document', {
        p_slug: slug,
        p_document: id,
        ...(confirm ? { p_confirm: true } : {}),
      })
      if (out?.needs_confirmation === true) {
        sayStyle('')
        ask.hidden = false
        ask.innerHTML = `<p class="bcpmeta">${esc(out.message ?? 'This project already has a style of its own. Saving this one replaces it.')}</p>
          <div class="bcrow bcdocacts">
            <button type="button" class="bcversionbtn" data-bc-docstylereplace>Replace the project style</button>
            <button type="button" class="bcversionbtn" data-bc-docstylekeep>Keep the current style</button>
          </div>`
        ask.querySelector('[data-bc-docstylereplace]').addEventListener('click', () => void press(true))
        ask.querySelector('[data-bc-docstylekeep]').addEventListener('click', () => {
          ask.hidden = true
          use.disabled = false
          sayStyle('Nothing was changed.')
        })
        ask.querySelector('[data-bc-docstylekeep]').focus()
        return
      }
      const dropped = Array.isArray(out?.dropped) && out.dropped.includes('logo_document_id')
      sayStyle(
        out?.unchanged === true
          ? 'This project already has exactly this style.'
          : `Done. New reports in this project use this report's style.${dropped ? ' Its logo is not one this project holds, so the logo was left out.' : ''}`,
        'good',
      )
      use.disabled = false
    } catch (e) {
      use.disabled = false
      sayStyle(String(e?.message ?? e), 'bad')
    }
  }
  use.addEventListener('click', () => void press(false))
}

export const wire = (root, ctx, fileFor) => {
  /* --- the preview, and the versions beside it */
  for (const host of root.querySelectorAll('[data-bc-docpreview]')) void paintPreview(host, fileFor)
  for (const host of root.querySelectorAll('[data-bc-docversions]')) void paintVersions(host, ctx)
  for (const host of root.querySelectorAll('[data-bc-docstyle]')) void paintStyle(host, ctx)

  /* --- import: only ever on a press */
  for (const b of root.querySelectorAll('[data-bc-docimport]')) {
    b.addEventListener('click', async () => {
      const id = b.dataset.bcDocimport
      b.disabled = true
      say(b, 'Importing a copy into Team HQ…')
      try {
        const out = await act('document_import', { p_document_id: id })
        docsrc.forgetList(ctx.state.project)
        if (out?.state === 'pending') say(b, out.note ?? 'Requested. The copy is made the next time the office reads this file.', 'good')
        else say(b, 'Done. A durable copy is now kept in Team HQ, whatever happens to the original.', 'good')
        b.remove()
        ctx.render?.()
      } catch (e) {
        b.disabled = false
        say(b, String(e?.message ?? e), 'bad')
      }
    })
  }
  /* --- the filter bar on the document list */
  const slug = ctx.state.project
  for (const b of root.querySelectorAll('[data-bc-docsrc]')) {
    b.addEventListener('click', () => {
      docsrc.setFilter(slug, { source: b.dataset.bcDocsrc })
      ctx.render()
    })
  }
  for (const s of root.querySelectorAll('[data-bc-doctype]')) {
    s.addEventListener('change', () => {
      docsrc.setFilter(slug, { type: s.value })
      ctx.render()
    })
  }
  for (const b of root.querySelectorAll('[data-bc-docclear]')) {
    b.addEventListener('click', () => {
      docsrc.setFilter(slug, { source: 'all', type: 'all', q: '' })
      ctx.render()
    })
  }
  /*
    SEARCH FILTERS IN PLACE. Redrawing on every keystroke would replace the
    input being typed into and take the caret with it, so the rows are hidden
    and shown where they are, and the query is remembered for the next draw.
  */
  for (const q of root.querySelectorAll('[data-bc-docq]')) {
    const apply = () => {
      docsrc.setFilter(slug, { q: q.value })
      const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
      let shown = 0
      for (const el of root.querySelectorAll('[data-bc-doc][data-bc-dochay]')) {
        const hay = el.dataset.bcDochay ?? ''
        const ok = words.every((w) => hay.includes(w))
        el.hidden = !ok
        if (ok) shown += 1
      }
      const none = root.querySelector('[data-bc-docnone]')
      if (none !== null) none.hidden = shown > 0
    }
    q.addEventListener('input', apply)
    if (q.value !== '') apply()
  }
}
