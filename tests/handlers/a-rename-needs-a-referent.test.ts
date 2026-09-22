/**
 * #313 — a follow-up may rename only what it is canonically grounded on.
 *
 * ## What #259's own control caught, on v729
 *
 *     CONTROL: it does NOT rename the task he made twenty minutes ago
 *       "Review the onboarding copy for the task labeled kvkg66m5"
 *       WAS "Chase the printers kvkg66m5"
 *
 * One reply renamed an unrelated personal task.
 *
 * ## The condition, found by reproducing it rather than by reading
 *
 * "Call it X" has two readings and #259 built the disambiguation: if the
 * office asked "what should I call it?" last turn this is the ANSWER,
 * otherwise it is a rename. In a clean two-turn thread the answer path wins
 * and nothing is harmed — reproduced, twice.
 *
 * When the lookup does not find a title question — a thread with other turns
 * in it, a rewording, a turn that failed — the rename path runs, and it asked
 * `app.my_task_recent()`: **the newest open personal task in the last half
 * hour, anywhere in the office**. That is proximity standing in for
 * reference. The task Grant meant and the newest task coincide only by luck.
 *
 * The caller's own comment already said *"never claim a task was changed
 * unless canonical state proves it"*, and the only thing proved was that
 * SOMETHING recent existed.
 *
 * ## The invariant
 *
 * A follow-up mutation may modify an existing object only where that object
 * is canonically grounded as the intended referent. Ambiguity, or the absence
 * of grounding, is answered by ASKING — never by guessing destructively.
 *
 * The four boundaries are proved against the real database by
 * `npm run verify:context`: none, one, several, and a different conversation.
 * What this file holds is the wiring, which is where a future change would
 * put the guess back.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('src/handlers/instruction.ts', 'utf8')
const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

describe('the rename path asks for a referent, not for a recent row', () => {
  it('calls the referent reader', () => {
    expect(withoutComments).toMatch(/app\.my_task_referent\(/)
  })

  it('and no longer calls the proximity one', () => {
    /*
      `app.my_task_recent` still exists and still has its other job — saying
      what the office just did. What must not come back is this CALLER.
    */
    expect(withoutComments).not.toMatch(/app\.my_task_recent\(\)/)
  })

  it('passes the conversation, because that is what grounds it', () => {
    expect(withoutComments).toMatch(/my_task_referent\(\$\{lit\(String\(payload\.command_id/)
  })
})

describe('and ambiguity is answered by asking, with the candidates named', () => {
  it('reports several rather than choosing one', () => {
    expect(withoutComments).toMatch(/typeof subject\?\.ambiguous === 'number'/)
    expect(withoutComments).toContain('There is more than one thing that could be')
  })

  it('names them, because "which one?" with no list is unanswerable', () => {
    expect(withoutComments).toMatch(/subject\.titles \?\? \[\]/)
  })

  it('and still says so plainly when there is nothing to point at', () => {
    expect(withoutComments).toContain('I am not sure which task you mean')
    /*
      Reworded with the fix: the old sentence said "in the last half hour",
      which described the defect. The scope is the conversation now.
    */
    expect(withoutComments).toContain('in this conversation')
  })
})
