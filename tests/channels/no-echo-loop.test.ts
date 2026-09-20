/**
 * NO DOOR MAY READ THE OFFICE'S OWN OUTPUT AS INPUT (#282).
 *
 * The mission's last coherence requirement: cross-channel with no echo loops
 * and no duplicated action.
 *
 * `src/slack/events.ts` refuses an event from this app before anything else
 * looks at it — "because every other branch would happily process it".
 * `src/channels/telegram.ts` had no equivalent: `from.is_bot` was declared in
 * its update type and read by NOTHING, which is the dial-with-no-reader shape
 * on the one field that stops a loop.
 *
 * ## Why it had not fired
 *
 * In a private chat Telegram does not hand a bot its own messages. That is an
 * accident of the current configuration, not a design: a bot in a GROUP does
 * receive other bots' messages, `telegram.direct_to_grant` decides which of
 * those two Grant gets, and six retired staff bots are still rows in
 * `telegram_bots`. Each is one setting away from the office answering itself,
 * in a loop with a model call in it.
 *
 * ## The property, both ways
 *
 * A guard that refuses everything would pass the first half of this file and
 * be a worse defect than the one it fixes, so every refusal here has its
 * counterpart: the same shape from a person still gets through.
 *
 * That counterpart earned its place on the first run. Slack takes
 * `(envelope, botUserId, now)` and Telegram takes `(update, now, botId)`, and
 * the first draft passed them in one order to both — so BOTH Slack refusal
 * tests passed on `now.toISOString is not a function`, a refusal for entirely
 * the wrong reason, which CLAUDE.md records as looking exactly like the rule
 * working. Only the control that expects SUCCESS could tell the difference.
 */
import { describe, expect, it } from 'vitest'
import { toCanonicalCommand as telegramCommand } from '../../src/channels/telegram.ts'
import { toCanonicalCommand as slackCommand } from '../../src/slack/events.ts'

const AT = new Date('2026-09-20T12:00:00Z')

describe('telegram refuses its own output', () => {
  it('a message from a bot is not an instruction', () => {
    expect(() =>
      telegramCommand(
        {
          update_id: 1,
          message: {
            message_id: 10,
            date: 1789900000,
            chat: { id: 42, type: 'private' },
            from: { id: 999, is_bot: true },
            text: 'Still on this — 11 minutes in.',
          },
        },
        AT,
      ),
    ).toThrow()
  })

  it('CONTROL: the identical message from a PERSON is an instruction', () => {
    /*
      The half that makes the guard a guard rather than a mute. Same chat, same
      text, same shape — only `is_bot` differs.
    */
    const got = telegramCommand(
      {
        update_id: 1,
        message: {
          message_id: 10,
          date: 1789900000,
          chat: { id: 42, type: 'private' },
          from: { id: 1386648496, is_bot: false },
          text: 'Still on this — 11 minutes in.',
        },
      },
      AT,
    )
    expect(got.instruction).toBe('Still on this — 11 minutes in.')
    expect(got.origin_channel).toBe('telegram')
  })

  it('CONTROL: a message with no from at all is still read', () => {
    /*
      `is_bot` is optional and absent on some update shapes. Refusing on
      "not explicitly false" would silence real traffic — the expensive
      direction — so the test pins the comparison rather than the field.
    */
    const got = telegramCommand(
      {
        update_id: 2,
        message: {
          message_id: 11,
          date: 1789900000,
          chat: { id: 42, type: 'private' },
          text: 'hello',
        },
      },
      AT,
    )
    expect(got.instruction).toBe('hello')
  })

  it('a bot voice note is refused too, not only text', () => {
    expect(() =>
      telegramCommand(
        {
          update_id: 3,
          message: {
            message_id: 12,
            date: 1789900000,
            chat: { id: 42, type: 'private' },
            from: { id: 999, is_bot: true },
            voice: { file_id: 'abc', duration: 4 },
          },
        },
        AT,
      ),
    ).toThrow()
  })
})

describe('slack refuses its own output, and still did', () => {
  it('an event from this app is not an instruction', () => {
    expect(() =>
      slackCommand(
        {
          type: 'event_callback',
          team_id: 'T1',
          event: {
            type: 'message',
            channel: 'C1',
            user: 'UBOT',
            ts: '1.1',
            text: 'Emma has it — Research Director.',
          },
        },
        'UBOT',
        AT,
      ),
    ).toThrow()
  })

  it('and so is anything carrying a bot_id', () => {
    expect(() =>
      slackCommand(
        {
          type: 'event_callback',
          team_id: 'T1',
          event: {
            type: 'message',
            channel: 'C1',
            user: 'U2',
            bot_id: 'B9',
            ts: '1.1',
            text: 'posted by an app',
          },
        },
        'UBOT',
        AT,
      ),
    ).toThrow()
  })

  it('CONTROL: a person in the same channel gets through', () => {
    const got = slackCommand(
      {
        type: 'event_callback',
        team_id: 'T1',
        event: { type: 'message', channel: 'C1', user: 'U2', ts: '1.1', text: 'what is open?' },
      },
      'UBOT',
      AT,
    )
    expect(got.instruction).toBe('what is open?')
  })
})

describe('the property, so a third door cannot ship without a guard', () => {
  it('every adapter that canonicalises a message refuses one it sent itself', () => {
    /*
      Asserted over the adapters rather than one at a time. A new surface that
      writes to `inbound_commands` and has no self-check is the same defect,
      and the point of a property is that it covers the door nobody has written
      yet — so this fails the day one is added to the list without a guard.
    */
    const doors: { name: string; own: () => unknown }[] = [
      {
        name: 'telegram',
        own: () =>
          telegramCommand(
            {
              update_id: 9,
              message: {
                message_id: 90,
                date: 1789900000,
                chat: { id: 42, type: 'private' },
                from: { id: 999, is_bot: true },
                text: 'our own words',
              },
            },
            AT,
          ),
      },
      {
        name: 'slack',
        own: () =>
          slackCommand(
            {
              type: 'event_callback',
              team_id: 'T1',
              event: {
                type: 'message',
                channel: 'C1',
                user: 'UBOT',
                ts: '1.1',
                text: 'our own words',
              },
            },
            'UBOT',
            AT,
          ),
      },
    ]
    for (const door of doors) {
      expect(door.own, `${door.name} read its own output as an instruction`).toThrow()
    }
  })
})
