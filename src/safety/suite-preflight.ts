/**
 * What `scripts/suite.ts` decides before it starts a suite: may this class of run start now? (a PROPOSAL,
 * docs/testing/production-test-budgets.md)
 *
 * It was a gate on intent plus a provider-health label, and it failed OPEN: with no access token it could not read the
 * label, returned "unknown" and went ahead. Now a production-class run that cannot read the platform is NO-GO unless a
 * person states `--skip-canary-because=<reason>`; a sample or production-heavy run also needs the heartbeat canary
 * (`canary.ts`); and the class is passed to the child so its request budget (`request-budget.ts`) is the class's.
 *
 * Pure over injected readers, so every branch is unit-tested. It sends nothing itself.
 */
import {
  canaryPrecondition,
  judgeHealth,
  parseSkipCanary,
  type ReadHealth,
  type ReadRows,
} from './canary.ts'
import type { BudgetClass } from './request-budget.ts'

export type SuiteClass = 'local' | 'sample' | 'smoke' | 'production-heavy'

export const EXIT_NO_PRODUCTION_FLAG = 3
export const EXIT_NO_GO = 4
export const EXIT_NO_TOKEN = 6
export const EXIT_BAD_ARGUMENT = 2

export type Start = { readonly ok: boolean; readonly exit: number; readonly lines: string[] }

/** The request-budget class a suite runs under. Local suites touch no production and take the default. */
export const budgetClassFor = (
  cls: SuiteClass,
  name: string,
  disposable: readonly string[],
): BudgetClass => {
  if (cls === 'local') return 'default'
  if (disposable.includes(name)) return 'disposable-multi-user'
  return cls
}

export type PreflightInput = {
  readonly cls: SuiteClass
  readonly args: readonly string[]
  readonly token: string | undefined
  readonly readHealth: ReadHealth
  readonly readRows: ReadRows
  readonly sleep?: (ms: number) => Promise<void>
}

export const preflightSuite = async (i: PreflightInput): Promise<Start> => {
  if (i.cls === 'local') return { ok: true, exit: 0, lines: [] }
  if (i.cls === 'production-heavy' && !i.args.includes('--production'))
    return {
      ok: false,
      exit: EXIT_NO_PRODUCTION_FLAG,
      lines: [
        'REFUSED: this suite writes into or presses on the real office. Say so with --production, ' +
          'or run it against the Sample Person (docs/testing/SUITE-CLASSES.md).',
      ],
    }
  let skip: string | null
  try {
    skip = parseSkipCanary(i.args)
  } catch (e) {
    return { ok: false, exit: EXIT_BAD_ARGUMENT, lines: [(e as Error).message] }
  }
  if (i.token === undefined || i.token === '') {
    if (skip === null)
      return {
        ok: false,
        exit: EXIT_NO_TOKEN,
        lines: [
          'REFUSED: SUPABASE_ACCESS_TOKEN is not set, so the platform health and the heartbeat canary cannot be read. ' +
            'A production-class run that cannot look first does not start. ' +
            'To go ahead on purpose: --skip-canary-because="<reason>".',
        ],
      }
    return {
      ok: true,
      exit: 0,
      lines: [`SKIPPED the platform health and canary (no token): ${skip}`],
    }
  }

  if (i.cls === 'smoke') {
    // A smoke run is a handful of reads: the provider's own label is enough, and an unreadable one is still NO-GO.
    let health: { status: string }[] = []
    try {
      health = await i.readHealth()
    } catch {
      health = []
    }
    if (health.length === 0) {
      if (skip === null)
        return {
          ok: false,
          exit: EXIT_NO_GO,
          lines: [
            'NO-GO: the platform health could not be read. A health label that cannot be read is not a pass. ' +
              'To go ahead on purpose: --skip-canary-because="<reason>".',
          ],
        }
      return { ok: true, exit: 0, lines: [`SKIPPED the health reading: ${skip}`] }
    }
    const h = judgeHealth(health)
    if (!h.ok)
      return {
        ok: false,
        exit: EXIT_NO_GO,
        lines: [
          `NO-GO: Supabase does not report itself healthy (${h.detail}). Not adding load to a degraded platform.`,
        ],
      }
    return { ok: true, exit: 0, lines: [`health: ${h.detail}`] }
  }

  const v = await canaryPrecondition({
    readHealth: i.readHealth,
    readRows: i.readRows,
    skipBecause: skip,
    ...(i.sleep === undefined ? {} : { sleep: i.sleep }),
  })
  const lines = [
    ...v.checks.map((c) => `${c.ok ? 'ok  ' : 'FAIL'} ${c.name} - ${c.detail}`),
    ...v.reasons,
  ]
  return { ok: v.go, exit: v.go ? 0 : EXIT_NO_GO, lines }
}
