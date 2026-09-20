/**
 * A HANDLER IS NOT IN A POSITION TO CLAIM DETERMINISM, so the worker asks.
 *
 * 0023 refuses `deterministic_retrieval` from a job whose CORRELATION has
 * recorded inference usage. It is right to — determinism is a claim that
 * nothing was invented, and a handler cannot know that about a sentence a model
 * wrote — but what it did was FAIL the job, so a handler that got the claim
 * wrong did not mislabel an answer, it threw the answer away.
 *
 * Seventy-seven jobs across ten kinds had died that way when this was written:
 * `office.notion_sync` thirty times, `office.slack_rotate` ten, and
 * `office.extract_tasks` on every delegation the moment #282 made that path
 * reachable from an ordinary sentence.
 *
 * Patching each handler is the #249/#254 mistake. **A child shares its parent's
 * correlation**, so anything `office.instruction` enqueues inherits a spent
 * correlation before its own first line — the claim is not the handler's to
 * make. The worker asks the record, once, exactly as the constraint asks it.
 *
 * Not a weakening: the answer becomes true rather than absent, and `false` for
 * `deterministic` sends the output to review, which is the safer direction.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { howComposed } from '../../src/agents/provenance.ts'

/** A database that reports however many inferences the test wants it to. */
const withUsage = (n: number) => ({
  execute: async (_sql: string) => ({ rows: [{ n }] }),
})

describe('the determinism claim is corrected against the record', () => {
  it('a correlation that spent nothing keeps the claim', async () => {
    expect(await howComposed(withUsage(0), 'a1b2c3d4-0000-0000-0000-000000000000')).toBe(
      'deterministic_retrieval',
    )
  })

  it('a correlation that spent ONE inference loses it', async () => {
    /*
      One is the number that matters: the parent's semantic read alone is
      enough, and every child of a conversation starts from at least that.
    */
    expect(await howComposed(withUsage(1), 'a1b2c3d4-0000-0000-0000-000000000000')).toBe(
      'inference',
    )
  })

  it('an unreadable record assumes a model was called', async () => {
    /*
      The expensive direction is claiming an exemption the record cannot
      support, which fails the job and loses the answer. The cheap direction is
      one unnecessary review.
    */
    const broken = {
      execute: async (_sql: string): Promise<{ rows: readonly Record<string, unknown>[] }> => {
        throw new Error('no database')
      },
    }
    expect(await howComposed(broken, 'a1b2c3d4-0000-0000-0000-000000000000')).toBe('inference')
  })

  it('CONTROL: the worker asks it, rather than trusting the handler', () => {
    /*
      A source check, because the behavioural one needs a real correlation, a
      real inference row and a real insert. What went wrong is visible in the
      text: the worker used to pass `output.path` straight to `reviewRequired`.
    */
    const worker = readFileSync('src/jobs/worker.ts', 'utf8')
    expect(worker).toMatch(/await howComposed\(db, job\.jobId\)/)
    expect(worker).toMatch(/reviewRequired\(\{\s*\n\s*path: claimed,/)
  })
})
