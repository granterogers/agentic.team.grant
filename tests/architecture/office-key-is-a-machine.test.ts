import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  #385 as a PROPERTY of the gateway source, beside the behavioural proof (scripts/isolated/principals.ts,
  which drives the real handler). What this guards is the list itself: the office key may do what
  SERVICE_MAY names, and nothing that decides, speaks, reaches or connects as a person. A new action
  added tomorrow is not on the list, so it needs a person until somebody decides otherwise - and an
  action that carries an identity (`by:`) can never be added to it.
*/
const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

const actionsBlock = source.slice(
  source.indexOf('const ACTIONS: Readonly<Record<string, ActionSpec>> = {'),
  source.indexOf(
    '\n}\n',
    source.indexOf('const ACTIONS: Readonly<Record<string, ActionSpec>> = {'),
  ),
)
const actions = new Map<string, string>()
for (const chunk of actionsBlock.split(/\n {2}(?=[a-z_]+: \{)/).slice(1)) {
  const name = /^([a-z_]+): \{/.exec(chunk)?.[1]
  if (name !== undefined) actions.set(name, chunk)
}

const serviceMay = new Set(
  [
    ...(
      /const SERVICE_MAY: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? ''
    ).matchAll(/'([a-z_]+)'/g),
  ].map((m) => m[1] as string),
)

describe('the office key is a machine (#385)', () => {
  it('the parse finds the actions and the allow-list (the control: a check that finds nothing proves nothing)', () => {
    expect(actions.size).toBeGreaterThan(80)
    expect(serviceMay.size).toBeGreaterThan(20)
  })

  it('every name on the allow-list is a real action', () => {
    for (const name of serviceMay) expect(actions.has(name), name).toBe(true)
  })

  it('no action that carries the answering person is on the allow-list', () => {
    const identityBearing = [...actions].filter(([, spec]) => /\bby: 'p_by'/.test(spec))
    expect(identityBearing.length).toBeGreaterThanOrEqual(10)
    for (const [name] of identityBearing) expect(serviceMay.has(name), name).toBe(false)
  })

  it('none of the things that decide, speak, reach or connect is on it', () => {
    const forbidden = [
      /approve|decline|answer|withdraw|undo|standing|autonomy|hire|retire|grant|revoke/,
      /^say$|send_to|instruction|automation|staff|routing|proposal|suggestion|lesson/,
      /secret|credential|connect|disconnect|connector|google|slack|vikunja|browser|setting|attach|detach|drive_link|reference/,
      /upload/,
    ]
    for (const name of serviceMay) {
      for (const re of forbidden) expect(re.test(name), `${name} ~ ${String(re)}`).toBe(false)
    }
  })

  it('the key is kind service with no principal, and the gate is wired to it', () => {
    // The wired expressions, not names: a name in a file proves nothing calls it.
    expect(source).toMatch(
      /if \(await tokenMatches\(presented\)\) return \{ verdict: 'yes', principal: null, kind: 'service' \}/,
    )
    // The gate: a person may do everything; the key only SERVICE_MAY; a TEST member SERVICE_MAY plus
    // the decisions whose database function enforces the test-principal rule (the ones that carry `by`).
    // A public Sample visitor (kind guest, 0897) is a fourth principal whose only action is on an allow list of exactly
    // one: the clause is pinned to that list, and the list is pinned to its single member, so neither can widen quietly.
    expect(source).toMatch(
      /const mayDo =\s*kind === 'person' \|\|(?:\s*\/\/[^\n]*)*\s*\(kind === 'guest' && GUEST_MAY\.has\(actionName\)\) \|\|\s*SERVICE_MAY\.has\(actionName\) \|\|\s*\(kind === 'harness' && action\.by !== undefined\)/,
    )
    expect(source).toMatch(/const GUEST_MAY: ReadonlySet<string> = new Set\(\['sample_say'\]\)/)
    expect(source).toMatch(
      /if \(kind === 'guest' && !GUEST_MAY\.has\(actionName\)\) \{\s*return json\(\s*\{\s*error: 'sample_readonly'/,
    )
    expect(source).toMatch(/if \(!mayDo\) \{/)
    // A session that names nobody cannot reach a function that would default its principal.
    expect(source).toMatch(
      /kind !== 'service' &&\s*\(principal === null \|\| principal === ''\) &&\s*!SERVICE_MAY\.has\(actionName\)/,
    )
    expect(source).not.toMatch(/principal: 'grant'/)
    expect(source).not.toMatch(/TOKEN_PRINCIPAL/)
  })

  it('the person written into an action is the verified principal, never what the page sent', () => {
    expect(source).toMatch(/delete args\[action\.by\]/)
    expect(source).toMatch(
      /if \(principal !== null && principal !== ''\) args\[action\.by\] = principal/,
    )
  })

  it('a member whose kind the database did not say is treated as a test member, never a person', () => {
    // 'guest' is named by the database (kind guest, a sample office's visitor); anything else it does not name is a test member.
    expect(source).toMatch(
      /rows\[0\]\?\.kind === 'person' \? 'person' : rows\[0\]\?\.kind === 'guest' \? 'guest' : 'harness'/,
    )
  })
})

describe('the sign-in function mints for a test member only (#385)', () => {
  const signin = readFileSync('supabase/functions/signin/index.ts', 'utf8')
  it('refuses unless the database says the member is a test member', () => {
    expect(signin).toMatch(/if \(rows\[0\]\?\.kind !== 'harness'\) \{/)
  })
})
