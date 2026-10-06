/*
  Ask again resends the SAME request, to the same people, and says so while it
  waits (#375 item 1).

  `retry()` called `ask(slug, said, context, token, to, onState)` against
  `ask(slug, text, context, token, to, also, onState)`, so the progress
  callback landed in the `also` slot. Two losses, both silent: the people Grant
  had asked alongside the addressee were dropped from the retried turn, and
  nothing redrew while it waited, so a retry looked frozen.

  Driven through the module's real exports with a stub `fetch` and a stub
  `localStorage`. The request body is what the office receives. The crew here
  is the prototype's, which has no staff slugs until the office hydrates it,
  so names travel in the studio's own vocabulary; the property is that a retry
  sends exactly what the first attempt did.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../web/studio/backend.js', async (real) => ({
  ...(await real<Record<string, unknown>>()),
  HQ_API: 'https://office.test/functions/v1/hq-api',
  VOICE: 'https://office.test/functions/v1/voice',
  UNCONFIGURED: 'no office configured',
}))
// chat.js asks whether a person is signed in (the prototype's conversations are only for somebody who is not) and whether
// they are a public Sample visitor (who asks through a different door). A retry is an ordinary signed-in person's act.
vi.mock('../../web/studio/session.js', () => ({
  forget: () => undefined,
  signedIn: () => true,
  isSample: () => false,
  visitorId: () => '',
}))

type Row = Record<string, unknown>
type Chat = {
  send: (slug: string, text: string, context: unknown, to?: string, also?: string[]) => Row[]
  ask: (
    slug: string,
    text: string,
    context: unknown,
    token: string,
    to?: string,
    also?: string[],
    onState?: () => void,
  ) => Promise<Row[]>
  retry: (slug: string, id: string, token: string, onState?: () => void) => Promise<Row[]>
  thread: (slug: string) => Row[]
  clear: (slug: string) => void
}

const SLUG = 'ai-learning'
const store = new Map<string, string>()
let bodies: Record<string, unknown>[] = []
let respond: () => Promise<Response>

beforeEach(() => {
  vi.useFakeTimers()
  store.clear()
  bodies = []
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  })
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body) as Record<string, unknown>)
    return respond()
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Through a variable, as tests/bc does: the studio is plain JavaScript with no types.
const WHERE = '../../web/studio/chat.js'
const chat = (await import(WHERE)) as Chat
const ok = (speak: string) => async () =>
  new Response(JSON.stringify({ speak, did: 'answered' }), { status: 200 })
const fails = async () =>
  new Response(JSON.stringify({ error: 'the office is down' }), { status: 500 })
/** A reply that arrives only when the test releases it, so the waiting states can be seen. */
const held = () => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  respond = async () => {
    await gate
    return ok('Here is the answer.')()
  }
  return () => release()
}

/** Send to Emma with Daniel, and let the first attempt fail. */
async function failedTurn() {
  chat.clear(SLUG)
  chat.send(SLUG, 'What does the venue change do to the budget?', null, 'emma', ['daniel'])
  respond = fails
  const first = chat.ask(
    SLUG,
    'What does the venue change do to the budget?',
    null,
    'tok',
    'emma',
    ['daniel'],
  )
  await vi.runAllTimersAsync()
  await first
  const row = chat.thread(SLUG).find((m) => m.bad === true)
  if (row === undefined)
    throw new Error('the first attempt did not fail, so there is nothing to retry')
  return String(row.id)
}

describe('chat.retry (#375 item 1)', () => {
  it('resends to the same addressee AND the same also-asked people', async () => {
    const id = await failedTurn()
    respond = ok('Here is the answer.')
    const retried = chat.retry(SLUG, id, 'tok')
    await vi.runAllTimersAsync()
    await retried
    expect(bodies).toHaveLength(2)
    const [first, again] = bodies as [Record<string, unknown>, Record<string, unknown>]
    // Whatever the first attempt sent, translated or not, is what a retry must send.
    expect(first.to).toBe('emma')
    expect(first.also).toEqual(['daniel'])
    expect(again.said).toBe(first.said)
    expect(again.to).toBe(first.to)
    expect(again.also).toEqual(first.also)
  })

  it('reports its progress while the office is thinking, and when the answer lands', async () => {
    const id = await failedTurn()
    const release = held()
    const seen: string[] = []
    const onState = vi.fn(() => {
      const row = chat.thread(SLUG).find((m) => m.id === id)
      seen.push(String(row?.waiting ?? 'answered'))
    })
    const retried = chat.retry(SLUG, id, 'tok', onState)
    await vi.advanceTimersByTimeAsync(500)
    expect(seen).toContain('sending')
    expect(seen).toContain('thinking')
    release()
    await vi.runAllTimersAsync()
    const after = await retried
    expect(after.find((m) => m.id === id)?.text).toBe('Here is the answer.')
  })

  it('rewrites the failed row rather than adding a second request', async () => {
    const id = await failedTurn()
    const before = chat.thread(SLUG)
    respond = ok('Here is the answer.')
    const retried = chat.retry(SLUG, id, 'tok')
    await vi.runAllTimersAsync()
    const after = await retried
    expect(after).toHaveLength(before.length)
    expect(after.filter((m) => m.from === 'grant')).toHaveLength(1)
    expect(after.filter((m) => m.id === id)).toHaveLength(1)
  })

  it('a retry of a turn that asked nobody else sends nobody else', async () => {
    chat.clear(SLUG)
    chat.send(SLUG, 'Where has the venue got to?', null, 'emma')
    respond = fails
    const first = chat.ask(SLUG, 'Where has the venue got to?', null, 'tok', 'emma')
    await vi.runAllTimersAsync()
    await first
    const id = String(chat.thread(SLUG).find((m) => m.bad === true)?.id)
    respond = ok('On track.')
    const retried = chat.retry(SLUG, id, 'tok')
    await vi.runAllTimersAsync()
    await retried
    expect(bodies.map((b) => b.also)).toEqual([[], []])
    expect(bodies.map((b) => b.to)).toEqual(['emma', 'emma'])
  })
})

describe('chat.ask, first time (unchanged)', () => {
  it('sends the addressee and also-asked people it is given, and reports progress', async () => {
    chat.clear(SLUG)
    chat.send(SLUG, 'Draft the note', null, 'oliver', ['ruby'])
    const release = held()
    const onState = vi.fn()
    const asked = chat.ask(SLUG, 'Draft the note', null, 'tok', 'oliver', ['ruby'], onState)
    await vi.advanceTimersByTimeAsync(500)
    expect(onState).toHaveBeenCalled()
    release()
    await vi.runAllTimersAsync()
    await asked
    expect(bodies).toEqual([
      expect.objectContaining({ said: 'Draft the note', to: 'oliver', also: ['ruby'] }),
    ])
  })
})
