import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { driveReadHandler } from '../../src/handlers/drive-read.ts'

/*
  The Import gate in the drive.read_file handler FAILS CLOSED. Each case runs the real handler against a recording
  executor and a fetch spy that must never be called: the point is what happens when the database cannot say.
*/
const JOB = '11111111-1111-1111-1111-111111111111'
const DOC = '22222222-2222-2222-2222-222222222222'

const run = async (gate: 'ok' | 'closed' | 'missing' | 'broken') => {
  const sql: string[] = []
  const fetched: string[] = []
  const db = {
    execute: async (q: string) => {
      sql.push(q)
      if (q.includes('select pinned_config'))
        return {
          rows: [
            {
              pinned_config: {
                import_request: true,
                document_id: DOC,
                file_id: 'f1',
                folder_id: 'fo1',
                project_id: 'p1',
                mime_type: 'text/plain',
              },
            },
          ],
        } as never
      if (q.includes('app.document_import_gate(')) {
        if (gate === 'missing')
          throw new Error('42883: function app.document_import_gate(uuid, uuid) does not exist')
        if (gate === 'broken') throw new Error('08006: connection failure')
        return {
          rows: [
            {
              g:
                gate === 'ok'
                  ? { ok: true }
                  : {
                      ok: false,
                      error_code: 'SOURCE_DISCONNECTED',
                      error: 'Reconnect Google Drive to import this file.',
                    },
            },
          ],
        } as never
      }
      // The credential read: an unconfigured Google, so an "ok" gate ends in an ordinary refusal and still fetches nothing.
      if (q.includes('google.client_id'))
        return { rows: [{ client_id: '', client_secret: '', refresh_token: '' }] } as never
      return { rows: [] } as never
    },
  } as unknown as SqlExecutor
  const handler = driveReadHandler({
    db,
    projectRef: 'x',
    serviceKey: 'y',
    fetchImpl: (async (u: string | URL) => {
      fetched.push(String(u))
      throw new Error('REFUSED: no network in this test')
    }) as typeof fetch,
  })
  const out = (await handler.handle(
    { jobId: JOB, projectId: 'p1', kind: 'drive.read_file' } as never,
    {} as never,
  )) as {
    body: string
  }
  return { out, sql, fetched }
}

describe('drive.read_file for an Import press: the gate fails closed', () => {
  it('a closed source is refused with the typed code and nothing is fetched', async () => {
    const r = await run('closed')
    expect(r.out.body).toContain('SOURCE_DISCONNECTED')
    expect(r.fetched).toEqual([])
    expect(r.sql.some((q) => q.includes('google.refresh_token'))).toBe(false)
  })

  it('a gate function that is MISSING (worker newer than database) refuses, and says why', async () => {
    const r = await run('missing')
    expect(r.out.body).toContain('SOURCE_DISCONNECTED')
    expect(r.out.body).toMatch(/Apply the migrations/)
    expect(r.fetched).toEqual([])
    expect(r.sql.some((q) => q.includes('google.refresh_token'))).toBe(false)
  })

  it('a gate query that FAILS refuses too: not knowing is not connected', async () => {
    const r = await run('broken')
    expect(r.out.body).toContain('SOURCE_DISCONNECTED')
    expect(r.fetched).toEqual([])
    expect(r.sql.some((q) => q.includes('google.refresh_token'))).toBe(false)
  })

  it('the refusal is written onto the request so the page can say it', async () => {
    const r = await run('missing')
    expect(r.sql.some((q) => q.includes('app.document_import_note_failure('))).toBe(true)
  })

  it('CONTROL: an ok answer goes on to the credential (the gate does not block everything)', async () => {
    const r = await run('ok')
    expect(r.sql.length, r.sql.join('\n---\n')).toBeGreaterThan(2)
    expect(r.sql.some((q) => /google|vault|secret/i.test(q))).toBe(true)
  })
})

/*
  A read that no Import press started (the watch's ingest) is also a fetch from the provider. It is stopped when the
  folder it came from has been switched off since it was queued, and ONLY on an explicit "no": an answer that cannot be
  had (a database older than the worker) leaves the read going, as it always did.
*/
const runWatch = async (answer: 'off' | 'on' | 'missing') => {
  const fetched: string[] = []
  const db = {
    execute: async (q: string) => {
      if (q.includes('select pinned_config'))
        return {
          rows: [
            {
              pinned_config: {
                file_id: 'f1',
                folder_id: 'fo1',
                project_id: 'p1',
                mime_type: 'text/plain',
              },
            },
          ],
        } as never
      if (q.includes('app.source_connected(')) {
        if (answer === 'missing')
          throw new Error('42883: function app.source_connected does not exist')
        return { rows: [{ ok: answer === 'on' }] } as never
      }
      if (q.includes('google.client_id'))
        return { rows: [{ client_id: '', client_secret: '', refresh_token: '' }] } as never
      return { rows: [] } as never
    },
  } as unknown as SqlExecutor
  const handler = driveReadHandler({
    db,
    projectRef: 'x',
    serviceKey: 'y',
    fetchImpl: (async (u: string | URL) => {
      fetched.push(String(u))
      throw new Error('REFUSED: no network in this test')
    }) as typeof fetch,
  })
  const out = (await handler.handle(
    { jobId: JOB, projectId: 'p1', kind: 'drive.read_file' } as never,
    {} as never,
  )) as { body: string }
  return { out, fetched }
}

describe('drive.read_file for a watch ingest: a switched-off folder stops the read', () => {
  it('off: refused with the typed code before any credential is read or Drive asked', async () => {
    const r = await runWatch('off')
    expect(r.out.body).toContain('SOURCE_DISCONNECTED')
    expect(r.out.body).toContain('switched off since the read was queued')
    expect(r.fetched).toEqual([])
  })
  for (const a of ['on', 'missing'] as const) {
    it(`${a}: not stopped by the gate (it goes on to the ordinary Google steps)`, async () => {
      const r = await runWatch(a)
      expect(r.out.body).not.toContain('switched off since the read was queued')
    })
  }
})
