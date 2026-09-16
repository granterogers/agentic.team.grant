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
import { ACTIONS, provenanceLine } from '../../src/slack/blocks.ts'
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
  metadata: {
    confidence: 'medium' as const,
    evidence: 'inferred' as const,
    reviewed: true,
    sources: [] as readonly string[],
    contradictions: null,
  },
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
      message({
        metadata: {
          confidence: 'low',
          evidence: 'speculative',
          reviewed: false,
          sources: [],
          contradictions: null,
        },
      }),
    )
    expect(text.split('\n')[0]).toContain('Not reviewed')
  })

  it('never shows how sure it is without saying on what basis', () => {
    /*
      §12's rule, as a property. #186 replaced "medium confidence · evidence:
      inferred" with the same English Slack uses — Grant called the old wording
      *"not intuitive or acting like it's a human"* — and this asserted the two
      literal strings, so it went red on a correct change.

      Compared against `provenanceLine` itself rather than against a new pair
      of literals: the point of the change was that BOTH surfaces say the same
      thing, and a copy of the expected wording here could drift from Slack's
      without anything noticing.
    */
    /*
      On a message that ATTESTS something. #208 stopped showing the line where
      it could only report that nothing happened, so the old fixture — inferred,
      nothing cited, claiming nothing — is now the suppressed case and would
      have made this assert the presence of a line that is deliberately gone.
    */
    const cited = message({
      metadata: {
        confidence: 'medium' as const,
        evidence: 'inferred' as const,
        reviewed: true,
        sources: ['the supplier quotes'] as readonly string[],
        contradictions: null,
      },
    })
    const text = pagerText(cited)
    const expected = provenanceLine({
      confidence: 'medium',
      evidence: 'inferred',
      reviewed: true,
      sources: ['the supplier quotes'],
      contradictions: null,
    })
    // The pager renders Slack's `*bold*` as tags, so compare on the words.
    expect(text).toContain(expected.replace(/\*/g, ''))
    // And it still carries both halves, which is the rule the wording serves.
    expect(text.toLowerCase()).toContain('confident')
    expect(text.toLowerCase()).toContain('worked out')
  })

  it('says nothing about confidence when there is nothing to be confident about', () => {
    /*
      #208. Grant, looking at a two-line hello carrying "Fairly confident —
      worked out, not looked up, nothing cited": *"I don't need that confidence
      text... I'm trying to make a bit more human."*

      Two absences under a sentence that claims nothing is the product clearing
      its throat. §12 is not weakened: confidence and evidence are still never
      shown APART — here they are both absent.
    */
    const text = pagerText(message({ body: 'I am here. No need for a meeting.' }))
    expect(text.toLowerCase()).not.toContain('confident')
    expect(text.toLowerCase()).not.toContain('nothing cited')
    // The message itself survives, obviously.
    expect(text).toContain('I am here.')
  })

  it('but a message that CLAIMS to have read something keeps its provenance', () => {
    /*
      The guard that makes the suppression above safe, and the reason it
      consults the body at all.

      #185: Claire told Grant five projects existed, in a sentence claiming a
      database read, with `evidence: inferred` and no sources — metadata
      IDENTICAL to the harmless hello above. The only thing separating them is
      whether the words make a claim, so the words are what decides.

      Asserted on the property rather than the sentence: a wording lock here
      would be the fifth instance in CLAUDE.md's trap list.
    */
    const text = pagerText(
      message({ body: 'I pulled the project records. The db read shows five active projects.' }),
    )
    expect(text.toLowerCase()).toContain('worked out')
  })

  it('never names the sender, whoever it is', () => {
    /*
      #208. Grant: *"I don't need to see the contact's name and the message. I
      already have it, so you can remove that."*

      Three tests used to live here, asserting how the name and title were
      combined. The feature is gone: `telegram.only_chief_speaks` is true so it
      is always Claire, and since #70 the bot is hers, so the chat is named
      after her at the top of his screen.

      Asserted over BOTH shapes the old code branched on, so a partial revert
      shows up rather than passing on the branch nobody checked.
    */
    for (const who of [
      { staffName: 'Research Director', staffTitle: 'Research Director' },
      { staffName: 'Ada', staffTitle: 'Research Director' },
    ]) {
      const text = pagerText(message(who))
      expect(text).not.toContain('Ada')
      expect(text).not.toContain('Research Director')
    }
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
    metadata: {
      confidence: 'medium' as const,
      evidence: 'inferred' as const,
      reviewed: true,
      sources: [] as readonly string[],
      contradictions: null,
    },
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

  it('exactly once, never twice', () => {
    /*
      #208. It used to be repeated as a footer, on the reasoning that a long
      message pushes the header off the top — true, and it made a two-line
      hello say the same word at both ends. Grant: *"I don't need unnamed to be
      twice. Certainly don't need to see it twice."*

      Counted rather than checked for absence at the end: "not in the last
      line" would pass if it appeared three times in the middle.
    */
    const text = pagerText({ ...base, projectName: 'Money Mastery' })
    expect(text.split('Money Mastery').length - 1).toBe(1)
  })

  it('and the reserved Unnamed project reads as Conversation', () => {
    // #208, and 0334 for why the row is called Unnamed at all. An internal
    // name is a poor thing to read on a lock screen; Grant: *"just see
    // conversation rather than unnamed."*
    const text = pagerText({ ...base, projectName: 'Unnamed' })
    expect(text).toContain('Conversation')
    expect(text).not.toContain('Unnamed')
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
    // The FOOTER, not a bare em dash. #186's provenance line legitimately
    // contains one — "Fairly confident — worked out, not looked up" — so a
    // character that used to appear only in the project footer no longer
    // identifies it. Asserting the shape of the thing being ruled out.
    expect(text).not.toMatch(/<i>— .+<\/i>/)
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

describe('Slack vocabulary does not reach the phone (#208)', () => {
  /*
    Found by rendering four real message shapes and reading them, which is the
    only way either of these was ever going to show up: both compile, both
    escape correctly, and both are perfectly well-formed HTML.
  */
  const unreviewed = {
    confidence: 'medium' as const,
    evidence: 'inferred' as const,
    reviewed: false,
    sources: ['the pricing page'] as readonly string[],
    contradictions: null,
  }

  const SHORTCODE = /(?<![A-Za-z0-9_]):[a-z][a-z0-9_+-]+:(?![A-Za-z0-9_])/

  it('leaves no emoji shortcode in anything the office itself composed', () => {
    /*
      The property, not the one shortcode that was found. `:warning:` came
      from `provenanceLine`; the staff emoji in `slack/identity.ts` are eight
      more, and the next one added is not going to remember this test exists.

      Scoped to the furniture, because the body is the model's words and the
      rule there is different — see the two cases below it.
    */
    const shapes = [
      pagerText(message({ metadata: unreviewed })),
      pagerText(message({ metadata: unreviewed, projectName: 'Wellness' })),
      pagerText(message({ metadata: { ...unreviewed, reviewed: true }, sources: [] })),
      pagerText(message({ metadata: { ...unreviewed, evidence: 'verified' as const } })),
    ]
    for (const text of shapes) expect(text).not.toMatch(SHORTCODE)
  })

  it('translates a shortcode it knows, in the body as well', () => {
    const text = pagerText(message({ body: 'Shipped :white_check_mark: today' }))
    expect(text).toContain('Shipped ✅ today')
  })

  it('keeps an unknown shortcode in the body rather than putting a hole in it', () => {
    // The asymmetry, asserted on purpose: furniture is ours to fix, the body
    // is what the message actually said.
    const text = pagerText(message({ body: 'Shipped :no_such_emoji: today' }))
    expect(text).toContain('Shipped :no_such_emoji: today')
  })

  it('leaves a ratio and a clock time alone, which are not shortcodes', () => {
    // The regression the shortcode rule could most easily cause: a colon
    // between two things is ordinary punctuation far more often than it is
    // Slack.
    const text = pagerText(message({ body: 'Split 3:2:1, reviewed at 12:30.' }))
    expect(text).toContain('Split 3:2:1, reviewed at 12:30.')
  })

  it('warns once that nobody has checked this, not twice', () => {
    const body = 'The pricing page says forty pounds a month.'
    const text = pagerText(message({ body, metadata: unreviewed, projectName: 'Wellness' }))
    const warnings = text.toLowerCase().match(/not reviewed|nobody has checked/g) ?? []
    expect(warnings).toHaveLength(1)
    // And the one that survives is the prominent one, above the body, because
    // on a phone the first line is often the only line read.
    expect(text.indexOf('Not reviewed')).toBeLessThan(text.indexOf(body))
  })

  it('still shows confidence with evidence on that same message', () => {
    // §12 is what the de-duplication must not cost. The review warning is a
    // third thing, said elsewhere; the pair is untouched.
    const text = pagerText(message({ metadata: unreviewed })).toLowerCase()
    expect(text).toContain('confident')
    expect(text).toContain('worked out')
    expect(text).toContain('1 source')
  })

  it('keeps the warning in Slack, where nothing else has said it', () => {
    // The option exists to stop a repetition, never to lose a warning. Slack
    // has no header line, so the clause is the only place it is said.
    expect(provenanceLine(unreviewed)).toContain('Nobody has checked this yet')
    expect(provenanceLine(unreviewed, {})).toContain('Nobody has checked this yet')
    expect(provenanceLine(unreviewed, { unreviewed: true })).not.toContain('Nobody has checked')
  })
})
