import { describe, expect, it } from 'vitest'
import type { Manifest } from '../../src/backup/manifest.ts'
import {
  authUserPayloads,
  batchRows,
  cronRestoreSql,
  dollarTag,
  type Fk,
  judgeTarget,
  PROTECTED_DATABASES,
  planLoadOrder,
  recoveryChecklist,
} from '../../src/backup/restore.ts'

const fk = (table: string, parent: string, name = `${table}_${parent}_fkey`): Fk => ({
  name,
  table,
  parent,
  def: `FOREIGN KEY (x) REFERENCES ${parent}(id)`,
  validated: true,
})

describe('judgeTarget: only a marked local replica that is not a template', () => {
  const good = { database: 'brt_dst', localSocket: true, marked: true }
  it('accepts exactly the one shape', () => {
    expect(judgeTarget(good)).toBeNull()
  })
  it('refuses a network peer, whatever else is true', () => {
    expect(judgeTarget({ ...good, localSocket: false })).toContain('network')
  })
  it('refuses an unmarked database, even a local one', () => {
    expect(judgeTarget({ ...good, marked: false })).toContain('isolated_replica_marker')
  })
  it('refuses every template and default database by name, even when marked and local', () => {
    for (const database of PROTECTED_DATABASES) {
      expect(judgeTarget({ ...good, database }), database).toContain('REFUSED')
    }
    expect(PROTECTED_DATABASES).toContain('post')
    expect(PROTECTED_DATABASES).toContain('postgres')
  })
  it('does not refuse a lookalike name (a guard that refuses everything proves nothing)', () => {
    for (const database of ['post_copy', 'brt_post', 'postgres2', 'mybase', 'prefix']) {
      expect(judgeTarget({ ...good, database }), database).toBeNull()
    }
  })
})

describe('planLoadOrder: parents first, and only the cycles are set aside', () => {
  it('orders a chain parents first', () => {
    const plan = planLoadOrder(['c', 'b', 'a'], [fk('c', 'b'), fk('b', 'a')])
    expect(plan.groups.flat()).toEqual(['a', 'b', 'c'])
    expect(plan.cyclic).toEqual([])
  })

  it('puts a self reference and a two-table cycle in their own groups and names exactly those foreign keys', () => {
    const fks = [
      fk('node', 'node'),
      fk('a', 'b'),
      fk('b', 'a'),
      fk('leaf', 'a'),
      fk('leaf', 'node'),
    ]
    const plan = planLoadOrder(['leaf', 'a', 'b', 'node'], fks)
    const order = plan.groups.flat()
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('leaf'))
    expect(order.indexOf('node')).toBeLessThan(order.indexOf('leaf'))
    expect(plan.groups.find((g) => g.includes('a'))).toEqual(['a', 'b'])
    expect(plan.cyclic.map((f) => f.name).sort()).toEqual([
      'a_b_fkey',
      'b_a_fkey',
      'node_node_fkey',
    ])
  })

  it('ignores a parent outside the plan (auth.users) and still orders the rest', () => {
    const plan = planLoadOrder(
      ['offices', 'projects'],
      [fk('offices', 'auth.users'), fk('projects', 'offices')],
    )
    expect(plan.groups.flat()).toEqual(['offices', 'projects'])
    expect(plan.cyclic).toEqual([])
  })

  it('holds the property on 300 random graphs: every foreign key between groups points to an EARLIER group', () => {
    let seed = 7
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let cycles = 0
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rnd() * 25)
      const tables = Array.from({ length: n }, (_, i) => `t${String(i)}`)
      const fks: Fk[] = []
      for (let i = 0; i < n * 1.5; i++) {
        const a = tables[Math.floor(rnd() * n)] as string
        const b = tables[Math.floor(rnd() * n)] as string
        fks.push(fk(a, b, `f${String(i)}`))
      }
      const plan = planLoadOrder(tables, fks)
      const groupOf = new Map<string, number>()
      plan.groups.forEach((g, i) => {
        for (const t of g) groupOf.set(t, i)
      })
      expect(groupOf.size).toBe(n)
      const cyclic = new Set(plan.cyclic.map((f) => f.name))
      for (const f of fks) {
        const same = groupOf.get(f.table) === groupOf.get(f.parent)
        if (same) {
          expect(cyclic.has(f.name)).toBe(true)
        } else {
          expect(cyclic.has(f.name)).toBe(false)
          expect(groupOf.get(f.parent) as number).toBeLessThan(groupOf.get(f.table) as number)
        }
      }
      if (plan.cyclic.length > 0) cycles++
    }
    // not vacuous: the random graphs do contain cycles, so the cyclic branch was exercised
    expect(cycles).toBeGreaterThan(100)
  })

  it('is deterministic for the same input in any order', () => {
    const fks = [fk('b', 'a'), fk('c', 'a'), fk('d', 'b')]
    expect(planLoadOrder(['d', 'c', 'b', 'a'], fks)).toEqual(
      planLoadOrder(['a', 'b', 'c', 'd'], [...fks].reverse()),
    )
  })
})

