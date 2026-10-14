/**
 * The safeguards a live trial relies on, each proved against a real child process (stub launcher, no model call):
 * the wall-clock and deadline watchdogs, STOP during a session, escalation to SIGKILL, spend limits, the mission
 * identity guard, session ids, per-launch instructions, and cleanup. These run before any paid session is started.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyState, readState } from '../../scripts/agent/lib/state.mjs'
import { abortFor, costFromResult, supervise } from '../../scripts/agent/supervise.mjs'

const STUB = resolve('tests/agent/fixtures/stub-launcher.mjs')
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
const LEDGER = () => join(root, 'docs/agent/EXECUTION-STATE.json')

let root = ''
let logPath = ''
const saved: Record<string, string | undefined> = {}

function setEnv(mode: string) {
  for (const [k, v] of Object.entries({
    STUB_MODE: mode,
    STUB_STATE: LEDGER(),
    STUB_LOCK: join(root, '.out/agent/state.lock'),
    STUB_LOG: logPath,
  })) {
    saved[k] ??= process.env[k]
    process.env[k] = v
  }
}

function writeLedger(
  id: string,
  requirements: { id: string; title: string; status: string }[],
  deadline = FUTURE,
) {
  mkdirSync(join(root, 'docs/agent'), { recursive: true })
  const state = {
    ...emptyState(new Date('2026-10-14T08:00:00Z')),
    mission: {
      id,
      title: 'Safeguard test',
      status: 'active',
      deadline,
      branch: 'claude/test',
      requirements,
      nextAction: 'continue',
      lastCheckpoint: { at: '2026-10-14T08:00:00.000Z', commit: null, summary: 'start' },
    },
  }
  writeFileSync(LEDGER(), JSON.stringify(state, null, 2))
}

function runs(): { pid: number; mode: string; prompt: string; argv: string[] }[] {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, ms = 15_000) {
  const until = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > until) throw new Error('timed out waiting for the stub')
    await new Promise((r) => setTimeout(r, 25))
  }
}

const quiet = () => undefined
const three = [
  { id: 'R1', title: 'first', status: 'todo' },
  { id: 'R2', title: 'second', status: 'todo' },
  { id: 'R3', title: 'third', status: 'todo' },
]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'safeguards-'))
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

describe('the watchdogs end a running session', () => {
  it('the wall-clock limit stops a session that is still running, kills it, and does not restart it', async () => {
    writeLedger('M-SAFE', three)
    setEnv('hang')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      maxWallClockMs: 700,
      log: quiet,
    })
    expect(result.reason).toBe('wall-clock limit reached during a session')
    expect(result.outcome).toBe('paused')
    const pid = runs()[0]?.pid
    expect(pid).toBeDefined()
    expect(alive(pid ?? 0)).toBe(false)
    const final = readState(LEDGER())
    expect(final.sessions).toHaveLength(1)
    expect(final.sessions[0]?.terminationReason).toBe('signal SIGTERM')
  }, 20_000)

  it('the mission deadline stops a running session, marks the mission expired, and starts no further session', async () => {
    const deadline = new Date(Date.now() + 1_200).toISOString()
    writeLedger('M-SAFE', three, deadline)
    setEnv('hang')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      log: quiet,
    })
    expect(result.reason).toBe('authorised deadline reached during a session')
    expect(readState(LEDGER()).mission.status).toBe('expired')
    expect(runs()).toHaveLength(1)
    expect(alive(runs()[0]?.pid ?? 0)).toBe(false)
  }, 20_000)

  it('a STOP file created during a session ends it, and no restart follows', async () => {
    writeLedger('M-SAFE', three)
    setEnv('hang')
    const pending = supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      log: quiet,
    })
    await waitFor(() => runs().length >= 1)
    mkdirSync(join(root, 'docs/agent'), { recursive: true })
    writeFileSync(join(root, 'docs/agent/STOP'), 'stop')
    const result = await pending
    expect(result.reason).toBe('owner cancelled (STOP file) during a session')
    expect(readState(LEDGER()).mission.status).toBe('cancelled')
    expect(runs()).toHaveLength(1)
  }, 20_000)

  it('a child that ignores the polite signal is killed with SIGKILL after the grace period', async () => {
    writeLedger('M-SAFE', three)
    setEnv('stubborn')
    const started = Date.now()
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      maxWallClockMs: 400,
      killGraceMs: 300,
      log: quiet,
    })
    expect(result.reason).toBe('wall-clock limit reached during a session')
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(alive(runs()[0]?.pid ?? 0)).toBe(false)
  }, 20_000)

  it('abortFor decides the reason without touching a process, and names the status it leaves', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    const state = {
      ...emptyState(),
      mission: { id: 'x', status: 'active', deadline: '2026-10-14T09:00:00Z', requirements: [] },
    }
    expect(
      abortFor(state as never, {
        now,
        stopRequested: false,
        startedAt: now.getTime(),
        maxWallClockMs: null,
      })?.status,
    ).toBe('expired')
    expect(
      abortFor(null, { now, stopRequested: true, startedAt: now.getTime(), maxWallClockMs: null })
        ?.status,
    ).toBe('cancelled')
    expect(
      abortFor(null, {
        now,
        stopRequested: false,
        startedAt: now.getTime() - 5_000,
        maxWallClockMs: 1_000,
      })?.status,
    ).toBe('paused')
    expect(
      abortFor(null, {
        now,
        stopRequested: false,
        startedAt: now.getTime(),
        maxWallClockMs: 1_000,
      }),
    ).toBeNull()
  })
})

describe('spend is bounded, and a cost that cannot be read is counted at its cap', () => {
  it('reads the cost from the session result and stops before a second session would exceed the total', async () => {
    writeLedger('M-SAFE', three)
    setEnv('costly')
    const captureDir = join(root, '.out/trial')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      budget: { totalUsd: 0.5, perSessionUsd: 0.3 },
      captureDir,
      log: quiet,
    })
    expect(result.reason).toMatch(/^budget: a further session could exceed the 0.5 USD limit/)
    expect(result.spentUsd).toBe(0.3)
    const final = readState(LEDGER())
    expect(final.sessions).toHaveLength(1)
    expect(final.sessions[0]?.costUsd).toBe(0.3)
    expect(existsSync(join(captureDir, 'session-1.json'))).toBe(true)
  }, 20_000)

  it('counts a session with no readable cost at the full per-session cap, so the total can never be exceeded', async () => {
    writeLedger('M-SAFE', three)
    setEnv('checkpoint')
    const captureDir = join(root, '.out/trial')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      budget: { totalUsd: 0.5, perSessionUsd: 0.3 },
      captureDir,
      log: quiet,
    })
    expect(result.reason).toMatch(/^budget/)
    expect(result.spentUsd).toBe(0.3)
    expect(runs()).toHaveLength(1)
    expect(readState(LEDGER()).sessions[0]?.costUsd).toBe(0.3)
  })

  it('reads the cost and the session id out of the JSON result, and refuses malformed output without throwing', () => {
    expect(
      costFromResult(
        '{"type":"result","total_cost_usd":0.12,"session_id":"abc","subtype":"success","is_error":false}',
      ),
    ).toEqual({
      costUsd: 0.12,
      claudeSessionId: 'abc',
      subtype: 'success',
      isError: false,
    })
    expect(costFromResult('{"type":"result"}')?.costUsd).toBeNull()
    expect(costFromResult('not json at all')).toBeNull()
  })
})

describe('the run is tied to one mission', () => {
  it('refuses a ledger that holds a different mission, and writes nothing to it', async () => {
    writeLedger('SOME-OTHER-MISSION', three)
    const before = readState(LEDGER())
    setEnv('checkpoint')
    const result = await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      expectMission: 'M-SAFE',
      log: quiet,
    })
    expect(result.outcome).toBe('refused')
    expect(result.reason).toMatch(/holds mission SOME-OTHER-MISSION, not the expected M-SAFE/)
    const after = readState(LEDGER())
    expect(after.revision).toBe(before.revision)
    expect(after.sessions).toEqual([])
    expect(runs()).toHaveLength(0)
  })
})

describe('session identity and per-launch instructions', () => {
  it('passes the session id to the launch, and the ledger records the same id', async () => {
    writeLedger('M-SAFE', [{ id: 'R1', title: 'only', status: 'todo' }])
    setEnv('complete')
    await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: FAST,
      pollMs: 50,
      sessionIds: true,
      log: quiet,
    })
    const recorded = readState(LEDGER()).sessions[0]?.id
    const sent = runs()[0]?.argv ?? []
    expect(sent.slice(0, 2)).toEqual(['--session-id', recorded])
  })

  it('gives each launch its own instruction, reusing the last for later launches', async () => {
    writeLedger('M-SAFE', three)
    setEnv('checkpoint')
    await supervise({
      root,
      launch: true,
      launcher: LAUNCHER,
      policy: { ...FAST, maxSessions: 3 },
      pollMs: 50,
      sessionInstructions: ['FIRST-LAUNCH-ONLY-ONE-REQUIREMENT', 'LATER-LAUNCHES-ALL-REST'],
      log: quiet,
    })
    const sent = runs()
    expect(sent).toHaveLength(3)
    expect(sent[0]?.prompt).toContain('FIRST-LAUNCH-ONLY-ONE-REQUIREMENT')
    expect(sent[1]?.prompt).toContain('LATER-LAUNCHES-ALL-REST')
    expect(sent[2]?.prompt).toContain('LATER-LAUNCHES-ALL-REST')
    expect(sent[1]?.prompt).not.toContain('FIRST-LAUNCH-ONLY-ONE-REQUIREMENT')
  }, 20_000)
})
