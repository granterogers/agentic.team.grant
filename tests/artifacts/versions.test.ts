/**
 * A made report's history and the door that starts it (src/artifacts/versions.ts, handlers/artifact.ts, actions.ts).
 *
 *  - the style a report was set in is recorded as a hash that moves when the style does (and only then),
 *  - a revision asks the database for a NEW VERSION of the head and says plainly when it could not,
 *  - generating, saving and versioning needs no approval, and nothing in this path can send a file anywhere but the
 *    channel that asked (the approval gate guards everything wider and is not bypassed),
 *  - "make a beautiful PDF of the latest customer research report" starts an artifact job; a revision verb does too.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { artifactRequest } from '../../src/agents/actions.ts'
import { renderReport } from '../../src/artifacts/report.ts'
import {
  recordProvenance,
  reviseMade,
  styleHash,
  versionNote,
} from '../../src/artifacts/versions.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { askWhich, compose } from '../../src/handlers/artifact.ts'
import { SAMPLE } from './sample-report.ts'

const text = (b: Uint8Array): string => Buffer.from(b).toString('latin1')

describe('style: change it, revise, and the colours, faces and recorded hash all change', () => {
  const v1 = {
    palette: { primary: '#aa3322' },
    typography: { body: 'Times', heading: 'Helvetica' },
  }
  const v2 = {
    palette: { primary: '#117755' },
    typography: { body: 'Helvetica', heading: 'Times' },
  }

  it('the hash is stable, order-independent and moves only with the style', () => {
    expect(styleHash(v1)).toBe(styleHash(JSON.parse(JSON.stringify(v1))))
    expect(styleHash({ typography: v1.typography, palette: v1.palette })).toBe(styleHash(v1))
    expect(styleHash(v2)).not.toBe(styleHash(v1))
    expect(styleHash(null)).toBe('default')
    expect(styleHash({})).toBe('default')
    expect(styleHash(v1)).toMatch(/^[0-9a-f]{12}$/)
  })

  it('the revised file carries the new colour and the new faces, and the recorded hash differs', () => {
    const blocks = [...SAMPLE.blocks]
    const first = compose({ blocks }, v1)
    const second = compose({ blocks }, v2)
    const a = text(renderReport({ ...SAMPLE, blocks: first.blocks }, first.style).bytes)
    const b = text(renderReport({ ...SAMPLE, blocks: second.blocks }, second.style).bytes)
    expect(a).not.toBe(b)
    // 0.667 0.2 0.133 = #aa3322 ; 0.067 0.467 0.333 = #117755 (the primary colour, as the writer emits it)
    expect(a).toMatch(/0\.667 0\.2 0\.133 (rg|RG)/)
    expect(b).toMatch(/0\.067 0\.467 0\.333 (rg|RG)/)
    expect(a).not.toMatch(/0\.067 0\.467 0\.333 (rg|RG)/)
    expect(styleHash(v1)).not.toBe(styleHash(v2))
  })

  it('an unchanged style gives identical bytes and the identical hash: no phantom differences', () => {
    const c1 = compose({ blocks: [...SAMPLE.blocks] }, v1)
    const c2 = compose({ blocks: [...SAMPLE.blocks] }, v1)
    expect(text(renderReport({ ...SAMPLE, blocks: c1.blocks }, c1.style).bytes)).toBe(
      text(renderReport({ ...SAMPLE, blocks: c2.blocks }, c2.style).bytes),
    )
  })
})

describe('the version call', () => {
  const fake = (answer: unknown): { db: SqlExecutor; sql: string[] } => {
    const sql: string[] = []
    return {
      db: {
        execute: async (q: string) => {
          sql.push(q)
          return { rows: [{ r: answer }] }
        },
        kind: 'fake',
      },
      sql,
    }
  }
  const ids = {
    headId: '11111111-1111-1111-1111-111111111111',
    newId: '22222222-2222-2222-2222-222222222222',
    office: '33333333-3333-3333-3333-333333333333',
  }

  it('asks the database to make the new document the next version of the head', async () => {
    const { db, sql } = fake({ ok: true, version: 2 })
    const r = await reviseMade(db, ids, 'a note')
    expect(r).toEqual({ already: false, error: null, ok: true, pending: false, version: 2 })
    expect(sql[0]).toContain('app.document_revise_made(')
    expect(sql[0]).toContain(ids.headId)
    expect(sql[0]).toContain(ids.newId)
  })

  it('a draft revision beside an approved head is reported as pending (approval belongs to a version)', async () => {
    const r = await reviseMade(
      fake({ current_id: ids.headId, ok: true, pending_id: ids.newId, version: 4 }).db,
      ids,
      '',
    )
    expect(r.pending).toBe(true)
    expect(r.version).toBe(4)
  })

  it('a revision that became current is not pending', async () => {
    const r = await reviseMade(fake({ current_id: ids.newId, ok: true, version: 2 }).db, ids, '')
    expect(r.pending).toBe(false)
  })

  it('a repeat is reported as already, not as a second version', async () => {
    const r = await reviseMade(fake({ already: true, ok: true, version: 2 }).db, ids, '')
    expect(r.already).toBe(true)
    expect(r.version).toBe(2)
  })

  it('a refusal comes back as a sentence for the caller to say, never thrown', async () => {
    const r = await reviseMade(
      fake({ error: 'that is not the latest version of this document', ok: false }).db,
      ids,
      '',
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not the latest version')
  })

  it('provenance is recorded by named arguments with the style hash and updated_at', async () => {
    const { db, sql } = fake({ ok: true })
    const err = await recordProvenance(
      db,
      { documentId: ids.newId, office: ids.office },
      {
        design: { titlePage: 'band' },
        jobId: ids.headId,
        sources: [{ label: "O'Brien notes", ref: 'notebooklm:abc' }],
        styleHash: 'abc123def456',
        styleUpdatedAt: '2026-10-01T00:00:00Z',
      },
    )
    expect(err).toBeNull()
    expect(sql[0]).toContain("p_style_hash => 'abc123def456'")
    expect(sql[0]).toContain('2026-10-01T00:00:00Z')
    expect(sql[0]).toContain("O''Brien notes") // quoted, not interpolated raw
  })

  it('the version note names the job, the style and the sources, and stays short', () => {
    const n = versionNote({
      instruction: 'x '.repeat(500),
      jobId: 'abcdef12-0000',
      sources: [{ label: 'Research report' }],
      styleHash: 'h',
    })
    expect(n).toContain('abcdef12')
    expect(n).toContain('style h')
    expect(n).toContain('Research report')
    expect(n.length).toBeLessThan(400)
  })
})

describe('no approval is needed to make, save or version; sending anywhere else is not done here', () => {
  // Comments explain; only code acts. A comment naming sendDocument is not a call.
  const code = (f: string): string =>
    readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
  const handler = code('src/handlers/artifact.ts')
  const versions = code('src/artifacts/versions.ts')
  const source = `${code('src/artifacts/source.ts')}\n${code('src/artifacts/store.ts')}`
  const all = `${handler}\n${versions}\n${source}`

  it('the whole path imports nothing that can send or publish outside the office', () => {
    const imports = [...all.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '')
    // The policy QUESTION (mayAct: may the office make a document at this dial) is the one thing from the approval module
    // the path may import; nothing that asks a person, raises a blocker or sends is. It is asserted to be used as that.
    const bad = imports
      .filter((i) => i !== '../agents/approval.ts')
      .filter((i) =>
        /slack|telegram|gmail|google|notion|voice|pager|channels|approval|mail\//.test(i),
      )
    expect(bad).toEqual([])
    expect(all).toMatch(/await mayAct\(db, \{[^}]*tool: 'document\.create'/s)
  })

  it("the only database functions it calls are reads, the office's own writes and the checkpoint", () => {
    const fns = new Set([...all.matchAll(/\bapp\.([a-z_]+)\(/g)].map((m) => m[1]))
    const outward = [...fns].filter((f) =>
      /(send|post|publish|share|deliver|notify|approv|blocker|decline|grant|enqueue|email|invite)/.test(
        f ?? '',
      ),
    )
    expect(outward).toEqual([])
    // and the writes it does make are the ones that keep the work in the project
    for (const f of [
      'record_file_document',
      'document_revise_made',
      'document_provenance_record',
    ]) {
      expect(fns.has(f) || all.includes(f)).toBe(true)
    }
  })

  it('the file leaves ONLY as the answer to the turn that asked: attachFile on the handler output', () => {
    expect(handler.match(/attachFile:/g)?.length).toBe(1)
    expect(handler).not.toMatch(/sendDocument|chat\.postMessage|files\.upload|messages\.send/)
  })
})

describe('the door', () => {
  const asks = [
    'Find the latest customer research report and turn it into a beautiful PDF.',
    'Make a beautiful PDF of the latest customer research report',
    'Turn the customer research report into a polished PDF',
    'Redo the PDF with a band title',
    'Revise the report so it is shorter',
  ]
  for (const a of asks) {
    it(`starts an artifact job: ${a.slice(0, 55)}`, () => {
      expect(artifactRequest(a)).not.toBeNull()
    })
  }
  const nots = [
    'Did you see the customer research report Elena sent?',
    "Don't make me a PDF of that",
    'Turn the heating down',
    'Send me the report you made yesterday',
    'Tell me what the latest customer research report says',
  ]
  for (const n of nots) {
    it(`starts none: ${n.slice(0, 55)}`, () => {
      expect(artifactRequest(n)).toBeNull()
    })
  }
})

describe('when it cannot tell which document, it asks and makes nothing', () => {
  it('lists the candidates for an ambiguous phrase', () => {
    const q = askWhich('the customer research report', 'ambiguous', [
      { title: 'Customer research Q1' },
      { title: 'Customer research Q3' },
    ])
    expect(q).toContain('1. Customer research Q1')
    expect(q).toContain('2. Customer research Q3')
    expect(q).toContain('Nothing was created')
  })
  it('says plainly when nothing matches and nothing is held', () => {
    expect(askWhich('the report', 'none', [])).toContain('could not find')
  })
  it('does not claim to have found a file it cannot read', () => {
    const q = askWhich('the report', 'unreadable', [{ title: 'Scan.pdf' }])
    expect(q).toContain('hold no text')
  })
})
