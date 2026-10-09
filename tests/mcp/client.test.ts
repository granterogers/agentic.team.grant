/**
 * Asking an MCP server what it offers, against a server that misbehaves (#265).
 *
 * The office had no MCP client at all — it is an MCP SERVER and things connect
 * to it — so every line of `discoverTools` is new and none of it has ever met
 * a real provider. The cases below are the ways a provider that is not
 * hostile still breaks a client: an event stream instead of JSON, a tool with
 * no name, a server that introduces itself and then refuses, four hundred
 * tools.
 *
 * Nothing here throws, and that is asserted, because this runs inside a job
 * and an exception would fail work that has nothing to do with the provider.
 */

import { describe, expect, it } from 'vitest'
import { discoverTools } from '../../src/mcp/client.ts'

const reply = (body: unknown, init: { type?: string; status?: number } = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': init.type ?? 'application/json' },
    status: init.status ?? 200,
  })

/** A server that answers `initialize` and then whatever the test says. */
const server = (
  onList: (n: number) => Response,
  onHello: Response = reply({
    jsonrpc: '2.0',
    result: {
      capabilities: {},
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'a-server', version: '9' },
    },
  }),
): typeof fetch => {
  let calls = 0
  return ((_url: string, init?: RequestInit) => {
    calls += 1
    const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
    return Promise.resolve(body.method === 'initialize' ? onHello : onList(calls))
  }) as unknown as typeof fetch
}

const tools = (list: unknown[]): Response => reply({ jsonrpc: '2.0', result: { tools: list } })

describe('discovering what a provider offers', () => {
  it('reads the tools and the server’s own name', async () => {
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() =>
        tools([
          { description: 'Look something up', inputSchema: { type: 'object' }, name: 'search' },
        ]),
      ),
    })
    expect(found.ok).toBe(true)
    expect(found.tools).toHaveLength(1)
    expect(found.tools[0]?.name).toBe('search')
    expect(found.serverName).toBe('a-server')
    expect(found.protocolVersion).toBe('2025-06-18')
  })

  it('reads an event stream, which is what most servers actually send', async () => {
    const sse = (payload: unknown): Response =>
      reply(`: ping\n\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`, {
        type: 'text/event-stream',
      })
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(
        () => sse({ jsonrpc: '2.0', result: { tools: [{ name: 'search' }] } }),
        sse({
          jsonrpc: '2.0',
          result: { protocolVersion: '2025-06-18', serverInfo: { name: 's' } },
        }),
      ),
    })
    expect(found.ok).toBe(true)
    expect(found.tools[0]?.name).toBe('search')
  })

  it('sends the bearer only when there is one', async () => {
    const seen: (string | undefined)[] = []
    const watch: typeof fetch = ((_u: string, init?: RequestInit) => {
      seen.push(((init?.headers ?? {}) as Record<string, string>).authorization)
      const body = JSON.parse(String(init?.body ?? '{}')) as { method?: string }
      return Promise.resolve(
        body.method === 'initialize'
          ? reply({ jsonrpc: '2.0', result: { serverInfo: {} } })
          : tools([]),
      )
    }) as unknown as typeof fetch

    await discoverTools('https://example.test/mcp', { bearer: 'abc', fetchImpl: watch })
    expect(seen.every((h) => h === 'Bearer abc')).toBe(true)
    seen.length = 0
    await discoverTools('https://example.test/mcp', { fetchImpl: watch })
    expect(seen.every((h) => h === undefined)).toBe(true)
  })
})

describe('and the ways a provider breaks a client', () => {
  it('CONTROL: a server that refuses to introduce itself is reported, not thrown', async () => {
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() => tools([]), reply('nope', { status: 500, type: 'text/plain' })),
    })
    expect(found.ok).toBe(false)
    expect(found.error).toContain('500')
    expect(found.tools).toEqual([])
  })

  it('CONTROL: a server that introduces itself and then refuses says so differently', async () => {
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() => reply({ error: { message: 'no tools for you' }, jsonrpc: '2.0' })),
    })
    expect(found.ok).toBe(false)
    // Remote text is not reflected: the provider's sentence reaches nobody, only the fact and a status.
    expect(found.error).not.toContain('no tools for you')
    expect(found.error).toContain('refused to list its tools')
    // It still learned who the server was, which is worth keeping.
    expect(found.serverName).toBe('a-server')
  })

  it('CONTROL: a tool with no name is dropped rather than recorded as ""', async () => {
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() => tools([{ description: 'x' }, { name: '   ' }, { name: 'real' }])),
    })
    expect(found.tools.map((t) => t.name)).toEqual(['real'])
  })

  it('CONTROL: four hundred tools are capped, and the cap is SAID', async () => {
    // A provider advertising four hundred tools is a directory or a mistake,
    // and either way the office should not write four hundred rows before a
    // person has looked. A silent truncation would be worse than the cap.
    const many = Array.from({ length: 400 }, (_, i) => ({ name: `tool_${String(i)}` }))
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() => tools(many)),
    })
    expect(found.ok).toBe(true)
    expect(found.tools).toHaveLength(200)
    expect(found.error).toContain('kept 200 of 400')
  })

  it('CONTROL: a body that is not JSON at all does not throw', async () => {
    const found = await discoverTools('https://example.test/mcp', {
      fetchImpl: server(() => reply('<html>a login page</html>', { type: 'text/html' })),
    })
    expect(found.ok).toBe(false)
    expect(found.tools).toEqual([])
  })

  it('CONTROL: a fetch that throws becomes a sentence', async () => {
    const broken: typeof fetch = (() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch
    const found = await discoverTools('https://example.test/mcp', { fetchImpl: broken })
    expect(found.ok).toBe(false)
    // The runtime's own message can carry an address or a header, so it is replaced by a fixed phrase.
    expect(found.error).not.toContain('ENOTFOUND')
    expect(found.error).toContain('could not be reached')
  })
})
