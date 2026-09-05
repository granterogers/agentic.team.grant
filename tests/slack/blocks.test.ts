/**
 * What the office is allowed to say.
 *
 * Two kinds of test here, and they fail for different reasons:
 *
 *   - Slack's limits, which are silent when exceeded. A sixth button in a
 *     five-element block does not error; it vanishes. A test is the only way
 *     that is ever noticed.
 *   - §12 and §16's honesty rules, which are the reason this composer exists
 *     rather than a template string at each call site.
 */
import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  actionBlocks,
  buttonValue,
  fallbackText,
  MAX_ACTION_ELEMENTS,
  MAX_SECTION_TEXT,
  type MessageMetadata,
  provenanceLine,
  type ResultMessage,
  resultBlocks,
  splitBody,
} from '../../src/slack/blocks.ts'

const CORR = '11111111-2222-3333-4444-555555555555'

/** Slack blocks are open records; this narrows one for assertions. */
const elementsOf = (block: unknown): Record<string, unknown>[] =>
  (block as { elements?: Record<string, unknown>[] }).elements ?? []

const meta = (over: Partial<MessageMetadata> = {}): MessageMetadata => ({
  confidence: 'medium',
  evidence: 'inferred',
  sources: ['https://example/one'],
  contradictions: null,
  reviewed: true,
  ...over,
})

const message = (over: Partial<ResultMessage> = {}): ResultMessage => ({
  staffTitle: 'Research Director',
  body: 'The three suppliers quoted within 4% of each other.',
  metadata: meta(),
  correlationId: CORR,
  actions: [...ACTIONS],
  ...over,
})

describe('Slack limits, which fail silently in production', () => {
  it('splits six buttons across two action blocks, because five is the ceiling', () => {
    const blocks = actionBlocks([...ACTIONS], CORR)
    expect(blocks).toHaveLength(2)
    expect(elementsOf(blocks[0])).toHaveLength(MAX_ACTION_ELEMENTS)
    expect(elementsOf(blocks[1])).toHaveLength(ACTIONS.length - 5)
  })

  it('keeps every button, so the sixth is not the one that disappears', () => {
    const ids = actionBlocks([...ACTIONS], CORR).flatMap((b) =>
      elementsOf(b).map((e) => String(e.action_id)),
    )
    expect(ids).toEqual([...ACTIONS])
  })

  it('splits a long body rather than truncating it', () => {
    const body = `${'a'.repeat(2500)}\n\n${'b'.repeat(2500)}`
    const parts = splitBody(body)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SECTION_TEXT)
    // Nothing lost: every character survives somewhere.
    expect(parts.join('').replace(/\s/g, '').length).toBe(body.replace(/\s/g, '').length)
  })

  it('prefers a paragraph boundary when one is available', () => {
    const body = `${'a'.repeat(2000)}\n\n${'b'.repeat(2000)}`
    expect(splitBody(body)[0]).toBe('a'.repeat(2000))
  })

  it('splits mid-text when there is no boundary, rather than emitting an over-long block', () => {
    const parts = splitBody('c'.repeat(7000))
    expect(parts).toHaveLength(3)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(MAX_SECTION_TEXT)
  })

  it('keeps a button value well inside the 2000-character limit', () => {
    expect(buttonValue('undo', CORR).length).toBeLessThan(200)
  })

  it('always emits fallback text, without which a phone shows "content can\'t be displayed"', () => {
    expect(fallbackText(message())).toContain('quoted within 4%')
  })
})

describe('the honesty rules', () => {
  it('never shows confidence without the evidence type beside it', () => {
    const line = provenanceLine(meta({ confidence: 'high', evidence: 'inferred' }))
    expect(line).toContain('high')
    expect(line).toContain('inferred')
  })

  it('says plainly when nothing was cited, rather than omitting the sources line', () => {
    expect(provenanceLine(meta({ sources: [] }))).toContain('no sources cited')
  })

  it('labels unreviewed output, because a reader cannot discount what they were not told', () => {
    expect(provenanceLine(meta({ reviewed: false }))).toContain('not reviewed')
    expect(fallbackText(message({ metadata: meta({ reviewed: false }) }))).toContain(
      '[not reviewed]',
    )
  })

  it('shows a surviving contradiction as content, not as small grey type', () => {
    const blocks = resultBlocks(
      message({ metadata: meta({ contradictions: 'Finance and Ops disagree on capacity.' }) }),
    )
    const contradiction = blocks.find(
      (b) => b.type === 'section' && JSON.stringify(b).includes('Unresolved disagreement'),
    )
    expect(contradiction).toBeDefined()
  })

  it('omits the provenance line entirely when there is no metadata, rather than inventing one', () => {
    const blocks = resultBlocks(message({ metadata: null }))
    expect(JSON.stringify(blocks)).not.toContain('confidence')
  })
})

describe('composition', () => {
  it('puts the staff title in context, since the name rides on the username override', () => {
    const first = resultBlocks(message())[0]
    expect(first?.type).toBe('context')
    expect(JSON.stringify(first)).toContain('Research Director')
  })

  it('attaches a url only to the open-project button, and only when there is one', () => {
    const withUrl = actionBlocks(['open_project', 'undo'], CORR, 'https://hq.example/p/1')
    const elements = elementsOf(withUrl[0])
    expect(elements[0]?.url).toBe('https://hq.example/p/1')
    expect(elements[1]?.url).toBeUndefined()

    const without = actionBlocks(['open_project'], CORR, null)
    expect(elementsOf(without[0])[0]?.url).toBeUndefined()
  })

  it('carries the correlation id into every button, so a click can be attributed', () => {
    for (const block of actionBlocks([...ACTIONS], CORR)) {
      for (const element of elementsOf(block)) {
        expect(JSON.parse(String(element.value))).toMatchObject({ c: CORR })
      }
    }
  })

  it('emits no action blocks when no buttons were asked for', () => {
    const blocks = resultBlocks(message({ actions: [] }))
    expect(blocks.some((b) => b.type === 'actions')).toBe(false)
  })
})
