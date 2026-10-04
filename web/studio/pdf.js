/*
  Rendering a real page.

  #23 idea 1, and the last faked thing in the document experience. `page.js`
  drew a plausible first page; this renders the actual one, which is the
  difference between a mockup of a document library and a document library.

  ## Where it runs, and why here

  In the browser, at display time. Issue #10 asked where thumbnailing should
  happen and named three candidates; this settles the prototype's half of it by
  demonstrating the cheapest one works. The server-side question is still open
  and still matters — a document uploaded through the API by an agent gets no
  thumbnail from a browser that is not running — but that is a backfill job, and
  a backfill job is easier to write once the client path is proven.

  ## Rendered once, kept

  A canvas is expensive and a first page never changes. Each render is cached by
  URL, so scrolling a gallery of twelve documents past the viewport twice costs
  twelve renders, not twenty-four. The cache is a Map rather than storage: these
  are large, and a page reload is a fine moment to forget them.

  ## Degrading

  A PDF that will not parse, a file that 404s, a browser with no worker — all
  land in the same place: the drawn page from `page.js`, which is what was there
  before and is a perfectly good cover. Nothing about a failure should be a
  broken image.
*/

let pdfjs = null
const rendered = new Map()

/** Load pdf.js once, lazily. It is 330KB and most sessions never open a PDF. */
async function library() {
  if (pdfjs !== null) return pdfjs
  pdfjs = await import('./vendor/pdf.mjs')
  // The worker keeps parsing off the main thread; without it a large document
  // freezes the interface while it decodes.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href
  return pdfjs
}

/**
 * Page one of `url`, as a data URI, at `width` CSS pixels.
 *
 * Rendered at twice the requested width because a cover is looked at closely
 * and a 1× canvas on a retina screen is visibly soft — which would undo the
 * entire point of rendering the real thing.
 */
export async function firstPage(url, width = 420) {
  const key = `${url}@${width}`
  if (rendered.has(key)) return rendered.get(key)

  const job = (async () => {
    const lib = await library()
    const doc = await lib.getDocument({ url, disableAutoFetch: true, disableStream: true }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width * 2) / base.width })

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })
    // White behind the page: a PDF has no background of its own, and without
    // this the text renders onto transparency and reads as smudge on any
    // surface that is not white.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)

    await page.render({ canvasContext: context, viewport }).promise
    doc.destroy()
    return { src: canvas.toDataURL('image/jpeg', 0.86), ratio: base.width / base.height }
  })()

  rendered.set(key, job)
  // A rejected promise left in the cache would make one bad file permanently
  // bad; drop it so a retry is possible.
  job.catch(() => rendered.delete(key))
  return job
}

/**
 * Put a real page into an element, or leave what is already there.
 *
 * Deliberately additive: the drawn page is rendered first by whoever calls
 * this, and the real one replaces it when it arrives. So the gallery is never
 * empty, never jumps, and a failure is invisible rather than broken.
 */
export async function paint(host, url, width) {
  try {
    const { src } = await firstPage(url, width)
    const img = document.createElement('img')
    img.className = 'realpage'
    img.alt = ''
    img.decoding = 'async'
    img.src = src
    // Only swap once it has actually decoded, or the drawn page disappears a
    // frame before the real one appears and the card flashes.
    await img.decode().catch(() => {})
    host.append(img)
    host.classList.add('has-real')
  } catch {
    // The drawn page stays. That is the whole fallback.
  }
}

/**
 * The first few pages of `url`, for an in-app preview.
 *
 * Same discipline as `firstPage`: rendered once and kept, a failure rejects so
 * the caller can say "no preview" rather than show a broken image. Bounded by
 * `max` because a preview is a look, not a reader - the file itself is one
 * press away - and because decoding a 400-page report to show a person its
 * cover would be a cost with nothing to show for it.
 */
export async function pages(url, width = 760, max = 6) {
  const key = `${url}@${width}x${max}`
  if (rendered.has(key)) return rendered.get(key)
  const job = (async () => {
    const lib = await library()
    const doc = await lib.getDocument({ url, disableAutoFetch: true, disableStream: true }).promise
    const total = doc.numPages
    const out = []
    for (let n = 1; n <= Math.min(total, max); n += 1) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: (width * 1.5) / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      out.push({ src: canvas.toDataURL('image/jpeg', 0.84), ratio: base.width / base.height })
    }
    doc.destroy()
    return { pages: out, total }
  })()
  rendered.set(key, job)
  job.catch(() => rendered.delete(key))
  return job
}
