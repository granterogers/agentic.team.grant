import { describe, expect, it } from 'vitest'
import {
  fetchNotionItems,
  notebookItems,
  notionItem,
  notionItems,
} from '../../supabase/functions/hq-api/connection-items.ts'

const page = (id: string, title: string) => ({
  object: 'page',
  id,
  properties: { Name: { type: 'title', title: [{ plain_text: title }] } },
})
const database = (id: string, title: string) => ({
  object: 'database',
  id,
  title: [{ plain_text: title }],
})

describe('what a Notion connection holds, as titles and kinds', () => {
  it('a page takes its title from its title property', () => {
    expect(notionItem(page('p1', 'Client intake'))).toEqual({
      kind: 'Page',
      title: 'Client intake',
      id: 'p1',
    })
  })

  it('a database takes its title from the top', () => {
    expect(notionItem(database('d1', 'Tasks'))).toEqual({
      kind: 'Database',
      title: 'Tasks',
      id: 'd1',
    })
  })

  it('a result with no readable title is still listed, as Untitled', () => {
    expect(notionItem({ object: 'page', id: 'p2', properties: {} })?.title).toBe('Untitled')
  })

  it('a result with no id is dropped', () => {
    expect(notionItem({ object: 'page' })).toBeNull()
    expect(notionItems([{ object: 'page' }, page('p1', 'A')])).toHaveLength(1)
  })

  it('a non-list answer is no items, not an error', () => {
    expect(notionItems(undefined)).toEqual([])
    expect(notionItems('x')).toEqual([])
  })
})

describe('what a NotebookLM connection holds', () => {
  it('lists notebooks by title, and keeps only those with an id', () => {
    expect(
      notebookItems([
        { id: 'n1', title: 'Interview corpus' },
        { title: 'no id' },
        { id: 'n2', title: '' },
      ]),
    ).toEqual([
      { kind: 'Notebook', title: 'Interview corpus', id: 'n1' },
      { kind: 'Notebook', title: 'Untitled', id: 'n2' },
    ])
  })
})

describe('the Notion call', () => {
  it('sends the token in the header only, and lists what Notion returns', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> })
      return new Response(
        JSON.stringify({ results: [page('p1', 'Intake'), database('d1', 'Tasks')] }),
        { status: 200 },
      )
    }) as typeof fetch
    const r = await fetchNotionItems('secret_abc', fake)
    expect(r.state).toBe('ok')
    expect(r.items.map((i) => i.title)).toEqual(['Intake', 'Tasks'])
    expect(r.detail).toBe('2 items the integration can see')
    expect(seen[0]?.url).toBe('https://api.notion.com/v1/search')
    expect(seen[0]?.headers.Authorization).toBe('Bearer secret_abc')
    // The token is not in what is returned.
    expect(JSON.stringify(r)).not.toContain('secret_abc')
  })

  it('a refused token says so in words, with no items', async () => {
    const fake = (async () => new Response('{}', { status: 401 })) as typeof fetch
    const r = await fetchNotionItems('t', fake)
    expect(r.state).toBe('dead')
    expect(r.items).toEqual([])
  })

  it('an answer that is not ok is degraded, not a crash', async () => {
    const fake = (async () => new Response('{}', { status: 500 })) as typeof fetch
    const r = await fetchNotionItems('t', fake)
    expect(r.state).toBe('degraded')
  })

  it('a network failure is degraded, not a crash', async () => {
    const fake = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    const r = await fetchNotionItems('t', fake)
    expect(r.state).toBe('degraded')
  })
})
