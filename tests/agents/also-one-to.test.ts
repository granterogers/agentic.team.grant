import { describe, expect, it } from 'vitest'
import { classifyIntent } from '../../src/agents/intent.js'
import { personalTaskRequest } from '../../src/agents/mine.js'
import { resolveElliptical, taskRequest, wantsAntecedent } from '../../src/agents/tasks.js'

const read = (said: string, before = '') =>
  taskRequest(said, classifyIntent(said), `${said} ${before}`)

describe('"also one to…" is a task by the previous turn (R7)', () => {
  const before = 'Add a task to chase the printers about the proofs.'
  it.each([
    ['Thanks. Also one to book the minibus for Saturday.', /minibus/i],
    ['And another for the caterers.', /caterers/i],
    ['Also add one to ring the venue.', /venue/i],
    ['Perfect, and one more to confirm the florist.', /florist/i],
  ])('%s', (said, title) => {
    expect(wantsAntecedent(said)).toBe(true)
    const got = read(said, before)
    expect(got).not.toBeNull()
    expect(String(got?.title)).toMatch(title)
  })

  // Negative controls: no task antecedent, or not elliptical at all.
  it('with no task in the previous turn it is not a task', () => {
    expect(
      read('Also one to book the minibus for Saturday.', 'How is the venue looking?'),
    ).toBeNull()
  })
  it.each([
    'That one to watch is Kevin.',
    'One of them is late again.',
    'Also, one thing to check before Friday is the deposit.',
  ])('%s does not ask for the previous turn', (said) => {
    expect(wantsAntecedent(said)).toBe(false)
  })
  it('a message that names the task itself does not need the previous turn', () => {
    expect(wantsAntecedent('Add a task to ring the venue.')).toBe(false)
  })
  it('the personal-task reader is given the resolved sentence too', () => {
    const said = 'Thanks. Also one to book the minibus for Saturday.'
    const got = personalTaskRequest(resolveElliptical(said, `${said} ${before}`))
    expect(String(got?.title)).toMatch(/minibus/i)
    expect(personalTaskRequest(resolveElliptical(said, `${said} How is the venue?`))).toBeNull()
  })
  it('the handler feeds the previous turn to both readers', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(
      /personalTaskRequest\(resolveElliptical\(text, `\$\{turn\.kept\} \$\{hisLastTurn\}`\)\)/,
    )
    expect(src).toMatch(/const hisLastTurn = wantsAntecedent\(turn\.kept\)/)
    // And his resolved sentence is a reading in its own right: the model's may drop it.
    expect(src).toMatch(
      /const hisRequests = \[\s*\.\.\.\(hisElliptical !== turn\.kept \? \[hisElliptical\] : \[\]\)/,
    )
  })
})
