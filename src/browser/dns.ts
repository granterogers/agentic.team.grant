/**
 * The name-to-address half of the private-address guard.
 *
 * `isPrivateHost` judges what a URL SAYS. A hostname that resolves to a private address (`127.0.0.1.nip.io`, a
 * wildcard record pointing at 10.0.0.5, a rebinding service) says nothing, so before every hop the name is resolved and
 * every address it resolves to is judged by the same predicate.
 *
 * Honest limit: `fetch` resolves the name again when it connects, and the runtime gives no way to pin the address, so
 * a resolver that answers differently the second time (true rebinding) can still get through. This closes the static
 * case, which is every real-world one seen from a link in a page or a search result; the Cloudflare browser runtime,
 * which is outside the network, has no such exposure.
 */
import { isPrivateHost } from './fetched.ts'

export type Resolver = (host: string) => Promise<readonly string[]>

const isLiteral = (host: string): boolean => /^[\d.]+$/.test(host) || host.includes(':')

/** The system resolver: Deno's where it exists, Node's otherwise. An unavailable resolver answers nothing (never a refusal). */
export const systemResolver: Resolver = async (host) => {
  const g = globalThis as {
    Deno?: { resolveDns?: (h: string, t: 'A' | 'AAAA') => Promise<string[]> }
  }
  try {
    if (typeof g.Deno?.resolveDns === 'function') {
      const resolveDns = g.Deno.resolveDns
      const both = await Promise.all([
        resolveDns(host, 'A').catch(() => [] as string[]),
        resolveDns(host, 'AAAA').catch(() => [] as string[]),
      ])
      return both.flat()
    }
    const dns = await import('node:dns/promises')
    return (await dns.lookup(host, { all: true })).map((a) => a.address)
  } catch {
    return []
  }
}

/** Why this name must not be fetched because of where it resolves, or null. */
export async function whyResolvesPrivately(
  host: string,
  resolve: Resolver | undefined,
): Promise<string | null> {
  if (resolve === undefined) return null
  const h = host.replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (h === '' || isLiteral(h)) return null
  const addresses = await Promise.race([
    resolve(h).catch(() => [] as readonly string[]),
    new Promise<readonly string[]>((done) => setTimeout(() => done([]), 3_000)),
  ])
  return addresses.some((a) => isPrivateHost(a))
    ? 'that name points at an address inside a private network'
    : null
}
