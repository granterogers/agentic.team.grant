#!/usr/bin/env node
/**
 * The supervisor. It starts the authorised session, watches it, and starts a fresh one when a session ends while the
 * mission is still unfinished. It is the only thing in this repository that launches a model session, and it does not
 * do so unless it is told to with --launch.
 *
 *   node scripts/agent/supervise.mjs                      plan only: prints the launch it would make, starts nothing
 *   node scripts/agent/supervise.mjs --launch             runs the launcher and keeps it running until the mission ends
 *
 * What it guarantees, and each one is in the code path that keeps it:
 *   - One supervisor per checkout. A pid lock is created exclusively; a lock whose process is gone is taken over.
 *   - Each session is recorded before it starts and closed when it ends, in the ledger, under compare and swap.
 *   - An exit while the mission is still active is resumed. An exit is never read as completion; only the ledger is.
 *   - Failures back off exponentially, and repeated fast failures stop the run as a crash loop rather than retrying for ever.
 *   - Budgets are hard: a maximum number of restarts, a maximum number of sessions, a maximum wall-clock time for the whole
 *     run, and a maximum spend. Each is checked before a start, and the wall clock and deadline are also checked while a
 *     session runs, which ends that session.
 *   - A running session is ended with SIGTERM when the owner creates a STOP file, when the mission deadline passes, or
 *     when the wall-clock limit passes, and with SIGKILL if it does not exit within the grace period.
 *   - A ledger for a different mission is refused, not resumed.
 *   - Spend is read from each session's JSON result. A session whose cost cannot be read is counted at its full cap.
 *   - SIGINT and SIGTERM stop the child, record the pause, release the lock and exit. No new session starts after a signal.
 *   - On every exit path a child still alive is killed, and the supervisor lock is released.
 *
 * What it cannot do: it cannot run when no process is running it, and it cannot start a session on another machine.
 * docs/agent/CONTINUITY.md says how an owner arranges that.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
 * Decide whether to start another session. Pure; the loop applies it. `restarts` is the number of starts after the first,
 * so with maxRestarts 1 exactly one restart is allowed. Returns a stop reason, or null to go on.
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
    // symbolic-ref, not rev-parse: it names the branch even before the first commit, when rev-parse refuses.
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

/** The mission status a stop reason leaves behind. A reason this table does not name leaves the status as it is. */
export function statusFor(reason) {
  if (reason.startsWith('nothing actionable')) return reason.includes('(blocked)') ? 'blocked' : 'complete'
  if (reason.startsWith('crash') || reason.includes('budget') || reason.includes('wall-clock')) return 'paused'
  if (reason.startsWith('owner')) return 'cancelled'
  if (reason.startsWith('authorised')) return 'expired'
  return undefined
}

/** The spend a session's JSON result reports, or null when it does not say. Never throws. */
export function costFromResult(text) {
  try {
    const j = JSON.parse(text)
    const cost = typeof j.total_cost_usd === 'number' ? j.total_cost_usd : typeof j.cost_usd === 'number' ? j.cost_usd : null
    return { costUsd: cost, claudeSessionId: typeof j.session_id === 'string' ? j.session_id : null, subtype: typeof j.subtype === 'string' ? j.subtype : null, isError: j.is_error === true }
  } catch {
    return null
  }
}

function acquireSupervisorLock(lockPath) {
  mkdirSync(join(lockPath, '..'), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }))
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

/** One pass of the state check that ends a running session. Returns the reason and status, or null to let it run. */
export function abortFor(state, { now, stopRequested, startedAt, maxWallClockMs }) {
  if (stopRequested) return { reason: 'owner cancelled (STOP file) during a session', status: 'cancelled' }
  const m = state?.mission
  if (m && m.status === 'active' && Date.parse(m.deadline) <= now.getTime()) {
    return { reason: 'authorised deadline reached during a session', status: 'expired' }
  }
  if (maxWallClockMs !== null && now.getTime() - startedAt >= maxWallClockMs) {
    return { reason: 'wall-clock limit reached during a session', status: 'paused' }
  }
  return null
}

/**
 * Run the loop. Options (all optional, the command line supplies the real values):
 *   root, launch, launcher, policy, log, clock
 *   expectMission   refuse a ledger whose mission id differs
 *   budget          { totalUsd, perSessionUsd }: refuse a start that could exceed totalUsd; a session cost that cannot be read counts as perSessionUsd
 *   maxWallClockMs  the whole run ends, and a running session is stopped, after this long
 *   captureDir      where each session's JSON result is written (outside the repository for a live trial)
 *   sessionIds      pass a fresh --session-id to each launch
 *   sessionInstructions  one extra line per launch; the last one is reused for later launches
 *   readFirst       files a session reads first (passed to the prompt builder)
 *   pollMs, killGraceMs  watchdog timing
 */
