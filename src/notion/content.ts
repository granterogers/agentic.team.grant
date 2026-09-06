/**
 * Notion's block tree, flattened to the plain text a model can read.
 *
 * Pure: blocks in, text out, no network. The same reason every other adapter
 * module here is pure — the shape of Notion's JSON is the part most likely to
 * surprise us, and a pure function is the part that can be tested against a
 * fixture of the real thing.
 *
 * ## What it deliberately keeps
 *
 * Headings keep their level as `#` markers and lists keep their bullets,
 * because structure is meaning: a retrieval hit inside "## Risks" says
 * something a hit in an undifferentiated wall of prose does not. Code blocks
 * keep their fences for the same reason.
 *
 * ## What it deliberately drops
 *
 * Colour, bold, links-as-markup, and every other presentational property. This
 * text exists to be searched and read by a model, and formatting noise makes
 * both worse.
 *
 * ## What it refuses to invent
 *
 * An unsupported block type contributes nothing rather than a placeholder like
 * `[unsupported]`. A placeholder is text that matches searches, and a document
 * that ranks for `unsupported` is worse than one that is a little shorter.
 */

export interface NotionBlock {
  readonly id?: string
  readonly type?: string
  readonly has_children?: boolean
  readonly [key: string]: unknown
}

interface RichText {
  readonly plain_text?: string
}

/** Notion's rich text arrays, concatenated. Empty for anything unexpected. */
export function plainText(rich: unknown): string {
  if (!Array.isArray(rich)) return ''
  return (rich as RichText[]).map((r) => r?.plain_text ?? '').join('')
}

/** The title of a page or database object, from whichever shape it uses. */
export function titleOf(object: Record<string, unknown>): string {
  // A database carries `title` at the top level; a page carries it inside
  // whichever property has type `title`, whose NAME is chosen by the user and
  // therefore cannot be looked up by key.
  const direct = plainText(object.title)
  if (direct !== '') return direct

  const properties = object.properties as Record<string, Record<string, unknown>> | undefined
  if (properties === undefined) return ''
  for (const property of Object.values(properties)) {
    if (property?.type === 'title') {
      const text = plainText(property.title)
      if (text !== '') return text
    }
  }
  return ''
}

const PREFIX: Readonly<Record<string, string>> = {
  heading_1: '# ',
  heading_2: '## ',
  heading_3: '### ',
  bulleted_list_item: '- ',
  numbered_list_item: '- ',
  to_do: '- ',
  quote: '> ',
}

/**
 * One block's own text, without its children.
 *
 * Exported so a caller can render a block in isolation, and so the mapping
 * from Notion's type names to text is testable without a tree.
 */
export function blockText(block: NotionBlock): string {
  const type = block.type
  if (typeof type !== 'string') return ''

  if (type === 'code') {
    const payload = block.code as { rich_text?: unknown; language?: string } | undefined
    const language = payload?.language ?? ''
    return `\`\`\`${language}\n${plainText(payload?.rich_text)}\n\`\`\``
  }
  if (type === 'divider') return '---'
  if (type === 'table_row') {
    const cells = (block.table_row as { cells?: unknown[] } | undefined)?.cells ?? []
    return cells.map((cell) => plainText(cell)).join(' | ')
  }

  const payload = block[type] as { rich_text?: unknown } | undefined
  const text = plainText(payload?.rich_text)
  if (text === '') return ''
  return `${PREFIX[type] ?? ''}${text}`
}

export interface RenderedBlock {
  readonly block: NotionBlock
  readonly depth: number
}

/**
 * A flattened block list, rendered.
 *
 * Depth becomes indentation for list items only. Indenting a heading because
 * it sits inside a toggle would misrepresent the document's outline.
 */
export function renderBlocks(blocks: readonly RenderedBlock[]): string {
  const lines: string[] = []
  for (const { block, depth } of blocks) {
    const text = blockText(block)
    if (text === '') continue
    const isListItem =
      block.type === 'bulleted_list_item' ||
      block.type === 'numbered_list_item' ||
      block.type === 'to_do'
    lines.push(isListItem && depth > 0 ? `${'  '.repeat(depth)}${text}` : text)
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
