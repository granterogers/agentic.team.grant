/**
 * R2 / Z1: one sentence, one effect; and one clock.
 *
 * "Mark the roofer task done" completed the task AND filed a junk team task titled "the roofer task done", answering
 * "Added it". Two readers claimed one sentence: the team-task reader (a task noun and an imperative) and the state
 * change. `changesHis` already vetoed the personal reader for a change; `settles` is now read first and vetoes the
 * creators, and `taskStateChange` itself declines a sentence that is a request for a NEW task. The database half (rows
 * before and after, through the real handler) is scripts/isolated/tk-state-changes.ts.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personalTaskChange, taskStateChange } from '../../src/agents/mine.ts'
import { classifyIntent } from '../../src/agents/intent.ts'
import { taskRequest } from '../../src/agents/tasks.ts'

describe('taskStateChange reads the sentences that finish or call off a task', () => {
  it.each([
    ['Mark the roofer task done.', 'done', 'roofer'],
    ['Complete the roofer task.', 'done', 'roofer'],
    ['Tick off roofer.', 'done', 'roofer'],
    ['Tick off the roofer task.', 'done', 'roofer'],
    ['Cross off the venue one.', 'done', 'venue'],
    ['Cancel the venue task.', 'cancelled', 'venue'],
    ['Delete the venue task.', 'cancelled', 'venue'],
    ['Mark it done.', 'done', null],
    ['Please mark that one as finished.', 'done', null],
  ])('%s', (said, state, name) => {
    expect(taskStateChange(said)).toEqual({ state, name })
  })
})

describe('NEGATIVE: a sentence that CREATES work is not a state change, whatever verb is in its object', () => {
  it.each([
    'Add a task to call the roofer.',
    'Remind me to call the roofer.',
    'Add a task to cancel the venue task.',
    'Remind me to cancel the venue task.',
    'Remind me to tick off the roofer.',
    'Put a to-do on my list to complete the roofer task.',
    'Create a reminder to delete the venue task.',
    'Please create a task for Emma to cancel the venue task.',
  ])('%s', (said) => {
    expect(taskStateChange(said)).toBeNull()
  })
  it.each([
    "Don't mark the roofer task done yet.",
    'Should I cancel the venue task?',
    'Do not cancel the venue task.',
    'Mark the roofer task done, actually no, leave it.',
  ])('and neither is a prohibition, a question or a withdrawn request: %s', (said) => {
    expect(taskStateChange(said)).toBeNull()
  })
})

describe('the team-task reader DOES claim the state-change sentences, which is why the veto exists', () => {
  // Proof that the veto is load-bearing rather than decorative: without it these sentences are creations.
  it.each(['Mark the roofer task done.', 'Cancel the venue task.', 'Complete the roofer task.'])('%s', (said) => {
    const made = taskRequest(said, classifyIntent(said))
    expect(made).not.toBeNull()
    expect(made?.title).not.toBeNull()
  })
})

describe('rename by name', () => {
  it('"Rename the roofer task to Call John." is a change naming the task, not a creation', () => {
    const got = personalTaskChange('Rename the roofer task to Call John.')
    expect(got).toMatchObject({ title: 'Call John', name: 'roofer' })
    expect(got?.matched).toContain('a new name')
  })
  it('the bare-referent rename still works', () => {
    expect(personalTaskChange('rename it to Call John')).toMatchObject({ title: 'Call John', name: null })
  })
  it('NEGATIVE: renaming something that is not a task is not read', () => {
    expect(personalTaskChange('Rename the file to final.pdf')).toBeNull()
    expect(personalTaskChange('Rename the pricing document to Pricing v2')).toBeNull()
  })
})

describe('the handler wires the veto (asserted as the call whose answer is consumed, not the name)', () => {
  const src = readFileSync('src/handlers/instruction.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  const sliceBetween = (from: RegExp, to: RegExp): string => {
    const a = from.exec(src)
    if (a === null) throw new Error(`anchor not found: ${String(from)}`)
    const rest = src.slice(a.index)
    const b = to.exec(rest.slice(a[0].length))
    return b === null ? rest : rest.slice(0, a[0].length + b.index)
  }
  it('settles is read from his own words, before forGrant, asked and namedLater', () => {
    expect(src).toMatch(/const settles =\s*wantsFile !== null \|\| isBranch \|\| forwarded\s*\?\s*null\s*:\s*(?:\/\/[^\n]*\n\s*)?\(?firstOfHis\(taskStateChange\)/)
    const iSettles = src.indexOf('const settles =')
    expect(iSettles).toBeGreaterThan(0)
    for (const later of ['const forGrant =', 'const noted =', 'const asked =', 'const namedLater =']) {
      expect(src.indexOf(later), later).toBeGreaterThan(iSettles)
    }
  })
  it('the team-task reader, the personal reader and the title-answer reader all defer to it', () => {
    const asked = sliceBetween(/const asked =/, /\n\s*const namedLater =/)
    expect(asked).toContain('settles !== null')
    const forGrant = sliceBetween(/const forGrant =/, /\n\s*const noted =/)
    expect(forGrant).toContain('settles !== null')
    const namedLater = sliceBetween(/const namedLater =/, /\n\s*const change =/)
    expect(namedLater).toContain('settles !== null')
  })
})

describe('Z1: the operator\'s zone is named in ONE module', () => {
  const read = (p: string): string =>
    readFileSync(p, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
  it.each([
    'src/agents/due.ts',
    'src/agents/mine.ts',
    'src/agents/remind-at.ts',
    'src/agents/reminder-say.ts',
    'src/agents/recurrence.ts',
    'src/handlers/instruction.ts',
    'src/handlers/reminders.ts',
  ])('%s does not hard-code a zone', (file) => {
    expect(read(file)).not.toMatch(/Europe\/Athens/)
    expect(read(file)).not.toMatch(/['"]UTC['"]\)?\s*\.\s*(?:getDay|toISOString)/)
  })
  it('office-time.ts is where the default lives', () => {
    expect(read('src/agents/office-time.ts')).toMatch(/OPERATOR_TIMEZONE = 'Europe\/Athens'/)
  })
  it('every parser takes the zone as a parameter that the handler passes', () => {
    const src = read('src/handlers/instruction.ts')
    expect(src).toMatch(/personalTaskChange\(text, nowAt, officeTz\)/)
    expect(src).toMatch(/personalTaskRequest\(\s*resolveElliptical\([^)]*\),\s*nowAt,\s*officeTz/)
    expect(src).toMatch(/addTask\(deps\.db, job, asked, instruction, nowAt, officeTz\)/)
    expect(src).toMatch(/dueOn\(said_by === '' \? asked\.title : said_by, now, timeZone\)/)
    expect(src).toMatch(/timeZone: officeTz/)
  })
})
