/**
 * Import first in a check that has a local-replica mode (`--replica`): that mode contacts nothing remote, so it needs no
 * flag; every other mode is the production check it always was and is refused unless ALLOW_PRODUCTION_CHECKS=1.
 */
import './arm.ts'
import { assertProductionChecksAllowed, isScriptEntry } from './production-gate.ts'

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? []
const entry = argv[1] ?? 'this command'
if (isScriptEntry() && !argv.includes('--replica'))
  assertProductionChecksAllowed(`running ${entry.replace(/^.*\/(scripts\/)/, '$1')}`)
