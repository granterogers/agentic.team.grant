/**
 * Who calls a function, so a signature change is made everywhere in one go (multi-user P3).
 *   npx tsx scripts/p3/callers.ts my_task_add [more names...]
 * Prints the database functions whose body names it and the repository files that call it (src, supabase, scripts,
 * tests). A comment is not a call, so the database half is read with comments removed, like inventory.ts.
 */
import { execFileSync } from 'node:child_process'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)
for (const name of process.argv.slice(2)) {
  if (!/^[a-z_0-9]+$/.test(name)) throw new Error(`not a function name: ${name}`)
  const rows = (
    await db.execute(`
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app','public') and p.prokind = 'f'
         and regexp_replace(regexp_replace(coalesce(p.prosrc,''), '/[*].*?[*]/', ' ', 'gs'), '--[^' || chr(10) || ']*', ' ', 'g')
             ~ '\\m(app|public)[.]${name}[[:space:]]*[(]'
         and p.proname <> '${name}'
       order by 1`)
  ).rows as { fn: string }[]
  console.log(`\n== ${name}\n-- database callers (${String(rows.length)})`)
  for (const r of rows) console.log(`   ${r.fn.slice(0, 150)}`)
  let files = ''
  try {
    files = execFileSync(
      'grep',
      [
        '-rnE',
        `(app|public)\\.${name}\\b|rpc/${name}\\b|rpc\\('${name}'|fn: '${name}'`,
        'src',
        'supabase',
        'scripts',
        'tests',
        '--include=*.ts',
        '--include=*.sql',
      ],
      { encoding: 'utf8' },
    )
  } catch {
    files = ''
  }
  const lines = files.split('\n').filter(Boolean)
  console.log(`-- repository references (${String(lines.length)})`)
  for (const l of lines) console.log(`   ${l.slice(0, 170)}`)
}
