import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The edge worker used to treat one failed direct connection as final for the life of the instance (efficiency run, October
 * 2026). It retries once a cooldown has passed, and never on every kick. The worker cannot be loaded here (it is a Deno entry
 * point), so this reads the source and asserts the wired decision rather than a name: the connect is attempted when it was
 * never tried OR when it failed and the cooldown has passed, and the failure time is recorded when the connect returns null.
 */
const source = readFileSync(
  new URL('../../supabase/functions/worker/index.ts', import.meta.url),
  'utf8',
)
const block = source.slice(
  source.indexOf('if (direct === undefined ||'),
  source.indexOf('const db: SqlExecutor = direct ??'),
)

describe('the worker retries a failed direct connection after a cooldown', () => {
  it('connects when never tried or when the failure is older than the cooldown', () => {
    expect(block).toContain(
      'direct === undefined || (direct === null && Date.now() - directFailedAt > DIRECT_RETRY_AFTER_MS)',
    )
    expect(block).toContain('PostgresExecutor.connect(')
  })

  it('records when a connect failed, so the next kick does not pay the connect timeout again', () => {
    expect(block).toContain('if (direct === null) directFailedAt = Date.now()')
  })

  it('keeps the cooldown in minutes, not seconds (a failed connect costs its ten-second timeout)', () => {
    const m = /const DIRECT_RETRY_AFTER_MS = (\d+) \* 60_000/.exec(source)
    expect(m).not.toBeNull()
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(2)
  })

  it('control: the block is the connection decision and nothing else (the slice is bounded at both ends)', () => {
    expect(block.length).toBeGreaterThan(80)
    expect(block.length).toBeLessThan(600)
    expect(block).not.toContain('ManagementApiExecutor')
  })
})
