/**
 * The office key's reach, pinned (multi-user P1.5). The live half is `npm run check:machine-key`; this is the part
 * that needs no database: the scan reads the gateway's own source, the predicate has controls, and the machine
 * key can decide nothing.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  controls,
  PINNED,
  problems,
  reaches,
  serviceActions,
} from '../../scripts/check-machine-key.ts'

const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

describe('the machine key', () => {
  const actions = serviceActions(source)

  it('is read from the gateway (a scan that finds nothing proves nothing)', () => {
    expect(actions.size).toBeGreaterThanOrEqual(30)
    expect(actions.get('appearance_set')).toBe('hq_appearance_set')
  })

  it('carries no action that decides: the only `by` action on its list is stop_job, which the database holds to a person', () => {
    // request_stop refuses a principal it cannot name for anything but a harness job (principals.ts, "a person stops
    // it as himself"); any OTHER `by` action added to this list is a machine deciding as somebody and fails here.
    const specs = new Set(
      [...source.matchAll(/^ {2}([a-z_0-9]+): \{[^}]*\bby: '(p_[a-z_]+)'/gm)].map(
        (m) => m[1] as string,
      ),
    )
    expect([...actions.keys()].filter((name) => specs.has(name))).toEqual(['stop_job'])
  })

  it('has no operator-only action on its list', () => {
    const operator = source.slice(
      source.indexOf('const OPERATOR_ONLY'),
      source.indexOf('const operators = new Map'),
    )
    for (const name of actions.keys()) expect(operator.includes(`'${name}',`), name).toBe(false)
  })

  it('refuses an unpinned person-defaulting reach and a stale pin, and accepts a pinned one', () => {
    for (const c of controls()) expect(c.ok, c.name).toBe(true)
  })

  it('maps an action to the function whose defaults matter', () => {
    const found = reaches(new Map([['appearance_set', 'hq_appearance_set']]), [
      { fn: 'hq_appearance_set', param: 'p_owner', default: 'grant' },
      { fn: 'something_else', param: 'p_by', default: 'grant' },
    ])
    expect(found).toHaveLength(1)
    expect(problems(found, { appearance_set: PINNED.appearance_set ?? '' })).toEqual([])
  })

  it('pins nothing without a reason of substance', () => {
    for (const [name, why] of Object.entries(PINNED)) expect(why.length, name).toBeGreaterThan(40)
  })
})
