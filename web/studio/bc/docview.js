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
  host.innerHTML = `<h2 class="bcsubhead">Versions</h2>
    <ol class="bcversions" reversed>${versions
      .slice()
      .sort((a, b) => b.version - a.version)
      .map(
        (v) => `<li class="bcversion${v.is_current ? ' is-current' : ''}">
          <span class="bcvn">v${esc(String(v.version))}</span>
          <span class="bcvw">${esc(String(v.updated_at ?? v.created_at ?? '').slice(0, 10))}${v.produced_by ? ` · ${esc(String(v.produced_by))}` : ''}</span>
          ${v.is_current ? '<span class="bcvcur">current</span>' : `<button type="button" class="bcversionbtn" data-bc-docrestore="${esc(String(v.document_id))}" title="Brings this version back as a new version. Nothing is deleted.">Return to this version</button>`}
        </li>`,
      )
      .join('')}</ol>`
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

export const wire = (root, ctx, fileFor) => {
  /* --- the preview, and the versions beside it */
  for (const host of root.querySelectorAll('[data-bc-docpreview]')) void paintPreview(host, fileFor)
  for (const host of root.querySelectorAll('[data-bc-docversions]')) void paintVersions(host, ctx)

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
