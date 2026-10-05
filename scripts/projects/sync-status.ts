/**
 * What the sync has been doing lately.
 *
 *   npm run sync:status
 *
 * Runs after every scheduled sync, including a failed one, so the workflow log
 * carries the recent history rather than only the current attempt. §7 expects
 * this dependency to break in undocumented ways, and "when did it last work?"
 * is the first question — a log showing only the failing run cannot answer it.
 */
import '../../src/safety/require-production-checks.ts'
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const runs = await db.execute(`
  select state::text as state, notebooks_seen, projects_created,
         sources_seen, sources_added, sources_changed, sources_removed,
         started_at, finished_at,
         extract(epoch from (coalesce(finished_at, app.now_utc()) - started_at))::int as seconds,
         left(coalesce(detail, ''), 90) as detail
  from public.sync_runs order by started_at desc limit 8
`)

console.log('| state | notebooks | projects+ | sources | added | changed | secs | detail |')
console.log('|---|---|---|---|---|---|---|---|')
for (const r of runs.rows) {
  console.log(
    `| ${String(r.state)} | ${String(r.notebooks_seen)} | ${String(r.projects_created)} | ` +
      `${String(r.sources_seen)} | ${String(r.sources_added)} | ${String(r.sources_changed)} | ` +
      `${String(r.seconds)} | ${String(r.detail)} |`,
  )
}

// The health question, answered explicitly rather than left to be inferred
// from the table above. A run of failures is easy to miss when every row looks
// similar at a glance.
const health = await db.execute(`
  select
    count(*) filter (where state = 'complete')::int as complete,
    count(*) filter (where state = 'failed')::int as failed,
    count(*) filter (where state = 'abandoned')::int as abandoned,
    max(started_at) filter (where state = 'complete') as last_success
  from public.sync_runs
  where started_at > app.now_utc() - interval '24 hours'
`)
const h = health.rows[0]
console.log(
  `\nlast 24h: ${String(h?.complete)} complete, ${String(h?.failed)} failed, ` +
    `${String(h?.abandoned)} abandoned (worker died)`,
)
console.log(`last successful sync: ${String(h?.last_success ?? 'never')}`)

const budget = await db.execute('select * from public.notebook_budget')
const b = budget.rows[0]
if (b !== undefined) {
  console.log(
    `budget: tier ${String(b.detected_tier)}, ${String(b.daily_chat_budget)} chats/day ` +
      `(${String(b.chat_reserve)} reserved), derived ${String(b.computed_at)}`,
  )
}
