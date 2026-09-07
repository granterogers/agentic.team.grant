/**
 * Composing a pager message.
 *
 * Both traps tested here produce a message Telegram REFUSES to send rather than
 * one that merely looks wrong — a missed escape is `can't parse entities`, and
 * an over-long callback payload is a silent rejection of the button. Neither is
 * visible until a real person presses something that does nothing.
 */
import { describe, expect, it } from 'vitest'
import { toCanonicalCommand } from '../../src/channels/telegram.ts'
import { ACTIONS } from '../../src/slack/blocks.ts'
import {
  BUTTONS_PER_ROW,
  CALLBACK_ACTIONS,
  CALLBACK_DATA_MAX_BYTES,
  CallbackDataTooLongError,
  callbackData,
  escapeHtml,
  inlineKeyboard,
  PAGER_BODY_LIMIT,
  pagerText,
  trimForPager,
} from '../../src/telegram/message.ts'

const CORR = '11111111-2222-3333-4444-555555555555'

const message = (over: Partial<Parameters<typeof pagerText>[0]> = {}) => ({
  staffName: 'Research Director',
  staffTitle: 'Research Director',
  body: 'All three suppliers quoted within 4% of each other.',
  metadata: { confidence: 'medium' as const, evidence: 'inferred' as const, reviewed: true },
  correlationId: CORR,
  actions: [...ACTIONS],
  ...over,
})

describe('escaping', () => {
  it('escapes exactly the three characters HTML mode needs', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('leaves the MarkdownV2 metacharacters alone, because we do not use that mode', () => {
    // The reason HTML mode was chosen: model output is full of these, and
    // MarkdownV2 rejects the whole message if one of its eighteen is
    // unescaped. `>` is excluded from this list on purpose — it is in both
    // sets, and HTML mode escapes it, which is correct.
    const awkward = '.!-()[]{}=+#|~`*_'
    expect(escapeHtml(awkward)).toBe(awkward)
  })

  it('escapes the body of a real message, so a stray < cannot break the send', () => {
    const text = pagerText(message({ body: 'margin < 5% and revenue > target & rising' }))
    expect(text).toContain('&lt;')
    expect(text).toContain('&gt;')
    expect(text).toContain('&amp;')
  })
})

describe('trimming', () => {
  it('leaves a short body alone', () => {
    expect(trimForPager('Short.')).toBe('Short.')
  })

  it('says that it trimmed, rather than truncating silently', () => {
    const trimmed = trimForPager(`${'sentence. '.repeat(200)}`)
    expect(trimmed.length).toBeLessThan(PAGER_BODY_LIMIT + 100)
    expect(trimmed).toContain('trimmed')
  })

  it('prefers a sentence boundary', () => {
    const body = `${'a'.repeat(600)}. ${'b'.repeat(400)}`
    expect(trimForPager(body).startsWith(`${'a'.repeat(600)}.`)).toBe(true)
  })

  it('collapses runs of blank lines, which a phone renders as dead space', () => {
    expect(trimForPager('one\n\n\n\n\ntwo')).toBe('one\n\ntwo')
  })
})

describe('callback data', () => {
  it('fits Telegram limit for every one of the six buttons', () => {
    for (const action of ACTIONS) {
      const data = callbackData(action, CORR)
      expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES)
    }
  })

  it('round-trips through the adapter that will actually receive it', () => {
    // The check that would have caught the wire-code mistake: both sides of the
    // wire, in one test. Unit tests on each side passed while the two disagreed
    // about the format entirely.
    for (const action of ACTIONS) {
      const command = toCanonicalCommand(
        {
          update_id: 1,
          callback_query: {
            id: 'cb-1',
            data: callbackData(action, CORR),
            from: { id: 4242 },
            message: { message_id: 7, chat: { id: -100123, type: 'private' } },
          },
        },
        new Date('2026-09-05T09:00:00Z'),
      )
      expect(command.callback_action).toBe(CALLBACK_ACTIONS[action])
    }
  })

  it('refuses rather than silently sending something Telegram will drop', () => {
    // 64 BYTES, not characters. A long correlation is the realistic way to
    // exceed it, and a dropped button looks exactly like a working one.
    expect(() => callbackData('feedback.not_useful', 'x'.repeat(80))).toThrow(
      CallbackDataTooLongError,
    )
  })
})

