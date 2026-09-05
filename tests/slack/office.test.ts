/**
 * The wiring between the claim and the post.
 *
 * The idempotency itself lives in Postgres (0032) and is proven against the
 * live database by `npm run verify:slack` — a unit test with a fake executor
 * could only prove that the fake agrees with itself. What IS worth proving
 * here is the wiring, because every one of these is a place where a plausible
 * implementation does the wrong thing:
 *
 *   - claiming BEFORE posting, not after;
 *   - not posting at all when the claim says somebody else has it;
 *   - an indeterminate post recorded as non-retryable, so nothing re-posts it;
 *   - the dedupe key riding on the message, without which reconciliation has
 *     nothing to match.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import type { DeliveryRequest } from '../../src/slack/office.ts'
import { DELIVERY_EVENT_TYPE, SlackOffice } from '../../src/slack/office.ts'

const DELIVERY = '33333333-3333-3333-3333-333333333333'
const CORR = '44444444-4444-4444-4444-444444444444'

class ScriptedDb implements SqlExecutor {
  readonly kind = 'scripted'
  readonly statements: string[] = []
  constructor(
    private readonly claimOutcome: string,
    private readonly recordOutcome = 'sent',
    private readonly messageTs: string | null = null,
  ) {}
  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('claim_slack_delivery')) {
      return {
        rows: [
          {
            delivery_id: DELIVERY,
            outcome: this.claimOutcome,
            message_ts: this.messageTs,
            attempt: 1,
          },
        ],
      }
    }
    if (sql.includes('record_slack_sent')) return { rows: [{ outcome: this.recordOutcome }] }
    return { rows: [{ outcome: 'recorded' }] }
  }
}

interface Posted {
  readonly method: string
  readonly body: Record<string, unknown>
}

const capturingSlack = (
  posts: Posted[],
  response: unknown = { ok: true, ts: '1700000000.000100' },
): SlackClient => {
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({
      method: String(url).split('/').pop() ?? '',
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    })
    if (response instanceof Error) throw response
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return new SlackClient('xoxb-test', { fetchImpl, sleep: async () => {} })
}

const request = (over: Partial<DeliveryRequest> = {}): DeliveryRequest => ({
  dedupeKey: 'job:abc:result',
  teamId: 'T0BUCJ2L5FD',
  channelId: 'C0BUNF6NKHA',
  threadTs: null,
  purpose: 'result',
  staff: {
    slug: 'research-director',
    name: 'Research Director',
    title: 'Research Director',
    avatarRef: 'assets/avatars/png/research-director.png',
  },
  staffId: '55555555-5555-5555-5555-555555555555',
  correlationId: CORR,
  message: {
    staffTitle: 'Research Director',
    body: 'Three suppliers quoted within 4%.',
    metadata: null,
    correlationId: CORR,
    actions: [],
  },
  ...over,
})

describe('the order of operations', () => {
  it('claims before it posts', async () => {
    const posts: Posted[] = []
    const db = new ScriptedDb('claimed')
    await new SlackOffice(db, capturingSlack(posts)).deliver(request())
    expect(db.statements[0]).toContain('claim_slack_delivery')
    expect(posts).toHaveLength(1)
  })

  it('does not post at all when another claim is live', async () => {
    const posts: Posted[] = []
    const result = await new SlackOffice(new ScriptedDb('held'), capturingSlack(posts)).deliver(
      request(),
    )
    expect(result.outcome).toBe('held')
    expect(posts).toHaveLength(0)
  })

  it('does not post again when it was already sent, and reports the original ts', async () => {
    const posts: Posted[] = []
    const result = await new SlackOffice(
      new ScriptedDb('already_sent', 'sent', '1.5'),
      capturingSlack(posts),
    ).deliver(request())
    expect(result).toMatchObject({ outcome: 'already_sent', messageTs: '1.5' })
    expect(posts).toHaveLength(0)
  })

  it('does not post something that was suppressed before the claim', async () => {
    const posts: Posted[] = []
    const result = await new SlackOffice(
      new ScriptedDb('suppressed'),
      capturingSlack(posts),
    ).deliver(request())
    expect(result.outcome).toBe('suppressed')
    expect(posts).toHaveLength(0)
  })

  it('reports suppressed_too_late when the suppression lost the race to the post', async () => {
    const result = await new SlackOffice(
      new ScriptedDb('claimed', 'suppressed_too_late'),
      capturingSlack([]),
    ).deliver(request())
    // The message exists. The caller now has to delete it, which it can only do
    // because the ts came back.
    expect(result.outcome).toBe('suppressed_too_late')
    expect(result.messageTs).toBe('1700000000.000100')
  })
})

describe('what goes on the wire', () => {
  it('carries the dedupe key as message metadata, so reconciliation has a marker', async () => {
    const posts: Posted[] = []
    await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts)).deliver(request())
    expect(posts[0]?.body.metadata).toEqual({
      event_type: DELIVERY_EVENT_TYPE,
      event_payload: { dedupe_key: 'job:abc:result' },
    })
  })

  it('presents the staff member, falling back to an emoji when nothing is hosted', async () => {
    const posts: Posted[] = []
    const result = await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts)).deliver(
      request(),
    )
    expect(posts[0]?.body.username).toBe('Research Director')
    expect(posts[0]?.body.icon_emoji).toBe(':books:')
    expect(posts[0]?.body.icon_url).toBeUndefined()
    expect(result.iconSource).toBe('emoji_fallback')
  })

  it('uses the avatar when a public base is configured', async () => {
    const posts: Posted[] = []
    const result = await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts), {
      avatarBaseUrl: 'https://cdn.example',
    }).deliver(request())
    expect(posts[0]?.body.icon_url).toBe(
      'https://cdn.example/assets/avatars/png/research-director.png',
    )
    expect(result.iconSource).toBe('avatar_url')
  })

  it('presents no author at all for a system notice, rather than inventing one', async () => {
    const posts: Posted[] = []
    await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts)).deliver(
      request({ staff: null, staffId: null, purpose: 'notice' }),
    )
    expect(posts[0]?.body.username).toBeUndefined()
    expect(posts[0]?.body.icon_emoji).toBeUndefined()
  })

  it('replies into the thread when there is one', async () => {
    const posts: Posted[] = []
    await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts)).deliver(
      request({ threadTs: '1699999999.000100' }),
    )
    expect(posts[0]?.body.thread_ts).toBe('1699999999.000100')
  })

  it('omits thread_ts entirely rather than sending null, which Slack rejects', async () => {
    const posts: Posted[] = []
    await new SlackOffice(new ScriptedDb('claimed'), capturingSlack(posts)).deliver(request())
    expect('thread_ts' in (posts[0]?.body ?? {})).toBe(false)
  })
})

describe('failures', () => {
  it('records an indeterminate post as NOT retryable, so nothing re-posts it', async () => {
    const db = new ScriptedDb('claimed')
    const slack = capturingSlack([], new TypeError('socket hang up'))
    const result = await new SlackOffice(db, slack).deliver(request())
    expect(result.outcome).toBe('indeterminate')
    const recorded = db.statements.find((s) => s.includes('record_slack_failure'))
    expect(recorded).toContain('false')
  })

  it('records a rate limit as retryable, because the state of the world is unchanged', async () => {
    const db = new ScriptedDb('claimed')
    const rateLimited = new SlackClient('xoxb-test', {
      sleep: async () => {},
      maxRateLimitRetries: 0,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: 'ratelimited' }), {
          status: 429,
          headers: { 'retry-after': '1' },
        })) as unknown as typeof fetch,
    })
    const result = await new SlackOffice(db, rateLimited).deliver(request())
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'ratelimited' })
    expect(db.statements.find((s) => s.includes('record_slack_failure'))).toContain('true')
  })

  it('does not throw a Slack failure into the caller — a lost delivery is a fact, not an exception', async () => {
    const db = new ScriptedDb('claimed')
    const revoked = new SlackClient('xoxb-test', {
      sleep: async () => {},
      fetchImpl: (async () =>
        new Response(JSON.stringify({ ok: false, error: 'token_revoked' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    })
    const result = await new SlackOffice(db, revoked).deliver(request())
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'token_revoked' })
  })
})
