/**
 * A handler that spends a model may not claim it was deterministic.
 *
 * `slackRotationHandler` builds one `base` with
 * `path: 'deterministic_retrieval'` and spreads it into all five of its
 * returns. Four are templated and the claim is true. The fifth asks a model to
 * explain a renewal failure to Grant — and `enforce_deterministic_claim`
 * refuses the output of any correlation that spent an inference, so that
 * branch failed the job every single time it ran.
 *
 * Ten did, between 16 and 18 September 2026. Slack's config token expired with
 * nobody told, because the branch that exists to speak up is the branch the
 * check silenced.
 *
 * Asserted as a PROPERTY of the two paths rather than as one literal: the
 * branch that calls `sayAs` reports what the record says, and the branch that
 * does not still claims determinism — because losing the exemption everywhere
 * would send four routine, templated outputs a day through quality review for
 * nothing, which is the other way to get this wrong.
 */
import { describe, expect, it } from 'vitest'
import { slackRotationHandler } from '../../src/handlers/slack-rotation.ts'

const job = {
  jobId: '11111111-1111-4111-8111-111111111111',
  correlationId: '22222222-2222-4222-8222-222222222222',
} as never

/*
  The worker hands every handler a database as its second argument; this one
  closes over the one in its deps and ignores it, so the test has nothing
  useful to pass and says so rather than building a second stub that would
  imply it mattered.
*/
const NOT_USED = null as never

/** A database that answers the three questions this handler asks. */
const dbWith = (opts: { install: boolean; expiresAt: string | null; inferences: number }) => ({
  execute: async (sql: string) => {
    if (sql.includes('inference_usage')) return { rows: [{ n: opts.inferences }] }
    if (sql.includes('slack_app_credentials')) {
      return {
        rows: opts.install
          ? [
              {
                config_token_expires_at: opts.expiresAt,
                rotation_failures: 0,
                /*
                  Deliberately NOT token-shaped. `check:secrets` correctly
                  flagged the first draft of this line, which opened with
                  Slack's real refresh-token prefix — a scanner that learns to
                  ignore fixtures is a scanner that misses the real thing.

                  The handler only asks whether the string is empty, so any
                  non-empty value drives the same branch.
                */
                refresh: 'a refresh token would go here',
              },
            ]
          : [],
      }
    }
    return { rows: [] }
  },
})

describe('the Slack rotation handler and its determinism claim', () => {
  it('claims inference on the failure branch, because that branch asks a model', async () => {
    /*
      No router, so `sayAs` falls back to its template — but the CLAIM must
      still follow the record, not the code path taken this time. A correlation
      that spent a model call is inference whoever wrote the final sentence,
      and the handler cannot know which of its retries did.

      The expiry is in the past, so `shouldRotate` is true and the real call is
      attempted; with no network it fails, which is the branch under test.
    */
    const handler = slackRotationHandler({
      db: dbWith({ install: true, expiresAt: '2020-01-01T00:00:00Z', inferences: 1 }) as never,
      appId: 'A0TEST',
      router: null,
    })
    const out = await handler.handle(job, NOT_USED)
    expect(out.path).toBe('inference')
    expect(out.announce).toBe(true)
  }, 30_000)

  it('keeps the exemption on a templated branch, so routine runs skip review', async () => {
    // Expiry far in the future: "left alone", no model, no network.
    const handler = slackRotationHandler({
      db: dbWith({ install: true, expiresAt: '2099-01-01T00:00:00Z', inferences: 0 }) as never,
      appId: 'A0TEST',
      router: null,
    })
    const out = await handler.handle(job, NOT_USED)
    expect(out.path).toBe('deterministic_retrieval')
    expect(out.announce).toBe(false)
  })

  it('and on the no-install branch, which never reaches a model at all', async () => {
    const handler = slackRotationHandler({
      db: dbWith({ install: false, expiresAt: null, inferences: 9 }) as never,
      appId: 'A0TEST',
      router: null,
    })
    const out = await handler.handle(job, NOT_USED)
    expect(out.path).toBe('deterministic_retrieval')
  })
})
