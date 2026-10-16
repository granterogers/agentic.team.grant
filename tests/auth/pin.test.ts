/**
 * The sign-in PIN: how it is hashed, how it is compared, and when an account locks. Each refusal sits beside the
 * control that must still pass, so a check that refuses everything cannot read as passing.
 */
import { describe, expect, it } from 'vitest'
import {
  hashPin,
  isLocked,
  LOCK_MS,
  MAX_WRONG_TRIES,
  newSalt,
  nextAttempt,
  PIN_PATTERN,
  pinMatches,
} from '../../src/auth/pin.ts'

describe('a PIN is hashed, never kept as typed', () => {
  it('POSITIVE CONTROL: the PIN that set the hash is the one that matches it', async () => {
    const salt = newSalt()
    const hash = await hashPin('4821', salt)
    expect(await pinMatches('4821', salt, hash)).toBe(true)
  })

  it('a different PIN does not match', async () => {
    const salt = newSalt()
    const hash = await hashPin('4821', salt)
    expect(await pinMatches('4822', salt, hash)).toBe(false)
  })

  it('the same PIN under another salt gives another hash, so equal PINs do not look alike in storage', async () => {
    const a = await hashPin('4821', newSalt())
    const b = await hashPin('4821', newSalt())
    expect(a).not.toBe(b)
  })

  it('the hash is not the PIN', async () => {
    const salt = newSalt()
    const hash = await hashPin('4821', salt)
    expect(hash).not.toContain('4821')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a value that is not a PIN never matches, whatever hash it is compared with', async () => {
    const salt = newSalt()
    const hash = await hashPin('4821', salt)
    expect(await pinMatches('', salt, hash)).toBe(false)
    expect(await pinMatches('abcd', salt, hash)).toBe(false)
  })
})

describe('what a PIN may be', () => {
  it('POSITIVE CONTROL: four to eight digits', () => {
    expect(PIN_PATTERN.test('1234')).toBe(true)
    expect(PIN_PATTERN.test('12345678')).toBe(true)
  })

  it('three digits, nine digits, letters and spaces are refused', () => {
    expect(PIN_PATTERN.test('123')).toBe(false)
    expect(PIN_PATTERN.test('123456789')).toBe(false)
    expect(PIN_PATTERN.test('12a4')).toBe(false)
    expect(PIN_PATTERN.test('12 34')).toBe(false)
  })
})

describe('the wrong tries lock the account for a while', () => {
  const now = 1_800_000_000_000

  it('POSITIVE CONTROL: a correct PIN is not locked and clears a count already begun', () => {
    const after = nextAttempt({ fails: 3, lockedUntil: null }, true, now)
    expect(after).toEqual({ fails: 0, lockedUntil: null })
    expect(isLocked(after, now)).toBe(false)
  })

  it('wrong tries are counted, and the account is not locked before the last one', () => {
    let state = { fails: 0, lockedUntil: null as number | null }
    for (let i = 1; i < MAX_WRONG_TRIES; i++) {
      state = nextAttempt(state, false, now)
      expect(state.fails).toBe(i)
      expect(isLocked(state, now)).toBe(false)
    }
  })

  it('the fifth wrong try locks the account for fifteen minutes', () => {
    let state = { fails: MAX_WRONG_TRIES - 1, lockedUntil: null as number | null }
    state = nextAttempt(state, false, now)
    expect(isLocked(state, now)).toBe(true)
    expect(state.lockedUntil).toBe(now + LOCK_MS)
    expect(isLocked(state, now + LOCK_MS)).toBe(false)
  })

  it('a locked account is refused until the lock ends, and the lock ends on time', () => {
    const locked = { fails: 0, lockedUntil: now + LOCK_MS }
    expect(isLocked(locked, now + LOCK_MS - 1)).toBe(true)
    expect(isLocked(locked, now + LOCK_MS)).toBe(false)
  })
})
