/**
 * The Google credential, exercised through its failure paths.
 *
 * Every interesting case here is a failure, and none of them can be reached
 * with a working connection — which is the whole reason `fetchImpl` is
 * injected. A suite that could only run once Grant had connected Google would
 * be a suite that never ran, since the point is what happens before he does.
 */

import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { googleAccess } from '../../src/google/auth.ts'

/** A database that answers the one config query and nothing else. */
const dbWith = (row: Record<string, string>): SqlExecutor =>
  ({
    kind: 'fake',
    execute: async () => ({ rows: [row] }),
  }) as unknown as SqlExecutor

const CONNECTED = {
  client_id: 'client.apps.googleusercontent.com',
  client_secret: 'GOCSPX-secret',
  refresh_token: '1//refresh',
}

const replies = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

describe('the setup steps are named individually', () => {
  /*
    Not one "not configured". The Settings page walks him through four steps and
    the failure has to say WHICH — "Google is not set up" three times in a row,
    as he completes two of the three things it needs, is the kind of message
    that makes someone give up on step two.
  */
  it('says the client id is missing', async () => {
    const r = await googleAccess(dbWith({ ...CONNECTED, client_id: '' }), replies({}))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('step 2 of 4')
  })

  it('says the secret is missing, once the id is there', async () => {
    const r = await googleAccess(dbWith({ ...CONNECTED, client_secret: '' }), replies({}))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('step 3 of 4')
  })

  it('says he has not pressed Connect, once both are there', async () => {
    const r = await googleAccess(dbWith({ ...CONNECTED, refresh_token: '' }), replies({}))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('step 4 of 4')
  })

  it('never asks Google when something local is missing', async () => {
    // Guards the ordering above: a call to Google with an empty client id is a
    // request that can only fail, and it would fail with a message about the
    // request rather than about the step he has not done.
    let called = false
    const watching = (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch
    await googleAccess(dbWith({ ...CONNECTED, client_id: '' }), watching)
    expect(called).toBe(false)
  })
})

describe('what Google says back', () => {
  it('explains invalid_grant, which is the one that will actually happen', async () => {
    /*
      §20 warns about it explicitly: an OAuth app left in testing mode expires
      refresh tokens after seven days. The symptom is a working integration that
      stops on the eighth day, and `invalid_grant` on its own reads like a typo.
    */
    const r = await googleAccess(dbWith(CONNECTED), replies({ error: 'invalid_grant' }, 400))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('seven days')
      expect(r.reason).toContain('testing mode')
    }
  })

  it('passes through any other refusal rather than guessing at it', async () => {
    const r = await googleAccess(
      dbWith(CONNECTED),
      replies({ error: 'unauthorized_client', error_description: 'not allowed' }, 401),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('unauthorized_client')
  })

  it('treats a 200 with no token as a failure, not a success', async () => {
    // The shape that would otherwise produce `Bearer undefined` and a 401 from
    // an endpoint that had nothing wrong with it.
    const r = await googleAccess(dbWith(CONNECTED), replies({ expires_in: 3599 }))
    expect(r.ok).toBe(false)
  })

  it('reports the scopes GRANTED, which can be fewer than those asked for', async () => {
    /*
      The consent screen lets him uncheck one. A caller that assumed it got what
      it asked for would fail later with a 403 naming nothing, so the granted
      set is carried and `refreshCalendar` checks it before making a request.
    */
    const r = await googleAccess(
      dbWith(CONNECTED),
      replies({
        access_token: 'ya29.token',
        expires_in: 3599,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scopes).toEqual(['https://www.googleapis.com/auth/calendar.readonly'])
      expect(r.accessToken).toBe('ya29.token')
    }
  })

  it('a granted scope set that is empty is empty, not undefined', async () => {
    const r = await googleAccess(
      dbWith(CONNECTED),
      replies({ access_token: 'ya29.token', expires_in: 3599 }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.scopes).toEqual([])
  })
})
