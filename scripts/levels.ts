/**
 * Where every tool actually sits, on Grant's six levels.
 *
 *   npm run levels            # print, and write docs/testing/capability-levels.md
 *
 * Issue #234. His words, and the whole point of the Issue:
 *
 *   > 1. capability exists in code
 *   > 2. capability has a deterministic test
 *   > 3. capability can be invoked deliberately
 *   > 4. router naturally selects it
 *   > 5. agent actually uses it correctly
 *   > 6. it has been observed in realistic traffic
 *   >
 *   > **Do not describe 1–3 as proof of 4–6.**
 *
 * This repository has been caught doing exactly that twice in two days:
 * `verify:delegation` is level 3 and `delegation_depth = 0` across 505
 * decisions was level 6 saying no; and five agents held sixteen tools each
 * (level 1) having never been selected once (level 4).
 *
 * ## Why this is a separate matrix from `npm run coverage`
 *
 * They answer different questions from different sources. `coverage` is about
 * SUITES — which parts of the product have a test pointed at them, derived
 * from `package.json` and `scripts/verify`. This is about TOOLS — what the
 * office can do and how much of that has actually happened, derived from
 * `tool_permissions`, `staff_tools` and the canonical record of work. Merging
 * them would produce one table that answers neither cleanly.
 *
 * ## Every level above 3 cites canonical state
 *
 * Never a suite's existence. Levels 4–6 are counted from `public.jobs`,
 * `public.outputs`, `public.deliveries` and `public.mcp_calls`, with harness
 * traffic excluded through `app.harness_job` — a tool exercised only by its own
 * test is precisely the thing this file exists to expose, so counting the test
 * would defeat it.
 *
 * ## Nothing here reports "found nothing" as good news
 *
 * #234 records the trap: a check queried `connector_capabilities` for `gmail`,
 * matched zero rows, and reported *"0 claims"* as a PASS. Every evidence query
 * below is paired with a witness that its subject table is non-empty, and a
 * tool whose evidence cannot be counted is printed as UNKNOWN rather than as
 * level 1.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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
const num = async (sql: string): Promise<number> => Number((await all(sql))[0]?.n ?? 0)

/* Real work only, everywhere. A tool used only by its own test is level 2. */
const REAL = 'not app.harness_job(j.job_id)'

interface Tool {
  tool: string
  level: number
  enabled: boolean
  delivered_by: string
}
const tools = (await all(`
  select tool, level::int as level, enabled, coalesce(delivered_by, '') as delivered_by
    from public.tool_permissions order by tool`)) as unknown as Tool[]

const grants = await all(`
  select tool, count(*)::int as n, string_agg(staff_slug, ', ' order by staff_slug) as who
    from public.staff_tools group by 1`)
const grantedTo = new Map(grants.map((g) => [String(g.tool), Number(g.n)]))

/*
  Level 2 — is there a deterministic test?

  Grepped from the repository rather than asserted in a list here, for the same
  reason `coverage` walks `scripts/verify`: a hand-maintained claim that a tool
  is tested is exactly the kind of claim 0298 added `delivered_by` to stop.
*/
const testFiles = [
  ...(await readdir('scripts/verify')).map((f) => `scripts/verify/${f}`),
  ...(await readdir('tests/agents')).map((f) => `tests/agents/${f}`),
]
const corpus = (
  await Promise.all(testFiles.map(async (f) => await readFile(f, 'utf8').catch(() => '')))
).join('\n')

/*
  Which job kinds deliver a tool, read out of `delivered_by`.

  0298 added that column so a registry row could not claim a capability with
  nothing behind it, and it is maintained as data. Parsing it here means the
  evidence query follows the claim automatically instead of being a second
  hand-written mapping that drifts from the first.
*/
const kindsOf = (deliveredBy: string): readonly string[] => [
  ...new Set(
    [...deliveredBy.matchAll(/job kinds?\s+([a-z_.]+)(?:\s+and\s+([a-z_.]+))?/g)]
      .flatMap((m) => [m[1], m[2]])
      .filter((k): k is string => k !== undefined),
  ),
]

/*
  Evidence for the tools no job kind delivers.

  Written down deliberately and one line each, because there is no column that
  says where a non-job capability leaves its mark. Each names the canonical
  table that would hold the trace, and `witness` is the query that proves that
  table is capable of holding anything at all — the guard against reporting an
  empty subject as a clean result.
*/
const BY_HAND: Readonly<
  Record<string, { readonly why: string; readonly used: string; readonly witness: string }>
