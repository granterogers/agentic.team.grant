/**
 * Evidence is retained when research contributes to a report or an answer.
 *
 * A web page the office read is a saved `documents` row. Whatever cites it must cite THAT ROW (`browser:<document_id>`),
 * not only a URL that may change or vanish, and the sources page a person reads should say where the page lives.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pageSource } from '../../src/browser/research.ts'
import { citationRef, citedSource, type Hit, sourceRefs } from '../../src/knowledge/retrieval.ts'

const ID = '22222222-2222-2222-2222-222222222222'

describe('citedSource', () => {
  it('a web page cites the saved row and carries its address in the label', () => {
    const c = citedSource({
      connector: 'browser',
      id: ID,
      origin: 'source',
      title: 'Widget prices',
      url: 'https://x.example/w',
    })
    expect(c.ref).toBe(`browser:${ID}`)
    expect(c.label).toBe('Widget prices (https://x.example/w)')
  })
  it('does not repeat an address the title already holds, and tolerates a page with no url on record', () => {
    expect(
      citedSource({
        connector: 'browser',
        id: ID,
        title: 'x.example/w https://x.example/w',
        url: 'https://x.example/w',
      }).label,
    ).toBe('x.example/w https://x.example/w')
    expect(citedSource({ connector: 'browser', id: ID, title: 'Old page', url: null }).label).toBe(
      'Old page',
    )
  })
  it('control: a document that is not a web page gets no address and keeps its own citation scheme', () => {
    expect(
      citedSource({ connector: 'notion', id: ID, title: 'A note', url: 'https://notion.so/x' }),
    ).toEqual({
      label: 'A note',
      ref: `notion:${ID}`,
    })
    expect(citedSource({ connector: null, id: ID, origin: 'made', title: 'Our report' }).ref).toBe(
      `made:${ID}`,
    )
  })
})

describe('the citation a research output carries is the one the reader counts', () => {
  it('pageSource, sourceRefs and citedSource all begin with the same browser:<id> reference', () => {
    const page = { documentId: ID, title: 'Widget prices', url: 'https://x.example/w' }
    const hit: Hit = {
      connector: 'browser',
      documentId: ID,
      excerpt: '',
      origin: 'source',
      rank: 1,
      title: 'Widget prices',
    }
    const ref = citationRef({ connector: 'browser', documentId: ID, origin: 'source' })
    expect(pageSource(page).startsWith(`${ref} `)).toBe(true)
    expect(sourceRefs([hit])[0]?.startsWith(`${ref} `)).toBe(true)
    expect(citedSource({ connector: 'browser', id: ID, title: 'Widget prices' }).ref).toBe(ref)
    // and the reader's pattern (migration 0930) is a prefix match on exactly that reference
    const sql = readFileSync(
      'migrations/0930_a_page_the_office_read_says_where_it_came_from.sql',
      'utf8',
    )
    expect(sql).toContain("e like 'browser:' || d.document_id::text || '%'")
  })
})

describe('artifact.report uses it at BOTH places that list sources (the wired call, not the name)', () => {
  const src = readFileSync('src/handlers/artifact.ts', 'utf8')
  it('maps its documents through citedSource twice, and no longer builds a citation by hand', () => {
    expect(src.match(/\)\.map\(citedSource\)/g)?.length).toBe(2)
    expect(src).not.toMatch(/citationRef\(\{ connector: d\.connector/)
  })
  it("looks up the address of the browsed pages it retrieved, inside the claimed job's office", () => {
    expect(src).toMatch(/d\.connector = 'browser' and d\.external_ref is not null/)
    expect(src).toMatch(/d\.office_id = app\.job_office\(/)
    expect(src).toMatch(/url: urls\.get\(h\.documentId\) \?\? null/)
  })
})
