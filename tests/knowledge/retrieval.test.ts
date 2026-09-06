import { describe, expect, it } from 'vitest'
import { CONTEXT_CHARS, contextBlock, type Hit, sourceRefs } from '../../src/knowledge/retrieval.ts'

const hit = (n: number, excerpt = `body of ${String(n)}`): Hit => ({
  documentId: `doc-${String(n)}`,
  title: `Document ${String(n)}`,
  connector: 'notion',
  rank: 1 / n,
  excerpt,
})

describe('contextBlock', () => {
  it('returns empty for no hits, so a caller can tell it searched and found nothing', () => {
    // The distinction matters: `''` means "say so in the prompt", and an empty
    // string with a header would mean "here is what we found" about nothing.
    expect(contextBlock([])).toBe('')
  })

  it('numbers and titles each excerpt so the model can cite one', () => {
    const block = contextBlock([hit(1), hit(2)])
    expect(block).toContain('[1] Document 1 (notion)')
    expect(block).toContain('[2] Document 2 (notion)')
    expect(block).toContain('body of 1')
  })

  it('stays inside the budget', () => {
    const big = Array.from({ length: 20 }, (_, i) => hit(i + 1, 'x'.repeat(1_000)))
    expect(contextBlock(big).length).toBeLessThanOrEqual(CONTEXT_CHARS + 200)
  })

  it('says how many documents it dropped rather than dropping them silently', () => {
    // A context block that quietly lost half the evidence would make the answer
    // look better sourced than it is.
    const big = Array.from({ length: 20 }, (_, i) => hit(i + 1, 'x'.repeat(1_000)))
    expect(contextBlock(big)).toMatch(/\d+ further document\(s\) matched but did not fit/)
  })

  it('says nothing about dropping when nothing was dropped', () => {
    expect(contextBlock([hit(1)])).not.toContain('did not fit')
  })

  it('keeps the highest-ranked hit even when the budget is tiny', () => {
    // Degrading to one document is a worse answer; degrading to none is a
    // different answer, and the caller would report it as "nothing matched".
    const block = contextBlock([hit(1, 'first'), hit(2, 'x'.repeat(5_000))], 200)
    expect(block).toContain('first')
  })
})

describe('sourceRefs', () => {
  it('records the connector, the id and the title of what was retrieved', () => {
    expect(sourceRefs([hit(1)])).toEqual(['notion:doc-1 Document 1'])
  })

  it('is empty when nothing was retrieved', () => {
    // The pair that matters to §10: no sources means the answer was ungrounded,
    // and the output must not claim otherwise.
    expect(sourceRefs([])).toEqual([])
  })
})
