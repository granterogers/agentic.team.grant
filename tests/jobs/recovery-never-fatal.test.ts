import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Ledger R48. One stranded job made the recovery sweep raise and every tick
  abort before dequeuing, for 87 minutes of production. Both halves pinned.
*/
describe('a failing recovery sweep does not stop the queue', () => {
  it('the tick catches a failed sweep and drains anyway', () => {
    const src = readFileSync('src/jobs/worker.ts', 'utf8')
    expect(src).toMatch(/await recoverStalled\(db\)\.catch\(\(error: unknown\) => \{/)
    expect(src).not.toMatch(/if \(options\.recover !== false\) await recoverStalled\(db\)\n/)
  })
  it('0599 sends a stalled committing job somewhere legal and contains each row', () => {
    const sql = readFileSync('migrations/0599_one_stalled_job_must_not_stop_the_office.sql', 'utf8')
    expect(sql).toMatch(/if r\.state = 'committing' then/)
    expect(sql).toMatch(/exception when others then\s*raise warning 'recover_stalled_jobs:/)
  })
})
