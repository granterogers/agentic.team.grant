/**
 * A seeded, reproducible source of randomness.
 *
 * §7 requires that every generated scenario persists its seed, and §25's
 * failure policy requires a flaky result to be characterised rather than
 * chased. Neither is possible with `Math.random()`: a failure you cannot
 * regenerate is an anecdote, and CLAUDE.md records what that costs — a
 * routing flake was invisible for three days and found only because the same
 * suite happened to run twice against identical code and somebody happened to
 * compare.
 *
 * mulberry32. Thirty-two bits of state, uniform enough for choosing words,
 * and — the property that actually matters here — identical on every machine
 * and every Node version, which `Math.random()` explicitly does not promise.
 */
export class Seeded {
  private state: number

  constructor(readonly seed: number) {
    // Forced into uint32 so a caller passing a float or a negative gets a
    // defined stream rather than NaN propagating silently through every
    // draw — which reads as "the mutator did nothing" rather than as an error.
    this.state = seed >>> 0
  }

  /** A float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** An integer in [0, n). Returns 0 for n <= 0 rather than NaN. */
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n)
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p
  }

  /**
   * One of these.
   *
   * Returns `undefined` for an empty list rather than throwing, because a
   * persona legitimately has empty vocabulary lists and a mutator asking for
   * a filler word from a persona that uses none should simply not add one.
   */
  pick<T>(xs: readonly T[]): T | undefined {
    return xs.length === 0 ? undefined : xs[this.int(xs.length)]
  }

  /** A shuffled copy. The original is never touched. */
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      const a = out[i]
      const b = out[j]
      if (a !== undefined && b !== undefined) {
        out[i] = b
        out[j] = a
      }
    }
    return out
  }
}

/**
 * A derived seed, so one run seed produces a different stream per scenario
 * and per turn without any of them being correlated.
 *
 * Without this, scenario 1 turn 1 and scenario 2 turn 1 would draw the same
 * numbers from the same run seed and every scenario would be roughened
 * identically — which looks like variety in a listing and is a single
 * mutation repeated.
 */
export const derive = (seed: number, ...parts: readonly (string | number)[]): number => {
  let h = seed >>> 0
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(h ^ s.charCodeAt(i), 0x01000193) + 1) >>> 0
    }
  }
  return h >>> 0
}
