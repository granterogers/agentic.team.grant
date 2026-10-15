/**
 * A sign-in PIN, chosen by the person it signs in (owner decision, 15 October 2026).
 *
 * A PIN is never stored or compared as typed. It is hashed with PBKDF2-SHA256 and a random salt, the same way for the
 * terminal that sets it and the sign-in function that checks it, so the two cannot drift. A PIN is short, so the
 * guess-counter is the real protection: after five wrong tries the account is locked for fifteen minutes, and a
 * correct PIN clears the count.
 *
 * Plain TypeScript with no Deno or DOM dependency, so vitest drives the very code the function runs.
 */

export const PIN_PATTERN = /^[0-9]{4,8}$/
export const PIN_ITERATIONS = 210_000
export const MAX_WRONG_TRIES = 5
export const LOCK_MS = 15 * 60 * 1000

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A fresh salt, as hex. */
export const newSalt = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)))

/** PBKDF2-SHA256 of the PIN with the salt, as hex. */
export const hashPin = async (pin: string, saltHex: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PIN_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return toHex(new Uint8Array(bits))
}

/** Whether the PIN is the one this salt and hash were made from. The comparison takes the same time either way. */
export const pinMatches = async (
  pin: string,
  saltHex: string,
  hashHex: string,
): Promise<boolean> => {
  if (!PIN_PATTERN.test(pin)) return false
  const candidate = fromHex(await hashPin(pin, saltHex))
  const stored = fromHex(hashHex)
  if (candidate.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < candidate.length; i++) diff |= (candidate[i] ?? 0) ^ (stored[i] ?? 0)
  return diff === 0
}

export interface AttemptState {
  fails: number
  lockedUntil: number | null
}

/** Whether the account is locked at this moment. */
export const isLocked = (state: AttemptState, now: number): boolean =>
  state.lockedUntil !== null && state.lockedUntil > now

/**
 * The counter after one attempt. A correct PIN clears it. The fifth wrong one locks the account for LOCK_MS and
 * starts the count again, so a locked account never accumulates a second lock from the same wrong tries.
 */
export const nextAttempt = (state: AttemptState, ok: boolean, now: number): AttemptState => {
  if (ok) return { fails: 0, lockedUntil: null }
  const fails = state.fails + 1
  if (fails >= MAX_WRONG_TRIES) return { fails: 0, lockedUntil: now + LOCK_MS }
  return { fails, lockedUntil: null }
}
