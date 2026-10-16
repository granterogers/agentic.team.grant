/**
 * COS-121 / COS-122 — the registry tells the office not to ask Grant for inputs it can find itself.
 *
 *   npx tsx scripts/isolated/registry-never-asks.ts <replica-db>
 *
 * Reads the LIVE registry on the replica (what every prompt is built from). Asserts that the descriptions of the
 * tools whose inputs the office must find for itself (Gmail search and read, Notion write) carry the rule, and that
 * the rule is detected in the text the office would actually be given. A control checks that the detector fails on
 * the description the registry held before migration 1079, so a detector that matches everything cannot pass.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const results: { what: string; ok: boolean; detail: string }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} — ${detail}`)
}

/* The rule, as the model must read it: an explicit instruction not to ask Grant for the input. */
const RULE = /never ask grant/i

const tools = ['gmail.search', 'gmail.read', 'notion.write']
for (const tool of tools) {
  const { rows } = await db.execute(
    `select description from public.tool_permissions where tool = '${tool}'`,
  )
  const text = String((rows[0] as { description?: string } | undefined)?.description ?? '')
  check(
    `${tool} says never to ask Grant for its inputs`,
    RULE.test(text),
    `"${text.slice(0, 90)}…"`,
  )
}

// Control: the description these rows held before migration 1079 must NOT pass the detector.
const before = 'Search Gmail'
check(
  'control: the pre-1079 description fails the detector',
  RULE.test(before) === false,
  `"${before}" is not accepted`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} ok`)
await db.end()
process.exitCode = failed.length === 0 ? 0 : 1
