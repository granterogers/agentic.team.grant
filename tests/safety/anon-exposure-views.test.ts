import { describe, expect, it } from 'vitest'
import { VIEW_EXPOSURE_SQL, viewReachableByAPublicKey } from '../../src/safety/anon-exposure.ts'

/**
 * #457: a view reads with its owner's rights, so row security on the tables underneath does not protect it. The predicate must catch a
 * view a public key can select, spare one that runs as the caller, and spare one nobody public can select.
 */
const v = (over: Partial<Parameters<typeof viewReachableByAPublicKey>[0]> = {}) => ({
  name: 'synthetic',
  invoker: false,
  anon: false,
  authenticated: false,
  ...over,
})

describe('viewReachableByAPublicKey', () => {
  it('catches a view anon can select', () => {
    expect(viewReachableByAPublicKey(v({ anon: true }))).toBe(true)
  })
  it('catches a view only an authenticated person can select (anybody who signs up)', () => {
    expect(viewReachableByAPublicKey(v({ authenticated: true }))).toBe(true)
  })
  it('spares a view no public role can select', () => {
    expect(viewReachableByAPublicKey(v())).toBe(false)
  })
  it('spares a security_invoker view (the caller is subject to the tables row security)', () => {
    expect(viewReachableByAPublicKey(v({ invoker: true, anon: true, authenticated: true }))).toBe(
      false,
    )
  })
})

describe('the query', () => {
  it('asks the catalogue for views and materialised views of public, with both roles and the option', () => {
    expect(VIEW_EXPOSURE_SQL).toMatch(/relkind in \('v', 'm'\)/)
    expect(VIEW_EXPOSURE_SQL).toMatch(/has_table_privilege\('anon'/)
    expect(VIEW_EXPOSURE_SQL).toMatch(/has_table_privilege\('authenticated'/)
    expect(VIEW_EXPOSURE_SQL).toMatch(/security_invoker=true/)
  })
})
