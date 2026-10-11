import { describe, expect, it } from 'vitest'
import { planSwitch, readState } from '../../src/activity/switch'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const off = { master: false, allowlist: null }

describe('planning the ledger switches', () => {
  it('a canary writes the allowlist BEFORE it turns the master on', () => {
    const p = planSwitch({ kind: 'canary', offices: [A] }, off)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.statements).toHaveLength(2)
    expect(p.statements[0]).toContain('activity.ledger_offices')
    expect(p.statements[0]).toContain(A)
    expect(p.statements[1]).toContain(`'true'::jsonb`)
    expect(p.statements[1]).toContain('activity.ledger_enabled')
  })

  it('off writes the master only, so the kill switch never depends on the allowlist', () => {
    const p = planSwitch({ kind: 'off' }, { master: true, allowlist: [A] })
    expect(p.ok && p.statements).toHaveLength(1)
    expect(p.ok && p.statements[0]).toContain(`'false'::jsonb`)
    expect(p.ok && p.statements[0]).not.toContain('activity.ledger_offices')
  })

  it('all removes the allowlist and then turns the master on, and says every office', () => {
    const p = planSwitch({ kind: 'all' }, off)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.statements[0]).toContain('delete from public.system_config')
    expect(p.statements[1]).toContain(`'true'::jsonb`)
    expect(p.note).toMatch(/EVERY office/)
  })

  it('add extends an existing allowlist without duplicates and sorts it', () => {
    const p = planSwitch({ kind: 'add', offices: [B, A] }, { master: true, allowlist: [A] })
    expect(p.ok).toBe(true)
    if (!p.ok) return
    expect(p.statements[0]).toContain(JSON.stringify([A, B]))
  })

  it('refuses add when there is no allowlist (it would narrow nothing)', () => {
    const p = planSwitch({ kind: 'add', offices: [A] }, { master: true, allowlist: null })
    expect(p.ok).toBe(false)
  })

  it('refuses an empty list and anything that is not a UUID', () => {
    expect(planSwitch({ kind: 'canary', offices: [] }, off).ok).toBe(false)
    const p = planSwitch({ kind: 'canary', offices: [A, "x'; drop table t; --"] }, off)
    expect(p.ok).toBe(false)
    expect(p.ok ? '' : p.refusal).toMatch(/not UUIDs/)
  })

  it('the SQL of a canary can contain only the ids that passed the UUID test (no injection path)', () => {
    const p = planSwitch({ kind: 'canary', offices: [A, B] }, off)
    expect(p.ok && p.statements.join('\n')).not.toMatch(/drop|--|;\s*\w/i)
  })

  it('reads the stored settings as the database does: only a true master is on, only an array is an allowlist of strings', () => {
    expect(readState(true, null)).toEqual({ master: true, allowlist: null })
    expect(readState('true', null).master).toBe(false)
    expect(readState(false, { value: [A, 7, null] }).allowlist).toEqual([A])
    expect(readState(true, { value: 'not an array' }).allowlist).toEqual([])
  })
})
