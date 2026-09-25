import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { answerFor, STEP_OPTIONS } from '../../src/agents/perform.js'

const withRow = (row: unknown) => ({ execute: async () => ({ rows: row === null ? [] : [row] }) })

describe('an answer already given decides the step (R45)', () => {
  it('no answer yet asks', async () => {
    expect(await answerFor(withRow(null) as never, 'j', {})).toBeNull()
  })
  it('the first option is consent', async () => {
    expect(
      await answerFor(
        withRow({
          resolution: 'Yes, do it — answered by grant',
          approval_options: [...STEP_OPTIONS],
        }) as never,
        'j',
        {},
      ),
    ).toBe('yes')
  })
  it('the second is a no', async () => {
    expect(
      await answerFor(
        withRow({
          resolution: 'No, leave it — answered by grant',
          approval_options: [...STEP_OPTIONS],
        }) as never,
        'j',
        {},
      ),
    ).toBe('no')
  })
  // Control: anything else is never taken as a yes.
  it.each(['yeah maybe later', 'Go ahead', ''])(
    '"%s" is unclear, never a yes',
    async (resolution) => {
      expect(
        await answerFor(
          withRow({ resolution, approval_options: [...STEP_OPTIONS] }) as never,
          'j',
          {},
        ),
      ).toBe('unclear')
    },
  )

  const perform = readFileSync('src/agents/perform.ts', 'utf8')
  const pursue = readFileSync('src/handlers/pursue.ts', 'utf8')
  const worker = readFileSync('src/jobs/worker.ts', 'utf8')
  it('the step consults the answer before asking again', () => {
    expect(perform).toMatch(
      /const hisAnswer = decision\.verdict === 'ask' \? await answerFor\(db, jobId, binds\) : null/,
    )
    expect(perform).toMatch(/if \(decision\.verdict === 'ask' && hisAnswer !== 'yes'\) \{/)
  })
  it('a declined step ends the pursuit rather than being re-planned', () => {
    expect(pursue).toMatch(/!Object\.values\(everySeen\)\.some\(\(o\) => o\.declined === true\) &&/)
  })
  it('a job its handler paused has its output reviewed and stays paused', () => {
    expect(worker).toMatch(
      /if \(stateNow === 'paused'\) \{\s*if \(!gate\.exempt\) \{\s*const verdict = await review\(output, job\)/,
    )
  })
  it('the approval binds what the step will DO, so a changed step is asked afresh', () => {
    expect(perform).toMatch(
      /project: projectId,\s*why: step\.why,\s*needs: \[\.\.\.step\.needs\],\s*\}\s*const hisAnswer/,
    )
  })
  it("0592's idempotency never returns a question's own to-do as the step's work", () => {
    const sql = readFileSync('migrations/0592_a_retry_does_not_write_the_task_again.sql', 'utf8')
    expect((sql.match(/and t\.satisfies_blocker is null/g) ?? []).length).toBe(3)
  })
})
