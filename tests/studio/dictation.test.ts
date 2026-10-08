/**
 * Live dictation's state machine (8 October 2026), driven with a fake recogniser.
 * These decide every branch of the logic without a microphone. They do NOT prove that a real browser captures audio:
 * that is checked separately by hand and recorded in docs/ux/team-hq-overhaul-log-2026-10-08.md.
 */
import { beforeEach, describe, expect, it } from 'vitest'
// @ts-expect-error browser module without types (ADR-0002)
import * as D from '../../web/studio/dictation.js'

type Res = { isFinal: boolean; 0: { transcript: string } }
const res = (transcript: string, isFinal: boolean): Res => ({ isFinal, 0: { transcript } })

class FakeRec {
  static all: FakeRec[] = []
  continuous = false
  interimResults = false
  lang = ''
  started = false
  aborted = false
  onstart: (() => void) | null = null
  onresult: ((e: { results: Res[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  constructor() {
    FakeRec.all.push(this)
  }
  start() {
    this.started = true
    this.onstart?.()
  }
  abort() {
    this.aborted = true
    this.started = false
    this.onend?.()
  }
  say(results: Res[]) {
    this.onresult?.({ results })
  }
  silence() {
    this.started = false
    this.onend?.()
  }
  fail(error: string) {
    this.onerror?.({ error })
    this.started = false
    this.onend?.()
  }
}

const box = (value = '') => {
  const listeners = new Set<() => void>()
  return {
    value,
    addEventListener: (_: string, f: () => void) => void listeners.add(f),
    removeEventListener: (_: string, f: () => void) => void listeners.delete(f),
    type(v: string) {
      this.value = v
      for (const f of listeners) f()
    },
  }
}

let timers: Array<() => void> = []
const make = () =>
  D.createDictation({
    Recognition: FakeRec,
    setTimer: (fn: () => void) => {
      timers.push(fn)
      return timers.length
    },
    clearTimer: () => {
      timers = []
    },
  })
const last = () => FakeRec.all[FakeRec.all.length - 1] as FakeRec

beforeEach(() => {
  FakeRec.all = []
  timers = []
})

describe('activation', () => {
  it('goes idle -> starting -> listening and reports active', () => {
    const d = make()
    const seen: string[] = []
    expect(d.state()).toBe('idle')
    expect(d.start(box(), { onstate: (s: string) => seen.push(s) })).toBe(true)
    expect(seen).toEqual(['starting', 'listening'])
    expect(d.active()).toBe(true)
    expect(last().continuous && last().interimResults).toBe(true)
  })
  it('refuses a second start and an unsupported browser', () => {
    const d = make()
    d.start(box())
    expect(d.start(box())).toBe(false)
    expect(D.createDictation({ Recognition: null }).start(box())).toBe(false)
    expect(D.createDictation({ Recognition: null }).supported()).toBe(false)
  })
})

describe('streaming text', () => {
  it('shows interim words and replaces them as they are revised, with no repeated words', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().say([res('hello wor', false)])
    expect(b.value).toBe('hello wor')
    last().say([res('hello world', false)])
    expect(b.value).toBe('hello world')
    last().say([res('hello world', true)])
    expect(b.value).toBe('hello world')
    last().say([res('hello world', true), res(' how are', false)])
    expect(b.value).toBe('hello world how are')
    last().say([res('hello world', true), res(' how are you', true)])
    expect(b.value).toBe('hello world how are you')
  })
  it('reports which part is settled and which is still provisional', () => {
    const d = make()
    const b = box()
    let info: { settled: string; interim: string } = { settled: '', interim: '' }
    d.start(b, { onchange: (_: string, i: typeof info) => (info = i) })
    last().say([res('send it', true), res('to claire', false)])
    expect(info).toEqual({ settled: 'send it', interim: 'to claire' })
  })
  it('keeps what was typed before dictation and appends to it', () => {
    const d = make()
    const b = box('Remind me to')
    d.start(b)
    last().say([res('call the roofer', false)])
    expect(b.value).toBe('Remind me to call the roofer')
  })
  it('treats an edit made while listening as the new base and does not re-insert earlier speech', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().say([res('buy milk', true)])
    b.type('Buy oat milk')
    last().say([res('buy milk', true), res(' and bread', false)])
    expect(b.value).toBe('Buy oat milk and bread')
  })
  it('never submits anything: it only writes the box', () => {
    const d = make()
    const b = box()
    let stops = 0
    d.start(b, { onstop: () => (stops += 1) })
    last().say([res('send this now', true)])
    expect(stops).toBe(0)
    expect(b.value).toBe('send this now')
  })
})

describe('continuous transcription across interruptions', () => {
  it('restarts after a silence timeout and keeps the words so far', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().say([res('first part', true)])
    last().silence()
    expect(d.active()).toBe(true)
    expect(timers.length).toBe(1)
    timers.shift()?.()
    expect(FakeRec.all.length).toBe(2)
    last().say([res('second part', false)])
    expect(b.value).toBe('first part second part')
  })
  it('gives up after repeated sessions that hear nothing, and says so', () => {
    const d = make()
    let said = ''
    d.start(box(), { onstop: (r: string) => (said = r) })
    for (let i = 0; i < 8 && d.active(); i += 1) {
      last().silence()
      timers.shift()?.()
    }
    expect(d.active()).toBe(false)
    expect(said).toMatch(/nothing was heard/i)
  })
  it('a network interruption is reported and the words heard are kept', () => {
    const d = make()
    const b = box()
    let said = ''
    d.start(b, { onstop: (r: string) => (said = r) })
    last().say([res('half a sentence', false)])
    last().fail('network')
    for (let i = 0; i < 8 && d.active(); i += 1) {
      timers.shift()?.()
      if (d.active()) last().fail('network')
    }
    expect(said).toMatch(/network/i)
    expect(b.value).toBe('half a sentence')
    expect(d.state()).toBe('error')
  })
})

describe('permission and device errors', () => {
  it('permission denial stops at once with an actionable sentence and does not retry', () => {
    const d = make()
    let said = ''
    d.start(box(), { onstop: (r: string) => (said = r) })
    last().fail('not-allowed')
    expect(said).toMatch(/refused/i)
    expect(d.active()).toBe(false)
    expect(timers.length).toBe(0)
    expect(FakeRec.all.length).toBe(1)
    expect(d.state()).toBe('error')
  })
  it('no microphone is reported as such', () => {
    const d = make()
    let said = ''
    d.start(box(), { onstop: (r: string) => (said = r) })
    last().fail('audio-capture')
    expect(said).toMatch(/no microphone/i)
  })
})

describe('stopping, cleanup and reactivation', () => {
  it('stop aborts, releases and returns to idle with the words kept for editing', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().say([res('keep me', false)])
    d.stop()
    expect(last().aborted).toBe(true)
    expect(d.active()).toBe(false)
    expect(d.state()).toBe('idle')
    expect(b.value).toBe('keep me')
    last().say([res('late result', true)])
    expect(b.value).toBe('keep me')
  })
  it('stop with nothing running is harmless', () => {
    const d = make()
    expect(() => d.stop()).not.toThrow()
    expect(d.state()).toBe('idle')
  })
  it('can be started again after a stop and after an error, from the current text', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().say([res('one', true)])
    d.stop()
    expect(d.start(b)).toBe(true)
    last().say([res('two', false)])
    expect(b.value).toBe('one two')
    last().fail('not-allowed')
    expect(d.start(b)).toBe(true)
    expect(d.state()).toBe('listening')
  })
  it('does not leave an input listener or a pending restart behind', () => {
    const d = make()
    const b = box()
    d.start(b)
    last().silence()
    d.stop()
    expect(timers.length).toBe(0)
    b.type('typed after stop')
    last().say([res('ghost', true)])
    expect(b.value).toBe('typed after stop')
  })
})

