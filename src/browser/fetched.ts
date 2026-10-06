/**
 * Reading a page that needs no browser (#135, #16).
 *
 * ## Why this exists
 *
 * `runtimeFor` resolves two Vault entries and, finding neither, hands back
 * `UnavailableBrowserAdapter` — so today the office cannot open **any** page,
 * including a plain public one that never needed a browser in the first
 * place. The Cloudflare account is a real blocker for a site that wants a
 * login or renders itself in JavaScript. It is not a blocker for fetching
 * HTML and reading it, which is most of the reference material a project
 * actually cites.
 *
 * So this is the adapter that costs nothing and needs no credential: one
 * `fetch`, the markup stripped by the same `textOf` the Cloudflare path uses,
 * and the honest limits stated in the result rather than implied by an empty
 * one.
 *
 * ## The three things it cannot do, and says so
 *
 * **No screenshot.** `shot` is refused rather than returned null and called
 * success — a caller that asked for a picture and got `ok: true` with no
 * picture would record "gathered" for a gather that produced nothing it
 * wanted.
 *
 * **No JavaScript.** A page that renders client-side comes back as a shell,
 * and a shell read as "the page says nothing" is exactly the false absence
 * this office spends its coherence gates preventing (#257). So a suspiciously
 * thin body is reported as a limit — `ok: false` with a detail naming
 * JavaScript — and never as an answer.
 *
 * **No signing in.** Cookies are sent if the caller resolved a jar, because
 * `fetch` carries a Cookie header perfectly well; what it cannot do is
 * ESTABLISH a session, which needs a real browser driving a login form. An
 * expired jar is reported through `signedOut`, the same way the Cloudflare
 * path reports it, using the same `looksSignedOut` predicate — one definition,
 * two runtimes.
 *
 * ## Why it is not simply better than the Cloudflare one
 *
 * It is worse at everything except being free. The moment a credential
 * exists, `runtimeFor` prefers the real browser and this becomes the
 * degradation path — which, per `adapter.ts`'s own argument, is only
 * trustworthy because it is the path that runs every day until then.
 */

import {
  isPrivateHost,
  MAX_HOPS,
  type Resolver,
  readCapped,
  systemResolver,
  whyResolvesBadly as whyResolvesPrivately,
  whyShapeRefused,
} from '../net/destination.ts'
import type { BrowserAdapter, Cookie, GatherRequest, GatherResult } from './adapter.ts'
import { looksSignedOut, textOf, titleOf } from './cloudflare.ts'
import { linksOf } from './links.ts'

// The address policy is shared (src/net/destination.ts); these names are what the rest of the browser code imports.
export { isPrivateHost, MAX_HOPS, readCapped }

/**
 * When a 200 is not an answer.
 *
 * A single-page app returns a full 200 whose body is a script tag and a div,
 * and reading that as "the page is empty" would let the office report an
 * absence it never established.
 *
 * ## Short is not the same as a shell, and the first version confused them
 *
 * That version refused anything under 400 characters of text. Driven against
 * the real network it rejected **example.com** — a complete, server-rendered
 * page whose entire content is 144 characters — as *"probably draws itself in
 * JavaScript"*. A guard that refuses a perfectly good page is worse than no
 * guard: it teaches the office to distrust a runtime that was right. The unit
 * test never saw it because every fixture body was comfortably over the
 * floor.
 *
 * What actually separates them is not how little text there is but how much
 * MARKUP was shipped to produce it. A short honest page is small all over; an
 * app shell is tens of kilobytes of script wrapped around a `div`. So both
 * have to be true: little text, and a great deal of page around it.
 */
export const TOO_THIN = 400

/** Above this much markup, `TOO_THIN` text means a shell rather than a short page. */
export const SHELL_BYTES = 8_000

