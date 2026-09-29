import { describe, expect, it } from 'vitest'
import type { TelegramUpdate } from '../src/channels/telegram.ts'
import { senderOf } from '../src/channels/telegram.ts'

const u = (rest: Record<string, unknown>): TelegramUpdate =>
  ({ update_id: 1, ...rest }) as unknown as TelegramUpdate

describe('senderOf: who the update says sent it, or nobody', () => {
  it('reads a message, a button press and a membership change', () => {
    expect(
      senderOf(
        u({
          message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from: { id: 42 } },
        }),
      ),
    ).toBe('42')
    expect(senderOf(u({ callback_query: { id: 'x', from: { id: 43 } } }))).toBe('43')
    expect(
      senderOf(u({ my_chat_member: { chat: { id: -1, type: 'group' }, from: { id: 44 } } })),
    ).toBe('44')
  })

  it('a private chat is not an identity: only `from` counts, never the chat id', () => {
    expect(
      senderOf(
        u({ message: { message_id: 1, date: 1, chat: { id: 1386648496, type: 'private' } } }),
      ),
    ).toBeNull()
  })

  it.each([
    ['a string id', { id: '42' }],
    ['zero', { id: 0 }],
    ['a negative id', { id: -5 }],
    ['a float', { id: 4.5 }],
    ['NaN', { id: Number.NaN }],
    ['no id', {}],
    ['not an object', 'grant'],
  ])('malformed sender (%s) is nobody', (_label, from) => {
    expect(
      senderOf(u({ message: { message_id: 1, date: 1, chat: { id: 5, type: 'private' }, from } })),
    ).toBeNull()
  })
})
