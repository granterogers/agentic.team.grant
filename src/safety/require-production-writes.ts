/**
 * Import first in a script that writes to or deploys production: it throws (before any other module runs) unless BOTH
 * ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1. Also arms the fetch guard.
 */
import './arm.ts'
import { assertProductionWritesAllowed, isScriptEntry } from './production-gate.ts'

const entry = (globalThis as { process?: { argv?: string[] } }).process?.argv?.[1] ?? 'this command'
if (isScriptEntry())
  assertProductionWritesAllowed(`running ${entry.replace(/^.*\/(scripts\/)/, '$1')}`)
