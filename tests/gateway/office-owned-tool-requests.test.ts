/**
 * Answering a request for reach is the act of the person whose office raised it, not of the deployment's operator.
 *
 * The gateway no longer refuses approve/decline/revoke to a non-operator, so what makes that safe is the database:
 * every one of these functions must scope on the office it is given and refuse an answerer who is not that office's own
 * person. The cross-office behaviour is driven live by `scripts/sample/tool-requests-live.ts`; this reads the
 * definitions that migrations hold and the gateway source, so a later migration that loosens one fails here first.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const gateway = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
const operatorOnly = gateway.slice(
  gateway.indexOf('const OPERATOR_ONLY'),
  gateway.indexOf('const operators = new Map'),
)

/** The newest migration that defines `app.<name>(`, which is what is live. */
const latest = (name: string): string => {
  const files = readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let found = ''
  for (const f of files) {
    const text = readFileSync(`migrations/${f}`, 'utf8')
    const at = text.search(new RegExp(`function app\\.${name}\\(`, 'i'))
    if (at >= 0) found = text.slice(at, at + 6000)
  }
  expect(found, `no migration defines app.${name}`).not.toBe('')
  return found
}

describe('answering reach is office-owned', () => {
  it.each(['approve_tool', 'decline_tool', 'revoke_tool'])(
    '%s is not an operator-only action',
    (name) => {
      expect(operatorOnly).not.toMatch(new RegExp(`'${name}'`))
    },
  )

  it('but every deployment-wide action next to them still is', () => {
    for (const name of [
      'set_setting',
      'staff_update',
      'staff_hire',
      'staff_tool_set',
      'disconnect',
      'set_slack_credentials',
    ])
      expect(operatorOnly, name).toMatch(new RegExp(`'${name}'`))
  })

  it('approve and decline match the request on the caller’s office and only the office’s own person may answer', () => {
    for (const fn of ['approve_tool', 'decline_tool']) {
      const body = latest(fn)
      expect(body, fn).toMatch(/perform app\.require_office\(p_office\)/)
      expect(body, fn).toMatch(/request_id = p_request_id and office_id = p_office/)
      expect(body, fn).toMatch(/is distinct from app\.office_actor\(p_office\)/)
    }
  })

  it('revoke acts only on the caller’s office', () => {
    expect(latest('revoke_tool')).toMatch(/perform app\.require_office\(p_office\)/)
    expect(latest('hq_staff_tool_set')).toMatch(
      /office_id = p_office and staff_slug = p_slug and tool = p_tool/,
    )
  })

  it('the gateway scopes all three to the VERIFIED office, never to a caller-supplied one', () => {
    for (const name of ['approve_tool', 'decline_tool', 'revoke_tool']) {
      const line = gateway.match(new RegExp(`^  ${name}: \\{[^}]*\\}`, 'm'))?.[0] ?? ''
      expect(line, name).toMatch(/office: true/)
    }
  })
})
