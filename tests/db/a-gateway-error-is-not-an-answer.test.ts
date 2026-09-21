/**
 * A 5xx from the gateway is not an answer from Postgres.
 *
 * `ManagementApiExecutor` retried `new Set([429, 503])`. On 21 September the
 * Supabase gateway returned **502 with an HTML body** twice in one run of
 * `verify:failures`, at two different call sites, while six single-statement
 * probes taken a minute later all succeeded. A 502 was raised immediately as
 * though Postgres had said something, so the suite reported RED for a reason
 * that had nothing to do with the office — the exact failure the executor's
 * own comment exists to forbid.
 *
 * It matters beyond the suites: `supabase/functions/worker/index.ts` falls
 * back to this executor whenever the direct Postgres connection is
 * unavailable, so a transient 502 there burns a job ATTEMPT, and five burnt
 * attempts is a permanently failed job.
 *
 * The fix states the property rather than extending the list, because the two
 * layers use disjoint ranges: Postgres answers as a **400** carrying a
 * `message`, and anything **5xx** is the transport. This pins that boundary in
 * both directions — an infra status must be retried, and an answer must not
 * be, or a bad token costs thirty seconds before it says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

/** The real shape: Postgres errors arrive as a 400 with a JSON `message`. */
const pgError = (): Response =>
  new Response(
    JSON.stringify({ message: 'Failed to run sql query: ERROR:  42601: syntax error' }),
    {
      status: 400,
    },
  )

/** The real shape of the 502: Cloudflare HTML, no JSON anywhere in it. */
const gatewayHtml = (status: number): Response =>
  new Response('<!DOCTYPE html><html><title>supabase.com | 502: Bad gateway</title></html>', {
    status,
  })

const ok = (): Response => new Response(JSON.stringify([{ n: 1 }]), { status: 200 })

/**
 * Drive `execute` while flushing the backoff sleeps, which are 2s, 4s, 8s and
 * 16s of real time and would otherwise make this test half a minute long.
 */
async function run(responses: Response[]): Promise<{ calls: number; threw: string | null }> {
  let calls = 0
  const fetchStub = vi.fn(async (): Promise<Response> => {
    const next = responses[Math.min(calls, responses.length - 1)]
    calls += 1
    return next as Response
  })
  vi.stubGlobal('fetch', fetchStub)

  const db = new ManagementApiExecutor('a-project-ref', 'a-token')
  let threw: string | null = null
  const pending = db.execute('select 1').catch((error: unknown) => {
    threw = (error as Error).message
  })
  // Generously past the whole 30s ladder; resolves pending timers and the
  // microtasks between them.
  for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(30_000)
  await pending
  return { calls, threw }
}

describe('what the executor treats as worth asking again', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a 502 and succeeds when the gateway comes back', async () => {
    const { calls, threw } = await run([gatewayHtml(502), ok()])
    expect(threw).toBeNull()
    expect(calls).toBe(2)
  })

  it('retries a 504 as well — the list was never the point', async () => {
    const { calls, threw } = await run([gatewayHtml(504), gatewayHtml(504), ok()])
    expect(threw).toBeNull()
    expect(calls).toBe(3)
  })

  it('still retries a throttle, which is what the ladder was built for', async () => {
    const { calls, threw } = await run([new Response('', { status: 429 }), ok()])
    expect(threw).toBeNull()
    expect(calls).toBe(2)
  })

  it('gives up after five attempts rather than retrying for ever', async () => {
    const { calls, threw } = await run([gatewayHtml(502)])
    expect(threw).not.toBeNull()
    expect(calls).toBe(5)
  })

  /*
    The other direction, and the reason this is a property rather than
    `status >= 400`. A whitelist fails by refusing to speak; a blanket retry
    fails by taking thirty seconds to repeat a syntax error four times.
  */
  it('raises a Postgres error at once, surfacing the message rather than the status', async () => {
    const { calls, threw } = await run([pgError()])
    expect(calls).toBe(1)
    expect(threw).toContain('42601')
  })

  it('raises a bad token at once', async () => {
    const { calls, threw } = await run([new Response('', { status: 401 })])
    expect(calls).toBe(1)
    expect(threw).not.toBeNull()
  })
})
