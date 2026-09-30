import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The unit tests that read an answer out of a resolution SENTENCE were retired
  with `answerFor` (0611): the answer is a column now (`answered_option`) and
  the decision is `app.authorize_effect`, driven for every case by
  scripts/isolated/authority.ts. What stays here is the wiring.
*/
describe('an answer already given decides the step (R45)', () => {
  const perform = readFileSync('src/agents/perform.ts', 'utf8')
  const pursue = readFileSync('src/handlers/pursue.ts', 'utf8')
  const worker = readFileSync('src/jobs/worker.ts', 'utf8')
  it('the step asks the ONE boundary, carrying the exact action, who acts and who it reaches', () => {
    const call = /const decision = await mayAct\(db, \{([\s\S]*?)\}\)/.exec(perform)?.[1] ?? ''
    for (const wired of [
      'staff: step.specialist',
      'audience: step.audience',
      'fingerprint: await fingerprint(binds)',
      'job: jobId',
    ]) {
      expect(call).toContain(wired)
    }
    expect(perform).toMatch(/if \(decision\.verdict === 'ask'\) \{/)
    expect(perform).not.toMatch(/answerFor/)
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
      /project: projectId,\s*why: step\.why,\s*needs: \[\.\.\.step\.needs\],\s*\}\s*const decision = await mayAct/,
    )
  })
  it("0592's idempotency never returns a question's own to-do as the step's work", () => {
    const sql = readFileSync('migrations/0592_a_retry_does_not_write_the_task_again.sql', 'utf8')
    expect((sql.match(/and t\.satisfies_blocker is null/g) ?? []).length).toBe(3)
  })
})
