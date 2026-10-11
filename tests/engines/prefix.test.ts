// biome-ignore-all format: dense specimen tables kept readable as written
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  type TelegramUpdate,
  toCanonicalCommand as telegram,
  telegramEngine,
} from '../../src/channels/telegram.ts'
import { toCanonicalCommand as slack, slackEngine } from '../../src/slack/events.ts'

const tg = (text: string, extra: Record<string, unknown> = {}): TelegramUpdate =>
  ({
    update_id: 1,
    message: { message_id: 7, chat: { id: 55 }, from: { id: 55 }, text, ...extra },
  }) as unknown as TelegramUpdate

const sl = (text: string, extra: Record<string, unknown> = {}) =>
  slack(
    { type: 'event_callback', team_id: 'T1', event: { type: 'message', user: 'U1', channel: 'D1', channel_type: 'im', ts: '1.1', text, ...extra } } as never,
    '2026-10-11T10:00:00Z',
  )

describe('Telegram: /hermes at the start of a message asks for Hermes, and the prefix is not the question', () => {
  it('sets hermes and removes only the prefix', () => {
    expect(telegramEngine('/hermes what did we decide about the venue?', false)).toEqual({
      engine: 'hermes',
      instruction: 'what did we decide about the venue?',
    })
  })

  it('accepts the group form /hermes@bot, any case, a newline after it, and leading space', () => {
    expect(telegramEngine('/hermes@atg_chief_bot  hello', false).instruction).toBe('hello')
    expect(telegramEngine('/Hermes hello', false).engine).toBe('hermes')
    expect(telegramEngine('/hermes\nline one\nline two', false).instruction).toBe('line one\nline two')
    expect(telegramEngine('   /hermes hello', false).engine).toBe('hermes')
  })

  it('keeps the rest of the message verbatim, including a second /hermes', () => {
    expect(telegramEngine('/hermes /hermes again', false).instruction).toBe('/hermes again')
  })

  it('leaves everything else the team, untouched (the negative controls)', () => {
    for (const text of [
      'what did we decide?',
      'ask hermes about the venue',
      'hermes what did we decide',
      'hermes: what did we decide',
      '/hermes', // only the prefix: nothing was asked
      '/hermes   ',
      '/hermesx hello',
      '/hermes@ hello',
      'please /hermes hello', // not at the start
      '//hermes hello',
    ]) {
      expect(telegramEngine(text, false), text).toEqual({ engine: 'team', instruction: text })
    }
  })

  it('never selects an engine for forwarded text: it is somebody else\'s words', () => {
    expect(telegramEngine('/hermes do the thing', true)).toEqual({ engine: 'team', instruction: '/hermes do the thing' })
  })
})

describe('Slack: hermes: at the start of a message asks for Hermes, and the prefix is not the question', () => {
  it('sets hermes and removes only the prefix', () => {
    expect(slackEngine('hermes: what did we decide about the venue?', false)).toEqual({
      engine: 'hermes',
      instruction: 'what did we decide about the venue?',
    })
  })

  it('accepts any case, spaces around the colon, and a newline after it', () => {
    expect(slackEngine('Hermes : hello', false).instruction).toBe('hello')
    expect(slackEngine('HERMES:hello', false).instruction).toBe('hello')
    expect(slackEngine('hermes:\nhello', false).instruction).toBe('hello')
  })

  it('leaves everything else the team, untouched (the negative controls)', () => {
    for (const text of [
      'what did we decide?',
      'hermes what did we decide',
      '/hermes what did we decide',
      'ask hermes: what did we decide',
      'hermes:', // only the prefix
      'hermes:   ',
      'hermesx: hello',
      'the hermes: app is slow',
    ]) {
      expect(slackEngine(text, false), text).toEqual({ engine: 'team', instruction: text })
    }
  })

  it('never selects an engine for a shared message', () => {
    expect(slackEngine('hermes: do the thing', true)).toEqual({ engine: 'team', instruction: 'hermes: do the thing' })
  })
})

describe('the canonical command: the prefix reaches the column and not the instruction, and only where the person typed it', () => {
  it('Telegram', () => {
    const c = telegram(tg('/hermes what is the deposit?'), new Date('2026-10-11T10:00:00Z'), 'bot1')
    expect(c.engine).toBe('hermes')
    expect(c.instruction).toBe('what is the deposit?')
    const plain = telegram(tg('what is the deposit?'), new Date('2026-10-11T10:00:00Z'), 'bot1')
    expect(plain.engine).toBeUndefined()
    expect('engine' in plain).toBe(false)
    expect(plain.instruction).toBe('what is the deposit?')
  })

  it('Telegram: a forwarded message, a recording and a button press never select an engine', () => {
    const forwarded = telegram(tg('/hermes do the thing', { forward_origin: { type: 'user' } }), new Date(), 'bot1')
    expect(forwarded.engine).toBeUndefined()
    expect(forwarded.instruction).toBe('/hermes do the thing')
    const spoken = telegram(
      { update_id: 2, message: { message_id: 8, chat: { id: 55 }, from: { id: 55 }, voice: { file_id: 'f', duration: 3 }, caption: '/hermes hi' } } as unknown as TelegramUpdate,
      new Date(),
      'bot1',
    )
    expect(spoken.engine).toBeUndefined()
    expect(spoken.instruction).toBe('')
  })

  it('Slack: the leading mention is addressing, so a mention then hermes: still selects', () => {
    const c = sl('<@UBOT> hermes: what is the deposit?')
    expect(c.engine).toBe('hermes')
    expect(c.instruction).toBe('what is the deposit?')
    const plain = sl('<@UBOT> what is the deposit?')
    expect('engine' in plain).toBe(false)
  })

  it('Slack: a shared message never selects an engine', () => {
    const c = sl('hermes: do the thing', { attachments: [{ is_share: true }] })
    expect('engine' in c).toBe(false)
    expect(c.instruction).toBe('hermes: do the thing')
  })
})

describe('the doors write the column the adapters translated, and nothing else chooses an engine', () => {
  const tgDoor = readFileSync('supabase/functions/telegram-webhook/index.ts', 'utf8')
  const slDoor = readFileSync('supabase/functions/slack-events/index.ts', 'utf8')

  it('both inserts carry engine hermes only when the adapter said so', () => {
    expect(tgDoor).toMatch(/\.\.\.\(command\.engine === 'hermes' \? \{ engine: 'hermes' \} : \{\}\)/)
    expect(slDoor).toMatch(/\.\.\.\('engine' in command && command\.engine === 'hermes' \? \{ engine: 'hermes' \} : \{\}\)/)
  })

  it('neither door names an engine anywhere else (no default, no fallback)', () => {
    expect((tgDoor.match(/engine:/g) ?? []).length).toBe(1)
    expect((slDoor.match(/engine:/g) ?? []).length).toBe(1)
  })
})
