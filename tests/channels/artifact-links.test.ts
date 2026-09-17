/**
 * A NotebookLM artifact link, as it arrives on a phone (#260).
 *
 * #260's fifth acceptance criterion is that links *"render/usefully open from
 * Telegram and Slack"*. That was inherited rather than proven, and inheriting
 * is exactly how the last cross-channel defect got through: `provenanceLine`
 * is shared between the two on purpose and ended with a Slack emoji shortcode,
 * which Telegram delivered as eight literal characters.
 *
 * The risk here is narrower and worse. Telegram sends with `parse_mode: HTML`,
 * so every body goes through `escapeHtml` — and a NotebookLM URL carries query
 * parameters. If `&` becomes `&amp;` inside the URL, the link Grant taps is
 * not the link the office found.
 *
 * So both channels are handed the SAME real listing and each is checked in its
 * own idiom, which is the only way to tell "it renders" from "it renders
 * here".
 */

import { describe, expect, it } from 'vitest'
import { resultBlocks } from '../../src/slack/blocks.ts'
import { pagerText } from '../../src/telegram/message.ts'

/*
  A real one. NotebookLM's artifact URLs carry the notebook and the artifact as
  query parameters, so the ampersand is not hypothetical — it is in every link
  this feature produces.
*/
const URL_WITH_QUERY =
  'https://notebooklm.google.com/notebook/abc-123?artifact=audio-42&source=share'

const LISTING =
  '“Money Mastery” has 2 audio overviews.\n\n' +
  `1. Where it stands — Audio overview — ${URL_WITH_QUERY}\n` +
  '2. The twelve-slide case — Slide deck — no link the office can open'

const METADATA = {
  confidence: 'high' as const,
  contradictions: null,
  evidence: 'verified' as const,
  reviewed: true,
  routine: false,
  sources: ['notebooklm:abc-123 Money Mastery'],
}

describe('an artifact link on Telegram', () => {
  const text = pagerText({
    staffName: 'Claire',
    staffTitle: 'Chief of Staff',
    project: null,
    body: LISTING,
    metadata: METADATA,
  } as never)

  it('is escaped exactly once, so Telegram decodes it back to the real URL', () => {
    /*
      The first draft of this test asserted the raw URL survived and FAILED —
      and the test was wrong, not the product. Telegram's HTML parse mode
      requires `&` to be written `&amp;`, decodes entities before auto-linking,
      and therefore opens the correct address. A raw `&` would be invalid HTML
      and can make Telegram reject the whole message.

      What would genuinely break the link is escaping it TWICE: `&amp;amp;`
      decodes to the literal text `&amp;`, and the address Grant taps is not
      the artifact. That is the property worth holding, and it is the one a
      future change — a body passed through the escaper on its way somewhere
      else — would break.
    */
    expect(text).toContain('artifact=audio-42&amp;source=share')
    expect(text).not.toContain('&amp;amp;')
    expect(text).toContain('https://notebooklm.google.com/notebook/abc-123?')
  })

  it('keeps the numbered list as a list rather than one run-on line', () => {
    // #209: at 390px a wrapped line reads as a second item.
    expect(text).toMatch(/1\. Where it stands/)
    expect(text).toMatch(/2\. The twelve-slide case/)
    expect(text.indexOf('2. The twelve')).toBeGreaterThan(text.indexOf('1. Where it stands'))
  })

  it('says plainly when there is no link, rather than inventing one', () => {
    expect(text).toContain('no link the office can open')
    // Nothing that looks like a URL may appear beside the unopenable one.
    const afterSlides = text.slice(text.indexOf('The twelve-slide case'))
    expect(afterSlides).not.toMatch(/https?:\/\/notebooklm/)
  })

  it('carries no Slack emoji shortcode, which Telegram cannot resolve', () => {
    expect(text).not.toMatch(/:[a-z_]+:/)
  })
})

describe('the same artifact link on Slack', () => {
  const blocks = resultBlocks({
    staffTitle: 'Claire · Chief of Staff',
    body: LISTING,
    metadata: METADATA,
    correlationId: '00000000-0000-0000-0000-000000000000',
    actions: [],
  } as never)
  const rendered = JSON.stringify(blocks)

  it('arrives whole and UNescaped, because mrkdwn is not HTML', () => {
    /*
      The asymmetry is the point. Telegram needs the ampersand escaped and
      Slack must not have it escaped — the same body, two correct renderings.
      A shared escaper applied to both would be wrong in one of them, which is
      the defect `provenanceLine` already had with an emoji shortcode.
    */
    expect(rendered).toContain('artifact=audio-42&source=share')
    expect(rendered).not.toContain('&amp;')
  })

  it('is in a mrkdwn section, which is what makes Slack auto-link it', () => {
    expect(rendered).toContain('"type":"mrkdwn"')
  })

  it('and the unopenable one is still honest here too', () => {
    expect(rendered).toContain('no link the office can open')
  })
})

describe('the two channels agree about what they were given', () => {
  /*
    The control. Each test above could pass while the two channels showed
    DIFFERENT lists — one truncating, one reordering — and neither would
    notice. Both must contain both titles.
  */
  const text = pagerText({
    staffName: 'Claire',
    staffTitle: 'Chief of Staff',
    project: null,
    body: LISTING,
    metadata: METADATA,
  } as never)
  const rendered = JSON.stringify(
    resultBlocks({
      staffTitle: 'Claire',
      body: LISTING,
      metadata: METADATA,
      correlationId: '00000000-0000-0000-0000-000000000000',
      actions: [],
    } as never),
  )

  it('both name every artifact in the list', () => {
    for (const title of ['Where it stands', 'The twelve-slide case']) {
      expect(text).toContain(title)
      expect(rendered).toContain(title)
    }
  })
})
