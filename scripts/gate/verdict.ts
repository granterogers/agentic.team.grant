/**
 * How the gate reads a proof's result. Pure, so tests/gate/verdict.test.ts can drive every way a proof can lie.
 *
 * A proof is green only when ALL of these hold: it exited with its success code; it printed no failed assertion; it printed
 * at least its registered floor of passed assertions; and any "p/q" summary it printed says p = q. Everything else is
 * red, and the label says which kind of red, because "it crashed before asserting anything" and "it asserted and a check
 * failed" have different causes and different fixes (CLAUDE.md: the exit code, not the last line).
 */
import type { Proof, Verdict } from './types.ts'

const DEFAULT_OK = '^\\s*(ok|PROVEN)\\s'
const DEFAULT_FAIL = '^\\s*(FAIL|FAILED)\\b'
/** "27/27 passed", "9/9 checks passed", "81/87 PROVEN", "8/8 ok": a summary that can disagree with the lines above it. */
const SUMMARY = /^\s*(\d+)\s*\/\s*(\d+)\s+(?:checks\s+)?(?:passed|PROVEN|ok)\b/gim

const count = (text: string, re: RegExp): number => text.split('\n').filter((l) => re.test(l)).length

export function judge(
  p: Pick<Proof, 'min' | 'okRe' | 'failRe' | 'okRc' | 'informational'>,
  rc: number | null,
  log: string,
  timedOut = false,
): Verdict {
  const pass = count(log, new RegExp(p.okRe ?? DEFAULT_OK, 'i'))
  const fail = count(log, new RegExp(p.failRe ?? DEFAULT_FAIL))
  const wantRc = p.okRc ?? 0
  const base = { pass, fail }
  if (timedOut) return { ...base, ok: false, label: 'TIMEOUT', reason: 'stopped by the runner' }
  if (rc !== wantRc) {
    if (pass + fail === 0 && p.informational !== true)
      return {
        ...base,
        ok: false,
        label: 'CRASHED',
        reason: `exit ${String(rc)} before any assertion ran`,
      }
    return {
      ...base,
      ok: false,
      label: 'RED',
      reason: `exit ${String(rc)} (wanted ${String(wantRc)})${fail > 0 ? `, ${String(fail)} failed assertion(s)` : ''}`,
    }
  }
  if (fail > 0)
    return {
      ...base,
      ok: false,
      label: 'RED',
      reason: `${String(fail)} failed assertion(s) although it exited ${String(wantRc)}`,
    }
  // A summary that says 18/20 is red whatever else was printed: the lines are what a proof chose to show, the summary is
  // what it counted.
  for (const m of log.matchAll(SUMMARY)) {
    const [, a, b] = m
    if (Number(a) < Number(b))
      return { ...base, ok: false, label: 'RED', reason: `its own summary says ${a}/${b}` }
  }
  if (p.informational !== true && pass === 0)
    return {
      ...base,
      ok: false,
      label: 'NO-ASSERTIONS',
      reason: 'it exited successfully and asserted nothing',
    }
  if (p.informational !== true && pass < p.min)
    return {
      ...base,
      ok: false,
      label: 'BELOW-FLOOR',
      reason: `${String(pass)} assertion(s) ran, the registered floor is ${String(p.min)}: checks were dropped or skipped`,
    }
  return { ...base, ok: true, label: 'PASS', reason: '' }
}
