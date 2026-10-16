#!/usr/bin/env node
/**
 * The Stop hook. Claude Code runs it when the model is about to end a turn, and it receives the hook input as JSON on
 * stdin. It prints {"decision":"block","reason":...} to hold the session open with the remaining work, or prints nothing
 * to let it end. Registered in .claude/settings.json.
 *
 * It fails open: any error in the gate itself allows the stop and says why on stderr. The ledger still records what to
 * resume, so a session that ends by mistake is recoverable; a session trapped by a broken gate is not.
 *
 * A mission applies only on the branch it was written on (see gate.mjs), so a merged ledger does not hold other branches.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyDecision, decide } from './lib/gate.mjs'
import { DEFAULT_LOCK_PATH, DEFAULT_STATE_PATH, LockTimeoutError, readState, updateState } from './lib/state.mjs'

const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
const statePath = join(root, DEFAULT_STATE_PATH)
const lockPath = join(root, DEFAULT_LOCK_PATH)
const stopFiles = [join(root, 'docs/agent/STOP'), join(root, '.out/agent/STOP')]

function readInput() {
  try {
    const text = readFileSync(0, 'utf8')
    return text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    return {}
  }
}

/** The branch this checkout is on, or undefined when git cannot say (then the branch guard does not apply). */
function currentBranch() {
  try {
    // symbolic-ref, not rev-parse: it names the branch even before the first commit, when rev-parse refuses.
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

async function main() {
  const input = readInput()
  const now = new Date()
  const stopRequested = stopFiles.some((f) => existsSync(f))
  const state = readState(statePath)
  const decision = decide(state, input, { now, stopRequested, branch: currentBranch() })

  if (decision.action === 'allow' && decision.nextStatus === null) {
    process.stderr.write(`stop-gate allow: ${decision.reason}\n`)
    return
  }
  if (decision.nextStatus !== null || decision.action === 'block') {
    try {
      await updateState(statePath, lockPath, undefined, (current) => applyDecision(current, input, decision, now), {
        waitMs: 2_000,
        now: () => now.getTime(),
      })
    } catch (error) {
      // The decision still stands. Recording it failed, so say so; the next decision will record its own state.
      process.stderr.write(`stop-gate could not record its decision: ${error instanceof LockTimeoutError ? 'state is locked' : error.message}\n`)
    }
  }
  if (decision.action === 'block') {
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason: decision.reason })}\n`)
    process.stderr.write(`stop-gate block: mission ${decision.mission}\n`)
    return
  }
  process.stderr.write(`stop-gate allow: ${decision.reason}\n`)
}

main().catch((error) => {
  process.stderr.write(`stop-gate failed open: ${error.message}\n`)
  process.exitCode = 0
})
