import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  Run 5, #398. `app.enqueue_child` and `app.enqueue_child_once` refuse a caller that no longer holds its job (0625),
  but only when the caller says who it is. So the property is over the CALL SITES: every place the office starts a
  child from a running job passes `callerArgs(job)`, and the ones that cannot are named here with the reason.

  The scan reads the wired expression (the call's own closing parenthesis holds `callerArgs(`), not the import
  name: a name appearing in a file is not evidence that anything calls it. The paren match is bounded on both ends
  so a following statement's arguments cannot satisfy it.
*/
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
const root = new URL('../../src', import.meta.url).pathname

interface Site {
  readonly file: string
  readonly line: number
  readonly call: string
}
const sites = (): Site[] => {
  const out: Site[] = []
  for (const file of walk(root)) {
    const s = readFileSync(file, 'utf8')
    const pat =
      /app\.(?:enqueue_child(?:_once)?|fan_in_over)\(|'app\.enqueue_child_once' : 'app\.enqueue_child'\}\(/g
    for (let m = pat.exec(s); m !== null; m = pat.exec(s)) {
      const ls = s.lastIndexOf('\n', m.index) + 1
      const before = s.slice(ls, m.index)
      if (/^\s*(\*|\/\/|--|\/\*)/.test(before)) continue
      if (!/select\s|\$\{/.test(s.slice(Math.max(ls, m.index - 60), m.index) + m[0])) continue
      let j = m.index + m[0].length
      let depth = 1
      let inq = false
      while (depth > 0 && j < s.length) {
        const c = s[j] as string
        if (inq) {
          if (c === "'") inq = false
        } else if (c === "'") inq = true
        else if (c === '(') depth += 1
        else if (c === ')') depth -= 1
        j += 1
      }
      out.push({
        file: file.slice(root.length + 1),
        line: s.slice(0, m.index).split('\n').length,
        call: s.slice(m.index, j),
      })
    }
  }
  return out
}

/** A caller that has no claim to state. Each is a reason, not a convenience. */
/** A caller that has no claim to state. Each is a reason, not a convenience. (Empty: agents/perform.ts now carries the claim in `Doing.held`.) */
const UNFENCED: Record<string, string> = {}

describe("a child is made under its author's claim", () => {
  const all = sites()
  it('found the call sites it means to read', () => {
    expect(all.length).toBeGreaterThanOrEqual(20)
  })
  it('every handler call passes callerArgs(job), or is named above with its reason', () => {
    const bare = all.filter(
      (s) => !s.call.includes('callerArgs(') && UNFENCED[s.file] === undefined,
    )
    expect(bare.map((s) => `${s.file}:${String(s.line)}`)).toEqual([])
  })
  it('the baseline names only files that still hold an unfenced call', () => {
    for (const file of Object.keys(UNFENCED)) {
      expect(all.some((s) => s.file === file && !s.call.includes('callerArgs('))).toBe(true)
    }
    expect(Object.keys(UNFENCED)).toEqual([])
  })
  it('the fence module states the caller as the database asks for it', () => {
    const fence = readFileSync(join(root, 'jobs/fence.ts'), 'utf8')
    expect(fence).toMatch(/p_caller_worker => \$\{lit\(job\.leasedBy\)\}/)
    expect(fence).toMatch(/p_caller_gen => \$\{String\(job\.claimGen\)\}/)
  })
})

/*
  Final audit reconciliation (0628): the pause path is fenced the same way. A handler that runs steps, claims an
  external effect or parks its own job passes the job it holds, so a worker that lost the claim cannot park it.
*/
describe("a pause is made under its author's claim", () => {
  const callsOf = (name: string): Site[] => {
    const out: Site[] = []
    for (const file of walk(join(root, 'handlers'))) {
      // comments carry apostrophes that would unbalance the quote tracking below
      const s = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/^([ \t]*)\/\/.*$/gm, (m) => m.replace(/[^\n]/g, ' '))
      const pat = new RegExp(`(?<![\\w.])${name}\\(`, 'g')
      for (let m = pat.exec(s); m !== null; m = pat.exec(s)) {
        const ls = s.lastIndexOf('\n', m.index) + 1
        if (/^\s*(\*|\/\/)/.test(s.slice(ls, m.index))) continue
        let j = m.index + m[0].length
        let depth = 1
        let q: string | null = null
        while (depth > 0 && j < s.length) {
          const c = s[j] as string
          if (q !== null) {
            if (c === '\\') j += 1
            else if (c === q) q = null
          } else if (c === "'" || c === '"' || c === '`') q = c
          else if (c === '(' || c === '[' || c === '{') depth += 1
          else if (c === ')' || c === ']' || c === '}') depth -= 1
          j += 1
        }
        out.push({
          file: file.slice(root.length + 1),
          line: s.slice(0, m.index).split('\n').length,
          call: s.slice(m.index, j),
        })
      }
    }
    return out
  }
  for (const name of ['runSteps', 'claimExternal', 'pauseJob']) {
    it(`every handler ${name}( passes the claim it holds as its last argument`, () => {
      const calls = callsOf(name)
      expect(calls.length).toBeGreaterThan(0)
      const bare = calls.filter((c) => !/,\s*job,?\s*\)$/.test(c.call.replace(/\s+/g, ' ')))
      expect(bare.map((c) => `${c.file}:${String(c.line)}`)).toEqual([])
    })
  }
})
