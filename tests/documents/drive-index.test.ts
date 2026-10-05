import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The behaviour of background indexing is proved against a database and a fake Drive in scripts/isolated/drive-index.ts.
  These are the wired expressions that proof cannot see: that the handler cannot import or copy by construction, that it
  is registered, and that it is classed as a read. Each asserts a call, not a name.
*/
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const handler = strip(readFileSync('src/handlers/drive-index.ts', 'utf8'))
const pass = readFileSync('src/office/pass.ts', 'utf8')
const containment = readFileSync('src/jobs/containment.ts', 'utf8')

describe('HQ-DOC-026: background indexing is not import', () => {
  it('the handler imports no storage and no import function, and calls none', () => {
    expect(handler).not.toMatch(/files\/store|putFile|storage/)
    expect(handler).not.toMatch(
      /document_import|hq_document_import|document_import_fulfil|attach_file/,
    )
    expect(handler).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/)
  })

  it('it asks the database which documents are due and records every outcome', () => {
    expect(handler).toMatch(/select app\.document_index_candidates\(/)
    expect(handler).toMatch(/select app\.document_index_outcome\(/)
    expect(handler).toMatch(/select app\.document_preview_record\(/)
  })

  it('it stops when Drive pushes back instead of working through the rest', () => {
    expect(handler).toMatch(
      /PUSHBACK\.has\(described\.failure\.code\)\)\s*\{\s*tally\.stoppedEarly/,
    )
  })

  it('it is registered with the worker as a wired call and classed as a read', () => {
    expect(pass).toMatch(/^\s*driveIndexHandler\(\{ db \}\),$/m)
    expect(containment).toMatch(/'drive\.index':\s*\{\s*reach:\s*'reads'\s*\}/)
  })

  it('it never announces (an hourly sentence about indexing is the repetition Grant has asked not to get)', () => {
    expect(handler).toMatch(/announce:\s*false/)
    expect(handler).not.toMatch(/announce:\s*true/)
  })
})
