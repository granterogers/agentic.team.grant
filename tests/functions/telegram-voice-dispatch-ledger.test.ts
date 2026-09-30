import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Run 5, #391. The webhook's voice-note dispatch reserves against the CI ledger before it POSTs to GitHub and
  releases the reservation when GitHub refuses. Asserted as ORDER and CALL, not as names: the reservation is
  read as the condition of the dispatch, and the release sits in the failure branch of the same fetch.
*/
const src = readFileSync(
  new URL('../../supabase/functions/telegram-webhook/index.ts', import.meta.url),
  'utf8',
)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the voice-note dispatch asks the ledger', () => {
  const reserve = code.indexOf("rpcOne('ci_reserve'")
  const dispatch = code.indexOf('api.github.com/repos/')
  const release = code.indexOf("rpcOne('ci_release'")
  it('reserves before it dispatches', () => {
    expect(reserve).toBeGreaterThan(0)
    expect(dispatch).toBeGreaterThan(reserve)
  })
  it('dispatches only under a granted reservation', () => {
    const between = code.slice(reserve, dispatch)
    expect(between).toMatch(/reservation\?\.may === true/)
  })
  it('releases the reservation when GitHub did not accept, after the fetch', () => {
    expect(release).toBeGreaterThan(dispatch)
    expect(code.slice(dispatch, release)).toMatch(/!sent\.ok/)
  })
  it('has no other dispatch to GitHub', () => {
    expect((code.match(/api\.github\.com\/repos\//g) ?? []).length).toBe(1)
  })
})