> = {
  'db.read': {
    why: 'every handler reads its own database; a completed real job IS the evidence',
    used: `select count(*)::int as n from public.jobs j where ${REAL} and j.state = 'complete'`,
    witness: 'select count(*)::int as n from public.jobs',
  },
  'draft.create': {
    why: 'a draft is a row in public.outputs',
    used: `select count(*)::int as n from public.outputs o join public.jobs j on j.job_id = o.job_id where ${REAL}`,
    witness: 'select count(*)::int as n from public.outputs',
  },
  'slack.post': {
    why: 'a post is a delivery on the slack channel',
    used: `select count(*)::int as n from public.deliveries d join public.jobs j on j.job_id = d.job_id
             where ${REAL} and d.channel = 'slack' and d.sent_at is not null`,
    witness: "select count(*)::int as n from public.deliveries where channel = 'slack'",
  },
  'github.read': {
    why: 'reached through the MCP server, which logs every call',
    used: "select count(*)::int as n from public.mcp_calls where tool like 'github%'",
    witness: 'select count(*)::int as n from public.mcp_calls',
  },
  'task.create': {
    why: 'app.hq_task_add writes public.tasks',
    used: 'select count(*)::int as n from public.tasks',
    witness: 'select count(*)::int as n from public.tasks',
  },
  'preference.update': {
    /*
      `public.preferences` does not exist — guessed once, refused once, and
      CLAUDE.md says to query `information_schema` first for exactly this
      reason. The store is `system_config`, and a preference an agent CHANGED
      leaves its mark in `preference_instructions`: what somebody asked for, as
      opposed to what the value happens to be now.
    */
    why: 'a changed preference is a row in public.preference_instructions',
    used: 'select count(*)::int as n from public.preference_instructions',
    witness: 'select count(*)::int as n from public.system_config',
  },
  'gmail.draft': {
    why: 'src/google/mail.ts writes a draft; no canonical table records one yet',
    used: 'select 0::int as n',
    witness: 'select 0::int as n',
  },
}

