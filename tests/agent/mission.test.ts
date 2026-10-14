/**
 * The owner's mission controls, run as the real command (P0 R8). Each case is a decision the owner makes by hand.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyState } from '../../scripts/agent/lib/state.mjs'

const CLI = resolve('scripts/agent/mission.mjs')
const FUTURE = '2099-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'
let root = ''

function ledger(status: string, deadline = FUTURE) {
  const state = {
    ...emptyState(new Date('2026-10-14T08:00:00Z')),
    revision: 4,
    mission: {
      id: 'M-CTL',
      title: 'Control test',
      status,
      deadline,
      branch: 'claude/test',
      nextAction: 'do the next thing',
      requirements: [
        { id: 'R1', title: 'finished', status: 'done' },
        { id: 'R2', title: 'open', status: 'todo', issue: '#1' },
        { id: 'R3', title: 'owner', status: 'blocked' },
      ],
    },
    sessions: [
      {
        id: 's-1',
        startedAt: '2026-10-14T08:00:00Z',
        endedAt: '2026-10-14T08:10:00Z',
        terminationReason: 'exit 0',
      },
    ],
  }
  mkdirSync(join(root, 'docs/agent'), { recursive: true })
  writeFileSync(join(root, 'docs/agent/EXECUTION-STATE.json'), JSON.stringify(state, null, 2))
}

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mission-cli-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the owner controls', () => {
  it('status says what is done, what remains, what waits on the owner, and the last session', () => {
    ledger('active')
    const r = cli('status')
    expect(r.code).toBe(0)
    expect(r.out).toContain('M-CTL: Control test')
    expect(r.out).toContain('done 1; still to do 1; waiting on owner 1')
    expect(r.out).toContain('R2 open (#1)')
    expect(r.out).toContain('next action: do the next thing')
    expect(r.out).toContain('s-1 started 2026-10-14T08:00:00Z')
  })

  it('status reports that nothing is recorded, rather than failing, when there is no mission', () => {
    const r = cli('status')
    expect(r.code).toBe(0)
    expect(r.out).toContain('No mission is recorded')
  })

  it('stop creates the STOP file once, and a second stop says so instead of failing', () => {
    ledger('active')
    expect(cli('stop').code).toBe(0)
    expect(existsSync(join(root, 'docs/agent/STOP'))).toBe(true)
    const again = cli('stop')
    expect(again.code).toBe(0)
    expect(again.out).toContain('already stopped')
  })

  it('resume refuses while the STOP file exists, so a stop cannot be undone by accident', () => {
    ledger('paused')
    cli('stop')
    const r = cli('resume')
    expect(r.code).toBe(2)
    expect(r.out).toContain('refused')
    expect(
      JSON.parse(readFileSync(join(root, 'docs/agent/EXECUTION-STATE.json'), 'utf8')).mission
        .status,
    ).toBe('paused')
  })

  it('resume makes a paused mission active again, and advances the revision', () => {
    ledger('paused')
    const r = cli('resume')
    expect(r.code).toBe(0)
    const after = JSON.parse(readFileSync(join(root, 'docs/agent/EXECUTION-STATE.json'), 'utf8'))
    expect(after.mission.status).toBe('active')
    expect(after.revision).toBe(5)
  })

  it('resume refuses past the authorised deadline, and says what to do instead', () => {
    ledger('paused', PAST)
    const r = cli('resume')
    expect(r.code).toBe(2)
    expect(r.out).toContain('deadline')
    expect(r.out).toContain('Record a new authorised deadline')
  })

  it('resume refuses a complete mission, because a finished mission is not reopened by a command', () => {
    ledger('complete')
    const r = cli('resume')
    expect(r.code).toBe(2)
    expect(r.out).toContain('not resumable')
  })

  it('an unknown command prints the usage and fails', () => {
    const r = cli('frobnicate')
    expect(r.code).toBe(2)
    expect(r.out).toContain('usage')
  })
})
