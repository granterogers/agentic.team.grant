import { describe, expect, it } from 'vitest'
import { buildPoolerUri, SESSION_POOLER_PORT } from '../../scripts/backup/resolve-connection.ts'

const pooler = {
  db_user: 'postgres.abcdefghijklmnop',
  db_host: 'aws-0-eu-central-1.pooler.supabase.com',
  db_name: 'postgres',
}
const direct = 'postgresql://postgres:pw123456@db.x.supabase.co:5432/postgres'

describe('buildPoolerUri', () => {
  it('uses session mode, not the transaction pooler', () => {
    // pg_dump holds a session and relies on session-scoped state, so port 6543
    // cannot be used however prominently the API reports it.
    expect(SESSION_POOLER_PORT).toBe(5432)
    const uri = buildPoolerUri(direct, pooler)
    expect(uri).toContain(':5432/')
    expect(uri).not.toContain('6543')
  })

  it('takes the host and user from the pooler config, not the direct URL', () => {
    const uri = buildPoolerUri(direct, pooler)
    expect(uri).toContain('aws-0-eu-central-1.pooler.supabase.com')
    expect(uri).toContain('postgres.abcdefghijklmnop')
    expect(uri).not.toContain('db.x.supabase.co')
  })

  it('carries the password across from the direct URL', () => {
    expect(new URL(buildPoolerUri(direct, pooler)).password).toBe('pw123456')
  })

  it('percent-encodes the password exactly once', () => {
    const uri = buildPoolerUri(
      'postgresql://postgres:p%40ss@db.x.supabase.co:5432/postgres',
      pooler,
    )
    expect(new URL(uri).password).toBe('p%40ss')
    expect(new URL(uri).password).not.toContain('%2540')
  })

  it('escapes a literal % in the password', () => {
    // The case that WHATWG URL's userinfo encode set does NOT cover. An
    // unescaped % reaches libpq as a malformed escape, and the symptom is
    // authentication refused with a correct password.
    const uri = buildPoolerUri(
      `postgresql://postgres:${encodeURIComponent('50%off')}@db.x.supabase.co:5432/postgres`,
      pooler,
    )
    expect(new URL(uri).password).toBe('50%25off')
    expect(decodeURIComponent(new URL(uri).password)).toBe('50%off')
  })

  it('round-trips a password containing URL-significant characters', () => {
    // Supabase-generated passwords can contain @ : / ? # and %. Getting this
    // wrong produces a connection failure that looks like a wrong password.
    const raw = 'p@ss:w/rd?#%&=+ x'
    const url = `postgresql://postgres:${encodeURIComponent(raw)}@db.x.supabase.co:5432/postgres`
    // libpq percent-decodes the URI, so the stored form is encoded once and
    // decoding it must return exactly what went in.
    expect(decodeURIComponent(new URL(buildPoolerUri(url, pooler)).password)).toBe(raw)
  })

  it('requests TLS explicitly', () => {
    expect(buildPoolerUri(direct, pooler)).toContain('sslmode=require')
  })

  it('refuses a direct URL with no password rather than emitting a broken URI', () => {
    expect(() =>
      buildPoolerUri('postgresql://postgres@db.x.supabase.co:5432/postgres', pooler),
    ).toThrow(/no password/)
  })
})
