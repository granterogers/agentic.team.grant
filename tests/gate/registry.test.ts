/**
 * The proof registries (scripts/gate/*.ts). The failure this exists to prevent is the one the audit found: replica proofs
 * that rotted red for weeks because nothing ran them. A proof in scripts/isolated/ that is neither registered in a tier nor
 * listed as a helper fails here, so adding one forces the one-line decision about which tier it belongs to.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CRITICAL,
  coverOf,
  EXTENDED,
  fileOf,
  HELPERS,
  isolatedFiles,
  QUARANTINE,
  registryProblems,
} from '../../scripts/gate/registry.ts'

describe('the registries are sound', () => {
  it('every COMMITTED file in scripts/isolated is a registered proof or a listed helper, none registered twice', () => {
    // A proof somebody is still writing (untracked) is not yet rot, so it does not turn every other person's `npm test` red;
    // `npm run check:proofs` and the gate runner itself refuse it all the same, and the moment it is committed it is held here.
    const tracked = new Set(
      execFileSync('git', ['ls-files', 'scripts/isolated'], { encoding: 'utf8' }).split('\n'),
    )
    const problems = registryProblems()
      .map((p) => p.what)
      .filter((w) => {
        const m = /^(scripts\/isolated\/\S+) is neither/.exec(w)
        return m === null || tracked.has(m[1] ?? '')
      })
    expect(problems).toEqual([])
  })

  it('the critical tier is deliberately small and every entry says what it guards', () => {
    expect(CRITICAL.length).toBeGreaterThanOrEqual(30)
    // Raised 70 to 75 for the Chief of Staff reliability proofs (approval-asked-once, specialist-reassign-worker): each
    // guards a live path that no other critical proof covers. The ceiling still bounds the tier; it is not a count to hit.
    expect(CRITICAL.length).toBeLessThanOrEqual(75)
    for (const p of CRITICAL) {
      expect(p.why.length, p.name).toBeGreaterThanOrEqual(20)
      expect(p.min, `${p.name} needs an assertion floor`).toBeGreaterThanOrEqual(1)
    }
  })

  it('what the audit named is in the critical tier', () => {
    const names = new Set(CRITICAL.map((p) => p.name))
    for (const n of [
      'office-ownership',
      'p3-app-attack',
      'office-ownership-sabotage',
      'p1-operator',
      'p1-storage-order',
      'p1-credentials',
      'principals',
      'sender-authorization',
      'approver-identity',
      'anon-surface',
      'containment',
      'job-origin',
      'approval-binding',
      'approval-execution',
      'approval-delivery',
      'authority',
      'typed-yes',
      'question-binding',
      'forwarded-writers',
      'forwarded-authority',
      'turn-entitlement',
      'job-lifecycle',
      'job-fence',
      'exactly-once',
      'terminal-job-owes-a-word',
      'parked-turn-owes-a-word',
      'office-fairness',
      'project-provenance',
      'guidance-stated',
      'task-content-containment',
      'mcp-cannot-answer',
      'e2e-boundary',
      'e2e-tasks',
      'e2e-convergence',
      'replay-parity',
    ])
      expect(names.has(n), `${n} must be in the critical tier`).toBe(true)
  })

  it('no proof is in two tiers, and a quarantined proof is in no running tier', () => {
    const running = [...CRITICAL, ...EXTENDED].map((p) => p.name)
    expect(new Set(running).size).toBe(running.length)
    for (const q of QUARANTINE) {
      expect(running, q.name).not.toContain(q.name)
      expect(q.replacedBy.trim().length, `${q.name} must say what replaced it`).toBeGreaterThan(5)
    }
  })

  it('each quarantined file is where the registry says, and the README names it', () => {
    const readme = readFileSync('scripts/isolated/quarantine/README.md', 'utf8')
    for (const q of QUARANTINE) {
      expect(isolatedFiles(), q.name).toContain(q.name.includes('.') ? q.name : `${q.name}.ts`)
      expect(readme, q.name).toContain(q.name.replace('quarantine/', ''))
    }
  })

  it('every registered proof file exists', () => {
    for (const p of [...CRITICAL, ...EXTENDED]) expect(isolatedFiles(), p.name).toContain(fileOf(p))
  })

  it('every helper that names a file or directory exists', () => {
    expect(HELPERS.length).toBeGreaterThan(10)
  })
})

describe('the orphan detector can fail (a control that has only ever reported zero reports nothing)', () => {
  it('a stray proof in the folder is named as neither registered nor a helper', () => {
    const root = mkdtempSync(join(tmpdir(), 'gate-registry-'))
    mkdirSync(join(root, 'quarantine'))
    writeFileSync(join(root, 'zz-brand-new-proof.ts'), '// nobody registered me\n')
    const problems = registryProblems(root).map((p) => p.what)
    expect(
      problems.some(
        (w) => w.includes('zz-brand-new-proof.ts') && w.includes('neither a registered proof'),
      ),
    ).toBe(true)
  })

  it('coverOf says null for a file nothing registers, and the tier for one that is', () => {
    expect(coverOf('zz-brand-new-proof.ts')).toBeNull()
    expect(coverOf('job-fence.ts')).toBe('critical')
    expect(coverOf('policy-vikunja.ts')).toBe('extended')
    expect(coverOf('quarantine/job-skew.ts')).toBe('quarantine')
    expect(coverOf('guard.ts')).toBe('helper')
    expect(coverOf('p3-cases/10-tasks.ts')).toBe('helper')
  })

  it('a .ts proof and its setup script are one registration', () => {
    expect(coverOf('backup-restore-typed.sh')).toBe('extended')
    expect(coverOf('backup-restore-typed.ts')).toBe('extended')
    expect(coverOf('recovery-matrix.sh')).toBe('critical')
    expect(coverOf('recovery-matrix.sql')).toBe('critical')
  })
})
