/**
 * The message Grant actually received, and the ones that must survive intact.
 */
import { describe, expect, it } from 'vitest'
import { hadScaffolding, scrub } from '../../src/text/scrub.ts'

describe('model scaffolding reaching a person', () => {
  it('cuts the reply Grant was actually sent', () => {
    // Verbatim, Telegram, 2026-09-09, from dots-3-note-preview:free.
    const sent =
      "Let me check what's already in Notion first, then build from there.\n<dots_function_call>\n__unparsedUserInput__"
    expect(scrub(sent)).toBe("Let me check what's already in Notion first, then build from there.")
  })

  it('handles the other families, not just the one that bit us', () => {
    // A list of models would be out of date the next time OpenRouter rotates
    // its free tier; these are the conventional shapes.
    for (const [raw, want] of [
      ['Done.\n<tool_call>{"name":"x"}', 'Done.'],
      ['Here you go.<|im_start|>assistant', 'Here you go.'],
      ['On it.\n```tool_code\nprint(1)\n```', 'On it.'],
      ['Fine.<|eot_id|>', 'Fine.'],
      ['Sure.\n__tool_call__ {}', 'Sure.'],
    ] as const) {
      expect(scrub(raw), raw).toBe(want)
    }
  })

  it('cuts at the FIRST token, so nothing after it survives as prose', () => {
    // Deleting only the token would leave its arguments behind looking like
    // something the reader should act on.
    expect(scrub('Answer.\n<tool_call>\nplease run the thing\n</tool_call>')).toBe('Answer.')
  })

  it('says something rather than nothing when the whole reply was scaffolding', () => {
    // An empty message is worse than a plain one — a person is owed a sentence.
    const out = scrub('<dots_function_call>\n__unparsedUserInput__')
    expect(out).toMatch(/ask me again/i)
    expect(out.length).toBeGreaterThan(20)
  })
})

describe('what must pass through untouched', () => {
  it('leaves ordinary replies exactly as written', () => {
    for (const said of [
      'Two decisions are waiting on you. I will chase them tomorrow.',
      'I created 4 pages in Notion: Module 1, Module 2, Module 3 and the overview.',
      'The <b>bold</b> bit is fine, and so is a < b arithmetic.',
      'Use the __init__ method — that is a real thing people say.',
    ]) {
      expect(scrub(said), said).toBe(said)
      expect(hadScaffolding(said), said).toBe(false)
    }
  })

  it('does not eat a code fence that is actually code', () => {
    const said = 'Like this:\n```python\nprint(1)\n```'
    expect(scrub(said)).toBe(said)
  })

  it('trims, but does not otherwise rewrite', () => {
    expect(scrub('  spaced out  ')).toBe('spaced out')
  })
})
