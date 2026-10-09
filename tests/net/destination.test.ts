/**
 * The shared network-destination policy (src/net/destination.ts), driven with no network: an injected resolver and an
 * injected fetch that records every address it was actually asked to open.
 *
 * What these assert is BEHAVIOUR: which addresses the fetch was reached for, and what a person would be told. Every
 * refusal has a positive control beside it (a public host, a public resolved address, a same-site redirect still
 * works), because a guard that refuses everything passes every refusal on this page.
 */
import { describe, expect, it } from 'vitest'
import { FetchedBrowser } from '../../src/browser/fetched.ts'
import { discoverTools } from '../../src/mcp/client.ts'
import {
  guardedFetch,
  isPrivateHost,
  type Resolver,
  readCapped,
  whyResolvesBadly,
  whyShapeRefused,
} from '../../src/net/destination.ts'

const shape = (u: string): string | null => whyShapeRefused(new URL(u))

describe('shape: addresses that say they are private or are not plain https', () => {
  const refused = [
    // scheme
    'http://example.com/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://example.com/',
    'data:text/plain,hi',
    // userinfo, including the host-confusion form
    'https://user:pass@example.com/',
    'https://user@example.com/',
    'https://example.com@127.0.0.1/',
    'https://example.com%40127.0.0.1@evil.example/',
    // ports
    'https://example.com:22/',
    'https://example.com:6379/',
    'https://example.com:80/',
    'https://example.com:65535/',
    // loopback, every spelling
    'https://127.0.0.1/',
    'https://127.1/',
    'https://127.0.1/',
    'https://2130706433/',
    'https://0x7f000001/',
    'https://0x7f.1/',
    'https://0177.0.0.1/',
    'https://017700000001/',
    'https://0/',
    'https://0.0.0.0/',
    'https://localhost/',
    'https://LOCALHOST/',
    'https://localhost./',
    'https://foo.localhost/',
    'https://[::1]/',
    'https://[0:0:0:0:0:0:0:1]/',
    'https://[::]/',
    // RFC1918, CGNAT, link-local and metadata
    'https://10.0.0.1/',
    'https://172.16.0.1/',
    'https://172.31.255.255/',
    'https://192.168.1.1/',
    'https://100.64.0.1/',
    'https://100.127.255.255/',
    'https://169.254.169.254/',
    'https://169.254.0.1/',
    'https://[fd00:ec2::254]/',
    'https://metadata.google.internal/',
    'https://metadata.google.internal./',
    // reserved, documentation, multicast
    'https://192.0.0.1/',
    'https://192.0.2.1/',
    'https://198.51.100.1/',
    'https://203.0.113.1/',
    'https://198.18.0.1/',
    'https://224.0.0.1/',
    'https://240.0.0.1/',
    'https://255.255.255.255/',
    // IPv6 forms of the same addresses
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:a9fe:a9fe]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[::127.0.0.1]/',
    'https://[::ffff:0:127.0.0.1]/',
    'https://[64:ff9b::7f00:1]/',
    'https://[64:ff9b::a9fe:a9fe]/',
    'https://[64:ff9b:1::1]/',
    'https://[2002:7f00:1::]/',
    'https://[2002:a9fe:a9fe::1]/',
    'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
    'https://[2001:db8::1]/',
    'https://[fe80::1]/',
    'https://[febf::1]/',
    'https://[fec0::1]/',
    'https://[fc00::1]/',
    'https://[fdff::1]/',
    'https://[ff02::1]/',
    // names that can only mean a private network
    'https://printer.local/',
    'https://nas.localdomain/',
    'https://wiki.corp/',
    'https://files.intranet/',
    'https://router.home.arpa/',
    'https://intranet/',
    'https://printer/',
  ]
  for (const u of refused) {
    it(`refuses ${u}`, () => expect(shape(u)).not.toBeNull())
  }

  const allowed = [
    'https://example.com/',
    'https://example.com:443/',
    'https://example.com:8443/mcp',
    'https://sub.example.co.uk/a/b?c=d',
    'https://8.8.8.8/',
    'https://1.1.1.1/',
    'https://172.15.0.1/',
    'https://172.32.0.1/',
    'https://100.63.255.255/',
    'https://100.128.0.1/',
    'https://169.253.1.1/',
    'https://[2606:4700:4700::1111]/',
    'https://[2001:4860:4860::8888]/',
    'https://fdic.gov/',
    'https://fcbarcelona.com/',
    // a name that merely contains a private-looking label is a public name
    'https://localhost.example.com/',
    'https://internal.example.com/',
    'https://127.0.0.1.example.com/',
  ]
  for (const u of allowed) {
    it(`CONTROL allows ${u}`, () => expect(shape(u)).toBeNull())
  }

  it('the page reader keeps its two named exceptions, plain http and any port, through the same policy', () => {
    const page = (u: string) =>
      whyShapeRefused(new URL(u), { allowedPorts: 'any', allowedSchemes: ['https:', 'http:'] })
    expect(page('http://example.com:8080/')).toBeNull()
    expect(page('http://127.0.0.1:8080/')).not.toBeNull()
    expect(page('http://user:pw@example.com/')).not.toBeNull()
    expect(page('file:///etc/passwd')).not.toBeNull()
  })

  it('judges a raw address spelled the way a resolver library reads it, with no URL parser to help', () => {
    for (const h of [
      '0x7f.1',
      '2130706433',
      '0177.0.0.1',
      '127.1',
      '0x7f000001',
      '10.1',
      '0xa9fea9fe',
    ]) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    for (const h of ['8.8.8.8', '1.1.1.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false)
  })
})

const PUBLIC = '93.184.216.34'
const answers =
  (table: Record<string, readonly string[] | Error>): Resolver =>
  async (host) => {
    const hit = table[host]
    if (hit === undefined) return []
    if (hit instanceof Error) throw hit
    return hit
  }

describe('resolution: a name says nothing, so every address it resolves to is judged', () => {
  it('CONTROL: a name that resolves to public addresses only is fine', async () => {
    expect(await whyResolvesBadly('example.com', answers({ 'example.com': [PUBLIC] }))).toBeNull()
    expect(
      await whyResolvesBadly(
        'example.com',
        answers({ 'example.com': [PUBLIC, '2606:4700::1111'] }),
      ),
    ).toBeNull()
  })

  it('refuses a name that resolves to a private address', async () => {
    const r = answers({ 'rebind.example': ['10.0.0.5'] })
    expect(await whyResolvesBadly('rebind.example', r)).not.toBeNull()
  })

  it('refuses when ANY address is private, not only the first', async () => {
    const r = answers({ 'mixed.example': [PUBLIC, '169.254.169.254'] })
    expect(await whyResolvesBadly('mixed.example', r)).not.toBeNull()
    const r2 = answers({ 'mixed.example': ['169.254.169.254', PUBLIC] })
    expect(await whyResolvesBadly('mixed.example', r2)).not.toBeNull()
  })

  it('refuses an IPv6 answer that wraps a private IPv4 address', async () => {
    const r = answers({ 'wrapped.example': ['::ffff:169.254.169.254'] })
    expect(await whyResolvesBadly('wrapped.example', r)).not.toBeNull()
  })

  it('FAILS CLOSED when the resolver throws', async () => {
    const r = answers({ 'down.example': new Error('SERVFAIL') })
    expect(await whyResolvesBadly('down.example', r)).not.toBeNull()
  })

  it('FAILS CLOSED when the resolver says nothing', async () => {
    expect(await whyResolvesBadly('nowhere.example', answers({}))).not.toBeNull()
  })

  it('FAILS CLOSED when the resolver does not answer in time', async () => {
    const slow: Resolver = () => new Promise(() => undefined)
    expect(await whyResolvesBadly('slow.example', slow, 20)).not.toBeNull()
  })

  it('a literal address is not resolved at all (the shape check judges it)', async () => {
    let asked = 0
    const r: Resolver = async () => {
      asked += 1
      return []
    }
    expect(await whyResolvesBadly('8.8.8.8', r)).toBeNull()
    expect(await whyResolvesBadly('[2606:4700::1111]', r)).toBeNull()
    expect(asked).toBe(0)
  })

  it('no resolver means the caller deliberately has no network, and only then is nothing asked', async () => {
    expect(await whyResolvesBadly('anything.example', undefined)).toBeNull()
  })
})

/** A fetch that records every address it was reached for and answers from a table. */
const network = (table: Record<string, () => Response>) => {
  const opened: string[] = []
  const seen: { url: string; init: RequestInit }[] = []
  const impl = ((url: string, init?: RequestInit) => {
    opened.push(url)
    seen.push({ init: init ?? {}, url })
    const make = table[url]
    return Promise.resolve(make === undefined ? new Response('not here', { status: 404 }) : make())
  }) as unknown as typeof fetch
  return { impl, opened, seen }
}
const go =
  (to: string): (() => Response) =>
  () =>
    new Response(null, { headers: { location: to }, status: 302 })
const page =
  (text = 'ok'): (() => Response) =>
  () =>
    new Response(text, { status: 200 })
const publicDns = answers({
  'a.example': [PUBLIC],
  'b.example': [PUBLIC],
  'c.example': [PUBLIC],
  'evil.example': ['10.9.8.7'],
  'meta.example': ['169.254.169.254'],
})

describe('guardedFetch: the whole chain, hop by hop', () => {
  it('CONTROL: a public host with a public address is fetched and the body is readable', async () => {
    const net = network({ 'https://a.example/x': page('hello') })
    const got = await guardedFetch(
      'https://a.example/x',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(true)
    if (got.ok) expect(await readCapped(got.response, 100)).toBe('hello')
    expect(net.opened).toEqual(['https://a.example/x'])
  })

  it('CONTROL: a same-site and a cross-site public redirect are followed to the end', async () => {
    const net = network({
      'https://a.example/start': go('/middle'),
      'https://a.example/middle': go('https://b.example/end'),
      'https://b.example/end': page('landed'),
    })
    const got = await guardedFetch(
      'https://a.example/start',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(true)
    if (got.ok) {
      expect(await readCapped(got.response, 100)).toBe('landed')
      expect(got.finalUrl.hostname).toBe('b.example')
      expect(got.hops).toBe(2)
    }
    expect(net.opened).toEqual([
      'https://a.example/start',
      'https://a.example/middle',
      'https://b.example/end',
    ])
  })

  it('never opens a private literal given directly', async () => {
    for (const u of [
      'https://169.254.169.254/latest/meta-data/',
      'https://127.1/',
      'https://[::1]/',
    ]) {
      const net = network({})
      const got = await guardedFetch(u, {}, { fetchImpl: net.impl, resolve: publicDns })
      expect(got.ok, u).toBe(false)
      expect(net.opened, u).toEqual([])
    }
  })

  it('never opens a name that resolves to a private address, and does not say where it pointed', async () => {
    const net = network({})
    const got = await guardedFetch(
      'https://evil.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual([])
    if (!got.ok) expect(got.reason).not.toContain('10.9.8.7')
  })

  it('refuses a redirect to a private literal on hop 1, and never opens it', async () => {
    const net = network({ 'https://a.example/': go('https://169.254.169.254/latest/meta-data/') })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/'])
  })

  it('refuses a redirect to a private literal on hop 3 after two honest ones', async () => {
    const net = network({
      'https://a.example/': go('https://b.example/'),
      'https://b.example/': go('https://c.example/'),
      'https://c.example/': go('https://[::ffff:a9fe:a9fe]/'),
    })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/', 'https://b.example/', 'https://c.example/'])
  })

  it('refuses a redirect to a NAME that resolves privately', async () => {
    const net = network({ 'https://a.example/': go('https://meta.example/creds') })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/'])
  })

  it('refuses when the resolver fails on a later hop (fail closed in the chain)', async () => {
    const flaky = answers({ 'a.example': [PUBLIC], 'b.example': new Error('SERVFAIL') })
    const net = network({ 'https://a.example/': go('https://b.example/') })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: flaky },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/'])
  })

  it('refuses a scheme downgrade by redirect', async () => {
    const net = network({ 'https://a.example/': go('http://b.example/') })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/'])
  })

  it('refuses a redirect to file: and to an address with userinfo', async () => {
    for (const to of [
      'file:///etc/passwd',
      'https://u:p@b.example/',
      'https://b.example@127.0.0.1/',
    ]) {
      const net = network({ 'https://a.example/': go(to) })
      const got = await guardedFetch(
        'https://a.example/',
        {},
        { fetchImpl: net.impl, resolve: publicDns },
      )
      expect(got.ok, to).toBe(false)
      expect(net.opened, to).toEqual(['https://a.example/'])
    }
  })

  it('refuses a port trick on the first address and on a redirect', async () => {
    const net = network({ 'https://a.example/': go('https://b.example:6379/') })
    expect(
      (
        await guardedFetch(
          'https://a.example:6379/',
          {},
          { fetchImpl: net.impl, resolve: publicDns },
        )
      ).ok,
    ).toBe(false)
    expect(
      (await guardedFetch('https://a.example/', {}, { fetchImpl: net.impl, resolve: publicDns }))
        .ok,
    ).toBe(false)
    expect(net.opened).toEqual(['https://a.example/'])
  })

  it('ends a redirect loop at the hop limit instead of the timeout', async () => {
    const net = network({
      'https://a.example/': go('https://b.example/'),
      'https://b.example/': go('https://a.example/'),
    })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    if (!got.ok) expect(got.reason).toContain('redirects')
    expect(net.opened.length).toBe(6)
  })

  it('CONTROL: exactly the limit of redirects still works', async () => {
    const net = network({
      'https://a.example/0': go('/1'),
      'https://a.example/1': go('/2'),
      'https://a.example/2': go('/3'),
      'https://a.example/3': go('/4'),
      'https://a.example/4': go('/5'),
      'https://a.example/5': page('end'),
    })
    const got = await guardedFetch(
      'https://a.example/0',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(true)
  })

  it('does not follow a redirect it was not allowed to (manual mode is what the runtime is asked for)', async () => {
    const net = network({ 'https://a.example/': page() })
    await guardedFetch('https://a.example/', {}, { fetchImpl: net.impl, resolve: publicDns })
    expect(net.seen[0]?.init.redirect).toBe('manual')
  })

  it('drops the credential when a redirect leaves the origin, keeps it on the same origin', async () => {
    const net = network({
      'https://a.example/': go('/same'),
      'https://a.example/same': go('https://b.example/other'),
      'https://b.example/other': page(),
    })
    await guardedFetch(
      'https://a.example/',
      { headers: { authorization: 'Bearer secret', 'mcp-session-id': 's1', 'x-keep': 'k' } },
      { fetchImpl: net.impl, resolve: publicDns },
    )
    const sent = (i: number) => net.seen[i]?.init.headers as Record<string, string>
    expect(sent(0).authorization).toBe('Bearer secret')
    expect(sent(1).authorization).toBe('Bearer secret')
    expect(sent(2).authorization).toBeUndefined()
    expect(sent(2)['mcp-session-id']).toBeUndefined()
    expect(sent(2)['x-keep']).toBe('k')
  })

  it('turns a 303 after a POST into a GET with no body, and keeps a 307 as it was', async () => {
    const see = network({
      'https://a.example/303': () =>
        new Response(null, { headers: { location: '/done' }, status: 303 }),
      'https://a.example/307': () =>
        new Response(null, { headers: { location: '/done' }, status: 307 }),
      'https://a.example/done': page(),
    })
    await guardedFetch(
      'https://a.example/303',
      { body: 'x', method: 'POST' },
      { fetchImpl: see.impl, resolve: publicDns },
    )
    await guardedFetch(
      'https://a.example/307',
      { body: 'x', method: 'POST' },
      { fetchImpl: see.impl, resolve: publicDns },
    )
    const last303 = see.seen[1]
    const last307 = see.seen[3]
    expect(last303?.init.method).toBe('GET')
    expect(last303?.init.body).toBeUndefined()
    expect(last307?.init.method).toBe('POST')
    expect(last307?.init.body).toBe('x')
  })

  it('reports a network failure as a fixed sentence with none of the runtime message in it', async () => {
    const boom = (() =>
      Promise.reject(new Error('connect ECONNREFUSED 10.1.2.3:443'))) as unknown as typeof fetch
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: boom, resolve: publicDns },
    )
    expect(got.ok).toBe(false)
    if (!got.ok) {
      expect(got.reason).not.toContain('10.1.2.3')
      expect(got.reason).not.toContain('ECONNREFUSED')
    }
  })

  it('caps what is read from a body that does not stop', async () => {
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(100_000).fill(65))
      },
    })
    const net = network({ 'https://a.example/': () => new Response(endless, { status: 200 }) })
    const got = await guardedFetch(
      'https://a.example/',
      {},
      { fetchImpl: net.impl, resolve: publicDns },
    )
    expect(got.ok).toBe(true)
    if (got.ok) expect((await readCapped(got.response, 250_000)).length).toBe(250_000)
  })
})

