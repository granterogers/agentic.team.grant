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
import {
  CHANNEL_NAME_MAX,
  ChannelProvisioner,
  channelNameFor,
  DISCIPLINE_SUFFIX_MAX,
} from '../../src/slack/provision.ts'

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
    expect(channelNameFor('Website Rebuild')).toBe('website_rebuild')
    expect(channelNameFor('Website Rebuild')).toBe(channelNameFor('Website Rebuild'))
  })

  it('strips what Slack will not accept rather than letting the API reject it', () => {
    expect(channelNameFor('Q3 Pricing! (draft)')).toBe('q3_pricing_draft')
  })

  it('never exceeds Slack ceiling', () => {
    // The prefix is trimmed to leave room for the longest discipline suffix,
    // so a lobby name is shorter than Slack's ceiling by design — a prefix that
    // used all 80 would produce an illegal name the first time a discipline
    // channel was made from it.
    expect(channelNameFor('x'.repeat(200)).length).toBe(
      CHANNEL_NAME_MAX - DISCIPLINE_SUFFIX_MAX - 1,
    )
    expect(channelNameFor('x'.repeat(200), 'communications-director').length).toBeLessThanOrEqual(
      CHANNEL_NAME_MAX,
    )
  })

  it('produces something legal even from a slug that reduces to nothing', () => {
    expect(channelNameFor('!!!')).toBe('untitled_project')
  })
})

/** The project exists in this workspace's office; a project of any other office reads as no row at all. */
const ownProject = {
  match: /select name, channel_prefix, is_fixture from public\.projects/,
  rows: [{ name: 'Proj A', channel_prefix: null, is_fixture: false }],
}

