import { describe, expect, it } from 'vitest'
import { AUTH_COLUMN_WHITELIST, AUTH_COLUMNS_NEVER_READ, collectAux } from '../../src/backup/aux.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'

const TOKEN = `${'xo'}xb-${'1'.repeat(11)}-${'a'.repeat(24)}`

/** A database with `auth.users` columns of our choosing; records every statement it is asked to run. */
const fake = (authColumns: string[], fail: string[] = []): { db: SqlExecutor; asked: string[] } => {
  const asked: string[] = []
  const db: SqlExecutor = {
    kind: 'fake',
    execute: async (sql: string) => {
      asked.push(sql)
      for (const f of fail) if (sql.includes(f)) throw new Error(`permission denied for ${f}`)
      if (sql.includes("table_schema = 'auth'"))
        return { rows: authColumns.map((c) => ({ column_name: c })) }
      if (sql.includes('from auth.users')) return { rows: [{ id: 'u1', email: 'a@example.com' }] }
      if (sql.includes('from cron.job')) {
        return {
          rows: [
            {
              jobname: 'hb',
              schedule: '* * * * *',
              command: `select 1 /* ${TOKEN} */`,
              active: true,
            },
          ],
        }
      }
      if (sql.includes('vault.secrets')) return { rows: [{ name: 'a.key', description: null }] }
      if (sql.includes('as tables'))
        return {
          rows: [
            {
              tables: 1,
              columns: 2,
              columns_md5: 'x',
              constraints: 3,
              foreign_keys: 1,
              triggers: 0,
              policies: 0,
              indexes: 1,
              rls_tables: 0,
            },
          ],
        }
      return { rows: [] }
    },
  }
  return { db, asked }
}

describe('collectAux', () => {
  it('reads only whitelisted auth.users columns, even when the table has password hashes and tokens', async () => {
    const { db, asked } = fake([
      'id',
      'email',
      'encrypted_password',
      'confirmation_token',
      'recovery_token',
      'phone',
      'raw_user_meta_data',
    ])
    await collectAux(db)
    const q = asked.find((s) => s.includes('from auth.users')) as string
    expect(q).toContain('"id"')
    expect(q).toContain('"email"')
    expect(q).toContain('"phone"')
    for (const never of AUTH_COLUMNS_NEVER_READ) expect(q).not.toContain(never)
    expect(q).not.toContain('select *')
  })

  it('the whitelist itself contains none of the never-read columns', () => {
    for (const c of AUTH_COLUMNS_NEVER_READ)
      expect((AUTH_COLUMN_WHITELIST as readonly string[]).includes(c)).toBe(false)
  })

  it('never selects the vault secret itself, only its name', async () => {
    const { db, asked } = fake(['id'])
    await collectAux(db)
    const q = asked.find((s) => s.includes('vault.secrets')) as string
    expect(q).toMatch(/select name, description from vault\.secrets/)
    expect(q).not.toMatch(/decrypted_secret|\bsecret\b\s*(,|from)/)
  })

  it('redacts a token that is inside a cron command and keeps the schedule', async () => {
    const aux = await collectAux(fake(['id']).db)
    const job = aux.cron_jobs.rows[0]
    expect(job?.schedule).toBe('* * * * *')
    expect(job?.command).not.toContain(TOKEN)
    expect(job?.command).toContain('select 1')
  })

  it('records a section it cannot read as not ok, with the reason, and carries on with the rest', async () => {
    const aux = await collectAux(fake(['id'], ['cron.job', 'storage.objects']).db)
    expect(aux.cron_jobs.ok).toBe(false)
    expect(aux.cron_jobs.error).toContain('permission denied')
    expect(aux.storage_objects.ok).toBe(false)
    expect(aux.vault_names.ok).toBe(true)
    expect(aux.auth_users.ok).toBe(true)
    expect(aux.structure?.foreign_keys).toBe(1)
  })

  it('an auth.users the role cannot see is a recorded failure, not a crash and not an empty success', async () => {
    const aux = await collectAux(fake([]).db)
    expect(aux.auth_users.ok).toBe(false)
    expect(aux.auth_users.error).toContain('no id column')
  })

  it('leaves the backups bucket out of the storage listing', async () => {
    const { db, asked } = fake(['id'])
    await collectAux(db)
    expect(asked.find((s) => s.includes('from storage.objects'))).toContain(
      "bucket_id is distinct from 'backups'",
    )
  })
})