/**
 * Below this much text, the page is not evidence of anything at all.
 *
 * The markup-weight rule above catches a BIG shell. Driven against the real
 * network it missed a small one: `web.telegram.org` ships 1,587 bytes of HTML
 * and one script tag, renders 12 characters of text, and came back `ok: true`
 * — so the office would have reported "the page says nothing" about a page it
 * had not rendered, which is the false absence the whole guard exists to stop,
 * arriving through the door the guard left open.
 *
 * Twelve characters cannot support a claim whatever the markup around them
 * weighs, so this floor is absolute and deliberately far below the smallest
 * honest page anybody has found: example.com renders 144. The measured gap
 * between the two kinds is not close —
 *
 *     example.com                144 chars from     559 bytes   ratio 0.258
 *     iana.org/help/example     1534 chars from   6,637 bytes   ratio 0.231
 *     web.telegram.org            12 chars from   1,587 bytes   ratio 0.008
 *     vercel.com                4305 chars from 526,419 bytes   ratio 0.008
 *
 * — and 80 sits in the empty middle of it with 64 characters of margin under
 * the smallest real page. A ratio test would separate these four more sharply
 * still and is deliberately NOT used: vercel.com has the ratio of a shell and
 * 4,305 characters of perfectly real text, and refusing that would be the
 * expensive direction. A missed shell is one unhelpful answer; a false refusal
 * is every good answer about a page somebody wanted read.
 */
export const BARELY_ANYTHING = 80

export function looksLikeAShell(text: string, html: string): boolean {
  const n = text.trim().length
  return n < BARELY_ANYTHING || (n < TOO_THIN && html.length > SHELL_BYTES)
}

/** The default ceiling, well under every free runtime's. */
export const FETCH_TIMEOUT_MS = 20_000

/**
 * Why this address may not be fetched, or null when it may be.
 *
 * Extracted from the body of `gather` for one reason, and it is the whole
 * point of this function existing: **the guard has to run on every hop, not
 * only on the url the caller passed.** It did not. `fetch` was called with
 * `redirect: 'follow'`, so a perfectly ordinary public url that answers 302
 * to `http://169.254.169.254/latest/meta-data/` was chased by the runtime
 * with nothing checking the destination, and the cloud instance metadata came
 * back as `ok: true` with the credentials in `text` — which the gather
 * handler then files as a project document, because a page the office read is
 * a source.
 *
 * Proved with a fetch that models the chase: `reached private address: true`,
 * `ok: true`, 600 characters of body. It could NOT be proved end to end
 * against the real network from the build sandbox, whose egress proxy answers
 * 403 before any redirect is chased — which is a property of the sandbox and
 * not of production, where the worker fetches directly.
 *
 * One predicate, called from both places, so the first hop and the fifth are
 * judged by identical code rather than by two readings of the same rule.
 */
export function whyRefused(target: URL): string | null {
  // The page reader's named exceptions to the shared policy: plain http is allowed (a page a person cites may be
  // http), and so is any port. Everything else (userinfo, private ranges) is the shared rule.
  return whyShapeRefused(target, { allowedPorts: 'any', allowedSchemes: ['https:', 'http:'] })
}

/**
 * Whether the cookie jar may be presented to this host.
 *
 * The second half of the same defect. A jar resolved for `supplier.example.com`
 * was being sent as a header on whatever the redirect chain arrived at, so a
 * site that redirects offsite could collect Grant's session cookie for another
 * site. A jar goes to the host it was established for, or a subdomain of it,
 * and nowhere else — and because the header is set per hop rather than once,
 * coming back onto the original host later in a chain still works.
 */
export function sendsJarTo(origin: string, host: string): boolean {
  const h = host.toLowerCase()
  return h === origin || h.endsWith(`.${origin}`)
}

