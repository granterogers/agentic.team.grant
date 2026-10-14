#!/usr/bin/env node
/**
 * The supervisor. It starts the authorised session, watches it, and starts a fresh one when a session ends while the
 * mission is still unfinished. It is the only thing in this repository that launches a model session, and it does not
 * do so unless it is told to with --launch.
 *
 *   node scripts/agent/supervise.mjs                      plan only: prints the launch it would make, starts nothing
 *   node scripts/agent/supervise.mjs --launch             runs the launcher and keeps it running until the mission ends
 *   node scripts/agent/supervise.mjs --launch --launcher "node scripts/agent/fixtures/stub-launcher.mjs"   a test launcher
 *
 * What it guarantees, and each one is in the code path that keeps it:
 *   - One supervisor per checkout. A pid lock is created exclusively; a lock whose process is gone is taken over.
 *   - Each session is recorded before it starts and closed when it ends, in the ledger, under compare and swap.
 *   - An exit while the mission is still active is resumed. An exit is never read as completion; only the ledger is.
 *   - Failures back off exponentially, and repeated fast failures stop the run as a crash loop rather than retrying for ever.
 *   - Budgets are hard: a maximum number of restarts and a maximum number of sessions. Reaching either pauses the mission.
 *   - The authorised deadline and the STOP file are checked before every start and during every wait.
 *   - SIGINT and SIGTERM stop the child, record the pause, release the lock and exit. No new session starts after a signal.
 *
 * What it cannot do: it cannot start a session on another machine, and it cannot run when no process is running it. Those
 * are the owner's to arrange; docs/agent/CONTINUITY.md says how.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { classify } from './lib/gate.mjs'
import { resumePrompt } from './lib/resume.mjs'
import { DEFAULT_LOCK_PATH, DEFAULT_STATE_PATH, readState, updateState } from './lib/state.mjs'

export const POLICY = {
  maxRestarts: 5,
  maxSessions: 12,
  baseBackoffMs: 10_000,
  maxBackoffMs: 600_000,
  crashWindowMs: 600_000,
  crashLimit: 3,
}

/** Split a launcher command into argv without a shell, so no quoting surprises can run anything else. */
export function splitCommand(command) {
  const parts = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return parts.map((p) => p.replace(/^["']|["']$/g, ''))
}

/** The delay before the next start after `failures` consecutive failures. Doubles each time, capped. */
export function backoffMs(failures, policy = POLICY) {
  if (failures <= 0) return 0
  return Math.min(policy.baseBackoffMs * 2 ** (failures - 1), policy.maxBackoffMs)
}

/**
 * Decide whether to start another session. Pure; the loop applies it. Returns a stop reason, or null to go on.
 */
export function stopReason(state, { now, restarts, sessionsStarted, recentFailures, stopRequested, branch, policy = POLICY }) {
  const m = state.mission
  if (!m) return 'no mission recorded'
  if (m.status !== 'active') return `mission is ${m.status}`
  if (typeof branch === 'string' && m.branch && branch !== m.branch) {
    return `mission belongs to branch ${m.branch}, this checkout is on ${branch}`
  }
  if (stopRequested) return 'owner cancelled (STOP file)'
  if (now.getTime() >= Date.parse(m.deadline)) return 'authorised deadline reached'
  const { actionable, blocked } = classify(m)
  if (actionable.length === 0) return `nothing actionable remains (${blocked.length > 0 ? 'blocked' : 'complete'})`
  if (sessionsStarted >= policy.maxSessions) return `session budget spent (${policy.maxSessions})`
  if (restarts >= policy.maxRestarts) return `restart budget spent (${policy.maxRestarts})`
  if (recentFailures >= policy.crashLimit) return `crash loop: ${recentFailures} failures inside ${policy.crashWindowMs} ms`
  return null
}

/** The branch a checkout is on, or undefined when git cannot say. */
export function gitBranch(root) {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** The mission status a stop reason leaves behind. A reason this table does not name leaves the status as it is. */
export function statusFor(reason) {
  if (reason.startsWith('nothing actionable')) return reason.includes('(blocked)') ? 'blocked' : 'complete'
  if (reason.startsWith('crash') || reason.includes('budget')) return 'paused'
  if (reason.startsWith('owner')) return 'cancelled'
  if (reason.startsWith('authorised')) return 'expired'
  return undefined
}

function acquireSupervisorLock(lockPath) {
  mkdirSync(join(lockPath, '..'), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
      closeSync(fd)
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      let owner = null
      try {
        owner = JSON.parse(readFileSync(lockPath, 'utf8'))
      } catch {
        owner = null
      }
      let alive = false
      try {
        if (owner?.pid) process.kill(owner.pid, 0)
        alive = Boolean(owner?.pid)
      } catch (e) {
        alive = e.code === 'EPERM'
      }
      if (alive) return owner
      rmSync(lockPath, { force: true })
    }
  }
  return false
}

function nowIso(clock) {
  return clock().toISOString()
}

/**
 * Run the loop. Injected seams (clock, sleep, root) let the tests drive it; the command line supplies the real ones.
 */
export async function supervise(options) {
  const root = resolve(options.root ?? process.cwd())
  const statePath = join(root, DEFAULT_STATE_PATH)
  const lockPath = join(root, DEFAULT_LOCK_PATH.replace('state.lock', 'supervisor.lock'))
  const stopFiles = [join(root, 'docs/agent/STOP'), join(root, '.out/agent/STOP')]
  const clock = options.clock ?? (() => new Date())
  const wakers = new Set()
  // A wait that ends early when a signal arrives, so a shutdown during backoff is prompt rather than ten minutes late.
  const sleep = (ms) =>
    new Promise((resolveWait) => {
      const timer = setTimeout(done, ms)
      function done() {
        clearTimeout(timer)
        wakers.delete(done)
        resolveWait()
      }
      wakers.add(done)
    })
  const policy = { ...POLICY, ...(options.policy ?? {}) }
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`))
  const launcher = options.launcher ?? 'claude -p'
  const launch = options.launch === true

  const held = acquireSupervisorLock(lockPath)
  if (held !== true) {
    log(`supervisor refused: another supervisor is running (pid ${held?.pid ?? 'unknown'})`)
    return { outcome: 'duplicate', pid: held?.pid ?? null }
  }

  let child = null
  let signalled = null
  const onSignal = (sig) => {
    signalled = sig
    if (child) child.kill('SIGTERM')
    for (const wake of [...wakers]) wake()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const failureTimes = []
  let restarts = 0
  let sessionsStarted = 0
  // A new supervisor links its first session to the last one the ledger recorded, so a restart keeps the chain of work.
  let previous = readState(statePath).sessions.at(-1)?.id ?? null
  let consecutiveFailures = 0
  let lastOutcome = 'running'

  const finish = async (reason, status) => {
    const at = nowIso(clock)
    try {
      await updateState(statePath, join(root, DEFAULT_LOCK_PATH), undefined, (s) => {
        if (s.mission && status) {
          s.mission.status = status
          s.mission.endedReason = reason
        }
        return s
      })
    } catch (error) {
      log(`supervisor could not record its stop: ${error.message}`)
    }
    log(`supervisor stopped at ${at}: ${reason}`)
    rmSync(lockPath, { force: true })
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    return { outcome: status ?? 'stopped', reason }
  }

  try {
    for (;;) {
      if (signalled) return await finish(`signal ${signalled}`, 'paused')
      const state = readState(statePath)
      const recentFailures = failureTimes.filter((t) => clock().getTime() - t <= policy.crashWindowMs).length
      const why = stopReason(state, {
        now: clock(),
        restarts,
        sessionsStarted,
        recentFailures,
        stopRequested: stopFiles.some((f) => existsSync(f)),
        branch: options.branch ?? gitBranch(root),
        policy,
      })
      if (why) {
        const status = statusFor(why)
        return await finish(why, status)
      }

      const prompt = resumePrompt(state)
      const argv = [...splitCommand(launcher), prompt]
      if (!launch) {
        log(`plan only (no --launch): would start session ${sessionsStarted + 1} with: ${splitCommand(launcher).join(' ')} <resume prompt, ${prompt.length} chars>`)
        return { outcome: 'planned', prompt }
      }

      const sessionId = randomUUID()
      const startedAt = nowIso(clock)
      await updateState(statePath, join(root, DEFAULT_LOCK_PATH), undefined, (s) => {
        s.sessions.push({
          id: sessionId,
          parent: previous,
          startedAt,
          endedAt: null,
          lastActivityAt: startedAt,
          terminationReason: null,
          resumeEligible: true,
        })
        return s
      })
      sessionsStarted += 1
      log(`session ${sessionId} started at ${startedAt} (launch ${sessionsStarted} of ${policy.maxSessions})`)

      const exit = await new Promise((resolveExit) => {
        child = spawn(argv[0], argv.slice(1), { cwd: root, stdio: 'inherit', shell: false })
        child.on('exit', (code, signal) => resolveExit({ code, signal }))
        child.on('error', (error) => resolveExit({ code: -1, signal: null, error: error.message }))
      })
      child = null
      const endedAt = nowIso(clock)
      const reasonText = exit.signal ? `signal ${exit.signal}` : exit.error ? `spawn error: ${exit.error}` : `exit ${exit.code}`
      await updateState(statePath, join(root, DEFAULT_LOCK_PATH), undefined, (s) => {
        const rec = s.sessions.find((x) => x.id === sessionId)
        if (rec) {
          rec.endedAt = endedAt
          rec.lastActivityAt = endedAt
          rec.terminationReason = reasonText
        }
        return s
      })
      previous = sessionId
      lastOutcome = reasonText
      log(`session ${sessionId} ended at ${endedAt}: ${reasonText}`)

      if (signalled) return await finish(`signal ${signalled} while session ${sessionId} ran`, 'paused')

      const after = readState(statePath)
      if (after.mission?.status !== 'active') {
        return await finish(`mission ${after.mission?.status ?? 'missing'} after session ${sessionId}`, undefined)
      }
      if (exit.code === 0) {
        consecutiveFailures = 0
      } else {
        consecutiveFailures += 1
        failureTimes.push(clock().getTime())
      }
      restarts += 1
      const wait = exit.code === 0 ? policy.baseBackoffMs : backoffMs(consecutiveFailures, policy)
      log(`resuming in ${wait} ms (last outcome: ${lastOutcome})`)
      await sleep(wait)
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (existsSync(lockPath)) rmSync(lockPath, { force: true })
  }
}

// Command line. Imported by tests, so it only runs when this file is the entry point.
const isEntry = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
if (isEntry) {
  const args = process.argv.slice(2)
  const value = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : fallback
  }
  supervise({
    launch: args.includes('--launch'),
    launcher: value('--launcher', process.env.AGENT_LAUNCHER ?? 'claude -p'),
    root: value('--root', undefined),
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.outcome === 'duplicate' ? 3 : 0
  })
}
