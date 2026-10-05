/**
 * Cloudflare Browser Rendering, the free half of the assessment (#135, #16).
 *
 * Available on the Workers **Free** plan: ten browser-minutes a day, three
 * concurrent browsers, one new instance every twenty seconds, sixty-second
 * timeout. That is the finding the assessment turned on — a real Chromium,
 * behind a login, for nothing.
 *
 * Two REST endpoints are all the gather tier needs:
 *
 *   POST /accounts/{account}/browser-rendering/content     -> rendered HTML
 *   POST /accounts/{account}/browser-rendering/screenshot  -> a PNG
 *
 * Both accept `cookies`, which is the entire reason a session jar in the Vault
 * substitutes for a browser that stays open.
 *
 * ## What this file may not do
 *
 * It may not click, type, submit or navigate a flow. The REST surface offers
 * some of that and the interface deliberately does not expose it. See
 * `adapter.ts`.
 *
 * ## Credentials
 *
 * Passed in by the caller, already resolved from the Vault. This file never
 * reads a secret and never writes one anywhere — not into `detail`, not into a
 * thrown message. `redactSecrets` runs over anything Cloudflare hands back,
 * because a 403 body is not something this code controls.
 */

import { redactSecrets } from '../text/secrets.ts'
import type { BrowserAdapter, Cookie, GatherRequest, GatherResult, PageLink } from './adapter.ts'
import { linksOf } from './links.ts'

const API = 'https://api.cloudflare.com/client/v4'

/** Cloudflare's own ceiling. Asking for more is refused, so stay under it. */
export const RUNTIME_CEILING_MS = 55_000

export interface CloudflareBrowserDeps {
  readonly accountId: string
  readonly apiToken: string
  readonly fetchImpl?: typeof fetch
}

/** Markup in, words out. Good enough for retrieval; never shown as a page. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)
  const t = m?.[1]?.replace(/\s+/g, ' ').trim()
  return t === undefined || t === '' ? null : t
}

/**
 * Did the page come back as a sign-in wall?
 *
 * Narrow on purpose. A wrong `signedOut` asks Grant to re-authenticate a
 * session that is perfectly good, which is the annoying direction, so this
 * requires the status to say so OR the page to be both short and dominated by
 * sign-in words. A missed one costs a confusing gather, which he can see in
 * the ledger.
 */
export function looksSignedOut(status: number, text: string): boolean {
  if (status === 401 || status === 403) return true
  const t = text.slice(0, 2000).toLowerCase()
  if (text.length > 4000) return false
  const wall = /\b(sign in|log in|login|signin)\b/.test(t)
  const asks = /\b(password|continue with google|email address)\b/.test(t)
  return wall && asks
}

export class CloudflareBrowser implements BrowserAdapter {
  readonly name = 'cloudflare-browser-rendering'
  private readonly fetchImpl: typeof fetch

  constructor(private readonly deps: CloudflareBrowserDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  private async call(
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ status: number; bytes: Uint8Array; json: Record<string, unknown> | null }> {
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), timeoutMs)
    try {
      const response = await this.fetchImpl(
        `${API}/accounts/${this.deps.accountId}/browser-rendering/${path}`,
        {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${this.deps.apiToken}`,
            'content-type': 'application/json',
          },
          method: 'POST',
          signal: control.signal,
        },
      )
      const buffer = new Uint8Array(await response.arrayBuffer())
      const kind = response.headers.get('content-type') ?? ''
      let json: Record<string, unknown> | null = null
      if (kind.includes('json')) {
        try {
          json = JSON.parse(new TextDecoder().decode(buffer)) as Record<string, unknown>
        } catch {
          json = null
        }
      }
      return { bytes: buffer, json, status: response.status }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Cloudflare's shape for what a Playwright context calls a cookie. */
  private static jar(cookies: readonly Cookie[] | undefined): unknown[] | undefined {
    if (cookies === undefined || cookies.length === 0) return undefined
    return cookies.map((c) => ({
      domain: c.domain,
      httpOnly: c.httpOnly ?? false,
      name: c.name,
      path: c.path ?? '/',
      sameSite: c.sameSite ?? 'Lax',
      secure: c.secure ?? true,
      value: c.value,
    }))
  }

  async gather(request: GatherRequest): Promise<GatherResult> {
    const began = Date.now()
    const timeoutMs = Math.min(request.timeoutMs ?? RUNTIME_CEILING_MS, RUNTIME_CEILING_MS)
    const cookies = CloudflareBrowser.jar(request.cookies)
    const nothing = {
      ms: 0,
      shot: null as Uint8Array | null,
      signedOut: false,
      stopped: false,
      text: null as string | null,
      title: null as string | null,
    }

    const wantsText = request.verbs.includes('read')
    const wantsShot = request.verbs.includes('shot')
    let text: string | null = null
    let title: string | null = null
    let shot: Uint8Array | null = null
    let signedOut = false
    let links: readonly PageLink[] | undefined

    try {
      if (wantsText) {
        const got = await this.call('content', { cookies, url: request.url }, timeoutMs)
        if (got.status >= 400) {
          return {
            ...nothing,
            detail: redactSecrets(
              `Cloudflare answered ${String(got.status)} reading the page: ${describe(got.json)}`,
            ),
            ms: Date.now() - began,
            ok: false,
            signedOut: got.status === 401 || got.status === 403,
          }
        }
        const html = htmlOf(got)
        text = textOf(html)
        title = titleOf(html)
        links = linksOf(html, request.url)
        signedOut = looksSignedOut(got.status, text)
      }

      if (await request.stopped?.()) {
        return {
          ...nothing,
          detail: 'stopped between steps, as asked',
          ms: Date.now() - began,
          ok: true,
          signedOut,
          stopped: true,
          text,
          title,
        }
      }

      if (wantsShot) {
        const got = await this.call(
          'screenshot',
          { cookies, screenshotOptions: { fullPage: true }, url: request.url },
          timeoutMs,
        )
        if (got.status >= 400) {
          /*
            A failed photograph does not fail the gather. The words are the
            valuable half and a screenshot is corroboration, so losing it is
            worth a sentence in the ledger and nothing more.
          */
          return {
            detail: redactSecrets(
              `read the page; the screenshot came back ${String(got.status)}: ${describe(got.json)}`,
            ),
            ms: Date.now() - began,
            ok: wantsText,
            shot: null,
            signedOut,
            stopped: false,
            text,
            title,
          }
        }
        shot = got.bytes
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      return {
        ...nothing,
        detail: redactSecrets(
          why.includes('abort') ? `it did not finish inside ${String(timeoutMs)}ms` : why,
        ),
        ms: Date.now() - began,
        ok: false,
      }
    }

    return {
      detail: signedOut ? 'the page asked for a sign-in' : 'read',
      ms: Date.now() - began,
      ok: true,
      shot,
      signedOut,
      stopped: false,
      text,
      title,
      ...(links === undefined ? {} : { links }),
    }
  }
}

function htmlOf(got: { bytes: Uint8Array; json: Record<string, unknown> | null }): string {
  const fromJson = got.json?.result
  if (typeof fromJson === 'string') return fromJson
  return new TextDecoder().decode(got.bytes)
}

/** Cloudflare's error envelope, reduced to a sentence. Never a token. */
function describe(json: Record<string, unknown> | null): string {
  const errors = json?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    return errors
      .map((e) => String((e as { message?: unknown }).message ?? 'no reason given'))
      .join('; ')
      .slice(0, 300)
  }
  return 'no reason given'
}