const cookieHeader = (cookies: readonly Cookie[] | undefined): string =>
  (cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ')

export interface FetchedBrowserDeps {
  /** Injected so a suite can drive the failure paths without a network. */
  readonly fetchImpl?: typeof fetch
  /** Resolves a name before it is fetched (src/browser/dns.ts). Defaults to the system's when the real fetch is used. */
  readonly resolve?: Resolver
}

/** A page is read at most this far. The text is cut to 200k characters later; what matters here is not buffering a 50 MB body. */
export const MAX_PAGE_BYTES = 2_000_000

export class FetchedBrowser implements BrowserAdapter {
  readonly name = 'fetched'

  private readonly fetchImpl: typeof fetch
  private readonly resolve: Resolver | undefined

  constructor(deps: FetchedBrowserDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
    // The real fetch resolves names through the system; a test that injects its own fetch has no network to ask.
    this.resolve = deps.resolve ?? (deps.fetchImpl === undefined ? systemResolver : undefined)
  }

  async gather(request: GatherRequest): Promise<GatherResult> {
    const began = Date.now()
    const done = (over: Partial<GatherResult>): GatherResult => ({
      detail: '',
      ms: Date.now() - began,
      ok: false,
      shot: null,
      signedOut: false,
      stopped: false,
      text: null,
      title: null,
      ...over,
    })

    if (request.verbs.includes('shot')) {
      return done({
        detail:
          'this runtime cannot take a screenshot: it fetches HTML and does not ' +
          'render a page. A picture needs the browser runtime (#135).',
      })
    }

    /*
      Only ever http(s), and never a private address.

      A gather url can come from a document, so it is not trusted. Without
      this, `file://` would read the worker's own filesystem and a link to
      `169.254.169.254` would read cloud instance metadata — which is the
      standard way a fetch-on-behalf-of-a-user feature becomes a credential
      leak. The Cloudflare runtime is outside our network and does not have
      this exposure; this one runs where the office runs, so it needs the
      guard the other one did not.
    */
    let target: URL
    try {
      target = new URL(request.url)
    } catch {
      return done({ detail: 'that is not a url' })
    }
    const refused = whyRefused(target)
    if (refused !== null) return done({ detail: `refused: ${refused}` })

    if (await request.stopped?.()) {
      return done({ detail: 'stopped before it started', ok: false, stopped: true })
    }

    const control = new AbortController()
    const timer = setTimeout(
      () => control.abort(),
      Math.min(request.timeoutMs ?? FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS),
    )
    const origin = target.hostname.toLowerCase()
    let status = 0
    let html = ''
    let hopUrl = target.toString()
    try {
      let hop = target
      for (let n = 0; ; n++) {
        if (n > MAX_HOPS)
          return done({ detail: `refused: more than ${String(MAX_HOPS)} redirects` })
        const named = await whyResolvesPrivately(hop.hostname, this.resolve)
        if (named !== null) return done({ detail: `refused: ${named}` })
        const response = await this.fetchImpl(hop.toString(), {
          headers: {
            accept: 'text/html,application/xhtml+xml',
            // Named honestly. A runtime that lies about what it is makes every
            // rate limit and every block impossible for a site owner to reason
            // about, and #16 is about being legible.
            'user-agent': 'AgenticTeam/1.0 (+https://ai-team-hq.vercel.app)',
            ...(sendsJarTo(origin, hop.hostname) && cookieHeader(request.cookies) !== ''
              ? { cookie: cookieHeader(request.cookies) }
              : {}),
          },
          redirect: 'manual',
          signal: control.signal,
        })
        const location =
          response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
        if (location === null) {
          status = response.status
          html = await readCapped(response, MAX_PAGE_BYTES)
          hopUrl = hop.toString()
          break
        }
        let next: URL
        try {
          next = new URL(location, hop)
        } catch {
          return done({ detail: 'the site redirected somewhere that is not a url' })
        }
        const refusal = whyRefused(next)
        if (refusal !== null) return done({ detail: `refused after a redirect: ${refusal}` })
        if (await request.stopped?.()) {
          return done({ detail: 'stopped part way through', stopped: true })
        }
        hop = next
      }
    } catch (error) {
      const why = (error as Error).name === 'AbortError' ? 'timed out' : 'could not be reached'
      return done({ detail: `the page ${why}` })
    } finally {
      clearTimeout(timer)
    }

    const text = textOf(html)
    if (looksSignedOut(status, text)) {
      return done({
        detail: `the site asked for a sign-in (http ${String(status)})`,
        signedOut: true,
        title: titleOf(html),
      })
    }
    if (status >= 400) {
      return done({ detail: `the site answered http ${String(status)}`, title: titleOf(html) })
    }
    if (looksLikeAShell(text, html)) {
      /*
        Two different sentences, because they are two different findings and a
        report line that states the wrong cause is worse than a bare one. A
        heavy shell is evidence the page draws itself in JavaScript. Eighty
        characters from a small page might be that, or a holding page, or a
        redirect stub — what can honestly be said is only that there is not
        enough here to go on.
      */
      const n = text.trim().length
      return done({
        detail:
          n < BARELY_ANYTHING
            ? `only ${String(n)} characters of text came back, which is not enough to be ` +
              'evidence of what the page says. It most likely draws itself in JavaScript, ' +
              'which this runtime does not run.'
            : `only ${String(n)} characters of text came back from ` +
              `${String(Math.round(html.length / 1024))}KB of markup, which means the page draws ` +
              'itself in JavaScript. This runtime does not run any, so nothing here is ' +
              'evidence of what the page says.',
        title: titleOf(html),
      })
    }

    return done({
      detail: `http ${String(status)}`,
      links: linksOf(html, hopUrl),
      ok: true,
      text,
      title: titleOf(html),
    })
  }
}
