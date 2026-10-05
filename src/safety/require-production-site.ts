/**
 * Import first in a browser suite that falls back to a DEPLOYED site (`process.env.BASECAMP_SITE ?? 'https://…vercel.app'`).
 * Throws unless ALLOW_PRODUCTION_CHECKS=1, or a site variable (BASECAMP_SITE, HQ_URL, LIVE_HOST, PAGE, BASECAMP_URL) names a
 * local server. The page's own requests to production are invisible to the fetch guard, so this is the gate for them.
 */
import './arm.ts'
import { assertSiteAllowed, isScriptEntry } from './production-gate.ts'

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? 'this command'
if (isScriptEntry())
  assertSiteAllowed(
    `driving a browser against the deployed site from ${entry.replace(/^.*\/(scripts\/)/, '$1')}`,
    true,
  )