export async function supervise(options) {
  const root = resolve(options.root ?? process.cwd())
  const statePath = join(root, DEFAULT_STATE_PATH)
  const ledgerLock = join(root, DEFAULT_LOCK_PATH)
  const lockPath = join(root, '.out/agent/supervisor.lock')
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
  const budget = options.budget ?? null
  const expectMission = options.expectMission ?? null
  const maxWallClockMs = options.maxWallClockMs ?? null
  const captureDir = options.captureDir ?? null
  const sessionInstructions = options.sessionInstructions ?? []
  const pollMs = options.pollMs ?? 1000
  const killGraceMs = options.killGraceMs ?? 10_000
  const startedAt = clock().getTime()

  const held = acquireSupervisorLock(lockPath)
  if (held !== true) {
    log(`supervisor refused: another supervisor is running (pid ${held?.pid ?? 'unknown'})`)
    return { outcome: 'duplicate', pid: held?.pid ?? null }
  }

  let child = null
  let signalled = null
  let abort = null
  let watchdog = null

  const killChild = (reason, status) => {
    if (!abort) abort = { reason, status }
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      const escalate = setTimeout(() => {
        if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, killGraceMs)
      escalate.unref()
    }
  }
  const onSignal = (sig) => {
    signalled = sig
    killChild(`signal ${sig}`, 'paused')
    for (const wake of [...wakers]) wake()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const failureTimes = []
  let sessionsStarted = 0
  let spentUsd = 0
  // A new supervisor links its first session to the last one the ledger recorded, so a restart keeps the chain of work.
  let previous = readState(statePath).sessions.at(-1)?.id ?? null
  let consecutiveFailures = 0
  let lastOutcome = 'running'

  const cleanup = () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (watchdog) clearInterval(watchdog)
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    rmSync(lockPath, { force: true })
  }

  const finish = async (reason, status, { write = true, outcome } = {}) => {
    const at = clock().toISOString()
    if (write) {
      try {
        await updateState(statePath, ledgerLock, undefined, (s) => {
          if (s.mission && status) {
            s.mission.status = status
            s.mission.endedReason = reason
          }
          return s
        })
      } catch (error) {
        log(`supervisor could not record its stop: ${error.message}`)
      }
    }
    log(`supervisor stopped at ${at}: ${reason}`)
    cleanup()
    return { outcome: outcome ?? status ?? 'stopped', reason, sessionsStarted, spentUsd: Number(spentUsd.toFixed(4)) }
  }

  const instructionFor = (launchNumber) => {
    if (sessionInstructions.length === 0) return undefined
    return sessionInstructions[Math.min(launchNumber - 1, sessionInstructions.length - 1)]
  }

  const readStateSafe = () => {
    try {
      return readState(statePath)
    } catch {
      return null
    }
  }

  try {
    for (;;) {
      if (signalled) return await finish(`signal ${signalled}`, 'paused')
      let state
      try {
        state = readState(statePath)
      } catch (error) {
        return await finish(`ledger unreadable: ${error.message}`, 'paused', { write: false })
      }
      if (expectMission !== null && state.mission?.id !== expectMission) {
        return await finish(`refused: the ledger holds mission ${state.mission?.id ?? 'none'}, not the expected ${expectMission}`, undefined, { write: false, outcome: 'refused' })
      }
      const recentFailures = failureTimes.filter((t) => clock().getTime() - t <= policy.crashWindowMs).length
      const why = stopReason(state, {
        now: clock(),
        restarts: Math.max(0, sessionsStarted - 1),
        sessionsStarted,
        recentFailures,
        stopRequested: stopFiles.some((f) => existsSync(f)),
        branch: options.branch ?? gitBranch(root),
        policy,
      })
      if (why) return await finish(why, statusFor(why))
      if (maxWallClockMs !== null && clock().getTime() - startedAt >= maxWallClockMs) {
        return await finish('wall-clock limit reached', 'paused')
      }
      if (budget && spentUsd + budget.perSessionUsd > budget.totalUsd + 1e-9) {
        return await finish(`budget: a further session could exceed the ${budget.totalUsd} USD limit (spent ${spentUsd.toFixed(4)})`, 'paused')
      }

      const prompt = resumePrompt(state, { readFirst: options.readFirst, sessionInstruction: instructionFor(sessionsStarted + 1) })
      const sessionId = randomUUID()
      const argv = [...splitCommand(launcher), ...(options.sessionIds === true ? ['--session-id', sessionId] : []), prompt]
      if (!launch) {
        log(`plan only (no --launch): would start session ${sessionsStarted + 1} with: ${splitCommand(launcher).join(' ')} <resume prompt, ${prompt.length} chars>`)
        return { outcome: 'planned', prompt }
      }

      const startedNow = clock().toISOString()
      await updateState(statePath, ledgerLock, undefined, (s) => {
        s.sessions.push({
          id: sessionId,
          parent: previous,
          startedAt: startedNow,
          endedAt: null,
          lastActivityAt: startedNow,
          terminationReason: null,
          resumeEligible: true,
          costUsd: null,
        })
        return s
      })
      sessionsStarted += 1
      log(`session ${sessionId} started at ${startedNow} (launch ${sessionsStarted} of ${policy.maxSessions})`)

      const outFile = captureDir ? join(captureDir, `session-${String(sessionsStarted)}.json`) : null
      if (captureDir) mkdirSync(captureDir, { recursive: true })
      const outFd = outFile ? openSync(outFile, 'w') : null
      abort = null
      const exit = await new Promise((resolveExit) => {
        child = spawn(argv[0], argv.slice(1), { cwd: root, stdio: ['ignore', outFd ?? 'inherit', 'inherit'], shell: false })
        child.on('exit', (code, signal) => resolveExit({ code, signal }))
        child.on('error', (error) => resolveExit({ code: -1, signal: null, error: error.message }))
        watchdog = setInterval(() => {
          const a = abortFor(readStateSafe(), {
            now: clock(),
            stopRequested: stopFiles.some((f) => existsSync(f)),
            startedAt,
            maxWallClockMs,
          })
          if (a) killChild(a.reason, a.status)
        }, pollMs)
      })
      if (outFd !== null) closeSync(outFd)
      if (watchdog) clearInterval(watchdog)
      watchdog = null
      child = null

      const endedAt = clock().toISOString()
      const reasonText = exit.signal ? `signal ${exit.signal}` : exit.error ? `spawn error: ${exit.error}` : `exit ${exit.code}`
      let result = null
      if (outFile && existsSync(outFile)) result = costFromResult(readFileSync(outFile, 'utf8'))
      let costUsd = result?.costUsd ?? null
      if (costUsd === null && budget) costUsd = budget.perSessionUsd
      spentUsd += costUsd ?? 0

      await updateState(statePath, ledgerLock, undefined, (s) => {
        const rec = s.sessions.find((x) => x.id === sessionId)
        if (rec) {
          rec.endedAt = endedAt
          rec.lastActivityAt = endedAt
          rec.terminationReason = reasonText
          rec.costUsd = costUsd
          if (result?.claudeSessionId) rec.claudeSessionId = result.claudeSessionId
          if (result?.subtype) rec.resultSubtype = result.subtype
        }
        return s
      })
      previous = sessionId
      lastOutcome = reasonText
      log(`session ${sessionId} ended at ${endedAt}: ${reasonText}${costUsd !== null ? ` (cost ${costUsd} USD)` : ''}`)

      if (abort) return await finish(abort.reason, abort.status)
      if (signalled) return await finish(`signal ${signalled} while session ${sessionId} ran`, 'paused')

      let after
      try {
        after = readState(statePath)
      } catch (error) {
        return await finish(`ledger unreadable after session ${sessionId}: ${error.message}`, 'paused', { write: false })
      }
      if (after.mission?.status !== 'active') {
        return await finish(`mission ${after.mission?.status ?? 'missing'} after session ${sessionId}`, after.mission?.status === 'complete' ? 'complete' : undefined, { write: after.mission?.status === 'complete' })
      }
      if (exit.code === 0) {
        consecutiveFailures = 0
      } else {
        consecutiveFailures += 1
        failureTimes.push(clock().getTime())
      }
      // A crash loop is decided before any wait, so the run does not sleep through the backoff it is about to give up on.
      const recentNow = failureTimes.filter((t) => clock().getTime() - t <= policy.crashWindowMs).length
      if (recentNow >= policy.crashLimit) continue
      const wait = exit.code === 0 ? policy.baseBackoffMs : backoffMs(consecutiveFailures, policy)
      log(`resuming in ${wait} ms (last outcome: ${lastOutcome})`)
      await sleep(wait)
    }
  } finally {
    // Every exit path lands here: a child still alive is killed and the supervisor lock is released.
    cleanup()
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
  const values = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))
  const budgetTotal = value('--budget-total-usd', null)
  const budgetPer = value('--budget-per-session-usd', null)
  supervise({
    launch: args.includes('--launch'),
    launcher: value('--launcher', process.env.AGENT_LAUNCHER ?? 'claude -p'),
    root: value('--root', undefined),
    expectMission: value('--expect-mission', null),
    budget: budgetTotal && budgetPer ? { totalUsd: Number(budgetTotal), perSessionUsd: Number(budgetPer) } : null,
    maxWallClockMs: value('--max-wall-clock-ms', null) === null ? null : Number(value('--max-wall-clock-ms', null)),
    captureDir: value('--capture-dir', null),
    sessionIds: args.includes('--session-ids'),
    sessionInstructions: values('--session-instruction'),
    readFirst: values('--read-first').length > 0 ? values('--read-first') : undefined,
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.outcome === 'duplicate' ? 3 : 0
  })
}
