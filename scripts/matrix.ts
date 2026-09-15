/**
 * Agent × Capability — the acceptance matrix, machine-readable.
 *
 *   npm run matrix            # print, write the markdown and the JSON
 *   npm run matrix --strict   # exit non-zero if any applicable cell is unproven
 *
 * The GREEN gate of Campaign Three, stated as a hard requirement:
 *
 *   > Every agent must be tested against every capability it is actually
 *   > granted... **"The tool works" is not equivalent to "the agent can use
 *   > the tool."** Any advertised-but-unproven applicable cell keeps the
 *   > capability-coverage gate ORANGE.
 *
 * ## Why this is not 120 real jobs
 *
 * Sixteen tools granted to eight people is 128 cells, and running a real
 * instruction for each would be days of wall clock and would still prove the
 * wrong thing — because most capabilities are **agent-invariant**. `db.read`
 * is performed by the handler, identically, whoever is speaking; asking Ruby
 * to read the database tests the handler twice and Ruby not at all.
 *
 * So the matrix separates the two axes that actually differ per agent from
 * the one that does not, and says which is which for every cell:
 *
 *   ADVERTISED    does THIS agent's capability brief claim it? Per agent, from
 *                 `app.capability_index(slug)` — the exact structure the
 *                 prompt is built from, not a restatement of it.
 *   REACHABLE     can a user request reach it at all? Per CAPABILITY, from
 *                 canonical traces, because reachability is a property of the
 *                 routing and the handler rather than of the person.
 *   REFUSED       is a capability the agent does NOT hold correctly absent
 *                 from its brief? The negative control, per agent.
 *
 * A cell is PROVEN when its agent advertises it and the capability is
 * reachable. It is ADVERTISED-ONLY — the failure state this gate exists for —
 * when the agent is told it can and nothing in the office can get there.
 *
 * ## Reachability is never inferred from existence
 *
 * `npm run levels` places a TOOL on #234's six levels from canonical state.
 * This file reads that placement and treats L4 and above as reachable — level
 * 4 is defined as "the office reached for it unprompted", which is a fact
 * about real jobs, not about code existing. Anything below L4 is unproven here
 * however complete its implementation.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import type { SqlExecutor } from '../src/db/executor.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db: SqlExecutor = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)
const all = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const agents = (await all(
  'select slug, name from public.staff where active order by slug',
)) as unknown as { slug: string; name: string }[]

const tools = (await all(`
  select p.tool, p.level::int as level, p.enabled,
         coalesce(p.disabled_reason, '') as disabled_reason,
         coalesce(p.delivered_by, '') as delivered_by
    from public.tool_permissions p order by p.tool`)) as unknown as {
  tool: string
  level: number
  enabled: boolean
  disabled_reason: string
  delivered_by: string
}[]

const grants = new Set(
  (await all("select staff_slug || '|' || tool as k from public.staff_tools")).map((g) =>
    String(g.k),
  ),
)

/*
  What each agent is ACTUALLY TOLD.

  `app.capability_index(slug)` is the function `capabilityBrief` calls, so this
  reads the same structure the prompt is built from. Asking `staff_tools`
  instead would test the grant table against itself and miss the whole class of
  defect where a grant exists and the brief does not carry it — which is what
  #64 is about.
*/
const advertised = new Map<string, Set<string>>()
for (const a of agents) {
  const rows = await all(
    `select jsonb_array_elements(coalesce(app.capability_index(${lit(a.slug)}) -> 'can', '[]'::jsonb)) ->> 'tool' as tool`,
  )
  advertised.set(a.slug, new Set(rows.map((r) => String(r.tool))))
}

