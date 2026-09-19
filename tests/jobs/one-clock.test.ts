/**
 * There is ONE clock, and it is the database's (#41 §8, "clock skew on lease
 * expiry").
 *
 * The chaos list asks what happens when a worker's clock is wrong. The answer
 * is that nothing happens, and the reason is worth holding still: every lease
 * in this office is both GRANTED and JUDGED by the database.
 *
 *     app.dequeue_job         leased_until = now() + make_interval(...)
 *     app.recover_stalled_jobs   ... or j.leased_until < now()
 *     src/projects/sync.ts    leased_until = app.now_utc() + make_interval(...)
 *
 * So a worker whose clock is an hour fast cannot expire a colleague's lease
 * early and steal a running job, and one an hour slow cannot hold a job past
 * its lease. Skew is not handled — it is structurally absent, which is much
 * better, and it is only true for as long as nobody computes a lease time in
 * JavaScript.
 *
 * ## Why this is a source test
 *
 * Skew cannot be simulated against a shared database: there is no second clock
 * to disagree with. Changing the database's own clock is not a test of the
 * product. What CAN regress is the invariant — somebody passing a JS `Date`
 * into a lease column, which would work perfectly on one machine and introduce
 * the exact bug the chaos list is asking about.
 *
 * `provenance-order.test.ts` set the precedent for asserting a structural
 * property out of the source and saying so.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Every TypeScript file that could write SQL. */
const files = execSync("find src supabase -name '*.ts'").toString().trim().split('\n')

/**
 * A database clock, the only thing a lease may be computed from.
 *
 * `now()` is NOT preceded by a dot, and that is the whole care in this line:
 * the first draft used a word boundary, which matches the `now()` inside
 * `Date.now()` — so a lease timed in JavaScript would have been accepted as a
 * database clock by the check written to forbid exactly that. Its own control
 * caught it on the first run.
 */
const DB_CLOCK = /(?<![.\w])(?:app\.now_utc\(\)|now\(\)|current_timestamp|clock_timestamp\(\))/i

describe('#41 §8 — a lease is timed by the database, never by a worker', () => {
  it('no lease timestamp is computed client-side', () => {
    const offenders: string[] = []
    for (const file of files) {
      const body = readFileSync(file, 'utf8')
      if (!body.includes('leased_until')) continue
      for (const line of body.split('\n')) {
        if (!line.includes('leased_until')) continue
        // Setting it to null releases a lease and needs no clock at all.
        if (/leased_until\s*=\s*null/i.test(line)) continue
        // A bare mention in a select list or a comment sets nothing.
        if (!/leased_until\s*[=<>]/.test(line) && !/\(leased_by,\s*leased_until\)/.test(line))
          continue
        /*
          The clock may be on this line or on the next one, because the value
          of an INSERT's column list is in its VALUES clause. So the window is
          the statement around it rather than the line, which is the same
          correction the #66 hand-off test needed: the thing being asserted sat
          one line away from the anchor.
        */
        const at = body.indexOf(line)
        if (!DB_CLOCK.test(body.slice(at, at + 400))) {
          offenders.push(`${file}: ${line.trim().slice(0, 80)}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('CONTROL: the scan actually reaches the lease code', () => {
    /*
      A found-nothing check that has never been shown a positive is
      indistinguishable from one that cannot see anything at all — this file's
      whole risk, since its happy path is an empty array. CLAUDE.md records a
      check that reported "0 registry rows" correctly while a missing import
      sent every lookup into the catch.
    */
    const seen = files.filter((f) => readFileSync(f, 'utf8').includes('leased_until'))
    expect(seen.length).toBeGreaterThan(0)
  })

  it('CONTROL: it would notice a lease timed in JavaScript', () => {
    // The realistic regression, checked against the predicate rather than by
    // writing the defect into a real file.
    const bad = "leased_until = '" + '${new Date(Date.now() + 300000).toISOString()}' + "'"
    expect(DB_CLOCK.test(bad)).toBe(false)
    const good = 'leased_until = app.now_utc() + make_interval(mins => 5)'
    expect(DB_CLOCK.test(good)).toBe(true)
  })
})
