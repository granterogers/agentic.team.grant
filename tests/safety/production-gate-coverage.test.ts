/**
 * Every command that can reach production passes through the production-access gate - derived from package.json and the
 * scripts tree, so a script added tomorrow cannot silently skip it.
 *
 * The detector is proved able to FAIL (the controls at the bottom run it over an in-memory tree), because a coverage check
 * that has only ever been shown a passing tree reads as working whether it matches everything or nothing.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  closure,
  entriesOf,
  type Fs,
  firstImport,
  firstImportIs,
  hasGate,
  npmRefs,
  reachesProduction,
  realFs,
} from './coverage-lib.ts'

const ROOT = process.cwd()
const fs = realFs(ROOT)
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
const manifest = JSON.parse(readFileSync('docs/testing/production-access.json', 'utf8')) as {
  writes: string[]
  checks: string[]
}

/** The files a named npm script runs, following `npm run` chains. */
const entriesFor = (name: string, seen = new Set<string>()): string[] => {
  if (seen.has(name)) return []
  seen.add(name)
  const cmd = pkg.scripts[name] ?? ''
  return [...entriesOf(cmd), ...npmRefs(cmd).flatMap((n) => entriesFor(n, seen))].filter((e) =>
    e.endsWith('.ts'),
  )
}

/** The files a command itself runs (not what an `npm run` it chains to runs): the first import of THESE is what must be the gate. */
const ownEntries = (name: string): string[] =>
  entriesOf(pkg.scripts[name] ?? '').filter((e) => e.endsWith('.ts'))

const scriptNames = Object.keys(pkg.scripts)

describe('the manifest names real commands', () => {
  it('has no stale entry', () => {
    for (const n of [...manifest.writes, ...manifest.checks])
      expect(pkg.scripts[n], n).toBeDefined()
  })
  it('has a TypeScript entry file for every command it classes', () => {
    for (const n of [...manifest.writes, ...manifest.checks])
      expect(ownEntries(n).length, n).toBeGreaterThan(0)
  })
})

describe('writing commands need the second, stronger confirmation', () => {
  it('derives deploy:*, migrate* and purge:* from package.json - none may be left out of the manifest', () => {
    const mustWrite = scriptNames.filter(
      (n) => /^(deploy:|migrate(:one)?$|purge:)/.test(n) && n !== 'migrate:next',
    )
    expect(mustWrite.length).toBeGreaterThan(10)
    for (const n of mustWrite)
      expect(manifest.writes, `${n} must be classed as writing`).toContain(n)
  })

  it('opens every writing entry file with require-production-writes, before any other import', () => {
    for (const n of manifest.writes)
      for (const e of ownEntries(n)) {
        const src = fs.read(e) ?? ''
        expect(
          firstImportIs(src, 'require-production-writes'),
          `${n}: ${e} first import is ${firstImport(src)}`,
        ).toBe(true)
      }
  })
})

describe('inspection commands need the first confirmation', () => {
  it('opens every checking entry file with a require-production module (writes also satisfies it)', () => {
    for (const n of manifest.checks)
      for (const e of ownEntries(n)) {
        const src = fs.read(e) ?? ''
        expect(
          firstImportIs(
            src,
            'require-production-checks',
            'require-production-writes',
            'require-production-site',
            'require-production-unless-replica',
            'require-production-when-live',
          ),
          `${n}: ${e} first import is ${firstImport(src)}`,
        ).toBe(true)
      }
  })

  it('classes the four commands the earlier run touched production through, by name', () => {
    for (const n of [
      'check:gateway-wrappers',
      'check:callers',
      'check:consumed',
      'check:anon-exposure',
      'check:icons',
      'q',
      'qq',
    ])
      expect(manifest.checks, n).toContain(n)
  })
})

