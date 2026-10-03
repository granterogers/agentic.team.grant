/**
 * #407: google.read_mail and google.read_calendar failed `no_office` every hour once a second person office existed.
 *
 * Both handlers called `refreshMail(db)` / `refreshCalendar(db)` with no office, so the library fell back to "the only
 * person office", which is `no_office` by design the moment there are two. The trusted source of the office is the
 * claimed job's own (`app.job_office`, fixed when the duty made the job), not a guess and not request input.
 *
 * These drive the REAL handlers with an executor that records every statement, under two different offices, and with a
 * job that has no office at all.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { calendarHandler } from '../../src/handlers/calendar.ts'
import { mailHandler } from '../../src/handlers/mail.ts'
import type { Job } from '../../src/jobs/worker.ts'

const OFFICE_A = '2a2cd4d4-0000-4000-8000-000000000001'
const OFFICE_B = '205669cc-0000-4000-8000-000000000002'
const JOB = '11111111-1111-4111-8111-111111111111'

/** Answers the questions the handlers ask; the integration is switched off so nothing reaches Google. */
const executor = (office: string | 'missing') => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql)
      if (/app\.job_office\(/.test(sql) && !/forget_mail/.test(sql)) {
        if (office === 'missing') throw new Error('no_office')
        return { rows: [{ o: office }] }
      }
      if (/gmail\.enabled|calendar\.enabled/.test(sql)) return { rows: [{ on: false }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, seen }
}
const job = { jobId: JOB } as unknown as Job

describe.each([
  ['google.read_mail', mailHandler],
  ['google.read_calendar', calendarHandler],
])('%s acts in the claimed job’s office', (_kind, make) => {
  it.each([OFFICE_A, OFFICE_B])(
    'for the job of office %s it asks the JOB, and never the only-person fallback',
    async (office) => {
      const { db, seen } = executor(office)
      await make(db).handle(job, {} as never)
      expect(seen.some((s) => s.includes(`app.job_office('${JOB}'`))).toBe(true)
      expect(seen.some((s) => s.includes('sole_person_office'))).toBe(false)
    },
  )

  it('fails closed when the job has no office: it throws, it does not pick one', async () => {
    const { db, seen } = executor('missing')
    await expect(make(db).handle(job, {} as never)).rejects.toThrow('no_office')
    expect(seen.some((s) => s.includes('sole_person_office'))).toBe(false)
  })
})
