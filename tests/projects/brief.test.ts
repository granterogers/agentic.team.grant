/**
 * Brief staleness, which is what keeps the ten-minute cycle from spending
 * inference to rewrite the same paragraph 144 times a day.
 *
 * The comparison is over the *set of source fingerprints*, not a timestamp, so
 * a brief is regenerated when the knowledge changed rather than when the clock
 * moved. These tests drive a fake executor: the logic is a set comparison and
 * needs no database to be wrong.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { briefIsStale } from '../../src/projects/brief.ts'

/** Returns whatever `source_fingerprints` Postgres would have rendered. */
const fakeDb = (rendered: string | null): SqlExecutor => ({
  // `kind` is part of the interface so a transport is identifiable in an error
  // message (ADR-0007 runs two of them). Named for what this one is rather
  // than left blank.
  kind: 'fake-in-memory',
  execute: async () => ({
    rows: rendered === null ? [] : [{ fps: rendered }],
  }),
})

describe('briefIsStale', () => {
  it('is stale when no brief exists yet', async () => {
    expect(await briefIsStale(fakeDb(null), 'p', ['a'.repeat(64)])).toBe(true)
  })

  it('is not stale when the same fingerprints come back', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(await briefIsStale(fakeDb(`{${a},${b}}`), 'p', [a, b])).toBe(false)
  })

  it('ignores ordering, because array order is not guaranteed', async () => {
    // Postgres does not promise to hand a text[] back in insertion order, so
    // comparing rendered strings would report a spurious change and spend
    // inference on it.
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(await briefIsStale(fakeDb(`{${b},${a}}`), 'p', [a, b])).toBe(false)
  })

  it('is stale when a source changed', async () => {
    const a = 'a'.repeat(64)
    const changed = 'c'.repeat(64)
    expect(await briefIsStale(fakeDb(`{${a}}`), 'p', [changed])).toBe(true)
  })

  it('is stale when a source was added', async () => {
    const a = 'a'.repeat(64)
    expect(await briefIsStale(fakeDb(`{${a}}`), 'p', [a, 'd'.repeat(64)])).toBe(true)
  })

  it('is stale when a source went away', async () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(await briefIsStale(fakeDb(`{${a},${b}}`), 'p', [a])).toBe(true)
  })

  it('handles the quoted rendering Postgres sometimes uses', async () => {
    const a = 'a'.repeat(64)
    expect(await briefIsStale(fakeDb(`{"${a}"}`), 'p', [a])).toBe(false)
  })

  it('reports no change when a brief cited nothing and there is still nothing', async () => {
    // Written the other way round first, asserting `true` on the reasoning
    // that a brief citing nothing cannot be current for anything. That was an
    // opinion rather than a conclusion, and the code disagreed: for a set
    // comparison, two empty sets are equal and nothing changed.
    //
    // The code is right, and the case is unreachable anyway — `generateBrief`
    // raises NoSourcesError before consulting staleness, so a project with no
    // sources never gets this far. Corrected rather than "fixing" working code
    // to satisfy a test I could not justify.
    expect(await briefIsStale(fakeDb('{}'), 'p', [])).toBe(false)
  })
})
