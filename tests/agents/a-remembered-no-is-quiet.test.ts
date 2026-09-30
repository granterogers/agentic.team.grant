import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { governOutward } from '../../src/agents/approval.ts'

/*
  A No the office was already given (0611) must not fail the duty that asked:
  outputs.body may not be empty, so the refusal keeps a sentence, and `quiet`
  tells the caller not to announce it. The review of the first draft found the
  caller announcing an empty body; this pins the pair.
*/
const stub = (decision: Record<string, unknown>) =>
  ({ execute: async () => ({ rows: [{ d: decision }] }) }) as never
const base = {
  jobId: '00000000-0000-0000-0000-000000000001',
  tool: 'notion.write',
  summary: 's',
  detail: 'd',
  empty: false,
  agent: 'operations-director',
}
const never = (async () => {
  throw new Error('a remembered No must not raise a question')
}) as never

describe('a remembered No is quiet', () => {
  it('keeps a non-empty sentence, does not announce, and raises nothing', async () => {
    const g = await governOutward(
      stub({
        verdict: 'refuse',
        declined: true,
        remembered: true,
        because: 'You said no to this on 30 Sep.',
      }),
      base,
      never,
    )
    expect(g.go).toBe(false)
    expect(g.quiet).toBe(true)
    expect(g.blocker).toBeNull()
    expect(g.said.trim().length).toBeGreaterThan(0)
  })
  it('control: an ordinary ask is not quiet and does raise the question', async () => {
    let raised = 0
    const g = await governOutward(
      stub({ verdict: 'ask', because: 'It proposes; you decide.' }),
      base,
      (async () => {
        raised += 1
        return 'blocker-id'
      }) as never,
    )
    expect(g.quiet).toBe(false)
    expect(raised).toBe(1)
  })
  it('the calendar duty announces only what is not quiet', () => {
    const src = readFileSync('src/handlers/calendar-tasks.ts', 'utf8')
    expect(src).toMatch(/announce: gate\.blocker === null && !gate\.quiet/)
  })
})