describe('no command reaches production except through the gate', () => {
  it('every npm script whose closure can contact production has the gate in its closure', () => {
    const bare: string[] = []
    let reaching = 0
    for (const n of scriptNames)
      for (const e of entriesFor(n)) {
        if (!reachesProduction(fs, e)) continue
        reaching += 1
        if (!hasGate(fs, e)) bare.push(`${n} -> ${e}`)
      }
    expect(reaching, 'the detector found nothing to cover: it cannot be trusted').toBeGreaterThan(
      200,
    )
    expect(bare).toEqual([])
  })

  it('every TypeScript file under scripts/ that can contact production has the gate in its closure', () => {
    const files = fs.list('scripts').filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(300)
    expect(files.filter((f) => reachesProduction(fs, f) && !hasGate(fs, f))).toEqual([])
  })

  it('Postgres is opened in exactly one place, which the gate wraps', () => {
    const files = [
      ...fs.list('src'),
      ...fs.list('scripts'),
      ...fs.list('tests'),
      ...fs.list('supabase'),
    ]
    const users = files.filter(
      (f) =>
        f.endsWith('.ts') &&
        /from 'pg'|require\('pg'\)/.test(fs.read(f) ?? '') &&
        !f.startsWith('tests/safety/'),
    )
    expect(users).toEqual(['src/db/pg-executor.ts'])
  })

  it('the shell wrapper refuses before it builds a request', () => {
    const sh = fs.read('scripts/db-query.sh') ?? ''
    expect(sh.indexOf('ALLOW_PRODUCTION_CHECKS')).toBeGreaterThan(-1)
    expect(sh.indexOf('ALLOW_PRODUCTION_CHECKS')).toBeLessThan(sh.indexOf('curl'))
  })

  it('every workflow that holds the access token states the intent a person dispatching it has', () => {
    const wf = fs.list('.github/workflows').filter((f) => f.endsWith('.yml'))
    const runsOffice = wf.filter(
      (f) =>
        /npm run (?!lint|typecheck|test|check:)/.test(fs.read(f) ?? '') &&
        /SUPABASE_ACCESS_TOKEN/.test(fs.read(f) ?? ''),
    )
    expect(runsOffice.length).toBeGreaterThan(3)
    for (const f of runsOffice) expect(fs.read(f), f).toMatch(/ALLOW_PRODUCTION_CHECKS: '1'/)
  })
})

describe('the detector can fail (controls)', () => {
  const tree = (files: Record<string, string>): Fs => ({
    read: (p) => files[p] ?? null,
    list: (d) => Object.keys(files).filter((f) => f.startsWith(`${d}/`)),
  })

  it('flags a script that reaches production and imports nothing from the gate', () => {
    const t = tree({
      'scripts/x.ts':
        "const t = process.env.SUPABASE_ACCESS_TOKEN\nawait fetch('https://api.supabase.com/v1/projects')\n",
    })
    expect(reachesProduction(t, 'scripts/x.ts')).toBe(true)
    expect(hasGate(t, 'scripts/x.ts')).toBe(false)
  })

  it('does not flag it once it imports the gate, directly or through a helper', () => {
    const direct = tree({
      'scripts/x.ts':
        "import '../src/safety/arm.ts'\nawait fetch('https://api.supabase.com/v1/projects')\n",
      'src/safety/arm.ts': 'export {}\n',
    })
    expect(hasGate(direct, 'scripts/x.ts')).toBe(true)
    const viaHelper = tree({
      'scripts/x.ts': "import { q } from './lib.ts'\nawait q()\n",
      'scripts/lib.ts':
        "import { ManagementApiExecutor } from '../src/db/executor.ts'\nexport const q = () => new ManagementApiExecutor('r', 't')\n",
      'src/db/executor.ts': 'export class ManagementApiExecutor {}\n',
    })
    expect(reachesProduction(viaHelper, 'scripts/x.ts')).toBe(true)
    expect(hasGate(viaHelper, 'scripts/x.ts')).toBe(true)
  })

  it('a MENTION of the gate in a comment is not a gate', () => {
    const t = tree({
      'scripts/x.ts':
        "// see src/safety/arm.ts\nawait fetch('https://api.supabase.com/v1/projects')\n",
    })
    expect(hasGate(t, 'scripts/x.ts')).toBe(false)
  })

  it('a writing entry whose first import is something else fails the first-import check', () => {
    const wrong =
      "import { x } from './x.ts'\nimport '../src/safety/require-production-writes.ts'\n"
    const right =
      "/** doc */\nimport '../src/safety/require-production-writes.ts'\nimport { x } from './x.ts'\n"
    expect(firstImportIs(wrong, 'require-production-writes')).toBe(false)
    expect(firstImportIs(right, 'require-production-writes')).toBe(true)
    expect(firstImportIs('const a = 1\n', 'require-production-writes')).toBe(false)
  })

  it('the closure walk follows imports (and so would notice a removed one)', () => {
    const t = tree({
      'scripts/a.ts': "import './b.ts'\n",
      'scripts/b.ts': "import '../src/safety/arm.ts'\n",
      'src/safety/arm.ts': '',
    })
    expect([...closure(t, 'scripts/a.ts')].sort()).toEqual([
      'scripts/a.ts',
      'scripts/b.ts',
      'src/safety/arm.ts',
    ])
  })
})
