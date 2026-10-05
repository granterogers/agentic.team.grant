import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Multi-user P3. A Google credential belongs to an office, so every edge call that reads or stores one names the
  office, and the office is never a value the request supplied:

    - google-oauth's callback is reachable by anybody with the URL; the office is resolved IN THE DATABASE from the
      operator the consumed state was minted for (`office_of_operator`), then passed to both the credential read and
      the refresh-token store;
    - hq-api's Drive browse reads the credential as the VERIFIED SESSION's office.

  Asserted on the wired arguments of each call, not on names appearing in the file.
*/
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const oauth = strip(readFileSync('supabase/functions/google-oauth/index.ts', 'utf8'))
const api = strip(readFileSync('supabase/functions/hq-api/index.ts', 'utf8'))

/** The text of the argument object of the first `rpc('<fn>', { ... })` call, brace-matched. */
const argsOf = (src: string, fn: string): string => {
  const at = src.indexOf(`rpc('${fn}'`)
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open, i + 1)
    }
  }
  return ''
}

describe('the Google OAuth callback acts in the operator’s own office', () => {
  it('resolves the office from the consumed state’s operator, in the database, before reading the secret', () => {
    const resolve = oauth.indexOf("rpc('office_of_operator', { p_operator: operator })")
    const read = oauth.indexOf("rpc('deployment_credential'")
    const consume = oauth.indexOf("rpc('google_oauth_state_consume'")
    expect(consume).toBeGreaterThan(0)
    expect(resolve).toBeGreaterThan(consume)
    expect(read).toBeGreaterThan(resolve)
  })

  it('a callback whose operator has no office changes nothing', () => {
    const resolve = oauth.indexOf("rpc('office_of_operator'")
    const refusal = oauth.indexOf('is not for an office on this deployment', resolve)
    const read = oauth.indexOf("rpc('deployment_credential'")
    expect(refusal).toBeGreaterThan(resolve)
    expect(refusal).toBeLessThan(read)
  })

  it('passes that office to the credential read and to the refresh-token store', () => {
    expect(argsOf(oauth, 'deployment_credential')).toMatch(/\bp_office: office\b/)
    expect(argsOf(oauth, 'hq_store_google_refresh')).toMatch(/\bp_office: office\b/)
  })

  it('never takes the office from the request', () => {
    expect(oauth).not.toMatch(/searchParams\.get\('(p_)?office/)
    expect(oauth).not.toMatch(/p_office: (url|body|request)/)
  })
})

describe('the Drive browse reads the credential as the verified session’s office', () => {
  it('googleToken requires an office and sends it', () => {
    expect(api).toMatch(/const googleToken = async \(\s*operator: string,\s*office: string,/)
    expect(api).toMatch(/ask\('deployment_credential', \{\s*p_office: office,/)
  })

  it('and the caller passes the session’s own office, refusing when there is none', () => {
    expect(api).toMatch(
      /if \(office === null\) return json\(\{ error: 'no_office' \}, 403\)\s*const access = await googleToken\(String\(principal\), office\)/,
    )
  })

  it('CONTROL: the old shape (no office) would not match', () => {
    const old = "const v = await ask('deployment_credential', { p_name, p_operator: operator })"
    expect(/ask\('deployment_credential', \{\s*p_office: office,/.test(old)).toBe(false)
  })
})
