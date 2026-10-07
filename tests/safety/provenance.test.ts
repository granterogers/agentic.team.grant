/**
 * Source provenance for anything that ships (src/safety/provenance.ts), added after the public Sample Office reached
 * production from an uncommitted working tree and its migrations 0897 and 0898 existed in the database ledger and nowhere in
 * the repository.
 *
 * What is asserted is the property: a deploy or a migration run refuses a source it cannot attribute to a pushed commit, and
 * the one way round that is explicit, narrow and leaves a record. Each detector is shown a failing case AND a passing one,
 * because a refusal that fires on everything proves nothing.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditToFile, readGitFacts } from '../../src/safety/git-facts.ts'
import {
  assertProvenance,
  bypassReason,
  ENV_BYPASS,
  type GitFacts,
  needsProvenance,
  ProvenanceRefused,
  provenanceProblems,
  shippedDirtyPaths,
} from '../../src/safety/provenance.ts'

const SHA = 'a'.repeat(40)
const good: GitFacts = { sha: SHA, branch: 'main', dirty: [], onRemote: true }
const never = (): void => {
  throw new Error('a clean, pushed source must not write an audit line')
}

describe('the decision', () => {
  it('lets a clean, pushed commit ship, and writes nothing', () => {
    const v = assertProvenance('deploy', good, {}, never)
    expect(v).toMatchObject({ ok: true, sha: SHA, bypassed: false })
  })

  it('refuses an uncommitted migration (the Sample incident: an untracked file under migrations/)', () => {
    const facts = { ...good, dirty: ['migrations/0897_a_visitor_can_explore.sql'] }
    expect(provenanceProblems(facts).join(' ')).toMatch(/dirty where it ships/)
    expect(() => assertProvenance('migrate', facts, {}, never)).toThrow(ProvenanceRefused)
  })

  it('refuses a modified edge function and a modified page, and names the paths', () => {
    for (const p of [
      'supabase/functions/hq-api/index.ts',
      'web/studio/session.js',
      'src/auth/speaker.ts',
    ]) {
      const problems = provenanceProblems({ ...good, dirty: [p] })
      expect(problems.length, p).toBe(1)
      expect(problems[0]).toContain(p)
    }
  })

  it('does not treat documents and tests as shipped source', () => {
    const facts = { ...good, dirty: ['docs/HANDOFF.md', 'tests/safety/x.test.ts', '.out/shot.png'] }
    expect(shippedDirtyPaths(facts.dirty)).toEqual([])
    expect(provenanceProblems(facts)).toEqual([])
  })

  it('refuses a commit that exists on no remote, and one whose remoteness cannot be established', () => {
    expect(provenanceProblems({ ...good, onRemote: false }).join(' ')).toMatch(
      /no remote-tracking branch/,
    )
    expect(provenanceProblems({ ...good, onRemote: null }).join(' ')).toMatch(
      /could not be established/,
    )
  })

  it('refuses a source with no commit at all', () => {
    const facts: GitFacts = { sha: null, branch: null, dirty: [], onRemote: null }
    expect(provenanceProblems(facts).join(' ')).toMatch(/not a git checkout/)
    expect(() => assertProvenance('deploy', facts, {}, never)).toThrow(/not attributable/)
  })

  it('reports every problem at once rather than the first', () => {
    const facts = { ...good, dirty: ['src/a.ts'], onRemote: false }
    expect(provenanceProblems(facts)).toHaveLength(2)
  })
})

describe('the bypass is explicit, narrow and auditable', () => {
  const dirty = { ...good, dirty: ['supabase/functions/hq-api/index.ts'], onRemote: false }

  it('is a reason of at least twenty characters, never a flag', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'bypass', '', '   ', 'too short', undefined]) {
      expect(bypassReason(v), String(v)).toBeNull()
      expect(() => assertProvenance('deploy', dirty, { [ENV_BYPASS]: v }, () => {})).toThrow(
        ProvenanceRefused,
      )
    }
    expect(bypassReason('hotfix for a live outage, push follows')).toBe(
      'hotfix for a live outage, push follows',
    )
  })

  it('lets a deploy through and ALWAYS records who, what, why and when before returning', () => {
    const lines: string[] = []
    const v = assertProvenance(
      'scripts/deploy/hq-function.ts',
      dirty,
      { [ENV_BYPASS]: 'live outage, the fix is pushed straight after' },
      (l) => lines.push(l),
      () => '2026-10-06T12:00:00.000Z',
    )
    expect(v).toMatchObject({ ok: true, bypassed: true })
    expect(lines).toHaveLength(1)
    const rec = JSON.parse(lines[0] as string) as Record<string, unknown>
    expect(rec).toMatchObject({
      at: '2026-10-06T12:00:00.000Z',
      what: 'scripts/deploy/hq-function.ts',
      commit: SHA,
      reason: 'live outage, the fix is pushed straight after',
    })
    expect(rec.dirty).toEqual(['supabase/functions/hq-api/index.ts'])
    expect(rec.problems).toHaveLength(2)
  })

  it('is not consulted when the source is already attributable', () => {
    expect(() =>
      assertProvenance('deploy', good, { [ENV_BYPASS]: 'a perfectly good reason here' }, never),
    ).not.toThrow()
  })

  it('writes the record to .out/provenance-bypass.log as well as the screen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'))
    const err = console.error
    console.error = () => {}
    try {
      auditToFile(dir)('{"x":1}')
    } finally {
      console.error = err
    }
    expect(readFileSync(join(dir, '.out/provenance-bypass.log'), 'utf8')).toBe('{"x":1}\n')
  })

  it('the migration-history checks have no switch at all (the bypass cannot reach them)', () => {
    const runner = readFileSync('src/migrations/runner.ts', 'utf8')
    const check = readFileSync('src/migrations/check.ts', 'utf8')
    expect(runner).not.toContain(ENV_BYPASS)
    expect(check).not.toContain(ENV_BYPASS)
    expect(runner).toMatch(/checkMigrations\(files, recorded, hash\)/)
  })
})

describe('which commands are asked', () => {
  it('every deploy script, migrate and migrate-one; not a dry run, a check or a verification', () => {
    expect(needsProvenance('/x/scripts/deploy/worker.ts', [])).toBe(true)
    expect(needsProvenance('/x/scripts/deploy/hq-page-delta.ts', [])).toBe(true)
    expect(needsProvenance('/x/scripts/migrate.ts', ['x', 'y'])).toBe(true)
    expect(needsProvenance('/x/scripts/migrate-one.ts', [])).toBe(true)
    expect(needsProvenance('/x/scripts/migrate.ts', ['--dry'])).toBe(false)
    expect(needsProvenance('/x/scripts/check-leaks.ts', [])).toBe(false)
    expect(needsProvenance('/x/scripts/verify/hq.ts', [])).toBe(false)
    expect(needsProvenance('/x/scripts/deploy/lib/bundle.ts', [])).toBe(false)
  })

  it('every deploy script that writes to production is covered, by its path alone', () => {
    const deploy = readdirSync('scripts/deploy').filter((f) => f.endsWith('.ts'))
    expect(deploy.length).toBeGreaterThan(10)
    for (const f of deploy) {
      expect(needsProvenance(`/repo/scripts/deploy/${f}`, []), f).toBe(true)
      const src = readFileSync(`scripts/deploy/${f}`, 'utf8')
      // and each of them reaches the gate that makes the check (a deploy with no gate would be the hole)
      expect(src, f).toMatch(/require-production-writes/)
    }
  })

  it('the gate really asks (the wired call, not the name)', () => {
    const gate = readFileSync('src/safety/require-production-writes.ts', 'utf8')
    expect(gate).toMatch(/needsProvenance\(entry, proc\.argv \?\? \[\]\)/)
    expect(gate).toMatch(
      /assertProvenance\(label, readGitFacts\(cwd\), proc\.env, auditToFile\(cwd\)\)/,
    )
  })

  it('stamps the commit on the page it ships (the deployed page is attributable to a SHA)', () => {
    const page = readFileSync('scripts/deploy/hq-page-delta.ts', 'utf8')
    expect(page).toMatch(/meta: \{ gitCommitSha: process\.env\.DEPLOY_SOURCE_SHA/)
  })
})

describe('against a real repository', () => {
  const sh = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const repo = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-git-'))
    sh(dir, 'init', '-q', '-b', 'main')
    sh(dir, 'config', 'user.email', 'p@example.invalid')
    sh(dir, 'config', 'user.name', 'p')
    mkdirSync(join(dir, 'migrations'))
    writeFileSync(join(dir, 'migrations/0001_a.sql'), 'select 1;\n')
    sh(dir, 'add', '-A')
    sh(dir, 'commit', '-q', '-m', 'one')
    return dir
  }

  it('a clean checkout whose commit was never pushed is refused for that reason alone', () => {
    const dir = repo()
    const facts = readGitFacts(dir)
    expect(facts.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(facts.dirty).toEqual([])
    expect(facts.onRemote).toBe(false)
    expect(provenanceProblems(facts)).toHaveLength(1)
  })

  it('a pushed, clean checkout passes', () => {
    const dir = repo()
    const bare = mkdtempSync(join(tmpdir(), 'prov-bare-'))
    sh(bare, 'init', '-q', '--bare', '-b', 'main')
    sh(dir, 'remote', 'add', 'origin', bare)
    sh(dir, 'push', '-q', 'origin', 'main')
    sh(dir, 'fetch', '-q', 'origin')
    const facts = readGitFacts(dir)
    expect(facts.onRemote).toBe(true)
    expect(provenanceProblems(facts)).toEqual([])
  })

  it('an UNTRACKED new migration and a modified tracked file are both seen as dirty', () => {
    const dir = repo()
    writeFileSync(join(dir, 'migrations/0002_new.sql'), 'select 2;\n')
    writeFileSync(join(dir, 'migrations/0001_a.sql'), 'select 1; -- edited\n')
    const facts = readGitFacts(dir)
    expect(facts.dirty.sort()).toEqual(['migrations/0001_a.sql', 'migrations/0002_new.sql'])
    expect(provenanceProblems({ ...facts, onRemote: true }).join(' ')).toMatch(/2 path\(s\)/)
  })

  it('a directory that is not a repository has no commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-nogit-'))
    expect(readGitFacts(dir)).toEqual({ sha: null, branch: null, dirty: [], onRemote: null })
  })
})
