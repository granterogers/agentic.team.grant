/**
 * Import first in a script whose whole purpose is production: it throws (before any other module runs) unless
 * ALLOW_PRODUCTION_CHECKS=1. Also arms the fetch guard.
 */
import './arm.ts'
import { assertProductionChecksAllowed, isScriptEntry } from './production-gate.ts'

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? 'this command'
if (isScriptEntry())
  assertProductionChecksAllowed(`running ${entry.replace(/^.*\/(scripts\/)/, '$1')}`)
