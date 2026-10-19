/**
 * The vault's master token, read for the reader (src/notebook/http-adapter.ts).
 *
 * The reader mints a fresh cookie jar from this token on each read, so the
 * parser is the one place a malformed or half-uploaded token can go wrong
 * silently. It must say "no master token" for anything it cannot use, and never
 * hand the reader a partial credential.
 */
import { describe, expect, it } from 'vitest'
import { masterTokenFrom } from '../../src/notebook/http-adapter.ts'

const good = {
  email: 'notebooks@example.com',
  android_id: '0123456789abcdef',
  master_token: 'aas_et/AKppINZexample',
  version: 1,
}

describe('masterTokenFrom', () => {
  it('reads the three fields the reader mints from, and nothing else', () => {
    expect(masterTokenFrom(JSON.stringify(good))).toEqual({
      email: good.email,
      android_id: good.android_id,
      master_token: good.master_token,
    })
  })

  it('is null for an empty vault value', () => {
    expect(masterTokenFrom('')).toBeNull()
  })

  it('is null for text that is not JSON', () => {
    expect(masterTokenFrom('not json')).toBeNull()
  })

  it('is null when a field is missing, so a partial credential is never sent', () => {
    for (const key of ['email', 'android_id', 'master_token'] as const) {
      const partial: Record<string, unknown> = { ...good }
      delete partial[key]
      expect(masterTokenFrom(JSON.stringify(partial)), key).toBeNull()
    }
  })

  it('is null for an empty field', () => {
    expect(masterTokenFrom(JSON.stringify({ ...good, email: '' }))).toBeNull()
    expect(masterTokenFrom(JSON.stringify({ ...good, android_id: '' }))).toBeNull()
  })

  it('is null for a cookie jar, which is not a master token', () => {
    // A storage_state.json has `cookies`, not `master_token`; it must not be mistaken for one.
    expect(masterTokenFrom(JSON.stringify({ cookies: [], origins: [] }))).toBeNull()
  })

  it('is null when the token lacks the aas_et/ prefix', () => {
    expect(masterTokenFrom(JSON.stringify({ ...good, master_token: 'ya29.something' }))).toBeNull()
  })

  it('is null for JSON that is not an object', () => {
    expect(masterTokenFrom('"aas_et/x"')).toBeNull()
    expect(masterTokenFrom('null')).toBeNull()
  })
})