describe('join', () => {
  it('puts exactly one space between pieces', () => {
    expect(D.join('a', 'b')).toBe('a b')
    expect(D.join('a ', 'b')).toBe('a b')
    expect(D.join('a', ' b')).toBe('a b')
    expect(D.join('', 'b')).toBe('b')
  })
})

describe('a recogniser that never starts (its service is unreachable)', () => {
  class MuteRec extends FakeRec {
    start() {
      this.started = true // the engine accepted the call and then said nothing at all
    }
  }
  const makeMute = () =>
    D.createDictation({
      Recognition: MuteRec,
      setTimer: (fn: () => void) => {
        timers.push(fn)
        return timers.length
      },
      clearTimer: () => {
        timers = []
      },
    })

  it('gives up after the start timeout, says so and lets go of the microphone', () => {
    const d = makeMute()
    expect(d.start(box())).toBe(true)
    expect(d.state()).toBe('starting')
    expect(timers.length).toBe(1)
    timers.shift()?.()
    expect(d.state()).toBe('error')
    expect(d.reason()).toMatch(/did not start/i)
    expect(d.active()).toBe(false)
    expect((FakeRec.all.at(-1) as FakeRec).aborted).toBe(true)
  })

  it('does not fire once it has started', () => {
    const d = make()
    d.start(box())
    expect(d.state()).toBe('listening')
    expect(timers.length).toBe(0)
  })
})
