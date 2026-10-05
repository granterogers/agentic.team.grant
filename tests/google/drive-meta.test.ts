import { describe, expect, it } from 'vitest'
import { fileMeta } from '../../src/google/drive.ts'

const access = { ok: true as const, accessToken: 'tok', scopes: [], expiresInSeconds: 3600 }

describe('fileMeta (0960)', () => {
  it('asks for the id, name and type only, with the access token, and never a thumbnail link', async () => {
    let seen = ''
    let auth = ''
    const f = (async (url: string, init: { headers: Record<string, string> }) => {
      seen = url
      auth = init.headers.Authorization ?? ''
      return new Response(JSON.stringify({ id: 'a b', name: 'Plan', mimeType: 'application/pdf' }))
    }) as unknown as typeof fetch
    const out = await fileMeta(access, 'a b', f)
    expect(out).toEqual({ mimeType: 'application/pdf', name: 'Plan', error: null })
    expect(decodeURIComponent(seen)).toContain('fields=id,name,mimeType')
    expect(seen).not.toMatch(/thumbnail/i)
    expect(seen).toContain('/files/a%20b?')
    expect(auth).toBe('Bearer tok')
  })

  it('CONTROL: a refusal comes back as an error with the status, not as a type', async () => {
    const f = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    const out = await fileMeta(access, 'x', f)
    expect(out.mimeType).toBeNull()
    expect(out.error).toBe('drive 404: nope')
  })
})
