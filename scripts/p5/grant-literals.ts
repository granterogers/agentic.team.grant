/**
 * Inventory of the literal name "Grant" inside STRING LITERALS of the product code (never comments).
 *   npx tsx scripts/p5/grant-literals.ts [--list] [--json]
 * A comment is for a person reading the repository; a string literal is, or may become, something a model or a person
 * is shown. Only string and template-literal text counts, found with the TypeScript parser rather than a grep, so a
 * regex or a comment cannot be mistaken for wording. Test files and scripts are not product wording and are excluded.
 */
import { globSync, readFileSync } from 'node:fs'
import ts from 'typescript'

export type Hit = { file: string; line: number; text: string }

export const literalsNamingGrant = (file: string, source: string): Hit[] => {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const hits: Hit[] = []
  const visit = (n: ts.Node): void => {
    let text: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text
    else if (ts.isRegularExpressionLiteral(n)) text = null
    // SQL carried in a template literal keeps its comments (/* ... */ and -- ...): those are for the person reading the
    // query, not text anybody is shown, so they are removed before looking.
    if (text !== null) text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
    if (text !== null && /\bGrant\b|\bGrant’s\b|\bGrant's\b/.test(text)) {
      hits.push({
        file,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        text: text.replace(/\s+/g, ' ').slice(0, 140),
      })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = globSync('src/**/*.ts')
  const all = files.flatMap((f) => literalsNamingGrant(f, readFileSync(f, 'utf8')))
  console.log(
    `${all.length} string literal(s) naming Grant, in ${new Set(all.map((h) => h.file)).size} file(s)`,
  )
  const byFile = new Map<string, number>()
  for (const h of all) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1)
  if (process.argv.includes('--list'))
    for (const h of all) console.log(`${h.file}:${h.line}  ${h.text}`)
  else
    for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]))
      console.log(`${String(n).padStart(4)} ${f}`)
}
