import { describe, expect, it } from 'vitest'
import {
  ALL_OFFICES_VALUE,
  CONFIRM_ALL_PHRASE,
  effective,
  planSwitch,
  readState,
} from '../../src/activity/switch'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const state = (master: unknown, allowlist: unknown | undefined) =>
  readState(
    master === undefined ? null : JSON.stringify(master),
    allowlist === undefined ? null : JSON.stringify(allowlist),
  )
const sql = (p: ReturnType<typeof planSwitch>) => (p.ok ? p.statements.map((s) => s.sql) : [])

describe('what the stored settings mean (readState mirrors app.activity_ledger_covers)', () => {
  const cases: [string, unknown, unknown | undefined, string][] = [
    ['master false, no allowlist', false, undefined, 'none'],
    ['master true, no allowlist row', true, undefined, 'absent'],
    ['master true, allowlist null', true, null, 'absent'],
    ['master true, empty array', true, [], 'offices'],
    ['master true, valid array', true, [A], 'offices'],
    ['master true, array with junk', true, [A, 7, null, 'not-a-uuid', { x: 1 }], 'offices'],
    ['master true, duplicates', true, [A, A, B], 'offices'],
    ['master true, uppercase uuid string', true, [A.toUpperCase()], 'offices'],
    ['master true, explicit all', true, { version: 1, mode: 'all' }, 'all'],
    ['master true, explicit all with keys reordered', true, { mode: 'all', version: 1 }, 'all'],
    ['master true, all with another version', true, { version: 2, mode: 'all' }, 'invalid'],
    [
      'master true, all with an extra key',
      true,
      { version: 1, mode: 'all', also: true },
      'invalid',
    ],
    ['master true, unknown mode', true, { version: 1, mode: 'most' }, 'invalid'],
    ['master true, bare string all', true, 'all', 'invalid'],
    ['master true, a number', true, 1, 'invalid'],
    ['master true, a boolean', true, true, 'invalid'],
  ]
  for (const [name, master, list, kind] of cases) {
    it(name, () => {
      const s = state(master, list)
      if (name.startsWith('master false')) expect(s.master).toBe(false)
      else expect(s.allowlist.kind).toBe(kind)
    })
  }
  it('only a boolean true master is on (a string, a number or a missing row is off)', () => {
    expect(state(true, undefined).master).toBe(true)
    for (const m of ['true', 1, 'on', null, false, undefined])
      expect(state(m, undefined).master).toBe(false)
  })
  it('malformed JSON text is an invalid allowlist and an off master, never a thrown error', () => {
    expect(readState('{', '[broken').master).toBe(false)
    expect(readState('true', '[broken').allowlist.kind).toBe('invalid')
  })
  it('duplicates and junk entries are removed from the offices it reports', () => {
    const s = state(true, [B, A, A, 'x'])
    expect(s.allowlist).toEqual({ kind: 'offices', offices: [A, B] })
  })
})

describe('the effective result in words (never a quiet "on")', () => {
  it('names every office loudly and no office plainly', () => {
    expect(effective(true, { kind: 'all' })).toMatch(/EVERY OFFICE/)
    expect(effective(false, { kind: 'all' })).toMatch(/NO OFFICE/)
    expect(effective(true, { kind: 'absent' })).toMatch(/NO OFFICE/)
    expect(effective(true, { kind: 'invalid' })).toMatch(/NO OFFICE/)
    expect(effective(true, { kind: 'offices', offices: [] })).toMatch(/NO OFFICE/)
    expect(effective(true, { kind: 'offices', offices: [A] })).toMatch(/1 OFFICE\(S\) ONLY/)
  })
})

