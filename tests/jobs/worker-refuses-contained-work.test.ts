/**
 * The worker will not run external-reach work that did not come through a production door (deep systems audit, M17).
 *
 * `containmentRefusal` was well tested on its own. The call that makes it bite - `runJob` asking BEFORE the handler and
 * cancelling on a refusal - was matched by an `indexOf` and a regex, so disabling the branch left the suite green. This
 * drives the real `runJob` with a recording database and a handler that notes whether it ran, and asserts the outcome:
 * harness, unknown and unanswerable origins never reach the handler of an external kind and end `cancelled`, while a
 * trusted turn, an internal job and any origin for an INTERNAL kind do run (so it is not simply refusing everything).
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { type Handler, type HandlerOutput, type Job, runJob } from '../../src/jobs/worker.ts'

const job = (kind: string): Job => ({
  jobId: '44444444-4444-4444-8444-444444444444',
  kind,
  correlationId: 'corr',
  projectId: null,
  idempotencyKey: 'k',
  attempt: 1,
})

const output: HandlerOutput = {
  body: 'done',
  confidence: 'high',
  evidence: 'verified',
  sources: [],
  contradictions: null,
  path: 'deterministic_retrieval',
  model: null,
}

/** A database that answers the origin question as told, and records every statement. */
const database = (origin: string | 'throws' | 'missing') => {
  const sql: string[] = []
  const db: SqlExecutor = {
    kind: 'stub-origin-database',
    execute: async (statement: string) => {
      sql.push(statement)
      if (statement.includes('app.job_origin(')) {
        if (origin === 'throws') throw new Error('connection reset')
        return {
          rows: [{ o: origin === 'missing' ? 'trusted' : origin, known: origin !== 'missing' }],
        }
      }
      // moveJob's update ... returning job_id, and everything else the pipeline asks.
      return { rows: [{ job_id: '44444444-4444-4444-8444-444444444444' }] }
    },
  } as unknown as SqlExecutor
  return { db, sql }
}

const handlerFor = (kind: string, ran: { value: boolean }): Handler => ({
  kind,
  handle: async () => {
    ran.value = true
    return output
  },
})
const review = async () => ({ verdict: 'pass', notes: '' }) as never

const EXTERNAL = 'notebook.generate'
const INTERNAL = 'office.pursue'

describe('runJob: contained work never reaches the handler', () => {
  for (const origin of ['harness', 'unknown', 'throws', 'missing'] as const) {
    it(`an external kind from origin "${origin}" is cancelled and its handler never runs`, async () => {
      const { db, sql } = database(origin)
      const ran = { value: false }
      const result = await runJob(db, job(EXTERNAL), [handlerFor(EXTERNAL, ran)], review)
      expect(ran.value).toBe(false)
      expect(result.finalState).toBe('cancelled')
      expect(sql.some((s) => /state = 'cancelled'/.test(s))).toBe(true)
    })
  }

  for (const origin of ['trusted', 'internal'] as const) {
    it(`CONTROL: an external kind from origin "${origin}" does run`, async () => {
      const { db } = database(origin)
      const ran = { value: false }
      await runJob(db, job(EXTERNAL), [handlerFor(EXTERNAL, ran)], review)
      expect(ran.value).toBe(true)
    })
  }

  it('CONTROL: an internal kind runs whatever its origin (containment is about outside effects)', async () => {
    for (const origin of ['harness', 'unknown'] as const) {
      const { db } = database(origin)
      const ran = { value: false }
      await runJob(db, job(INTERNAL), [handlerFor(INTERNAL, ran)], review)
      expect(ran.value, origin).toBe(true)
    }
  })
})
