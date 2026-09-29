/*
  A question answered elsewhere is reported as answered elsewhere.

  Integration pass, 28 September 2026. `app.hq_answer_blocker` returns
  `{ ok: false, already: true, resolution }` for a question that is no longer
  open (0596 makes a racing second answer wait for, and then read, the first).
  Since R46/R33 the same question is open in his chat AND on the dashboard,
  so this reply is ordinary — and both dashboard surfaces said "Answered." to
  it. The browser half is `npm run verify:basecamp-stale-answer`; this is the
  wording and the wiring, asserted on the CALL rather than the name.
*/
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../web/studio/backend.js', () => ({ HQ_API: '', UNCONFIGURED: false }))
vi.mock('../../web/studio/session.js', () => ({}))
const WHERE = '../../web/studio/office.js'
const { alreadyAnswered } = (await import(WHERE)) as {
  alreadyAnswered: (r: unknown) => string | null
}

describe('alreadyAnswered', () => {
  it('names the answer the office holds', () => {
    const said = alreadyAnswered({ ok: false, already: true, state: 'resolved', resolution: 'No' })
    expect(said).toMatch(/already answered/i)
    expect(said).toContain('No')
    expect(said).not.toMatch(/^Answered\./)
  })
  it('still says so when the office gives no resolution', () => {
    expect(alreadyAnswered({ ok: false, already: true })).toMatch(/already answered/i)
  })
  it('does not call a withdrawn or expired question answered', () => {
    for (const state of ['withdrawn', 'expired']) {
      const said = alreadyAnswered({ ok: false, already: true, state, resolution: null })
      expect(said).not.toMatch(/answered elsewhere/i)
      expect(said).toMatch(state === 'withdrawn' ? /withdrew/ : /expired/)
      expect(said).toMatch(/Nothing was done/)
    }
  })
  it('is silent for a press the office took, so the caller keeps its own sentence', () => {
    expect(alreadyAnswered({ ok: true, answer: 'Yes' })).toBeNull()
    expect(alreadyAnswered(null)).toBeNull()
    expect(alreadyAnswered(undefined)).toBeNull()
    expect(alreadyAnswered({ ok: false, already: 'true' })).toBeNull()
  })
})

describe('both answer paths ask it', () => {
  it('Team HQ words the reply with it and keeps the record open', () => {
    const src = readFileSync('web/studio/bc/wire.js', 'utf8')
    expect(src).toContain("(r) => alreadyAnswered(r) ?? 'Answered. The team has it.'")
    expect(src).toContain('if (alreadyAnswered(done) !== null) return')
  })
  it('the legacy studio does, at both of its answer controls', () => {
    const src = readFileSync('web/studio/app.js', 'utf8')
    expect(src.split("(r) => alreadyAnswered(r) ?? 'Answered.'").length - 1).toBe(2)
    expect(
      src.split('if (said && alreadyAnswered(said) === null) await refresh()').length - 1,
    ).toBe(2)
  })
})
