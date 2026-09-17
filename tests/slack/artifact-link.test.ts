/**
 * A file the office made, delivered to Slack as a link (#258).
 *
 * Grant's decision, 2026-09-17: *"signed-link delivery, reusing the existing
 * signed-URL infrastructure rather than requesting additional Slack file-upload
 * scope."* The app holds `chat:write` and not `files:write`, so an upload is
 * scope-blocked exactly as #270 is, and `chat:write` can post a link today.
 *
 * Both renderings are asserted, and the second is the one that matters: a
 * message describing a document nobody can open is the same defect as a button
 * that does nothing, so a link that could not be minted has to SAY so.
 */

import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { fallbackText, resultBlocks } from '../../src/slack/blocks.ts'
import { SlackOffice } from '../../src/slack/office.ts'

const message = (
  file: { filename: string; url: string | null } | null,
): Parameters<typeof resultBlocks>[0] => ({
  staffTitle: 'Chief of Staff',
  body: 'The report is written. Three sources, four pages.',
  metadata: null,
  correlationId: '11111111-1111-1111-1111-111111111111',
  actions: [],
  file,
})

const textOf = (blocks: readonly unknown[]): string => JSON.stringify(blocks)

describe('#258 — a made file reaches Slack as a signed link', () => {
  it('renders the link in Slack mrkdwn, unescaped', () => {
    const blocks = resultBlocks(
      message({ filename: 'Q3 review.pdf', url: 'https://example.test/sign/abc?token=xyz' }),
    )
    const json = textOf(blocks)
    // Slack's own link syntax. Escaping this would print the angle brackets,
    // which is #186's shortcode lesson with the sides swapped.
    expect(json).toContain('<https://example.test/sign/abc?token=xyz|Q3 review.pdf>')
    expect(json).not.toContain('&lt;')
  })

  it('says how long the link lasts, because a dead link with no warning reads as a broken product', () => {
    const json = textOf(resultBlocks(message({ filename: 'x.pdf', url: 'https://e.test/s' })))
    expect(json).toMatch(/ten minutes/)
    // And that the file itself is not temporary, which is the reassuring half.
    expect(json).toMatch(/documents for good/)
  })

  it('degrades honestly when no link could be minted', () => {
    const json = textOf(resultBlocks(message({ filename: 'Q3 review.pdf', url: null })))
    expect(json).toContain('Q3 review.pdf')
    expect(json).toMatch(/could not make a link/)
    // It must still say the file EXISTS. The failure is the link, not the work.
    expect(json).toMatch(/in the project/)
    // And it must not render a link to nowhere.
    expect(json).not.toContain('<null')
    expect(json).not.toContain('undefined')
  })

  it('adds nothing at all when there is no file', () => {
    const withFile = textOf(resultBlocks(message({ filename: 'a.pdf', url: null })))
    const without = textOf(resultBlocks(message(null)))
    expect(without).not.toMatch(/📄/)
    expect(withFile).toMatch(/📄/)
  })

  it('names the file in the notification text and keeps the URL out of it', () => {
    /*
      The fallback is what a phone shows before the message is opened. A signed
      URL there is a credential in a push notification, which is also where it
      gets screenshotted — the name is the useful half and the link is not.
    */
    const text = fallbackText(
      message({ filename: 'Q3 review.pdf', url: 'https://example.test/sign/secret-token' }),
    )
    expect(text).toContain('Q3 review.pdf')
    expect(text).not.toContain('secret-token')
    expect(text).not.toContain('https://')
  })

  it('keeps the file line above the buttons, because it is what the message is about', () => {
    const blocks = resultBlocks({
      ...message({ filename: 'a.pdf', url: 'https://e.test/s' }),
      actions: ['open_project'],
      projectUrl: 'https://team.test/p/1',
    })
    const fileAt = blocks.findIndex((b) => JSON.stringify(b).includes('a.pdf'))
    const actionsAt = blocks.findIndex((b) => JSON.stringify(b).includes('open_project'))
    expect(fileAt).toBeGreaterThanOrEqual(0)
    expect(actionsAt).toBeGreaterThanOrEqual(0)
    expect(fileAt).toBeLessThan(actionsAt)
  })
})

/*
  And the whole way out, not only the renderer.

  #258's defect was never that a renderer could not draw a link: it was that
  nothing ever passed one, because `attachFile` was read in exactly one branch
  of one file. A test of `resultBlocks` alone would have been green throughout
  that entire period. This drives `SlackOffice.deliver` and reads what actually
  went on the wire.
*/
class ScriptedDb implements SqlExecutor {
  readonly kind = 'scripted'
  async execute(sql: string): Promise<SqlResult> {
    if (sql.includes('claim_delivery')) {
      return {
        rows: [
          {
            delivery_id: '33333333-3333-3333-3333-333333333333',
            outcome: 'claimed',
            message_ref: null,
            attempt: 1,
          },
        ],
      }
    }
    if (sql.includes('record_delivery_sent')) return { rows: [{ outcome: 'sent' }] }
    return { rows: [{ outcome: 'recorded' }] }
  }
}

const posted = async (
  file: { filename: string; url: string | null } | null,
): Promise<Record<string, unknown>> => {
  const sent: Record<string, unknown>[] = []
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
    return new Response(JSON.stringify({ ok: true, ts: '1700000000.000100' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  const slack = new SlackClient('xoxb-test', { fetchImpl, sleep: async () => {} })
  await new SlackOffice(new ScriptedDb(), slack).deliver({
    dedupeKey: 'job:abc:result',
    teamId: 'T0BUCJ2L5FD',
    channelId: 'C0BUNF6NKHA',
    threadTs: null,
    purpose: 'result',
    staff: null,
    staffId: null,
    correlationId: '44444444-4444-4444-4444-444444444444',
    message: {
      staffTitle: null,
      body: 'The report is written.',
      metadata: null,
      correlationId: '44444444-4444-4444-4444-444444444444',
      actions: [],
      file,
    },
  })
  return sent[0] ?? {}
}

describe('#258 — the link survives the whole delivery, not just the renderer', () => {
  it('puts the signed link in the message Slack actually receives', async () => {
    const body = await posted({ filename: 'Q3.pdf', url: 'https://e.test/sign/tok' })
    expect(JSON.stringify(body.blocks)).toContain('<https://e.test/sign/tok|Q3.pdf>')
  })

  it('and the honest degradation reaches Slack too', async () => {
    const body = await posted({ filename: 'Q3.pdf', url: null })
    const json = JSON.stringify(body.blocks)
    expect(json).toMatch(/could not make a link/)
    expect(json).not.toContain('https://')
  })

  it('CONTROL: a message with no file carries no file line at all', async () => {
    const body = await posted(null)
    expect(JSON.stringify(body.blocks)).not.toMatch(/📄/)
  })
})
