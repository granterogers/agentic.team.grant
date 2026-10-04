/**
 * What a person is told when Google does not work (#413), and the button that goes with it.
 *
 * These are properties of the sentences, not of particular words: no error vocabulary reaches a person, a button is only
 * promised when one exists, and every problem that needs the person says what to do. The decision about WHEN to speak is
 * a database function and is driven live by `npm run verify:incidents`.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import type { GoogleProblem } from '../../src/google/auth.ts'
import {
  ACCOUNT_PROBLEMS,
  closedBy,
  googleProblemOutput,
  googleRecoveredWords,
  googleRecoveryOutput,
  googleWords,
  problemKey,
} from '../../src/incidents/google.ts'
import { joinBase } from '../../src/incidents/link.ts'
import { noticeKeyboard, pagerText } from '../../src/telegram/message.ts'

const PROBLEMS: readonly GoogleProblem[] = [
  'revoked',
  'not_connected',
  'not_configured',
  'refused',
  'missing_scope',
  'api_error',
]

/** The vocabulary of the machinery. None of it is something a person asked to read. */
const JARGON =
  /invalid_grant|oauth|refresh[- ]token|http \d|\bstack\b|worker|job_id|\bexception\b|\b4\d\d\b/i

const everyWording = () =>
  PROBLEMS.flatMap((problem) =>
    (['first', 'reminder'] as const).flatMap((reason) =>
      [true, false].map((hasButton) => ({
        problem,
        reason,
        hasButton,
        words: googleWords(problem, reason, 'mail', hasButton, 'Gmail read access'),
      })),
    ),
  )

describe('what Google problems say', () => {
  it('never lead with, or contain, the vocabulary of the machinery', () => {
    for (const { problem, words } of everyWording()) {
      expect(`${words.heading}\n${words.body}`, problem).not.toMatch(JARGON)
    }
  })

  it('says what happened, what it affects, and what to do, for every problem that needs the person', () => {
    for (const { problem, words } of everyWording()) {
      expect(words.heading.length, problem).toBeGreaterThan(8)
      expect(words.body, problem).toMatch(/\*What to do\*/)
      if (problem === 'revoked') {
        expect(words.body).toMatch(/\*What this affects\*/)
        expect(words.body).toMatch(/\*What still works\*/)
      }
    }
  })

  it('only mentions a button when there is one, and always says where to go when there is not', () => {
    for (const { problem, hasButton, words } of everyWording()) {
      if (!words.actionable) continue
      if (hasButton) expect(words.body, problem).toMatch(/Reconnect Google below/)
      else {
        expect(words.body, `${problem} without a button`).not.toMatch(
          /Reconnect Google|\bbelow\b|\bbutton\b/i,
        )
        expect(words.body, `${problem} without a button`).toMatch(/Settings/)
      }
    }
  })

  it('a reminder says it is still waiting, and promises only what the incident layer does', () => {
    const first = googleWords('revoked', 'first', 'mail', true)
    const reminder = googleWords('revoked', 'reminder', 'mail', true)
    expect(reminder.heading).not.toEqual(first.heading)
    expect(reminder.heading).toMatch(/still/i)
    expect(reminder.body).toMatch(/remind you again tomorrow/)
    expect(first.body).not.toMatch(/remind you again/)
  })

  it('a temporary API error asks nothing of the person and offers no button', () => {
    const words = googleWords('api_error', 'first', 'calendar', true)
    expect(words.actionable).toBe(false)
    expect(words.body).toMatch(/Nothing yet/)
  })

  it('names which duty in plain words and keeps mail and calendar apart', () => {
    expect(googleWords('refused', 'first', 'mail', true).body).toMatch(/your email/)
    expect(googleWords('refused', 'first', 'calendar', true).body).toMatch(/your calendar/)
  })

  it('recovery is one calm sentence with nothing to do', () => {
    const words = googleRecoveredWords()
    expect(words.heading).toMatch(/working again/i)
    expect(words.body).toMatch(/Nothing for you to do/)
    expect(words.actionable).toBe(false)
    expect(words.body).not.toMatch(JARGON)
  })
})

