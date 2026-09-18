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

import type { BrowserAdapter, Cookie, GatherRequest, GatherResult } from './adapter.ts'
import { looksSignedOut, textOf, titleOf } from './cloudflare.ts'

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

export function looksLikeAShell(text: string, html: string): boolean {
  return text.trim().length < TOO_THIN && html.length > SHELL_BYTES
}

/** The default ceiling, well under every free runtime's. */
export const FETCH_TIMEOUT_MS = 20_000

const cookieHeader = (cookies: readonly Cookie[] | undefined): string =>
  (cookies ?? []).map((c) => `${c.name}=${c.value}`).join('; ')

export interface FetchedBrowserDeps {
  /** Injected so a suite can drive the failure paths without a network. */
  readonly fetchImpl?: typeof fetch
}

export class FetchedBrowser implements BrowserAdapter {
  readonly name = 'fetched'

  private readonly fetchImpl: typeof fetch

  constructor(deps: FetchedBrowserDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch
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
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return done({ detail: `refused: ${target.protocol} is not a web address` })
    }
    if (isPrivateHost(target.hostname)) {
      return done({ detail: 'refused: that address is inside a private network' })
    }

    if (await request.stopped?.()) {
      return done({ detail: 'stopped before it started', ok: false, stopped: true })
    }

    const control = new AbortController()
    const timer = setTimeout(
      () => control.abort(),
      Math.min(request.timeoutMs ?? FETCH_TIMEOUT_MS, FETCH_TIMEOUT_MS),
    )
    let status = 0
    let html = ''
    try {
      const jar = cookieHeader(request.cookies)
      const response = await this.fetchImpl(target.toString(), {
        headers: {
          accept: 'text/html,application/xhtml+xml',
          // Named honestly. A runtime that lies about what it is makes every
          // rate limit and every block impossible for a site owner to reason
          // about, and #16 is about being legible.
          'user-agent': 'AgenticTeam/1.0 (+https://ai-team-hq.vercel.app)',
          ...(jar === '' ? {} : { cookie: jar }),
        },
        redirect: 'follow',
        signal: control.signal,
      })
      status = response.status
      html = await response.text()
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
      return done({
        detail:
          `only ${String(text.trim().length)} characters of text came back from ` +
          `${String(Math.round(html.length / 1024))}KB of markup, which means the page draws ` +
          'itself in JavaScript. This runtime does not run any, so nothing here is ' +
          'evidence of what the page says.',
        title: titleOf(html),
      })
    }

    return done({ detail: `http ${String(status)}`, ok: true, text, title: titleOf(html) })
  }
}

/**
 * Loopback, link-local and the RFC1918 ranges, by shape.
 *
 * Deliberately a shape rather than a list of names: the address that matters
 * most is `169.254.169.254`, which no blocklist of hostnames would catch and
 * which answers with cloud credentials.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd')) return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4 === null) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}