/*
  Does a handler for this kind exist at all?

  0298 added `delivered_by` because a registry row could otherwise claim a
  capability with nothing behind it — `web.search` was listed, ENABLED, on
  every agent's sheet, with no implementation. That column made the claim
  writable; it did not make it CHECKABLE, and a kind named there that no
  handler registers is the same defect one indirection along. `git grep` for
  the registration rather than a maintained list, so it cannot rot.
*/
const registered = (kind: string): boolean => {
  try {
    execFileSync('git', ['grep', '-q', `kind: '${kind}'`, '--', 'src/'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const unclaimedKinds: string[] = []

interface Row {
  tool: string
  level: number
  enabled: boolean
  granted: number
  reached: number
  worked: number
  recent: number
  tested: boolean
  evidence: string
  unknown: boolean
}

const rows: Row[] = []
for (const t of tools) {
  const kinds = kindsOf(t.delivered_by)
  let reached = 0
  let worked = 0
  let recent = 0
  let evidence = ''
  let unknown = false

  if (kinds.length > 0) {
    for (const k of kinds) if (!registered(k)) unclaimedKinds.push(`${t.tool} -> ${k}`)
    const list = kinds.map((k) => `'${k}'`).join(', ')
    reached = await num(
      `select count(*)::int as n from public.jobs j where ${REAL} and j.kind in (${list})`,
    )
    worked = await num(
      `select count(*)::int as n from public.jobs j where ${REAL} and j.kind in (${list}) and j.state = 'complete'`,
    )
    recent = await num(
      `select count(*)::int as n from public.jobs j where ${REAL} and j.kind in (${list})
         and j.state = 'complete' and j.finished_at > app.now_utc() - interval '30 days'`,
    )
    evidence = `real jobs of kind ${kinds.join(', ')}`
  } else if (BY_HAND[t.tool] !== undefined) {
    const spec = BY_HAND[t.tool] as (typeof BY_HAND)[string]
    /*
      The witness first.

      If the table that would hold the trace is empty, a zero from the second
      query says nothing about the tool — it says the record does not exist.
      Those are completely different findings and only one of them is about
      the capability.
    */
    const witness = await num(spec.witness)
    const used = await num(spec.used)
    unknown = witness === 0
    reached = used
    worked = used
    recent = used
    evidence = spec.why
  } else {
    unknown = true
    evidence =
      t.delivered_by === ''
        ? 'nothing in the registry says what delivers this'
        : `${t.delivered_by} — no canonical trace is counted for it`
  }

  rows.push({
    tool: t.tool,
    level: t.level,
    enabled: t.enabled,
    granted: grantedTo.get(t.tool) ?? 0,
    reached,
    worked,
    recent,
    tested: corpus.includes(t.tool),
    evidence,
    unknown,
  })
}

/*
  The placement rule, in one place.

  Deliberately ordered highest-first and deliberately CONSERVATIVE: a tool only
  reaches a level when the evidence for it exists, and everything else falls
  through to the level below. That asymmetry is the whole instruction — being
  told a capability is at level 6 when it is at level 1 costs the work
  silently, and the reverse costs a re-check.
*/
const placeAt = (r: Row): number => {
  if (!r.enabled) return 0
  if (r.unknown) return r.tested ? 2 : 1
  if (r.recent > 0) return 6
  if (r.worked > 0) return 5
  if (r.reached > 0) return 4
  if (r.tested) return 2
  return 1
}
const MEANS: Readonly<Record<number, string>> = {
  0: 'disabled by policy',
  1: 'exists in code',
  2: 'has a deterministic test',
  3: 'can be invoked deliberately',
  4: 'the office reached for it unprompted',
  5: 'and it worked',
  6: 'and it worked in the last 30 days',
}

const placed = rows
  .map((r) => ({ ...r, at: placeAt(r) }))
  .sort((a, b) => b.at - a.at || a.tool.localeCompare(b.tool))

console.log('\nwhere every tool actually sits — #234\n')
for (const r of placed) {
  console.log(
    `  L${String(r.at)}  ${r.tool.padEnd(19)} ${MEANS[r.at] ?? ''}` +
      `${r.granted === 0 ? '' : `  · granted to ${String(r.granted)}`}` +
      `${r.reached === 0 ? '' : `  · ${String(r.worked)}/${String(r.reached)} real`}`,
  )
}

/*
  The output #234 says is the one that matters:

    > Identify tools/actions assigned to agents that have never actually been
    > exercised.

  A tool granted to eight people and never once used is either dead weight or a
  capability the router cannot reach, and the second is #230 wearing different
  clothes.
*/
const dead = placed.filter((r) => r.granted > 0 && r.at < 4 && r.enabled)
console.log(`\ngranted to agents and never exercised — ${String(dead.length)}`)
for (const r of dead) {
  console.log(`  ${r.tool.padEnd(19)} granted to ${String(r.granted)}  — ${r.evidence}`)
}

const unknowns = placed.filter((r) => r.unknown && r.enabled)
console.log(`\nno canonical trace exists to place these — ${String(unknowns.length)}`)
for (const r of unknowns) console.log(`  ${r.tool.padEnd(19)} ${r.evidence}`)

/*
  CONTROL: the registration check can say no.

  It reports zero, and a check that has only ever reported zero is
  indistinguishable from one that cannot report anything — this one already
  reported ten while it was broken (a missing import made every lookup throw
  into the catch), which is the cheerful direction of the same failure. A kind
  nothing could possibly implement must come back unregistered, or the zero
  above means nothing.
*/
if (registered('office.a_kind_that_does_not_exist')) {
  console.error(
    '\n  FAIL CONTROL: the registration lookup matched a kind that cannot exist — ' +
      'the zero below is meaningless',
  )
  process.exitCode = 1
}

console.log(
  `\nregistry rows naming a job kind no handler implements — ${String(unclaimedKinds.length)}`,
)
for (const u of unclaimedKinds) console.log(`  ${u}`)

const md = [
  '# Where every tool actually sits',
  '',
  `Generated by \`npm run levels\` — ${new Date().toISOString().slice(0, 10)}. Do not edit by hand.`,
  '',
  "Issue #234. Grant's rule: **do not describe 1–3 as proof of 4–6.** Levels 4",
  'and above are counted from canonical state with harness traffic excluded, never',
  "from a suite's existence.",
  '',
  '| level | meaning |',
  '|---|---|',
  ...Object.entries(MEANS).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '| tool | level | granted to | real uses | worked | last 30d | evidence |',
  '|---|---|---|---|---|---|---|',
  ...placed.map(
    (r) =>
      `| \`${r.tool}\` | **L${String(r.at)}** | ${String(r.granted)} | ${r.unknown ? '—' : String(r.reached)} | ${r.unknown ? '—' : String(r.worked)} | ${r.unknown ? '—' : String(r.recent)} | ${r.evidence} |`,
  ),
  '',
  '## Granted to agents and never exercised',
  '',
  dead.length === 0
    ? 'None.'
    : dead
        .map((r) => `- \`${r.tool}\` — granted to ${String(r.granted)}. ${r.evidence}`)
        .join('\n'),
  '',
  '## No canonical trace exists to place these',
  '',
  'Reported as UNKNOWN rather than as level 1. #234 records the trap: a check that',
  'queried an empty table and reported "0 claims" as a pass.',
  '',
  unknowns.length === 0
    ? 'None.'
    : unknowns.map((r) => `- \`${r.tool}\` — ${r.evidence}`).join('\n'),
  '',
].join('\n')

await mkdir('docs/testing', { recursive: true })
await writeFile('docs/testing/capability-levels.md', md)
console.log('\nreport: docs/testing/capability-levels.md')
