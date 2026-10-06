/**
 * What a stabilisation step's SQL file may contain, and nothing else.
 *
 * A step is a change of function bodies (and, for 1028, the two functions it adds with their grants). So the only statements
 * allowed are: begin, commit, create or replace of a jsonb-returning security-definer function in app or public, dropping one
 * of the named functions, and revoking or granting EXECUTE on a function. No insert, update, delete, truncate, create or alter
 * of a table, index, column, trigger, policy, role or extension can pass, which makes "no data and no structure change" a
 * property the tool enforces rather than a sentence in a document.
 *
 * Pure functions over text; the tool and its unit test both use them.
 */

/** Every statement of a file, with comments and function bodies taken out, so the shape of what it does can be judged. */
export const statementsOf = (sql: string): string[] =>
  sql
    // '$$$$' in a replacement string is two literal dollar signs (a single '$$' would collapse to one).
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '$$$$')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((s) => s !== '')

export const ALLOWED: readonly RegExp[] = [
  /^begin$/,
  /^commit$/,
  /^create or replace function (app|public)\.[a-z_]+\(.*\) returns jsonb language (plpgsql|sql) stable security definer set search_path to .* as \$\$$/,
  /^drop function if exists (app|public)\.[a-z_]+\(uuid\)$/,
  /^revoke all on function (app|public)\.[a-z_]+\(uuid\) from public, anon, authenticated$/,
  /^grant execute on function public\.[a-z_]+\(uuid\) to service_role$/,
]

/**
 * The problems with a file, empty when it is acceptable. `declared` is the set of `schema.name` the step is allowed to touch;
 * a statement that creates or drops anything else is refused even though its shape is allowed.
 */
export const judgeShape = (sql: string, what: string, declared: ReadonlySet<string>): string[] => {
  const problems: string[] = []
  const statements = statementsOf(sql)
  if (statements.length === 0)
    problems.push(`${what}: no statements found (a check that reads nothing proves nothing)`)
  for (const s of statements) {
    if (!ALLOWED.some((re) => re.test(s)))
      problems.push(`${what}: statement not allowed: ${s.slice(0, 90)}`)
    const m =
      /^(?:create or replace function|drop function if exists) ((?:app|public)\.[a-z_]+)/.exec(s)
    if (m?.[1] !== undefined && !declared.has(m[1]))
      problems.push(`${what}: touches ${m[1]}, which the manifest does not name`)
  }
  return problems
}
