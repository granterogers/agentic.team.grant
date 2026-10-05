import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { linkTokenOf, type TelegramUpdate } from '../../src/channels/telegram.ts'

/*
  A person connecting their own Telegram (#410): the webhook recognises exactly one message from a stranger, and only in
  one shape. These pin the shape (and the neighbours that must NOT be a link), and the wiring: the redeem call sits before
  the stranger refusal and its answer is what decides the reply.
*/
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f901234'
const msg = (text: string, over: { type?: string; is_bot?: boolean } = {}): TelegramUpdate => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: 1,
    text,
    chat: { id: 55, type: over.type ?? 'private' },
    from: { id: 55, is_bot: over.is_bot ?? false },
  },
})

describe('linkTokenOf', () => {
  it('reads the token from a deep link tap', () => {
    expect(TOKEN).toHaveLength(36)
    expect(linkTokenOf(msg(`/start link_${TOKEN}`))).toBe(TOKEN)
  })
  it('tolerates the bot suffix and surrounding whitespace', () => {
    expect(linkTokenOf(msg(`/start@agenticteamgrantbot link_${TOKEN}`))).toBe(TOKEN)
    expect(linkTokenOf(msg(`  /start link_${TOKEN}\n`))).toBe(TOKEN)
  })
  it.each([
    ['a group', msg(`/start link_${TOKEN}`, { type: 'group' })],
    ['a supergroup', msg(`/start link_${TOKEN}`, { type: 'supergroup' })],
    ['a bot sender', msg(`/start link_${TOKEN}`, { is_bot: true })],
    ['a bare /start', msg('/start')],
    ['another payload', msg(`/start ref_${TOKEN}`)],
    ['a token that is too short', msg(`/start link_${TOKEN.slice(1)}`)],
    ['a token that is too long', msg(`/start link_${TOKEN}0`)],
    ['upper-case hex', msg(`/start link_${TOKEN.toUpperCase()}`)],
    ['words after the token', msg(`/start link_${TOKEN} and please do something else`)],
    ['words before it', msg(`hello /start link_${TOKEN}`)],
    ['the token with no /start', msg(`link_${TOKEN}`)],
    [
      'no text at all',
      {
        update_id: 2,
        message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 5 } },
      },
    ],
    ['a callback', { update_id: 3 }],
  ])('is not a link: %s', (_, update) => {
    expect(linkTokenOf(update as TelegramUpdate)).toBeNull()
  })
})

describe('the webhook handles it before the stranger refusal, and acts on the answer', () => {
  const src = readFileSync('supabase/functions/telegram-webhook/index.ts', 'utf8')
  const at = (needle: string): number => {
    const i = src.indexOf(needle)
    expect(i, needle).toBeGreaterThan(-1)
    return i
  }
  it('redeems before it ignores an unrecognised sender', () => {
    expect(at("rpcOne('channel_link_redeem'")).toBeLessThan(at("ignored: 'unrecognised sender'"))
  })
  it('passes the verified sender and chat, never anything from the message body, as actor and conversation', () => {
    const block = src.slice(
      at("rpcOne('channel_link_redeem'"),
      at("ignored: 'unrecognised sender'"),
    )
    expect(block).toMatch(/p_actor: sender,/)
    expect(block).toMatch(/p_conversation: String\(claimedChat\.id\),/)
    expect(block).toMatch(/p_token: linkToken,/)
  })
  it('a failed lookup is a retry, not a refusal, and the reply depends on whether it worked', () => {
    const block = src.slice(
      at("rpcOne('channel_link_redeem'"),
      at("ignored: 'unrecognised sender'"),
    )
    expect(block).toMatch(
      /if \(redeemed === null\) return new Response\('link lookup failed', \{ status: 503 \}\)/,
    )
    expect(block).toMatch(/redeemed\.ok === true\s*\?/)
  })
})
