import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  Run 4, D1. The fence is only as good as the writes that go through it. `runJob` runs a job it has claimed, and
  every state change on that path must be made under the claim (`moveJob`), because a bare `moveTo(db, job.jobId,
  ...)` is the old unfenced write - a stale worker finishing a job another holds. This asserts the property over
  the source of the running path rather than the name of one helper:
    - inside runJobHeld there is no unfenced state write, no matter how it is spelled;
    - the output insert is guarded by an ownership check on the same path;
    - the only unfenced `moveTo` calls left are the sweeps that act on OTHER workers' jobs (recovery of a job
      nobody holds), which is where an unfenced write is the point.
*/
const src = readFileSync(new URL('../../src/jobs/worker.ts', import.meta.url), 'utf8')
const start = src.indexOf('const runJobHeld = async (')
const end = src.indexOf('export const drain = async (')
const running = src.slice(start, end)

describe('the running path writes under its claim', () => {
  it('found the region it means to read', () => {
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    expect(running.length).toBeGreaterThan(10_000)
  })
  it('makes every state write through moveJob, never a bare moveTo on its own job', () => {
    const codeOnly = running.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/\bmoveTo\(\s*db,\s*job\.jobId/)
    expect((codeOnly.match(/\bmoveJob\(/g) ?? []).length).toBeGreaterThanOrEqual(10)
  })
  it('writes no job state by any other route (an inline update of public.jobs.state)', () => {
    const codeOnly = running.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/update public\.jobs\s+set\s+state\b/)
  })
  it('asks whether it still holds the job immediately before the output insert', () => {
    const codeOnly = running.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    const guard = codeOnly.indexOf('await assertHeld(db, job)')
    const insert = codeOnly.indexOf('insert into public.outputs')
    expect(guard).toBeGreaterThan(0)
    expect(insert).toBeGreaterThan(guard)
    // and close enough that nothing slow can sit between them
    expect(insert - guard).toBeLessThan(400)
  })
  it('and moveTo itself adds the claim to its WHERE clause and refuses a write that changed nothing', () => {
    const m = src.slice(
      src.indexOf('const moveTo = async ('),
      src.indexOf('/** `moveTo` under the claim'),
    )
    expect(m).toMatch(/const fence = fenceClause\(claim\)/)
    expect(m).toMatch(/where job_id = \$\{lit\(jobId\)\}::uuid\$\{fence\}/)
    expect(m).toMatch(/throw new StaleWorkerError\(/)
  })
})
