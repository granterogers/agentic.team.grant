/**
 * Writing to Notion.
 *
 * ## Why this did not exist
 *
 * Grant asked the Chief of Staff to populate a Notion teamspace from a
 * notebook, and she answered: *"I can't actually create the pages or upload
 * files, but I can give you the structure and content so you can add them
 * quickly."*
 *
 * That one turned out to be **true**. The connector is enabled, the token
 * works, `verify:notion` passes twelve live checks — and every one of them is a
 * READ. `syncNotion` pulls pages in; nothing has ever pushed one out, and
 * `tool_permissions` had no `notion.write` row at all. She was not being
 * defeatist; she was describing the system accurately, which is the outcome the
 * capability guard was built to get.
 *
 * So the blocker was never the wiring or the prompt. It was a missing verb.
 *
 * ## Markdown in, blocks out
 *
 * Notion does not store documents as text. A page is a list of typed blocks,
 * each holding `rich_text` runs, and a model writing prose produces markdown.
 * Something has to translate, and doing it at the boundary — here — means every
 * caller writes markdown and none of them learns Notion's shapes.
 *
 * Grant: *"Write the documents up properly in Notion format so they are easy to
 * read there. Structured pages, not dumps of source text."* A page made of one
 * enormous paragraph block is exactly the dump he does not want, so headings,
 * lists, quotes, code and dividers all survive the crossing.
 *
 * ## The limits are real and silent
 *
 * Notion enforces 2,000 characters per rich-text run and 100 blocks per
 * request, and it does not gently truncate — it rejects the call. Both are
 * handled here rather than left to each caller to rediscover: long text is
 * split across blocks on a word boundary, and a long page is created with its
 * first hundred blocks and the rest appended in batches.
 */

import type { NotionClient } from './api.ts'

/** The block shapes this writes. Enough for a document; not all of Notion. */
type BlockType =
  | 'paragraph'
  | 'heading_1'
  | 'heading_2'
  | 'heading_3'
  | 'bulleted_list_item'
  | 'numbered_list_item'
  | 'quote'
  | 'code'
  | 'divider'
  | 'to_do'

export interface OutBlock {
  readonly object: 'block'
  readonly type: BlockType
  readonly [key: string]: unknown
}

/** Notion's ceiling on one rich-text run. Exceeding it is a 400, not a trim. */
const MAX_RUN = 2_000
/** Notion's ceiling on `children` in one request. Same — a rejection, not a trim. */
export const MAX_BLOCKS_PER_REQUEST = 100

/**
 * One string as rich-text runs, split where a reader would not notice.
 *
 * Split on the last space inside the limit rather than at exactly 2,000
 * characters, because a break mid-word is visible and a break at a space is
 * not. A single unbroken 2,000-character token is split hard — there is
 * nowhere better, and refusing to write it would be worse.
 */
export const richText = (text: string): { type: 'text'; text: { content: string } }[] => {
  const runs: { type: 'text'; text: { content: string } }[] = []
  let rest = text
  while (rest.length > MAX_RUN) {
    const cut = rest.lastIndexOf(' ', MAX_RUN)
    const at = cut > MAX_RUN * 0.6 ? cut : MAX_RUN
    runs.push({ type: 'text', text: { content: rest.slice(0, at) } })
    rest = rest.slice(at).trimStart()
  }
  if (rest !== '') runs.push({ type: 'text', text: { content: rest } })
  // An empty paragraph is legal and is how blank space is made.
  return runs.length === 0 ? [{ type: 'text', text: { content: '' } }] : runs
}

const block = (type: BlockType, text: string, extra: Record<string, unknown> = {}): OutBlock =>
  ({
    object: 'block',
    type,
    [type]: { rich_text: richText(text), ...extra },
  }) as OutBlock

/**
 * Markdown to Notion blocks.
 *
 * Deliberately a small, predictable subset rather than a full parser. Every
 * shape here is one a model reliably produces and a reader visibly benefits
 * from; anything unrecognised stays a paragraph, which is the safe direction —
 * an unstyled line reads fine, and a mis-parsed one loses its content.
 *
 * Inline emphasis is NOT parsed. Notion carries bold and italic as annotations
 * on runs rather than as characters, so honouring `**this**` means tokenising
 * every line, and getting that subtly wrong scatters asterisks through his
 * documents. Block structure is where the readability actually is.
 */
