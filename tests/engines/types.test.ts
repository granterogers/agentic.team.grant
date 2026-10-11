import { describe, expect, it } from 'vitest'
import { REQUEST_CASES, RESULT_CASES } from '../../src/engines/hermes/shape-cases.ts'
import * as timing from '../../src/engines/hermes/timing.ts'
import { engineOf, requestProblem, resultProblem } from '../../src/engines/hermes/types.ts'

describe('the request validator', () => {
  for (const c of REQUEST_CASES)
    it(c.name, () => {
      const got = requestProblem(c.request)
      if (c.problem === null) expect(got).toBeNull()
      else {
        // A refusal for the wrong reason is not a pass: the sentence must name what the specimen is wrong about.
        expect(got).not.toBeNull()
        expect(got).toContain(c.problem)
      }
    })

  it('has both refusals and acceptances, so a validator that accepts or refuses everything cannot pass', () => {
    expect(REQUEST_CASES.filter((c) => c.problem === null).length).toBeGreaterThanOrEqual(3)
    expect(REQUEST_CASES.filter((c) => c.problem !== null).length).toBeGreaterThanOrEqual(10)
  })
})

describe('the result validator', () => {
  for (const c of RESULT_CASES)
    it(c.name, () => {
      const got = resultProblem(c.outcome, c.result)
      if (c.problem === null) expect(got).toBeNull()
      else {
        expect(got).not.toBeNull()
        expect(got).toContain(c.problem)
      }
    })

  it('has both refusals and acceptances', () => {
    expect(RESULT_CASES.filter((c) => c.problem === null).length).toBeGreaterThanOrEqual(3)
    expect(RESULT_CASES.filter((c) => c.problem !== null).length).toBeGreaterThanOrEqual(8)
  })
})

describe('engineOf fails toward the team', () => {
  it('only the exact word hermes selects Hermes', () => {
    expect(engineOf('hermes')).toBe('hermes')
    for (const v of [
      'Hermes',
      'HERMES',
      ' hermes',
      'hermes ',
      '',
      null,
      undefined,
      1,
      {},
      ['hermes'],
      'team',
      'other',
    ])
      expect(engineOf(v)).toBe('team')
  })
})

describe('the shared numbers', () => {
  it('keep the relationships the database relies on', () => {
    expect(timing.HEARTBEAT_S).toBeLessThan(timing.LEASE_S)
    expect(timing.LEASE_S).toBeLessThan(timing.BRIDGE_FRESH_S)
    expect(timing.NO_PROGRESS_S).toBeLessThanOrEqual(timing.LEASE_S)
    expect(timing.DEADLINE_MIN_S).toBeLessThanOrEqual(timing.DEADLINE_DEFAULT_S)
    expect(timing.DEADLINE_DEFAULT_S).toBeLessThanOrEqual(timing.DEADLINE_MAX_S)
    expect(timing.MAX_CLAIMS).toBe(3)
  })

  it('lists the read tools without a write tool, sorted, and with no duplicates', () => {
    const tools = [...timing.ENGINE_READ_TOOLS]
    expect(tools).toEqual([...tools].sort())
    expect(new Set(tools).size).toBe(tools.length)
    for (const writer of [
      'create_task',
      'update_task',
      'add_to_project',
      'ask_team',
      'start_research',
      'generate_artifact',
      'push_to_notebook',
      'notebook_generate',
    ])
      expect(tools).not.toContain(writer)
  })
})