describe('provisioning', () => {
  it('asks Postgres first and creates nothing when the mapping already exists', async () => {
    const db = new FakeDb([
      ownProject,
      {
        match: /from public\.slack_channel_map\s+where team_id/,
        rows: [{ channel_id: 'C1', channel_name: 'proj-a' }],
      },
    ])
    const slack = slackReturning([{ ok: false, error: 'should_not_be_called' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('existing')
    expect(result.channelId).toBe('C1')
  })

  it('creates and maps when there is nothing yet', async () => {
    const db = new FakeDb([ownProject])
    const slack = slackReturning([{ ok: true, channel: { id: 'C0BUNEW00001', name: 'proj-a' } }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('created')
    expect(db.statements.some((s) => s.includes('insert into public.slack_channel_map'))).toBe(true)
    expect(db.statements.some((s) => s.includes('created_by_app'))).toBe(true)
  })

  /*
    #381: a fixture project's channel is a test destination, and nobody is
    invited into one. A real project's is unchanged: the subject is invited.
    The Slack fake records every method called, so "not invited" means the
    invite was never ASKED, not that it failed.
  */
  const recordingSlack = (): { slack: SlackClient; calls: string[] } => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      const method = String(url).split('/').pop() ?? ''
      calls.push(method)
      const body =
        method === 'conversations.create'
          ? { ok: true, channel: { id: 'C0BUNEW00002', name: 'proj-b' } }
          : { ok: true }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    return { slack: new SlackClient('xoxb-test', { fetchImpl, sleep: async () => {} }), calls }
  }
  const projectRow = (isFixture: boolean) => ({
    match: /select name, channel_prefix, is_fixture from public\.projects/,
    rows: [{ name: 'Proj B', channel_prefix: null, is_fixture: isFixture }],
  })
  const subjectRow = {
    match: /slack\.subject_user_id/,
    rows: [{ user_id: 'U0HUMAN0001' }],
  }
  it("a fixture project's new channel invites nobody (#381)", async () => {
    const { slack, calls } = recordingSlack()
    const db = new FakeDb([projectRow(true), subjectRow])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'b')
    expect(result.outcome).toBe('created')
    expect(result.invited).toBe('not_invited_test_channel')
    expect(calls).toContain('conversations.create')
    expect(calls).not.toContain('conversations.invite')
  })
  it("control: a real project's new channel still invites the subject", async () => {
    const { slack, calls } = recordingSlack()
    const db = new FakeDb([projectRow(false), subjectRow])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'b')
    expect(result.invited).toBe('invited')
    expect(calls).toContain('conversations.invite')
  })

  it('adopts a taken name ONLY when Postgres says that channel is already this project’s', async () => {
    const db = new FakeDb([
      ownProject,
      {
        match: /channel_name = '/,
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
      ownProject,
      { match: /channel_name = '/, rows: [{ channel_id: 'C0BUOLD00001', project_id: OTHER }] },
    ])
    const slack = slackReturning([{ ok: false, error: 'name_taken' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('name_conflict')
    expect(result.channelId).toBeNull()
  })

  it('refuses to adopt a channel nobody has mapped — it is a stranger’s room', async () => {
    const db = new FakeDb([ownProject])
    const slack = slackReturning([{ ok: false, error: 'name_taken' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result.outcome).toBe('name_conflict')
  })

  it('reports any other Slack failure without inventing a channel', async () => {
    const db = new FakeDb([ownProject])
    const slack = slackReturning([{ ok: false, error: 'restricted_action' }])
    const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
    expect(result).toMatchObject({
      outcome: 'failed',
      channelId: null,
      errorCode: 'restricted_action',
    })
  })

  describe('inside one office (multi-user P3)', () => {
    it('a project the workspace office does not hold creates nothing in Slack', async () => {
      // The projects read is confined to the workspace's office, so another office's project reads as no row,
      // exactly as a missing one does. The Slack client must never be asked to create a room for it.
      const { slack, calls } = recordingSlackCalls()
      const db = new FakeDb([])
      const result = await new ChannelProvisioner(db, slack, 'T1').ensureChannel(OTHER, 'x')
      expect(result).toMatchObject({ outcome: 'failed', channelId: null })
      expect(calls).not.toContain('conversations.create')
      expect(db.statements.some((s) => s.includes('insert into public.slack_channel_map'))).toBe(
        false,
      )
    })

    it('every statement on a project or a mapping is confined to the workspace', async () => {
      const db = new FakeDb([ownProject])
      const slack = slackReturning([{ ok: true, channel: { id: 'C0BUNEW00003', name: 'proj-a' } }])
      await new ChannelProvisioner(db, slack, 'T1').ensureChannel(PROJECT, 'a')
      const touching = db.statements.filter(
        (s) => s.includes('public.projects') || s.includes('public.slack_channel_map'),
      )
      expect(touching.length).toBeGreaterThan(0)
      for (const s of touching) {
        // the workspace's office decides which project is visible; the mapping is pinned to the workspace
        expect(s, 'names the workspace or its office').toMatch(/T1|slack_workspaces/)
      }
      const projectReads = touching.filter((s) => /from public\.projects/.test(s))
      for (const s of projectReads) expect(s).toMatch(/office_id/)
    })
  })
})

/** Records which Slack methods were asked for. */
const recordingSlackCalls = (): { slack: SlackClient; calls: string[] } => {
  const calls: string[] = []
  const fetchImpl = (async (url: string) => {
    calls.push(String(url).split('/').pop() ?? '')
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { slack: new SlackClient('xoxb-test', { fetchImpl, sleep: async () => {} }), calls }
}

describe('per-project, per-discipline channel names (0070)', () => {
  it('puts the project first, so a sidebar groups by project', () => {
    // Slack's channel list is flat and its sidebar sections are a per-user
    // client feature with no API, so alphabetical order is the only grouping a
    // bot can produce. Project-first gets it for free.
    const names = [
      channelNameFor('Money Mastery'),
      channelNameFor('Money Mastery', 'research-director'),
      channelNameFor('Money Mastery', 'finance-director'),
      channelNameFor('Website Rebuild'),
      channelNameFor('Website Rebuild', 'growth-director'),
    ]
    expect([...names].sort()).toEqual([
      'money_mastery',
      'money_mastery_finance',
      'money_mastery_research',
      'website_rebuild',
      'website_rebuild_growth',
    ])
  })

  it('drops the redundant -director from the suffix', () => {
    // Every staff slug ends in it, and a suffix that is the same on every
    // channel carries no information while costing nine characters of a
    // name that has 80.
    expect(channelNameFor('Alpha', 'research-director')).toBe('alpha_research')
    expect(channelNameFor('Alpha', 'quality-director')).toBe('alpha_quality')
  })

  it('shortens the Chief of Staff, whose slug is not shaped like the others', () => {
    expect(channelNameFor('Alpha', 'chief-of-staff')).toBe('alpha_chief')
  })

  it('a lobby has no suffix at all', () => {
    expect(channelNameFor('Alpha')).toBe('alpha')
    expect(channelNameFor('Alpha', null)).toBe('alpha')
    expect(channelNameFor('Alpha', '')).toBe('alpha')
  })

  it('a long project name still leaves room for the longest discipline', () => {
    const long = 'a quarterly relaunch of the money mastery programme across every market'
    expect(channelNameFor(long, 'communications-director').length).toBeLessThanOrEqual(
      CHANNEL_NAME_MAX,
    )
    // And the discipline survives the truncation — trimming the suffix instead
    // of the stem would make two disciplines share a channel name.
    expect(channelNameFor(long, 'communications-director')).toMatch(/_communications$/)
  })

  it('never ends in a separator, whatever the truncation', () => {
    for (const name of ['a-'.repeat(60), 'x'.repeat(200), 'Q3!!! (draft) ']) {
      expect(channelNameFor(name)).not.toMatch(/_$/)
      expect(channelNameFor(name, 'operations-director')).not.toMatch(/_$/)
    }
  })

  /*
    Grant, twice: *"Make them all plain English, and I prefer underscore rather
    than hyphen. It's easier to read."* Asserted rather than left to the
    examples above, so a future change back to hyphens fails a check that says
    why instead of failing seven that look like typos.
  */
  it('uses underscores and never a hyphen, because a hyphen is hard to read', () => {
    for (const [name, slug] of [
      ['Money Mastery', null],
      ['money-mastery', 'research-director'],
      ['AI Team HQ Test', 'communications-director'],
      ['Q3 Pricing! (draft)', 'chief-of-staff'],
    ] as const) {
      expect(channelNameFor(name, slug)).not.toMatch(/-/)
      expect(channelNameFor(name, slug)).toMatch(/^[a-z0-9_]+$/)
    }
  })

  it('a hyphenated slug and its spaced name produce the SAME channel', () => {
    // Both are passed to this function by real callers — the provisioner takes
    // the project name, the tidy script falls back to the slug — and two
    // spellings of one project producing two channels is the confusion the
    // convention exists to prevent.
    expect(channelNameFor('money-mastery')).toBe(channelNameFor('Money Mastery'))
  })
})
