/**
 * The operator-only action set is a classification the gateway cannot forget to make (multi-user P1.3).
 *
 * hq-api is a single-file Deno function, so this reads its SOURCE: the keys of ACTIONS, the three sets
 * beside it and the enforcement call. Two properties: (1) every action that LOOKS deployment-wide is
 * either operator-only or carries a written reason it is not, so a new `set_*_credentials` action added
 * tomorrow fails here until somebody decides; (2) the enforcement is a consumed call whose answer
 * refuses, not a name that appears.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

const slice = (from: string, to: string): string => {
  const a = source.indexOf(from)
  const b = source.indexOf(to, a)
  expect(a, from).toBeGreaterThan(-1)
  expect(b, to).toBeGreaterThan(a)
  return source.slice(a, b)
}
const names = (block: string): string[] =>
  [...block.matchAll(/^ {2}'([a-z_0-9]+)',?$/gm)].map((m) => m[1] as string)

const actionsBody = slice('const ACTIONS', '\n}\n')
const actions = [
  ...actionsBody.matchAll(/^ {2}([a-z_0-9]+): \{\s*(?:\n\s*)?fn: '([a-z_0-9]+)'/gm),
].map((m) => ({ name: m[1] as string, fn: m[2] as string }))
const operatorOnly = new Set(names(slice('const OPERATOR_ONLY', 'const operators = new Map')))
const serviceMay = new Set(names(slice('const SERVICE_MAY', '])\n')))
const fixtureOnly = new Set(names(slice('const MACHINE_FIXTURE_ONLY', '])\n')))

/** Looks deployment-wide: a credential, a connection, a setting, the roster, a tool grant, routing. */
const LOOKS_SHARED =
  /secret|credential|connect|forget|disconnect|setting|hire|retire|routing|bot_|tool|google|slack|drive|register|offer|vikunja|notion|session|token|key|attach|detach|staff|skill|browser/i

/** Not operator-only, and why. A new entry here is a decision somebody wrote down. */
const NOT_OPERATOR: Readonly<Record<string, string>> = {
  attach: 'attaches THIS project to a source; the credential it rides is guarded where it is read',
  detach: 'detaches THIS project from a source',
  reattach: 'moves THIS project between sources',
  connection_choose: 'chooses which connection one project uses',
  retire_skill: 'withdraws a skill the office learned for its own work',
  browser_session_establish:
    'the person pastes their OWN session for sites they use; per-office data',
  browser_session_forget: 'forgets that same per-office session',
  channel_link_begin:
    'a person starts connecting THEIR OWN Telegram; the office is the verified session’s and the operator’s own office is refused by the function',
  channel_link_disconnect:
    'a person disconnects THEIR OWN Telegram; scoped to the verified office, and the operator’s office is refused by the function',
  slack_link_begin:
    'a person starts installing Slack into THEIR OWN workspace; the office is the verified session’s, the state is single-use, and the operator’s own office is refused by the function (ADR-0065)',
  slack_link_disconnect:
    'a person disconnects THEIR OWN Slack workspace; scoped to the verified office, and the operator’s office is refused by the function',
  project_staff: 'staffs one project',
  approve_tool:
    'answers a request raised in the caller’s OWN office; the function matches the request on office_id and the answerer must be that office’s own person',
  decline_tool:
    'declines a request raised in the caller’s OWN office, same office and same-person checks as approve_tool',
  revoke_tool:
    'withdraws a grant held in the caller’s OWN office (staff_tools is keyed on office_id); the global switch is set_setting, still operator-only',
}

describe('the operator-only set', () => {
  it('was read from the gateway source and is not trivially small', () => {
    expect(actions.length).toBeGreaterThanOrEqual(90)
    expect(operatorOnly.size).toBeGreaterThanOrEqual(15)
  })

  it('names only actions that exist (a renamed action must not silently drop out of the set)', () => {
    const known = new Set(actions.map((a) => a.name))
    for (const name of operatorOnly) expect(known.has(name), name).toBe(true)
  })

  it('is disjoint from what the machine key may do and from the fixture-only machine actions', () => {
    for (const name of operatorOnly) {
      expect(serviceMay.has(name), `${name} is on SERVICE_MAY`).toBe(false)
      expect(fixtureOnly.has(name), `${name} is machine fixture-only`).toBe(false)
    }
  })

  it('classifies every deployment-looking action: operator-only, or a written reason it is not', () => {
    const unclassified = actions
      .filter((a) => LOOKS_SHARED.test(a.name) || LOOKS_SHARED.test(a.fn))
      .filter((a) => !operatorOnly.has(a.name) && NOT_OPERATOR[a.name] === undefined)
      .map((a) => a.name)
    expect(unclassified).toEqual([])
  })

  it('has no stale exemption (an exempt action must exist and must not also be operator-only)', () => {
    const known = new Set(actions.map((a) => a.name))
    for (const name of Object.keys(NOT_OPERATOR)) {
      expect(known.has(name), `${name} no longer exists`).toBe(true)
      expect(operatorOnly.has(name), `${name} is both`).toBe(false)
      expect(NOT_OPERATOR[name]?.length ?? 0, name).toBeGreaterThan(15)
    }
  })

  it('can detect an unclassified action (the control: the matcher fires on a synthetic one)', () => {
    expect(LOOKS_SHARED.test('set_widget_credentials')).toBe(true)
    expect(LOOKS_SHARED.test('my_task_add')).toBe(false)
  })
})

