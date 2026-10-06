import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isTransactionControl, splitExecutable } from '../../src/migrations/split.ts'

describe('splitExecutable', () => {
  it('keeps text exactly and splits on top-level semicolons only', () => {
    expect(splitExecutable('select 1; select 2;')).toEqual(['select 1', 'select 2'])
    expect(splitExecutable('select \'a;b\'; select "c;d"')).toEqual([
      "select 'a;b'",
      'select "c;d"',
    ])
  })
  it('does not split inside dollar-quoted bodies, tagged or not', () => {
    const f = 'create function f() returns int language plpgsql as $$ begin return 1; end $$;'
    const g =
      'create function g() returns int language plpgsql as $body$ begin perform 1; return 2; end $body$;'
    expect(splitExecutable(`${f} ${g}`)).toEqual([f.slice(0, -1), g.slice(0, -1)])
  })
  it('ignores semicolons in comments, including nested block comments', () => {
    expect(splitExecutable('-- a; b\nselect 1; /* c; /* d; */ e; */ select 2')).toEqual([
      '-- a; b\nselect 1',
      '/* c; /* d; */ e; */ select 2',
    ])
  })
  it('honours backslash escapes only in E strings', () => {
    expect(splitExecutable("select E'it\\'s; ok'; select 'a\\'; select 2")).toEqual([
      "select E'it\\'s; ok'",
      "select 'a\\'",
      'select 2',
    ])
  })
  it('does not treat a comment-only tail as a statement', () => {
    expect(splitExecutable('select 1;\n-- done\n')).toEqual(['select 1'])
  })
  it('classifies transaction control even under comment lines, and not BEGIN ATOMIC', () => {
    expect(isTransactionControl('-- start\nbegin')).toBe(true)
    expect(isTransactionControl('/* x */ COMMIT')).toBe(true)
    expect(isTransactionControl('select 1')).toBe(false)
    expect(isTransactionControl('begin atomic select 1; end')).toBe(false)
  })
  it('is linear: a long statement with no semicolon splits instantly (the first draft backtracked for minutes)', () => {
    const long = `insert into t values (${Array.from({ length: 20000 }, (_, i) => `'${String(i)}'`).join(',')})`
    const started = Date.now()
    expect(splitExecutable(long)).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(1000)
  })
  it('splits every real migration, quickly, into statements that re-split to themselves', () => {
    const started = Date.now()
    let total = 0
    for (const name of readdirSync('migrations').filter((n) => n.endsWith('.sql'))) {
      const parts = splitExecutable(readFileSync(`migrations/${name}`, 'utf8'))
      total += parts.length
      expect(parts.length, name).toBeGreaterThan(0)
      expect(splitExecutable(parts.map((p) => `${p};`).join('\n')), name).toEqual(parts)
    }
    expect(total).toBeGreaterThan(5000)
    expect(Date.now() - started).toBeLessThan(20000)
  })
})
