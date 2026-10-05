import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'

// 0960: an Import press starts drive.read_file with no mime type; the handler asks Drive what the file is, and a failed read
// is written onto the request instead of leaving it pending in silence.
const drive = vi.hoisted(() => ({
  got: null as unknown,
  meta: null as unknown,
  readMime: '' as string,
  metaAsked: 0,
}))
vi.mock('../../src/google/drive.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/google/drive.ts')>()),
  driveAccess: async () => ({ accessToken: 'token-not-real' }),
  fileMeta: async () => {
    drive.metaAsked += 1
    return drive.meta
  },
  readFile: async (_a: unknown, _f: string, mime: string) => {
    drive.readMime = mime
    return drive.got
  },
}))
const { driveReadHandler } = await import('../../src/handlers/drive-read.ts')

const JOB = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const DOC = '33333333-3333-4333-8333-333333333333'

const run = async (config: Record<string, unknown>): Promise<{ seen: string[]; body: string }> => {
  const seen: string[] = []
  const db = {
    execute: async (sql: string) => {
      seen.push(sql.replace(/\s+/g, ' '))
      if (sql.includes('pinned_config'))
        return {
          rows: [
            { pinned_config: { file_id: 'f1', folder_id: 'd1', project_id: PROJECT, ...config } },
          ],
        }
      if (sql.includes('record_drive_document'))
        return { rows: [{ r: { ok: true, document: DOC, outcome: 'added' } }] }
      return { rows: [{ r: { ok: true, fulfilled: true } }] }
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
const noted = (seen: string[]): string =>
  seen.find((s) => s.includes('document_import_note_failure')) ?? ''

describe('an Import press starts a Drive read (0960)', () => {
  beforeEach(() => {
    drive.got = { bytes: null, text: 'exported words', mime: 'text/plain', error: null }
    drive.meta = { mimeType: 'application/vnd.google-apps.document', name: 'Q3 plan', error: null }
    drive.readMime = ''
    drive.metaAsked = 0
  })

  it('asks Drive what a file is when the job carries no mime type, and reads it as that', async () => {
    await run({ document_id: DOC, title: 'Q3 plan' })
    expect(drive.metaAsked).toBe(1)
    expect(drive.readMime).toBe('application/vnd.google-apps.document')
  })

  it('CONTROL: a read that already knows the mime type does not ask', async () => {
    await run({ document_id: DOC, mime_type: 'application/pdf', title: 'x' })
    expect(drive.metaAsked).toBe(0)
    expect(drive.readMime).toBe('application/pdf')
  })

  it('takes the title from Drive when the job has none', async () => {
    const { seen } = await run({ document_id: DOC })
    expect(seen.find((s) => s.includes('record_drive_document'))).toContain("'Q3 plan'")
  })

  it('a failed read of an import is written onto the request, with the reason and the import job office', async () => {
    drive.got = { bytes: null, text: null, mime: '', error: 'drive 404: File not found' }
    const { seen, body } = await run({ document_id: DOC, mime_type: 'application/pdf', title: 'x' })
    expect(body).toContain('drive 404')
    expect(noted(seen)).toContain(`app.job_office('${JOB}'::uuid), '${DOC}'::uuid`)
    expect(noted(seen)).toContain('drive 404')
  })

  it('a failed metadata lookup is a failure too, and nothing is read', async () => {
    drive.meta = { mimeType: null, name: null, error: 'drive 403: no access' }
    const { seen, body } = await run({ document_id: DOC })
    expect(body).toContain('drive 403')
    expect(drive.readMime).toBe('')
    expect(noted(seen)).toContain('drive 403')
  })

  it('CONTROL: a failed read nobody asked to import annotates nothing', async () => {
    drive.got = { bytes: null, text: null, mime: '', error: 'drive 500' }
    const { seen, body } = await run({ mime_type: 'application/pdf', title: 'x' })
    expect(body).toContain('drive 500')
    expect(noted(seen)).toBe('')
  })
})