describe('planning', () => {
  it('status writes nothing', () => {
    const p = planSwitch({ kind: 'status' }, state(true, [A]))
    expect(p.ok && p.statements).toEqual([])
  })

  it('a canary from off writes the allowlist BEFORE the master', () => {
    const p = planSwitch({ kind: 'canary', offices: [A] }, state(false, undefined))
    expect(p.ok).toBe(true)
    const s = sql(p)
    expect(s).toHaveLength(2)
    expect(s[0]).toContain('activity.ledger_offices')
    expect(s[1]).toContain('activity.ledger_enabled')
    expect(s[1]).toContain(`'true'::jsonb`)
    expect(p.ok && p.proposed).toMatch(/1 OFFICE\(S\) ONLY/)
  })

  it('every statement is guarded by the value that was read (compare-and-swap)', () => {
    const p = planSwitch({ kind: 'canary', offices: [A] }, state(false, [B]))
    const s = sql(p)
    expect(s[0]).toContain(`and value = '[`)
    expect(s[1]).toContain(`and value = 'false'::jsonb`)
    expect(s.every((x) => x.includes('returning key'))).toBe(true)
    const fresh = sql(planSwitch({ kind: 'canary', offices: [A] }, state(false, undefined)))
    expect(fresh[0]).toContain('on conflict (key) do nothing')
  })

  it('narrowing from every office to one office is ONE statement', () => {
    const p = planSwitch({ kind: 'canary', offices: [A] }, state(true, ALL_OFFICES_VALUE))
    expect(sql(p)).toHaveLength(1)
    expect(p.ok && p.current).toMatch(/EVERY OFFICE/)
    expect(p.ok && p.proposed).toMatch(/1 OFFICE\(S\) ONLY/)
  })

  it('off writes the master only, whatever the allowlist is', () => {
    for (const list of [undefined, [A], ALL_OFFICES_VALUE, 'garbage']) {
      const s = sql(planSwitch({ kind: 'off' }, state(true, list)))
      expect(s).toHaveLength(1)
      expect(s[0]).toContain(`'false'::jsonb`)
      expect(s[0]).not.toContain('activity.ledger_offices')
    }
  })

  it('global activation is refused without the exact confirmation phrase', () => {
    for (const confirm of ['', 'yes', 'all offices', 'ALL OFFICES ', 'ALL']) {
      const p = planSwitch({ kind: 'all', confirm }, state(false, undefined))
      expect(p.ok).toBe(false)
      expect(p.ok ? '' : p.refusal).toMatch(/EVERY office/)
    }
  })

  it('global activation writes the explicit global value, then the master last, and never deletes anything', () => {
    const p = planSwitch({ kind: 'all', confirm: CONFIRM_ALL_PHRASE }, state(false, [A]))
    const s = sql(p)
    expect(s).toHaveLength(2)
    expect(s[0]).toContain('"mode":"all"')
    expect(s[0]).toContain('"version":1')
    expect(s[1]).toContain('activity.ledger_enabled')
    expect(s.join(' ')).not.toMatch(/delete/i)
    expect(p.ok && p.headline).toMatch(/GLOBAL ACTIVATION: EVERY OFFICE/)
  })

  it('add extends the list without duplicates; remove narrows it in one statement; neither touches the master', () => {
    const add = planSwitch({ kind: 'add', offices: [B, A] }, state(true, [A]))
    expect(sql(add)).toHaveLength(1)
    expect(sql(add)[0]).toContain(JSON.stringify([A, B]))
    const remove = planSwitch({ kind: 'remove', offices: [A] }, state(true, [A, B]))
    expect(sql(remove)).toHaveLength(1)
    expect(sql(remove)[0]).toContain(JSON.stringify([B]))
    expect(sql(remove)[0]).not.toContain('activity.ledger_enabled')
  })

  it('removing the last office leaves an EMPTY list, which is no office, never an absent row', () => {
    const p = planSwitch({ kind: 'remove', offices: [A] }, state(true, [A]))
    expect(sql(p)[0]).toContain(`'[]'::jsonb`)
    expect(p.ok && p.proposed).toMatch(/NO OFFICE/)
  })

  it('add and remove refuse anything but a real list (absent, invalid, global): use --canary', () => {
    for (const list of [
      undefined,
      null,
      'garbage',
      ALL_OFFICES_VALUE,
      { version: 9, mode: 'all' },
    ]) {
      for (const kind of ['add', 'remove'] as const) {
        const p = planSwitch({ kind, offices: [A] }, state(true, list))
        expect(p.ok).toBe(false)
      }
    }
  })

  it('a canary can replace an INVALID allowlist (the way out of a bad value)', () => {
    const p = planSwitch({ kind: 'canary', offices: [A] }, state(true, 'garbage'))
    expect(p.ok).toBe(true)
    expect(sql(p)).toHaveLength(1)
  })

  it('operations are idempotent: asking for what is already set plans nothing', () => {
    expect(sql(planSwitch({ kind: 'canary', offices: [A] }, state(true, [A])))).toEqual([])
    expect(sql(planSwitch({ kind: 'off' }, state(false, [A])))).toEqual([])
    expect(
      sql(planSwitch({ kind: 'all', confirm: CONFIRM_ALL_PHRASE }, state(true, ALL_OFFICES_VALUE))),
    ).toEqual([])
    expect(sql(planSwitch({ kind: 'add', offices: [A] }, state(true, [A, B])))).toEqual([])
    expect(sql(planSwitch({ kind: 'remove', offices: [A] }, state(true, [B])))).toEqual([])
  })

  it('refuses an empty list and anything that is not a lower-case UUID, with no injection path', () => {
    expect(planSwitch({ kind: 'canary', offices: [] }, state(false, undefined)).ok).toBe(false)
    for (const bad of [
      "x'; drop table t; --",
      'AAAAAAAA-1111-4111-8111-111111111111',
      'not-a-uuid',
      '',
    ]) {
      expect(planSwitch({ kind: 'canary', offices: [A, bad] }, state(false, undefined)).ok).toBe(
        false,
      )
    }
    const ok = sql(planSwitch({ kind: 'canary', offices: [A, B] }, state(false, undefined))).join(
      '\n',
    )
    expect(ok).not.toMatch(/drop|--/i)
  })

  it('no plan ever ends with the master on and the allowlist absent, invalid or global-by-default', () => {
    const states = [
      state(false, undefined),
      state(true, undefined),
      state(true, 'x'),
      state(false, [A]),
      state(true, ALL_OFFICES_VALUE),
    ]
    for (const st of states) {
      for (const req of [{ kind: 'canary', offices: [B] }, { kind: 'off' }] as const) {
        const p = planSwitch(req, st)
        expect(p.ok && !/EVERY OFFICE/.test(p.proposed)).toBe(true)
      }
    }
  })
})
