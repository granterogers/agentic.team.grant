import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { KEEP_OPTION, keepStyle, REPLACE_OPTION } from '../../src/handlers/style-keep.ts'
import { saidAboutAdoption } from '../../src/style/adopt.ts'

const JOB = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const DOC2 = '33333333-3333-4333-8333-333333333333'
const PROJECT = '44444444-4444-4444-8444-444444444444'

type Answer = (sql: string) => unknown[] | undefined
/** A recording executor: the first matching answer wins; everything it is sent is kept. */
const fake = (answer: Answer) => {
  const sent: string[] = []
  const db = {
    execute: async (sql: string) => {
      sent.push(sql)
      return { rows: answer(sql) ?? [] }
    },
  } as unknown as SqlExecutor
  return { db, sent }
}
const cand = (id: string, title: string, o: object = {}) => ({
  document_id: id,
  title,
  created_at: '2026-10-01T00:00:00Z',
  in_thread: false,
  has_snapshot: true,
  ...o,
})
const base =
  (cands: unknown[], adopt: unknown): Answer =>
  (sql) => {
    if (sql.includes('select slug from public.projects')) return [{ slug: 'p' }]
    if (sql.includes('select project_id::text as id')) return [{ id: PROJECT }]
    if (sql.includes('style_source_candidates')) return [{ c: cands }]
    if (sql.includes('command_principal')) return [{ p: 'grant' }]
    if (sql.includes('authorize_effect'))
      return [{ d: { action_level: 1, because: 'dial', tool: 'style.save', verdict: 'proceed' } }]
    if (sql.includes('app.style_adopt_from_document')) return [{ r: adopt }]
    return undefined
  }
const ctx = (o: object = {}) => ({
  jobId: JOB,
  projectId: PROJECT,
  commandId: null,
  channel: 'telegram',
  staffSlug: 'chief-of-staff',
  request: { hint: null, onlyThat: true },
  ...o,
})

describe('keepStyle', () => {
  it('saves the one report, through the one function, once, naming the channel', async () => {
    const { db, sent } = fake(
      base([cand(DOC, 'Pricing', { in_thread: true })], { ok: true, adopted: true }),
    )
    const r = await keepStyle(db, ctx())
    expect(r.outcome).toBe('saved')
    expect(r.body).toMatch(/^Saved\./)
    const calls = sent.filter((s) => s.includes('app.style_adopt_from_document'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain(`'${DOC}'::uuid`)
    expect(calls[0]).toContain('false,') // not confirmed
    expect(calls[0]).toContain("'telegram'")
    expect(
      sent.some((s) => /style_profiles/i.test(s.replace('app.style_adopt_from_document', ''))),
    ).toBe(false)
  })

  it('asks which when two are plausible and calls nothing', async () => {
    const { db, sent } = fake(
      base([cand(DOC, 'Alpha', { in_thread: true }), cand(DOC2, 'Beta', { in_thread: true })], {}),
    )
    const r = await keepStyle(db, ctx())
    expect(r.outcome).toBe('asked_which')
    expect(r.body).toContain('Alpha')
    expect(r.body).toContain('Beta')
    expect(sent.some((s) => s.includes('app.style_adopt_from_document'))).toBe(false)
  })

  it('an existing style is a question: raises it with a yes that carries the confirmed replace, and replaces nothing', async () => {
    const raised: unknown[] = []
    const { db, sent } = fake(
      base([cand(DOC, 'Pricing')], { ok: false, needs_confirmation: true, replaces: ['palette'] }),
    )
    const r = await keepStyle(db, ctx(), async (_db, draft) => {
      raised.push(draft)
      return 'blocker-1'
    })
    expect(r.outcome).toBe('asked_to_replace')
    expect(r.blockerId).toBe('blocker-1')
    expect(r.body).toMatch(/Nothing has been changed yet/)
    expect(sent.filter((s) => s.includes('app.style_adopt_from_document'))).toHaveLength(1)
    const draft = raised[0] as {
      approvalOptions: string[]
      declineOption: string
      onAnswer: { option: string; kind: string; payloads: Array<Record<string, unknown>> }
    }
    expect(draft.approvalOptions).toEqual([REPLACE_OPTION, KEEP_OPTION])
    expect(draft.declineOption).toBe(KEEP_OPTION)
    expect(draft.onAnswer.kind).toBe('style.adopt')
    expect(draft.onAnswer.option).toBe(REPLACE_OPTION)
    expect(draft.onAnswer.payloads[0]).toMatchObject({ confirm: true, document_id: DOC, slug: 'p' })
  })

  it('a report made before styles were recorded is said plainly, with nothing changed', async () => {
    const { db } = fake(
      base([cand(DOC, 'Old', { has_snapshot: false })], {
        error:
          'This report was made before its style was recorded, so there is no style to save from it. Nothing was changed. A report made from now on can be saved.',
        no_snapshot: true,
      }),
    )
    const r = await keepStyle(db, ctx())
    expect(r.outcome).toBe('refused')
    expect(r.body).toMatch(/before its style was recorded/)
    expect(r.body).not.toMatch(/Saved/)
  })

  it('no project in the conversation: says so, and reads and writes nothing', async () => {
    const { db, sent } = fake(() => undefined)
    const r = await keepStyle(db, ctx({ projectId: null }))
    expect(r.outcome).toBe('no_project')
    expect(sent).toHaveLength(0)
  })

  it('a reader that cannot run does not fail the turn: it says nothing was saved', async () => {
    const sent: string[] = []
    const db = {
      execute: async (sql: string) => {
        sent.push(sql)
        if (sql.includes('select slug from public.projects')) return { rows: [{ slug: 'p' }] }
        throw new Error('function app.style_source_candidates does not exist')
      },
    } as unknown as SqlExecutor
    const r = await keepStyle(db, ctx())
    expect(r.outcome).toBe('none')
    expect(r.body).toMatch(/saved nothing/)
    expect(sent.some((x) => x.includes('app.style_adopt_from_document'))).toBe(false)
  })

  it('no report in the project: says so', async () => {
    const { db } = fake(base([], {}))
    expect((await keepStyle(db, ctx())).outcome).toBe('none')
  })

  it('says when the rest of the message was not done', async () => {
    const { db } = fake(base([cand(DOC, 'P')], { ok: true, adopted: true }))
    const r = await keepStyle(db, ctx({ request: { hint: null, onlyThat: false } }))
    expect(r.body).toMatch(/rest of it needs asking again/)
  })
})

describe('saidAboutAdoption', () => {
  it('never says saved for anything that was not', () => {
    expect(saidAboutAdoption('X', { error: 'no' })).not.toMatch(/Saved/)
    expect(saidAboutAdoption('X', { error: 'no' })).toMatch(/Nothing was changed/)
    expect(saidAboutAdoption('X', { adopted: true })).toMatch(/^Saved\./)
    expect(saidAboutAdoption('X', { unchanged: true })).toMatch(/nothing to change/)
  })
})