describe('the keyboard', () => {
  it('lays every action out three to a row', () => {
    // Derived, not hard-coded at two. The list grew to eight when the approval
    // pair arrived (0083) and a literal here failed for the one reason that is
    // not a defect — which is a test asserting the wrong thing about itself.
    const rows = inlineKeyboard([...ACTIONS], CORR)
    expect(rows).toHaveLength(Math.ceil(ACTIONS.length / BUTTONS_PER_ROW))
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(BUTTONS_PER_ROW)
  })

  it('gives the project button a url, and everything else a callback', () => {
    const rows = inlineKeyboard(['open_project', 'undo'], CORR, 'https://hq.example/p/1')
    expect(rows[0]?.[0]?.url).toBe('https://hq.example/p/1')
    expect(rows[0]?.[0]?.callback_data).toBeUndefined()
    expect(rows[0]?.[1]?.callback_data).toBeDefined()
  })

  it('falls back to a callback when there is no project url', () => {
    // A url button sends no callback, so with no url the button would do
    // nothing at all rather than merely not navigating.
    const rows = inlineKeyboard(['open_project'], CORR, null)
    expect(rows[0]?.[0]?.callback_data).toBeDefined()
  })
})

describe('the message', () => {
  it('leads with the not-reviewed warning, because the first line is often the only one read', () => {
    const text = pagerText(
      message({ metadata: { confidence: 'low', evidence: 'speculative', reviewed: false } }),
    )
    expect(text.split('\n')[0]).toContain('Not reviewed')
  })

  it('never shows confidence without evidence beside it', () => {
    const text = pagerText(message())
    expect(text).toContain('medium confidence')
    expect(text).toContain('evidence: inferred')
  })

  it('does not repeat the name when the title is the same', () => {
    const text = pagerText(message())
    expect(text).toContain('<b>Research Director</b>')
    expect(text).not.toContain('Research Director · Research Director')
  })

  it('shows both when they differ', () => {
    expect(pagerText(message({ staffName: 'Ada', staffTitle: 'Research Director' }))).toContain(
      'Ada · Research Director',
    )
  })

  it('omits the author entirely for a message from no one', () => {
    const text = pagerText(message({ staffName: null, staffTitle: null }))
    expect(text).not.toContain('<b>')
  })

  it('stays inside Telegram hard limit even for an absurd body', () => {
    expect(pagerText(message({ body: 'x'.repeat(50_000) })).length).toBeLessThanOrEqual(4096)
  })
})

describe('one bot, many projects: every page says which (0070)', () => {
  const base = {
    staffName: 'Research Director',
    staffTitle: 'Research Director',
    body: 'The two sources disagree on the launch date.',
    metadata: { confidence: 'medium' as const, evidence: 'inferred' as const, reviewed: true },
    correlationId: 'c-1',
    actions: [] as const,
  }

  it('names the project on the FIRST line', () => {
    // The lock screen shows one line, and for most pages it is the only line
    // read. Grant asked for a single bot across every project rather than a bot
    // per role per project, which makes this the first question each page
    // raises.
    const lines = pagerText({ ...base, projectName: 'Money Mastery' }).split('\n\n')
    expect(lines[0]).toContain('Money Mastery')
  })

  it('and on the LAST line', () => {
    // A long message pushes the header off the top. The end is where the
    // decision gets made, and it is the worst possible moment not to know what
    // you are deciding about.
    const lines = pagerText({ ...base, projectName: 'Money Mastery' }).split('\n\n')
    expect(lines[lines.length - 1]).toContain('Money Mastery')
  })

  it('puts the project even above the not-reviewed warning', () => {
    const lines = pagerText({
      ...base,
      projectName: 'Money Mastery',
      metadata: { ...base.metadata, reviewed: false },
    }).split('\n\n')
    expect(lines[0]).toContain('Money Mastery')
    expect(lines[1]).toContain('Not reviewed')
  })

  it('says nothing at all when there is no project, rather than "(none)"', () => {
    // A page about no project is a real thing — a backup failure, a budget
    // warning — and a placeholder would be noise on every one of them.
    const text = pagerText({ ...base, projectName: null })
    expect(text).not.toContain('📁')
    expect(text).not.toContain('—')
    expect(pagerText({ ...base, projectName: '   ' })).toBe(text)
    expect(pagerText(base)).toBe(text)
  })

  it('escapes a project name, like everything else', () => {
    const text = pagerText({ ...base, projectName: 'A & B <script>' })
    expect(text).toContain('A &amp; B &lt;script&gt;')
    expect(text).not.toContain('<script>')
  })
})

describe('the approval pair', () => {
  it('renders as its own two buttons, both carrying the correlation', () => {
    // The message they appear on asks a yes/no question, so these are the whole
    // keyboard — `resultContext` swaps them for the usual six rather than
    // adding to them, because 👍 on "may I generate this?" answers nothing.
    const rows = inlineKeyboard(['approve', 'decline'], CORR)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveLength(2)
    expect(rows[0]?.[0]?.callback_data).toBe(`approve:${CORR}`)
    expect(rows[0]?.[1]?.callback_data).toBe(`decline:${CORR}`)
  })
})