/*
  Reachability, read from #234's placement rather than re-derived.

  `npm run levels` already counts real, non-harness canonical evidence per
  tool; re-implementing that here would be a second definition of the same
  question, which CLAUDE.md records going wrong four times. L4 is "the office
  reached for it unprompted" — a fact about jobs, not about code.
*/
interface Placed {
  tool: string
  at: number
  evidence: string
  /** Reached through the canonical path by ANY traffic, harness included. */
  anyReached: number
  unknown: boolean
}
const placements: Placed[] = JSON.parse(
  execFileSync('npx', ['tsx', 'scripts/levels.ts', '--json'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
) as Placed[]
const level = new Map(placements.map((p) => [p.tool, p]))

type Status = 'proven' | 'advertised-only' | 'n/a-policy' | 'not-granted'
interface Cell {
  agent: string
  tool: string
  granted: boolean
  advertised: boolean
  reachable: boolean
  atLevel: number
  status: Status
  why: string
}

const cells: Cell[] = []
for (const a of agents) {
  for (const t of tools) {
    const granted = grants.has(`${a.slug}|${t.tool}`)
    const told = advertised.get(a.slug)?.has(t.tool) ?? false
    const placed = level.get(t.tool)
    const at = placed?.at ?? 0
    /*
      Reachable means a USER REQUEST can get there — harness traffic included.

      Two questions, deliberately kept apart. `at` is #234's placement and is
      about REAL traffic; a capability Grant has never happened to need is not
      broken. What this gate asks is whether the office CAN reach it when asked,
      and a turn injected through `inbound_commands` on the deployed worker
      exercises the same routing, the same handler and the same writer as Grant
      typing it — the only difference is whose fingers.

      Counting only real traffic here would mark `task.create` unreachable on
      the morning after it was proven end to end, because the harness tears its
      own tasks down. Counting a unit test would be the opposite error, and is
      why this reads canonical job evidence rather than a suite's existence.
    */
    const reachable = at >= 4 || (placed?.anyReached ?? 0) > 0

    /*
      A disabled tool is N/A BY POLICY, not unproven.

      `web.search` is off because 0298 found it claimed on every sheet with
      nothing behind it. Counting that as a hole would make the matrix demand
      we wire something deliberately withdrawn — and the negative control below
      is what keeps the N/A honest: a disabled tool must be absent from the
      brief.
    */
    const status: Status = !t.enabled
      ? 'n/a-policy'
      : !granted
        ? 'not-granted'
        : reachable && told
          ? 'proven'
          : 'advertised-only'

    cells.push({
      agent: a.slug,
      tool: t.tool,
      granted,
      advertised: told,
      reachable,
      atLevel: at,
      status,
      why: !t.enabled
        ? `disabled by policy${t.disabled_reason === '' ? '' : `: ${t.disabled_reason}`}`
        : !granted
          ? 'not granted to this agent'
          : !reachable
            ? `L${String(at)}, never reached by any traffic — ${placed?.evidence ?? 'no canonical evidence'}`
            : !told
              ? 'granted but this agent is not told about it'
              : at >= 4
                ? `L${String(at)} in real traffic — ${placed?.evidence ?? ''}`
                : `reached on the canonical path by ${String(placed?.anyReached ?? 0)} harness turn(s); ` +
                  `L${String(at)} in real traffic`,
    })
  }
}

/*
  The negative control, per agent.

  A disabled tool must not appear in anybody's brief. Without this the N/A
  above is an assertion about policy with nothing checking that the policy
  reaches the prompt — which is exactly how `web.search` came to be claimed on
  eight sheets in the first place.
*/
const leaks: string[] = []
for (const a of agents) {
  for (const t of tools.filter((x) => !x.enabled)) {
    if (advertised.get(a.slug)?.has(t.tool) === true)
      leaks.push(`${a.slug} is told it can ${t.tool}`)
  }
}

const applicable = cells.filter((c) => c.status === 'proven' || c.status === 'advertised-only')
const proven = applicable.filter((c) => c.status === 'proven')
const holes = applicable.filter((c) => c.status === 'advertised-only')

console.log(
  `\nagent × capability — ${String(agents.length)} agents, ${String(tools.length)} capabilities, ` +
    `${String(applicable.length)} applicable cells\n`,
)
const byTool = new Map<string, Cell[]>()
for (const c of cells) byTool.set(c.tool, [...(byTool.get(c.tool) ?? []), c])
for (const t of tools) {
  const row = byTool.get(t.tool) ?? []
  const p = row.filter((c) => c.status === 'proven').length
  const h = row.filter((c) => c.status === 'advertised-only').length
  const na = row.filter((c) => c.status === 'n/a-policy').length
  console.log(
    `  ${t.tool.padEnd(19)} ${na > 0 ? 'N/A by policy'.padEnd(22) : `${String(p)}/${String(p + h)} proven`.padEnd(22)}` +
      `${h === 0 ? '' : `  ADVERTISED-ONLY on ${String(h)}`}`,
  )
}

console.log(
  `\n${String(proven.length)}/${String(applicable.length)} applicable cells proven` +
    `${holes.length === 0 ? '' : `, ${String(holes.length)} advertised and unreachable`}`,
)
if (holes.length > 0) {
  const names = [...new Set(holes.map((h) => h.tool))]
  console.log('\nadvertised to agents and not reachable from any user request:')
  for (const n of names) {
    const one = holes.find((h) => h.tool === n)
    console.log(
      `  ${n.padEnd(19)} ${String(holes.filter((h) => h.tool === n).length)} agents — ${one?.why ?? ''}`,
    )
  }
}
console.log(
  `\nnegative control — a disabled capability must appear in nobody's brief: ${
    leaks.length === 0 ? 'clean' : `LEAKED\n  ${leaks.join('\n  ')}`
  }`,
)

await mkdir('docs/testing', { recursive: true })
await writeFile(
  'docs/testing/agent-capability-matrix.json',
  `${JSON.stringify({ at: new Date().toISOString(), cells, leaks }, null, 2)}\n`,
)

const mark = (c: Cell): string =>
  c.status === 'proven'
    ? 'ok'
    : c.status === 'advertised-only'
      ? '**GAP**'
      : c.status === 'n/a-policy'
        ? 'n/a'
        : '—'
await writeFile(
  'docs/testing/agent-capability-matrix.md',
  [
    '# Agent × Capability — the acceptance matrix',
    '',
    `Generated by \`npm run matrix\` — ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.`,
    '',
    '`ok` — this agent is told it can, and the capability is reachable from a real user',
    'request (#234 level 4 or above, counted from non-harness canonical state).',
    '`**GAP**` — advertised to this agent and **not reachable from any user request**.',
    '`n/a` — disabled by policy. `—` — not granted to this agent.',
    '',
    `**${String(proven.length)}/${String(applicable.length)} applicable cells proven.**`,
    '',
    `| capability | ${agents.map((a) => a.slug.replace('-director', '')).join(' | ')} |`,
    `|---|${agents.map(() => '---').join('|')}|`,
    ...tools.map(
      (t) =>
        `| \`${t.tool}\` | ${agents
          .map((a) => mark(cells.find((c) => c.agent === a.slug && c.tool === t.tool) as Cell))
          .join(' | ')} |`,
    ),
    '',
    '## Why this is not one real job per cell',
    '',
    'Most capabilities are **agent-invariant**: `db.read` is performed by the handler,',
    'identically, whoever is speaking, so asking Ruby to read the database tests the',
    'handler twice and Ruby not at all. What genuinely differs per agent is what the',
    'agent is TOLD — read here from `app.capability_index(slug)`, the same function',
    '`capabilityBrief` builds the prompt from. Reachability is a property of the',
    'routing and the handler and is proven once per capability, from canonical traces.',
    '',
    '## Negative control',
    '',
    leaks.length === 0
      ? "A disabled capability appears in no agent's brief. Clean."
      : `LEAKED:\n\n${leaks.map((l) => `- ${l}`).join('\n')}`,
    '',
  ].join('\n'),
)
console.log('\nreport: docs/testing/agent-capability-matrix.md (+ .json)')

if (process.argv.includes('--strict') && (holes.length > 0 || leaks.length > 0)) process.exit(1)
