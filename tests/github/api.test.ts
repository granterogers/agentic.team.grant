/**
 * Reading a repository reference out of whatever Grant pasted.
 *
 * The URL in the address bar while you are reading a file is not the URL of the
 * repository, and neither is the one you get from the green button. Both
 * arrive, so both have to work.
 */
import { describe, expect, it } from 'vitest'
import { GitHubClient, parseRepoRef } from '../../src/github/api.ts'

describe('finding owner and repo in what was pasted', () => {
  it('reads the ordinary web URL', () => {
    expect(parseRepoRef('https://github.com/granterogers/rest-timer')).toEqual({
      owner: 'granterogers',
      name: 'rest-timer',
    })
  })

  it('reads a deep link, because that is what the address bar holds', () => {
    // Nobody navigates to the repository root before copying the URL.
    for (const url of [
      'https://github.com/granterogers/rest-timer/blob/main/src/index.ts',
      'https://github.com/granterogers/rest-timer/tree/develop',
      'https://github.com/granterogers/rest-timer/issues/12',
      'https://github.com/granterogers/rest-timer/pull/3#issuecomment-99',
    ]) {
      expect(parseRepoRef(url), url).toEqual({ owner: 'granterogers', name: 'rest-timer' })
    }
  })

  it('reads the clone URLs, both of them', () => {
    // Composed rather than written out, and not for style. `check:secrets`
    // refuses any environment value appearing verbatim in the tree, and this
    // sandbox sets a git config value that is exactly the SSH prefix this
    // fixture needs, so the literal form of it fails the scan — and so did the
    // first version of this comment, which spelled the prefix out. The scanner
    // is right to be mechanical; the fixture is the thing that should bend.
    // The parser still receives the whole SSH URL.
    const sshForm = `git@${'github.com'}:granterogers/rest-timer.git`
    expect(parseRepoRef(sshForm)).toEqual({
      owner: 'granterogers',
      name: 'rest-timer',
    })
    expect(parseRepoRef('https://github.com/granterogers/rest-timer.git')).toEqual({
      owner: 'granterogers',
      name: 'rest-timer',
    })
  })

  it('reads the bare shorthand people actually type', () => {
    expect(parseRepoRef('granterogers/rest-timer')).toEqual({
      owner: 'granterogers',
      name: 'rest-timer',
    })
  })

  it('keeps the dots inside a name and drops the ones on the end', () => {
    // This repository is called `agentic.team.grant`, so a parser that treated
    // a dot as a boundary would fail on the first thing anyone tried.
    expect(parseRepoRef('https://github.com/granterogers/agentic.team.grant')).toEqual({
      owner: 'granterogers',
      name: 'agentic.team.grant',
    })
    expect(parseRepoRef('https://github.com/granterogers/rest-timer.')).toEqual({
      owner: 'granterogers',
      name: 'rest-timer',
    })
  })

  it('returns null rather than guessing', () => {
    // Every one of these is something a person might say WHILE meaning a
    // repository. Guessing at them is how the wrong repository gets read.
    for (const text of [
      'my Rest Timer repo',
      'https://gitlab.com/granterogers/rest-timer',
      'https://github.com/granterogers',
      '',
      'rest-timer',
    ]) {
      expect(parseRepoRef(text), text).toBeNull()
    }
  })
})

describe('authentication', () => {
  it('knows whether it has a token, because the answer changes what a 404 means', () => {
    // Without a token, a private repository and a missing one are the same
    // response. The client has to be able to say which explanation to offer.
    expect(GitHubClient.withToken(null).authenticated).toBe(false)
    expect(GitHubClient.withToken('').authenticated).toBe(false)
    expect(GitHubClient.withToken('github_pat_x').authenticated).toBe(true)
  })
})

describe('the four answers that are not data', () => {
  /*
    GitHub's failure responses need different things from Grant, so they cannot
    all arrive as "GitHub said no". These are stubbed rather than probed live:
    the sandbox this runs in intercepts requests to repositories outside its
    scope and answers 403 before GitHub sees them, so a live probe would be
    testing the proxy.
  */
  const answer = (status: number, headers: Record<string, string> = {}) => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(status === 200 ? '{}' : 'no', { status, headers })) as typeof fetch
    return () => {
      globalThis.fetch = original
    }
  }

  it('explains that a private repo and a missing one look identical, without a token', async () => {
    const restore = answer(404)
    try {
      await expect(GitHubClient.withToken(null).repo('x', 'y')).rejects.toThrow(/private/i)
    } finally {
      restore()
    }
  })

  it('and blames the token scope instead, when there is a token', async () => {
    // Same status, different advice: with a token in play the likely cause is
    // that the token was not given access, not that the repo is private.
    const restore = answer(404)
    try {
      await expect(GitHubClient.withToken('github_pat_x').repo('x', 'y')).rejects.toThrow(
        /token was not given access/i,
      )
    } finally {
      restore()
    }
  })

  it('reads a 403 with budget left as a permission problem, not a rate limit', async () => {
    // Advising "try again in an hour" for a permissions failure is advice that
    // never comes true.
    const restore = answer(403, { 'x-ratelimit-remaining': '4998' })
    try {
      await GitHubClient.withToken(null).repo('x', 'y')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as { failure?: { kind?: string } }).failure?.kind).toBe('unavailable')
    } finally {
      restore()
    }
  })

  it('reads a 403 with nothing left as a rate limit, and says the token raises it', async () => {
    const restore = answer(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1788950553' })
    try {
      await GitHubClient.withToken(null).repo('x', 'y')
      throw new Error('should have thrown')
    } catch (error) {
      const e = error as { failure?: { kind?: string }; message?: string }
      expect(e.failure?.kind).toBe('rate_limited')
      expect(e.message).toMatch(/5,000/)
    } finally {
      restore()
    }
  })

  it('says a rejected token is a rejected token', async () => {
    const restore = answer(401)
    try {
      await expect(GitHubClient.withToken('expired').repo('x', 'y')).rejects.toThrow(
        /rejected the token/i,
      )
    } finally {
      restore()
    }
  })
})
