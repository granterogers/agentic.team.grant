/**
 * Import first in a command that is offline by default and contacts a real project only when told to (`--live`): the offline
 * mode needs no flag, the live mode is a production-class contact and is refused unless ALLOW_PRODUCTION_CHECKS=1.
 */
import './arm.ts'
import { assertProductionChecksAllowed, isScriptEntry } from './production-gate.ts'

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? []
const entry = argv[1] ?? 'this command'
if (isScriptEntry() && argv.includes('--live'))
  assertProductionChecksAllowed(`running ${entry.replace(/^.*\/(scripts\/)/, '$1')} --live`)
