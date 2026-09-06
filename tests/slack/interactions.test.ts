/**
 * Button presses coming back.
 *
 * The tests worth having here are the ones about the shape of the request and
 * about not trusting our own data once it has been through a client. Slack's
 * interactivity payload is form-encoded, has no verification handshake, and a
 * slow or broken response is shown to the person who clicked — so every failure
 * mode is user-visible rather than quietly retried.
 */
import { describe, expect, it } from 'vitest'
import { UnsupportedSlackEventError } from '../../src/slack/events.ts'
import {
  type BlockActionsPayload,
  correlationOf,
  parseInteractionBody,
  readButtonValue,
  toCanonicalInteraction,
} from '../../src/slack/interactions.ts'

const CORR = '11111111-2222-3333-4444-555555555555'
const NOW = new Date('2026-09-05T09:00:00Z')

const press = (over: Partial<BlockActionsPayload> = {}): BlockActionsPayload => ({
  type: 'block_actions',
  team: { id: 'T0BUCJ2L5FD' },
  user: { id: 'U0GRANT' },
  channel: { id: 'C0BUNF6NKHA' },
  container: { channel_id: 'C0BUNF6NKHA', message_ts: '1788580391.185849' },
  actions: [
    {
      action_id: 'feedback.useful',
      value: JSON.stringify({ a: 'feedback.useful', c: CORR }),
      action_ts: '1788580400.000000',
    },
  ],
  ...over,
})

describe('the form-encoded body', () => {
  it('is parsed out of `payload=`, which is not JSON at the top level', () => {
    const body = `payload=${encodeURIComponent(JSON.stringify(press()))}`
    expect(parseInteractionBody(body)?.type).toBe('block_actions')
  })

  it('returns null for an Events API body, so one endpoint can serve both', () => {
    expect(parseInteractionBody('{"type":"event_callback"}')).toBeNull()
  })

  it('returns null rather than throwing on a malformed payload', () => {
    expect(parseInteractionBody('payload=%7Bnot-json')).toBeNull()
    expect(parseInteractionBody('payload=')).toBeNull()
  })
})

describe('normalizing a press', () => {
  it('produces the same six-word vocabulary the reactions and Telegram buttons use', () => {
    const cases: [string, string][] = [
      ['feedback.useful', 'useful'],
      ['feedback.not_useful', 'not_useful'],
      ['undo', 'undo'],
      ['open_project', 'open_project'],
      ['mute_24h', 'mute_24h'],
      ['more_detail', 'more_detail'],
    ]
    for (const [actionId, expected] of cases) {
      const command = toCanonicalInteraction(
        press({ actions: [{ action_id: actionId, value: JSON.stringify({ c: CORR }) }] }),
        NOW,
      )
      expect(command.callback_action).toBe(expected)
    }
  })

  it('keys the dedupe on the message and the meaning, so a double tap is one signal', () => {
    const a = toCanonicalInteraction(press(), NOW)
    const b = toCanonicalInteraction(
      press({ actions: [{ ...press().actions?.[0], action_ts: '1788580999.000000' }] }),
      NOW,
    )
    expect(a.dedupe_key).toBe(b.dedupe_key)
  })

  it('but two different buttons on one message are two signals', () => {
    const useful = toCanonicalInteraction(press(), NOW)
    const detail = toCanonicalInteraction(
      press({ actions: [{ action_id: 'more_detail', value: '{}' }] }),
      NOW,
    )
    expect(useful.dedupe_key).not.toBe(detail.dedupe_key)
  })

  it('produces a dedupe key the database will accept', () => {
    // 0011 constrains the key, and the Gate 4 run found `+1` violating it. The
    // constraint is repeated here rather than trusted.
    expect(toCanonicalInteraction(press(), NOW).dedupe_key).toMatch(
      /^[a-z]+:[a-z_]+:[A-Za-z0-9:_.-]+$/,
    )
  })

  it('replies into the thread the message is in, not into the channel', () => {
    const threaded = toCanonicalInteraction(
      press({
        container: {
          channel_id: 'C0BUNF6NKHA',
          message_ts: '1788580391.185849',
          thread_ts: '1788580000.000100',
        },
      }),
      NOW,
    )
    expect(threaded.slack.thread_ts).toBe('1788580000.000100')
  })

  it('leaves compensates_event_id null even for Undo — the button carries a correlation', () => {
    const undo = toCanonicalInteraction(
      press({ actions: [{ action_id: 'undo', value: JSON.stringify({ c: CORR }) }] }),
      NOW,
    )
    expect(undo.compensates_event_id).toBeNull()
  })

  it('carries no instruction: a press is a signal, not something Grant typed', () => {
    expect(toCanonicalInteraction(press(), NOW).instruction).toBe('')
  })

  it('refuses a payload that is not a button press', () => {
    expect(() => toCanonicalInteraction(press({ type: 'view_submission' }), NOW)).toThrow(
      UnsupportedSlackEventError,
    )
  })

  it('refuses an action id it does not recognise, rather than guessing', () => {
    // Our own older message meeting our newer code. 200 and nothing is right;
    // inventing a meaning is not.
    expect(() =>
      toCanonicalInteraction(press({ actions: [{ action_id: 'something_new' }] }), NOW),
    ).toThrow(UnsupportedSlackEventError)
  })
})

describe('the button value, which is untrusted', () => {
  it('yields the correlation when it is a uuid', () => {
    expect(readButtonValue(JSON.stringify({ a: 'undo', c: CORR }))).toBe(CORR)
    expect(correlationOf(press())).toBe(CORR)
  })

  it('rejects anything that is not a uuid, however plausible', () => {
    // The value round-trips through a client and is visible to anyone who can
    // inspect the message. §10 forbids free-form input reaching a tool call,
    // and a correlation goes straight into a query.
    expect(readButtonValue(JSON.stringify({ c: "'; drop table jobs; --" }))).toBeNull()
    expect(readButtonValue(JSON.stringify({ c: 'not-a-uuid' }))).toBeNull()
    expect(readButtonValue(JSON.stringify({ c: 42 }))).toBeNull()
  })

  it('survives a missing or malformed value without throwing', () => {
    expect(readButtonValue(undefined)).toBeNull()
    expect(readButtonValue('')).toBeNull()
    expect(readButtonValue('{oops')).toBeNull()
  })

  it('still normalizes the press when the value is unusable — the action is not in the value', () => {
    // The action comes from `action_id`, which Slack controls the delivery of.
    // A press with a broken value is still a press.
    const command = toCanonicalInteraction(
      press({ actions: [{ action_id: 'feedback.not_useful', value: '{oops' }] }),
      NOW,
    )
    expect(command.callback_action).toBe('not_useful')
  })
})
