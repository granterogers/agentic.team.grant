import { describe, expect, it } from 'vitest'
import { blockText, plainText, renderBlocks, titleOf } from '../../src/notion/content.ts'

const rich = (text: string): { plain_text: string }[] => [{ plain_text: text }]

describe('plainText', () => {
  it('concatenates a rich text array', () => {
    expect(plainText([{ plain_text: 'one ' }, { plain_text: 'two' }])).toBe('one two')
  })

  // Notion returns absent properties rather than empty ones, so every one of
  // these arrives in practice. Returning '' rather than throwing is what keeps
  // one unexpected block from failing a whole page.
  it.each([undefined, null, 'a string', 42, {}])('returns empty for %s', (input) => {
    expect(plainText(input)).toBe('')
  })
})

describe('titleOf', () => {
  it('reads a database title from the top level', () => {
    expect(titleOf({ object: 'database', title: rich('Reading list') })).toBe('Reading list')
  })

  it("reads a page title from whichever property has type 'title'", () => {
    // The property's NAME is chosen by the user, so it cannot be looked up by
    // key — this is the case a `properties.Name` shortcut would get wrong on
    // every database whose title column has been renamed.
    expect(
      titleOf({
        object: 'page',
        properties: {
          Status: { type: 'select', select: { name: 'Live' } },
          'Project name': { type: 'title', title: rich('Q3 pricing') },
        },
      }),
    ).toBe('Q3 pricing')
  })

  it('returns empty rather than inventing a title', () => {
    expect(titleOf({ object: 'page', properties: {} })).toBe('')
    expect(titleOf({ object: 'page' })).toBe('')
  })
})

describe('blockText', () => {
  it.each([
    ['paragraph', 'Plain prose.', 'Plain prose.'],
    ['heading_1', 'Overview', '# Overview'],
    ['heading_2', 'Risks', '## Risks'],
    ['heading_3', 'Detail', '### Detail'],
    ['bulleted_list_item', 'A point', '- A point'],
    ['numbered_list_item', 'A point', '- A point'],
    ['to_do', 'A task', '- A task'],
    ['quote', 'Said once', '> Said once'],
  ])('renders %s with its structure intact', (type, text, expected) => {
    expect(blockText({ type, [type]: { rich_text: rich(text) } })).toBe(expected)
  })

  it('fences a code block and keeps its language', () => {
    expect(
      blockText({ type: 'code', code: { rich_text: rich('select 1'), language: 'sql' } }),
    ).toBe('```sql\nselect 1\n```')
  })

  it('joins table cells', () => {
    expect(
      blockText({ type: 'table_row', table_row: { cells: [rich('a'), rich('b'), rich('c')] } }),
    ).toBe('a | b | c')
  })

  it('renders a divider', () => {
    expect(blockText({ type: 'divider', divider: {} })).toBe('---')
  })

  // The important negative. A placeholder like `[unsupported]` is text that
  // matches searches, so a document would rank for a word Notion never
  // contained — worse than a document that is a little shorter.
  it('contributes nothing for a block type it does not know', () => {
    expect(blockText({ type: 'unsupported_widget', unsupported_widget: {} })).toBe('')
    expect(blockText({ type: 'image', image: { file: { url: 'https://x' } } })).toBe('')
    expect(blockText({})).toBe('')
  })
})

describe('renderBlocks', () => {
  it('indents nested list items and does not indent headings', () => {
    const text = renderBlocks([
      { block: { type: 'heading_2', heading_2: { rich_text: rich('Risks') } }, depth: 0 },
      {
        block: { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('One') } },
        depth: 0,
      },
      {
        block: { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rich('Nested') } },
        depth: 1,
      },
      // A heading inside a toggle is still a heading. Indenting it would
      // misrepresent the document's outline to anything reading the text.
      { block: { type: 'heading_3', heading_3: { rich_text: rich('Deep') } }, depth: 2 },
    ])
    expect(text).toBe('## Risks\n- One\n  - Nested\n### Deep')
  })

  it('drops empty blocks rather than leaving blank lines behind', () => {
    const text = renderBlocks([
      { block: { type: 'paragraph', paragraph: { rich_text: rich('One') } }, depth: 0 },
      { block: { type: 'paragraph', paragraph: { rich_text: [] } }, depth: 0 },
      { block: { type: 'image', image: {} }, depth: 0 },
      { block: { type: 'paragraph', paragraph: { rich_text: rich('Two') } }, depth: 0 },
    ])
    expect(text).toBe('One\nTwo')
  })

  it('returns empty for an empty page', () => {
    expect(renderBlocks([])).toBe('')
  })
})
