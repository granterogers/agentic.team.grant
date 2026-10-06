import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  A local-replica proof must never import a COMMAND that opens with the production-access gate. The gate fires when the
  command's module is evaluated, whoever imported it, so a replica proof that borrowed a helper from `check:*` was refused
  as though it were the command (found integrating the UX branch with p4: anon-surface imported check-anon-exposure).
  Shared helpers live in src/, where they can be imported by both.
*/
const GATE = /^\s*import\s+['"](\.[^'"]*\/safety\/require-production-[a-z-]+\.ts)['"]/m
const IMPORT = /(?:from|import)\s*['"](\.[^'"]+)['"]/g

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  )

const opensWithGate = (file: string): boolean => {
  const src = readFileSync(file, 'utf8')
  const first = src.search(/^\s*import\s/m)
  const gate = src.search(GATE)
  return gate !== -1 && gate === first
}

describe('replica proofs do not import gated commands', () => {
  const proofs = walk('scripts/isolated')
  it('there are proofs to check (the check is not vacuous)', () => {
    expect(proofs.length).toBeGreaterThan(50)
  })

  it('none of them imports a script that opens with a production gate', () => {
    const offenders: string[] = []
    for (const f of proofs) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(IMPORT)) {
        const target = normalize(join(dirname(f), m[1] as string))
        if (!target.startsWith('scripts/') || target.startsWith('scripts/isolated/')) continue
        try {
          if (opensWithGate(target)) offenders.push(`${f} -> ${target}`)
        } catch {
          // not a file (a directory import, a json): nothing to gate
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('CONTROL: the detector sees a gated command when one is named', () => {
    expect(opensWithGate('scripts/check-anon-exposure.ts')).toBe(true)
    expect(opensWithGate('src/safety/anon-exposure.ts')).toBe(false)
  })
})
