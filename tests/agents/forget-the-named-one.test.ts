import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { taskStateChange } from '../../src/agents/mine.js'

describe('"forget the printers one" cancels a named task (R42)', () => {
  it.each([
    ['Actually, forget the printers one too.', 'printers'],
    ['Forget the printers task.', 'printers'],
    ['Forget about the insurance reminder.', 'insurance'],
  ])('%s', (said, name) => {
    expect(taskStateChange(said)).toEqual({ state: 'cancelled', name })
  })

  // Negative controls: a bare "forget it" withdraws the request, never a task.
  it.each([
    'Forget it.',
    'Forget that one.',
    'Forget about it, it is fine.',
    "Don't forget the printers one.",
  ])('%s is not a task cancellation', (said) => {
    expect(taskStateChange(said)).toBeNull()
  })

  it('the no-op call-off line is dropped only when a named task was settled', () => {
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(
      /settledTask\?\.did === true && stopped === NOTHING_TO_STOP \? null : stopped,/,
    )
  })
  it('the settle reader falls back to his literal words, as the call-off does', () => {
    const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    expect(src).toMatch(/\(firstOfHis\(taskStateChange\) \?\? taskStateChange\(asSaid\)\)/)
  })
})
