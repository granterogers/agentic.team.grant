/**
 * The `BrowserAdapter` boundary (#135, #16).
 *
 * Same shape and the same reasoning as `src/notebook/adapter.ts`: the office
 * depends on the interface, never on whichever ephemeral runtime is opening
 * the pages this month. The assessment's first conclusion was that the runtime
 * is swappable — Cloudflare's free tier today, a Fly machine or a dispatched
 * runner later — and that is only true if nothing above this file knows which
 * one it is.
 *
 * ## Gather, and deliberately not act
 *
 * Confirmed with Grant on 17 September 2026. This interface has four verbs and
 * all four are read-only: open a page, read it, photograph it, download a file
 * it links to. There is no click, no type, no submit. Adding one is a separate
 * decision with an approval path behind it (#15), a widened CHECK in the
 * database, and its own migration — not a method somebody quietly adds here.
 *
 * ## A session, not a browser
 *
 * The adapter is handed a cookie jar per call and gives one back. It never
 * holds anything between calls, because holding something between calls is the
 * definition of persistent compute and persistent compute costs money. The jar
 * lives in the Vault; the caller resolves it and passes it in, so importing
 * this file gives nobody the ability to authenticate as Grant anywhere.
 */

/** One cookie, in the shape every browser runtime already speaks. */
export interface Cookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path?: string
  readonly expires?: number
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: 'Strict' | 'Lax' | 'None'
}

export type GatherVerb = 'read' | 'shot'

/** A link a page offers. Offered, not followed: following is the caller's decision and is a read. */
export interface PageLink {
  readonly url: string
  readonly text: string
}

export interface GatherRequest {
  readonly url: string
  readonly verbs: readonly GatherVerb[]
  /** Presented to the site. Never logged, never returned, never stored here. */
  readonly cookies?: readonly Cookie[]
  /** Hard ceiling. Every free runtime has one and this must be below it. */
  readonly timeoutMs?: number
  /** Asked between verbs. Returning true ends the gather where it stands. */
  readonly stopped?: () => Promise<boolean> | boolean
}

export interface GatherResult {
  readonly ok: boolean
  /** The page's own title, when one was read. Non-secret by construction. */
  readonly title: string | null
  /** Rendered text, already stripped of markup. Null when `read` was not asked. */
  readonly text: string | null
  /**
   * The links on the page, when the runtime could read them. Absent when it could not.
   * Optional on purpose: a runtime that cannot list links is not a broken one.
   */
  readonly links?: readonly PageLink[]
  /** PNG bytes. Null when `shot` was not asked or the shot failed. */
  readonly shot: Uint8Array | null
  /**
   * The session no longer signed in.
   *
   * Separate from `ok: false` on purpose: an outage and an expired jar need
   * opposite responses — wait versus ask Grant to sign in again — and one
   * boolean covering both is how a re-auth prompt turns into a retry loop.
   */
  readonly signedOut: boolean
  /** Non-secret. A reason, a status, a count. Never a cookie, never a token. */
  readonly detail: string
  readonly ms: number
  /** Stopped between verbs because somebody asked. */
  readonly stopped: boolean
}

export interface BrowserAdapter {
  readonly name: string
  gather(request: GatherRequest): Promise<GatherResult>
}

export class BrowserUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`no browser runtime is configured: ${detail}`)
    this.name = 'BrowserUnavailableError'
  }
}

/**
 * The implementation that ships until a runtime credential exists.
 *
 * It is the default rather than a fallback, for the reason the notebook
 * adapter gives: the degradation path only works if it is the path that runs
 * every day. A handler that has never seen this answer is a handler that will
 * throw the first time Cloudflare is down.
 */
export class UnavailableBrowserAdapter implements BrowserAdapter {
  readonly name = 'unavailable'

  constructor(private readonly why: string = 'no runtime credential is set') {}

  gather(_request: GatherRequest): Promise<GatherResult> {
    return Promise.resolve({
      detail: this.why,
      ms: 0,
      ok: false,
      shot: null,
      signedOut: false,
      stopped: false,
      text: null,
      title: null,
    })
  }
}
