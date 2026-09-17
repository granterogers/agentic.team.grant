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
  routine: false,
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
  it('never puts more than five elements in one block, whatever it is given', () => {
    /*
      The PROPERTY, not the block count. This asserted "exactly two blocks",
      which was the arrangement of the day; #186 folded the two secondary
      actions into one overflow, so the same eight actions now need seven
      elements rather than eight and the arrangement changed. What must never
      change is the ceiling: a sixth element in a block does not error, it
      silently disappears.
    */
    for (const block of actionBlocks([...ACTIONS], CORR)) {
      expect(elementsOf(block).length).toBeLessThanOrEqual(MAX_ACTION_ELEMENTS)
    }
  })

  it('keeps every action reachable, whether as a button or inside the overflow', () => {
    /*
      #186 put Mute 24h and More detail behind a `⋯`, so they are no longer
      `action_id`s on elements — they are options inside one. Reachability is
      the thing that matters and it is now asked of both shapes, which is the
      assertion that would have caught them being dropped entirely.
    */
    const reachable = actionBlocks([...ACTIONS], CORR).flatMap((b) =>
      elementsOf(b).flatMap((e) =>
        e.type === 'overflow'
          ? (e.options as { value: string }[]).map((o) => (JSON.parse(o.value) as { a: string }).a)
          : [String(e.action_id)],
      ),
    )
    expect(reachable.sort()).toEqual([...ACTIONS].sort())
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
  it('never shows how sure it is without saying on what basis', () => {
    /*
      §12's rule, asserted as a property rather than on two literal words.
      #186 rewrote this line into English — "Fairly confident — worked out, not
      looked up" instead of "*medium* confidence · evidence: *inferred*" —
      because Grant's complaint was that it read as internal field names. The
      rule it enforces is unchanged: both halves are always present, and each
      one MOVES when its input does. A line that dropped the basis would pass a
      `toContain` on the confidence word and fails this.
    */
    const sures = new Set<string>()
    const bases = new Set<string>()
    for (const confidence of ['low', 'medium', 'high'] as const) {
      for (const evidence of ['verified', 'inferred', 'speculative'] as const) {
        const line = provenanceLine(meta({ confidence, evidence, sources: ['s'] }))
        const [sure, basis] = line.split(' — ')
        expect(sure, line).toBeTruthy()
        expect(basis, line).toBeTruthy()
        sures.add(String(sure))
        bases.add(String(basis))
      }
    }
    // Three distinct confidences and three distinct bases, so neither half is
    // a constant string that merely looks like it is saying something.
    expect(sures.size).toBe(3)
    expect(bases.size).toBe(3)
  })

  it('says plainly when nothing was cited, in every branch, rather than by omission', () => {
    /*
      An honesty rule, and #186's first draft weakened it: the new wording said
      "worked out, not looked up" and left the absence of sources to be
      inferred from that. It does imply it — to a careful reader — and §12 asks
      for it to be STATED. Asserted across every evidence type so a future
      branch cannot quietly drop it again.
    */
    for (const evidence of ['verified', 'inferred', 'speculative'] as const) {
      const line = provenanceLine(meta({ evidence, sources: [] }))
      expect(line.toLowerCase(), line).toMatch(/nothing/)
    }
    expect(provenanceLine(meta({ sources: ['a', 'b'] }))).toContain('2 sources')
    expect(provenanceLine(meta({ sources: ['a'] }))).toContain('1 source')
  })

  it('labels unreviewed output, because a reader cannot discount what they were not told', () => {
    // Wording changed in #186 — "Nobody has checked this yet" rather than
    // "not reviewed" — because the line is read by a person on a phone. The
    // rule is that unreviewed output is MARKED, and the warning emoji plus a
    // sentence saying so is the mark.
    expect(provenanceLine(meta({ reviewed: false }))).toContain('Nobody has checked this yet')
    expect(provenanceLine(meta({ reviewed: true }))).not.toContain('Nobody has checked')
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

  it('carries the correlation id into everything pressable, so a click can be attributed', () => {
    /*
      Including the overflow's OPTIONS (#186). Slack sends an overflow's payload
      as `selected_option.value` and leaves the element's own `value` undefined,
      so an overflow whose options carried no correlation would be two controls
      that post and cannot be attributed to a message.
    */
    for (const block of actionBlocks([...ACTIONS], CORR)) {
      for (const element of elementsOf(block)) {
        if (element.type === 'overflow') {
          for (const option of element.options as { value: string }[]) {
            expect(JSON.parse(option.value)).toMatchObject({ c: CORR })
          }
        } else {
          expect(JSON.parse(String(element.value))).toMatchObject({ c: CORR })
        }
      }
    }
  })

  it('emits no action blocks when no buttons were asked for', () => {
    const blocks = resultBlocks(message({ actions: [] }))
    expect(blocks.some((b) => b.type === 'actions')).toBe(false)
  })
})

/**
 * A routine read is not dressed as a finding.
 *
 * Grant, 13 September, on three screenshots of his phone: *"how much space is
 * being taken up by the way you're using Slack. It's really not intuitive or
 * acting like it's a human."*
 *
 * What he was looking at, and 270 times in ten days:
 *
 *     Looked at 1 Drive folder. Nothing new.
 *     Confident — checked against 1 source.
 *     [ 👍 Useful ] [ 👎 Not useful ] [ ⋯ ]
 *
 * The rule is about honesty rather than about space: a message says how much
 * to trust it exactly when there is something to decide.
 */
describe('a mechanical read', () => {
  const routine = (over: Partial<MessageMetadata> = {}): ResultMessage =>
    message({ metadata: meta({ routine: true, evidence: 'verified', ...over }) })

  it('carries no provenance line', () => {
    const blocks = resultBlocks(routine())
    const captions = blocks
      .filter((b) => b.type === 'context')
      .flatMap((b) => elementsOf(b).map((e) => String((e as { text?: string }).text ?? '')))
    expect(captions.some((c) => c.includes('Confident'))).toBe(false)
    expect(captions.some((c) => c.includes('checked against'))).toBe(false)
  })

  /*
    CONTROL, and the one that matters most. Everything above would also pass if
    the provenance line had been deleted outright — which is the change #185
    exists to prevent, because "worked out, not looked up" is the sentence that
    stops an inference being read as an observation.
  */
  it('CONTROL: a judgement still carries every word of it', () => {
    const blocks = resultBlocks(message({ metadata: meta({ routine: false }) }))
    const captions = blocks
      .filter((b) => b.type === 'context')
      .flatMap((b) => elementsOf(b).map((e) => String((e as { text?: string }).text ?? '')))
    expect(captions.some((c) => c.includes('worked out, not looked up'))).toBe(true)
  })

  /*
    A contradiction is the exception, and deliberately so: a mechanical read
    should not produce one, and if it does, it is the most interesting thing on
    the message. §16 says a surviving disagreement must not be averaged away,
    and hiding it because the output was deterministic would be averaging it
    away by category.
  */
  it('still shows a contradiction, which is the one thing worth interrupting for', () => {
    const blocks = resultBlocks(
      routine({ contradictions: 'The folder listing and the index disagree on two files.' }),
    )
    const sections = blocks
      .filter((b) => b.type === 'section')
      .map((b) => String((b.text as { text?: string } | undefined)?.text ?? ''))
    expect(sections.some((t) => t.includes('Unresolved disagreement'))).toBe(true)
  })
})