export function toBlocks(markdown: string): OutBlock[] {
  const out: OutBlock[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let fence: { lang: string; body: string[] } | null = null

  for (const line of lines) {
    const fenced = /^```(\w*)\s*$/.exec(line)
    if (fenced !== null) {
      if (fence === null) {
        fence = { lang: fenced[1] ?? '', body: [] }
      } else {
        out.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: richText(fence.body.join('\n')),
            // Notion rejects an unknown language outright, and "plain text" is
            // always accepted.
            language: KNOWN_LANGUAGES.has(fence.lang) ? fence.lang : 'plain text',
          },
        } as OutBlock)
        fence = null
      }
      continue
    }
    if (fence !== null) {
      fence.body.push(line)
      continue
    }

    const trimmed = line.trim()
    if (trimmed === '') continue
    if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
      out.push({ object: 'block', type: 'divider', divider: {} } as OutBlock)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading !== null) {
      // Notion stops at three levels. A markdown h4 becomes an h3 rather than
      // a paragraph: losing one level of hierarchy is better than losing the
      // fact that it is a heading at all.
      const depth = Math.min(3, (heading[1] ?? '#').length)
      out.push(block(`heading_${String(depth)}` as BlockType, heading[2] ?? ''))
      continue
    }

    const todo = /^[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(trimmed)
    if (todo !== null) {
      out.push(block('to_do', todo[2] ?? '', { checked: (todo[1] ?? ' ').toLowerCase() === 'x' }))
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
    if (bullet !== null) {
      out.push(block('bulleted_list_item', bullet[1] ?? ''))
      continue
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (numbered !== null) {
      out.push(block('numbered_list_item', numbered[1] ?? ''))
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote !== null) {
      out.push(block('quote', quote[1] ?? ''))
      continue
    }
    out.push(block('paragraph', trimmed))
  }

  // An unterminated fence is a model forgetting to close it, and its content is
  // still worth keeping.
  if (fence !== null) {
    out.push({
      object: 'block',
      type: 'code',
      code: { rich_text: richText(fence.body.join('\n')), language: 'plain text' },
    } as OutBlock)
  }
  return out
}

const KNOWN_LANGUAGES = new Set([
  'bash',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'markdown',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'typescript',
  'yaml',
])

export interface NewPage {
  /**
   * Where the page goes.
   *
   * `dataSource` is the current shape: from 2025-09-03 a database is a
   * container and the queryable thing inside it — the thing a row belongs to —
   * is a data source. `database` is kept for a workspace still on the old
   * model, and `page` nests one page under another.
   */
  readonly parent: {
    readonly dataSource?: string
    readonly database?: string
    readonly page?: string
  }
  readonly title: string
  /** Markdown. Converted here so no caller has to know Notion's shapes. */
  readonly body?: string
  /**
   * Extra database properties, already in Notion's shape.
   *
   * Not abstracted: property types are per-database and inventing a mapping
   * would mean guessing at a schema this module cannot see.
   */
  readonly properties?: Record<string, unknown>
  /** The database's title property. Notion names it per database. */
  readonly titleProperty?: string
}

export interface WrittenPage {
  readonly id: string
  readonly url: string
  readonly blocks: number
}

/**
 * Create a page, with as much of its body as Notion will take in one call.
 *
 * The rest is appended. A 300-block document is three requests and the caller
 * should not have to know that — nor should it discover the limit by having a
 * page rejected after the first hundred blocks were already written.
 */
export async function createPage(client: NotionClient, page: NewPage): Promise<WrittenPage> {
  const blocks = page.body === undefined ? [] : toBlocks(page.body)
  // A page nested under a page uses `title`; a row in a database uses whatever
  // that database calls its title property. `structure.schemaOf` reads the real
  // name, and 'Name' is only the fallback when nobody looked.
  const titleKey =
    page.titleProperty ??
    (page.parent.dataSource === undefined && page.parent.database === undefined ? 'title' : 'Name')

  const parent =
    page.parent.dataSource !== undefined
      ? { data_source_id: page.parent.dataSource }
      : page.parent.database !== undefined
        ? { database_id: page.parent.database }
        : { page_id: String(page.parent.page) }

  const created = await client.call('/pages', {
    method: 'POST',
    body: {
      parent,
      properties: {
        [titleKey]: { title: [{ type: 'text', text: { content: page.title.slice(0, 2_000) } }] },
        ...(page.properties ?? {}),
      },
      children: blocks.slice(0, MAX_BLOCKS_PER_REQUEST),
    },
  })

  const id = String(created.id ?? '')
  if (id !== '' && blocks.length > MAX_BLOCKS_PER_REQUEST) {
    await appendBlocks(client, id, blocks.slice(MAX_BLOCKS_PER_REQUEST))
  }
  return { id, url: String(created.url ?? ''), blocks: blocks.length }
}

/** Add blocks to an existing page, in batches Notion will accept. */
export async function appendBlocks(
  client: NotionClient,
  pageId: string,
  blocks: readonly OutBlock[],
): Promise<number> {
  for (let at = 0; at < blocks.length; at += MAX_BLOCKS_PER_REQUEST) {
    await client.call(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: blocks.slice(at, at + MAX_BLOCKS_PER_REQUEST) },
    })
  }
  return blocks.length
}

/** Change properties on an existing page — a status, a relation, a date. */
export async function updatePage(
  client: NotionClient,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await client.call(`/pages/${pageId}`, { method: 'PATCH', body: { properties } })
}

/**
 * Move a page to the trash.
 *
 * `in_trash`, not `archived`. At 2026-03-11 Notion rejects the old property
 * outright — *"body.archived should be not present"* — rather than ignoring it,
 * so an archive written the 2022 way fails loudly. Confirmed against the live
 * API before this was written.
 *
 * Reversible, and deliberately the strongest thing this module can do. §13 puts
 * destruction in the highest tier and Notion has no hard delete over the API
 * anyway, so the worst a mistake here can be is a page Grant restores.
 */
export async function archivePage(client: NotionClient, pageId: string): Promise<void> {
  await client.call(`/pages/${pageId}`, { method: 'PATCH', body: { in_trash: true } })
}

/** Put one back. The other half of a reversible operation actually being one. */
export async function restorePage(client: NotionClient, pageId: string): Promise<void> {
  await client.call(`/pages/${pageId}`, { method: 'PATCH', body: { in_trash: false } })
}

/** Archive a single block — a paragraph, an image — rather than a whole page. */
export async function archiveBlock(client: NotionClient, blockId: string): Promise<void> {
  await client.call(`/blocks/${blockId}`, { method: 'PATCH', body: { archived: true } })
}

/**
 * Rewrite one block's text, keeping the block.
 *
 * Distinct from archiving and re-appending, which loses the block's position
 * and any children under it. A correction to a paragraph should stay where the
 * paragraph was.
 */
export async function updateBlock(
  client: NotionClient,
  blockId: string,
  type: string,
  text: string,
): Promise<void> {
  await client.call(`/blocks/${blockId}`, {
    method: 'PATCH',
    body: { [type]: { rich_text: richText(text) } },
  })
}

/**
 * Point one page's relation property at others.
 *
 * The join that makes a curriculum navigable rather than a pile of pages: a
 * Task belongs to a Project, a Doc supports a Project. Notion stores it as a
 * list of page ids on a property whose name is per-database, which is why the
 * property has to be named by the caller and is worth reading from the schema
 * rather than guessing.
 *
 * Replaces rather than appends, because that is what the API does and pretending
 * otherwise would make "set the relation" mean two things.
 */
export async function relate(
  client: NotionClient,
  pageId: string,
  property: string,
  relatedPageIds: readonly string[],
): Promise<void> {
  await client.call(`/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: { [property]: { relation: relatedPageIds.map((id) => ({ id })) } } },
  })
}

/**
 * Create it, unless it is already there.
 *
 * Grant: *"Avoid duplicate creation when rerunning an import."* An import gets
 * rerun — it failed halfway, or he asked again — and the failure mode of not
 * handling that is two of everything in his workspace, which is tedious to undo
 * by hand.
 *
 * Matched on title within the target data source, because that is the one
 * property every data source has. Returns the existing page untouched rather
 * than updating it: a rerun should be safe, and "safe" means it does not
 * silently overwrite something he edited in between.
 */
export async function createPageIfAbsent(
  client: NotionClient,
  page: NewPage & { parent: { dataSource: string } },
): Promise<WrittenPage & { existed: boolean }> {
  const { findByTitle } = await import('./structure.ts')
  const existing = await findByTitle(
    client,
    page.parent.dataSource,
    page.title,
    page.titleProperty ?? 'Name',
  )
  if (existing !== null) {
    return { id: existing.id, url: existing.url ?? '', blocks: 0, existed: true }
  }
  return { ...(await createPage(client, page)), existed: false }
}
