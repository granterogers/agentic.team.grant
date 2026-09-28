import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deliveryKey } from '../../src/jobs/delivery-key.js'

const job = { jobId: 'J1' } as never
const out = (scope?: string) =>
  ({ body: 'x', ...(scope === undefined ? {} : { deliveryScope: scope }) }) as never

describe('a question and a result are different deliveries (R46)', () => {
  it('a result is the job', () => {
    expect(deliveryKey(job, out(), 'reply')).toBe('job:J1:reply')
  })
  it('a question is its blocker', () => {
    expect(deliveryKey(job, out('blocker:B7'), 'pager')).toBe('blocker:B7:pager')
  })
  it.each([
    ['src/channels/reply.ts', "deliveryKey(job, output, 'reply')"],
    ['src/telegram/pager.ts', "deliveryKey(input.job, input.output, 'pager')"],
    ['src/slack/notifier.ts', "deliveryKey(job, output, 'result')"],
  ])('%s builds its key from the shared helper', (file, call) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain(`dedupeKey: ${call},`)
    expect(src).not.toMatch(/dedupeKey: `job:\$\{/)
  })
  it('the paused branch asks, and the tick sweeps what was never asked', () => {
    const src = readFileSync('src/jobs/worker.ts', 'utf8')
    expect(src).toMatch(/const asked = await askedOnPause\(db, job, output, outputId, notify\)/)
    expect(src).toMatch(/await askUnasked\(db, options\.notify\)\.catch\(/)
    expect(src).toMatch(
      /not exists \(select 1 from public\.deliveries d\s+where d\.dedupe_key like 'blocker:' \|\| b\.blocker_id::text \|\| ':%'\)/,
    )
  })
})
