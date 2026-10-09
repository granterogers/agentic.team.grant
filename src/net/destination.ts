/**
 * The one network-destination policy for every server-side fetch whose address a person, a page or a provider chose.
 *
 * ## Why one module
 *
 * The page reader (`src/browser/fetched.ts`) had a strong guard: every hop judged, names resolved, private ranges
 * refused. The MCP client (`src/mcp/client.ts`), reachable by any signed-in person through `register_connector`, had
 * none: a bare `fetch` with the runtime's default redirect-following, and on a non-200 it copied the first 160
 * characters of the remote body into a job body that is announced to the person (and into a column the page shows).
 * Two fetchers, one rule, written once in the stronger place and never carried across: this is the class, so the rule
 * lives here and both ask it.
 *
 * ## The policy
 *
 * 1. **Shape** (`whyShapeRefused`): the scheme is on an allow-list (https; the page reader names `http:` as its one
 *    explicit exception), no userinfo, a port on the allow-list, and a host that is not private by what it SAYS:
 *    loopback, RFC1918, CGNAT, link-local (cloud metadata), 0/8, documentation and reserved ranges, multicast, IPv6
 *    loopback / ULA / link-local / site-local, IPv4 wrapped as mapped, compatible, NAT64 or 6to4, the unusual numeric
 *    IPv4 spellings (decimal, hex, octal, short), `localhost`, `.local` / `.internal` and friends, trailing dots, and
 *    any single-label name.
 * 2. **Resolution** (`whyResolvesBadly`): a name says nothing, so it is resolved before EVERY hop and refused if ANY
 *    address it resolves to is private. **It fails closed**: a resolver error, a timeout or an empty answer refuses the
 *    hop. The earlier version treated all three as "no objection", which is the wrong direction for a guard: an
 *    attacker who can make the resolver fail (or a name that only the system resolver knows, such as a hosts-file
 *    entry) reached `fetch`, which resolves again with different rules.
 * 3. **Redirects** (`guardedFetch`): followed by hand, at most `MAX_HOPS`, with 1 and 2 re-applied to each target, and
 *    a credential header is dropped the moment the chain leaves the origin it was meant for.
 * 4. **Bounded**: one deadline over the whole chain and a byte cap on whatever is read (`readCappedBytes`).
 * 5. **Quiet**: a refusal or a failure is returned as a short fixed sentence built here. Remote text is never part of it.
 *
 * ## The one thing this cannot close
 *
 * The address is checked, then `fetch` resolves the name again to connect. A resolver that answers differently the
 * second time (DNS rebinding) can still get a private address past the check. Closing it means connecting to the
 * address that was checked. Node's undici can do that with a custom `connect.lookup`, but this code also runs in the
 * Deno edge runtime where `fetch` takes no such hook (`Deno.createHttpClient` has no lookup callback), and the same
 * code path has to serve both. So the window is NARROWED (the lookup happens immediately before the connect, on every
 * hop) and not closed. An egress policy at the host (deny RFC1918 and 169.254.0.0/16 from the worker) is the only
 * complete answer and is not something this repository can assert.
 */

export type Resolver = (host: string) => Promise<readonly string[]>

/** How many redirects are followed before the chain is treated as a refusal. */
export const MAX_HOPS = 5

/** How long a name may take to resolve before the hop is refused. */
export const RESOLVE_TIMEOUT_MS = 3_000

/** The default ceiling for a whole redirect chain. */
export const GUARDED_TIMEOUT_MS = 20_000

/** A body is read at most this far unless the caller says otherwise. */
export const DEFAULT_MAX_BYTES = 2_000_000

/**
 * Is this IPv4 address (four numbers) one a public page would never live at?
 * "This network", loopback, RFC1918, carrier-grade NAT, link-local (cloud metadata), the IETF and benchmarking blocks,
 * the three documentation ranges, 6to4 relay, multicast and the reserved/broadcast range.
 */
const privateV4 = (a: number, b: number, c: number): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 0 && c === 0) ||
  (a === 192 && b === 0 && c === 2) ||
  (a === 192 && b === 88 && c === 99) ||
  (a === 192 && b === 168) ||
  (a === 198 && (b === 18 || b === 19)) ||
  (a === 198 && b === 51 && c === 100) ||
  (a === 203 && b === 0 && c === 113) ||
  a >= 224

