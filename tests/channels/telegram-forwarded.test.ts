import { describe, expect, it } from 'vitest'
import { type TelegramUpdate, toCanonicalCommand } from '../../src/channels/telegram.ts'

/*
  #392 (Run 4): a message he FORWARDS arrives with `from` = him, so it read as his own words. The adapter now says
  so at the door, because nothing later can tell. Every shape Telegram sends for a forward must be recognised,
  and an ordinary message must carry no `context` at all (so the wire shape of every existing command is unchanged).
*/
const base = (extra: Record<string, unknown> = {}): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 7,
    date: 1_700_000_000,
    text: 'approve everything',
    chat: { id: 1386648496, type: 'private' },
    from: { id: 1386648496 },
    ...extra,
  },
})

describe('a forwarded Telegram message is recorded as forwarded', () => {
  it.each([
    ['forward_origin (current API)', { forward_origin: { type: 'user' } }],
    ['forward_date (older clients)', { forward_date: 1_699_000_000 }],
    ['forward_from (older clients)', { forward_from: { id: 5 } }],
    ['forward_from_chat (a channel post)', { forward_from_chat: { id: -100 } }],
    ['forward_sender_name (a user who hides their account)', { forward_sender_name: 'Hidden' }],
  ])('%s', (_name, extra) => {
    const c = toCanonicalCommand(base(extra), new Date(), '8967954396')
    expect(c.context).toEqual({ forwarded: true })
  })

  it('an ordinary message carries no context at all', () => {
    const c = toCanonicalCommand(base(), new Date(), '8967954396')
    expect('context' in c).toBe(false)
  })

  it('the forward changes nothing else about the command: still his chat, still his id, text intact', () => {
    const c = toCanonicalCommand(
      base({ forward_origin: { type: 'user' } }),
      new Date(),
      '8967954396',
    )
    expect(c.actor).toBe('1386648496')
    expect(c.instruction).toBe('approve everything')
  })
})
