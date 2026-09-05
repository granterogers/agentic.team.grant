/**
 * Naming a room, and what to do when the name is already taken.
 *
 * The adoption rule is the one that matters: `name_taken` might be our own
 * lost create, or it might be a channel a human made about something else. The
 * test that a stranger's channel is NOT adopted is the test that a project
 * never starts posting into an unrelated conversation.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { CHANNEL_NAME_MAX, ChannelProvisioner, channelNameFor } from '../../src/slack/provision.ts'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

/** A tiny executor that answers by pattern, and records what it was asked. */
class FakeDb implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []
  constructor(private readonly answers: { match: RegExp; rows: Record<string, unknown>[] }[]) {}
  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    for (const answer of this.answers) if (answer.match.test(sql)) return { rows: answer.rows }
    return { rows: [] }
  }
}

const slackReturning = (responses: unknown[]): SlackClient => {
  let i = 0
  const fetchImpl = (async () => {
    const body = responses[Math.min(i, responses.length - 1)]
    i += 1
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return new SlackClient('xoxb-test', { fetchImpl, sleep: async () => {} })
}

describe('channel names', () => {
  it('is deterministic, which is what makes name_taken informative', () => {
    expect(channelNameFor('website-rebuild')).toBe('proj-website-rebuild')
    expect(channelNameFor('website-rebuild')).toBe(channelNameFor('website-rebuild'))
  })

  it('strips what Slack will not accept rather than letting the API reject it', () => {
    expect(channelNameFor('Q3 Pricing! (draft)')).toBe('proj-q3-pricing-draft')
  })

  it('never exceeds Slack ceiling', () => {
    expect(channelNameFor('x'.repeat(200)).length).toBe(CHANNEL_NAME_MAX)
  })

  it('produces something legal even from a slug that reduces to nothing', () => {
    expect(channelNameFor('!!!')).toBe('proj-unnamed')
  })
})

describe('provisioning', () => {
  it('asks Postgres first and creates nothing when the mapping already exists', async () => {
    const db = new FakeDb([
      {
        match: /from public\.slack_channel_map\s+where project_id/,
        rows: [{ channel_id: 'C1', channel_name: 'proj-a' }],
      },
    ])
    const slack = slackReturning([{ ok: false, error: 'should_not_be_called' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('existing')
    expect(result.channelId).toBe('C1')
  })

  it('creates and maps when there is nothing yet', async () => {
    const db = new FakeDb([])
    const slack = slackReturning([{ ok: true, channel: { id: 'C0BUNEW00001', name: 'proj-a' } }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('created')
    expect(db.statements.some((s) => s.includes('insert into public.slack_channel_map'))).toBe(true)
    expect(db.statements.some((s) => s.includes('created_by_app'))).toBe(true)
  })

  it('adopts a taken name ONLY when Postgres says that channel is already this project’s', async () => {
    const db = new FakeDb([
      {
        match: /where channel_name =/,
        rows: [{ channel_id: 'C0BUOLD00001', project_id: PROJECT }],
      },
    ])
    const slack = slackReturning([{ ok: false, error: 'name_taken' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('adopted')
    expect(result.channelId).toBe('C0BUOLD00001')
  })

  it('refuses to adopt a channel belonging to another project', async () => {
    const db = new FakeDb([
      { match: /where channel_name =/, rows: [{ channel_id: 'C0BUOLD00001', project_id: OTHER }] },
    ])
    const slack = slackReturning([{ ok: false, error: 'name_taken' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('name_conflict')
    expect(result.channelId).toBeNull()
  })

  it('refuses to adopt a channel nobody has mapped — it is a stranger’s room', async () => {
    const db = new FakeDb([])
    const slack = slackReturning([{ ok: false, error: 'name_taken' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('name_conflict')
  })

  it('reports any other Slack failure without inventing a channel', async () => {
    const db = new FakeDb([])
    const slack = slackReturning([{ ok: false, error: 'restricted_action' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result).toMatchObject({
      outcome: 'failed',
      channelId: null,
      errorCode: 'restricted_action',
    })
  })
})