describe('the gateway enforces it', () => {
  it('refuses unless a PERSON is asked of the database and answers yes (a consumed answer)', () => {
    expect(source).toMatch(
      /if \(OPERATOR_ONLY\.has\(actionName\)\) \{\s*const operator =\s*kind === 'person' &&[^;]*await isOperator\(principal\)\)\s*if \(!operator\) \{\s*return json\(/,
    )
  })

  it('asks the database by owner key, fails closed and remembers only a yes', () => {
    const fn = slice('const isOperator = async', '\n}\n')
    expect(fn).toMatch(/rpc\/deployment_operator/)
    expect(fn).toMatch(/p_owner_key: owner/)
    expect(fn).toMatch(/if \(asked === null \|\| !asked\.ok\) return false/)
    expect(fn).toMatch(/if \(answer !== true\) \{\s*operators\.delete\(owner\)\s*return false/)
  })

  it('refuses a person who is not an operator the deployment-level pages, consuming the answer (P4)', () => {
    const gate = slice(
      'if (OPERATOR_SECTIONS.has(name)) {',
      '// `Object.hasOwn`, not a bare lookup.',
    )
    // the answer is consumed: a non-operator person is refused with a 403, and a harness member never reads it
    expect(gate).toMatch(
      /const mayRead =\s*kind === 'service' \|\|\s*\(kind === 'person' && principal !== null && principal !== '' && \(await isOperator\(principal\)\)\)/,
    )
    expect(gate).toMatch(/if \(!mayRead\) \{\s*return json\(/)
    expect(gate).toMatch(/operator_required/)
    expect(gate).toMatch(/403/)
  })

  it('classifies every section that has no office to scope to: operator-only, or a written reason it is not (P4)', () => {
    const body = slice('const SECTIONS', '\n}\n')
    // Every top-level entry starts with two spaces and `name: {`; its text runs to the next one. An entry is scoped to an
    // office if it says `office: true` anywhere in its own text.
    const starts = [...body.matchAll(/^ {2}([a-z_0-9]+): \{/gm)]
    const sections = starts.map((m, i) => ({
      name: m[1] as string,
      scoped: /office: true/.test(body.slice(m.index, starts[i + 1]?.index ?? body.length)),
    }))
    expect(sections.length).toBeGreaterThanOrEqual(50)
    expect(sections.some((s) => s.scoped)).toBe(true)
    expect(sections.some((s) => !s.scoped)).toBe(true)
    const named = new Set(names(slice('const OPERATOR_SECTIONS', '])\n')))
    const NOT_OPERATOR_SECTION: Readonly<Record<string, string>> = {
      actions:
        'the static catalogue of what an asset can be asked to do; no office or deployment data in it',
    }
    const unclassified = sections
      .filter((s) => !s.scoped)
      .filter((s) => !named.has(s.name) && NOT_OPERATOR_SECTION[s.name] === undefined)
      .map((s) => s.name)
    expect(unclassified).toEqual([])
    // the control: the five that were found by a real second person are in the set the gate reads
    for (const n of ['google', 'build', 'ci_lately', 'ci_budget', 'bots']) {
      expect(named.has(n), n).toBe(true)
    }
  })

  it('also guards the Drive browse, a GET section with no kind rule of its own', () => {
    const drive = slice("if (name === 'drive') {", 'const access = await googleToken(')
    expect(drive).toMatch(
      /kind === 'person'\s+&&\s+principal !== null[^)]*await isOperator\(principal\)/,
    )
    expect(drive).toMatch(/operator_required/)
  })
})
