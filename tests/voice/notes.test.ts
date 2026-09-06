/**
 * The decision not to speak.
 *
 * Phase 7's acceptance is "TTS degrades to text rather than incurring cost", so
 * the tests worth having are the ones that prove nothing is spent and that the
 * text survives every refusal. The last of those is the easiest to get wrong:
 * a refusal that returns no text turns a degraded voice note into a lost
 * message.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import {
  charactersThisMonth,
  decideVoiceNote,
  isSpeakable,
  MAX_SPOKEN_CHARACTERS,
  recordSynthesisFailure,
} from '../../src/voice/notes.ts'

const USAGE = '11111111-1111-1111-1111-111111111111'

class Db implements SqlExecutor {
  readonly kind = 'fake'
  readonly statements: string[] = []
  constructor(private readonly reservation: string | null = USAGE) {}
  async execute(sql: string): Promise<SqlResult> {
    this.statements.push(sql)
    if (sql.includes('reserve_tts_characters')) return { rows: [{ usage_id: this.reservation }] }
    if (sql.includes('tts_characters_this_month')) return { rows: [{ n: 4321 }] }
    return { rows: [{ ok: true }] }
  }
  reserved(): boolean {
    return this.statements.some((s) => s.includes('reserve_tts_characters'))
  }
}

const request = (over: Partial<Parameters<typeof decideVoiceNote>[1]> = {}) => ({
  text: 'All three suppliers quoted within four percent of each other.',
  reviewed: true,
  ...over,
})

const ok = { credentialAvailable: true }

describe('the text is never the fallback', () => {
  it('comes back on every refusal, unchanged', async () => {
    const cases = [
      [new Db(), request(), { credentialAvailable: false }],
      [new Db(), request({ reviewed: false }), ok],
      [new Db(), request({ textOnly: true }), ok],
      [new Db(null), request(), ok],
      [new Db(), request({ text: 'x'.repeat(MAX_SPOKEN_CHARACTERS + 1) }), ok],
    ] as const
    for (const [db, req, options] of cases) {
      const decision = await decideVoiceNote(db, req, options)
      expect(decision.speak).toBe(false)
      expect(decision.text).toBe(req.text)
    }
  })

  it('and on success, so nothing downstream reads a different field', async () => {
    const decision = await decideVoiceNote(new Db(), request(), ok)
    expect(decision.speak).toBe(true)
    expect(decision.text).toBe(request().text)
  })
})

describe('spending nothing', () => {
  it('reserves before it would synthesise, never after', async () => {
    const db = new Db()
    const decision = await decideVoiceNote(db, request(), ok)
    expect(decision.usageId).toBe(USAGE)
    expect(db.reserved()).toBe(true)
  })

  it('does not reserve when there is no credential — nothing to call', async () => {
    const db = new Db()
    const decision = await decideVoiceNote(db, request(), { credentialAvailable: false })
    expect(decision.silentBecause).toBe('no_credential')
    expect(db.reserved()).toBe(false)
  })

  it('takes the refusal from the ledger when the budget is spent', async () => {
    const decision = await decideVoiceNote(new Db(null), request(), ok)
    expect(decision.silentBecause).toBe('over_budget')
    expect(decision.usageId).toBeNull()
  })

  it('checks the cheap conditions before spending a reservation on them', async () => {
    // A reservation taken and then refused for length would spend budget on a
    // note that was never going to be made.
    const db = new Db()
    await decideVoiceNote(db, request({ text: 'y'.repeat(MAX_SPOKEN_CHARACTERS + 1) }), ok)
    expect(db.reserved()).toBe(false)
  })

  it('keeps the characters counted when synthesis fails', async () => {
    const db = new Db()
    await recordSynthesisFailure(db, USAGE, 'quota_exceeded')
    expect(db.statements.some((s) => s.includes('record_tts_failure'))).toBe(true)
  })

  it('reads the month from our own ledger, since no live counter exists', async () => {
    expect(await charactersThisMonth(new Db())).toBe(4321)
  })
})

describe('what must not be spoken', () => {
  it('refuses unreviewed output — audio has no margin for the label', async () => {
    const decision = await decideVoiceNote(new Db(), request({ reviewed: false }), ok)
    expect(decision.silentBecause).toBe('unreviewed')
  })

  it('refuses a code block', () => {
    expect(isSpeakable('Here:\n```\nselect 1\n```')).toBe(false)
  })

  it('refuses a table', () => {
    expect(isSpeakable('| a | b |\n| - | - |\n| 1 | 2 |')).toBe(false)
  })

  it('refuses a list of three or more items — speech has no shapes', () => {
    expect(isSpeakable('Options:\n- one\n- two\n- three')).toBe(false)
    expect(isSpeakable('Options:\n1. one\n2. two\n3. three')).toBe(false)
  })

  it('allows a list of two, which reads as a sentence would', () => {
    expect(isSpeakable('Two options:\n- keep it\n- drop it')).toBe(true)
  })

  it('refuses a paragraph that is mostly figures', () => {
    expect(
      isSpeakable('Revenue 1,200, cost 900, margin 25%, Q1 300, Q2 400, Q3 250, Q4 250, tax 40'),
    ).toBe(false)
  })

  it('allows ordinary prose with a number or two in it', () => {
    expect(isSpeakable('All three suppliers quoted within 4% of each other.')).toBe(true)
  })

  it('honours a request for text', async () => {
    const decision = await decideVoiceNote(new Db(), request({ textOnly: true }), ok)
    expect(decision.silentBecause).toBe('caller_asked_for_text')
  })
})
