import { describe, expect, it } from 'vitest'
import type { TelegramUpdate } from '../../src/channels/telegram.ts'
import {
  CALLBACK_ACTIONS,
  secretMatches,
  toCanonicalCommand,
  UnsupportedUpdateError,
} from '../../src/channels/telegram.ts'

const NOW = new Date('2026-09-03T12:00:00.000Z')

const message = (over: Partial<NonNullable<TelegramUpdate['message']>> = {}): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 42,
    date: 1_756_900_000,
    text: 'have a look at the website idea',
    chat: { id: -100123, type: 'private' },
    from: { id: 777, username: 'grant' },
    ...over,
  },
})

const callback = (data: string, id = 'cb-1'): TelegramUpdate => ({
  update_id: 2,
  callback_query: {
    id,
    data,
    from: { id: 777, username: 'grant' },
    message: { message_id: 42, chat: { id: -100123 } },
  },
})

describe('secretMatches', () => {
  // Telegram's webhook has NO signature. X-Telegram-Bot-Api-Secret-Token is the
  // only authentication, so this comparison is the security boundary.
  const secret = 'a'.repeat(32)

  it('accepts the correct secret', () => {
    expect(secretMatches(secret, secret)).toBe(true)
  })

  it('rejects a wrong secret of the same length', () => {
    expect(secretMatches('b'.repeat(32), secret)).toBe(false)
  })

  it('rejects a wrong secret of a different length', () => {
    // The obvious `a.length !== b.length` early return is a length oracle.
    expect(secretMatches('b'.repeat(8), secret)).toBe(false)
    expect(secretMatches('a'.repeat(64), secret)).toBe(false)
  })

  it.each([[null], [undefined], ['']])('rejects a missing secret (%s)', (presented) => {
    expect(secretMatches(presented, secret)).toBe(false)
  })

  it('rejects everything when no secret is configured', () => {
    // Otherwise a misconfigured deployment would accept unauthenticated
    // requests, which is worse than refusing all of them.
    expect(secretMatches('anything', '')).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })

  it('does not throw on a length mismatch', () => {
    // node's timingSafeEqual throws on unequal lengths; a naive wrapper would
    // turn a hostile request into a 500.
    expect(() => secretMatches('short', secret)).not.toThrow()
  })
})

describe('a text message becomes a canonical command', () => {
  it('carries the raw instruction, never pre-digested (§1)', () => {
    const command = toCanonicalCommand(message(), NOW)
    expect(command.instruction).toBe('have a look at the website idea')
  })

  it('records origin_channel and a channel-native origin_ref', () => {
    const command = toCanonicalCommand(message(), NOW)
    expect(command.origin_channel).toBe('telegram')
    expect(command.origin_ref).toBe('-100123:42')
  })

  it('decides nothing — no intent_class field exists to fill', () => {
    // §5: adapters may only translate. A field the adapter cannot fill is a
    // field the adapter cannot decide.
    const command = toCanonicalCommand(message(), NOW)
    expect(Object.keys(command)).not.toContain('intent_class')
    expect(Object.keys(command)).not.toContain('recipient_agent')
  })

  it('keys dedupe on chat+message, which survives redelivery', () => {
    // update_id changes on redelivery; chat+message does not.
    const first = toCanonicalCommand({ ...message(), update_id: 1 }, NOW)
    const redelivered = toCanonicalCommand({ ...message(), update_id: 99 }, NOW)
    expect(first.dedupe_key).toBe(redelivered.dedupe_key)
  })

  it.each([[''], ['   '], ['\n\t ']])('rejects an empty message text (%j)', (text) => {
    expect(() => toCanonicalCommand(message({ text }), NOW)).toThrow(UnsupportedUpdateError)
  })

  it('rejects an update with neither message nor callback', () => {
    expect(() => toCanonicalCommand({ update_id: 7 }, NOW)).toThrow(UnsupportedUpdateError)
  })
})

describe('callback queries', () => {
  it.each([...CALLBACK_ACTIONS].filter((a) => a !== 'undo'))('accepts %s', (action) => {
    const command = toCanonicalCommand(callback(action), NOW)
    expect(command.callback_action).toBe(action)
  })

  it('rejects an unknown action rather than passing it through', () => {
    // §10: never let free-form input reach a tool call.
    expect(() => toCanonicalCommand(callback('drop_database:1'), NOW)).toThrow(
      UnsupportedUpdateError,
    )
  })

  it('rejects a callback with no data at all', () => {
    expect(() => toCanonicalCommand(callback(''), NOW)).toThrow(UnsupportedUpdateError)
  })

  it('keys dedupe on the CALLBACK id, not the update id', () => {
    // Telegram may redeliver the same callback under a new update_id. Keying on
    // update_id would let a redelivery through, which is what §6 forbids.
    const first = toCanonicalCommand({ ...callback('useful', 'cb-9'), update_id: 5 }, NOW)
    const redelivered = toCanonicalCommand({ ...callback('useful', 'cb-9'), update_id: 6 }, NOW)
    expect(first.dedupe_key).toBe('telegram:callback:cb-9')
    expect(first.dedupe_key).toBe(redelivered.dedupe_key)
  })

  it('distinguishes two genuinely different callbacks', () => {
    const a = toCanonicalCommand(callback('useful', 'cb-1'), NOW)
    const b = toCanonicalCommand(callback('useful', 'cb-2'), NOW)
    expect(a.dedupe_key).not.toBe(b.dedupe_key)
  })
})

describe('undo carries the original event id (§6)', () => {
  const eventId = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'

  it('extracts a well-formed uuid', () => {
    const command = toCanonicalCommand(callback(`undo:${eventId}`), NOW)
    expect(command.compensates_event_id).toBe(eventId)
  })

  it.each([
    ['undo:not-a-uuid', 'malformed'],
    ['undo:', 'empty'],
    ['undo', 'absent'],
    ["undo:'; drop table events; --", 'an injection attempt'],
  ])('rejects %j (%s) rather than looking it up', (data) => {
    // This payload is used to look up an event. §10 forbids free-form model or
    // user input reaching a tool call, and a button payload is user input.
    expect(() => toCanonicalCommand(callback(data), NOW)).toThrow(UnsupportedUpdateError)
  })

  it('leaves compensates_event_id null for non-undo actions', () => {
    expect(toCanonicalCommand(callback('useful'), NOW).compensates_event_id).toBeNull()
  })
})
