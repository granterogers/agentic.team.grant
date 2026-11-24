/**
 * "1 minute ago" for something made seconds ago was the browser clock running fast (A16).
 *
 * The words are now measured against the server's clock, the same clock A3 gave the chat and the timers. With the
 * browser 90 seconds fast and the server correct, an item made 30 seconds ago must read "just now", not "2 minutes ago".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import { noteServerDate } from '../../web/studio/net.js'
// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import * as when from '../../web/studio/when.js'

const answer = (date: string) =>
  ({
    headers: { get: (name: string) => (name.toLowerCase() === 'date' ? date : null) },
  }) as unknown as Response

afterEach(() => {
  vi.useRealTimers()
})

describe('relative times follow the server clock (A16)', () => {
  it('an item made 30 seconds ago reads "just now" when this computer is 90 seconds fast', () => {
    const server = Date.UTC(2026, 10, 19, 12, 0, 0)
    // This computer says 12:01:30; the server says 12:00:00.
    vi.useFakeTimers({ now: server + 90_000 })
    noteServerDate(answer(new Date(server).toUTCString()))
    const madeAt = new Date(server - 30_000).toISOString()
    expect(when.words(madeAt)).toBe('just now')
  })

  it('an explicit clock passed in is still honoured', () => {
    const at = new Date(Date.UTC(2026, 10, 19, 12, 0, 0)).toISOString()
    expect(when.words(at, Date.UTC(2026, 10, 19, 12, 2, 0))).toBe('2 minutes ago')
  })
})
