import { describe, expect, it } from 'vitest'
import {
  NOT_SWITCHED_ON,
  normaliseEmail,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  passwordSessionFrom,
  passwordSignInEnabled,
  SIGN_IN_REFUSED,
} from '../../src/auth/password.ts'

describe('normaliseEmail', () => {
  it('trims and lower-cases an address that has the shape of one', () => {
    expect(normaliseEmail('  Grant.Rogers@Example.TEST ')).toBe('grant.rogers@example.test')
  })

  it('refuses an address without an @, a domain dot or a space', () => {
    expect(normaliseEmail('grant.example.test')).toBeNull()
    expect(normaliseEmail('grant@example')).toBeNull()
    expect(normaliseEmail('grant rogers@example.test')).toBeNull()
    expect(normaliseEmail('')).toBeNull()
  })
})

describe('passwordProblem', () => {
  const email = 'grant@example.test'

  it('accepts a password of the minimum length that does not contain the address', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH), email)).toBeNull()
  })

  it('refuses one character short, with the number in the sentence', () => {
    expect(passwordProblem('x'.repeat(PASSWORD_MIN_LENGTH - 1), email)).toBe(
      `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`,
    )
  })

  it('refuses spaces only, however long', () => {
    expect(passwordProblem(' '.repeat(30), email)).toBe('A password needs more than spaces.')
  })

  it('refuses a password longer than the bytes Auth can hash, counting bytes not characters', () => {
    expect(passwordProblem('a'.repeat(PASSWORD_MAX_BYTES + 1), email)).toMatch(/at most 72 bytes/)
    // 30 snowmen is 30 characters but 90 bytes.
    expect(passwordProblem('☃'.repeat(30), email)).toMatch(/at most 72 bytes/)
  })

  it('refuses a password that contains the local part of the address', () => {
    expect(passwordProblem('grant-secret-phrase-2026', email)).toBe(
      'A password should not contain your address.',
    )
  })

  it('does not refuse a password that merely shares a short local part', () => {
    // a two-letter local part would refuse half of all passwords, so the rule does not apply to it at all.
    expect(passwordProblem('a long passphrase with the letter g', 'g@example.test')).toBeNull()
  })
})

describe('passwordSessionFrom', () => {
  const now = 1_000_000

  it('turns a token answer into the session the page stores, with a deadline', () => {
    expect(
      passwordSessionFrom({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }, now),
    ).toEqual({ access_token: 'a', refresh_token: 'r', expires_at: now + 3_600_000 })
  })

  it('refuses an answer without a token, rather than storing a session that cannot be presented', () => {
    expect(passwordSessionFrom({ refresh_token: 'r', expires_in: 60 }, now)).toBeNull()
    expect(passwordSessionFrom({ access_token: 'a', expires_in: 60 }, now)).toBeNull()
    expect(passwordSessionFrom(null, now)).toBeNull()
    expect(passwordSessionFrom('a string', now)).toBeNull()
  })

  it('bounds a lifetime that is absurd in either direction', () => {
    const short = passwordSessionFrom({ access_token: 'a', refresh_token: 'r', expires_in: 1 }, now)
    expect(short?.expires_at).toBe(now + 60_000)
    const long = passwordSessionFrom(
      { access_token: 'a', refresh_token: 'r', expires_in: 1e12 },
      now,
    )
    expect(long?.expires_at).toBe(now + 86_400_000)
    const missing = passwordSessionFrom({ access_token: 'a', refresh_token: 'r' }, now)
    expect(missing?.expires_at).toBe(now + 3_600_000)
  })
})

describe('passwordSignInEnabled', () => {
  it('is off unless the setting says so in words', () => {
    expect(passwordSignInEnabled(undefined)).toBe(false)
    expect(passwordSignInEnabled('')).toBe(false)
    expect(passwordSignInEnabled('yes')).toBe(false)
    expect(passwordSignInEnabled('0')).toBe(false)
    expect(passwordSignInEnabled('1')).toBe(true)
    expect(passwordSignInEnabled('true')).toBe(true)
  })

  it('keeps the sentences the page shows when it is off or refused', () => {
    expect(NOT_SWITCHED_ON).toMatch(/not switched on/)
    expect(SIGN_IN_REFUSED).toMatch(/do not match an account/)
  })
})

describe('the sign-in function uses the decisions in this file', () => {
  // Source wiring, not a unit: the function cannot be imported under Node. The property is that the three actions
  // consult the switch and the policy, by calling them, not by naming them.
  it('gates every password action on the switch before doing anything else', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(
      new URL('../../supabase/functions/signin/index.ts', import.meta.url),
      'utf8',
    )
    const gate = "if (!passwordSignInEnabled(Deno.env.get('PASSWORD_SIGN_IN')))"
    expect(source.indexOf(gate)).toBeGreaterThan(-1)
    expect(source.indexOf(gate)).toBeLessThan(source.indexOf("if (action === 'password_reset') {"))
    expect(source).toMatch(/passwordProblem\(password, email\)/)
    expect(source).toMatch(/passwordSessionFrom\(await signed\.json\(\), Date\.now\(\)\)/)
  })
})
