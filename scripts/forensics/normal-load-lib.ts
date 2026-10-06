/**
 * The arithmetic of the normal-load benchmark (scripts/forensics/normal-load.ts), kept pure so a test can pin it.
 *
 * A probe result is one call's cost on a replica seeded to production shape. A scenario is a list of (probe, calls per minute).
 * The cost of a scenario is the sum over its calls, in buffers TOUCHED (hit + read: whether a page was cached depends on what ran
 * before, the sum does not) and in statements. Nothing here is a timing.
 */

export interface Cost {
  statements: number
  hit: number
  read: number
}

export interface Scenario {
  name: string
  /** What a person or the office is doing, in one line. */
  what: string
  /** Probe name -> calls per minute. */
  perMinute: Record<string, number>
  /** Probe name -> calls once (a page load). */
  once?: Record<string, number>
}

export const touched = (c: Cost): number => c.hit + c.read

export interface Priced {
  statementsPerMinute: number
  touchedPerMinute: number
  statementsOnce: number
  touchedOnce: number
}

/** Price a scenario against one set of probe results. A probe the scenario names that the results lack is an error, never a zero. */
export const price = (s: Scenario, results: Record<string, Cost>): Priced => {
  const sum = (calls: Record<string, number>): { st: number; t: number } => {
    let st = 0
    let t = 0
    for (const [probe, n] of Object.entries(calls)) {
      const c = results[probe]
      if (c === undefined) throw new Error(`scenario ${s.name}: no probe result for ${probe}`)
      st += c.statements * n
      t += touched(c) * n
    }
    return { st, t }
  }
  const m = sum(s.perMinute)
  const o = sum(s.once ?? {})
  return {
    statementsPerMinute: m.st,
    touchedPerMinute: m.t,
    statementsOnce: o.st,
    touchedOnce: o.t,
  }
}

/** Fractional change, after against before; negative is a saving. Undefined when the baseline is zero (no ratio to speak of). */
export const change = (before: number, after: number): number | undefined =>
  before === 0 ? undefined : (after - before) / before

/**
 * The scenarios. The poll is 3 a minute (web/studio/office.js, 20 s) and each poll asks the pulse and the thinking reading; the
 * worker takes one pass a minute (pg_cron). The baseline's `thinking` is the whole office_health reading, which is what the gateway
 * called before migration 1028, so the baseline results map team_hq.thinking to team_hq.health_whole.
 */
export const SCENARIOS: Scenario[] = [
  {
    name: 'A idle office',
    what: 'no tab open, no job: the worker pass and nothing else',
    perMinute: { 'worker.idle_pass': 1 },
  },
  {
    name: 'B one tab, visible, established office',
    what: 'one Team HQ tab polling (pulse and thinking every 20 s) beside the idle worker',
    perMinute: { 'worker.idle_pass': 1, 'team_hq.pulse': 3, 'team_hq.thinking': 3 },
  },
  {
    name: 'C a page load',
    what: 'one load of Team HQ for an established office (the sections the page reads once)',
    perMinute: {},
    once: {
      'team_hq.studio': 1,
      'team_hq.pulse': 1,
      'team_hq.portfolio_tasks': 1,
      'team_hq.lately': 1,
      'team_hq.unseen': 1,
      'team_hq.team_work': 1,
      'team_hq.thinking': 1,
    },
  },
  {
    name: 'E three tabs, visible',
    what: 'three tabs on one office (a desk, a laptop and a phone), each polling',
    perMinute: { 'worker.idle_pass': 1, 'team_hq.pulse': 9, 'team_hq.thinking': 9 },
  },
]
