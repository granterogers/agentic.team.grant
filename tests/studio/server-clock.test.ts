import { describe, expect, it } from 'vitest'

// @ts-expect-error — a browser module with no types; ADR-0002, no build step.
import { noteServerDate, serverNow } from '../../web/studio/net.js'

const answer = (date: string | null) =>
  ({
    headers: { get: (name: string) => (name.toLowerCase() === 'date' ? date : null) },
  }) as unknown as Response

describe("the page's time agrees with the server's, not with a wrong computer clock (A3)", () => {
  it('follows a server clock that is ahead of this computer', () => {
    const serverTime = new Date(Date.now() + 92_000).toUTCString()
    noteServerDate(answer(serverTime))
    expect(Math.abs(serverNow() - (Date.now() + 92_000))).toBeLessThan(2000)
  })

  it('a response without a Date header leaves the page on its last known offset', () => {
    noteServerDate(answer(new Date(Date.now() + 5_000).toUTCString()))
    const before = serverNow() - Date.now()
    noteServerDate(answer(null))
    expect(Math.abs(serverNow() - Date.now() - before)).toBeLessThan(50)
  })

  it('a malformed Date header is ignored', () => {
    noteServerDate(answer(new Date(Date.now() + 7_000).toUTCString()))
    const before = serverNow() - Date.now()
    noteServerDate(answer('not a date'))
    expect(Math.abs(serverNow() - Date.now() - before)).toBeLessThan(50)
  })
})
