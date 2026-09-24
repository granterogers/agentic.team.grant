/**
 * Ledger R6 — "add checking the figures as a subtask under it".
 *
 * Filed a flat task titled "checking the figures as a subtask under the
 * 'Review the Hartley proposal'", with no parent.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { subtaskRequest } from '../../src/agents/mine.ts'

describe('a subtask is read as a child of a referent', () => {
  it.each([
    ['Add checking the figures as a subtask under it.', 'Checking the figures', null],
    ['add a subtask to the Hartley one: check the figures', 'Check the figures', 'hartley'],
    ['Put ringing the bank as a sub-task of the insurance task', 'Ringing the bank', 'insurance'],
    ['add a subtask under that to call Marta', 'Call Marta', null],
  ])('%s', (said, title, parentName) => {
    expect(subtaskRequest(said)).toEqual({ title, parentName })
  })

  it.each([
    'Add a task to check the figures',
    'Is checking the figures a subtask of it?',
    'the subtask is done',
  ])('NEGATIVE CONTROL: %s', (said) => {
    expect(subtaskRequest(said)).toBeNull()
  })
})

describe('the handler writes it under its parent and vetoes the flat readers', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('vetoes the personal and project task readers', () => {
    expect(src).toMatch(
      /const forGrant =\s*wantsFile !== null \|\| isBranch \|\| changesHis !== null \|\| subOf !== null/,
    )
    expect(src).toMatch(
      /const asked =\s*pullOut !== null \|\| noted !== null \|\| isBranch \|\| subOf !== null/,
    )
  })
  it('writes through my_task_add with the resolved parent', () => {
    expect(src).toMatch(/p_parent => \$\{lit\(parent\.id\)\}/)
  })
})
