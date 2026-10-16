/**
 * The stop gate's rules, and the real hook process that applies them (P0 continuity, R4 and R6).
 * Every case is a situation a session can actually be in when it tries to end.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyDecision, classify, decide } from '../../scripts/agent/lib/gate.mjs'
import type { Requirement } from '../../scripts/agent/lib/state.d.mts'
import { emptyState } from '../../scripts/agent/lib/state.mjs'

const GATE = resolve('scripts/agent/stop-gate.mjs')
const NOW = new Date('2026-10-14T10:00:00.000Z')
const LATER = '2026-10-14T16:00:00.000Z'

function mission(overrides: Record<string, unknown> = {}, requirements: Requirement[] = []) {
  return {
    id: 'M-TEST',
    title: 'Test mission',
    status: 'active',
    deadline: LATER,
    branch: 'b',
    requirements,
    nextAction: 'do R2',
    ...overrides,
  }
}

function stateWith(m: unknown, extra: Record<string, unknown> = {}) {
  return { ...emptyState(NOW), mission: m, ...extra } as ReturnType<typeof emptyState> & {
    mission: unknown
  }
}

const input = { session_id: 'sess-1', stop_hook_active: false }

describe('the stop decision', () => {
  it('lets a session end when there is no mission at all', () => {
    const d = decide(stateWith(null), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.reason).toBe('no active mission')
  })

  it('lets a session end when the mission is already complete, so an old record does not hold a new session', () => {
    const d = decide(
      stateWith(mission({ status: 'complete' }, [{ id: 'R1', title: 'x', status: 'todo' }])),
      input,
      { now: NOW, stopRequested: false },
    )
    expect(d.action).toBe('allow')
  })

  it('holds the session open while work remains, and names what remains and what to do next', () => {
    const m = mission({}, [
      { id: 'R1', title: 'Finished feature', status: 'done' },
      { id: 'R2', title: 'Other feature', status: 'todo', issue: '#999' },
    ])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('block')
    expect(d.reason).toContain('R2 Other feature (#999)')
    expect(d.reason).not.toContain('R1 Finished feature')
    expect(d.reason).toContain('Next action: do R2')
  })

  it('does not hold the session for a requirement waiting on the owner, and says so', () => {
    const m = mission({}, [
      { id: 'R1', title: 'Blocked on a credential', status: 'blocked' },
      { id: 'R2', title: 'Independent work', status: 'todo' },
    ])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('block')
    expect(d.reason).toContain('Waiting on the owner')
    expect(d.reason).toContain('R1 Blocked on a credential')
  })

  it('lets the session end, and records the mission as blocked, when only owner-blocked work is left', () => {
    const m = mission({}, [{ id: 'R1', title: 'Needs approval', status: 'blocked' }])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('blocked')
  })

  it('lets the session end, and records the mission as complete, when every requirement is done', () => {
    const m = mission({}, [
      { id: 'R1', title: 'a', status: 'done' },
      { id: 'R2', title: 'b', status: 'done' },
    ])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('complete')
  })

  it('lets the session end at the authorised deadline, and records the mission as expired', () => {
    const m = mission({ deadline: '2026-10-14T09:00:00.000Z' }, [
      { id: 'R1', title: 'a', status: 'todo' },
    ])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('expired')
  })

  it('lets the session end when the owner has cancelled with a STOP file, and records the cancellation', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'todo' }])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: true })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('cancelled')
  })

  it('does not hold a session open on a mission with no valid deadline; it pauses the mission instead', () => {
    const m = mission({ deadline: 'not a date' }, [{ id: 'R1', title: 'a', status: 'todo' }])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('paused')
  })

  it('stops a loop: after the per-session limit, a repeat continuation is allowed through', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'todo' }])
    const state = stateWith(m, {
      stopGate: { blocksTotal: 25, lastBlockAt: null, blocksBySession: { 'sess-1': 25 } },
    })
    const d = decide(
      state,
      { session_id: 'sess-1', stop_hook_active: true },
      { now: NOW, stopRequested: false },
    )
    expect(d.action).toBe('allow')
    expect(d.reason).toContain('loop guard')
    // The mission stays active: a loop guard is not a finish, and the next session resumes the work.
    expect(d.nextStatus).toBeNull()
  })

  it('still holds a first continuation even when stop_hook_active is set, below the loop limit', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'todo' }])
    const d = decide(
      stateWith(m),
      { session_id: 'sess-1', stop_hook_active: true },
      { now: NOW, stopRequested: false },
    )
    expect(d.action).toBe('block')
  })

  it('pauses the mission when its whole block budget is spent', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'todo' }])
    const state = stateWith(m, {
      stopGate: { blocksTotal: 500, lastBlockAt: null, blocksBySession: {} },
    })
    const d = decide(state, input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('allow')
    expect(d.nextStatus).toBe('paused')
  })

  it('counts open and blocked requirements separately, and ignores done ones', () => {
    const m = mission({}, [
      { id: 'R1', title: 'a', status: 'done' },
      { id: 'R2', title: 'b', status: 'in_progress' },
      { id: 'R3', title: 'c', status: 'blocked' },
    ])
    expect(classify(m).actionable.map((r) => r.id)).toEqual(['R2'])
    expect(classify(m).blocked.map((r) => r.id)).toEqual(['R3'])
  })
})

describe('a mission belongs to its own branch', () => {
  it('does not hold a session on another branch, so a merged ledger leaves other branches alone', () => {
    const m = mission({ branch: 'claude/continuity-repair-2026-10-14' }, [
      { id: 'R1', title: 'a', status: 'todo' },
    ])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false, branch: 'main' })
    expect(d.action).toBe('allow')
    expect(d.reason).toContain(
      'belongs to branch claude/continuity-repair-2026-10-14, this is main',
    )
    expect(d.nextStatus).toBeNull()
  })

  it('holds the session on the branch the mission was written on', () => {
    const m = mission({ branch: 'claude/continuity-repair-2026-10-14' }, [
      { id: 'R1', title: 'a', status: 'todo' },
    ])
    const d = decide(stateWith(m), input, {
      now: NOW,
      stopRequested: false,
      branch: 'claude/continuity-repair-2026-10-14',
    })
    expect(d.action).toBe('block')
  })

  it('applies the rules when git cannot name the branch, rather than guessing', () => {
    const m = mission({ branch: 'claude/x' }, [{ id: 'R1', title: 'a', status: 'todo' }])
    const d = decide(stateWith(m), input, { now: NOW, stopRequested: false })
    expect(d.action).toBe('block')
  })

  it('the hook process respects a real git checkout on another branch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-branch-'))
    try {
      spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
      mkdirSync(join(dir, 'docs/agent'), { recursive: true })
      const state = {
        ...emptyState(NOW),
        mission: mission({ branch: 'claude/other' }, [{ id: 'R1', title: 'a', status: 'todo' }]),
      }
      writeFileSync(join(dir, 'docs/agent/EXECUTION-STATE.json'), JSON.stringify(state))
      const result = spawnSync(process.execPath, [GATE], {
        input: JSON.stringify({ session_id: 'branch-proc' }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('belongs to branch claude/other, this is main')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('recording a decision', () => {
  it('counts each held stop against the session and the mission, and leaves the status alone', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'todo' }])
    const state = stateWith(m)
    const d = decide(state, input, { now: NOW, stopRequested: false })
    const next = applyDecision(state, input, d, NOW)
    expect(next.stopGate.blocksTotal).toBe(1)
    expect(next.stopGate.blocksBySession['sess-1']).toBe(1)
    expect(next.mission.status).toBe('active')
  })

  it('writes the status an allowed stop implies, with the reason, and does not touch the counters', () => {
    const m = mission({}, [{ id: 'R1', title: 'a', status: 'done' }])
    const state = stateWith(m)
    const d = decide(state, input, { now: NOW, stopRequested: false })
    const next = applyDecision(state, input, d, NOW)
    expect(next.mission.status).toBe('complete')
    expect(next.mission.endedReason).toContain('nothing actionable')
    expect(next.stopGate.blocksTotal).toBe(0)
  })
})

describe('the hook process', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  function project(state: unknown, raw?: string) {
    root = mkdtempSync(join(tmpdir(), 'stop-gate-'))
    mkdirSync(join(root, 'docs/agent'), { recursive: true })
    writeFileSync(
      join(root, 'docs/agent/EXECUTION-STATE.json'),
      raw ?? JSON.stringify(state, null, 2),
    )
    return root
  }

  function run(dir: string, stdin: string) {
    return spawnSync(process.execPath, [GATE], {
      input: stdin,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: 'utf8',
    })
  }

  it('prints a block decision on stdout for a real session that has work left', () => {
    const dir = project({
      ...emptyState(NOW),
      mission: mission({}, [{ id: 'R1', title: 'Keep going', status: 'todo' }]),
    })
    const result = run(dir, JSON.stringify({ session_id: 'proc-1', stop_hook_active: false }))
    expect(result.status).toBe(0)
    const out = JSON.parse(result.stdout) as { decision: string; reason: string }
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('R1 Keep going')
  })

  it('records the block in the ledger, so the count survives the process', () => {
    const dir = project({
      ...emptyState(NOW),
      mission: mission({}, [{ id: 'R1', title: 'a', status: 'todo' }]),
    })
    run(dir, JSON.stringify({ session_id: 'proc-2' }))
    const recorded = JSON.parse(readFileSync(join(dir, 'docs/agent/EXECUTION-STATE.json'), 'utf8'))
    expect(recorded.stopGate.blocksBySession['proc-2']).toBe(1)
    expect(recorded.revision).toBe(1)
  })

  it('lets the session end silently when the work is finished', () => {
    const dir = project({
      ...emptyState(NOW),
      mission: mission({}, [{ id: 'R1', title: 'a', status: 'done' }]),
    })
    const result = run(dir, JSON.stringify({ session_id: 'proc-3' }))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })

  it('fails open on a corrupt ledger: it lets the session end and says why, and never replaces the file', () => {
    const dir = project(null, '{ this is not json')
    const result = run(dir, JSON.stringify({ session_id: 'proc-4' }))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('failed open')
    expect(readFileSync(join(dir, 'docs/agent/EXECUTION-STATE.json'), 'utf8')).toBe(
      '{ this is not json',
    )
  })

  it('fails open on unreadable hook input and still applies the rules to the ledger', () => {
    const dir = project({
      ...emptyState(NOW),
      mission: mission({}, [{ id: 'R1', title: 'a', status: 'todo' }]),
    })
    const result = run(dir, 'not json at all')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).decision).toBe('block')
  })

  it('a STOP file in the repository ends the run through the real process', () => {
    const dir = project({
      ...emptyState(NOW),
      mission: mission({}, [{ id: 'R1', title: 'a', status: 'todo' }]),
    })
    writeFileSync(join(dir, 'docs/agent/STOP'), 'stop')
    const result = run(dir, JSON.stringify({ session_id: 'proc-5' }))
    expect(result.stdout).toBe('')
    const recorded = JSON.parse(readFileSync(join(dir, 'docs/agent/EXECUTION-STATE.json'), 'utf8'))
    expect(recorded.mission.status).toBe('cancelled')
  })

  it('the committed ledger has the shape the gate reads, whatever its current status', () => {
    const committed = JSON.parse(readFileSync('docs/agent/EXECUTION-STATE.json', 'utf8'))
    expect(committed.schema).toBe(1)
    expect(committed.mission.id).toEqual(expect.any(String))
    expect(committed.mission.requirements.length).toBeGreaterThan(0)
    for (const r of committed.mission.requirements) {
      expect(['todo', 'in_progress', 'blocked', 'done']).toContain(r.status)
    }
  })
})
