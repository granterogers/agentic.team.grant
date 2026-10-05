/**
 * Which document does "the latest customer research report" mean (src/artifacts/source.ts).
 *
 * Pure ranking over the list the Documents module returns - one item per LOGICAL document - plus the phrase reader.
 * Every positive has a control beside it: the other project's document, an archived one and a superseded one are not
 * in the list this reads (the database proof drives that against real rows), and a document that matches no word is
 * never picked on recency alone.
 */
import { describe, expect, it } from 'vitest'
import {
  decide,
  rankDocuments,
  resolveSourceDocument,
  revisesEarlier,
  type SourceItem,
  sourcePhrase,
} from '../../src/artifacts/source.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const item = (id: string, title: string, over: Partial<SourceItem> = {}): SourceItem => ({
  addedAt: '2026-09-01T10:00:00Z',
  id,
  kind: 'pdf',
  mime: 'application/pdf',
  modifiedAt: '2026-09-01T10:00:00Z',
  origin: 'source',
  tags: [],
  title,
  ...over,
})

describe('resolving a named source', () => {
  it('picks the newest of equal matches when the phrase asked for the latest', () => {
    const r = decide(
      [
        item('old', 'Customer research report Q1', { modifiedAt: '2026-03-01T10:00:00Z' }),
        item('new', 'Customer research report Q3', { modifiedAt: '2026-09-20T10:00:00Z' }),
        item('mid', 'Customer research report Q2', { modifiedAt: '2026-06-01T10:00:00Z' }),
      ],
      'the latest customer research report',
    )
    expect(r.status).toBe('resolved')
    if (r.status === 'resolved') expect(r.document.id).toBe('new')
  })

  it('control: the same three WITHOUT "latest" are ambiguous - recency alone does not decide', () => {
    const r = decide(
      [
        item('old', 'Customer research report Q1', { modifiedAt: '2026-03-01T10:00:00Z' }),
        item('new', 'Customer research report Q3', { modifiedAt: '2026-09-20T10:00:00Z' }),
      ],
      'the customer research report',
    )
    expect(r.status).toBe('ambiguous')
    if (r.status === 'ambiguous')
      expect(r.candidates.map((c) => c.id).sort()).toEqual(['new', 'old'])
  })

  it('a clearly better title match wins over a newer weaker one', () => {
    const r = decide(
      [
        item('exact', 'Customer Research Report', { modifiedAt: '2026-01-01T00:00:00Z' }),
        item('weak', 'Research notes', { modifiedAt: '2026-09-30T00:00:00Z' }),
      ],
      'customer research report',
    )
    expect(r.status).toBe('resolved')
    if (r.status === 'resolved') expect(r.document.id).toBe('exact')
  })

  it('recency alone never picks a document: nothing that matches means ask, with what could be meant', () => {
    const r = decide(
      [
        item('a', 'Venue contract', { modifiedAt: '2026-09-30T00:00:00Z' }),
        item('b', 'Budget sheet'),
      ],
      'the latest customer research report',
    )
    expect(r.status).toBe('none')
    if (r.status === 'none') expect(r.candidates.length).toBeGreaterThan(0)
  })

  it('a project holding nothing is "none" with no candidates, not an error', () => {
    const r = decide([], 'the latest customer research report')
    expect(r).toEqual({ candidates: [], status: 'none' })
  })

  it('a tag counts, below a title', () => {
    const r = decide(
      [
        item('t', 'Interview synthesis', { tags: ['customer', 'research'] }),
        item('n', 'Customer research report'),
      ],
      'customer research report',
    )
    expect(r.status).toBe('resolved')
    if (r.status === 'resolved') expect(r.document.id).toBe('n')
  })

  it('prefers a readable document to a recording of the same name', () => {
    const r = decide(
      [
        item('rec', 'Customer research report walkthrough', { kind: 'audio', mime: 'audio/mpeg' }),
        item('doc', 'Customer research report'),
      ],
      'customer research report',
    )
    expect(r.status).toBe('resolved')
    if (r.status === 'resolved') expect(r.document.id).toBe('doc')
  })

  it("the office's own earlier PDF is a last resort as a source", () => {
    const [first] = rankDocuments(
      [
        item('mine', 'Customer research report', { origin: 'made' }),
        item('theirs', 'Customer research report', { origin: 'source' }),
      ],
      'customer research report',
    )
    expect(first?.id).toBe('theirs')
  })

  it('is the document, not its versions: the list holds one item per logical document', () => {
    // v1 and v2 of one report arrive as ONE item (the head). Two items with the same title would be two documents.
    const r = decide(
      [item('head', 'Customer research report')],
      'the latest customer research report',
    )
    expect(r.status).toBe('resolved')
  })

  it('reads the Documents module list and nothing else (a fake executor stands in for the database)', async () => {
    const sql: string[] = []
    const db: SqlExecutor = {
      execute: async (q: string) => {
        sql.push(q)
        return {
          rows: [
            {
              r: JSON.stringify({
                documents: [
                  {
                    added_at: '2026-09-01T00:00:00Z',
                    id: 'd1',
                    kind: 'pdf',
                    modified_at: '2026-09-02T00:00:00Z',
                    origin: 'source',
                    tags: [],
                    title: 'Customer research report',
                  },
                ],
              }),
            },
          ],
        }
      },
      kind: 'fake',
    }
    const r = await resolveSourceDocument(db, {
      office: '00000000-0000-0000-0000-000000000001',
      phrase: 'latest customer research report',
      project: 'acme',
    })
    expect(r.status).toBe('resolved')
    expect(sql).toHaveLength(1)
    expect(sql[0]).toContain('app.hq_project_documents(')
    expect(sql[0]).toContain("'acme'")
  })

  it('a refusal from the list is thrown for the caller to decide, never read as an empty project', async () => {
    const db: SqlExecutor = {
      execute: async () => ({ rows: [{ r: { error: 'no such project' } }] }),
      kind: 'fake',
    }
    await expect(
      resolveSourceDocument(db, { office: 'o', phrase: 'the report', project: 'x' }),
    ).rejects.toThrow('no such project')
  })
})

describe('naming a source in a request', () => {
  const cases: [string, string | null][] = [
    [
      'Find the latest customer research report and turn it into a beautiful PDF.',
      'the latest customer research report',
    ],
    [
      'Make a beautiful PDF of the latest customer research report',
      'the latest customer research report',
    ],
    ['Turn the Q3 customer research report into a polished PDF', 'the Q3 customer research report'],
    ['Convert the pricing analysis into a PDF', 'the pricing analysis'],
    // Topics are not sources: these keep the ordinary retrieve-and-write path.
    ['Write me a PDF report on where the course has got to', null],
    ['Make a PDF of the venue budget', null],
    ['Write a PDF report using what we hold on it', null],
  ]
  for (const [text, want] of cases) {
    it(`${text.slice(0, 60)} -> ${want ?? 'no source'}`, () => {
      expect(sourcePhrase(text)).toBe(want)
    })
  }

  it('recognises an unambiguous revision and not a question about a report', () => {
    expect(revisesEarlier('Redo the PDF with a band title')).toBe(true)
    expect(revisesEarlier('Revise the report to be shorter')).toBe(true)
    expect(revisesEarlier('Give me another version')).toBe(true)
    expect(revisesEarlier('Update me on the report')).toBe(false)
    expect(revisesEarlier('Make a PDF of the latest report')).toBe(false)
  })
})
