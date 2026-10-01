/**
 * Search everything the system holds.
 *
 *   npm run search -- "project brief"
 *   npm run search -- --project=ai-team-hq-test "pricing"
 *
 * ADR-0013's point 4, made usable: retrieval over `public.documents` whatever
 * connector fed them, in the Postgres we already back up. No provider, no
 * quota, no credential, nothing anybody can revoke — which is the whole reason
 * the knowledge layer does not need a Google account.
 *
 * `websearch_to_tsquery` rather than `to_tsquery`, so quoting a phrase or
 * typing `or` does what a person expects instead of raising a syntax error that
 * a caller would have to report as "no results".
 */

import type { SqlExecutor } from '../../src/db/executor.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const args = process.argv.slice(2)
const projectSlug = (args.find((a) => a.startsWith('--project=')) ?? '').slice('--project='.length)
const query = args
  .filter((a) => !a.startsWith('--'))
  .join(' ')
  .trim()

if (query === '') {
  console.error('usage: npm run search -- "your query"  [--project=<slug>]')
  process.exit(2)
}

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

/*
  Whose documents: ONE office's, never the deployment's. A project named with --project brings its own office;
  otherwise it is the sole person's (the office this search box has always been for).
*/
let projectFilter = 'null'
let officeSql = 'app.sole_person_office()'
if (projectSlug !== '') {
  const { rows } = await db.execute(
    `select project_id::text as id, office_id::text as office from public.projects where slug = ${lit(projectSlug)}
      order by (office_id = app.sole_person_office()) desc limit 1`,
  )
  const found = rows[0] as { id?: string; office?: string } | undefined
  if (found?.id === undefined || found.office === undefined) {
    console.error(`no such project: ${projectSlug}`)
    process.exit(1)
  }
  projectFilter = `${lit(found.id)}::uuid`
  officeSql = `${lit(found.office)}::uuid`
}

const { rows } = await db.execute(
  `select * from app.search_documents(${officeSql}, ${lit(query)}, ${projectFilter}, 10)`,
)

if (rows.length === 0) {
  // Said plainly, and with what was searched, because "no results" and "the
  // corpus is empty" look identical from here and mean very different things.
  const total = await db.execute(
    `select count(*)::int as n from public.documents where office_id = ${officeSql}`,
  )
  console.log(
    `no matches for ${JSON.stringify(query)} across ${String((total.rows[0] as { n: number }).n)} document(s).`,
  )
  process.exit(0)
}

for (const raw of rows) {
  const r = raw as {
    title: string | null
    connector: string
    rank: number
    snippet: string
    document_id: string
  }
  console.log(
    `\n${r.title ?? '(untitled)'}  [${r.connector}]  rank ${Number(r.rank).toFixed(4)}\n` +
      `${r.snippet.replace(/\s+/g, ' ').trim()}`,
  )
}
console.log(`\n${String(rows.length)} match(es).`)
