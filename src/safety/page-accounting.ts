/**
 * Request accounting for browser suites: count what a Playwright page sends to production, and enforce the same budget
 * (`request-budget.ts`) the fetch guard enforces for Node.
 *
 * A page's own requests are invisible to the fetch guard, and they are most of the load: one Team HQ page load is about
 * 25 gateway requests, so a suite that reloads the page a hundred times is 2,500 requests the budget never saw
 * (docs/ops/supabase-forensics-2026-10-05.md section 12.3). `accountPage(page)` listens to the page's `request` event:
 *
 *  - every request to a production host is tallied against the process budget (one count each, redirect hops included);
 *  - every main-frame navigation is a page load, tallied against the page-load budget;
 *  - when either budget is spent the page's browser context is CLOSED, so the suite stops sending at once (its own `finally`
 *    then runs and the budget's registered teardowns run), and the budget prints the sentence naming the budget, the count
 *    and the class.
 *
 * It over-counts rather than under-counts: a production-host request that a suite's own route handler answers locally is
 * still counted, because the `request` event fires before routing. It never counts local traffic (localhost, a replica, the
 * statically served page itself).
 *
 * It takes a structural `PageLike` so a unit test can drive it without a browser, and imports nothing from Playwright.
 */
import { isProductionUrl } from './production-gate.ts'
import { type ProductionBudget, productionBudget } from './request-budget.ts'

export type RequestLike = {
  url(): string
  method(): string
  isNavigationRequest(): boolean
  frame(): { parentFrame(): unknown } | null
}

export type PageLike = {
  on(event: 'request', listener: (request: RequestLike) => void): unknown
  context(): { close(): Promise<void> }
}

export type PageStats = {
  /** Every request the page made, whatever the host. */
  requests: number
  /** Requests to production hosts: what the budget counts. */
  production: number
  /** Main-frame navigations (a goto, a reload, a redirect hop). */
  loads: number
  /** True once the budget stopped this page. */
  stopped: boolean
}

export type AccountOptions = {
  /** Default: the process budget (null where none applies: a unit test that is not a command). */
  readonly budget?: ProductionBudget | null
  /** Default: the production gate's own definition of a production host. */
  readonly isProduction?: (url: string) => boolean
}

const NOT_A_LOAD = /^(about:|data:|blob:|chrome-error:)/i

/** Origin and path only: a query string can carry a key. */
const label = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return 'a URL'
  }
}

export const accountPage = (page: PageLike, opts: AccountOptions = {}): PageStats => {
  const budget = opts.budget === undefined ? productionBudget() : opts.budget
  const isProduction = opts.isProduction ?? ((u: string) => isProductionUrl(u))
  const stats: PageStats = { requests: 0, production: 0, loads: 0, stopped: false }

  const stop = (): void => {
    if (stats.stopped) return
    stats.stopped = true
    void page
      .context()
      .close()
      .catch(() => undefined)
  }

  page.on('request', (r) => {
    const url = r.url()
    stats.requests += 1
    let withinBudget = true
    if (r.isNavigationRequest() && r.frame()?.parentFrame() === null && !NOT_A_LOAD.test(url)) {
      stats.loads += 1
      if (budget !== null && !budget.tallyPageLoad(label(url))) withinBudget = false
    }
    if (isProduction(url)) {
      stats.production += 1
      if (budget !== null && !budget.tally(`browser ${r.method()} ${label(url)}`))
        withinBudget = false
    }
    if (!withinBudget || (budget?.exceeded ?? false)) stop()
  })
  return stats
}
