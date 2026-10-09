import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPlainSelect, parsePreflight } from '../../scripts/release/plain-select.ts'

/**
 * The preflight reads production, so every statement it can send is held to a static rule (one select, nothing that writes) and, in
 * production, to a database-enforced read-only role. This holds the FILE to the rule, and proves the rule can refuse.
 */
const file = readFileSync('docs/audit/V1-RELEASE-PREFLIGHT-QUERIES-2026-10-09.sql', 'utf8')
const statements = parsePreflight(file)

describe('the preflight statements', () => {
  it('the file parses into the statements it documents (P01 to P19 and the three catalogue restatements)', () => {
    const ids = statements.map((s) => s.id)
    for (let n = 1; n <= 19; n += 1) expect(ids).toContain(`P${String(n).padStart(2, '0')}`)
    for (const b of ['P04b', 'P08b', 'P18b']) expect(ids).toContain(b)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every one is a single plain select', () => {
    const bad = statements.filter((s) => !isPlainSelect(s.sql)).map((s) => s.id)
    expect(bad).toEqual([])
  })

  it('none selects a secret value, a secret reference, a token or a message body', () => {
    for (const s of statements)
      expect(s.sql).not.toMatch(
        /\b(secret|vault|token|password|api_key|body|transcript|content)\b/i,
      )
  })

  it('none names a column that exists only after the migrations it precedes (it must run on production before them)', () => {
    for (const s of statements)
      expect(s.sql).not.toMatch(/send_started_at|capacity_samples|remind_sends/i)
  })
})

describe('the R1b Needs me statements', () => {
  const r1b = parsePreflight(
    readFileSync('docs/audit/V1-R1B-NEEDS-ME-QUERIES-2026-10-09.sql', 'utf8'),
  )
  it('parses, and every one is a single plain select (or a read-only CTE)', () => {
    expect(r1b.length).toBeGreaterThanOrEqual(8)
    expect(r1b.filter((s) => !isPlainSelect(s.sql)).map((s) => s.id)).toEqual([])
  })
  it('none selects what a question says, who it is about or a secret', () => {
    for (const s of r1b)
      expect(s.sql).not.toMatch(
        /\b(requested_action|why_needed|consequences_of_delay|resolution|approval_options|answered_by|dedupe_key\s*,|secret|vault|token|password)\b/i,
      )
  })
})

describe('the rule can refuse (controls)', () => {
  const refused: [string, string][] = [
    ['a write', 'insert into public.jobs (job_id) values (gen_random_uuid())'],
    ['an update dressed as a select', "select 1; update public.jobs set state = 'x'"],
    [
      'a delete inside a CTE',
      'with d as (delete from public.jobs returning 1) select count(*) from d',
    ],
    ['DDL', 'select 1 where 1 = 1; drop table public.jobs'],
    ['a sleep', 'select pg_sleep(30)'],
    ['a setting change', "select set_config('statement_timeout', '0', false)"],
    ['a sequence advance', "select nextval('public.some_seq')"],
    ['a lock', 'select 1 for update; lock table public.jobs'],
    ['a comment hiding a second statement', 'select 1 -- ok ; delete from public.jobs'],
  ]
  for (const [name, sql] of refused)
    it(`refuses ${name}`, () => {
      expect(isPlainSelect(sql)).toBe(false)
    })

  it('accepts an ordinary read (so the refusals are not a rule that refuses everything)', () => {
    expect(isPlainSelect("select count(*) as n from public.jobs where state = 'queued'")).toBe(true)
  })

  it('accepts a read-only CTE (with ... select), and still refuses one whose first word is not a read', () => {
    expect(
      isPlainSelect(
        'with recursive c as (select 1 as n union all select n + 1 from c where n < 3) select count(*) from c',
      ),
    ).toBe(true)
    expect(isPlainSelect('with c as (select 1) update public.jobs set state = c.state')).toBe(false)
    expect(isPlainSelect('explain select 1')).toBe(false)
  })

  it('a quoted word is not a verb: a literal that says "delete" is still a read', () => {
    expect(
      isPlainSelect("select count(*) from public.events where action_type = 'document.delete'"),
    ).toBe(true)
  })
})
