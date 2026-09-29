/**
 * check:door-origins can fail (#381). A check that has only ever passed is
 * indistinguishable from one that cannot see anything.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { doorViolations, MAKES_NO_TURN } from '../../scripts/check-door-origins.ts'

const POST =
  "await fetch(`https://x.supabase.co/functions/v1/telegram-webhook`, { method: 'POST' })"

describe('check:door-origins', () => {
  it('a script that posts to a door without declaring is a violation', () => {
    expect(doorViolations([{ path: 'scripts/verify/new.ts', src: POST }])).toHaveLength(1)
  })
  it('declaring first, with the executor, clears it', () => {
    const src = `const o = await testOrigins(db, 'verify:new')\n${POST}`
    expect(doorViolations([{ path: 'scripts/verify/new.ts', src }])).toEqual([])
  })
  it('the name in a comment is not a call', () => {
    const src = `// we should call testOrigins( here one day\n${POST}`
    expect(doorViolations([{ path: 'scripts/verify/new.ts', src }])).toHaveLength(1)
  })
  it("naming one of Grant's conversations is a violation even when declared", () => {
    const src = `await testOrigins(db, 'x')\n${POST}\nconst chat = 1386648496`
    const v = doorViolations([{ path: 'scripts/verify/new.ts', src }])
    expect(v.map((x) => x.why).join()).toMatch(/1386648496/)
  })
  it('the dashboard say path and the Slack and MCP doors count too', () => {
    for (const src of [
      "fetch(base, { body: JSON.stringify({ action: 'say', args: {} }) })",
      'fetch(`${ref}/functions/v1/slack-events`)',
      'fetch(`${ref}/functions/v1/mcp`)',
    ])
      expect(doorViolations([{ path: 'scripts/verify/new.ts', src }])).toHaveLength(1)
  })
  it('an exemption is checked: an excused script that builds a turn is a violation', () => {
    const path = Object.keys(MAKES_NO_TURN).find((p) => p !== 'scripts/check-door-origins.ts') ?? ''
    const src = `${POST}\nbody: JSON.stringify({ update_id: 1, message: { text: 'hi' } })`
    expect(doorViolations([{ path, src }])).toHaveLength(1)
  })
  it('the suites #381 changed pass as they are', () => {
    const paths = [
      'scripts/verify/latency.ts',
      'scripts/verify/telegram.ts',
      'scripts/verify/echo.ts',
      'scripts/verify/slack.ts',
      'scripts/verify/security.ts',
      'scripts/verify/mcp.ts',
      'scripts/verify/history.ts',
    ]
    expect(
      doorViolations(paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))),
    ).toEqual([])
  })
})
