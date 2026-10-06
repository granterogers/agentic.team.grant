/**
 * Import first in a browser suite that is LOCAL by default and can be pointed at the deployed site (`PAGE=https://…`).
 * Throws only when a site variable names a production host and ALLOW_PRODUCTION_CHECKS=1 is not set.
 */
import './arm.ts'
import { assertSiteAllowed, isScriptEntry } from './production-gate.ts'

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? 'this command'
if (isScriptEntry())
  assertSiteAllowed(
    `driving a browser against the deployed site from ${entry.replace(/^.*\/(scripts\/)/, '$1')}`,
    false,
  )
