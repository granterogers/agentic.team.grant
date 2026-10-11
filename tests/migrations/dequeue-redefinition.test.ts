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
  /create\s+or\s+replace\s+function\s+app\.dequeue_job\b(?!_core)/i.test(sql)
const replacesCore = (sql: string): boolean =>
  /create\s+or\s+replace\s+function\s+app\.dequeue_job_core/i.test(sql)
/** 1078: the five-argument claim is a one-line wrapper that says the worker cannot answer an engine. */
const isTheWrapper = (sql: string): boolean =>
  /dequeue_job_core\(p_worker, p_can_transcribe, p_can_subprocess, p_kinds, p_requested_by, false\)/.test(
    sql,
  ) &&
  !/for\s+update|leased_by|advisory/i.test(
    sql.slice(sql.search(/create\s+or\s+replace\s+function\s+app\.dequeue_job\s*\(/i)),
  )

describe('migrations that replace app.dequeue_job', () => {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  const after1044 = files.filter((f) => f >= '1044')

  it('every file from 1044 up to 1077 that replaces it keeps the per-office fair share', () => {
    const bad = after1044
      .filter((f) => f < '1078')
      .filter((f) => {
        const sql = readFileSync(`${dir}/${f}`, 'utf8')
        return replacesDequeue(sql) && !keepsFairShare(sql)
      })
    expect(bad).toEqual([])
  })

  it('1078 and after: app.dequeue_job may only ever be the wrapper that says p_can_engine = false, and the claim lives in the core, which keeps the fair share AND the engine gate', () => {
    // A later migration that gave app.dequeue_job a body of its own would turn the stale-worker gate off without anybody deciding to
    // (the deferred efficiency migration is exactly that shape: its change belongs in app.dequeue_job_core).
    const later = files.filter((f) => f >= '1078')
    const badWrapper = later.filter((f) => {
      const sql = readFileSync(`${dir}/${f}`, 'utf8')
      return replacesDequeue(sql) && !isTheWrapper(sql)
    })
    expect(badWrapper).toEqual([])
    const badCore = later.filter((f) => {
      const sql = readFileSync(`${dir}/${f}`, 'utf8')
      return (
        replacesCore(sql) &&
        !(
          (keepsFairShare(sql) && /p_can_engine\s+or\s+not\s+exists/i.test(sql)) ||
          /pg_get_functiondef\('app\.dequeue_job/.test(sql)
        )
      )
    })
    expect(badCore).toEqual([])
  })

  it('CONTROL: a full-body replacement of app.dequeue_job after 1078 is exactly the shape this refuses, and the wrapper is exactly the shape it accepts', () => {
    const fullBody =
      'create or replace function app.dequeue_job(p_worker text) returns table(job_id uuid) language plpgsql as $f$ begin perform 1 from public.jobs for update skip locked; end $f$;'
    expect(replacesDequeue(fullBody) && !isTheWrapper(fullBody)).toBe(true)
    const f = readdirSync(dir).find((x) => x.startsWith('1078_')) as string
    const wrapper = readFileSync(`${dir}/${f}`, 'utf8')
    expect(replacesDequeue(wrapper) && isTheWrapper(wrapper)).toBe(true)
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
