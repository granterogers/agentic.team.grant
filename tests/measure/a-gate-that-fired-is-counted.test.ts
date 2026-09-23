/**
 * The instrument said the anti-hallucination gate had never fired (#345).
 *
 * `npm run measure` is what CLAUDE.md calls *"the one that would have caught
 * what nobody noticed for months"*. Its last line read:
 *
 *   evidence blocks    0 (the anti-hallucination gate firing)
 *
 * It counted `job_impediments.kind = 'missing_data'`. **No gate in
 * `src/jobs/worker.ts` has ever written that kind** — all four write
 * `not_capable` and distinguish themselves by `noticed_by`. `missing_data`
 * holds 112 rows, none of them real, so the number was zero by construction
 * and read as an office that never hallucinates.
 *
 * On real traffic: the quality gate refused 8 answers and the output
 * constraints refused 46 — 54 turns where Grant asked and a gate stopped the
 * answer, reported to him as none.
 *
 * These assert the SHAPE of the query rather than a count, because a count
 * against live data is a test that changes every day.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const measure = readFileSync('scripts/measure.ts', 'utf8')
const worker = readFileSync('src/jobs/worker.ts', 'utf8')

describe('counting the gates that stopped an answer', () => {
  it('groups by the gate that noticed, rather than one hardcoded category', () => {
    const from = measure.indexOf('const gates = await all(')
    expect(from).toBeGreaterThan(-1)
    const query = measure.slice(from, measure.indexOf('`)', from))
    expect(query).toMatch(/noticed_by/)
    expect(query).toMatch(/group by/i)
  })

  it('never filters impediments to a single kind again', () => {
    /*
      The defect itself, asserted as a negative. A hardcoded category is what
      made this line unable to report anything: it cannot go stale when a gate
      is added or renamed, because it no longer names one.
    */
    const from = measure.indexOf('const gates = await all(')
    const query = measure.slice(from, measure.indexOf('`)', from))
    expect(query).not.toMatch(/i\.kind\s*=\s*'/)
  })

  it('excludes harness traffic, like every other figure in the measure', () => {
    const from = measure.indexOf('const gates = await all(')
    const query = measure.slice(from, measure.indexOf('`)', from))
    expect(query).toMatch(/\$\{REAL\}/)
    expect(query).toMatch(/is_fixture/)
  })

  it('says so in words when it finds nothing, rather than printing a zero', () => {
    /*
      `npm run space` learned this the expensive way: a measure whose selector
      matches nothing prints a number that reads as an immaculate page. A bare
      0 here would mean "the office never hallucinates", which is the single
      most reassuring thing it could wrongly say.
    */
    expect(measure).toMatch(/NO IMPEDIMENTS FOUND/)
  })

  /*
    AND THE MARKERS IT GROUPS BY ARE THE ONES THE GATES ACTUALLY WRITE.

    The half that was wrong before: the measure named a vocabulary nothing
    produced. `noticed_by` is the fourth argument of `app.cannot`, and every
    call site in the worker supplies one — so a gate that recorded nothing
    identifiable would show up as `unattributed` rather than vanish.
  */
  it('every gate in the worker identifies itself when it records a refusal', () => {
    const calls = worker.match(/app\.cannot\(\$\{lit\(job\.jobId\)\}::uuid,\s*'[a-z_]+',/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(4)
    // Each `app.cannot` is followed by `needed` then `noticed_by`, both literals.
    for (const m of worker.matchAll(/app\.cannot\([^)]*?::uuid,\s*'[a-z_]+',([\s\S]{0,160}?)\)/g)) {
      const args = m[1] ?? ''
      expect(args.replace(/\s+/g, ' ')).toMatch(/,\s*(?:'[^']+'|\$\{lit\()/)
    }
  })
})
