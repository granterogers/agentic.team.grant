/**
 * The address guard of the page reader and the downloader (a hostile page or search result must not steer the worker at
 * its own network or at cloud metadata). The final audit found IPv6-wrapped IPv4, a trailing dot, the carrier-grade and
 * benchmarking ranges and `.local` all slipping through, and `fdic.gov` / `fcbarcelona.com` refused as if they were IPv6.
 */
import { describe, expect, it } from 'vitest'
import { isPrivateHost, whyRefused } from '../../src/browser/fetched.ts'

const host = (u: string): string => new URL(u).hostname

describe('refused', () => {
  const refused = [
    'http://127.0.0.1/',
    'http://localhost/',
    'http://localhost./',
    'http://app.localhost/',
    'http://[::1]/',
    'http://10.1.2.3/',
    'http://192.168.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://169.254.169.254/',
    'http://0.0.0.0/',
    'http://100.64.0.1/',
    'http://192.0.0.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:10.0.0.1]/',
    'http://[::127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2002:7f00:1::]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[ff02::1]/',
    'http://[::]/',
    'http://metadata.google.internal/',
    'http://metadata.google.internal./',
    'http://printer.local/',
    'http://intranet/',
  ]
  for (const u of refused) {
    it(u, () => {
      expect(isPrivateHost(host(u))).toBe(true)
      expect(whyRefused(new URL(u))).not.toBeNull()
    })
  }
  for (const u of ['file:///etc/passwd', 'ftp://example.com/', 'data:text/html,hi']) {
    it(u, () => expect(whyRefused(new URL(u))).not.toBeNull())
  }
})

describe('allowed (the control: a guard that refuses everything passes the list above)', () => {
  for (const u of [
    'https://example.com/',
    'https://fdic.gov/',
    'https://fcbarcelona.com/',
    'https://fd.example.com/',
    'https://8.8.8.8/',
    'https://1.1.1.1/',
    'https://172.15.0.1/',
    'https://172.32.0.1/',
    'https://100.63.0.1/',
    'https://[2606:4700:4700::1111]/',
    'https://[::ffff:8.8.8.8]/',
    'https://www.bbc.co.uk/news',
  ]) {
    it(u, () => {
      expect(isPrivateHost(host(u))).toBe(false)
      expect(whyRefused(new URL(u))).toBeNull()
    })
  }
})

describe('a name that resolves to a private address', () => {
  it('is refused before the request is made, on the first hop and on a redirect', async () => {
    const { FetchedBrowser } = await import('../../src/browser/fetched.ts')
    const resolve = async (h: string): Promise<string[]> =>
      h === 'rebind.example'
        ? ['127.0.0.1']
        : h === 'sneaky.example'
          ? ['93.184.216.34', '10.0.0.5']
          : ['93.184.216.34']
    const asked: string[] = []
    const fetchImpl = (async (u: string) => {
      asked.push(u)
      if (u.includes('hop.example'))
        return new Response('', { status: 302, headers: { location: 'https://rebind.example/' } })
      return new Response('<html><body>' + 'a real page '.repeat(40) + '</body></html>', {
        status: 200,
      })
    }) as unknown as typeof fetch
    const b = new FetchedBrowser({ fetchImpl, resolve })
    const req = (url: string) => ({ url, verbs: ['open', 'read'] as never, cookies: [] as never })
    expect((await b.gather(req('https://rebind.example/') as never)).detail).toContain(
      'private network',
    )
    expect((await b.gather(req('https://sneaky.example/') as never)).detail).toContain(
      'private network',
    )
    expect(asked).toEqual([])
    const r = await b.gather(req('https://hop.example/') as never)
    expect(r.ok).toBe(false)
    expect(asked).toEqual(['https://hop.example/'])
    // control: a public name resolving publicly is fetched
    expect((await b.gather(req('https://fine.example/') as never)).ok).toBe(true)
  })
})

describe('the page body is capped', () => {
  it('stops reading a body larger than the cap', async () => {
    const { readCapped } = await import('../../src/browser/fetched.ts')
    const big = new Response('x'.repeat(5_000_000))
    const text = await readCapped(big, 1_000)
    expect(text.length).toBe(1_000)
  })
})
