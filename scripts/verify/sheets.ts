/**
 * Every connector says what it can do, and what we never ask it for.
 *
 *   npm run verify:sheets
 *
 * Issue #51, migrations 0300 and 0301. Grant:
 *
 *   > *"to also be aware of the components you're dealing with. So what else
 *   > they can do with the Google notebook, what they can create, what they
 *   > can recover from it."*
 *
 * ## The two properties that make a sheet worth having
 *
 * **It must record the negatives.** #51 is explicit — *"The answer may well be
 * 'less than hoped' — that is a finding, and it belongs in the sheet."* A sheet
 * of only the good news is what an agent already assumes, and assuming is how
 * Claire told Grant she could not send buttons (#64) and how the registry told
 * every agent it could search the web (#50).
 *
 * **The gap must be a query.** *"'What we could do and do not' is a query, not
 * an opinion."* A suggestion drawn from `unused_capabilities` is a fact about
 * the office; one drawn from a model asked "what could we do better" is an
 * opinion, and #52 exists because of the difference.
 *
 * ## And the sheet must agree with the probe
 *
 * NotebookLM's rows claim `verified_by = 'probe'`. That claim is worth exactly
 * as much as the check that compares it to `notebook_capability`, which is what
 * the last section does — otherwise `probe` is a word somebody typed.
 */

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

const checks: boolean[] = []
const check = (what: string, said: string, ok: boolean): void => {
  checks.push(ok)
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what} — ${said}`)
}
const one = async (sql: string): Promise<Record<string, unknown>> =>
  ((await db.execute(sql)).rows[0] ?? {}) as Record<string, unknown>

interface Row {
  connector: string
  verb: string
  reach: string
  we_use_it_for: string | null
  how_we_know: string
}

console.log('\nverify:sheets\n')

// ===========================================================================
console.log('every connector has a sheet')

const sheet = (await one('select app.connector_sheet(null) as s')).s as Row[]
const connectors = (
  await db.execute('select connector from public.knowledge_connectors order by connector')
).rows.map((r) => String(r.connector))

const covered = new Set(sheet.map((r) => r.connector))
check(
  'every connector the office has is described',
  `${String(covered.size)} of ${String(connectors.length)}: ${connectors.filter((c) => !covered.has(c)).join(', ') || 'none missing'}`,
  connectors.every((c) => covered.has(c)),
)
check(
  'and the sheet is not trivially small',
  `${String(sheet.length)} verb(s) across ${String(covered.size)} connector(s)`,
  sheet.length >= 20,
)

// ===========================================================================
console.log('\nand it records what a connector CANNOT do')

/*
  The half a sheet is usually missing. Three specific negatives that have each
  cost real time or would: Notion has no teamspace on any version, Drive is
  read-only by scope, GitHub write is disabled at risk 3.
*/
const negatives = sheet.filter((r) => r.reach === 'none' || r.reach === 'browser_only')
check(
  'the negatives are in the sheet, not only the good news',
  `${String(negatives.length)}: ${negatives.map((n) => `${n.connector}/${n.verb.slice(0, 26)}`).join('; ')}`,
  negatives.length >= 4,
)
check(
  'including the Notion teamspace, which has cost this repository time twice',
  negatives.find((n) => n.verb.includes('teamspace'))?.verb ?? 'NOT RECORDED',
  negatives.some((n) => n.connector === 'notion' && n.verb.includes('teamspace')),
)
check(
  'and that Drive is read-only by scope, rather than by accident',
  negatives.find((n) => n.connector === 'drive')?.verb ?? 'NOT RECORDED',
  negatives.some((n) => n.connector === 'drive'),
)

/*
  A CONTROL. "It records negatives" is satisfied by a sheet that is ALL
  negatives, which would be a different kind of useless.
*/
const reachable = sheet.filter((r) => r.reach === 'api' || r.reach === 'unofficial')
check(
  'CONTROL: and most of it is things the office CAN do',
  `${String(reachable.length)} reachable, ${String(negatives.length)} not`,
  reachable.length > negatives.length,
)

// ===========================================================================
console.log('\nthe gap is a query, not an opinion')

const gap = (await one('select app.unused_capabilities() as g')).g as Row[]
check(
  'what we could do and do not is askable',
  gap.length === 0
    ? 'nothing unused — the office uses every reachable verb'
    : gap.map((g) => `${g.connector}: ${g.verb}`).join('; '),
  Array.isArray(gap),
)
/*
  It must never offer something nobody can do. "We cannot share a notebook" is
  a fact about Google, not an opportunity, and proposing it would be the office
  suggesting work that cannot be started.
*/
check(
  'and it never suggests something unreachable',
  gap.every((g) => g.reach === 'api' || g.reach === 'unofficial')
    ? 'all reachable'
    : 'AN UNREACHABLE VERB WAS OFFERED',
  gap.every((g) => g.reach === 'api' || g.reach === 'unofficial'),
)
/*
  Asked of the TABLE, not of the function's own output.

  The first version read `we_use_it_for` off the returned rows —
  `unused_capabilities` does not include that key, so every row read
  `undefined` and the check failed against correct behaviour. Asking the source
  of truth is also the stronger question: it catches a function that filtered
  correctly today and stopped, which reading its own output never could.
*/
const wronglyOffered = Number(
  (
    await one(`
      select count(*)::int as n
        from jsonb_to_recordset(app.unused_capabilities()) as g(connector text, verb text)
        join public.connector_capabilities c
          on c.connector = g.connector and c.verb = g.verb
       where btrim(c.used_by) <> ''
    `)
  ).n,
)
check(
  'nor something the office already does',
  wronglyOffered === 0
    ? 'none of them is already in use'
    : `${String(wronglyOffered)} ALREADY-USED VERB(S) WERE OFFERED`,
  wronglyOffered === 0,
)

/*
  And the other direction, which is the one that rots quietly: a verb the
  office DOES use must not sit in the gap, and a verb it stops using must
  appear there. Proved by moving one and putting it back.
*/
const before = gap.length
await db.execute(`
  update public.connector_capabilities set used_by = ''
   where connector = 'notion' and verb = 'query a data source'
