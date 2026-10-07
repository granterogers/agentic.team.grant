/**
 * The last word a failed turn owes is a notice, not an unreviewed answer.
 *
 * Version 1 acceptance, journey J: with every provider failing the person got exactly one code-composed apology, and
 * under it `not reviewed yet — I would not rely on this as it stands`. The caption says a model drafted something and
 * nobody checked it. The apology is no such thing, and a caption that does not fit a notice teaches the person to
 * ignore the caption on the answers it is for.
 *
 * The fix marks the KIND (`HandlerOutput.notice`) and every surface reads it; none matches the sentence. Negative
 * controls: a genuine unreviewed model answer keeps its caption on the reply path, in the pager and in Slack's label.
 */
import { describe, expect, it } from 'vitest'
import { replyText } from '../../src/channels/reply.ts'
import { apology, lastWord, parkedNotice } from '../../src/jobs/lastword.ts'
import type { HandlerOutput, Job } from '../../src/jobs/worker.ts'
import { pagerText } from '../../src/telegram/message.ts'

const CAPTION = /not reviewed yet|rely on this/i
const job = {
  jobId: '00000000-0000-0000-0000-0000000000bb',
  correlationId: '00000000-0000-0000-0000-0000000000cc',
  projectId: null,
  kind: 'office.instruction',
} as unknown as Job

/** What the notifier is handed when the last word is spoken, from the real `lastWord`. */
const spoken = async (parked: boolean): Promise<HandlerOutput> => {
  let given: HandlerOutput | undefined
  const db = {
    execute: async (sql: string) => {
      if (sql.includes('owed_a_word')) {
        return {
          rows: [
            { channel: 'telegram', account_ref: 'b', target_ref: '1', thread_ref: null, kind: 'k' },
          ],
        }
      }
      if (sql.includes('claim_last_word')) return { rows: [{ won: true }] }
      if (sql.includes('voice_file_id')) return { rows: [{ spoken: false }] }
      if (sql.includes('insert into public.outputs')) return { rows: [{ id: 'o-1' }] }
      return { rows: [] }
    },
  }
  const outcome = await lastWord(
    db as never,
    job,
    (async (_j: Job, o: HandlerOutput) => {
      given = o
      return { delivered: true }
    }) as never,
    parked,
  )
  expect(outcome).toBe('told')
  return given as HandlerOutput
}

describe('the last word is a notice by kind', () => {
  for (const parked of [false, true]) {
    it(`${parked ? 'a parked turn' : 'a failed turn'}: the output carries the notice marker`, async () => {
      const out = await spoken(parked)
      expect(out.notice).toBeDefined()
      expect(out.body).toBe(parked ? parkedNotice() : apology(false))
    })
    it(`${parked ? 'a parked turn' : 'a failed turn'}: the person reads the sentence and no caption`, async () => {
      const out = await spoken(parked)
      const text = replyText(out, { reviewed: false })
      expect(text).toBe(out.body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      expect(text).not.toMatch(CAPTION)
    })
  }
  it('the pager says it without the warning or the provenance line, whatever the review state', async () => {
    const out = await spoken(false)
    const text = pagerText({
      staffName: null,
      staffTitle: null,
      body: out.body,
      metadata: {
        confidence: 'high',
        evidence: 'inferred',
        sources: [],
        contradictions: null,
        reviewed: false,
        routine: false,
      },
      correlationId: job.correlationId,
      actions: [],
      ...(out.notice === undefined ? {} : { notice: out.notice }),
    } as never)
    expect(text).not.toMatch(/Not reviewed|Nobody has checked/i)
    expect(text).toContain('this attempt simply did not finish')
  })
})

describe('negative controls: a genuine unreviewed model answer keeps its caption', () => {
  const answer: Pick<HandlerOutput, 'body' | 'notice'> = {
    body: 'The deposit is due on 1 November.',
  }
  it('reply path: unreviewed answer is captioned, reviewed is not', () => {
    expect(replyText(answer, { reviewed: false })).toMatch(CAPTION)
    expect(replyText(answer, { reviewed: true })).not.toMatch(CAPTION)
  })
  it('reply path: the notice marker is what removes it, not the wording (the same words, no marker, keep the caption)', () => {
    const sameWords = { body: apology(false) }
    expect(replyText(sameWords, { reviewed: false })).toMatch(CAPTION)
    expect(replyText({ ...sameWords, notice: {} }, { reviewed: false })).not.toMatch(CAPTION)
  })
  it('reply path: an incident notice with a heading shows the heading and no caption', () => {
    const t = replyText(
      { body: 'Reconnect Google.', notice: { heading: 'Google needs you' } },
      { reviewed: false },
    )
    expect(t).toContain('<b>Google needs you</b>')
    expect(t).not.toMatch(CAPTION)
  })
  it('pager: an unreviewed answer is warned about, as before', () => {
    const text = pagerText({
      staffName: null,
      staffTitle: null,
      body: answer.body,
      metadata: {
        confidence: 'medium',
        evidence: 'inferred',
        sources: [],
        contradictions: null,
        reviewed: false,
        routine: false,
      },
      correlationId: job.correlationId,
      actions: [],
    } as never)
    expect(text).toMatch(/Not reviewed/)
  })
})
