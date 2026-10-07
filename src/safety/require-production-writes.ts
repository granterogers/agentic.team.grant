/**
 * Import first in a script that writes to or deploys production: it throws (before any other module runs) unless BOTH
 * ALLOW_PRODUCTION_CHECKS=1 and ALLOW_PRODUCTION_WRITES=1. Also arms the fetch guard.
 *
 * For a deploy or a migration run it ALSO refuses a source that cannot be attributed to a pushed commit (a dirty tree where
 * it ships, an unpushed commit, no git at all), see `provenance.ts`. That check is made here, once, from the command being
 * run, so a deploy script written tomorrow is covered without anybody remembering to ask.
 */
import './arm.ts'
import { assertProductionWritesAllowed, isScriptEntry } from './production-gate.ts'
import { assertProvenance, needsProvenance } from './provenance.ts'

const proc = (
  globalThis as {
    process?: { argv?: string[]; env?: Record<string, string | undefined>; cwd?: () => string }
  }
).process
const entry = proc?.argv?.[1] ?? 'this command'
if (isScriptEntry()) {
  const label = entry.replace(/^.*\/(scripts\/)/, '$1')
  assertProductionWritesAllowed(`running ${label}`)
  if (proc?.env !== undefined && needsProvenance(entry, proc.argv ?? [])) {
    const { readGitFacts, auditToFile } = await import('./git-facts.ts')
    const cwd = proc.cwd?.() ?? '.'
    const verdict = assertProvenance(label, readGitFacts(cwd), proc.env, auditToFile(cwd))
    // Downstream deploy steps can stamp this on what they ship (the Vercel deployment's meta, for one).
    if (verdict.sha !== null) proc.env.DEPLOY_SOURCE_SHA = verdict.sha
    console.error(
      `provenance: ${label} ships ${verdict.sha?.slice(0, 12) ?? 'no commit'}${
        verdict.branch === null ? '' : ` (${verdict.branch})`
      }, ${verdict.bypassed ? 'BYPASSED (see the log above)' : 'tree clean where it ships, commit pushed'}`,
    )
  }
}
