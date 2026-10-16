/**
 * verifyRuns: the order of its answers and the rule that an unfinished or foreign backup is never verified. The network
 * reads are not exercised here (they need a live bucket); the runs below are the ones that must be refused WITHOUT a
 * read, so the test needs no network and still proves the refusal. A control run that IS complete and ours is included
 * in the shape check, so a version that refused everything would be seen to refuse the control too only through the read
 * path, which is covered by the rehearsal, not by this file.
 */
import { describe, expect, it } from 'vitest'
import type { RunInfo } from '../../src/backup/retention.ts'
import { verifyRuns } from '../../src/backup/runs.ts'

const run = (name: string, complete: boolean): RunInfo => ({
  name,
  at: '2026-10-10T00:00:00Z',
  bytes: 10,
  complete,
  verified: false,
})

describe('verifyRuns', () => {
  it('never verifies an unfinished or a foreign backup, and reports every run in the order it was given', async () => {
    const runs = [
      run('run-11111111-1111-4111-8111-111111111111', false),
      run('not-ours-at-all.zip', true),
      run('run-22222222-2222-4222-8222-222222222222', false),
      run('stranger-file.json', false),
      run('run-33333333-3333-4333-8333-333333333333', false),
    ]
    const seen: string[] = []
    const out = await verifyRuns('http://127.0.0.1:9', 'key', runs, (r) => seen.push(r.name), 3)

    expect(out.map((r) => r.name)).toEqual(runs.map((r) => r.name))
    expect(out.every((r) => r.verified === false)).toBe(true)
    expect(seen).toEqual(runs.map((r) => r.name))
  })

  it('handles an empty list without starting a worker', async () => {
    expect(await verifyRuns('http://127.0.0.1:9', 'key', [])).toEqual([])
  })

  it('does not let a failed read stop the run: the refusal is per backup', async () => {
    // Complete and ours, against an unreachable bucket: the read fails, the backup is not verified, and the run continues.
    const runs = [
      run('run-44444444-4444-4444-8444-444444444444', true),
      run('run-55555555-5555-4555-8555-555555555555', false),
    ]
    const out = await verifyRuns('http://127.0.0.1:9', 'key', runs, () => undefined, 4)
    expect(out.map((r) => r.verified)).toEqual([false, false])
  })
})