describe('batching and quoting', () => {
  it('never splits a row and keeps every batch near the limit', () => {
    const rows = Array.from(
      { length: 50 },
      (_, i) => `{"id":${String(i)},"pad":"${'x'.repeat(90)}"}`,
    )
    const batches = batchRows(rows, 1000)
    expect(batches.length).toBeGreaterThan(3)
    expect(batches.map((b) => JSON.parse(b).length).reduce((a, b) => a + b, 0)).toBe(50)
    for (const b of batches) expect(() => JSON.parse(b)).not.toThrow()
  })
  it('puts a single oversized row in a batch of its own rather than refusing it', () => {
    const big = `{"x":"${'y'.repeat(5000)}"}`
    expect(batchRows([big, '{"x":1}'], 100)).toHaveLength(2)
  })
  it('chooses a dollar-quote tag that is not in the payload', () => {
    expect(dollarTag('plain')).toBe('$r0$')
    expect(dollarTag('has $r0$ inside')).toBe('$r1$')
    expect(dollarTag('$r0$ and $r1$ and $r2$')).toBe('$r3$')
  })
})

const manifest = (aux: Manifest['aux']): Manifest => ({
  latest_migration: '1022_x.sql',
  tables: 3,
  rows: 42,
  ...(aux === undefined ? {} : { aux }),
})
const section = <T>(rows: T[], ok = true) => ({ ok, rows })

describe('what a recovery needs that is not rows', () => {
  const aux = {
    aux_version: 1,
    sequences: section([]),
    cron_jobs: section([
      {
        jobname: 'worker-heartbeat',
        schedule: '* * * * *',
        command: 'select app.kick_worker()',
        active: true,
      },
      { jobname: 'paused', schedule: '0 * * * *', command: 'select 1 /* $r0$ */', active: false },
    ]),
    vault_names: section([
      { name: 'a', description: null },
      { name: 'b', description: null },
    ]),
    auth_users: section([
      {
        id: 'u1',
        email: 'a@example.com',
        phone: '',
        email_confirmed_at: '2026-01-01',
        raw_user_meta_data: { n: 1 },
        raw_app_meta_data: null,
      },
      { id: 'u2', email: null, phone: '+441', email_confirmed_at: null },
    ]),
    storage_buckets: section([]),
    storage_objects: section([
      { bucket_id: 'files', name: 'a', size: '1', mimetype: null, etag: null },
    ]),
    extensions: section([]),
    structure: null,
  } as unknown as Manifest['aux']

  it('lists every manual step as manual and counts what the manifest recorded', () => {
    const list = recoveryChecklist(manifest(aux))
    const by = Object.fromEntries(list.map((i) => [i.id, i]))
    expect(by['auth-users']?.count).toBe(2)
    expect(by.vault?.count).toBe(2)
    expect(by.cron?.count).toBe(2)
    expect(by.storage?.count).toBe(1)
    for (const id of ['project', 'vault', 'storage', 'functions', 'webhooks', 'auth-config']) {
      expect(by[id]?.kind, id).toBe('manual')
    }
    expect(by.rows?.kind).toBe('automated')
    expect(list.map((i) => i.id).indexOf('auth-users')).toBeLessThan(
      list.map((i) => i.id).indexOf('rows') + 1 + 1,
    )
  })

  it('says so when the archive recorded nothing, instead of printing a zero as if it were an answer', () => {
    const list = recoveryChecklist(manifest(undefined))
    expect(list.find((i) => i.id === 'auth-users')?.what).toContain('the archive recorded none')
    const unreadable = recoveryChecklist(
      manifest({ ...aux, auth_users: section([], false) } as unknown as Manifest['aux']),
    )
    expect(unreadable.find((i) => i.id === 'auth-users')?.what).toContain('could not be read')
  })

  it('builds Auth admin payloads with the original id, and never a password', () => {
    const p = authUserPayloads(manifest(aux))
    expect(p).toEqual([
      { id: 'u1', email_confirm: true, email: 'a@example.com', user_metadata: { n: 1 } },
      { id: 'u2', email_confirm: false, phone: '+441' },
    ])
    for (const body of p)
      for (const k of Object.keys(body)) expect(/pass|hash|token/i.test(k)).toBe(false)
  })

  it('builds cron.schedule statements, quotes a command that contains a dollar tag, and keeps a paused job paused', () => {
    const sql = cronRestoreSql(manifest(aux))
    expect(sql[0]).toBe(
      "select cron.schedule('worker-heartbeat', '* * * * *', $r0$select app.kick_worker()$r0$)",
    )
    expect(sql[1]).toContain('$r1$select 1 /* $r0$ */$r1$')
    expect(sql[2]).toBe("update cron.job set active = false where jobname = 'paused'")
    expect(sql).toHaveLength(3)
  })
})
