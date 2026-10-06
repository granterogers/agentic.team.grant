/**
 * Importing this module arms the production fetch guard (`installProductionFetchGuard`). It decides nothing and refuses
 * nothing by itself: it only makes sure that a raw `fetch` to a production host in this process goes through
 * `src/safety/production-gate.ts` first. A script that reaches production through its own `fetch` instead of an executor
 * imports it, and `tests/safety/production-gate-coverage.test.ts` fails if one that should does not.
 */
import { installProductionFetchGuard } from './production-gate.ts'

installProductionFetchGuard()
