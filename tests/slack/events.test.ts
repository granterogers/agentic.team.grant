/**
 * Command normalization, which Gate 4 asks for by name.
 *
 * core-invariants §1 says the instruction is *"never pre-digested by the
 * adapter"*, so several of these tests assert that text came through unchanged
 * — including text that a helpful adapter would be tempted to clean up.
 */
import { describe, expect, it } from 'vitest'
import {
  asUrlVerification,
  REACTION_ACTIONS,
  type SlackEnvelope,
  toCanonicalCommand,
  UnsupportedSlackEventError,
} from '../../src/slack/events.ts'

const BOT = 'U0BUG0RPZ8B'
const NOW = new Date('2026-09-03T12:00:00Z')

const envelope = (event: Record<string, unknown>): SlackEnvelope =>
  ({
    type: 'event_callback',
    team_id: 'T0BUCJ2L5FD',
    event_id: 'Ev123',
    event,
  }) as unknown as SlackEnvelope

describe('the URL verification handshake', () => {
  it('is recognised, because until it is answered the app cannot be configured', () => {
    expect(asUrlVerification({ type: 'url_verification', challenge: 'abc' })).toEqual({
      type: 'url_verification',
      challenge: 'abc',
    })
  })

  it('is not confused with an event, and tolerates junk', () => {
    expect(asUrlVerification({ type: 'event_callback' })).toBeNull()
    expect(asUrlVerification({ type: 'url_verification' })).toBeNull()
    expect(asUrlVerification(null)).toBeNull()
    expect(asUrlVerification('url_verification')).toBeNull()
    // A non-string challenge must not be echoed back as one.
    expect(asUrlVerification({ type: 'url_verification', challenge: 42 })).toBeNull()
  })
})

describe('messages', () => {
  it('normalizes a channel message', () => {
    const c = toCanonicalCommand(
      envelope({
        type: 'message',
        user: 'U_GRANT',
        channel: 'C123ABC',
        ts: '1770000000.000100',
        text: 'summarise the migration status',
      }),
      BOT,
      NOW,
    )
    expect(c.origin_channel).toBe('slack')
    expect(c.instruction).toBe('summarise the migration status')
    expect(c.origin_ref).toBe('C123ABC:1770000000.000100')
    expect(c.dedupe_key).toBe('slack:message:C123ABC:1770000000.000100')
    expect(c.slack.is_dm).toBe(false)
    expect(c.slack.thread_ts).toBeNull()
  })

  it('strips only the addressing mention, and keeps the rest verbatim', () => {
    const c = toCanonicalCommand(
      envelope({
        type: 'app_mention',
        user: 'U_GRANT',
        channel: 'C123ABC',
        ts: '1.1',
        // Trailing spaces, an inner mention, and odd casing. All of it is
        // content except the leading address.
        text: '<@U0BUG0RPZ8B>   ask <@U_OTHER> about the Q3 numbers  ',
      }),
      BOT,
      NOW,
    )
    expect(c.instruction).toBe('ask <@U_OTHER> about the Q3 numbers  ')
  })

  it('carries a thread parent so a reply lands in the thread', () => {
    const c = toCanonicalCommand(
      envelope({
        type: 'message',
        user: 'U_GRANT',
        channel: 'C123ABC',
        ts: '1770000000.000200',
        thread_ts: '1770000000.000100',
        text: 'and the one before that',
      }),
      BOT,
      NOW,
    )
    expect(c.slack.thread_ts).toBe('1770000000.000100')
    // origin_ref is this message's own ts, not the parent's: a reply must land
    // on the reply.
    expect(c.origin_ref).toBe('C123ABC:1770000000.000200')
  })

  it('marks a DM as a DM', () => {
    const c = toCanonicalCommand(
      envelope({
        type: 'message',
        user: 'U_GRANT',
        channel: 'D123ABC',
        channel_type: 'im',
        ts: '1.1',
        text: 'status',
      }),
      BOT,
      NOW,
    )
    expect(c.slack.is_dm).toBe(true)
  })

  it('refuses our own messages, checked before anything else', () => {
    // Without this the app answers itself, forever. It is the first check in
    // the function for that reason.
    /*
      Asserted on the REASON, not just the class. #195.

      Every refusal in this function throws `UnsupportedSlackEventError`, so
      `toThrow(UnsupportedSlackEventError)` passes whichever branch caught it —
      and a refusal for the wrong reason looks exactly like the rule working.
      CLAUDE.md records that failure: a check that asserted only that
      *something* threw reported a PASS twice, once for a wrong column name and
      once for a generated column.

      If the loop guard were deleted tomorrow, these two would still throw
      somewhere further down and a class-only assertion would stay green.
    */
    expect(() =>
      toCanonicalCommand(
        envelope({ type: 'message', user: BOT, channel: 'C1', ts: '1.1', text: 'hello' }),
        BOT,
      ),
    ).toThrow(/originated from this app/)
    expect(() =>
      toCanonicalCommand(
        envelope({ type: 'message', bot_id: 'B123', channel: 'C1', ts: '1.1', text: 'hello' }),
        BOT,
      ),
    ).toThrow(/originated from this app/)
  })

  it.each([
    'message_changed',
    'message_deleted',
    'channel_join',
    'channel_leave',
    'bot_message',
    // The platform speaking under an admitted user's id (review R2-5): never a typed instruction.
    'huddle_thread',
    'reminder_add',
    'pinned_item',
    'group_join',
    'channel_archive',
    'file_comment',
    'slackbot_response',
    'some_subtype_slack_invents_next_year',
  ])('refuses the subtype %s', (subtype) => {
    expect(() =>
      toCanonicalCommand(
        envelope({ type: 'message', user: 'U1', channel: 'C1', ts: '1.1', text: 'x', subtype }),
        BOT,
      ),
    ).toThrow(UnsupportedSlackEventError)
  })

  it.each([undefined, 'thread_broadcast', 'file_share'])(
    'CONTROL: a person posting (subtype %s) is still an instruction',
    (subtype) => {
      const c = toCanonicalCommand(
        envelope({
          type: 'message',
          user: 'U1',
          channel: 'C1',
          ts: '1.1',
          text: 'do the thing',
          subtype,
        }),
        BOT,
      )
      expect(c.instruction).toBe('do the thing')
    },
  )

  it('refuses an empty message and a mention with nothing after it', () => {
    expect(() =>
      toCanonicalCommand(
        envelope({ type: 'message', user: 'U1', channel: 'C1', ts: '1.1', text: '   ' }),
        BOT,
      ),
    ).toThrow(UnsupportedSlackEventError)
    expect(() =>
      toCanonicalCommand(
        envelope({
          type: 'app_mention',
          user: 'U1',
          channel: 'C1',
          ts: '1.1',
          text: '<@U0BUG0RPZ8B>',
        }),
        BOT,
      ),
    ).toThrow(UnsupportedSlackEventError)
  })
})

