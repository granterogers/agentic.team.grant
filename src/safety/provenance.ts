/**
 * Source provenance for anything that ships: a migration run or a deploy must be attributable to a commit somebody can
 * get back.
 *
 * The public Sample Office reached production from a working tree whose migrations 0897 and 0898 and whose edge function
 * changes were never committed (5 October 2026). The database ledger recorded the migrations, the functions were live, and
 * the repository held nothing: `0897` could never again be reproduced byte for byte, so `npm run migrate` was blocked by
 * `checksum/missing` for every future change until the work was recovered by hand. The migration runner already refuses the
 * history-side faults (an applied migration with no file, a checksum that disagrees, a duplicate number); what it cannot
 * see is the SOURCE side. This module is that half:
 *
 *   - the commit being shipped is unknown (not a git checkout),
 *   - the working tree is dirty where it would ship (so the bytes deployed are not the bytes of any commit),
 *   - the commit exists nowhere but this machine (so it can be lost with the session).
 *
 * Pure decisions live here so they can be tested without a repository; `git-facts.ts` reads the facts. `require-
 * production-writes.ts` asks for it, once, for every deploy and migrate script, so a new deploy script cannot forget.
 *
 * THE BYPASS is explicit, narrow and auditable, and exists for a genuine emergency (a production fix that cannot wait for a
 * push). `ALLOW_UNPROVENANCED_DEPLOY` must carry a REASON of at least twenty characters, not a flag: "1" or "true" is
 * refused. It waives only the three source checks above. It never waives the migration-history checks (`checksum/missing`,
 * `checksum/modified`, duplicate numbers), which live in the runner and have no switch. A used bypass is printed in full and
 * appended to `.out/provenance-bypass.log` with the commit, the dirty paths, the reason and the time. This change did not
 * use it.
 */

export const ENV_BYPASS = 'ALLOW_UNPROVENANCED_DEPLOY'

/** What was learned from git, or could not be. */
export type GitFacts = {
  /** The full commit id HEAD points at, or null when this is not a git checkout. */
  sha: string | null
  branch: string | null
  /** `git status --porcelain` paths: modified, staged, deleted and untracked-but-not-ignored. */
  dirty: string[]
  /** True when some remote-tracking branch contains HEAD; null when it could not be asked. */
  onRemote: boolean | null
}

/**
 * Paths that never ship, so changing them does not make a deploy unattributable. Everything else is treated as shipped,
 * which is the safe direction: a new top-level directory counts until somebody says it does not.
 */
const NOT_SHIPPED = /^(docs\/|tests\/|\.out\/|\.staging\/|\.scratch\/|\.claude\/|\.github\/)/

export const shippedDirtyPaths = (dirty: readonly string[]): string[] =>
  dirty.filter((p) => !NOT_SHIPPED.test(p.replace(/^"|"$/g, '')))

/** Why this must not ship, in words. Empty when it may. */
export const provenanceProblems = (facts: GitFacts): string[] => {
  const problems: string[] = []
  if (facts.sha === null) {
    problems.push(
      'this is not a git checkout (or HEAD cannot be read), so the source being shipped is attributable to no commit',
    )
    return problems
  }
  const shipped = shippedDirtyPaths(facts.dirty)
  if (shipped.length > 0) {
    const shown = shipped.slice(0, 8).join(', ')
    problems.push(
      `the working tree is dirty where it ships (${String(shipped.length)} path(s): ${shown}${
        shipped.length > 8 ? ', ...' : ''
      }); what would be deployed is not the content of ${facts.sha.slice(0, 8)} or of any commit. Commit it first`,
    )
  }
  if (facts.onRemote === false) {
    problems.push(
      `commit ${facts.sha.slice(0, 8)} is on no remote-tracking branch, so it exists only on this machine. Push it first`,
    )
  } else if (facts.onRemote === null) {
    problems.push(
      `it could not be established whether commit ${facts.sha.slice(0, 8)} is pushed (git could not answer). Push it and fetch`,
    )
  }
  return problems
}

export class ProvenanceRefused extends Error {
  constructor(
    readonly what: string,
    readonly problems: readonly string[],
  ) {
    super(
      `REFUSED: ${what} is not attributable to a pushed, committed source.\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\n(An emergency bypass exists: ${ENV_BYPASS}="<why, at least 20 characters>". It is logged, ` +
        'it waives only these source checks, and it never waives the migration-history checks.)',
    )
    this.name = 'ProvenanceRefused'
  }
}

/** The bypass is a sentence, never a flag. */
export const bypassReason = (value: string | undefined): string | null => {
  const reason = (value ?? '').trim()
  if (reason.length < 20) return null
  if (/^(1|true|yes|y|on|allow|bypass)$/i.test(reason)) return null
  return reason
}

export type ProvenanceVerdict =
  | { ok: true; sha: string; branch: string | null; bypassed: false }
  | {
      ok: true
      sha: string | null
      branch: string | null
      bypassed: true
      reason: string
      problems: string[]
    }

/**
 * Decide, and for a bypass hand the caller the audit line to record. Throws ProvenanceRefused when it may not ship.
 * `audit` is called with one JSON line BEFORE this returns for a bypass, so a bypass is never silent.
 */
export const assertProvenance = (
  what: string,
  facts: GitFacts,
  env: Record<string, string | undefined>,
  audit: (line: string) => void,
  now: () => string = () => new Date().toISOString(),
): ProvenanceVerdict => {
  const problems = provenanceProblems(facts)
  if (problems.length === 0 && facts.sha !== null) {
    return { ok: true, sha: facts.sha, branch: facts.branch, bypassed: false }
  }
  const reason = bypassReason(env[ENV_BYPASS])
  if (reason === null) throw new ProvenanceRefused(what, problems)
  audit(
    JSON.stringify({
      at: now(),
      what,
      commit: facts.sha,
      branch: facts.branch,
      dirty: shippedDirtyPaths(facts.dirty).slice(0, 50),
      onRemote: facts.onRemote,
      problems,
      reason,
    }),
  )
  return { ok: true, sha: facts.sha, branch: facts.branch, bypassed: true, reason, problems }
}

/**
 * Which scripts this applies to, decided from the command being run so a NEW deploy script is covered the day it is
 * written. Deploys (`scripts/deploy/*`) and the migration runners, except a `--dry` list that changes nothing.
 */
export const needsProvenance = (entry: string, argv: readonly string[]): boolean => {
  const e = entry.replace(/\\/g, '/')
  if (/(^|\/)scripts\/deploy\/[^/]+\.ts$/.test(e)) return true
  if (/(^|\/)scripts\/migrate(-one)?\.ts$/.test(e)) return !argv.includes('--dry')
  return false
}
