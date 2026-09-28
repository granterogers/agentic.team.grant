import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readTeaching } from '../../src/agents/teaching.js'

/*
  A standing rule is read from HIS words, never from the resolver's paraphrase
  (completion pass; the #322 class). `verify:anchors` showed one door of four
  dropping "I've told you to always give your information in the form of clear
  bullet points. Also, …" because the handler read the rewrite, and every
  plausible rewrite keeps the request and loses the marker.
*/
const source = readFileSync('src/handlers/instruction.ts', 'utf8')

describe('a standing rule is read from his words (completion pass)', () => {
  it('the teaching union reads hisWords, and never the rewritten instruction', () => {
    expect(source).toMatch(
      /\[\.\.\.asRules\.map\(\(text\) => readTeaching\(text, true\)\), readTeaching\(hisWords\)\]/,
    )
    expect(source).not.toMatch(/readTeaching\(instruction\)/)
  })

  it('hisWords is his pre-rewrite text', () => {
    expect(source).toMatch(/const hisWords = resolved\.from \?\? instruction/)
  })

  // Semantic neighbours of the sentence that failed: his words carry the rule.
  it.each([
    "I've told you to always give your information in the form of clear bullet points. Also, I want you to tell me what my current tasks are.",
    'From now on use bullet points. Also, I want you to tell me what is on my list.',
    "I've asked you to always keep it short. Also, tell me what Emma found.",
    'From now on, answer in bullet points. And I want to know what my tasks are.',
    'Never put a due date on anything unless I give one. Also add a task to ring the venue.',
  ])('his words keep the rule: %s', (said) => {
    expect(readTeaching(said)).not.toBeNull()
  })

  // Why the paraphrase cannot be the source: it loses the marker.
  it.each([
    'Tell me what my current tasks are, in clear bullet points.',
    'List my current tasks as clear bullet points, as I have asked before.',
    'What are my current tasks? Present the information in clear bullet points.',
  ])('a rewrite of it carries no rule: %s', (rewrite) => {
    expect(readTeaching(rewrite)).toBeNull()
  })

  // Negative controls: a request with no lasting marker is not a rule.
  it.each([
    'Tell me what my current tasks are.',
    'Give me that in bullet points.',
    'Okay, never mind about that.',
  ])('not a rule: %s', (said) => {
    const t = readTeaching(said)
    expect(t !== null && t.kind === 'lesson' && t.marked).toBe(false)
  })
})
