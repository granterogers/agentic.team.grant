/**
 * The supervisor against a real child process (P0 R5, R6). The launcher is the stub in fixtures/, spawned and watched
 * exactly as a session would be; no model is called. Each case is an interruption or limit a long run actually meets.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resumePrompt } from '../../scripts/agent/lib/resume.mjs'
import type { Requirement } from '../../scripts/agent/lib/state.d.mts'
import { emptyState, readState } from '../../scripts/agent/lib/state.mjs'
import {
  backoffMs,
  POLICY,
  splitCommand,
  statusFor,
  stopReason,
  supervise,
} from '../../scripts/agent/supervise.mjs'

const STUB = resolve('tests/agent/fixtures/stub-launcher.mjs')
const CLI = resolve('scripts/agent/supervise.mjs')
const LAUNCHER = `node ${STUB}`
const FAST = {
  baseBackoffMs: 20,
  maxBackoffMs: 200,
  crashWindowMs: 60_000,
  crashLimit: 3,
  maxRestarts: 5,
  maxSessions: 12,
}
const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

let root = ''
let logPath = ''
const saved: Record<string, string | undefined> = {}

function setEnv(mode: string) {
  for (const [k, v] of Object.entries({
    STUB_MODE: mode,
    STUB_STATE: join(root, 'docs/agent/EXECUTION-STATE.json'),
    STUB_LOCK: join(root, '.out/agent/state.lock'),
    STUB_LOG: logPath,
  })) {
    saved[k] ??= process.env[k]
    process.env[k] = v
  }
}

function mission(requirements: Requirement[], deadline = FUTURE) {
  return {
    id: 'M-SUP',
    title: 'Supervisor test mission',
    status: 'active',
    startedAt: '2026-10-14T08:00:00.000Z',
    deadline,
    branch: 'claude/test',
    requirements,
    nextAction: 'continue with the first open requirement',
    lastCheckpoint: { at: '2026-10-14T08:00:00.000Z', commit: null, summary: 'start' },
  }
}

function writeLedger(m: unknown) {
  const path = join(root, 'docs/agent/EXECUTION-STATE.json')
  mkdirSync(join(root, 'docs/agent'), { recursive: true })
  writeFileSync(
    path,
    JSON.stringify({ ...emptyState(new Date('2026-10-14T08:00:00Z')), mission: m }, null, 2),
  )
}

function runs(): { pid: number; mode: string; prompt: string }[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

const quiet = () => undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'supervisor-'))
  logPath = join(root, 'stub.log')
})

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  for (const k of Object.keys(saved)) delete saved[k]
  rmSync(root, { recursive: true, force: true })
})

describe('the plan and its limits, decided without starting anything', () => {
  it('without --launch it prints the plan and starts no session', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    const result = await supervise({
      root,
      launch: false,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    expect(result.outcome).toBe('planned')
    expect(existsSync(logPath)).toBe(false)
    expect(readState(join(root, 'docs/agent/EXECUTION-STATE.json')).sessions).toEqual([])
  })

  it('the resume prompt is built from the ledger alone and names the work, the deadline and the next action', () => {
    const state = {
      ...emptyState(),
      mission: mission([
        { id: 'R1', title: 'Done thing', status: 'done' },
        { id: 'R2', title: 'Open thing', status: 'todo' },
        { id: 'R3', title: 'Owner thing', status: 'blocked' },
      ]),
    }
    const prompt = resumePrompt(state)
    expect(prompt).toContain('M-SUP')
    expect(prompt).toContain(FUTURE)
    expect(prompt).toContain('R2 Open thing')
    expect(prompt).not.toContain('R1 Done thing')
    expect(prompt).toContain('Waiting on Grant (do not stop for these): R3')
    expect(prompt).toContain('docs/agent/CURRENT-MISSION.md')
  })

  it('stop reasons follow the same order as the gate, and map to a status', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    const base = { ...emptyState(), mission: mission([{ id: 'R1', title: 'a', status: 'todo' }]) }
    const common = {
      now,
      restarts: 0,
      sessionsStarted: 0,
      recentFailures: 0,
      stopRequested: false,
      policy: POLICY,
    }
    expect(stopReason(base, common)).toBeNull()
    expect(stopReason(base, { ...common, stopRequested: true })).toMatch(/owner cancelled/)
    expect(stopReason(base, { ...common, sessionsStarted: POLICY.maxSessions })).toMatch(
      /session budget/,
    )
    expect(stopReason(base, { ...common, restarts: POLICY.maxRestarts })).toMatch(/restart budget/)
    expect(stopReason(base, { ...common, recentFailures: 3 })).toMatch(/crash loop/)
    expect(statusFor('owner cancelled (STOP file)')).toBe('cancelled')
    expect(statusFor('nothing actionable remains (blocked)')).toBe('blocked')
    expect(statusFor('nothing actionable remains (complete)')).toBe('complete')
    expect(statusFor('crash loop: 3 failures')).toBe('paused')
  })

  it('backoff doubles after each failure and is capped', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1, { ...POLICY, baseBackoffMs: 100, maxBackoffMs: 10_000 })).toBe(100)
    expect(backoffMs(2, { ...POLICY, baseBackoffMs: 100, maxBackoffMs: 10_000 })).toBe(200)
    expect(backoffMs(3, { ...POLICY, baseBackoffMs: 100, maxBackoffMs: 10_000 })).toBe(400)
    expect(backoffMs(30, { ...POLICY, baseBackoffMs: 100, maxBackoffMs: 10_000 })).toBe(10_000)
  })

  it('does not start a session on a branch the mission does not belong to', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    const state = {
      ...emptyState(),
      mission: { ...mission([{ id: 'R1', title: 'a', status: 'todo' }]), branch: 'claude/x' },
    }
    const why = stopReason(state, {
      now,
      restarts: 0,
      sessionsStarted: 0,
      recentFailures: 0,
      stopRequested: false,
      branch: 'main',
      policy: POLICY,
    })
    expect(why).toMatch(/belongs to branch claude\/x, this checkout is on main/)
    expect(
      stopReason(state, {
        now,
        restarts: 0,
        sessionsStarted: 0,
        recentFailures: 0,
        stopRequested: false,
        branch: 'claude/x',
        policy: POLICY,
      }),
    ).toBeNull()
  })

  it('splits a launcher command into arguments without a shell', () => {
    expect(splitCommand('claude -p')).toEqual(['claude', '-p'])
    expect(splitCommand('node "a b/x.mjs" --flag')).toEqual(['node', 'a b/x.mjs', '--flag'])
  })
})

describe('running a real child process', () => {
  it('resumes after each ordinary end until nothing actionable remains, then stops as complete', async () => {
    writeLedger(
      mission([
        { id: 'R1', title: 'first', status: 'todo' },
        { id: 'R2', title: 'second', status: 'todo' },
        { id: 'R3', title: 'third', status: 'todo' },
      ]),
    )
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(result.outcome).toBe('complete')
    expect(final.mission.requirements?.every((r) => r.status === 'done')).toBe(true)
    expect(final.sessions).toHaveLength(3)
    expect(final.sessions.map((s) => s.terminationReason)).toEqual(['exit 0', 'exit 0', 'exit 0'])
    // Each later session is linked to the one before it, so the chain of work can be read back.
    expect(final.sessions[1]?.parent).toBe(final.sessions[0]?.id)
    expect(final.sessions[2]?.parent).toBe(final.sessions[1]?.id)
  })

  it('sends the next session only the work that is still open, so a finished item is not repeated', async () => {
    writeLedger(
      mission([
        { id: 'R1', title: 'first', status: 'todo' },
        { id: 'R2', title: 'second', status: 'todo' },
      ]),
    )
    setEnv('checkpoint')
    await supervise({ root, launch: true, launcher: LAUNCHER, policy: FAST, log: quiet })
    const sent = runs()
    expect(sent).toHaveLength(2)
    expect(sent[0]?.prompt).toContain('  - R1 first')
    expect(sent[1]?.prompt).not.toContain('  - R1 first')
    expect(sent[1]?.prompt).toContain('  - R2 second')
  })

  it('a session that completes the mission is recorded, and the supervisor stops without another start', async () => {
    writeLedger(mission([{ id: 'R1', title: 'only', status: 'todo' }]))
    setEnv('complete')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(result.reason).toMatch(/mission complete after session/)
    expect(final.sessions).toHaveLength(1)
    expect(runs()).toHaveLength(1)
  })

  it('a crashing session is restarted with growing backoff, then the run stops as a crash loop instead of retrying for ever', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    setEnv('crash')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(result.reason).toMatch(/crash loop: 3 failures/)
    expect(final.mission.status).toBe('paused')
    expect(final.sessions.map((s) => s.terminationReason)).toEqual(['exit 1', 'exit 1', 'exit 1'])
    const starts = final.sessions.map((s) => Date.parse(s.startedAt ?? ''))
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0))
    expect(gaps).toHaveLength(2)
    expect(gaps[1]).toBeGreaterThanOrEqual(gaps[0] ?? 0)
  })

  it('stops at the restart budget and pauses the mission, rather than starting a session it is not allowed to', async () => {
    writeLedger(
      mission([
        { id: 'R1', title: 'a', status: 'todo' },
        { id: 'R2', title: 'b', status: 'todo' },
        { id: 'R3', title: 'c', status: 'todo' },
      ]),
    )
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: { ...FAST, maxRestarts: 1 },
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(result.reason).toMatch(/restart budget/)
    expect(final.mission.status).toBe('paused')
    expect(final.sessions).toHaveLength(1)
  })

  it('stops at the session budget and pauses the mission', async () => {
    writeLedger(
      mission([
        { id: 'R1', title: 'a', status: 'todo' },
        { id: 'R2', title: 'b', status: 'todo' },
        { id: 'R3', title: 'c', status: 'todo' },
      ]),
    )
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: { ...FAST, maxSessions: 2 },
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(result.reason).toMatch(/session budget/)
    expect(final.sessions).toHaveLength(2)
  })

  it('does not start a session past the authorised deadline', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }], PAST))
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    expect(result.reason).toBe('authorised deadline reached')
    expect(runs()).toHaveLength(0)
    expect(readState(join(root, 'docs/agent/EXECUTION-STATE.json')).mission.status).toBe('expired')
  })

  it('does not start a session when the owner has cancelled with a STOP file', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    mkdirSync(join(root, 'docs/agent'), { recursive: true })
    writeFileSync(join(root, 'docs/agent/STOP'), 'stop')
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    expect(result.reason).toMatch(/owner cancelled/)
    expect(runs()).toHaveLength(0)
  })

  it('does not start a session when only owner-blocked work remains', async () => {
    writeLedger(mission([{ id: 'R1', title: 'needs credential', status: 'blocked' }]))
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    expect(result.reason).toBe('nothing actionable remains (blocked)')
    expect(runs()).toHaveLength(0)
    expect(readState(join(root, 'docs/agent/EXECUTION-STATE.json')).mission.status).toBe('blocked')
  })
})

describe('more than one supervisor, and interruption, as real processes', () => {
  function startCli(mode: string, extraEnv: Record<string, string> = {}) {
    const child = spawn(
      process.execPath,
      [CLI, '--launch', '--root', root, '--launcher', LAUNCHER],
      {
        env: {
          ...process.env,
          STUB_MODE: mode,
          STUB_STATE: join(root, 'docs/agent/EXECUTION-STATE.json'),
          STUB_LOCK: join(root, '.out/agent/state.lock'),
          STUB_LOG: logPath,
          ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    const done = new Promise<{
      code: number | null
      signal: NodeJS.Signals | null
      stdout: string
    }>((r) => child.on('exit', (code, signal) => r({ code, signal, stdout })))
    return { child, done, result: () => stdout }
  }

  async function waitFor(predicate: () => boolean, ms = 15_000) {
    const until = Date.now() + ms
    while (!predicate()) {
      if (Date.now() > until) throw new Error('timed out waiting for the stub')
      await new Promise((r) => setTimeout(r, 25))
    }
  }

  it('refuses a second supervisor on the same checkout while the first is running', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    const first = startCli('hang')
    await waitFor(() => runs().length >= 1)
    const second = startCli('hang')
    const outcome = await second.done
    expect(outcome.code).toBe(3)
    expect(JSON.parse(outcome.stdout.trim()).outcome).toBe('duplicate')
    first.child.kill('SIGKILL')
    await first.done
  }, 30_000)

  it('a SIGTERM stops the running session, records the pause, and leaves the mission resumable', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    const run = startCli('hang')
    await waitFor(() => runs().length >= 1)
    run.child.kill('SIGTERM')
    const outcome = await run.done
    expect(outcome.code).toBe(0)
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(final.mission.status).toBe('paused')
    expect(final.mission.endedReason).toMatch(/signal SIGTERM/)
    expect(final.sessions[0]?.terminationReason).toBe('signal SIGTERM')
    expect(final.sessions[0]?.resumeEligible).toBe(true)
    // The lock is released, so the next supervisor is not refused.
    expect(existsSync(join(root, '.out/agent/supervisor.lock'))).toBe(false)
  }, 30_000)

  it('after an interruption, a new supervisor resumes the same mission and links its session to the interrupted one', async () => {
    writeLedger(
      mission([
        { id: 'R1', title: 'first', status: 'todo' },
        { id: 'R2', title: 'second', status: 'todo' },
      ]),
    )
    const interrupted = startCli('hang')
    await waitFor(() => runs().length >= 1)
    interrupted.child.kill('SIGTERM')
    await interrupted.done
    const interruptedSession = readState(join(root, 'docs/agent/EXECUTION-STATE.json')).sessions[0]
      ?.id
    // The pause is the state of an interrupted run, not a stop. A resumed run must pick it up.
    const paused = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    paused.mission.status = 'active'
    writeFileSync(join(root, 'docs/agent/EXECUTION-STATE.json'), JSON.stringify(paused, null, 2))
    setEnv('checkpoint')
    const resumed = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    const final = readState(join(root, 'docs/agent/EXECUTION-STATE.json'))
    expect(resumed.outcome).toBe('complete')
    expect(final.sessions[1]?.parent).toBe(interruptedSession)
    expect(final.sessions.length).toBeGreaterThan(2)
  }, 30_000)

  it('a stale supervisor lock from a dead process is taken over and the run proceeds', async () => {
    writeLedger(mission([{ id: 'R1', title: 'a', status: 'todo' }]))
    mkdirSync(join(root, '.out/agent'), { recursive: true })
    writeFileSync(
      join(root, '.out/agent/supervisor.lock'),
      JSON.stringify({ pid: 2147483646, at: new Date().toISOString() }),
    )
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      log: quiet,
    })
    expect(result.outcome).toBe('complete')
  })
})
