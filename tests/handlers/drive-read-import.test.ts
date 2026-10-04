import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'

// 0900: reading a file completes a person's recorded import request, and only asks about the very document it recorded.
const drive = vi.hoisted(() => ({ got: null as unknown }))
vi.mock('../../src/google/drive.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/google/drive.ts')>()),
  driveAccess: async () => ({ accessToken: 'token-not-real' }),
  readFile: async () => drive.got,
}))
const { driveReadHandler } = await import('../../src/handlers/drive-read.ts')

const JOB = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const DOC = '33333333-3333-4333-8333-333333333333'

const run = async (
  fulfil: 'done' | 'nothing' | 'throws' | 'absent',
): Promise<{ seen: string[]; body: string }> => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql.replace(/\s+/g, ' '))
      if (sql.includes('pinned_config'))
        return {
          rows: [
            {
              pinned_config: {
                file_id: 'f1',
                folder_id: 'd1',
                project_id: PROJECT,
                mime_type: 'text/plain',
                title: 'Policy',
              },
            },
          ],
        }
      if (sql.includes('record_drive_document'))
        return { rows: [{ r: { ok: true, document: DOC, outcome: 'added' } }] }
      if (sql.includes('document_import_fulfil')) {
        if (fulfil === 'throws') throw new Error('boom')
        if (fulfil === 'absent')
          throw new Error('function app.document_import_fulfil(uuid, uuid) does not exist')
        return { rows: [{ r: { ok: true, fulfilled: fulfil === 'done' } }] }
      }
      return { rows: [{ r: { ok: true } }] }
    },
  } as unknown as SqlExecutor
  const handler = driveReadHandler({
    db,
    projectRef: 'ref',
    serviceKey: 'key',
    fetchImpl: (async () => new Response('{}')) as typeof fetch,
  })
  const out = await handler.handle({ jobId: JOB, projectId: PROJECT } as never, {} as never)
  return { seen, body: String((out as { body: string }).body) }
}

describe('a Drive read finishes an explicit import request (0900)', () => {
  beforeEach(() => {
    drive.got = { bytes: null, text: 'Plain exported words here.', mime: 'text/plain', error: null }
  })

  it("asks about the document it just recorded, with the job's own office, and says when the copy was made", async () => {
    const { seen, body } = await run('done')
    const ask = seen.find((s) => s.includes('document_import_fulfil')) ?? ''
    expect(ask).toContain(`app.job_office('${JOB}'::uuid), '${DOC}'::uuid`)
    expect(body).toContain('Team HQ copy now exists')
  })

  it('CONTROL: with no request pending the read says nothing about an import', async () => {
    expect((await run('nothing')).body).not.toMatch(/import/i)
  })

  it('a database without 0900 is not alarmed about on every read', async () => {
    expect((await run('absent')).body).not.toMatch(/import/i)
  })

  it('a failure is said, not swallowed', async () => {
    expect((await run('throws')).body).toContain('could not be completed yet (boom)')
  })
})
