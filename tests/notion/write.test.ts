/**
 * Markdown crossing into Notion, and the two limits that reject rather than trim.
 */
import { describe, expect, it } from 'vitest'
import { MAX_BLOCKS_PER_REQUEST, richText, toBlocks } from '../../src/notion/write.ts'

const types = (md: string): string[] => toBlocks(md).map((b) => b.type)
const textOf = (b: Record<string, unknown>): string => {
  const body = b[String(b.type)] as { rich_text?: { text: { content: string } }[] }
  return (body.rich_text ?? []).map((r) => r.text.content).join('')
}

describe('structure survives the crossing', () => {
  it('keeps headings, lists, quotes and rules apart', () => {
    // Grant: "Structured pages, not dumps of source text." A page that is one
    // enormous paragraph is exactly the dump he does not want.
    const md = [
      '# Curriculum',
      '',
      'Intro line.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> a quote',
      '',
      '---',
    ].join('\n')
    expect(types(md)).toEqual([
      'heading_1',
      'paragraph',
      'bulleted_list_item',
      'bulleted_list_item',
      'numbered_list_item',
      'numbered_list_item',
      'quote',
      'divider',
    ])
  })

  it('reads a checklist as one, because a coaching curriculum is full of them', () => {
    const blocks = toBlocks('- [ ] not yet\n- [x] done')
    expect(blocks.map((b) => b.type)).toEqual(['to_do', 'to_do'])
    expect((blocks[0]?.to_do as { checked: boolean } | undefined)?.checked).toBe(false)
    expect((blocks[1]?.to_do as { checked: boolean } | undefined)?.checked).toBe(true)
  })

  it('flattens a heading deeper than Notion goes rather than losing it', () => {
    // Notion stops at three. Losing one level of hierarchy beats losing the
    // fact that it was a heading at all.
    expect(types('#### deep')).toEqual(['heading_3'])
  })

  it('keeps a code fence together and refuses to invent a language', () => {
    const blocks = toBlocks('```klingon\nnuqneH\n```')
    expect(blocks[0]?.type).toBe('code')
    // Notion rejects an unknown language outright, so an unrecognised one has
    // to become plain text rather than be passed through.
    expect((blocks[0]?.code as { language: string } | undefined)?.language).toBe('plain text')
    expect(textOf(blocks[0] as Record<string, unknown>)).toBe('nuqneH')
  })

  it('keeps the content of a fence the model forgot to close', () => {
    const blocks = toBlocks('```\nstill worth keeping')
    expect(blocks[0]?.type).toBe('code')
    expect(textOf(blocks[0] as Record<string, unknown>)).toBe('still worth keeping')
  })

  it('leaves anything it does not recognise as a paragraph', () => {
    // The safe direction: an unstyled line reads fine, a mis-parsed one loses
    // its content.
    expect(types('| a | table |')).toEqual(['paragraph'])
  })
})

describe('the limits Notion rejects on', () => {
  it('splits a run over 2,000 characters instead of being refused', () => {
    const long = 'word '.repeat(1_000).trim()
    const runs = richText(long)
    expect(runs.length).toBeGreaterThan(1)
    for (const r of runs) expect(r.text.content.length).toBeLessThanOrEqual(2_000)
    // And nothing is lost in the split.
    expect(runs.map((r) => r.text.content).join(' ')).toBe(long)
  })

  it('breaks at a space, so the seam is invisible', () => {
    const runs = richText('word '.repeat(1_000).trim())
    expect(runs[0]?.text.content.endsWith('word')).toBe(true)
  })

  it('splits an unbroken token hard rather than refusing to write it', () => {
    const runs = richText('x'.repeat(5_000))
    expect(runs.length).toBe(3)
    expect(runs.map((r) => r.text.content).join('')).toHaveLength(5_000)
  })

  it('never produces an empty rich_text, which Notion also rejects', () => {
    expect(richText('')).toHaveLength(1)
  })

  it('knows the block ceiling a long page has to be split across', () => {
    expect(MAX_BLOCKS_PER_REQUEST).toBe(100)
    const many = toBlocks(Array.from({ length: 250 }, (_, i) => `- item ${String(i)}`).join('\n'))
    expect(many).toHaveLength(250)
  })
})
