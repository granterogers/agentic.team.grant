/*
  WHAT A CONNECTION HOLDS, AS A LIST (21 October 2026).

  The Sources page shows each connection's own items: the Notion pages and databases the integration can see, and the
  NotebookLM notebooks the reader can list. Both are read HERE, with the office's own credential, and only titles and
  kinds leave the server. No token, no URL and no raw answer is returned.

  The fetch is passed in, so the parsing is tested without a network.
*/

export const NOTION_VERSION = '2026-03-11'

export interface ConnectionItem {
  readonly kind: string
  readonly title: string
  readonly id: string
}

/** A value as a record, or an empty one, so a field can be read without trusting its shape. */
const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

/** The plain text of a Notion rich-text array. */
const plain = (rich: unknown): string =>
  Array.isArray(rich)
    ? rich
        .map((t) =>
          typeof record(t).plain_text === 'string' ? (record(t).plain_text as string) : '',
        )
        .join('')
    : ''

/**
 * One Notion search result, as a title and a kind. A database keeps its title at the top; a page keeps it in its
 * `title`-typed property. A result with no readable title is still listed, with the kind alone.
 */
export const notionItem = (o: unknown): ConnectionItem | null => {
  const r = record(o)
  if (typeof r.id !== 'string') return null
  const kind = r.object === 'database' ? 'Database' : 'Page'
  const titleProp = Object.values(record(r.properties))
    .map(record)
    .find((p) => p.type === 'title')
  const title = plain(r.object === 'database' ? r.title : titleProp?.title)
  return { kind, title: title === '' ? 'Untitled' : title, id: r.id }
}

/** The Notion search's results, as items, in the order Notion gives them. */
export const notionItems = (results: unknown): ConnectionItem[] =>
  (Array.isArray(results) ? results : [])
    .map((o) => notionItem(o))
    .filter((i): i is ConnectionItem => i !== null)

/** The NotebookLM reader's notebook list, as items. A notebook without an id is not listed. */
export const notebookItems = (list: unknown): ConnectionItem[] =>
  (Array.isArray(list) ? list : []).flatMap((n) => {
    const r = record(n)
    if (typeof r.id !== 'string') return []
    const title = typeof r.title === 'string' && r.title !== '' ? r.title : 'Untitled'
    return [{ kind: 'Notebook', title, id: r.id }]
  })

/**
 * Ask Notion what the integration can see. Returns items, or a state the page can say in words. The token goes in the
 * Authorization header and nowhere else.
 */
export async function fetchNotionItems(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ state: 'ok' | 'dead' | 'degraded'; detail: string; items: ConnectionItem[] }> {
  try {
    const r = await fetchImpl('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 50 }),
      signal: AbortSignal.timeout(20000),
    })
    if (r.status === 401 || r.status === 403) {
      return {
        state: 'dead',
        detail: 'Notion refused the integration. Reconnect it in Settings.',
        items: [],
      }
    }
    if (!r.ok) {
      return { state: 'degraded', detail: 'Notion did not list its items this time.', items: [] }
    }
    const body = record(await r.json().catch(() => ({})))
    const items = notionItems(body.results)
    return {
      state: 'ok',
      detail: `${items.length} item${items.length === 1 ? '' : 's'} the integration can see`,
      items,
    }
  } catch {
    return { state: 'degraded', detail: 'Notion did not answer in time.', items: [] }
  }
}
