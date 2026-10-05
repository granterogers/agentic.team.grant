/**
 * Import in a suite (scripts/verify, poc, p4, p5, p6) that reaches production WITHOUT going through the SQL executor, such as a
 * browser script that drives the deployed site. The executor asks the suite guard on its first statement; a script with no
 * executor in its closure would never meet it, so this module asks it at import. A suite the manifest classes as sample, smoke
 * or local passes; an unclassified one needs HQ_PRODUCTION_INTENT=1 (what `npm run suite -- <name> --production` states) and
 * both production flags. Local work and unit tests are not commands and are not asked.
 *
 * `tests/safety/p-streams-need-intent.test.ts` fails when a p4/p5/p6 script that can reach production has neither this nor the
 * executor in its import closure.
 */
import './arm.ts'
import { assertMayTouchProduction } from '../db/suite-guard.ts'
import { isScriptEntry } from './production-gate.ts'

if (isScriptEntry()) assertMayTouchProduction()
