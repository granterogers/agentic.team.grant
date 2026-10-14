/**
 * A stand-in for a Claude Code session, used by the supervisor tests. It is a real child process: the supervisor spawns
 * it, watches it exit or be killed, and restarts it, exactly as it would a session. It makes no model call.
 *
 * Its last argument is the resume prompt. Each run appends one JSON line to STUB_LOG so a test can see what was sent.
 * STUB_MODE chooses what the run does to the ledger before it exits:
 *   checkpoint  completes the first open requirement, then exits 0 (the mission is still active, so it is resumed)
 *   complete    marks the mission complete, then exits 0
 *   crash       exits 1 without touching the ledger
 *   hang        never exits; the supervisor must stop it with a signal
 *   idle        exits 0 without touching the ledger
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { appendFileSync } from 'node:fs'
import { updateState } from '../../../scripts/agent/lib/state.mjs'
import { classify } from '../../../scripts/agent/lib/gate.mjs'

const mode = process.env.STUB_MODE ?? 'idle'
const statePath = process.env.STUB_STATE
const lockPath = process.env.STUB_LOCK
const prompt = process.argv[process.argv.length - 1] ?? ''

if (process.env.STUB_LOG) {
  appendFileSync(process.env.STUB_LOG, `${JSON.stringify({ pid: process.pid, mode, prompt, argv: process.argv.slice(2, -1) })}\n`)
}

// A session whose supervisor died without cleanup (SIGKILL cannot be caught) must not run on as an orphan. It ends when its
// parent is gone. Real sessions cannot be taught this; the supervisor's own cleanup handles every other exit.
const parent = process.ppid
setInterval(() => {
  if (process.ppid !== parent || process.ppid === 1) process.exit(0)
}, 200).unref()

async function main() {
  if (mode === 'hang') {
    setInterval(() => {}, 1_000)
    return
  }
  if (mode === 'stubborn') {
    // Ignores the polite signal, so only the supervisor's escalation to SIGKILL can end it.
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1_000)
    return
  }
  if (mode === 'costly') {
    // Completes one requirement, then reports a result in the same JSON shape the real CLI prints with --output-format json.
    await updateState(statePath, lockPath, undefined, (s) => {
      const [first] = classify(s.mission).actionable
      if (first) first.status = 'done'
      return s
    })
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: `stub-${process.pid}`, total_cost_usd: 0.3 })}\n`)
    process.exitCode = 0
    return
  }
  if (mode === 'crash') {
    process.exitCode = 1
    return
  }
  if (mode === 'checkpoint') {
    await updateState(statePath, lockPath, undefined, (s) => {
      const [first] = classify(s.mission).actionable
      if (first) first.status = 'done'
      s.mission.lastCheckpoint = { at: new Date().toISOString(), commit: null, summary: `stub completed ${first?.id ?? 'nothing'}` }
      return s
    })
    process.exitCode = 0
    return
  }
  if (mode === 'complete') {
    await updateState(statePath, lockPath, undefined, (s) => {
      for (const r of s.mission.requirements) if (r.status !== 'blocked') r.status = 'done'
      s.mission.status = 'complete'
      return s
    })
    process.exitCode = 0
    return
  }
  process.exitCode = 0
}

main().catch((error) => {
  process.stderr.write(`stub failed: ${error.message}\n`)
  process.exitCode = 2
})
