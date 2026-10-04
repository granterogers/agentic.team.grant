import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import type { Job, NotifyOutcome } from '../../src/jobs/worker.ts'
import { installAwareSlackChannel, type SlackChannelLike } from '../../src/slack/installs.ts'

const JOB = { jobId: '11111111-1111-4111-8111-111111111111' } as unknown as Job
const TOKEN_A = 'xoxb-1111111111-installTokenAAAAAA'
const TOKEN_A2 = 'xoxb-1111111111-installTokenRotated'
const DEPLOYMENT_TOKEN = 'xoxb-9999999999-deploymentTokenXX'

type Row = { operator: boolean; team_id: string | null; token: string | null }
const world = (row: Row | (() => Row) | Error) => {
  const sql: string[] = []
  const db = {
    execute: async (q: string) => {
      sql.push(q)
      if (row instanceof Error) throw row
      return { rows: [typeof row === 'function' ? row() : row] }
    },
  } as unknown as SqlExecutor
  const made: { teamId: string; token: string }[] = []
  const calls: string[] = []
  const channelFor = (label: string): SlackChannelLike => ({
    name: 'slack',
    notify: async (): Promise<NotifyOutcome> => {
      calls.push(label)
      return { delivered: true, note: `delivered by ${label}` }
    },
  })
  const deployment = channelFor('deployment')
  const channel = installAwareSlackChannel({
    db,
    deployment,
    make: (i) => {
      made.push(i)
      return channelFor(`install:${i.teamId}`)
    },
  })
  const notify = (): Promise<NotifyOutcome> => channel.notify(JOB, {} as never, 'o', {} as never)
  return { sql, made, calls, notify, channel }
}

describe('answering in a person’s own Slack workspace', () => {
  it('an office with an active install is served by THAT install’s token and workspace, never the deployment’s', async () => {
    const w = world({ operator: false, team_id: 'T0AAAAAAA1', token: TOKEN_A })
    const r = await w.notify()
    expect(r.delivered).toBe(true)
    expect(w.made).toEqual([{ teamId: 'T0AAAAAAA1', token: TOKEN_A }])
    expect(w.calls).toEqual(['install:T0AAAAAAA1'])
  })

  it('the operator’s own office (no install) is served by the deployment’s channel', async () => {
    const w = world({ operator: true, team_id: null, token: null })
    expect((await w.notify()).delivered).toBe(true)
    expect(w.calls).toEqual(['deployment'])
    expect(w.made).toEqual([])
  })

  it('a personal office with NO install is never served: it cannot borrow the operator’s workspace', async () => {
    const w = world({ operator: false, team_id: null, token: null })
    const r = await w.notify()
    expect(r.delivered).toBe(false)
    expect(r.note).toMatch(/no Slack workspace connected/)
    expect(w.calls).toEqual([])
    expect(w.made).toEqual([])
  })

  it('an install whose token cannot be read delivers nothing and does NOT fall back to the deployment', async () => {
    for (const operator of [false, true]) {
      const w = world({ operator, team_id: 'T0AAAAAAA1', token: null })
      const r = await w.notify()
      expect(r.delivered).toBe(false)
      expect(r.note).toMatch(/cannot be read/)
      expect(w.calls).toEqual([])
    }
  })

  it('not being able to ask which office this is delivers nothing (a guess is not a token)', async () => {
    const w = world(new Error('the database is unavailable'))
    const r = await w.notify()
    expect(r.delivered).toBe(false)
    expect(w.calls).toEqual([])
    expect(w.made).toEqual([])
  })

  it('a client is built once per workspace, and a rotated token is a new one (a stale token is never reused)', async () => {
    let current: Row = { operator: false, team_id: 'T0AAAAAAA1', token: TOKEN_A }
    const w = world(() => current)
    await w.notify()
    await w.notify()
    expect(w.made).toHaveLength(1)
    current = { operator: false, team_id: 'T0AAAAAAA1', token: TOKEN_A2 }
    await w.notify()
    expect(w.made.map((m) => m.token)).toEqual([TOKEN_A, TOKEN_A2])
  })

  it('the office is resolved in SQL from the claimed job: the query names the job and no office literal', async () => {
    const w = world({ operator: false, team_id: 'T0AAAAAAA1', token: TOKEN_A })
    await w.notify()
    const q = w.sql[0] ?? ''
    expect(q).toContain(`app.job_office('${JOB.jobId}'::uuid)`)
    expect(q).not.toMatch(/office_id\s*=\s*'[0-9a-f-]{36}'/i)
    expect(q).toContain("i.state = 'active'")
  })

  it('no token appears in any note, whichever way it ends', async () => {
    const notes: string[] = []
    for (const row of [
      { operator: false, team_id: null, token: null },
      { operator: false, team_id: 'T0AAAAAAA1', token: null },
    ] as Row[])
      notes.push((await world(row).notify()).note ?? '')
    notes.push((await world(new Error(`failed with ${TOKEN_A}`)).notify()).note ?? '')
    for (const n of notes) {
      expect(n).not.toContain(TOKEN_A)
      expect(n).not.toContain('xoxb-')
    }
  })

  it('CONTROL: the deployment’s token is never what an install’s channel is built with', async () => {
    const w = world({ operator: false, team_id: 'T0AAAAAAA1', token: TOKEN_A })
    await w.notify()
    expect(w.made.some((m) => m.token === DEPLOYMENT_TOKEN)).toBe(false)
  })
})
