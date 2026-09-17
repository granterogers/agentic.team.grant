/**
 * The redactor, tested against things that LOOK like credentials.
 *
 * Every value below is fabricated and none is live — but they have to have the
 * real shape, because a redactor tested against `"my-secret"` proves nothing.
 * That is the same reasoning `tests/providers/router.test.ts` already records,
 * and the same per-line markers are needed so the secret scanner does not
 * report this file: the exemption covers only the line it is on and the one
 * after, deliberately, so a marker cannot silently blanket a whole file.
 *
 * The assertions are always the same pair, and both halves matter:
 *
 *   - something was redacted, and
 *   - the original does not survive anywhere in the output.
 *
 * The second is the one that catches a pattern that matches a prefix and
 * leaves the tail behind, which is exactly the bug the Telegram redactor had
 * before it included `:` in its character class.
 */

import { describe, expect, it } from 'vitest'
import { carriesSecret, redactDeep, redactSecrets, secretFamilies } from '../../src/text/secrets.ts'

describe('every credential family the office holds', () => {
  it.each([
    // secret-scan:allow-shape
    ['xoxb-1234567890-abcdefghijkl', 'slack', 'a Slack bot token'],
    // secret-scan:allow-shape
    ['sk-proj-abcdefghijklmnopqrst', 'openai', 'an OpenAI project key'],
    // secret-scan:allow-shape
    ['sk-or-v1-abcdefghijklmnopqrst', 'openai', 'an OpenRouter key'],
    // secret-scan:allow-shape
    ['sbp_0123456789abcdef01234567', 'supabase', 'a Supabase access token'],
    // secret-scan:allow-shape
    ['ntn_0123456789abcdefghijklmn', 'notion', 'a Notion integration token'],
    // secret-scan:allow-shape
    ['secret_0123456789abcdefghijkl', 'notion', 'a legacy Notion token'],
    // secret-scan:allow-shape
    ['AIzaSyA0123456789abcdefghijklmnopqrs', 'google', 'a Google API key'],
    // secret-scan:allow-shape
    ['ghp_0123456789abcdefghijklmnopqrstuvwx', 'github', 'a GitHub PAT'],
    // secret-scan:allow-shape
    ['github_pat_0123456789abcdefghij_ABCDEFGH', 'github', 'a fine-grained GitHub PAT'],
    // secret-scan:allow-shape
    ['123456789:AAHfaKeToKeNvAlUeThAtIsLoNgEnOuGh12', 'telegram', 'a Telegram bot token'],
    // secret-scan:allow-shape
    ['AKIAIOSFODNN7EXAMPLE', 'aws', 'an AWS access key id'],
  ])('redacts %s as %s (%s)', (shape, family) => {
    const line = `connect failed for https://example.test/x?auth=${shape} — retrying`
    const out = redactSecrets(line)

    expect(secretFamilies(line)).toContain(family)
    expect(out).not.toContain(shape)
    expect(out).toContain('[redacted:')
    // The sentence around it survives, which is the point of redacting rather
    // than dropping the line.
    expect(out).toContain('connect failed for')
    expect(out).toContain('retrying')
  })

  it('redacts a JWT, which is what a Supabase anon key is', () => {
    // secret-scan:allow-shape
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU'
    expect(redactSecrets(`token=${jwt}`)).not.toContain(jwt)
  })

  it('redacts an Authorization header but keeps the scheme, so the line still reads', () => {
    // secret-scan:allow-shape
    const out = redactSecrets('POST /x -H "Authorization: Bearer someverylongsecretvalue"')
    expect(out).toContain('Bearer [redacted:authorization]')
    expect(out).not.toContain('someverylongsecretvalue')
  })
})

/*
  The catch-all is the reason this module is more than a list of prefixes: the
  named families cover what the office holds today, and the next connector will
  arrive with a shape nobody has written down.
*/
describe('anything long enough to be a key, whatever its shape', () => {
  it('redacts an opaque token from a vendor nobody has integrated yet', () => {
    const unknown = 'zqf8Kd0Lm3Np7Rt2Vx5Yb8Ce1Fh4Jk7Mp0Sv3Wz6A9'
    const out = redactSecrets(`x-api-key: ${unknown}`)
    expect(out).not.toContain(unknown)
    expect(secretFamilies(`x-api-key: ${unknown}`)).toContain('long-opaque')
  })

  /*
    And the other half, which is what stops an over-eager catch-all making
    every trace unreadable. Each of these is longer than most words, is
    credential-adjacent in a log line, and is not a credential.
  */
  it.each([
    ['a UUID', 'job 6c082674-383a-4223-89fe-3997479b5597 failed'],
    ['a file path', 'reading src/handlers/calendar-tasks.ts and src/google/calendar-write.ts'],
    ['a sentence', 'The office could not reach NotebookLM and has recorded a degradation'],
    ['a URL with no credential', 'GET https://www.googleapis.com/calendar/v3/calendars/primary'],
    ['a job kind', 'google.write_calendar_tasks completed with nothing to do'],
  ])('leaves %s alone', (_what, text) => {
    expect(redactSecrets(text)).toBe(text)
    expect(carriesSecret(text)).toBe(false)
  })
})

describe('redacting inside a structure', () => {
  it('walks an object, keeping keys and shape', () => {
    const detail = {
      url: 'https://api.notion.com/v1/pages',
      // secret-scan:allow-shape
      headers: { authorization: 'Bearer ntn_0123456789abcdefghijklmn' },
      documents: [{ id: 'a1b2', title: 'WS01 — Legacy Opening Assessment' }],
      attempt: 2,
      ok: false,
    }
    const out = redactDeep(detail) as typeof detail

    // The credential is gone.
    expect(JSON.stringify(out)).not.toContain('ntn_0123456789abcdefghijklmn')
    // Everything that makes the trace worth reading is not.
    expect(out.url).toBe('https://api.notion.com/v1/pages')
    expect(out.documents[0]?.title).toBe('WS01 — Legacy Opening Assessment')
    expect(out.attempt).toBe(2)
    expect(out.ok).toBe(false)
    expect(Object.keys(out.headers)).toEqual(['authorization'])
  })

  it('survives null, undefined and an empty string', () => {
    expect(redactDeep(null)).toBe(null)
    expect(redactDeep(undefined)).toBe(undefined)
    expect(redactSecrets('')).toBe('')
  })
})

/*
  A /g regex carries `lastIndex` between calls, and these patterns are
  module-level constants shared by every caller. Without a reset, a second call
  can resume mid-string and miss a match at the start — which would mean the
  redactor works on the first job of a batch and leaks on the second.
*/
describe('state does not carry between calls', () => {
  it('redacts the same shape twice in a row', () => {
    // secret-scan:allow-shape
    const line = 'auth=sk-proj-abcdefghijklmnopqrst'
    const shape = line.slice('auth='.length)
    expect(redactSecrets(line)).toBe(redactSecrets(line))
    expect(redactSecrets(line)).not.toContain(shape)
  })

  it('redacts every occurrence in one string, not only the first', () => {
    // secret-scan:allow-shape
    const a = 'sbp_0123456789abcdef01234567'
    // secret-scan:allow-shape
    const b = 'sbp_fedcba9876543210fedcba98'
    const out = redactSecrets(`from ${a} to ${b}`)
    expect(out).not.toContain(a)
    expect(out).not.toContain(b)
  })
})
