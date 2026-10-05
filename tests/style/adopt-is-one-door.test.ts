import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
  HQ-STYLE-018: saying "use this report's style" is a second DOOR onto the viewer button's function, not a second
  implementation. The properties, asserted on the source with comments removed:
    - the worker calls app.style_adopt_from_document from exactly one file (src/style/adopt.ts);
    - nothing in src/ writes public.style_profiles from a report;
    - the conversation and the job both go through that file, and the conversation never passes confirm: true.
  Each is stated as the wired expression, not a name appearing in a file.
*/
const strip = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
const files = walk('src').map((p) => ({ p, code: strip(readFileSync(p, 'utf8')) }))

describe('one door onto the style move', () => {
  it('only src/style/adopt.ts calls app.style_adopt_from_document', () => {
    const callers = files
      .filter((f) => f.code.includes('app.style_adopt_from_document'))
      .map((f) => f.p)
    expect(callers).toEqual(['src/style/adopt.ts'])
  })
  it('nothing in src writes style_profiles', () => {
    const writers = files.filter((f) =>
      /\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?style_profiles\b/i.test(f.code),
    )
    expect(writers.map((f) => f.p)).toEqual([])
  })
  it('the conversation asks without confirmation, and the job carries the confirmation the person gave', () => {
    const keep = strip(readFileSync('src/handlers/style-keep.ts', 'utf8'))
    expect(keep).toMatch(/adoptStyleFromDocument\(db, \{[\s\S]{0,300}confirm: false,/)
    expect(keep).toMatch(/kind: 'style\.adopt'/)
    const job = strip(readFileSync('src/handlers/style-adopt.ts', 'utf8'))
    expect(job).toMatch(/confirm: p\.confirm === true/)
    expect(job).toMatch(/adoptStyleFromDocument\(db, \{/)
  })
  it('the conversation reaches it only through entitled, before the teaching reader, and not on a branch', () => {
    const code = strip(readFileSync('src/handlers/instruction.ts', 'utf8'))
    const at = code.indexOf('const styleKeep = isBranch ? null : entitled.keepStyle(turn.kept)')
    const teach = code.indexOf('entitled.teaching(asHumanWords(text), true)')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(teach)
    expect(code).toMatch(/if \(styleKeep !== null\) \{\s*const kept = await keepStyle\(deps\.db,/)
  })
  it('the job kind is registered, contained as internal, and claimed by a registry row', () => {
    expect(strip(readFileSync('src/office/pass.ts', 'utf8'))).toMatch(/styleAdoptHandler\(db\),/)
    expect(strip(readFileSync('src/jobs/containment.ts', 'utf8'))).toMatch(
      /'style\.adopt': \{ reach: 'internal' \}/,
    )
    const migration = readFileSync(
      'migrations/1001_a_report_s_style_can_be_kept_by_saying_so.sql',
      'utf8',
    )
    expect(migration).toMatch(/\('style\.save', 1,[\s\S]*?job kind style\.adopt/)
  })
})
