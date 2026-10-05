import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/*
  Multi-user P3: inline SQL in the handlers, agents, channels and Slack/Telegram adapters.

  Each of those statements runs inside ONE claimed job (or one press, or one workspace) whose office is fixed, so it has
  to be confined to that office in the SQL itself. The ratchet (npm run check:office-raw-sql) counts statements with a
  regular expression over the file and is blind to a template literal nested inside another; this reads the same files
  with the TypeScript parser, so a statement written inside `${ ... }` is a statement too.

  The property: a statement that touches an owned table either names an office in its own text, or is KEYED BY THE
  CLAIMED ROW / THE WORKSPACE / A DEPLOYMENT SCAN, said in a `raw-sql[2|3]: <reason>` comment right above it. The
  database-driven proofs are in scripts/isolated/p3-cases/95-raw-sql-handlers.ts; this covers the sites that sit in
  closures nothing outside can call (the instruction handler, the notebook handlers, the Notion handlers ...).
*/

const MINE =
  /^src\/(handlers|agents|briefings|channels|telegram|slack|office|inference|providers)\//
const manifest = JSON.parse(
  readFileSync(new URL('../../docs/multi-user/ownership-manifest.json', import.meta.url), 'utf8'),
).tables as Record<string, { class: string }>
const owned = Object.entries(manifest)
  .filter(([, v]) => v.class === 'OFFICE_CARRIER' || v.class === 'OFFICE_DERIVED')
  .map(([k]) => k)
const TOUCHES = new RegExp(
  `\\b(?:from|join|into|update|delete\\s+from)\\s+(?:public\\.)?(?:${owned.join('|')})\\b`,
  'i',
)
const NAMES_AN_OFFICE =
  /office_id|job_office|\$\{office\}|\$\{this\.office\}|\$\{options\.office\}|\$\{deps\.office\}|workspaceOffice\(/
const MARKER = /raw-sql\[([23])\]:\s*(\S[^\n]*)/

type Finding = { file: string; line: number; text: string }

/** Statements in `source` that touch an owned table, name no office, and carry no recorded reason. */
function unconfined(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true)
  const lines = source.split('\n')
  const found: Finding[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = node.getText(sf)
      // SQL comments in the template are not statements, and a table named inside prose is not a read
      const code = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      if (TOUCHES.test(code) && !NAMES_AN_OFFICE.test(text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line
        const above = lines.slice(Math.max(0, line - 10), line + 1).join('\n')
        if (!MARKER.test(above)) found.push({ file, line: line + 1, text: text.slice(0, 90) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => MINE.test(f) && f.endsWith('.ts'))

describe('inline SQL is confined to the claimed office (multi-user P3)', () => {
  // Sample sources are written with @{ for the placeholder opener, so this file holds no template-looking strings.
  const src = (s: string): string => s.replaceAll('@{', '${')

  it('the checker can fail: a statement that reads an owned table with no office and no reason is found', () => {
    const bad = src('const x = `select * from public.tasks where project_id = @{p}`')
    expect(unconfined('x.ts', bad)).toHaveLength(1)
    // a statement written inside the placeholder of another template is still a statement (the regex scanner cannot see it)
    const nested = src('const x = `a @{ `select 1 from public.documents where title = @{t}` } b`')
    expect(unconfined('x.ts', nested).length).toBeGreaterThanOrEqual(1)
  })

  it('and it accepts a statement that names an office, or says why it need not', () => {
    const scoped = src(
      'const x = `select * from public.tasks where office_id = app.job_office(@{j}::uuid)`',
    )
    expect(unconfined('x.ts', scoped)).toEqual([])
    const keyed = src(
      '// raw-sql[2]: keyed by the claimed job; it sets one column of that job.\nconst x = `update public.jobs set announce = false where job_id = @{j}`',
    )
    expect(unconfined('x.ts', keyed)).toEqual([])
  })

  it('a comment that names a table is not a statement', () => {
    const prose = 'const x = `select 1 -- not from public.tasks\n`'
    expect(unconfined('x.ts', prose)).toEqual([])
  })

  it('every inline statement in the handlers, agents, channels and adapters names an office or gives a reason', () => {
    expect(files.length).toBeGreaterThan(50)
    const all = files.flatMap((f) =>
      unconfined(f, readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')),
    )
    expect(all.map((x) => `${x.file}:${String(x.line)} ${x.text}`)).toEqual([])
  })

  it('every reason recorded in a marker says something', () => {
    for (const f of files) {
      const source = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
      for (const m of source.matchAll(/raw-sql\[([23])\]:\s*([^\n]*)/g)) {
        expect(
          (m[2] ?? '').trim().length,
          `${f}: a raw-sql marker with no reason`,
        ).toBeGreaterThanOrEqual(30)
      }
    }
  })

  it('every baseline entry of these directories carries a reason (category 2 or 3)', () => {
    const base = JSON.parse(
      readFileSync(new URL('../../docs/multi-user/raw-sql-baseline.json', import.meta.url), 'utf8'),
    ).reasons as Record<string, string>
    const mine = Object.entries(base).filter(([k]) => MINE.test(k))
    for (const [k, reason] of mine) {
      expect(reason, `${k} has no reason`).toMatch(/^[23]: .{30,}/)
    }
  })
})
