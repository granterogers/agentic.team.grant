/**
 * Inline SQL in the repository that reads or writes an owned table (multi-user P3).
 *
 * The function inventory cannot see SQL written as a string in a handler: `await db.execute(\`select ... from
 * public.tasks ...\`)`. This finds each such statement, says which owned tables it touches and whether the statement
 * mentions an office (`office_id`, `p_office`, `job_office`), so the unscoped ones can be converted and ratcheted.
 *   npx tsx scripts/p3/raw-sql.ts [--json out.json] [--list]
 * A statement is a template literal or string containing select/insert/update/delete AND a table reference.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('docs/multi-user/ownership-manifest.json', 'utf8'))
  .tables as Record<string, { class: string }>
const owned = Object.entries(manifest)
  .filter(([, v]) => v.class === 'OFFICE_CARRIER' || v.class === 'OFFICE_DERIVED')
  .map(([k]) => k)
const ownedRe = new RegExp(
  `\\b(?:from|join|into|update|delete\\s+from)\\s+(?:public\\.)?(${owned.join('|')})\\b`,
  'gi',
)

export type Site = { file: string; line: number; tables: string[]; scoped: boolean; key: string }
const keyOf = (file: string, body: string): string =>
  `${file}#${createHash('sha1')
    .update(
      body
        .replace(/\$\{[^}]*\}/g, '${}')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .digest('hex')
    .slice(0, 12)}`
const files = execFileSync('git', ['ls-files', 'src', 'supabase/functions'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
const sites: Site[] = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // template literals and quoted strings that hold SQL
  for (const m of text.matchAll(/`([^`]*)`|'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
    const body = m[1] ?? m[2] ?? m[3] ?? ''
    if (body.length < 25 || !/\b(select|insert\s+into|update|delete\s+from)\b/i.test(body)) continue
    const tables = [
      ...new Set([...body.matchAll(ownedRe)].map((x) => (x[1] as string).toLowerCase())),
    ]
    if (tables.length === 0) continue
    const line = text.slice(0, m.index ?? 0).split('\n').length
    sites.push({
      file,
      line,
      tables,
      scoped: /office_id|p_office|job_office|\boffice\b/i.test(body),
      key: keyOf(file, body),
    })
  }
}
if (process.argv.includes('--list'))
  for (const s of sites.filter((x) => !x.scoped))
    console.log(`${s.file}:${String(s.line)} ${s.tables.join(',')}`)
const jsonAt = process.argv.indexOf('--json')
if (jsonAt > -1) writeFileSync(process.argv[jsonAt + 1] as string, JSON.stringify(sites, null, 1))
const byFile = new Map<string, number>()
for (const s of sites.filter((x) => !x.scoped)) byFile.set(s.file, (byFile.get(s.file) ?? 0) + 1)
console.log(
  `inline SQL sites touching owned tables: ${String(sites.length)}; naming an office: ${String(sites.filter((s) => s.scoped).length)}; NOT: ${String(sites.filter((s) => !s.scoped).length)}`,
)
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`  ${String(n).padStart(4)}  ${f}`)

// The ratchet: an unscoped statement that is not in the baseline is a NEW unscoped read or write of an owned table.
const BASELINE = 'docs/multi-user/raw-sql-baseline.json'
if (process.argv.includes('--write-baseline')) {
  const keys = [...new Set(sites.filter((x) => !x.scoped).map((x) => x.key))].sort()
  let previous: Record<string, string> = {}
  try {
    previous =
      (JSON.parse(readFileSync(BASELINE, 'utf8')) as { reasons?: Record<string, string> })
        .reasons ?? {}
  } catch {
    previous = {}
  }
  const reasons = Object.fromEntries(keys.map((k) => [k, previous[k] ?? '']))
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note: 'Inline SQL touching an owned table that does not name an office. May only shrink; give each remaining entry a reason.',
        reasons,
      },
      null,
      1,
    ),
  )
  console.log(`baseline: ${String(keys.length)} unscoped statement(s)`)
}
if (process.argv.includes('--check')) {
  const base = new Set(
    Object.keys(
      (JSON.parse(readFileSync(BASELINE, 'utf8')) as { reasons: Record<string, string> }).reasons,
    ),
  )
  const fresh = sites.filter((x) => !x.scoped && !base.has(x.key))
  const live = new Set(sites.map((x) => x.key))
  const gone = [...base].filter((k) => !live.has(k)).length
  for (const f of fresh)
    console.error(
      `FAIL ${f.file}:${String(f.line)} new inline SQL on ${f.tables.join(',')} names no office`,
    )
  console.log(
    `raw SQL ratchet: ${String(sites.filter((x) => !x.scoped).length)} unscoped (baseline ${String(base.size)}, ${String(gone)} since converted or removed)`,
  )
  if (fresh.length > 0) process.exitCode = 1
  else console.log('check:office-raw-sql OK')
}
