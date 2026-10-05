import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderReport } from '../../src/artifacts/report.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

// The Drive read is stubbed at the module edge: what is under test is what the handler does with the bytes it is given.
const drive = vi.hoisted(() => ({ got: null as unknown }))
vi.mock('../../src/google/drive.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/google/drive.ts')>()),
  driveAccess: async () => ({ accessToken: 'token-not-real' }),
  readFile: async () => drive.got,
}))
const { driveReadHandler } = await import('../../src/handlers/drive-read.ts')

const JOB = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'

const run = async (): Promise<string[]> => {
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
                mime_type: 'application/pdf',
                title: 'Lease',
              },
            },
          ],
        }
      if (sql.includes('record_drive_document'))
        return { rows: [{ r: { ok: true, document: PROJECT, outcome: 'added' } }] }
      return { rows: [{ r: { ok: true } }] }
    },
  } as unknown as SqlExecutor
  const handler = driveReadHandler({
    db,
    projectRef: 'ref',
    serviceKey: 'key',
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
  })
  await handler.handle({ jobId: JOB, projectId: PROJECT } as never, {} as never)
  return seen
}

describe('a Drive file that arrives as bytes (#419)', () => {
  beforeEach(() => {
    drive.got = null
  })

  it('a PDF with text is recorded WITH its text, so it is searchable like an upload', async () => {
    const { bytes } = renderReport({
      title: 'Lease',
      subtitle: 's',
      author: 'a',
      created: new Date('2026-10-04T00:00:00Z'),
      blocks: [
        {
          kind: 'paragraph',
          text: 'The break clause may be exercised on six months notice by either party.',
        },
      ],
      sources: [],
    })
    drive.got = { bytes, text: null, mime: 'application/pdf', error: null }
    const sql = (await run()).find((s) => s.includes('record_drive_document')) ?? ''
    expect(sql).toContain('break clause may be exercised on six months notice')
    expect((await run()).some((s) => s.includes('attach_file_to_document'))).toBe(true)
  })

  it('a scan is recorded with NO text and its bytes are still stored (never an invented empty string)', async () => {
    const scan = Uint8Array.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n',
      (c) => c.charCodeAt(0),
    )
    drive.got = { bytes: scan, text: null, mime: 'application/pdf', error: null }
    const seen = await run()
    const sql = seen.find((s) => s.includes('record_drive_document')) ?? ''
    expect(sql).toMatch(/, null, 'chief-of-staff'\) as r/)
    expect(seen.some((s) => s.includes('attach_file_to_document'))).toBe(true)
  })

  it('CONTROL: text a Google export already is stays exactly as it was', async () => {
    drive.got = { bytes: null, text: 'Plain exported words here.', mime: 'text/plain', error: null }
    const sql = (await run()).find((s) => s.includes('record_drive_document')) ?? ''
    expect(sql).toContain("'Plain exported words here.'")
  })
})
