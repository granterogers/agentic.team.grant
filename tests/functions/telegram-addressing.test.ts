/**
 * What the REAL telegram-webhook writes as the addressee, read by the REAL `speaker()` (the two halves of one decision).
 *
 * The chief's bot is registered with the slug `chief-of-staff` (production: the only enabled bot), the webhook stores a
 * bot's slug as `inbound_commands.addressed_to` because the reply path joins the bot on it, and `speaker()` used to read
 * any non-empty value as "he opened a specialist's bot: nobody else is convened". Each half was right alone; only their
 * agreement was wrong, so this drives both: the webhook's recorded payload is fed to `speaker()`, and what `speaker()`
 * does with it is observed from the queries it makes (the roster lookup is what convening is made of).
 *
 * Hermetic: the webhook is the deploy's own bundle with a recording `fetch`; the database is a recording fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { speaker } from '../../src/handlers/instruction.ts'
import { loadEdge, TELEGRAM_BUNDLE } from '../helpers/edge-bundle.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface Stored {
  addressed_to?: string | null
  instruction?: string
  office_id?: string
}

/** A PostgREST that knows one bot and one admitted sender, and records every command it is asked to store. */
const world = (bot: { slug: string; id: string }) => {
  const stored: Stored[] = []
  const calls: string[] = []
  const stub: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    calls.push(url)
    const json = (v: unknown, status = 200): Response =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes('/rpc/staff_for_bot'))
      return json([{ staff_slug: bot.slug, staff_name: 'Someone', username: `${bot.slug}_bot` }])
    if (url.includes('/rpc/sender_admitted'))
      return json({ subject: 'grant', declared_test: false, office_id: 'office-1' })
    if (url.includes('/rpc/record_telegram_chat')) return json('ok')
    if (url.includes('/rest/v1/inbound_commands')) {
      stored.push(JSON.parse(String(init?.body ?? '{}')) as Stored)
      return json([{ command_id: '00000000-0000-4000-8000-000000000001' }], 201)
    }
    if (url.includes('/rpc/enqueue_inbound'))
      return json({ job_id: '00000000-0000-4000-8000-000000000002' })
    // Anything else (kicks, the dispatch) answers nothing in particular.
    return json(null)
  }
  return { stored, calls, stub }
}

const post = async (bot: { slug: string; id: string }, text: string): Promise<Stored> => {
  const w = world(bot)
  const h = await loadEdge(
    TELEGRAM_BUNDLE,
    {
      SUPABASE_URL: 'https://db.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      TELEGRAM_WEBHOOK_SECRET: 'shared',
      TELEGRAM_BOT_ID: bot.id,
    },
    w.stub,
  )
  const res = await h(
    new Request(`https://fn.test/telegram-webhook?bot=${bot.id}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'shared',
      },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 5,
          date: 1_700_000_000,
          chat: { id: 1386648496, type: 'private' },
          from: { id: 1386648496 },
          text,
        },
      }),
    }),
  )
  expect(res.status).toBe(200)
  const row = w.stored[0]
  if (row === undefined) throw new Error('the webhook stored no command')
  return row
}

/** A roster where every slug is a real, active specialist; records each statement `speaker` issues. */
const recordingDb = () => {
  const sql: string[] = []
  const person = (slug: string) => ({
    slug,
    name: slug.split('-')[0],
    title: slug,
    communication_style: 'plain',
    responsibilities: '',
  })
  const db: SqlExecutor = {
    kind: 'fake',
    execute: (statement: string): Promise<SqlResult> => {
      sql.push(statement)
      const staff = /from public\.staff where slug = '([a-z-]+)' and active/.exec(statement)
      if (staff?.[1] !== undefined) return Promise.resolve({ rows: [person(staff[1])] })
      return Promise.resolve({ rows: [] })
    },
  }
  return { db, sql }
}
const routed = (sql: string[]): boolean =>
  sql.some((s) => s.includes('who_knows_about') || s.includes('public.staff where active'))

describe('what the webhook records and what speaker does with it', () => {
  it("the chief's bot stores her own slug (the reply path needs it) and speaker ROUTES it: the roster is consulted", async () => {
    const stored = await post(
      { slug: 'chief-of-staff', id: '111' },
      'Ask the team to look at this.',
    )
    expect(stored.addressed_to).toBe('chief-of-staff')
    const { db, sql } = recordingDb()
    const who = await speaker(db, stored.addressed_to ?? null, stored.instruction ?? '', null)
    expect(routed(sql)).toBe(true)
    expect(who.reason).not.toContain('addressed directly')
  })

  it("a specialist's bot stores that specialist and speaker answers as her WITHOUT consulting the roster (control)", async () => {
    const stored = await post(
      { slug: 'research-director', id: '222' },
      'Ask the team to look at this.',
    )
    expect(stored.addressed_to).toBe('research-director')
    const { db, sql } = recordingDb()
    const who = await speaker(db, stored.addressed_to ?? null, stored.instruction ?? '', null)
    expect(who.slug).toBe('research-director')
    expect(who.reason).toContain('addressed directly')
    expect(who.convened).toEqual(['research-director'])
    expect(routed(sql)).toBe(false)
  })

  it('the same words typed to the two bots are decided by the bot, not by the words', async () => {
    const words = 'Please look into the supplier contract.'
    const toChief = await post({ slug: 'chief-of-staff', id: '111' }, words)
    const toResearch = await post({ slug: 'research-director', id: '222' }, words)
    expect(toChief.instruction).toBe(toResearch.instruction)
    const a = recordingDb()
    const b = recordingDb()
    await speaker(a.db, toChief.addressed_to ?? null, toChief.instruction ?? '', null)
    await speaker(b.db, toResearch.addressed_to ?? null, toResearch.instruction ?? '', null)
    expect(routed(a.sql)).toBe(true)
    expect(routed(b.sql)).toBe(false)
  })

  it('a hand-off child addressed to the chief still convenes nobody (the chain ends at one)', async () => {
    const { db, sql } = recordingDb()
    const who = await speaker(db, 'chief-of-staff', 'x', null, null, [], null, true)
    expect(who.slug).toBe('chief-of-staff')
    expect(who.reason).toContain('addressed directly')
    expect(routed(sql)).toBe(false)
  })
})
