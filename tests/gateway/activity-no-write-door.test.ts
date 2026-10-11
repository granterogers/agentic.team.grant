/**
 * The activity ledger has no write door over HTTP, and the external-agent contract says so (Hermes readiness).
 *
 * `app.record_external_activity` is the only way an external worker's report would enter the ledger. It is deliberately NOT a gateway
 * action: exposing it needs an authenticated boundary that names the worker and the office from a credential the worker cannot choose,
 * and that boundary does not exist. This pins the absence, so adding the door is a decision somebody makes with a test, not an edit.
 * The database half (no public wrapper, no HTTP role can execute a writer) is activity-ledger-review.ts.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const gateway = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

describe('the gateway', () => {
  it('names no activity writer anywhere', () => {
    expect(gateway).not.toMatch(/record_(external_)?activity/)
  })

  it('exposes the activity sections as reads only', () => {
    const sections = [
      ...gateway.matchAll(/^ {2}(activity_[a-z_]+): \{\s*(?:\n\s*)?fn: '([a-z_]+)'/gm),
    ].map((m) => [m[1], m[2]])
    expect(sections.length).toBeGreaterThanOrEqual(4)
    for (const [, fn] of sections)
      expect(fn, 'a section reads, it does not record').not.toMatch(/record|write|set|add|create/)
  })

  it('has no ACTIONS entry for an activity function', () => {
    const actions = gateway.slice(
      gateway.indexOf('const ACTIONS'),
      gateway.indexOf('\n}\n', gateway.indexOf('const ACTIONS')),
    )
    expect(actions.length).toBeGreaterThan(1000)
    expect(actions).not.toMatch(/fn: '[a-z_]*activity[a-z_]*'/)
  })

  it('is shown a defect it must catch: an action that records activity would be seen', () => {
    const mutated = `${gateway}\n  record_activity_action: { fn: 'record_external_activity' }\n`
    expect(mutated).toMatch(/record_(external_)?activity/)
  })
})

describe('the external-agent contract', () => {
  const contract = readFileSync('docs/activity-ledger/EXTERNAL-AGENT-CONTRACT.md', 'utf8')
  it('says nothing exposes the door through any gateway, and what exposing it needs', () => {
    expect(contract).toMatch(/exposes the door below through any gateway/i)
    expect(contract).toMatch(/authenticated, scoped application boundary/i)
    expect(contract).toMatch(/rate-limit per worker/i)
  })
})
