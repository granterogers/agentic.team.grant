import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * app.dequeue_job is replaced by more than one workstream (1044 adds the per-office fair share; the efficiency workstream's unapplied 1030 makes the
 * self-improvement ceiling lazy). A later numbered file that replaces it must keep the fair share, or it silently undoes 1044. The check is a property
 * (the fair-share term is present), not a file name, so a differently numbered copy of the same mistake is caught as well.
 */
const dir = 'migrations'
const keepsFairShare = (sql: string): boolean =>
  sql.includes('v_share') && /busy\s+b\s+where\s+b\.office_id\s*=\s*j\.office_id/.test(sql)
const replacesDequeue = (sql: string): boolean =>
  /create\s+or\s+replace\s+function\s+app\.dequeue_job/i.test(sql)

describe('migrations that replace app.dequeue_job', () => {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  const after1044 = files.filter((f) => f >= '1044')

  it('every file from 1044 on that replaces it keeps the per-office fair share', () => {
    const bad = after1044.filter((f) => {
      const sql = readFileSync(`${dir}/${f}`, 'utf8')
      return replacesDequeue(sql) && !keepsFairShare(sql)
    })
    expect(bad).toEqual([])
  })

  it('1044 itself is such a file (so the property is not vacuous)', () => {
    const f = after1044.find((x) => x.startsWith('1044_'))
    expect(f).toBeDefined()
    const sql = readFileSync(`${dir}/${f as string}`, 'utf8')
    expect(replacesDequeue(sql) && keepsFairShare(sql)).toBe(true)
  })

  it('CONTROL: efficiency 1030 as written is exactly the shape this refuses', () => {
    const old = readFileSync('scripts/isolated/reference/dequeue.efficiency-1030.sql', 'utf8')
    expect(replacesDequeue(old)).toBe(true)
    expect(keepsFairShare(old)).toBe(false)
  })

  it('the deferred reconciled file is outside migrations/ (no runner can pick it up) and keeps the fair share', () => {
    const f = 'docs/audit/deferred-migrations/dequeue_job-efficiency-1030-reconciled-with-1044.sql'
    const sql = readFileSync(f, 'utf8')
    expect(files).not.toContain('dequeue_job-efficiency-1030-reconciled-with-1044.sql')
    expect(replacesDequeue(sql) && keepsFairShare(sql)).toBe(true)
  })

  it('efficiency migrations 1024 to 1031 are not in the repository (they are deferred, not merged)', () => {
    const names = files.filter((f) => /^10(24|25|26|28|29|30|31)_/.test(f))
    // 1023 and 1027 are the two efficiency files production already holds and are in the repository; the others are unapplied and may not be here.
    expect(names).toEqual([])
  })
})
