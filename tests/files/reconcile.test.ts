/**
 * Metadata against objects (#469, B2). Each kind of disagreement is asserted by name, and a clean match is asserted clean,
 * so a reconciliation that reports everything, or nothing, fails.
 */
import { describe, expect, it } from 'vitest'
import { reconcile } from '../../src/files/reconcile.ts'

const row = (path: string, sha256 = 'aa', bytes = 3) => ({ path, sha256, bytes })

describe('reconcile', () => {
  it('reports a store that matches its records exactly as clean', () => {
    const rows = [row('p1/a.txt'), row('p1/b.txt', 'bb', 5)]
    expect(reconcile(rows, [row('p1/a.txt'), row('p1/b.txt', 'bb', 5)])).toEqual({
      missing: [],
      orphaned: [],
      mismatched: [],
      clean: true,
    })
  })

  it('names a record whose object is missing', () => {
    expect(reconcile([row('p1/a.txt')], []).missing).toEqual(['p1/a.txt'])
  })

  it('names an object that no record accounts for', () => {
    expect(reconcile([], [row('p1/stray.txt')]).orphaned).toEqual(['p1/stray.txt'])
  })

  it('names a checksum that differs, and a size that differs, separately', () => {
    const result = reconcile(
      [row('p1/a.txt', 'aa', 3), row('p1/b.txt', 'bb', 5)],
      [row('p1/a.txt', 'zz', 3), row('p1/b.txt', 'bb', 9)],
    )
    expect(result.mismatched).toEqual([
      { path: 'p1/a.txt', reason: 'sha256' },
      { path: 'p1/b.txt', reason: 'bytes' },
    ])
    expect(result.clean).toBe(false)
  })
})
