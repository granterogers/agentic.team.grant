/**
 * The four registries as one object, and the integrity check over them. Pure (it reads the file system for existence only),
 * so tests/gate/registry.test.ts and the runner's `--check` mode use the same code.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CRITICAL } from './critical.ts'
import { EXTENDED } from './extended.ts'
import { HELPERS } from './helpers.ts'
import { QUARANTINE } from './quarantine.ts'
import type { Proof, Tier } from './types.ts'

export { CRITICAL, EXTENDED, HELPERS, QUARANTINE }

export const ISOLATED_DIR = 'scripts/isolated'

/** The file (relative to scripts/isolated, with its extension) a proof runs. */
export function fileOf(p: Proof): string {
  const stem = p.file ?? p.name
  const ext = p.kind === 'script' ? '.sh' : p.kind === 'sql' ? '.sql' : '.ts'
  return `${stem}${ext}`
}

export function proofsOf(tier: Tier | 'all'): readonly Proof[] {
  return tier === 'critical'
    ? CRITICAL
    : tier === 'extended'
      ? EXTENDED
      : [...CRITICAL, ...EXTENDED]
}

/** Every file under scripts/isolated (one directory deep), as paths relative to it. */
export function isolatedFiles(root = ISOLATED_DIR): string[] {
  const out: string[] = []
  for (const name of readdirSync(root)) {
    const full = join(root, name)
    if (statSync(full).isDirectory()) {
      for (const inner of readdirSync(full)) out.push(`${name}/${inner}`)
    } else out.push(name)
  }
  return out.sort()
}

const strip = (f: string): string => f.replace(/\.[^./]+$/, '')

/**
 * What covers a file: the proof or helper whose stem it is. Returns where it is registered, or null when nothing does.
 * A .ts proof and the .sh or .sql that sets it up share a stem and are one entry.
 */
export function coverOf(file: string): string | null {
  const keys = new Set([file, strip(file)])
  const dir = file.includes('/') ? `${file.slice(0, file.indexOf('/'))}/*` : null
  for (const [tier, list] of [
    ['critical', CRITICAL],
    ['extended', EXTENDED],
    ['quarantine', QUARANTINE],
  ] as const)
    for (const p of list) {
      const stem = p.file ?? p.name
      if (keys.has(stem) || keys.has(`${stem}.ts`) || keys.has(`${stem}.sh`)) return tier
    }
  for (const h of HELPERS) if (keys.has(h.stem) || (dir !== null && h.stem === dir)) return 'helper'
  return null
}

export interface Problem {
  readonly what: string
}

/** Everything wrong with the registries as they stand. Empty means they are sound. */
export function registryProblems(isolatedRoot = ISOLATED_DIR): Problem[] {
  const problems: Problem[] = []
  const bad = (what: string): void => void problems.push({ what })
  const seen = new Map<string, string>()
  for (const [tier, list] of [
    ['critical', CRITICAL],
    ['extended', EXTENDED],
    ['quarantine', QUARANTINE],
  ] as const) {
    for (const p of list) {
      const where = seen.get(p.name)
      if (where !== undefined) bad(`${p.name} is registered twice (${where} and ${tier})`)
      seen.set(p.name, tier)
      if (p.why.trim().length < 20)
        bad(`${p.name}: say in a sentence what it guards (the 'why' is empty)`)
      if (tier === 'quarantine') {
        const replacedBy = (p as { replacedBy?: string }).replacedBy
        if (replacedBy === undefined || replacedBy.trim() === '')
          bad(
            `${p.name}: a quarantined proof says what replaced it, even if the answer is "nothing"`,
          )
        continue
      }
      if (p.min < 0 || (p.min === 0 && p.informational !== true))
        bad(
          `${p.name}: a proof needs an assertion floor of at least 1 (or must be marked informational)`,
        )
      const f = join(isolatedRoot, fileOf(p))
      if (!existsSync(f)) bad(`${p.name}: ${f} does not exist`)
    }
  }
  for (const f of isolatedFiles(isolatedRoot)) {
    if (coverOf(f) === null)
      bad(
        `${join(isolatedRoot, f)} is neither a registered proof nor a listed helper: register it in scripts/gate/{critical,extended}.ts (one line) or helpers.ts`,
      )
  }
  for (const h of HELPERS) {
    if (h.stem.endsWith('/*')) {
      if (!existsSync(join(isolatedRoot, h.stem.slice(0, -2))))
        bad(`helper ${h.stem}: no such directory`)
    } else if (
      !['', '.ts', '.sh', '.sql', '.md'].some((e) =>
        existsSync(join(isolatedRoot, `${h.stem}${e}`)),
      )
    )
      bad(`helper ${h.stem}: no such file`)
  }
  return problems
}