describe('reactions', () => {
  it('maps a reaction onto the SAME action vocabulary the Telegram buttons use', () => {
    // One concept, one handler, regardless of surface. A separate Slack
    // vocabulary would mean two code paths for one intention.
    const c = toCanonicalCommand(
      envelope({
        type: 'reaction_added',
        user: 'U_GRANT',
        reaction: '+1',
        item: { type: 'message', channel: 'C123ABC', ts: '1770000000.000100' },
      }),
      BOT,
      NOW,
    )
    expect(c.callback_action).toBe('useful')
    expect(c.slack.reaction).toBe('+1')
    expect(c.instruction).toBe('')
  })

  it('keys dedupe on the semantic triple, so a double-tap collapses', () => {
    const react = (eventId: string): string =>
      toCanonicalCommand(
        {
          ...envelope({
            type: 'reaction_added',
            user: 'U_GRANT',
            reaction: 'eyes',
            item: { channel: 'C1', ts: '1.1' },
          }),
          event_id: eventId,
        },
        BOT,
        NOW,
      ).dedupe_key
    // Two different event_ids, one dedupe key. Keying on event_id would let a
    // genuine double-tap through as two instructions.
    expect(react('Ev1')).toBe(react('Ev2'))
  })

  it('ignores an emoji with no defined meaning rather than guessing', () => {
    expect(() =>
      toCanonicalCommand(
        envelope({
          type: 'reaction_added',
          user: 'U1',
          reaction: 'taco',
          item: { channel: 'C1', ts: '1.1' },
        }),
        BOT,
      ),
    ).toThrow(/carries no defined meaning/)
  })

  it('ignores a removed reaction — a retraction is not the inverse', () => {
    // Un-thumbs-upping is not "not useful", and there is no defined handling
    // for retracting a signal that may already have been acted on.
    expect(() =>
      toCanonicalCommand(
        envelope({
          type: 'reaction_removed',
          user: 'U1',
          reaction: '+1',
          item: { channel: 'C1', ts: '1.1' },
        }),
        BOT,
      ),
    ).toThrow(/no defined effect/)
  })

  it('only maps reactions onto actions the canonical envelope accepts', () => {
    // inbound_commands has a CHECK on callback_action. A reaction mapping to an
    // action outside that set would be rejected by the database at runtime,
    // which is a worse place to find out.
    const allowed = new Set([
      'useful',
      'not_useful',
      'undo',
      'open_project',
      'mute_24h',
      'more_detail',
    ])
    for (const action of Object.values(REACTION_ACTIONS)) {
      expect(allowed).toContain(action)
    }
  })
})

describe('everything else', () => {
  it('refuses an envelope with no event', () => {
    expect(() => toCanonicalCommand({ type: 'event_callback', team_id: 'T1' }, BOT)).toThrow(
      /carries no event/,
    )
  })

  it('refuses an event type it has no handler for', () => {
    expect(() => toCanonicalCommand(envelope({ type: 'team_join', user: 'U1' }), BOT)).toThrow(
      /no handler/,
    )
  })
})
