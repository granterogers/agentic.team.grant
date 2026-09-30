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
const UNFENCED: Record<string, string> = {
  'agents/perform.ts':
    'a plan step runs with (db, jobId) and no claim: the step is bracketed by claimExternal/beginStep (Run 3), so a stale worker re-running it finds the step already begun; threading the claim through every step signature is the residual #398 leaves open, named here.',
}

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
  })
  it('the fence module states the caller as the database asks for it', () => {
    const fence = readFileSync(join(root, 'jobs/fence.ts'), 'utf8')
    expect(fence).toMatch(/p_caller_worker => \$\{lit\(job\.leasedBy\)\}/)
    expect(fence).toMatch(/p_caller_gen => \$\{String\(job\.claimGen\)\}/)
  })
})
