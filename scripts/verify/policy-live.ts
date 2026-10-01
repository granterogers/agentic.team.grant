/**
 * The final policy decisions, read from production (read-only; it changes nothing and creates nothing).
 *
 *   npm run verify:policy-live
 *
 * What it asserts is the STATE the policy produces, not a run of the duties: the four registered tools sit at the
 * levels the decisions need, a scoped tool cannot hold an unscoped standing yes, and no public table is reachable by a
 * public key. How the duties BEHAVE is proven by the isolated suites; the first live observation (the rotation duty
 * raising one exact question and calling Slack zero times) is recorded in docs/policy/FINAL-POLICY-IMPLEMENTATION.md.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const db = new ManagementApiExecutor(ref, process.env.SUPABASE_ACCESS_TOKEN ?? '')
const rows = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const results: { ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}

const tools = await rows(
  `select tool, level, scoped, enabled from public.tool_permissions where tool in ('task.board.write','task.board.delete','slack.channel','slack.rotate','notion.write') order by tool`,
)
const by = Object.fromEntries(tools.map((t) => [String(t.tool), t]))
check(
  'create/update is level 2 and per destination; delete, channels and rotation are level 3',
  Number(by['task.board.write']?.level) === 2 &&
    by['task.board.write']?.scoped === true &&
    Number(by['task.board.delete']?.level) === 3 &&
    Number(by['slack.channel']?.level) === 3 &&
    Number(by['slack.rotate']?.level) === 3 &&
    by['notion.write']?.scoped === true,
  JSON.stringify(tools.map((t) => `${String(t.tool)}:${String(t.level)}`)),
)
const standing = await rows(
  `select tool, scope_ref from public.standing_authorizations where revoked_at is null and tool in ('task.board.write','notion.write','task.board.delete','slack.channel','slack.rotate')`,
)
check(
  'no live standing yes exists for a scoped tool without a destination, or for a level-3 tool',
  standing.every(
    (s) => ['task.board.write', 'notion.write'].includes(String(s.tool)) && s.scope_ref !== null,
  ),
  `${String(standing.length)} row(s)`,
)
const trig = await rows(
  `select count(*)::int as n from pg_trigger where tgname in ('project_attachments_withdraw_notion_authority') and not tgisinternal`,
)
check(
  'letting go of a Notion database withdraws its yes (trigger present)',
  Number(trig[0]?.n) === 1,
  String(trig[0]?.n),
)
const exposed = await rows(
  `select count(*)::int as n from information_schema.role_table_grants g join pg_class c on c.relname = g.table_name and c.relkind = 'r' join pg_namespace n on n.oid = c.relnamespace and n.nspname = g.table_schema where g.table_schema = 'public' and g.grantee in ('anon','authenticated') and not c.relrowsecurity`,
)
check(
  'no public table without a row policy is granted to a public key',
  Number(exposed[0]?.n) === 0,
  String(exposed[0]?.n),
)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exitCode = failed === 0 ? 0 : 1
