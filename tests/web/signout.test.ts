/**
 * Sign out (#405), the parts a browser run cannot isolate: which keys survive, the epoch fence, and that the control is
 * wired to the module. The real-browser proof is scripts/p5/signout.ts.
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const fakeStorage = (initial: Record<string, string>) => {
  const s: Record<string, string> = { ...initial }
  for (const [name, fn] of Object.entries({
    getItem: (k: string) => s[k] ?? null,
    setItem: (k: string, v: string) => {
      s[k] = v
    },
    removeItem: (k: string) => {
      delete s[k]
    },
    clear: () => {
      for (const k of Object.keys(s)) delete s[k]
    },
  }))
    Object.defineProperty(s, name, { value: fn, enumerable: false })
  return s
}

afterEach(() => vi.unstubAllGlobals())

describe('signing out', () => {
  it('keeps only the device preferences, and removes every other key by class (a key nobody listed included)', async () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage({
        'hq.session': 'x',
        'hq.token': 'y',
        'studio.chat': '{"a":1}',
        'studio.plane.some-project': '{}',
        'bc.todos.memory.p': '[]',
        'a.key.added.next.month': 'z',
        'studio.appearance': '{"scheme":"dark"}',
        'studio.rail': 'open',
        'bc.compose': 'c',
      }),
    )
    vi.stubGlobal('sessionStorage', fakeStorage({ draft: 'secret' }))
    const { signOut, DEVICE_KEYS } = await import('../../web/studio/signout.js')
    await signOut({ reload: false })
    expect(Object.keys(localStorage).sort()).toEqual([
      'bc.compose',
      'studio.appearance',
      'studio.rail',
    ])
    expect(Object.keys(sessionStorage)).toEqual([])
    // the allow-list names no key that can carry a person's work
    expect(
      DEVICE_KEYS.filter((k: string) => /chat|token|session|note|todo|contact|plane|tab/.test(k)),
    ).toEqual([])
  })

  it('moves the epoch, so a response begun earlier is told apart from one begun after', async () => {
    vi.stubGlobal('localStorage', fakeStorage({}))
    vi.stubGlobal('sessionStorage', fakeStorage({}))
    const { signOut, current } = await import('../../web/studio/signout.js')
    const session = await import('../../web/studio/session.js')
    const began = session.epoch()
    expect(current(began)).toBe(true)
    await signOut({ reload: false })
    expect(current(began)).toBe(false)
    expect(current(session.epoch())).toBe(true)
  })

  it('is wired: the header draws the control for a signed-in browser and the shell presses the module, and each reader checks the epoch', () => {
    const shell = readFileSync('web/studio/bc/shell.js', 'utf8')
    const wire = readFileSync('web/studio/bc/wire.js', 'utf8')
    expect(shell).toMatch(/canWrite\(\)\s*\?\s*`<button[^`]*data-bc-signout/)
    expect(wire).toMatch(/\[data-bc-signout\][\s\S]{0,200}signOut\(\)/)
    for (const f of ['office.js', 'chat.js', 'data.js'])
      expect(readFileSync(`web/studio/${f}`, 'utf8'), f).toMatch(/began !== \w+\.epoch\(\)/)
  })
})
