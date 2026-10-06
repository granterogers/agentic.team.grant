/**
 * A capability the office HAS must be one the office knows it has (#320).
 *
 *   npm run check:capabilities
 *
 * ## The converse of 0298, which that migration named and did not close
 *
 * `tool_permissions.delivered_by` exists because a row claimed `web.search`
 * with nothing implementing it, and `capabilityBrief` told all eight agents
 * they could search the web. 0298 made the CLAIM checkable. It left the other
 * direction open, in its own words: *"being told NO about something possible
 * costs a feature request; being told YES about something impossible costs the
 * work."*
 *
 * The first half is not free either. Asked to improve a PDF it had just made,
 * the office replied *"I can't create a PDF directly in Telegram"* and offered
 * a Notion page to export by hand. `artifact.report` had produced 139 PDFs by
 * then. No row named it, so no agent's brief mentioned it, and the model was
 * not inventing a limit — it was reading one.
 *
 * ## The boundary is derived, not listed
 *
 * Not "every handler", which would drag in `office.prune_job_traces` and every
 * other piece of machinery nobody asks for. The question is what a CONVERSATION
 * can cause: the job kinds `src/handlers/instruction.ts` enqueues are exactly
 * the capabilities Grant can reach by saying something, and those are the ones
 * an agent has to know it holds.
 *
 * A list in this file would be the thing 0366 spent a migration undoing. The
 * set is read out of the source on every run, so a kind added tomorrow is
 * covered tomorrow.
 *
 * ## Represented means NAMED BY AN ENABLED ROW
 *
 * `delivered_by` is prose written for a person — "job kinds notebook.ask,
 * notebook.collect and notebook.list_artifacts" — so the test is whether the
 * kind appears in it. A DISABLED row does not count: a row that is off is the
 * office saying it cannot, which is the very sentence under audit.
 *
 * ## A baseline that may only shrink
 *
 * Same rule as `check:callers` and `check:pressable`: an entry needs a reason,
 * and a baseline entry that becomes represented FAILS until it is removed. A
 * baseline that cannot go stale is the difference between a baseline and an
 * allowlist, and CLAUDE.md records twice what an unexamined reason costs — a
 * baselined excuse stops the next person looking.
 */

import '../src/safety/require-production-checks.ts'
import { readFileSync } from 'node:fs'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  process.env.SUPABASE_ACCESS_TOKEN ?? '',
)

/**
 * Kinds that are not capabilities, with the reason each is here.
 *
 * `office.instruction` is the conversation ITSELF — a turn handing off to a
 * colleague enqueues another turn. Representing it as a tool would mean
 * telling every agent it holds a tool called "answering", which is not a
 * capability it could decline to have.
 */
const NOT_A_CAPABILITY: Readonly<Record<string, string>> = {
  'office.instruction':
    'the conversation itself — a hand-off to a colleague is another turn, not a tool',
}

/**
 * Which job kinds a conversation can start.
 *
 * `app.enqueue_child` and `app.enqueue_child_once` are the only two ways, and
 * both take the kind as the second argument inside a SQL template literal, so
 * the kind is the first quoted dotted word after the call. Bounded at 240
 * characters because an unbounded window would run into the NEXT call and
 * CLAUDE.md records what an unbounded slice costs a control.
 */
function kindsAConversationCanStart(source: string): readonly string[] {
  const found = new Set<string>()
  const call = /app\.enqueue_child(?:_once)?\s*\(/g
  for (let m = call.exec(source); m !== null; m = call.exec(source)) {
    const window = source.slice(m.index, m.index + 240)
    const kind = /'([a-z_]+\.[a-z_]+)'/.exec(window)
    if (kind !== null) found.add(kind[1] as string)
  }
  return [...found].sort()
}

const source = readFileSync('src/handlers/instruction.ts', 'utf8')
const kinds = kindsAConversationCanStart(source)

if (kinds.length === 0) {
  console.error('check:capabilities: found no enqueued kinds at all — the reader is broken')
  process.exit(2)
}

const rows = await db.execute(`
  select coalesce(string_agg(delivered_by, ' ~ '), '') as claimed
    from public.tool_permissions
   where enabled and coalesce(btrim(delivered_by), '') <> ''`)
const claimed = String((rows.rows[0] as Record<string, unknown>)?.claimed ?? '')

if (claimed === '') {
  console.error('check:capabilities: the registry claims nothing — refusing to pass vacuously')
  process.exit(2)
}

const unrepresented = kinds.filter((k) => !claimed.includes(k))
const missing = unrepresented.filter((k) => NOT_A_CAPABILITY[k] === undefined)
const staleBaseline = Object.keys(NOT_A_CAPABILITY).filter(
  (k) => kinds.includes(k) && claimed.includes(k),
)

console.log(`a conversation can start ${kinds.length} job kind(s)`)
for (const k of kinds) {
  const why = NOT_A_CAPABILITY[k]
  const mark = claimed.includes(k) ? 'ok  ' : why === undefined ? 'MISS' : 'base'
  console.log(`  ${mark} ${k}${why === undefined ? '' : ` — ${why}`}`)
}

for (const k of missing) {
  console.error(
    `\nMISSING: nothing enabled in tool_permissions delivers '${k}'.\n` +
      '  A conversation can start it, so an agent can be asked for it — and no agent\n' +
      '  has been told it exists. Add a row naming the kind in delivered_by, or add it\n' +
      '  to NOT_A_CAPABILITY with the reason it is machinery rather than a capability.',
  )
}
for (const k of staleBaseline) {
  console.error(
    `\nSTALE BASELINE: '${k}' is in NOT_A_CAPABILITY and IS now delivered by an enabled row.\n` +
      '  Remove it from the baseline — a baseline that cannot go stale is an allowlist.',
  )
}

if (missing.length > 0 || staleBaseline.length > 0) process.exit(1)
console.log(`\ncheck:capabilities passed — every capability a conversation can reach is claimed`)
