/**
 * B-05 (login CSRF): the studio adopted any session an address fragment carried. These drive the pure decision
 * (web/studio/flow.js) with every way a return can be wrong, and drive session.adopt()/askForLink() themselves
 * under a stubbed window so the wiring is what is proved, not the existence of a function.
 *
 * Positive controls sit beside each refusal: a flow the browser started adopts exactly once.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

type Store = {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
  raw: Record<string, string>
}
const memory = (): Store => {
  const raw: Record<string, string> = {}
  return {
    raw,
    getItem: (k) => raw[k] ?? null,
    setItem: (k, v) => {
      raw[k] = v
    },
    removeItem: (k) => {
      delete raw[k]
    },
  }
}

type Decision = {
  touched: boolean
  search?: string
  session?: { access_token: string; refresh_token: string; expires_at: number } | null
  problem?: string
}
type Flow = {
  FLOW_KEY: string
  FLOW_TTL_MS: number
  MAX_PENDING: number
  OTHER_BROWSER: string
  begin: (s: Store, o: { kind?: string; email?: string }, now: number, bytes: number[]) => string
  decide: (o: {
    hash: string
    search: string
    store: Store
    now: number
    kind?: string
  }) => Decision
  pending: (s: Store, now: number) => { nonce: string; kind: string }[]
  returnAddress: (origin: string, pathname: string, nonce: string) => string
}
// @ts-expect-error -- a plain browser module, no declaration file
const flow = (await import('../../web/studio/flow.js')) as Flow

const NOW = 1_800_000_000_000
const bytes = (seed: number): number[] => Array.from({ length: 24 }, (_, i) => (seed + i * 7) % 256)
const frag = (o: Record<string, string>): string => `#${new URLSearchParams(o).toString()}`
const TOKENS = { access_token: 'acc.tok.en', refresh_token: 'ref-tok', expires_in: '3600' }

const started = (store: Store, seed = 1, kind = 'link'): string =>
  flow.begin(store, { kind, email: 'me@example.com' }, NOW, bytes(seed))

describe('the decision about a returning address', () => {
  it('POSITIVE CONTROL: a flow this browser started adopts exactly once', () => {
    const store = memory()
    const nonce = started(store)
    expect(nonce).toMatch(/^[a-z0-9]{24,64}$/)
    const first = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonce}&keep=1`,
      store,
      now: NOW + 1000,
    })
    expect(first.touched).toBe(true)
    expect(first.session?.access_token).toBe('acc.tok.en')
    expect(first.session?.refresh_token).toBe('ref-tok')
    expect(first.session?.expires_at).toBe(NOW + 1000 + 3600_000)
    expect(first.problem).toBe('')
    expect(first.search).toBe('?keep=1') // the nonce leaves the address, other query stays
    // replay of the very same link
    const second = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonce}`,
      store,
      now: NOW + 2000,
    })
    expect(second.session).toBeNull()
    expect(second.problem).toBe(flow.OTHER_BROWSER)
  })

  it('an unsolicited token with no pending flow is NOT stored, and the fragment is taken', () => {
    const store = memory()
    const d = flow.decide({ hash: frag(TOKENS), search: '', store, now: NOW })
    expect(d.touched).toBe(true) // touched: the caller must remove the fragment
    expect(d.session).toBeNull()
    expect(d.problem).toBe(flow.OTHER_BROWSER)
    expect(d.search).toBe('')
  })

  it('a token carrying a flow nobody here started is refused (an attacker cannot know a victim nonce)', () => {
    const store = memory()
    started(store)
    const d = flow.decide({
      hash: frag(TOKENS),
      search: '?flow=attackerchosennonce1234567890',
      store,
      now: NOW,
    })
    expect(d.session).toBeNull()
    // and the victim's own pending flow was not spent by it
    expect(flow.pending(store, NOW)).toHaveLength(1)
  })

  // OWNER DECISION (15 October 2026, single-person office): a return that lost its flow marker in transit is adopted
  // against the newest pending link this browser asked for. The trade-off is that an attacker's link opened in a
  // browser that has a request of its own pending is accepted. The control below is the one that must still hold.
  it('a token WITHOUT a flow marker is adopted only against this browser’s newest pending link, once', () => {
    const store = memory()
    started(store)
    const d = flow.decide({ hash: frag(TOKENS), search: '', store, now: NOW })
    expect(d.session).not.toBeNull()
    expect(flow.pending(store, NOW)).toHaveLength(0)
    expect(flow.decide({ hash: frag(TOKENS), search: '', store, now: NOW }).session).toBeNull()
  })

  it('a token WITHOUT a flow marker is refused when this browser has no pending link', () => {
    const store = memory()
    const d = flow.decide({ hash: frag(TOKENS), search: '', store, now: NOW })
    expect(d.session).toBeNull()
    expect(d.problem).not.toBe('')
  })

  it('an expired flow is refused', () => {
    const store = memory()
    const nonce = started(store)
    const late = NOW + flow.FLOW_TTL_MS + 1
    const d = flow.decide({ hash: frag(TOKENS), search: `?flow=${nonce}`, store, now: late })
    expect(d.session).toBeNull()
    // control: one millisecond inside the deadline still adopts
    const store2 = memory()
    const n2 = started(store2)
    const ok = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${n2}`,
      store: store2,
      now: NOW + flow.FLOW_TTL_MS - 1,
    })
    expect(ok.session?.access_token).toBe('acc.tok.en')
  })

  it('a nonce for a different flow kind is refused', () => {
    const store = memory()
    const nonce = started(store, 3, 'something-else')
    const d = flow.decide({ hash: frag(TOKENS), search: `?flow=${nonce}`, store, now: NOW })
    expect(d.session).toBeNull()
    // control: the same nonce is accepted when that is the kind being asked for
    const ok = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonce}`,
      store,
      now: NOW,
      kind: 'something-else',
    })
    expect(ok.session?.access_token).toBe('acc.tok.en')
  })

  it('a token together with an error is not adopted, even for a valid flow, and the flow is spent', () => {
    const store = memory()
    const nonce = started(store)
    const d = flow.decide({
      hash: frag({ ...TOKENS, error: 'access_denied', error_description: 'Link+expired' }),
      search: `?flow=${nonce}`,
      store,
      now: NOW,
    })
    expect(d.session).toBeNull()
    expect(d.problem).toBe('Link expired')
    expect(flow.pending(store, NOW)).toHaveLength(0)
  })

  it('an error fragment without a flow shows no text the fragment chose (no injected message)', () => {
    const store = memory()
    const d = flow.decide({
      hash: frag({ error_description: 'Your account is suspended, call 555-0100' }),
      search: '',
      store,
      now: NOW,
    })
    expect(d.session).toBeNull()
    expect(d.problem).toBe(flow.OTHER_BROWSER)
    expect(d.problem).not.toContain('555')
  })

  it('a fragment with only a refresh_token is never adopted', () => {
    const store = memory()
    const nonce = started(store)
    const d = flow.decide({
      hash: frag({ refresh_token: 'ref-tok' }),
      search: `?flow=${nonce}`,
      store,
      now: NOW,
    })
    expect(d.touched).toBe(true)
    expect(d.session).toBeNull()
    const none = flow.decide({
      hash: frag({ refresh_token: 'ref-tok' }),
      search: '',
      store: memory(),
      now: NOW,
    })
    expect(none.session).toBeNull()
  })

  it('an unrelated fragment is none of our business and is left alone', () => {
    const d = flow.decide({ hash: '#section-2', search: '', store: memory(), now: NOW })
    expect(d.touched).toBe(false)
    expect(flow.decide({ hash: '', search: '', store: memory(), now: NOW }).touched).toBe(false)
  })

  it('a corrupt or hostile stored list is no pending flow, and never throws', () => {
    for (const junk of ['not json', '{"a":1}', '[null,5,"x",{"nonce":5}]', '[{"nonce":"short"}]']) {
      const store = memory()
      store.raw[flow.FLOW_KEY] = junk
      expect(() =>
        flow.decide({ hash: frag(TOKENS), search: '?flow=abc', store, now: NOW }),
      ).not.toThrow()
      expect(
        flow.decide({ hash: frag(TOKENS), search: '?flow=abc', store, now: NOW }).session,
      ).toBeNull()
    }
  })

  it('several links in flight each adopt once, up to the cap; the oldest beyond it is dropped', () => {
    const store = memory()
    const nonces = Array.from({ length: flow.MAX_PENDING + 1 }, (_, i) => started(store, i + 10))
    expect(new Set(nonces).size).toBe(nonces.length) // different bytes, different nonces
    expect(flow.pending(store, NOW)).toHaveLength(flow.MAX_PENDING)
    const oldest = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonces[0]}`,
      store,
      now: NOW,
    })
    expect(oldest.session).toBeNull()
    const newest = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonces[nonces.length - 1]}`,
      store,
      now: NOW,
    })
    expect(newest.session?.access_token).toBe('acc.tok.en')
  })

  it('begin reports a refusing store as no nonce, so no link is sent that would be refused', () => {
    const refusing = {
      raw: {},
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    } as Store
    expect(flow.begin(refusing, { email: 'a@b.co' }, NOW, bytes(1))).toBe('')
  })

  it('the return address carries the nonce and nothing else', () => {
    expect(flow.returnAddress('https://x.example', '/p', 'abc')).toBe(
      'https://x.example/p?flow=abc',
    )
    expect(flow.returnAddress('https://x.example', '/p', '')).toBe('https://x.example/p')
  })
})

describe('a password reset return', () => {
  type Reset = { session?: { recovery?: boolean; email?: string } | null; problem?: string }
  const decideReset = (
    store: Store,
    search: string,
    hash = frag({ ...TOKENS, type: 'recovery' }),
  ) => flow.decide({ hash, search, store, now: NOW }) as Reset

  it('POSITIVE CONTROL: a reset this browser asked for is adopted as a recovery session carrying the account email', () => {
    const store = memory()
    const nonce = started(store, 3)
    const d = decideReset(store, `?flow=${nonce}`)
    expect(d.session).not.toBeNull()
    expect(d.session?.recovery).toBe(true)
    expect(d.session?.email).toBe('me@example.com')
  })

  it('a reset is adopted once: a second use of the same return is refused', () => {
    const store = memory()
    const nonce = started(store, 4)
    decideReset(store, `?flow=${nonce}`)
    expect(decideReset(store, `?flow=${nonce}`).session ?? null).toBeNull()
  })

  it('a reset return with no pending request in this browser is refused', () => {
    const store = memory()
    const d = decideReset(store, '')
    expect(d.session ?? null).toBeNull()
    expect(d.problem).not.toBe('')
  })

  it('a sign-in link is not marked as a reset', () => {
    const store = memory()
    const nonce = started(store, 5)
    const d = flow.decide({
      hash: frag(TOKENS),
      search: `?flow=${nonce}`,
      store,
      now: NOW,
    }) as Reset
    expect(d.session?.recovery).not.toBe(true)
  })
})

describe('session.adopt() and askForLink() apply it', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  const boot = async (hash: string, search: string, store: Store) => {
    const replaced: string[] = []
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('window', {
      location: { hash, search, pathname: '/', origin: 'https://page.example' },
      history: { replaceState: (_a: unknown, _b: unknown, url: string) => replaced.push(url) },
    })
    // @ts-expect-error -- a plain browser module, no declaration file
    const session = (await import('../../web/studio/session.js')) as {
      adopt: () => boolean
      signedIn: () => boolean
      landed: { problem: string }
      askForLink: (email: string) => Promise<string>
    }
    return { session, replaced }
  }

  it('POSITIVE CONTROL: the link a browser asked for signs it in, once, and the address is cleaned', async () => {
    const store = memory()
    const nonce = started(store)
    const { session, replaced } = await boot(frag(TOKENS), `?flow=${nonce}`, store)
    expect(session.adopt()).toBe(true)
    expect(session.signedIn()).toBe(true)
    expect(replaced).toEqual(['/'])
    expect(JSON.parse(store.raw['hq.session'] ?? '{}').access_token).toBe('acc.tok.en')
    expect(session.adopt()).toBe(false) // replay in the same page load
  })

  it('an unsolicited token signs nobody in, and the fragment is still removed', async () => {
    const store = memory()
    const { session, replaced } = await boot(frag(TOKENS), '', store)
    expect(session.adopt()).toBe(false)
    expect(session.signedIn()).toBe(false)
    expect(store.raw['hq.session']).toBeUndefined()
    expect(replaced).toEqual(['/'])
    expect(session.landed.problem).toContain('not requested from this browser')
  })

  it('a wrong nonce signs nobody in', async () => {
    const store = memory()
    started(store)
    const { session } = await boot(frag(TOKENS), '?flow=wrongwrongwrongwrongwrong12', store)
    expect(session.adopt()).toBe(false)
    expect(store.raw['hq.session']).toBeUndefined()
  })

  it('askForLink remembers the flow and sends the office a return address carrying its nonce', async () => {
    const store = memory()
    const { session } = await boot('', '', store)
    const sent: { back?: string; action?: string }[] = []
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ ok: true, said: 'Check your email.' }), { status: 200 })
    })
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.map((_, i) => i * 5 + 1) })
    await session.askForLink('me@example.com')
    const back = sent[0]?.back ?? ''
    const nonce = new URL(back).searchParams.get('flow') ?? ''
    expect(back.startsWith('https://page.example/?flow=')).toBe(true)
    expect(flow.pending(store, Date.now()).map((f) => f.nonce)).toContain(nonce)
  })

  it('askForLink refuses to send when the browser will not remember the flow', async () => {
    const store = memory()
    const { session } = await boot('', '', store)
    store.setItem = () => {
      throw new Error('blocked')
    }
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.map((_, i) => i + 1) })
    await expect(session.askForLink('me@example.com')).rejects.toThrow(/blocking the storage/)
    expect(fetched).not.toHaveBeenCalled()
  })
})