/** The eight 16-bit groups of an IPv6 literal, or null when it is not one. */
const groupsOfV6 = (h: string): number[] | null => {
  if (!h.includes(':')) return null
  let text = h.split('%')[0] ?? h
  // A dotted tail (::ffff:1.2.3.4) is two groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (tail !== null) {
    const n = [tail[1], tail[2], tail[3], tail[4]].map(Number) as number[]
    if (n.some((x) => x > 255)) return null
    text = `${text.slice(0, tail.index)}${(((n[0] ?? 0) << 8) | (n[1] ?? 0)).toString(16)}:${(((n[2] ?? 0) << 8) | (n[3] ?? 0)).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const side = (x: string): string[] => (x === '' ? [] : x.split(':'))
  const head = side(halves[0] ?? '')
  const rest = halves.length === 2 ? side(halves[1] ?? '') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null
  const all = [
    ...head,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...rest,
  ]
  const nums = all.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN))
  return nums.length === 8 && nums.every((x) => Number.isFinite(x)) ? nums : null
}

/**
 * The four bytes of an address spelled the way `inet_aton` reads it: one to four parts, each decimal, octal
 * (leading 0) or hex (0x), the last part filling the remaining bytes. `127.1`, `0x7f.1`, `2130706433` and `0177.0.0.1`
 * are all loopback to a resolver library even though a URL parser has usually rewritten them already; a caller that
 * hands this function a raw string (a resolver's answer, a configuration value) has had no such help.
 */
const looseV4 = (h: string): [number, number, number, number] | null => {
  const parts = h.split('.')
  if (parts.length < 1 || parts.length > 4) return null
  const nums: number[] = []
  for (const p of parts) {
    let n: number
    if (/^0x[0-9a-f]*$/.test(p)) n = p === '0x' ? 0 : Number.parseInt(p.slice(2), 16)
    else if (/^0[0-7]+$/.test(p)) n = Number.parseInt(p, 8)
    else if (/^(0|[1-9]\d*)$/.test(p)) n = Number.parseInt(p, 10)
    else return null
    if (!Number.isFinite(n)) return null
    nums.push(n)
  }
  const last = nums[nums.length - 1] as number
  const lead = nums.slice(0, -1)
  if (lead.some((x) => x > 255)) return null
  if (last >= 256 ** (4 - lead.length)) return null
  let value = last
  lead.forEach((x, i) => {
    value += x * 256 ** (3 - i)
  })
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

/**
 * Loopback, link-local, private and otherwise non-public addresses and names, by shape, for IPv4 and IPv6 alike.
 *
 * Deliberately a shape rather than a list of names: the address that matters most is `169.254.169.254`, which no
 * blocklist of hostnames would catch and which answers with cloud credentials. The same address wrapped in IPv6
 * (`::ffff:a9fe:a9fe`, NAT64 `64:ff9b::`, 6to4 `2002:`) is the same address, so it is unwrapped and judged as IPv4.
 * A trailing dot (`localhost.`) names the same host, so it is removed first. A name that resolves to a private
 * address cannot be seen from the name; `whyResolvesBadly` asks the resolver for that.
 */
export function isPrivateHost(host: string): boolean {
  const h = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
  if (h === '') return true
  const v6 = groupsOfV6(h)
  if (v6 !== null) {
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = v6
    const embedded = (hi: number, lo: number): boolean => privateV4(hi >> 8, hi & 255, lo >> 8)
    if (
      v6.every((x) => x === 0) ||
      (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1)
    )
      return true
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0))
      return embedded(g6, g7)
    // ::ffff:0:a.b.c.d (SIIT) is the same wrapping with the other marker.
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0)
      return embedded(g6, g7)
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
      return embedded(g6, g7)
    // 64:ff9b:1::/48 is local-use NAT64: a translator inside somebody's network.
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true
    if (g0 === 0x2002) return embedded(g1, g2)
    // Teredo (2001::/32) embeds an address a public server has no reason to be at; documentation (2001:db8::/32).
    if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true
    // Discard-only 100::/64.
    if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true
    if ((g0 & 0xffc0) === 0xfe80) return true // link-local
    if ((g0 & 0xffc0) === 0xfec0) return true // deprecated site-local
    if ((g0 & 0xfe00) === 0xfc00) return true // unique local
    if ((g0 & 0xff00) === 0xff00) return true // multicast
    return false
  }
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (
    h.endsWith('.internal') ||
    h.endsWith('.local') ||
    h.endsWith('.localdomain') ||
    h.endsWith('.home.arpa') ||
    h.endsWith('.lan') ||
    h.endsWith('.intranet') ||
    h.endsWith('.corp') ||
    h.endsWith('.private')
  )
    return true
  const loose = looseV4(h)
  if (loose !== null) return privateV4(loose[0], loose[1], loose[2])
  // A bare single-label name (`intranet`, `printer`) can only mean something on the machine's own network.
  return !h.includes('.')
}

export interface DestinationPolicy {
  /** URL protocols that may be fetched, with the colon. Default https only. */
  readonly allowedSchemes?: readonly string[]
  /**
   * Ports that may be fetched. The scheme's default port (an empty `port`) is always allowed. Default 443 and 8443.
   * `'any'` switches the port policy off, which is what the page reader names as its own exception.
   */
  readonly allowedPorts?: readonly number[] | 'any'
}

const DEFAULT_SCHEMES: readonly string[] = ['https:']
const DEFAULT_PORTS: readonly number[] = [443, 8443]

/** Why this address may not be fetched because of what it says, or null when it may be. */
export function whyShapeRefused(target: URL, policy: DestinationPolicy = {}): string | null {
  const schemes = policy.allowedSchemes ?? DEFAULT_SCHEMES
  if (!schemes.includes(target.protocol))
    return `${target.protocol} is not a web address this may open`
  if (target.username !== '' || target.password !== '') {
    return 'an address with a user name or password in it is not allowed'
  }
  const ports = policy.allowedPorts ?? DEFAULT_PORTS
  if (ports !== 'any' && target.port !== '' && !ports.includes(Number(target.port))) {
    return `port ${target.port} is not an allowed port`
  }
  if (isPrivateHost(target.hostname)) return 'that address is inside a private network'
  return null
}

const isLiteral = (host: string): boolean => /^[\d.]+$/.test(host) || host.includes(':')

/**
 * The system resolver: Deno's where it exists, Node's otherwise.
 *
 * It THROWS when it cannot answer at all (every lookup failed) instead of returning an empty list, so the caller can
 * tell "this name has no addresses" from "I could not ask", and both refuse. A name with only an A or only an AAAA
 * record is still an answer.
 */
export const systemResolver: Resolver = async (host) => {
  const g = globalThis as {
    Deno?: { resolveDns?: (h: string, t: 'A' | 'AAAA') => Promise<string[]> }
  }
  if (typeof g.Deno?.resolveDns === 'function') {
    const resolveDns = g.Deno.resolveDns
    const both = await Promise.allSettled([resolveDns(host, 'A'), resolveDns(host, 'AAAA')])
    const found = both.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    if (found.length > 0) return found
    // Neither answered. Ask the platform's own resolver before giving up: it also reads the hosts file, which is
    // exactly the place a private name can live that a direct DNS query never sees.
  }
  const dns = await import('node:dns/promises')
  return (await dns.lookup(host, { all: true })).map((a) => a.address)
}

/**
 * Why this name must not be fetched because of where it resolves, or null.
 *
 * ANY private address in the answer refuses, and so does the absence of an answer: a resolver that throws, times out
 * or says nothing refuses the hop (fail closed). A literal address has nothing to resolve and is judged by
 * `whyShapeRefused`. `resolve === undefined` means the caller deliberately has no network (a test with an injected
 * fetch); a production caller never passes it.
 */
export async function whyResolvesBadly(
  host: string,
  resolve: Resolver | undefined,
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<string | null> {
  if (resolve === undefined) return null
  const h = host.replace(/^\[|\]$/g, '').replace(/\.+$/, '')
  if (h === '' || isLiteral(h)) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  let addresses: readonly string[] | null
  try {
    addresses = await Promise.race([
      resolve(h),
      new Promise<null>((done) => {
        timer = setTimeout(() => done(null), timeoutMs)
      }),
    ])
  } catch {
    return 'that name could not be looked up'
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  if (addresses === null) return 'looking that name up took too long'
  if (addresses.length === 0) return 'that name does not point anywhere'
  return addresses.some((a) => isPrivateHost(a))
    ? 'that name points at an address inside a private network'
    : null
}

/** The body as bytes, read at most `max`: a hostile or broken server cannot make the worker hold a gigabyte. */
export async function readCappedBytes(
  response: Response,
  max: number,
): Promise<{ readonly bytes: Uint8Array; readonly truncated: boolean }> {
  if (response.body === null) {
    const all = new Uint8Array(await response.arrayBuffer())
    return { bytes: all.subarray(0, max), truncated: all.byteLength > max }
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    if (total >= max) {
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  const bytes = new Uint8Array(Math.min(total, max))
  let at = 0
  for (const c of chunks) {
    const room = bytes.length - at
    if (room <= 0) break
    bytes.set(c.byteLength > room ? c.subarray(0, room) : c, at)
    at += Math.min(c.byteLength, room)
  }
  return { bytes, truncated }
}

/** The body as text, read at most `max` bytes. */
export async function readCapped(response: Response, max: number): Promise<string> {
  return new TextDecoder().decode((await readCappedBytes(response, max)).bytes)
}

export interface GuardedFetchDeps extends DestinationPolicy {
  readonly fetchImpl?: typeof fetch
  /**
   * Resolves a name before every hop. Defaults to the system's when the real fetch is used; a caller that injects its
   * own fetch has no network to ask and gets no DNS check unless it injects a resolver too.
   */
  readonly resolve?: Resolver
  readonly timeoutMs?: number
  readonly maxHops?: number
}

export type GuardedFetchResult =
  | {
      readonly ok: true
      readonly response: Response
      readonly finalUrl: URL
      readonly hops: number
    }
  | { readonly ok: false; readonly reason: string }

/** Headers that carry a credential: they go to the origin they were given for and nowhere a redirect leads. */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization', 'mcp-session-id']

const REDIRECTS = new Set([301, 302, 303, 307, 308])

function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !CREDENTIAL_HEADERS.includes(key.toLowerCase())),
  )
}

/**
 * Fetch an address somebody else chose, under the policy above. Never throws: every refusal and every failure is a
 * short fixed sentence in `reason`, with no remote text in it.
 *
 * The caller owns the body of a successful response and must read it through `readCapped`/`readCappedBytes`.
 */
export async function guardedFetch(
  url: string | URL,
  init: RequestInit = {},
  deps: GuardedFetchDeps = {},
): Promise<GuardedFetchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const resolve = deps.resolve ?? (deps.fetchImpl === undefined ? systemResolver : undefined)
  const maxHops = deps.maxHops ?? MAX_HOPS
  let hop: URL
  try {
    hop = new URL(url)
  } catch {
    return { ok: false, reason: 'that is not a url' }
  }
  const origin = hop.origin
  // The caller's body, method and headers are re-decided per hop below; everything else in `init` is passed through.
  const {
    body: firstBody,
    headers: firstHeaders,
    method: firstMethod,
    signal: _s,
    redirect: _r,
    ...rest
  } = init
  let method = (firstMethod ?? 'GET').toUpperCase()
  let body = firstBody
  let headers: Record<string, string> = Object.fromEntries(new Headers(firstHeaders).entries())
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), deps.timeoutMs ?? GUARDED_TIMEOUT_MS)
  let keepTimer = false
  try {
    for (let n = 0; ; n++) {
      if (n > maxHops) return { ok: false, reason: `more than ${String(maxHops)} redirects` }
      const shape = whyShapeRefused(hop, deps)
      if (shape !== null) return { ok: false, reason: `refused: ${shape}` }
      const named = await whyResolvesBadly(hop.hostname, resolve)
      if (named !== null) return { ok: false, reason: `refused: ${named}` }
      const response = await fetchImpl(hop.toString(), {
        ...rest,
        ...(body === undefined || body === null ? {} : { body }),
        headers,
        method,
        redirect: 'manual',
        signal: control.signal,
      })
      const location = REDIRECTS.has(response.status) ? response.headers.get('location') : null
      if (location === null) {
        // The deadline keeps running while the caller reads the body, so a slow drip cannot hold the worker; it must
        // not keep a process alive on its own.
        ;(timer as { unref?: () => void }).unref?.()
        keepTimer = true
        return { ok: true, finalUrl: hop, hops: n, response }
      }
      await response.body?.cancel().catch(() => undefined)
      let next: URL
      try {
        next = new URL(location, hop)
      } catch {
        return { ok: false, reason: 'the server redirected somewhere that is not a url' }
      }
      if (next.origin !== origin) headers = withoutCredentials(headers)
      // 303 always, and 301/302 after a POST, become a plain GET, as browsers do. 307 and 308 keep the request.
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && method === 'POST')
      ) {
        method = 'GET'
        body = undefined
      }
      hop = next
    }
  } catch (error) {
    return {
      ok: false,
      reason:
        (error as Error).name === 'AbortError' || (error as Error).name === 'TimeoutError'
          ? 'it did not answer in time'
          : 'it could not be reached',
    }
  } finally {
    if (!keepTimer) clearTimeout(timer)
  }
}