describe('the page reader shares the policy, and now fails closed too', () => {
  const body = `<html><body>${'text '.repeat(40)}</body></html>`

  it('refuses a name its resolver cannot answer for, where it used to let it through', async () => {
    const net = network({ 'https://a.example/': page(body) })
    const reader = new FetchedBrowser({
      fetchImpl: net.impl,
      resolve: answers({ 'a.example': new Error('SERVFAIL') }),
    })
    const r = await reader.gather({ url: 'https://a.example/', verbs: ['read'] })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('refused')
    expect(net.opened).toEqual([])
  })

  it('CONTROL: the same page with a working resolver is read', async () => {
    const net = network({ 'https://a.example/': page(body) })
    const reader = new FetchedBrowser({ fetchImpl: net.impl, resolve: publicDns })
    const r = await reader.gather({ url: 'https://a.example/', verbs: ['read'] })
    expect(r.ok).toBe(true)
  })
})

describe('the MCP client (register_connector -> mcp.discover) goes through the policy', () => {
  const hello = {
    jsonrpc: '2.0',
    result: { protocolVersion: '2025-06-18', serverInfo: { name: 'x' } },
  }
  const tools = { jsonrpc: '2.0', result: { tools: [{ name: 'search' }] } }
  const rpcServer = () =>
    ((_url: string, init?: RequestInit) => {
      const m = (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method
      return Promise.resolve(
        new Response(JSON.stringify(m === 'initialize' ? hello : tools), { status: 200 }),
      )
    }) as unknown as typeof fetch

  it('CONTROL: a public https endpoint is discovered', async () => {
    const found = await discoverTools('https://a.example/mcp', {
      fetchImpl: rpcServer(),
      resolve: publicDns,
    })
    expect(found.ok).toBe(true)
    expect(found.tools.map((t) => t.name)).toEqual(['search'])
  })

  it('never opens the metadata address, loopback, a private range or a private-resolving name', async () => {
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data/',
      'https://127.0.0.1/mcp',
      'https://[::ffff:7f00:1]/mcp',
      'https://10.0.0.5/mcp',
      'https://evil.example/mcp',
      'https://printer.local/mcp',
      'http://a.example/mcp',
      'https://u:p@a.example/mcp',
      'https://a.example:6379/mcp',
    ]) {
      const net = network({})
      const found = await discoverTools(endpoint, { fetchImpl: net.impl, resolve: publicDns })
      expect(found.ok, endpoint).toBe(false)
      expect(net.opened, endpoint).toEqual([])
      expect(found.error, endpoint).toContain('refused')
    }
  })

  it('refuses a public endpoint that redirects to the metadata address, and never sends the bearer there', async () => {
    const net = network({
      'https://a.example/mcp': go('https://169.254.169.254/latest/meta-data/'),
    })
    const found = await discoverTools('https://a.example/mcp', {
      bearer: 'sekrit',
      fetchImpl: net.impl,
      resolve: publicDns,
    })
    expect(found.ok).toBe(false)
    expect(net.opened).toEqual(['https://a.example/mcp'])
  })

  it('fails closed when the resolver is down', async () => {
    const net = network({})
    const found = await discoverTools('https://a.example/mcp', {
      fetchImpl: net.impl,
      resolve: answers({ 'a.example': new Error('SERVFAIL') }),
    })
    expect(found.ok).toBe(false)
    expect(net.opened).toEqual([])
  })

  it('does not reflect what a hostile server said into the error, on a non-200, in JSON-RPC or in an exception', async () => {
    const leak = 'AWS_SECRET_ACCESS_KEY=abc123 <script>alert(1)</script>'
    const non200 = network({ 'https://a.example/mcp': () => new Response(leak, { status: 500 }) })
    const a = await discoverTools('https://a.example/mcp', {
      fetchImpl: non200.impl,
      resolve: publicDns,
    })
    const rpcErr = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: -32000, message: leak }, jsonrpc: '2.0' }), {
          status: 200,
        }),
      )) as unknown as typeof fetch
    const b = await discoverTools('https://a.example/mcp', {
      fetchImpl: rpcErr,
      resolve: publicDns,
    })
    const thrown = (() => Promise.reject(new Error(leak))) as unknown as typeof fetch
    const c = await discoverTools('https://a.example/mcp', {
      fetchImpl: thrown,
      resolve: publicDns,
    })
    for (const found of [a, b, c]) {
      expect(found.ok).toBe(false)
      expect(found.error).not.toContain('AWS_SECRET')
      expect(found.error).not.toContain('script')
    }
    expect(a.error).toContain('500')
  })
})
