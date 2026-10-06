import { describe, expect, it } from 'vitest'
import { change, price, SCENARIOS, touched } from '../../scripts/forensics/normal-load-lib.ts'

const RESULTS = {
  'worker.idle_pass': { statements: 60, hit: 400, read: 0 },
  'team_hq.pulse': { statements: 10, hit: 1000, read: 500 },
  'team_hq.thinking': { statements: 5, hit: 20, read: 0 },
  'team_hq.studio': { statements: 100, hit: 5000, read: 0 },
  'team_hq.portfolio_tasks': { statements: 2, hit: 10, read: 0 },
  'team_hq.lately': { statements: 7, hit: 70, read: 0 },
  'team_hq.unseen': { statements: 3, hit: 30, read: 0 },
  'team_hq.team_work': { statements: 4, hit: 40, read: 0 },
}

describe('the normal-load arithmetic', () => {
  it('counts buffers touched as hit plus read, so cache warmth does not move a scenario', () => {
    expect(touched({ statements: 1, hit: 70, read: 30 })).toBe(100)
    expect(touched({ statements: 1, hit: 100, read: 0 })).toBe(100)
  })

  it('prices a tab as three polls of the pulse and the thinking reading beside one idle pass', () => {
    const tab = SCENARIOS.find((s) => s.name.startsWith('B '))
    if (tab === undefined) throw new Error('no tab scenario')
    const p = price(tab, RESULTS)
    expect(p.touchedPerMinute).toBe(400 + 3 * 1500 + 3 * 20)
    expect(p.statementsPerMinute).toBe(60 + 3 * 10 + 3 * 5)
  })

  it('prices a page load once, and three tabs as three times the polls', () => {
    const load = SCENARIOS.find((s) => s.name.startsWith('C '))
    const three = SCENARIOS.find((s) => s.name.startsWith('E '))
    if (load === undefined || three === undefined) throw new Error('scenario missing')
    expect(price(load, RESULTS).touchedOnce).toBe(1500 + 5000 + 10 + 70 + 30 + 40 + 20)
    expect(price(three, RESULTS).touchedPerMinute).toBe(400 + 9 * 1500 + 9 * 20)
  })

  it('refuses a scenario whose probe has no result, instead of pricing it at zero', () => {
    const tab = SCENARIOS.find((s) => s.name.startsWith('B '))
    if (tab === undefined) throw new Error('no tab scenario')
    expect(() => price(tab, { 'worker.idle_pass': RESULTS['worker.idle_pass'] })).toThrow(
      /no probe result for team_hq.pulse/,
    )
  })

  it('reports a saving as negative and has no ratio against a zero baseline', () => {
    expect(change(200, 50)).toBe(-0.75)
    expect(change(100, 150)).toBe(0.5)
    expect(change(0, 10)).toBeUndefined()
  })
})
