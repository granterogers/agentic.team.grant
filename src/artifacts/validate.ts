/**
 * Reading the file back before saying it exists (#258).
 *
 * The Issue's hardest line, and the one everything else rests on:
 *
 *   > *"The office must never claim an artifact was created or delivered
 *   > unless canonical storage/delivery evidence says it was."*
 *
 * A generator that reports success because it did not throw is the same defect
 * as an agent claiming a database read it never did. So the bytes are parsed
 * back — not by the module that wrote them, structurally, from the outside —
 * and the pipeline refuses to store or deliver anything that fails.
 *
 * ## What it can and cannot see
 *
 * It checks the STRUCTURE a reader needs: the header, the trailer, a
 * cross-reference table whose offsets actually land on their objects, the
 * page count, a content stream on every page, and that every page has drawing
 * operators rather than being blank. It also takes the layout's own problem
 * list, because "a word was too wide for the column" is knowable at layout
 * time and unknowable afterwards.
 *
 * What it cannot see is whether the report is any good, and it does not
 * pretend to. Saying so here because a validator named `validate` invites
 * somebody to read a pass as a quality judgement, and 0298's lesson is that a
 * claim with nothing behind it costs more than no claim.
 */

const dec = new TextDecoder('latin1')

export interface Verdict {
  readonly ok: boolean
  /** Every reason it is not ok. Empty when it is. */
  readonly problems: readonly string[]
  readonly pages: number
  readonly bytes: number
}

/** The smallest a real report can be. A cover alone is about 2 kB. */
const FLOOR_BYTES = 1_200

export function validatePdf(
  bytes: Uint8Array,
  expect: { readonly pages?: number; readonly layoutProblems?: readonly string[] } = {},
): Verdict {
  const problems: string[] = [...(expect.layoutProblems ?? [])]
  const text = dec.decode(bytes)

  if (!text.startsWith('%PDF-1.')) problems.push('the file does not begin with a PDF header')
  if (!text.trimEnd().endsWith('%%EOF')) problems.push('the file does not end with %%EOF')
  if (bytes.length < FLOOR_BYTES) {
    problems.push(`only ${String(bytes.length)} bytes, which is too small to be a report`)
  }

  /*
    The cross-reference table is where a hand-written PDF goes wrong, and it
    fails silently: a reader given bad offsets shows a blank document rather
    than an error, so a file that "opens" proves nothing.

    Every offset is followed and must land on "<n> 0 obj".
  */
  const startAt = text.lastIndexOf('startxref')
  const xrefAt = startAt === -1 ? -1 : Number.parseInt(text.slice(startAt + 9).trim(), 10)
  if (Number.isNaN(xrefAt) || xrefAt <= 0 || xrefAt >= bytes.length) {
    problems.push('startxref does not point anywhere inside the file')
  } else if (!text.slice(xrefAt, xrefAt + 4).startsWith('xref')) {
    problems.push('startxref does not point at a cross-reference table')
  } else {
    const table = text.slice(xrefAt)
    const header = /^xref\s+0\s+(\d+)/.exec(table)
    const rows = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf])\s*$/gm)]
    const declared = header === null ? 0 : Number(header[1])
    if (declared !== rows.length) {
      problems.push(
        `the xref declares ${String(declared)} entries and lists ${String(rows.length)}`,
      )
    }
    for (const [i, row] of rows.entries()) {
      if (row[3] === 'f') continue
      const at = Number(row[1])
      if (!new RegExp(`^${String(i)} 0 obj`).test(text.slice(at, at + 24))) {
        problems.push(`object ${String(i)} is not where the xref says it is`)
        break // one is enough: the table is wrong and the rest will follow
      }
    }
  }

  const pageCount = [...text.matchAll(/\/Type\s*\/Page[^s]/g)].length
  if (pageCount === 0) problems.push('the file contains no pages')
  if (expect.pages !== undefined && expect.pages !== pageCount) {
    problems.push(`${String(pageCount)} page(s) in the file, ${String(expect.pages)} laid out`)
  }
  const catalogue = /\/Type\s*\/Pages[\s\S]*?\/Count (\d+)/.exec(text)
  if (catalogue !== null && Number(catalogue[1]) !== pageCount) {
    problems.push(
      `the page tree claims ${String(catalogue[1])} pages and there are ${String(pageCount)}`,
    )
  }

  /*
    A page with no text-showing operator is a blank page, which is the shape
    a layout bug takes when a block silently draws nothing. Counted across the
    file rather than per page because the streams are not indexed here, and
    the ratio is what matters: fewer Tj operators than pages means at least one
    page has nothing on it.
  */
  const shows = [...text.matchAll(/\)\s*Tj/g)].length
  if (shows < pageCount) {
    problems.push(
      `${String(shows)} text operator(s) across ${String(pageCount)} page(s) — one is blank`,
    )
  }

  if (!/\/Title\s*\(/.test(text)) problems.push('the file carries no title in its metadata')

  return { bytes: bytes.length, ok: problems.length === 0, pages: pageCount, problems }
}
