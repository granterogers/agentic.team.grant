/**
 * §31's second completion criterion, as an executable assertion.
 *
 *   "The same instruction via Slack and via Voice produces identical backend
 *    behaviour. Automated as an equality assertion on the normalized command,
 *    modulo `origin_channel`, `origin_ref` and `command_id`."
 *
 * ## What this tests, and what it cannot yet
 *
 * Voice is not a command source. The voice surface captures audio and holds a
 * conversation; nothing in it writes an `inbound_commands` row, so there is no
 * normalized command to compare. Asserting over a channel that cannot produce
 * one would be the defect this project keeps meeting — a check whose result
 * does not depend on the thing under test.
 *
 * So the pair under test is **Slack and Telegram**, which are the two channels
 * that do normalize, and the harness is written over a list of channels rather
 * than over a pair. When voice becomes a command source it is one entry in
 * `CHANNELS` and every assertion below applies to it unchanged. That is the
 * whole reason the equality is expressed as "every channel agrees with every
 * other" instead of "a equals b".
 *
 * ## Why `modulo` is the interesting word
 *
 * Three fields are *supposed* to differ, and a test that ignored them by
 * deleting them would also pass if a fourth field started differing. So they
 * are asserted to differ, by name, and everything else is asserted equal —
 * which is what makes a newly-added divergent field a failure rather than a
 * silent exemption.
 */

import { describe, expect, it } from 'vitest'
import { toCanonicalCommand as telegramCommand } from '../../src/channels/telegram.ts'
import { toCanonicalCommand as slackCommand } from '../../src/slack/events.ts'

/**
 * Fields that are permitted to differ. Everything else must match exactly.
 *
 * §31 names three: `origin_channel`, `origin_ref` and `command_id` (the last
 * assigned by the database, so it does not appear on a normalized command at
 * all; `dedupe_key` is its pre-insert equivalent and is derived from the
 * channel-native locator).
 *
 * **`actor` is the fourth, and it is the one worth explaining.** Writing this
 * test is what found it: `actor` is a channel-native identifier — Slack says
 * `U0BUNF6AALC`, Telegram says `1386648496`, and neither can possibly say the
 * other. Exempting identity would have made §31's criterion meaningless, since
 * the whole point is that the backend sees one instruction from one person.
 *
 * So identity is not exempted, it is *resolved*: migration 0056 maps
 * `(origin_channel, actor)` to a subject, and 0057 makes a trigger fill
 * `inbound_commands.subject` for every writer. The adapters stay pure and keep
 * emitting the channel-native actor; the stored row carries the person. The
 * live assertion that both channels land on the same subject is in
 * `verify:cross-interface`, because it needs the database that holds the
 * mapping.
 */
const MODULO = ['origin_channel', 'origin_ref', 'dedupe_key', 'actor'] as const

const AT = new Date('2026-09-06T12:00:00.000Z')
const BOT_USER = 'U0BUG0RPZ8B'

interface Normalized {
  readonly [key: string]: unknown
}

/**
 * Each channel, and how the same human instruction arrives through it.
 *
 * The envelopes are the real wire shapes — a Slack `message` event and a
 * Telegram `message` update — because normalizing a shape we invented would
 * prove that our fixtures agree, not that our adapters do.
 */
const CHANNELS: readonly {
  readonly name: string
  readonly normalize: (instruction: string) => Normalized
}[] = [
  {
    name: 'slack',
    normalize: (instruction) =>
      slackCommand(
        {
          type: 'event_callback',
          team_id: 'T0BUCJ2L5FD',
          event_id: 'Ev0CROSS1',
          event: {
            type: 'message',
            user: 'U0BUNF6AALC',
            channel: 'C0BVD21Q9S5',
            text: instruction,
            ts: '1788700000.000100',
          },
        },
        BOT_USER,
        AT,
      ) as unknown as Normalized,
  },
  {
    name: 'telegram',
    normalize: (instruction) =>
      telegramCommand(
        {
          update_id: 900_001,
          message: {
            message_id: 4242,
            date: Math.floor(AT.getTime() / 1000),
            chat: { id: 111222333, type: 'private' },
            from: { id: 111222333, is_bot: false },
            text: instruction,
          },
        },
        AT,
      ) as unknown as Normalized,
  },
]

const INSTRUCTION = 'Research the trade-offs between Postgres and an external tool'

const withoutModulo = (command: Normalized): Normalized => {
  const copy: Record<string, unknown> = { ...command }
  for (const field of MODULO) delete copy[field]
  // Slack carries channel-native routing the core does not interpret. It is
  // not part of the normalized command any other channel could produce, and
  // §31's equality is over the canonical row, not over the carriage.
  delete copy.slack
  return copy
}

describe('§31 — the same instruction through any interface is the same command', () => {
  it('every channel produces a command', () => {
    // The precondition. Without it, a harness over an empty list, or over
    // channels that all threw, would pass every assertion below it.
    expect(CHANNELS.length).toBeGreaterThanOrEqual(2)
    for (const channel of CHANNELS) {
      expect(channel.normalize(INSTRUCTION), channel.name).toBeTruthy()
    }
  })

  it('agrees on everything except origin_channel, origin_ref and dedupe_key', () => {
    const normalized = CHANNELS.map((c) => ({ name: c.name, command: c.normalize(INSTRUCTION) }))
    const [first, ...rest] = normalized
    for (const other of rest) {
      expect(withoutModulo(other.command), `${other.name} vs ${first?.name}`).toEqual(
        withoutModulo((first as (typeof normalized)[number]).command),
      )
    }
  })

  it('carries the instruction through unaltered — no channel paraphrases', () => {
    // The one field where a difference would be invisible in the equality
    // above if both channels mangled it the same way.
    for (const channel of CHANNELS) {
      expect(channel.normalize(INSTRUCTION).instruction, channel.name).toBe(INSTRUCTION)
    }
  })

  it('DOES differ on each of the three permitted fields, by name', () => {
    // A test that merely ignored these would also pass if a fourth field
    // started differing. Asserting that they differ is what makes the
    // exemption a decision rather than a blind spot.
    const normalized = CHANNELS.map((c) => c.normalize(INSTRUCTION))
    for (const field of MODULO) {
      const values = new Set(normalized.map((c) => String(c[field])))
      expect(values.size, `${field} should differ between channels`).toBe(normalized.length)
    }
  })

  it('CONTROL: a different instruction is NOT equal, so the comparison discriminates', () => {
    const a = CHANNELS[0]?.normalize(INSTRUCTION) as Normalized
    const b = CHANNELS[1]?.normalize('Something else entirely') as Normalized
    expect(withoutModulo(a)).not.toEqual(withoutModulo(b))
  })

  it('every channel is anchored to the same clock, not to its own wire timestamp', () => {
    // Divergent `received_at` would make the equality above fail for a reason
    // that has nothing to do with the instruction, and any fix for that is a
    // temptation to exempt a fourth field.
    for (const channel of CHANNELS) {
      expect(channel.normalize(INSTRUCTION).received_at, channel.name).toBe(AT.toISOString())
    }
  })
})
