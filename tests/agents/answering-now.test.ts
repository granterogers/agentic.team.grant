import { describe, expect, it } from 'vitest'
import { ANSWERING_NOW_LIMIT, answeringNowLine } from '../../src/agents/answering-now.ts'

describe('answeringNowLine: the reply is to the latest message, and only to it', () => {
  it('names the message in quotes, so the reply can be tied to it', () => {
    const line = answeringNowLine('What did the team decide about the budget?')
    expect(line).toBe(
      'The message you are answering now, and only this one, is: "What did the team decide about the budget?"\n\n',
    )
  })

  it('keeps a quote or a newline inside the message from breaking the line', () => {
    const line = answeringNowLine('Say "yes"\nthen stop')
    expect(line).toContain('"Say \\"yes\\"\\nthen stop"')
    expect(line.split('\n').length).toBe(3)
  })

  it('cuts a long message at the limit, so it cannot crowd out the context', () => {
    const long = 'x'.repeat(ANSWERING_NOW_LIMIT + 200)
    const line = answeringNowLine(long)
    const quoted = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'))
    expect(quoted.length).toBe(ANSWERING_NOW_LIMIT)
  })

  it('an empty message is named as empty, not dropped', () => {
    expect(answeringNowLine('')).toBe(
      'The message you are answering now, and only this one, is: ""\n\n',
    )
  })
})