describe('problem identity', () => {
  it('account-level problems are shared by every Google duty, duty-level ones are not', () => {
    expect(problemKey('mail', 'revoked')).toBe(problemKey('calendar', 'revoked'))
    expect(problemKey('mail', 'missing_scope')).not.toBe(problemKey('calendar', 'missing_scope'))
    expect(problemKey('mail', 'api_error')).toBe('mail_api_error')
  })

  it('a successful run closes the account-level problems and only its own duty-level ones', () => {
    const closed = closedBy('mail')
    for (const p of ACCOUNT_PROBLEMS) expect(closed).toContain(p)
    expect(closed).toContain('mail_missing_scope')
    expect(closed).not.toContain('calendar_missing_scope')
    expect(closed).not.toContain('calendar_api_error')
  })

  it('every problem a duty can report has an identity that its own recovery closes', () => {
    for (const duty of ['mail', 'calendar'] as const) {
      for (const problem of PROBLEMS) {
        expect(closedBy(duty), `${duty} ${problem}`).toContain(problemKey(duty, problem))
      }
    }
  })
})

describe('the address behind a button', () => {
  it('is the deployment origin plus an allowed settings path, and nothing else', () => {
    expect(joinBase('https://ai-team-hq.vercel.app', '/?settings=connections')).toBe(
      'https://ai-team-hq.vercel.app/?settings=connections',
    )
    expect(joinBase('https://ai-team-hq.vercel.app/', '/?settings=health')).toBe(
      'https://ai-team-hq.vercel.app/?settings=health',
    )
  })

  it('refuses a path that is not one of ours, however it is spelled', () => {
    const base = 'https://ai-team-hq.vercel.app'
    for (const path of [
      '/?settings=evil',
      '//evil.example/?settings=connections',
      'https://evil.example',
      '/?settings=connections&next=https://evil.example',
      '/admin',
      '',
    ]) {
      expect(joinBase(base, path), path).toBeNull()
    }
  })

  it('refuses a base that is not a plain https origin', () => {
    const path = '/?settings=connections'
    for (const base of [
      'http://ai-team-hq.vercel.app',
      'https://user:pass@ai-team-hq.vercel.app',
      'https://ai-team-hq.vercel.app/app',
      'https://ai-team-hq.vercel.app/?x=1',
      'not a url',
      '',
      undefined,
      null,
    ]) {
      expect(joinBase(base, path), String(base)).toBeNull()
    }
  })
})

describe('the Telegram notice', () => {
  const notice = googleWords('revoked', 'first', 'mail', true)
  const base = {
    staffName: null,
    staffTitle: null,
    body: notice.body,
    metadata: {
      confidence: 'high',
      evidence: 'verified',
      reviewed: false,
      sources: ['google:gmail'],
      contradictions: null,
      routine: true,
    },
    correlationId: '11111111-2222-3333-4444-555555555555',
    actions: [],
  } as const

  it('is a bold heading over short paragraphs, with bold section labels', () => {
    const text = pagerText({ ...base, notice: { heading: notice.heading } })
    expect(text.startsWith(`<b>${notice.heading}</b>\n\n`)).toBe(true)
    expect(text).toContain('<b>What to do</b>')
    expect(text).not.toMatch(/\*/)
    expect(text.split('\n\n').length).toBeGreaterThanOrEqual(4)
  })

  it('carries none of an answer furniture, even when the output was never reviewed', () => {
    const text = pagerText({ ...base, notice: { heading: notice.heading } })
    expect(text).not.toMatch(/Not reviewed/)
    expect(text).not.toMatch(/confident|checked against|nothing cited/i)
  })

  it('escapes what a heading or body could smuggle into the markup', () => {
    const text = pagerText({
      ...base,
      body: 'a <script> & b',
      notice: { heading: '<b>x</b>' },
    })
    expect(text).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(text).toContain('a &lt;script&gt; &amp; b')
  })

  it('has one URL button and no callback to answer, or no keyboard at all', () => {
    const keyboard = noticeKeyboard({
      label: 'Reconnect Google',
      url: 'https://x.example/?settings=connections',
    })
    expect(keyboard).toEqual([
      [{ text: 'Reconnect Google', url: 'https://x.example/?settings=connections' }],
    ])
    expect(JSON.stringify(keyboard)).not.toMatch(/callback_data/)
    expect(noticeKeyboard(undefined)).toEqual([])
  })
})

