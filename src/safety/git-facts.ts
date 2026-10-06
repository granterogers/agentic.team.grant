/**
 * Reads the git facts `provenance.ts` decides on. Node only, and only ever loaded by a deploy or migrate script that is
 * about to ship; the office itself (Deno) never imports this.
 *
 * Everything here is local: `git status`, `git rev-parse` and `git branch -r --contains` read the repository on disk and the
 * remote-tracking refs from the last fetch. No network, and no write to the repository. "On a remote" therefore means "on a
 * remote as of the last fetch", which is the honest limit; the refusal text says to push.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import type { GitFacts } from './provenance.ts'

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

export const readGitFacts = (cwd: string = process.cwd()): GitFacts => {
  let sha: string | null = null
  try {
    sha = git(['rev-parse', 'HEAD'], cwd).trim()
    if (!/^[0-9a-f]{40}$/.test(sha)) sha = null
  } catch {
    sha = null
  }
  if (sha === null) return { sha: null, branch: null, dirty: [], onRemote: null }

  let branch: string | null = null
  try {
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).trim()
    branch = b === 'HEAD' ? null : b
  } catch {
    branch = null
  }

  let dirty: string[] = []
  try {
    // -z: NUL-separated, so a path with a space or a quote is read as it is. Untracked files count: a new, uncommitted
    // migration is exactly the case this exists for.
    const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd)
    const entries = raw.split('\0').filter((e) => e !== '')
    dirty = []
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i] ?? ''
      dirty.push(e.slice(3))
      // A rename or copy carries its source as the NEXT entry.
      if (e[0] === 'R' || e[0] === 'C') i += 1
    }
  } catch {
    dirty = ['(git status could not be read)']
  }

  let onRemote: boolean | null = null
  try {
    const out = git(['branch', '-r', '--contains', 'HEAD'], cwd)
    onRemote = out
      .split('\n')
      .map((l) => l.trim())
      .some((l) => l !== '' && !l.includes('->'))
  } catch {
    onRemote = null
  }
  return { sha, branch, dirty, onRemote }
}

/** A bypass leaves a line in `.out/provenance-bypass.log` (git-ignored, local) as well as on the screen. */
export const auditToFile =
  (cwd: string = process.cwd()) =>
  (line: string): void => {
    console.error(`PROVENANCE BYPASS IN USE: ${line}`)
    mkdirSync(`${cwd}/.out`, { recursive: true })
    appendFileSync(`${cwd}/.out/provenance-bypass.log`, `${line}\n`, 'utf8')
  }
