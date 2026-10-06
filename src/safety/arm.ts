/**
 * Importing this module arms the production fetch guard (`installProductionFetchGuard`). It decides nothing and refuses
 * nothing by itself: it only makes sure that a raw `fetch` to a production host in this process goes through
 * `src/safety/production-gate.ts` first, and is counted against the request budget (`request-budget.ts`). A script that
 * reaches production through its own `fetch` instead of an executor imports it, and
 * `tests/safety/production-gate-coverage.test.ts` fails if one that should does not.
 *
 * It also validates the budget configuration now, so an unreadable or unexplained HQ_PRODUCTION_REQUEST_BUDGET stops the
 * command before it does anything rather than at its first request.
 */
import { installProductionFetchGuard } from './production-gate.ts'
import { initProductionBudget } from './request-budget.ts'

installProductionFetchGuard()
initProductionBudget()
