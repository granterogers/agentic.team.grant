/*
 * A THROTTLE IS NOT A REFUSAL, AND THE GATEWAY MUST NOT SAY IT IS.
 *
 * `supabase/functions/hq-api/index.ts` runs in Deno. It reads `Deno.env` while
 * the module is evaluated, so it cannot be imported here, and `tsc` does not
 * typecheck it either -- which is how a merge once left it unparseable with
 * every other check green.
 *
 * So this asserts the PROPERTY over the source, the way
 * `tests/agents/quality-messages.test.ts` asserts that no message a model reads
 * carries an issue number. It is a weaker instrument than driving the function
 * and it is the strongest one available from here; the deploy script drives the
 * branches that CAN be driven over the network, on every deploy.
 *
 * What went wrong without it: `sessionAllowed` returned a boolean, so every way
 * of failing to ASK collapsed into "this session is not valid" -- a 429 under a
 * burst, a 5xx, a dropped connection. The caller got 401, and the page clears a
 * session the office refused, correctly. An upstream hiccup signed the person
 * out.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')

/**
 * The body of one named function in that file, by brace counting.
 *
 * Counting from the DECLARATION is wrong and the first draft did it: a return
 * type like `Promise<{ response: Response }>` opens and closes a brace before
 * the body does, so the walk stopped inside the signature and every assertion
 * about the body failed against a correct file. It counts from the arrow.
 */
const bodyOf = (declaration: string): string => {
  const found = SOURCE.indexOf(declaration)
  expect(found, `${declaration} is not in the gateway any more`).toBeGreaterThan(-1)
  const at = SOURCE.indexOf('=> {', found)
  expect(at, `${declaration} has no arrow body`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = at; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1
    if (SOURCE[i] === '}') {
      depth -= 1
      if (depth === 0) return SOURCE.slice(at, i + 1)
    }
  }
  throw new Error(`${declaration} never closes`)
}

describe('the gateway separates refused from could-not-check', () => {
  it('has three verdicts rather than a boolean', () => {
    expect(SOURCE).toMatch(/type Verdict = 'yes' \| 'no' \| 'unknown'/)
    expect(SOURCE).toMatch(/const sessionAllowed = async \([^)]*\): Promise<Verdict>/)
    expect(SOURCE).toMatch(/const allowed = async \([^)]*\): Promise<Verdict>/)
  })

  it('calls a session invalid only when the identity service SAID so', () => {
    const body = bodyOf('const sessionAllowed = async')
    /*
      401 and 403 are a refusal. Everything else that is not ok -- 429, 5xx, a
      gateway error -- is a failure to answer. Asserted as the shape rather than
      as a literal line, because a rewording of the condition is not a change of
      behaviour and a wording lock is the mistake this repository has made six
      times.
    */
    expect(body).toMatch(/status === 401 \|\| [a-z.]*status === 403/)
    expect(body).toMatch(/'unknown'/)
    // And never the other way round: a bare "not ok means no" is the defect.
    expect(body).not.toMatch(/if \(!who\.ok\) return 'no'/)
  })

  it('never reads a failure to reach the membership list as not being on it', () => {
    const body = bodyOf('const sessionAllowed = async')
    const membership = body.slice(body.indexOf('office_member'))
    expect(membership).toMatch(/if \(!membership\.response\.ok\) return 'unknown'/)
  })

  it('retries a throttle rather than treating it as an answer', () => {
    const body = bodyOf('const askUpstream = async')
    expect(body).toMatch(/status === 429/)
  })

  it('answers an unknown verdict with a status the page does not sign out on', () => {
    /*
      The whole point. office.js clears the session on 401 and keeps it on
      anything else, so the status code IS the behaviour: 401 for a refusal,
      503 for "could not check".
    */
    expect(SOURCE).toMatch(
      /if \(verdict === 'no'\) \{\s*\n\s*return json\(\{ error: 'unauthorized' \}, 401\)/,
    )
    expect(SOURCE).toMatch(/if \(verdict === 'unknown'\)/)
    const at = SOURCE.indexOf("if (verdict === 'unknown')")
    expect(SOURCE.slice(at, at + 400)).toMatch(/\n\s*503,\n/)
    expect(SOURCE.slice(at, at + 400)).not.toMatch(/401/)
  })
})
