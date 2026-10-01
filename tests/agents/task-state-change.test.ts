/**
 * Ledger R3 — finishing or calling off a task from the conversation.
 *
 * "Mark the Hartley one done" was answered "…is now marked as done" over a row
 * still reading todo, because no reading existed. These are the reading and
 * its guards; `verify:task-state` drives the SQL half in a rolled-back
 * transaction.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pickByName, taskStateChange } from '../../src/agents/mine.ts'

describe('a task finished or called off, by a referent', () => {
  it.each([
    ['Mark the Hartley one done.', 'done', 'hartley'],
    ['mark that as complete', 'done', null],
    ['ok, tick it off', 'done', null],
    ['Right, cross that one off', 'done', null],
    ['can you mark it done?', 'done', null],
    ['Close the insurance task', 'done', 'insurance'],
    ["Good. Bin the minibus one, we're driving ourselves.", 'cancelled', 'minibus'],
    ['Get rid of the caterers task', 'cancelled', 'caterers'],
    ['scrap that reminder… actually no, scrap that one', 'cancelled', null],
  ])('%s', (said, state, name) => {
    expect(taskStateChange(said)).toEqual({ state, name })
  })

  it.each([
    // an open noun phrase is not a to-do
    'Delete the email from Sarah',
    'remove the paragraph about pricing',
    'cancel the booking',
    'complete the insurance renewal',
    // a question about it, a prohibition, a report
    'did you mark it done?',
    "don't delete that one yet",
    'I marked it done myself this morning',
    // creation stays creation
    'Add a task to chase the caterers',
  ])('NEGATIVE CONTROL: %s', (said) => {
    expect(taskStateChange(said)).toBeNull()
  })
})

describe('a name picks exactly one task or none', () => {
  const tasks = [
    { id: '1', title: 'Chase the caterers for the final headcount' },
    { id: '2', title: 'Book the minibus for the away day' },
    { id: '3', title: 'Book the venue for the away day' },
  ]
  it('picks the one it names', () => {
    expect(pickByName('minibus', tasks)?.id).toBe('2')
    expect(pickByName('caterers', tasks)?.id).toBe('1')
  })
  it('NEGATIVE CONTROL: two fit, so it asks rather than guesses', () => {
    expect(pickByName('away day', tasks)).toBeNull()
  })
  it('NEGATIVE CONTROL: none fit', () => {
    expect(pickByName('hartley', tasks)).toBeNull()
  })
})

describe('the handler acts through the writer and counts only what changed', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('reads his words for it', () => {
    expect(src).toMatch(/firstOfHis\(taskStateChange\)/)
  })
  it('resolves among this conversation’s tasks, project tasks included', () => {
    expect(src).toMatch(/my_task_referent\([\s\S]{0,160}?p_any_task => true/)
  })
  it('presses app.hq_task_state with the resolved id', () => {
    // With the principal the door recorded (0611): a to-do that stands for a
    // question is only an answer from somebody the office can name.
    expect(src).toMatch(
      /app\.hq_task_state\(app\.job_office\(\$\{lit\(job\.jobId\)\}::uuid\),\s*\$\{lit\(target\.id\)\}, \$\{lit\(settles\.state\)\}, null,\s*app\.command_principal\(/,
    )
  })
  it('claims a change only when the writer returned that state', () => {
    expect(src).toMatch(/got\?\.state !== settles\.state/)
  })
  it('counts it into tasksChanged only when it did', () => {
    expect(src).toMatch(/tasksChanged:[\s\S]{0,200}settledTask\?\.did === true/)
  })
})

describe('a NAMED task is found on his whole list; a pronoun never leaves the chat (R29)', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  it('only when a name was given and this conversation did not match it', () => {
    expect(src).toMatch(
      /settles\.name !== null && pickByName\(settles\.name, candidates\) === null\s*\?\s*await hisTaskByName\(/,
    )
  })
  it('reads his list with the harness flag of THIS turn', () => {
    expect(src).toMatch(
      /app\.my_tasks\(app\.job_office\(\$\{lit\(jobId\)\}::uuid\), 'all', 200, null, 'smart', app\.harness_job\(\$\{lit\(jobId\)\}::uuid\)\)/,
    )
  })
})
