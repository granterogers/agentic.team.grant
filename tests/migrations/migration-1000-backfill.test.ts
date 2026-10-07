/**
 * Migration 1000's backfill must not assert that a Google credential works unless the database proves it. The behaviour is
 * driven against a real schema by scripts/isolated/google-connection-backfill.ts; this is the source-level guard that runs
 * on every `npm run test`, with a sabotage control for each assertion so that it is shown able to fail.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  'migrations/1000_a_google_credential_is_one_connection_of_an_office.sql',
  'utf8',
)
const code = (s: string): string => s.replace(/--[^\n]*/g, '')

const backfillOf = (sql: string): string => {
  const start = sql.indexOf(
    'insert into public.integration_connections (office_id, provider, account_ref, state, scopes, secret_name, revoked_at)',
  )
  const end = sql.indexOf('on conflict do nothing;', start)
  return start < 0 || end < 0 ? '' : sql.slice(start, end)
}

/** The decision the backfill makes, as the migration states it: the arms of the CASE, in order. */
const arms = (b: string): string[] =>
  [...b.matchAll(/when (.+?) then '(\w+)'/g)].map((m) => `${m[1]} => ${m[2]}`)

describe('the backfill states what the database can prove', () => {
  const b = backfillOf(SQL)

  it('exists, and is the statement the proof drives', () => {
    expect(b.length).toBeGreaterThan(200)
  })

  it('a credential is active only on a fresh ok reading of its own office', () => {
    const a = arms(b)
    expect(a[0]).toMatch(
      /^h\.state = 'ok' and h\.checked_at >= app\.now_utc\(\) - interval '24 hours' => active$/,
    )
    expect(a.filter((x) => x.endsWith('=> active'))).toHaveLength(1)
  })

  it('dead is not active; invalid_grant is revoked; anything else fails closed to unverified', () => {
    const a = arms(b)
    expect(a).toContain("h.state = 'dead' and h.detail ilike '%invalid\\_grant%' => revoked")
    expect(a).toContain("h.state = 'dead' => dead")
    expect(b).toMatch(/else 'unverified'/)
  })

  it('reads only the same office, with no join across offices', () => {
    expect(b).toMatch(
      /h\.office_id = o\.office_id and h\.service = 'google_calendar' and h\.credential = 'oauth_client'/,
    )
  })

  it('a revoked row carries its time (the table refuses one without)', () => {
    expect(b).toMatch(
      /case when p\.state = 'revoked' then coalesce\(h\.checked_at, app\.now_utc\(\)\) end/,
    )
  })

  it('never writes a literal active state (no unconditional "active" column)', () => {
    expect(b).not.toMatch(/'primary', 'active'/)
    expect(b).not.toMatch(/select 'active' as state/)
  })

  it('the table allows exactly the four states', () => {
    expect(code(SQL)).toMatch(/check \(state in \('active', 'unverified', 'dead', 'revoked'\)\)/)
  })

  it('never reads a secret value and never reaches the network', () => {
    expect(code(SQL)).not.toMatch(
      /decrypted_secrets|vault\.decrypt|pgsodium|\bhttp_|net\.http|pg_net|dblink/i,
    )
  })

  it('a trigger keeps the connection in step with recorded health, and cannot fail the health write', () => {
    const c = code(SQL)
    expect(c).toMatch(
      /create trigger c1_google_connection_follows_health\s+after insert or update of state, detail on public\.connection_health/,
    )
    // promotion is skipped (not raised) when another connection is active
    expect(c).toMatch(/and not exists \(select 1 from public\.integration_connections a/)
    // and a revoked connection is never promoted: only unverified and dead are
    expect(c).toMatch(/c\.state in \('unverified', 'dead'\)/)
  })
})

describe('sabotage: each guard above fails when the behaviour it guards is put back', () => {
  const b = backfillOf(SQL)
  const draft = b.replace(
    /cross join lateral \([\s\S]*?\) p\n/,
    "cross join lateral (select 'active' as state) p\n",
  )

  it('the original draft (everything active) is caught', () => {
    expect(draft).not.toBe(b)
    expect(arms(draft)).toHaveLength(0)
    expect(draft).toMatch(/select 'active' as state/)
    expect(draft).not.toMatch(/else 'unverified'/)
  })

  it('widening the ok arm to any age is caught', () => {
    const wide = b.replace(" and h.checked_at >= app.now_utc() - interval '24 hours'", '')
    expect(wide).not.toBe(b)
    expect(arms(wide)[0]).not.toMatch(/interval '24 hours'/)
  })

  it('letting a dead reading through to active is caught', () => {
    const bad = b.replace(
      "when h.state = 'dead' then 'dead'",
      "when h.state = 'dead' then 'active'",
    )
    expect(bad).not.toBe(b)
    expect(arms(bad).filter((x) => x.endsWith('=> active')).length).toBeGreaterThan(1)
  })
})
