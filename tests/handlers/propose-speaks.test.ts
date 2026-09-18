/**
 * #49's loop ends in a message, not in a table.
 *
 * `app.proposals_to_send` and `app.proposals_sent` were built by 0295 so
 * Claire tells Grant ONCE what the office cannot do. Neither had ever had a
 * production caller, so the office raised proposals correctly and then said
 * nothing — the only way he learned it was stuck was by opening the
 * Governance page and noticing. Same class as the Slack rotation defect: a
 * mechanism that exists, is correct, and never speaks.
 *
 * Asserted as properties, not wording: that the round SPEAKS when something
 * is waiting, that it stays QUIET when nothing is, that it marks the batch
 * against its own job so the claim is checkable, and that it sweeps first so
 * a failed delivery yesterday is recovered today.
 */
import { describe, expect, it } from 'vitest'
import { proposeHandler } from '../../src/handlers/propose.ts'

const JOB_ID = '33333333-3333-4333-8333-333333333333'
const job = { jobId: JOB_ID, correlationId: '44444444-4444-4444-8444-444444444444' } as never
const NOT_USED = null as never

/** Records the SQL it was asked, and answers the four questions the round asks. */
const dbWith = (waiting: unknown[], undelivered = 0) => {
  const asked: string[] = []
  return {
    asked,
    execute: async (sql: string) => {
      asked.push(sql)
      if (sql.includes('proposals_undeliver')) return { rows: [{ n: undelivered }] }
      if (sql.includes('raise_proposals')) return { rows: [{ r: { raised: 1, updated: 0 } }] }
      if (sql.includes('proposals_to_send')) return { rows: [{ r: waiting }] }
      if (sql.includes('proposals_sent')) return { rows: [{ n: waiting.length }] }
      if (sql.includes('inference_usage')) return { rows: [{ n: 0 }] }
      return { rows: [{ n: 1 }] }
    },
  }
}

const one = {
  id: '55555555-5555-4555-8555-555555555555',
  who: 'Research Director',
  needed: 'search the web',
  title: 'web search',
  remedy: 'enable web.search',
}

describe('the proposal round', () => {
  it('speaks when something is waiting, and names it', async () => {
    const db = dbWith([one])
    const out = await proposeHandler(db as never, null).handle(job, NOT_USED)
    expect(out.announce).toBe(true)
    expect(out.body).toContain('search the web')
    expect(out.body).toContain('Governance')
  })

  it('marks the batch against its OWN job, so the claim can be checked', async () => {
    const db = dbWith([one])
    await proposeHandler(db as never, null).handle(job, NOT_USED)
    const marked = db.asked.find((s) => s.includes('proposals_sent'))
    expect(marked).toBeDefined()
    expect(marked).toContain(one.id)
    // The job id is what `proposals_undeliver` checks the delivery against.
    // Without it a failed delivery loses the proposal for ever.
    expect(marked).toContain(JOB_ID)
  })

  it('sweeps BEFORE it sends, so yesterday failure is recovered today', async () => {
    const db = dbWith([one])
    await proposeHandler(db as never, null).handle(job, NOT_USED)
    const swept = db.asked.findIndex((s) => s.includes('proposals_undeliver'))
    const sent = db.asked.findIndex((s) => s.includes('proposals_sent'))
    expect(swept).toBeGreaterThanOrEqual(0)
    expect(swept).toBeLessThan(sent)
  })

  it('stays quiet when nothing is undelivered — a daily count is narration', async () => {
    const db = dbWith([])
    const out = await proposeHandler(db as never, null).handle(job, NOT_USED)
    expect(out.announce).toBe(false)
    expect(db.asked.some((s) => s.includes('proposals_sent'))).toBe(false)
  })

  it('says so when it had to put something back', async () => {
    const db = dbWith([], 2)
    const out = await proposeHandler(db as never, null).handle(job, NOT_USED)
    expect(out.body).toContain('put back')
  })

  it('drops a malformed row rather than marking a real proposal delivered', async () => {
    const db = dbWith([{ who: 'nobody' }, one])
    await proposeHandler(db as never, null).handle(job, NOT_USED)
    const marked = db.asked.find((s) => s.includes('proposals_sent'))
    expect(marked).toContain(one.id)
    expect(marked).not.toContain('undefined')
  })
})
