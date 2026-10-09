import { describe, expect, it } from 'vitest'
import {
  canonicalStatements,
  compareLowered,
  compareStoredWithSource,
} from '../../scripts/release/lib/canonical.ts'

/**
 * The live-bundle reconciliation compares what the platform stored with what the repository would upload. These hold it to the two
 * properties that make a comparison worth anything: it must NOT call formatting a difference, and it MUST call behaviour one.
 */
const same = (stored: string, source: string): boolean =>
  compareStoredWithSource(stored, source).identical

describe('what is not a difference', () => {
  it('trailing commas, redundant parentheses, whitespace and comments', () => {
    expect(
      same(
        "const a = [ 'x', 'y' ]; const b = (c ?? 0) << 8 | d; export const f = (x) => x + 1;",
        "// note\nconst a = ['x', 'y',]\n/** doc */\nconst b = ((c ?? 0) << 8) | d\nexport const f = (x: number): number => (x + 1)",
      ),
    ).toBe(true)
  })
  it('type annotations, interfaces and type-only imports (erased by the platform)', () => {
    expect(
      same(
        'export const n = 1;',
        "import type { T } from './t.ts'\ninterface I { a: string }\nexport const n: number = 1 as number",
      ),
    ).toBe(true)
  })
})

describe('class-field lowering, the one named toolchain difference', () => {
  const stored =
    "class T { slack; channel; constructor(slack) { this.slack = slack; this.channel = 'slack'; } send() { return 1; } }"
  const source =
    "class T { channel = 'slack'; constructor(private slack: unknown) {} send() { return 1 } }"
  it('is a difference to the strict comparison and equal to the lowered one', () => {
    expect(compareStoredWithSource(stored, source).identical).toBe(false)
    expect(compareLowered(stored, source).identical).toBe(true)
  })
  it('does not hide a real change inside the class (control)', () => {
    expect(compareLowered(stored.replace("'slack';", "'other';"), source).identical).toBe(false)
    expect(compareLowered(stored.replace('return 1', 'return 2'), source).identical).toBe(false)
    expect(compareLowered(stored.replace('send()', 'sendAll()'), source).identical).toBe(false)
  })
})

describe('what is a difference (each must turn the comparison red)', () => {
  const base = "const url = 'https://a.example'; const n = 5; function f(x) { return x + n; }"
  const src = "const url = 'https://a.example'\nconst n = 5\nfunction f(x: number) { return x + n }"
  it('the control: the unchanged pair is identical', () => {
    expect(same(base, src)).toBe(true)
  })
  it('a changed literal', () => {
    expect(same(base.replace('a.example', 'b.example'), src)).toBe(false)
    expect(same(base.replace('= 5', '= 6'), src)).toBe(false)
  })
  it('a changed operator', () => {
    expect(same(base.replace('x + n', 'x - n'), src)).toBe(false)
  })
  it('a renamed identifier', () => {
    // conservative on purpose: even a consistent rename is reported, because the comparison cannot know it is only a rename
    expect(same(base.replace('return x', 'return y').replace('(x)', '(y)'), src)).toBe(false)
    expect(same(base.replace('return x + n', 'return x + m'), src)).toBe(false)
  })
  it('a missing, extra or reordered statement', () => {
    expect(same(`${base} const z = 1;`, src)).toBe(false)
    expect(same(base.replace('const n = 5; ', ''), src)).toBe(false)
    expect(
      same("const n = 5; const url = 'https://a.example'; function f(x) { return x + n; }", src),
    ).toBe(false)
  })
  it('a regular expression is not mistaken for a string (the defect of the first, scanner-based comparison)', () => {
    const stored = 'const r = /\'/g; const s = "it\'s";'
    expect(canonicalStatements(stored)).toHaveLength(2)
    expect(same(stored, 'const r = /\'/g\nconst s = "it\'s"')).toBe(true)
    expect(same(stored, 'const r = /"/g\nconst s = "it\'s"')).toBe(false)
  })
})