`)
const wider = ((await one('select app.unused_capabilities() as g')).g as Row[]).length
await db.execute(`
  update public.connector_capabilities set used_by = 'duty:notion-sync'
   where connector = 'notion' and verb = 'query a data source'
`)
const restored = ((await one('select app.unused_capabilities() as g')).g as Row[]).length
check(
  'a verb the office stops using appears in the gap, and reappears when it does not',
  `${String(before)} → ${String(wider)} → ${String(restored)}`,
  wider === before + 1 && restored === before,
)

// ===========================================================================
console.log('\nand an agent is told about the gap')

const could = (await one("select app.capability_index('research-director') -> 'could' as c")).c as
  | Row[]
  | null
check(
  'the capability index carries it, so it reaches the prompt',
  could === null ? 'the key is missing' : `${String(could.length)} entry(ies)`,
  Array.isArray(could) && could.length === gap.length,
)
/*
  And the index did not lose anything by gaining a key. 0301 wraps a
  hundred-line function rather than restating it, for exactly the reason 0164
  is a cautionary tale — but a wrapper can still be wired up wrong.
*/
const full = (await one("select app.capability_index('research-director') as i")).i as Record<
  string,
  unknown
>
check(
  'CONTROL: and nothing else in the index was lost',
  Object.keys(full).sort().join(', '),
  ['at', 'can', 'cannot', 'could', 'declined', 'for', 'must_ask', 'reach'].every((k) =>
    Object.hasOwn(full, k),
  ),
)

// ===========================================================================
console.log('\nand a row claiming it was probed can prove it')

/*
  `verified_by = 'probe'` is a word somebody typed unless something compares it
  to the probe. 0298's lesson one table over: a row can assert anything.
*/
const probed = (
  await db.execute(`
    select capabilities from public.notebook_capability
  `)
).rows[0] as { capabilities?: string[] } | undefined
const fromProbe = probed?.capabilities ?? []
const claimed = sheet.filter((r) => r.connector === 'notebooklm' && r.how_we_know === 'probe')

check(
  'CONTROL: the probe actually ran and found things',
  `${String(fromProbe.length)} capability(ies) on record`,
  fromProbe.length >= 10,
)
/*
  Each probed row maps to something the probe reported. Matched loosely on the
  verb's key word rather than on an exact string, because the sheet is written
  for a person and the probe is written for a machine — pinning them to the
  same spelling would make renaming either one a false failure.
*/
const unbacked = claimed.filter((r) => {
  const word = r.verb.includes('create a notebook')
    ? 'create_notebook'
    : r.verb.includes('add a source')
      ? 'add_source'
      : r.verb.includes('ask')
        ? 'ask'
        : r.verb.includes('generate')
          ? 'generate_artifact'
          : r.verb.includes('download')
            ? 'download_artifact'
            : r.verb.includes('note')
              ? 'create_note'
              : r.verb.includes('list the notebooks')
                ? 'list_notebooks'
                : r.verb.includes('account limits')
                  ? 'account_limits'
                  : r.verb.includes('sources')
                    ? 'list_sources'
                    : '(unmapped)'
  return !fromProbe.some((c) => c.includes(word))
})
check(
  'every NotebookLM row claiming a probe is backed by one',
  unbacked.length === 0
    ? `${String(claimed.length)} probed rows, all backed`
    : `UNBACKED: ${unbacked.map((u) => u.verb).join('; ')}`,
  unbacked.length === 0,
)

const failed = checks.filter((c) => !c).length
console.log(`\n${String(checks.length - failed)}/${String(checks.length)} checks passed`)
process.exit(failed === 0 ? 0 : 1)
