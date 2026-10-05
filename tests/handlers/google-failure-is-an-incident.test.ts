/**
 * #413: a Google duty that cannot work reports an INCIDENT, and what the person hears is the incident layer's decision.
 *
 * Drives the REAL mail and calendar handlers with a Google that answers `invalid_grant`, and an executor that records
 * every statement. The point is the wiring, which a unit test of the wording cannot see: the failure goes through
 * `app.incident_seen` (once a run), its verdict is what sets `announce`, the raw error is kept as evidence and never
 * said, and a run that works is the only thing that asks to close an incident.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { calendarHandler } from '../../src/handlers/calendar.ts'
import { mailHandler } from '../../src/handlers/mail.ts'
import type { Job } from '../../src/jobs/worker.ts'

const OFFICE = '205669cc-0000-4000-8000-000000000002'
const JOB = '11111111-1111-4111-8111-111111111111'
const job = { jobId: JOB } as unknown as Job

const CONNECTED = {
  client_id: 'client.apps.googleusercontent.com',
  client_secret: 'GOCSPX-secret',
  refresh_token: '1//refresh',
}

/** An executor that decides the incident question as told, and records everything. */
const executor = (
  verdict: { notify: boolean; reason: string },
  resolved = { resolved: 0, was_told: false },
) => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql)
      if (/app\.job_office\(/.test(sql) && !/incident_/.test(sql)) return { rows: [{ o: OFFICE }] }
      if (/gmail\.enabled|calendar\.enabled/.test(sql)) return { rows: [{ on: true }] }
      if (/as client_id/.test(sql)) return { rows: [CONNECTED] }
      if (/app\.incident_seen/.test(sql))
        return {
          rows: [
            {
              r: {
                incident_id: 'i',
                notify: verdict.notify,
                reason: verdict.reason,
                occurrences: 9,
              },
            },
          ],
        }
      if (/app\.incident_resolve/.test(sql)) return { rows: [{ r: resolved }] }
      if (/web\.base_url/.test(sql)) return { rows: [{ base: 'https://ai-team-hq.vercel.app' }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, seen }
}

const googleSays = (body: unknown, status = 400) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  )

afterEach(() => vi.unstubAllGlobals())

const JARGON = /invalid_grant|oauth|refresh[- ]token/i

describe.each([
  ['google.read_mail', mailHandler, 'mail'],
  ['google.read_calendar', calendarHandler, 'calendar'],
] as const)('%s with a revoked connection', (_kind, make, duty) => {
  it('reports one incident per run and is as loud as the incident layer says', async () => {
    googleSays({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    const first = executor({ notify: true, reason: 'first' })
    const out = await make(first.db).handle(job, {} as never)
    expect(first.seen.filter((s) => /app\.incident_seen/.test(s))).toHaveLength(1)
    expect(out.announce).toBe(true)
    expect(out.notice?.link?.url).toBe('https://ai-team-hq.vercel.app/?settings=connections')

    const again = executor({ notify: false, reason: 'quiet' })
    const quiet = await make(again.db).handle(job, {} as never)
    expect(quiet.announce).toBe(false)
  })

  it('keeps the raw error as evidence and never says it', async () => {
    googleSays({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    const { db, seen } = executor({ notify: true, reason: 'first' })
    const out = await make(db).handle(job, {} as never)
    expect(`${out.notice?.heading}\n${out.body}`).not.toMatch(JARGON)
    const call = seen.find((s) => /app\.incident_seen/.test(s)) ?? ''
    expect(call).toContain("'google'")
    expect(call).toContain('revoked')
    expect(call).toMatch(/invalid_grant/)
    expect(call).toContain(duty)
  })

  it('is about the claimed job’s office, never a guess', async () => {
    googleSays({ error: 'invalid_grant' })
    const { db, seen } = executor({ notify: true, reason: 'first' })
    await make(db).handle(job, {} as never)
    const call = seen.find((s) => /app\.incident_seen/.test(s)) ?? ''
    expect(call).toContain(`'${OFFICE}'::uuid`)
    expect(seen.some((s) => s.includes('sole_person_office'))).toBe(false)
  })

  it('does not close anything while Google is still refusing', async () => {
    googleSays({ error: 'invalid_grant' })
    const { db, seen } = executor({ notify: true, reason: 'first' })
    await make(db).handle(job, {} as never)
    expect(seen.some((s) => /app\.incident_resolve/.test(s))).toBe(false)
  })
})
