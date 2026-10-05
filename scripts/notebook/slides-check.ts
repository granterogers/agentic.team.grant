/**
 * Why do slide decks fail? Read-only — nothing is generated.
 *
 *   npm run notebook:slides
 *
 * `known-problems.md` has carried *"NotebookLM slide decks fail, every time"*
 * for two sessions, on four attempts, with no error detail exposed. That left
 * two explanations which look identical from outside: the tier does not offer
 * slide decks and the API fails the request later, or it does offer them and
 * something about this notebook breaks it.
 *
 * `get_customization_choices` settles the first for nothing, so it should have
 * been the first thing anyone ran. It reports what the account is actually
 * offered; listing the notebook's artifacts reports what is actually there.
 *
 * Deliberately cannot generate. Grant requires manual approval for any
 * generation (0083) and a retry spends the allowance like any other, so this
 * script reports what is free to know and stops.
 */

import '../../src/safety/require-production-checks.ts'
import { spawnSync } from 'node:child_process'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const state = String(
  (
    await db.execute(`
      select app.resolve_secret(
        (select id from vault.secrets where name = 'notebook.storage_state')::app.vault_secret_ref
      ) as s
    `)
  ).rows[0]?.s ?? '',
)
if (state === '') {
  console.error('no NotebookLM credential in the vault')
  process.exit(1)
}

const notebooks = (
  await db.execute(`
    select distinct a.external_ref, coalesce(a.display_name, a.external_ref) as name
      from public.project_attachments a
      join public.projects p using (project_id)
     where a.connector = 'notebooklm' and a.enabled and p.status = 'active'
  `)
).rows as { external_ref: string; name: string }[]

for (const nb of notebooks) {
  console.log(`\n## ${nb.name}\n`)
  const result = spawnSync('python3', ['scripts/notebook/slides-diagnosis.py', nb.external_ref], {
    encoding: 'utf8',
    env: { ...process.env, NOTEBOOK_STORAGE_STATE: state },
  })
  const out = JSON.parse(result.stdout || '{}') as {
    choices?: Record<string, string>
    slide_decks?: { title?: string; status?: string; failed?: boolean }[]
    by_kind?: Record<string, { total: number; failed: number }>
  }

  const offered = out.choices?.slide_deck !== undefined
  console.log(`slide decks offered on this account: ${offered ? 'YES' : 'no'}`)
  for (const [kind, counts] of Object.entries(out.by_kind ?? {})) {
    console.log(`  ${kind}: ${String(counts.total)} total, ${String(counts.failed)} failed`)
  }
  for (const d of out.slide_decks ?? []) {
    console.log(`  deck "${String(d.title)}" — ${String(d.status)}`)
  }

  // What WE believe, next to what Google says. The two disagreeing is the
  // finding: our table can hold a failure for an artifact Google no longer has.
  const ours = (
    await db.execute(`
      select kind, state, external_ref from public.artifacts
       where kind = 'slides' order by created_at desc limit 5
    `)
  ).rows as { kind: string; state: string; external_ref: string }[]
  if (ours.length > 0) {
    console.log('\n  our own record of slide decks:')
    for (const a of ours) console.log(`    ${a.external_ref.slice(0, 8)} — ${a.state}`)
  }
}
