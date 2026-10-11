/**
 * The four unified-ledger sections of hq-api (migrations 1060 and 1061).
 *
 * hq-api is one Deno file, so this reads its source. Properties, each asserted on the wired expression:
 *   - every section takes the office from the verified session (`office: true`) and names a public wrapper that takes `p_office` first;
 *   - every filter that carries an id, an instant or a count is shape-checked at the door, and the shape check REFUSES (a returned 400);
 *   - the chain section cannot be asked for nothing;
 *   - a time is passed on as written, never rounded through a JavaScript Date (a cursor has microseconds, a Date has milliseconds).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/hq-api/index.ts', 'utf8')
const sql = readFileSync(`migrations/${readdirSync('migrations').find((n) => n.startsWith('1061_'))}`, 'utf8')

const sectionBlock = (name: string): string => {
  const a = source.indexOf(`  ${name}: {`)
  expect(a, `section ${name}`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = source.indexOf('{', a); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(a, i + 1)
  }
  throw new Error('unterminated')
}
const SECTIONS = ['activity_ledger', 'activity_feed', 'activity_chain', 'activity_health']
const fnOf = (block: string): string => (block.match(/fn: '([a-z_]+)'/) as RegExpMatchArray)[1] as string

describe('the sections', () => {
  for (const name of SECTIONS) {
    const block = sectionBlock(name)
    it(`${name}: takes the office from the session and names a public wrapper whose first argument is p_office`, () => {
      expect(block).toContain('office: true')
      const fn = fnOf(block)
      const wrapper = sql.match(new RegExp(`create or replace function public\\.${fn}\\(\\s*p_office uuid`))
      expect(wrapper, `public.${fn}`).not.toBeNull()
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`))
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`))
    })
  }

  it('every id parameter is shape-checked as a uuid, every instant as a time, every count as a small integer', () => {
    const feed = sectionBlock('activity_feed')
    for (const p of ['project', 'job', 'correlation', 'before_id']) expect(feed).toMatch(new RegExp(`param: '${p}', arg: 'p_[a-z_]+', shape: 'uuid'`))
    for (const p of ['since', 'until', 'before_at']) expect(feed).toMatch(new RegExp(`param: '${p}', arg: 'p_[a-z_]+', shape: 'time'`))
    expect(feed).toMatch(/param: 'limit', arg: 'p_limit', shape: 'int'/)
  })

  it('every word list the gateway accepts is one the database accepts too', () => {
    const feed = sectionBlock('activity_feed')
    const list = (param: string): string[] => {
      const m = feed.match(new RegExp(`param: '${param}',[\\s\\S]*?values: \\[([^\\]]*)\\]`))
      expect(m, param).not.toBeNull()
      return [...((m?.[1] ?? '').matchAll(/'([a-z_]+)'/g))].map((x) => x[1] as string)
    }
    const sev = list('severity')
    const sevSql = (sql.match(/case p_sev when ([^]*?) else null end/) as RegExpMatchArray)[1] as string
    expect([...sevSql.matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()).toEqual([...sev].sort())
    const vis = list('visibility')
    expect(vis.sort()).toEqual(['diagnostic', 'operator', 'user'])
    const status = list('status')
    const m1060 = readFileSync(`migrations/${readdirSync('migrations').find((n) => n.startsWith('1060_'))}`, 'utf8')
    const statusSql = (m1060.match(/status\s+text\s+not null check \(status in\s*\(([^)]*)\)/) as RegExpMatchArray)[1] as string
    expect([...statusSql.matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()).toEqual([...status].sort())
    const source_ = list('source')
    const ifaceSql = (m1060.match(/source_interface\s+text\s+check \(source_interface is null or source_interface in\s*\(([^)]*)\)/) as RegExpMatchArray)[1] as string
    expect([...ifaceSql.matchAll(/'([a-z]+)'/g)].map((x) => x[1]).sort()).toEqual([...source_].sort())
  })
})

describe('the door', () => {
  it('the shape check returns a 400 (a consumed refusal, not a name)', () => {
    const a = source.indexOf("if (extra.shape === 'uuid' && !UUID.test(text))")
    expect(a).toBeGreaterThan(-1)
    expect(source.slice(a, a + 400)).toMatch(/return json\(\{ error: `\$\{extra\.param\} must be an id`, section: name \}, 400\)/)
    expect(source).toMatch(/if \(!\/\^\\d\{1,3\}\$\/\.test\(text\)\)\s+return json\(\{ error: `\$\{extra\.param\} must be a small whole number`, section: name \}, 400\)/)
    expect(source).toMatch(/return json\(\{ error: `\$\{extra\.param\} must be a date and time`, section: name \}, 400\)/)
  })

  it('an instant is passed on as written: it never goes through new Date(...).toISOString()', () => {
    const a = source.indexOf("if (extra.shape === 'time')")
    const b = source.indexOf('continue', a)
    const body = source.slice(a, b)
    expect(body).toContain('args = { ...args, [extra.arg]: text }')
    expect(body).not.toMatch(/\[extra\.arg\]:\s*new Date/)
  })

  it('a calendar day that does not exist is refused by round trip', () => {
    expect(source).toMatch(/new Date\(`\$\{day\}T00:00:00Z`\)\.toISOString\(\)\.startsWith\(day\)/)
  })

  it('the chain section refuses a request that names neither a job nor a correlation, before it reaches the database', () => {
    expect(sectionBlock('activity_chain')).toContain("requireOne: ['job', 'correlation']")
    expect(source).toMatch(
      /section\.requireOne !== undefined &&\s*!section\.requireOne\.some\(\(p\) => \(url\.searchParams\.get\(p\) \?\? ''\)\.trim\(\) !== ''\)\s*\) \{\s*return json\(\{ error: `that section needs one of: \$\{section\.requireOne\.join\(', '\)\}`, section: name \}, 400\)/,
    )
  })
})
