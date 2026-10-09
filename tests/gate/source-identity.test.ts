import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { sourceIdentity } from '../../scripts/gate/lib.ts'

/**
 * #454: a gate report names the exact source it tested, and a dirty tree cannot pass for its commit. Each property has its control: the
 * clean tree has no digest, a content change moves the digest, and an untracked file is part of the identity.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'source-identity-'))
const git = (...a: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...a], {
    cwd: dir,
    encoding: 'utf8',
  }).trim()
git('init', '-q', '-b', 'main')
writeFileSync(path.join(dir, 'a.txt'), 'one\n')
git('add', '.')
git('commit', '-q', '-m', 'first')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('sourceIdentity', () => {
  it('a clean tree is its commit and has no digest', () => {
    const s = sourceIdentity(dir)
    expect(s.head).toBe(git('rev-parse', 'HEAD'))
    expect(s.clean).toBe(true)
    expect(s.dirtyDigest).toBeNull()
  })

  it('a tracked change makes it dirty, with a digest that follows the content', () => {
    writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    const first = sourceIdentity(dir)
    expect(first.clean).toBe(false)
    expect(first.dirtyDigest).toMatch(/^[0-9a-f]{16}$/)
    writeFileSync(path.join(dir, 'a.txt'), 'three\n')
    const second = sourceIdentity(dir)
    expect(second.dirtyDigest).not.toBe(first.dirtyDigest)
    expect(second.head).toBe(first.head)
  })

  it('an untracked file is part of the identity', () => {
    const before = sourceIdentity(dir)
    writeFileSync(path.join(dir, 'new.txt'), 'x\n')
    const withFile = sourceIdentity(dir)
    expect(withFile.dirtyDigest).not.toBe(before.dirtyDigest)
    writeFileSync(path.join(dir, 'new.txt'), 'y\n')
    expect(sourceIdentity(dir).dirtyDigest).not.toBe(withFile.dirtyDigest)
  })

  it('reverting the change makes it clean again (the control that the digest is not stuck)', () => {
    git('checkout', '--', 'a.txt')
    rmSync(path.join(dir, 'new.txt'))
    expect(sourceIdentity(dir).clean).toBe(true)
  })
})
