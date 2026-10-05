/**
 * Observe means the office does not act, even inside the project. Making a document and saving a style are the office
 * acting, so both ask the one policy function (mayAct -> app.authorize_effect) for the tool they ARE, before doing
 * anything, and an answer that is not a plain yes stops them. The final audit found neither asked.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { artifactHandler } from '../../src/handlers/artifact.ts'
import { adoptStyleFromDocument } from '../../src/style/adopt.ts'

const JOB = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const PROJECT = '44444444-4444-4444-8444-444444444444'

const dbWith = (verdict: string | null) => {
  const sent: string[] = []
  const db = {
    execute: async (sql: string) => {
      sent.push(sql)
      if (sql.includes('authorize_effect')) {
        return {
          rows: [
            {
              d: verdict === null ? null : { action_level: 1, because: 'dial', tool: 'x', verdict },
            },
          ],
        }
      }
      if (sql.includes('select project_id::text as id')) return { rows: [{ id: PROJECT }] }
      if (sql.includes('style_adopt_from_document'))
        return { rows: [{ r: { ok: true, adopted: true } }] }
      return { rows: [] }
    },
  } as unknown as SqlExecutor
  return { db, sent }
}

describe('saving a style', () => {
  for (const v of ['refuse', 'ask', null]) {
    it(`${String(v)}: nothing is written`, async () => {
      const { db, sent } = dbWith(v)
      const r = await adoptStyleFromDocument(db, {
        jobId: JOB,
        slug: 'p',
        documentId: DOC,
        confirm: true,
      })
      expect(r.error).toMatch(/Autonomy for this project/)
      expect(sent.some((q) => q.includes('style_adopt_from_document'))).toBe(false)
    })
  }
  it('control: a plain yes saves', async () => {
    const { db, sent } = dbWith('proceed')
    const r = await adoptStyleFromDocument(db, {
      jobId: JOB,
      slug: 'p',
      documentId: DOC,
      confirm: true,
    })
    expect(r.adopted).toBe(true)
    expect(sent.some((q) => q.includes('style_adopt_from_document'))).toBe(true)
  })
})

describe('making a document', () => {
  for (const v of ['refuse', 'ask', null]) {
    it(`${String(v)}: no model is asked and nothing is stored`, async () => {
      const { db, sent } = dbWith(v)
      let asked = 0
      const router = { complete: async () => (asked++, { text: '{}' }) } as never
      const out = await artifactHandler({ db, router, projectRef: 'x', serviceKey: '' }).handle(
        { jobId: JOB, projectId: PROJECT } as never,
        {} as never,
      )
      expect(out.body).toMatch(/Autonomy for this project does not let me create documents/)
      expect(asked).toBe(0)
      expect(sent.some((q) => /record_file_document|document_revise_made/.test(q))).toBe(false)
    })
  }
})