/** A stub that answers the three statements the composer makes, so the output's shape can be checked without a database. */
const stub = (decide: { notify: boolean; reason: string }, base: string | null): SqlExecutor =>
  ({
    execute: async (sql: string) => {
      if (sql.includes('app.incident_seen'))
        return {
          rows: [
            {
              r: { incident_id: 'x', notify: decide.notify, reason: decide.reason, occurrences: 7 },
            },
          ],
        }
      if (sql.includes('web.base_url')) return { rows: [{ base }] }
      throw new Error(`unexpected statement: ${sql.slice(0, 60)}`)
    },
  }) as unknown as SqlExecutor

describe('the output a failing Google duty returns', () => {
  const input = {
    office: '205669cc-c270-4f11-ad63-b7ac4f994340',
    duty: 'mail',
    problem: 'revoked',
    note: 'Google refused the stored refresh token (invalid_grant)',
  } as const

  it('speaks on a first alert, with a real button and no error vocabulary', async () => {
    const out = await googleProblemOutput(
      stub({ notify: true, reason: 'first' }, 'https://ai-team-hq.vercel.app'),
      input,
    )
    expect(out.announce).toBe(true)
    expect(out.notice?.link?.url).toBe('https://ai-team-hq.vercel.app/?settings=connections')
    expect(out.body).toMatch(/Reconnect Google below/)
    expect(out.notice?.link?.label).toBe('Reconnect Google')
    expect(`${out.notice?.heading}\n${out.body}`).not.toMatch(JARGON)
  })

  it('is silent while the person has already been told', async () => {
    const out = await googleProblemOutput(
      stub({ notify: false, reason: 'quiet' }, 'https://ai-team-hq.vercel.app'),
      input,
    )
    expect(out.announce).toBe(false)
  })

  it('does not promise a button when the deployment has no address to open', async () => {
    const out = await googleProblemOutput(stub({ notify: true, reason: 'first' }, null), input)
    expect(out.notice?.link).toBeUndefined()
    expect(out.body).not.toMatch(/Reconnect Google|\bbelow\b|\bbutton\b/i)
    expect(out.body).toMatch(/Settings/)
  })

  it('uses one topic per problem, whichever duty reports it', async () => {
    const db = stub({ notify: true, reason: 'first' }, null)
    const a = await googleProblemOutput(db, input)
    const b = await googleProblemOutput(db, { ...input, duty: 'calendar' })
    expect(a.topic).toBe(b.topic)
  })

  it('FAILS OPEN: if the incident layer cannot be reached the person is told, never silenced', async () => {
    const broken = {
      execute: async (sql: string) => {
        if (sql.includes('web.base_url')) return { rows: [{ base: null }] }
        throw new Error('connection timeout')
      },
    } as unknown as SqlExecutor
    const out = await googleProblemOutput(broken, input)
    expect(out.announce).toBe(true)
  })
})

describe('recovery', () => {
  const db = (closed: number, told: boolean): SqlExecutor =>
    ({
      execute: async () => ({ rows: [{ r: { resolved: closed, was_told: told } }] }),
    }) as unknown as SqlExecutor

  it('says so once, and only when the person had been told it was broken', async () => {
    const out = await googleRecoveryOutput(db(1, true), { office: 'o', duty: 'mail' })
    expect(out?.announce).toBe(true)
    expect(out?.notice?.heading).toMatch(/working again/i)
  })

  it('says nothing when nothing was open, or when the person was never told', async () => {
    expect(await googleRecoveryOutput(db(0, false), { office: 'o', duty: 'mail' })).toBeNull()
    expect(await googleRecoveryOutput(db(1, false), { office: 'o', duty: 'mail' })).toBeNull()
  })

  it('says nothing when the check itself cannot be made', async () => {
    const broken = {
      execute: async () => {
        throw new Error('timeout')
      },
    } as unknown as SqlExecutor
    expect(await googleRecoveryOutput(broken, { office: 'o', duty: 'calendar' })).toBeNull()
  })
})
