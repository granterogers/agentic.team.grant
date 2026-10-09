/**
 * The database link, told apart from a statement the database refused, and the one retry that depends on it (#443).
 *
 * `retryOnLinkFailure` is for writes that RECORD what already happened. It must retry a link blip, must not retry anything the
 * database refused (a retry of a refusal repeats the refusal and hides it), must be bounded, and must hand back the last error
 * unchanged. The worker wires it around the two writes of a handler's failure path; the wiring is asserted on the expression, not
 * on a name appearing in the file.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { looksLikeDatabaseLinkFailure, retryOnLinkFailure } from '../../src/db/link-failure.ts'

const blip = () => new Error('Failed to run sql query: write CONNECT_TIMEOUT 10.0.0.1:5432')
const refusal = () => new Error('23514: new row for relation "jobs" violates check constraint')
const noSleep = async () => undefined

describe('what counts as the link', () => {
  it('recognises the edge worker, node-postgres and platform wordings', () => {
    expect(looksLikeDatabaseLinkFailure(blip())).toBe(true)
    expect(
      looksLikeDatabaseLinkFailure(
        new Error('57P01: terminating connection due to administrator command'),
      ),
    ).toBe(true)
    expect(looksLikeDatabaseLinkFailure(Object.assign(new Error('x'), { status: 503 }))).toBe(true)
  })
  it('never calls a refused statement a link failure (the control)', () => {
    expect(looksLikeDatabaseLinkFailure(refusal())).toBe(false)
    expect(
      looksLikeDatabaseLinkFailure(new Error('22021: invalid byte sequence for encoding')),
    ).toBe(false)
    expect(looksLikeDatabaseLinkFailure('CONNECT_TIMEOUT')).toBe(false)
  })
})

describe('retryOnLinkFailure', () => {
  it('retries a blip and returns the eventual answer', async () => {
    let calls = 0
    const r = await retryOnLinkFailure(
      async () => {
        calls += 1
        if (calls < 3) throw blip()
        return 'ok'
      },
      [1, 1, 1],
      noSleep,
    )
    expect(r).toBe('ok')
    expect(calls).toBe(3)
  })
  it('does not retry a refusal: one call, the same error', async () => {
    let calls = 0
    const e = refusal()
    await expect(
      retryOnLinkFailure(
        async () => {
          calls += 1
          throw e
        },
        [1, 1, 1],
        noSleep,
      ),
    ).rejects.toBe(e)
    expect(calls).toBe(1)
  })
  it('is bounded: an outage that outlasts the delays is rethrown after delays + 1 calls', async () => {
    let calls = 0
    await expect(
      retryOnLinkFailure(
        async () => {
          calls += 1
          throw blip()
        },
        [1, 1],
        noSleep,
      ),
    ).rejects.toThrow(/CONNECT_TIMEOUT/)
    expect(calls).toBe(3)
  })
})

describe('the worker records a handler failure through it', () => {
  const source = readFileSync('src/jobs/worker.ts', 'utf8')
  it('wraps the claim check', () => {
    expect(source).toMatch(
      /await retryOnLinkFailure\(\(\) => assertHeld\(db, job\)\)\s+const retryable = await mayRetry/,
    )
  })
  it('wraps the move to retrying or failed, with the handler reason', () => {
    expect(source).toMatch(
      /await retryOnLinkFailure\(\(\) =>\s+moveJob\(\s+db,\s+job,\s+retryable \? 'retrying' : 'failed',\s+`handler threw:/,
    )
  })
})
