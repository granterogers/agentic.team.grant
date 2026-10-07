/**
 * How the gate reads a proof's result (scripts/gate/verdict.ts). Every way a proof can say "green" while being something
 * else is driven here, because the gate exists to catch exactly those: a crash that wrote nothing, an exit 0 with no
 * assertion, a failed line beside a zero exit, a summary that disagrees with the lines above it, and a proof that quietly
 * lost half its checks.
 */
import { describe, expect, it } from 'vitest'
import { judge } from '../../scripts/gate/verdict.ts'

const okLines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `ok   check ${String(i)} - fine`).join('\n')

describe('a proof is green only when every condition holds', () => {
  it('passes: exit 0, assertions at or above the floor, no failure, no short summary', () => {
    const v = judge({ min: 5 }, 0, `${okLines(6)}\n\n6/6 passed\n`)
    expect(v).toMatchObject({ ok: true, label: 'PASS', pass: 6, fail: 0 })
  })

  it('counts PROVEN lines too (the e2e drivers say PROVEN and FAILED)', () => {
    const log = 'PROVEN   a - x\nPROVEN   b - y\nFAILED   c - z\n\n2/3 PROVEN (1 FAILED)\n'
    expect(judge({ min: 1 }, 1, log)).toMatchObject({ ok: false, label: 'RED', pass: 2, fail: 1 })
  })

  it('CRASHED: it exited non-zero before a single assertion ran (the stack trace is not an assertion)', () => {
    const v = judge(
      { min: 5 },
      1,
      'SqlExecutionError: 23502: null value in column "office_id"\n    at one (x.ts:1)',
    )
    expect(v).toMatchObject({ ok: false, label: 'CRASHED', pass: 0 })
    expect(v.reason).toMatch(/before any assertion/)
  })

  it('RED, not CRASHED, when it asserted some things and then died', () => {
    expect(judge({ min: 5 }, 1, okLines(3))).toMatchObject({ ok: false, label: 'RED', pass: 3 })
  })

  it('NO-ASSERTIONS: it exited 0 and asserted nothing (a proof that can never fail)', () => {
    const v = judge({ min: 1 }, 0, 'done\nall good\n')
    expect(v).toMatchObject({ ok: false, label: 'NO-ASSERTIONS' })
  })

  it('RED: a failed assertion beside a zero exit code (a process.exitCode that was never set)', () => {
    const v = judge({ min: 1 }, 0, `${okLines(4)}\nFAIL the thing - broke\n`)
    expect(v).toMatchObject({ ok: false, label: 'RED', fail: 1 })
    expect(v.reason).toMatch(/although it exited 0/)
  })

  it('RED: its own summary says 18/20, whatever lines it chose to print', () => {
    const v = judge({ min: 1 }, 0, `${okLines(18)}\n\n18/20 passed\n`)
    expect(v).toMatchObject({ ok: false, label: 'RED' })
    expect(v.reason).toMatch(/18\/20/)
  })

  it('a summary that agrees is fine, and an "ok 1/2" inside a detail is not a summary', () => {
    expect(
      judge({ min: 1 }, 0, `ok   x - 1/2 passed in one retry\n${okLines(2)}\n3/3 passed\n`).ok,
    ).toBe(true)
  })

  it('BELOW-FLOOR: it ran, it passed, and it dropped a third of its checks', () => {
    const v = judge({ min: 20 }, 0, okLines(13))
    expect(v).toMatchObject({ ok: false, label: 'BELOW-FLOOR', pass: 13 })
    expect(v.reason).toMatch(/floor is 20/)
  })

  it('TIMEOUT is red whatever it had printed', () => {
    expect(judge({ min: 1 }, null, okLines(30), true)).toMatchObject({
      ok: false,
      label: 'TIMEOUT',
    })
  })

  it('an informational driver must still exit 0 but owes no assertion', () => {
    expect(judge({ min: 0, informational: true }, 0, 'a table of findings\n').ok).toBe(true)
    expect(judge({ min: 0, informational: true }, 1, 'it died\n').ok).toBe(false)
  })

  it('a proof whose success exit code is not zero (a psql proof ending in a deliberate exception)', () => {
    const p = { min: 1, okRc: 3, okRe: 'PROOF_OK' }
    expect(judge(p, 3, 'ERROR:  PROOF_OK\n').ok).toBe(true)
    expect(judge(p, 0, 'ERROR:  PROOF_OK\n')).toMatchObject({ ok: false, label: 'RED' })
    expect(judge(p, 1, 'ERROR:  something else\n')).toMatchObject({ ok: false })
  })

  it('custom line formats: a matrix whose WRONG rows are a control counts only what it says is a failure', () => {
    const log =
      'x | retrying | queued | 1 | ok\ny | failed | failed | 1 | WRONG\nCONTROL FAILED: pre\n'
    const p = { min: 1, okRe: '\\|\\s*ok\\s*$', failRe: 'CONTROL FAILED' }
    expect(judge(p, 0, log)).toMatchObject({ ok: false, pass: 1, fail: 1 })
    expect(
      judge(p, 0, 'x | retrying | queued | 1 | ok\ny | failed | failed | 1 | WRONG\n').ok,
    ).toBe(true)
  })
})
