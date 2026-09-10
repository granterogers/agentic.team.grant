/*
  A document's first page, drawn.

  Grant: *"try to populate the pdf, doc preview thumbnails properly so its as it
  would actually look like."*

  Until `pdf.js` renders the real thing (Issue #10 decides where that runs), a
  thumbnail has to stand in for it — and the standing-in matters, because §7's
  whole claim is that the cover IS the interface. Abstract grey rules were
  honest about being a placeholder and useless for judging a layout: they told
  you nothing about how a wall of real first pages would look.

  So this draws a plausible first page instead: a title block set from the
  document's actual name, then a body appropriate to what the document IS — a
  questionnaire has numbered items, a transcript has speaker turns, a report has
  columns and a figure. Deterministic from the title, so a document always looks
  like itself.

  It is a drawing, not a render. When real page rendering lands this is deleted,
  and the layout it was used to design will already be right.
*/

const seeded = (s) => {
  let h = 2166136261
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296 }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** A run of body lines with ragged right edges, like set text. */
function lines(rand, x, y, w, n, lh = 5.4, from = 0.72) {
  let out = ''
  for (let i = 0; i < n; i += 1) {
    const width = w * (from + rand() * (1 - from))
    out += `<rect x="${x}" y="${(y + i * lh).toFixed(1)}" width="${width.toFixed(1)}" height="1.9" rx="0.9"/>`
  }
  return out
}

/** What kind of page this is, guessed from its name. */
function shapeOf(title) {
  const t = title.toLowerCase()
  if (t.includes('questionnaire') || t.includes('assessment') || t.includes('questions')) return 'form'
  if (t.includes('zoom') || t.includes('call') || t.includes('interview sync')) return 'transcript'
  if (t.includes('one-pager') || t.includes('roadmap') || t.includes('impact')) return 'report'
  return 'prose'
}

/**
 * The page, as an inline SVG at A4 proportions.
 *
 * `--ink-3` and friends come from the theme, so a page in the dark theme is a
 * dark sheet with light type rather than a white rectangle punched in the page.
 */
export function pageSvg(title, kind) {
  const rand = seeded(title)
  const W = 210, H = 280           // A4, in units
  const M = 22                     // margin
  const inner = W - M * 2
  const shape = shapeOf(title)
  const words = title.replace(/\.(pdf|docx?|txt)$/i, '')

  /*
    The title, broken on WORDS.

    The first version cut at a fixed character count and produced "Grant Rogers
    Avatar Do / cument" — which is exactly the kind of thing that looks like a
    rendering fault rather than a design, and exactly the kind of thing you only
    see by looking at the picture.
  */
  const wrapped = []
  let line = ''
  for (const word of words.split(' ')) {
    if ((line + ' ' + word).trim().length > 24 && line !== '') { wrapped.push(line); line = word }
    else line = (line + ' ' + word).trim()
    if (wrapped.length === 2) break
  }
  if (line !== '' && wrapped.length < 3) wrapped.push(line)

  let body = `<rect x="${M}" y="${M}" width="34" height="2.4" rx="1.2" class="accent"/>`
  wrapped.forEach((l, i) => {
    body += `<text x="${M}" y="${M + 20 + i * 14}" class="ttl">${esc(l)}</text>`
  })
  const titleBottom = M + 20 + (wrapped.length - 1) * 14
  body += `<rect x="${M}" y="${titleBottom + 10}" width="${inner * 0.34}" height="1.6" rx="0.8" class="dim"/>`
  let y = titleBottom + 22

  if (shape === 'form') {
    // Numbered items with a ruled answer space under each — a questionnaire.
    for (let i = 0; i < 6; i += 1) {
      body += `<circle cx="${M + 2.5}" cy="${y + 1}" r="2.4" class="dim"/>`
      body += lines(rand, M + 9, y - 1, inner - 9, 1, 5.4, 0.55)
      body += `<rect x="${M + 9}" y="${y + 7}" width="${inner - 9}" height="0.8" rx="0.4" class="faint"/>`
      body += `<rect x="${M + 9}" y="${y + 14}" width="${inner - 9}" height="0.8" rx="0.4" class="faint"/>`
      y += 26
    }
  } else if (shape === 'transcript') {
    // Speaker turns: a short name, then an indented paragraph.
    for (let i = 0; i < 7; i += 1) {
      body += `<rect x="${M}" y="${y}" width="${18 + rand() * 12}" height="2" rx="1" class="accent"/>`
      body += lines(rand, M + 2, y + 7, inner - 2, 2 + Math.floor(rand() * 2))
      y += 15 + Math.floor(rand() * 2) * 5.4
      if (y > H - 30) break
    }
  } else if (shape === 'report') {
    // A figure, then two columns — the shape of a one-pager.
    body += `<rect x="${M}" y="${y}" width="${inner}" height="46" rx="2" class="faint"/>`
    const bars = 5
    for (let i = 0; i < bars; i += 1) {
      const bh = 10 + rand() * 28
      body += `<rect x="${M + 8 + i * ((inner - 16) / bars)}" y="${(y + 42 - bh).toFixed(1)}"
                width="${((inner - 16) / bars - 5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1" class="accent"/>`
    }
    y += 56
    const col = (inner - 8) / 2
    body += lines(rand, M, y, col, 9)
    body += lines(rand, M + col + 8, y, col, 9)
  } else {
    // Prose: a drop of body text in one measure, with a subhead partway down.
    body += lines(rand, M, y, inner, 7)
    y += 7 * 5.4 + 8
    body += `<rect x="${M}" y="${y}" width="${inner * 0.4}" height="2.2" rx="1.1" class="accent"/>`
    body += lines(rand, M, y + 9, inner, 8)
  }

  return `<svg class="pg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
    <style>
      .pg rect { fill: var(--ink-3); opacity: .42 }
      .pg rect.accent { fill: var(--ink); opacity: .55 }
      .pg rect.dim, .pg circle.dim { fill: var(--ink-3); opacity: .3 }
      .pg rect.faint { fill: var(--ink-3); opacity: .16 }
      .pg .ttl { fill: var(--ink); opacity: .72; font: 600 11px var(--text) }
    </style>
    ${body}
  </svg>`
}
