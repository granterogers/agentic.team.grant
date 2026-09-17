/**
 * Recognising a request for a FILE, and reading back what the model drafted
 * (#258).
 *
 * Two guards in front of a path that spends a model call over eight documents
 * and puts a PDF in Grant's project, and they fail in opposite directions.
 *
 * `artifactRequest` must not fire on prose — a file nobody asked for is a
 * minute of compute and a document he has to delete. It must also not MISS,
 * because answering a request for a report with three paragraphs is the
 * refusal that opened this Issue.
 *
 * `readReport` must never turn a malformed reply into an empty document with a
 * handsome cover, which would pass every structural check in `validate.ts` and
 * say nothing.
 */

import { describe, expect, it } from 'vitest'
import { artifactListing, artifactRequest } from '../../src/agents/actions.ts'
import { readReport } from '../../src/handlers/artifact.ts'

describe('asking for a document', () => {
  it('reads Grant’s own sentence', () => {
    const asked = artifactRequest(
      'Read the Avatar document, research the subject properly, create a beautifully ' +
        'illustrated PDF report with the relevant information, and send it to me here.',
    )
    expect(asked).not.toBeNull()
    expect(asked?.format).toBe('pdf')
    expect(asked?.brief).toContain('Avatar document')
  })

  it('reads the short forms', () => {
    for (const said of [
      'Write me a report on where the coaching course has got to',
      'Put together a one-pager on the pricing options',
      'Produce a PDF summarising what the interviews said',
      'Draft a briefing note for the board',
    ]) {
      expect(artifactRequest(said), said).not.toBeNull()
    }
  })
})

describe('and what it must not read as one', () => {
  it('CONTROL: a question wanting prose is not a request for a file', () => {
    for (const said of [
      'Tell me where the coaching course has got to',
      'What did the interviews say about pricing?',
      'Summarise the avatar document for me',
      'Give me a quick update on the project',
    ]) {
      expect(artifactRequest(said), said).toBeNull()
    }
  })

  it('CONTROL: a bare verb with no format noun is not a request for a file', () => {
    // "write", "produce" and "draft" govern half of what he asks for, so the
    // noun has to be there. Without this every "draft an email" is a PDF.
    expect(artifactRequest('Draft the announcement email for the pricing change')).toBeNull()
    expect(artifactRequest('Write up what we decided')).toBeNull()
  })

  it('CONTROL: mentioning a report is not asking for one', () => {
    expect(artifactRequest('Did you see the report Elena sent?')).toBeNull()
    expect(artifactRequest('The report says three of the modules overlap')).toBeNull()
  })

  it('CONTROL: asking for one that already exists is a delivery, not a writing', () => {
    // Answering this by writing a SECOND report is the worst available
    // outcome: he gets a different document and has to work out which is which.
    expect(artifactRequest('Send me the report you wrote yesterday')).toBeNull()
    expect(artifactRequest('Can you send the PDF you already made to Slack as well')).toBeNull()
  })

  it('CONTROL: it and the listing matcher never both fire', () => {
    for (const said of [
      'Write me a PDF report on the coaching course',
      'Give me all the audio overviews in the notebook',
      'List the slide decks',
      'Produce a one-pager on pricing',
    ]) {
      const both = artifactRequest(said) !== null && artifactListing(said) !== null
      expect(both, said).toBe(false)
    }
  })
})

describe('reading what the model drafted', () => {
  const good = JSON.stringify({
    title: 'Where the course stands',
    blocks: [
      { kind: 'paragraph', text: 'An opening summary.', lead: true },
      { kind: 'heading', level: 1, text: 'What is done' },
      { kind: 'bullets', items: ['One', 'Two'] },
      {
        kind: 'table',
        columns: ['Module', 'State'],
        rows: [['One', 'Recorded']],
      },
      {
        kind: 'chart',
        title: 'Themes',
        bars: [
          { label: 'a', value: 3 },
          { label: 'b', value: 1 },
        ],
      },
    ],
  })

  it('keeps every block it recognises', () => {
    const read = readReport(good)
    expect(read?.title).toBe('Where the course stands')
    expect(read?.blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'heading',
      'bullets',
      'table',
      'chart',
    ])
  })

  it('survives a code fence and a preamble, because a model will send one', () => {
    expect(readReport(`Here you go:\n\n\`\`\`json\n${good}\n\`\`\``)?.blocks.length).toBe(5)
  })

  it('CONTROL: returns null rather than an empty report', () => {
    // The failure that matters. An empty report renders as a handsome cover
    // with nothing behind it and passes every structural check.
    expect(readReport('I am sorry, I cannot do that.')).toBeNull()
    expect(readReport('{"title":"A title","blocks":[]}')).toBeNull()
    expect(readReport('{"title":"","blocks":[{"kind":"paragraph","text":"x"}]}')).toBeNull()
    expect(readReport('{ not json')).toBeNull()
  })

  it('CONTROL: drops a block kind it does not know rather than guessing', () => {
    const read = readReport(
      '{"title":"T","blocks":[{"kind":"video","src":"x"},{"kind":"paragraph","text":"kept"}]}',
    )
    expect(read?.blocks).toHaveLength(1)
  })

  it('CONTROL: refuses a chart bar with no number', () => {
    // Rendering it as zero would put a chart in front of Grant asserting
    // something nobody said.
    const read = readReport(
      '{"title":"T","blocks":[{"kind":"chart","title":"C","bars":[' +
        '{"label":"a","value":"lots"},{"label":"b","value":2}]},' +
        '{"kind":"paragraph","text":"kept"}]}',
    )
    expect(read?.blocks.map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('CONTROL: refuses a one-column table and a one-bar chart', () => {
    const read = readReport(
      '{"title":"T","blocks":[{"kind":"table","columns":["Only"],"rows":[["x"]]},' +
        '{"kind":"chart","title":"C","bars":[{"label":"a","value":1}]},' +
        '{"kind":"paragraph","text":"kept"}]}',
    )
    expect(read?.blocks.map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('pads a short table row rather than dropping the row', () => {
    const read = readReport(
      '{"title":"T","blocks":[{"kind":"table","columns":["A","B","C"],"rows":[["x","y"]]}]}',
    )
    const table = read?.blocks[0]
    expect(table?.kind).toBe('table')
    if (table?.kind === 'table') expect(table.rows[0]).toEqual(['x', 'y', ''])
  })
})

describe('truncation', () => {
  it('stops at a word and says it stopped', () => {
    /*
      The first real report the office wrote ended a table cell "client
      independe". A cap that cuts mid-word is the clipped content #258 forbids,
      arriving through the guard rather than through the layout.
    */
    const long = `{"title":"T","blocks":[{"kind":"table","columns":["A","B"],"rows":[["x","${'word '.repeat(
      120,
    )}"]]}]}`
    const read = readReport(long)
    const table = read?.blocks[0]
    expect(table?.kind).toBe('table')
    if (table?.kind === 'table') {
      const cell = table.rows[0]?.[1] ?? ''
      expect(cell.endsWith('…')).toBe(true)
      expect(cell).not.toMatch(/wor…$/)
      expect(cell.slice(0, -1).trim().endsWith('word')).toBe(true)
    }
  })

  it('CONTROL: leaves anything inside the cap exactly as it was', () => {
    const read = readReport('{"title":"T","blocks":[{"kind":"paragraph","text":"short enough"}]}')
    const p = read?.blocks[0]
    if (p?.kind === 'paragraph') expect(p.text).toBe('short enough')
  })
})
