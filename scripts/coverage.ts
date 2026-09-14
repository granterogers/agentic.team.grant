/**
 * The backend capability coverage matrix.
 *
 *   npm run coverage
 *
 * Issue #224. Grant's pre-human backend acceptance specification asks, as its
 * Phase 1, for a durable record of *"what the current system actually claims to
 * support"* — capability, the suites that exercise it, the execution path, what
 * persists, how success is read back independently, the failure tests, the
 * cleanup, a coverage verdict, and whether genuine automation is impossible.
 *
 * ## Why this is generated and not written
 *
 * The specification is equally explicit about what it does NOT want:
 *
 *   > Do not create a second capability architecture merely to hold this
 *   > information. The purpose of the matrix is to expose untested behaviour,
 *   > not to create bureaucracy.
 *
 * A hand-written table of ninety-seven suites is bureaucracy by the second week
 * — it is a copy of facts that already live in `package.json`, in each suite's
 * own header, and in the last sweep's results, and CLAUDE.md's rule about
 * storing a fact you can already read applies to documentation exactly as it
 * applies to columns. So everything derivable is DERIVED, and the only thing
 * kept by hand is the part no file can know: which domain a suite belongs to,
 * and where the gaps are.
 *
 * ## What it cannot tell you
 *
 * That a suite EXISTS for a capability, and that it passed. It cannot tell you
 * the suite looks at the layer the user does — CLAUDE.md has four separate
 * entries about verifications that passed for the wrong reason — so the
 * verdicts in DOMAINS are a judgement recorded by a person, and they are dated.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

type Result = { status: string; tally: string; ms: number; at: string }

/**
 * The one thing no file knows: which backend domain a suite serves.
 *
 * Every domain the specification's Phase 2 names is here, in its order, plus
 * the ones the repository has that it did not name — which it asked for:
 * *"If the repository exposes another meaningful backend capability, include
 * it. Do not leave something untested merely because this prompt did not name
 * it."*
 *
 * `gap` is the honest half. It is what is NOT covered, written by a person,
 * and it is the reason this document is worth generating at all — a list of
 * green suites is a list of green suites.
 */
const DOMAINS: ReadonlyArray<{
  readonly domain: string
  readonly suites: readonly string[]
  readonly verdict: 'Full' | 'Partial' | 'Superficial' | 'None'
  readonly gap: string
}> = [
  {
    domain: 'Projects',
    suites: ['identity', 'references', 'connections', 'settings', 'portfolio'],
    verdict: 'Partial',
    gap: 'The create / near-duplicate / rename / archive arc is now proven end to end in verify:identity (#224), and it found a real defect: hq_rename_project let two live projects answer to one name while hq_create_project refused exactly that. Fixed in 0365. Renaming a REAL project makes it permanently undeletable, because the rename enqueues a job and a job can never be removed, so the whole arc runs inside a rollback. What is still uncovered: bulk operations, and what happens to a project holding many documents when it is archived.',
  },
  {
    domain: 'Tasks',
    suites: ['tasks', 'waiting', 'portfolio'],
    verdict: 'Full',
    gap: 'Dependencies and priority are exercised only where the schema supports them.',
  },
  {
    domain: 'Documents and assets',
    suites: ['assets', 'files', 'import', 'shapes', 'send'],
    verdict: 'Partial',
    gap: 'Malformed, empty and very large files are untested — #41 §8 names them and nothing reaches them.',
  },
  {
    domain: 'Project graph',
    suites: ['graph', 'inverse'],
    verdict: 'Full',
    gap: 'inverse exists precisely to query an edge from both sides, which is the property the IA document asks for.',
  },
  {
    domain: 'Search',
    suites: ['search', 'corpus'],
    verdict: 'Full',
    gap: 'Misspellings and natural-language phrasing are covered; ranking quality is a judgement, not an assertion.',
  },
  {
    domain: 'Conversation',
    suites: [
      'conversation',
      'chat',
      'history',
      'addressing',
      'echo',
      'equivalence',
      'cross-interface',
      'latency',
    ],
    verdict: 'Full',
    gap: 'The most covered domain in the office after #191. Stream-of-consciousness volume belongs to #171, not here.',
  },
  {
    domain: 'Routing and delegation',
    suites: ['router', 'delegation', 'handoff', 'trace'],
    verdict: 'Full',
    gap: 'handoff exists because output attribution is not proof of delegation. Specialist DISAGREEMENT and poor specialist output are not exercised.',
  },
  {
    domain: 'Capability self-knowledge',
    suites: ['knows', 'capability', 'acquire', 'sheets'],
    verdict: 'Full',
    gap: 'Both directions are asserted — a false "I cannot" and a false "I can" (#64).',
  },
  {
    domain: 'Anti-hallucination',
    suites: ['attests'],
    verdict: 'Full',
    gap: 'Gates creation AND sending, and records a refusal rather than dropping it (#185, #211). The single most important invariant in the specification.',
  },
  {
    domain: 'GitHub',
    suites: ['github', 'github-token'],
    verdict: 'Full',
    gap: 'github-token spends a real budget and is excluded from the sweep by name (#18).',
  },
  {
    domain: 'Gmail',
    suites: ['mail', 'google-live'],
    verdict: 'Partial',
    gap: 'verify:mail fakes Google on purpose and should — the interesting behaviour is what the office DOES with what Google returns, and a live inbox changes under you. What was missing was that NOTHING touched the real thing; verify:google-live now does, read-only. Gmail answers. The earlier claim that this was blocked on an OAuth client was simply false: the credential has worked since 8 September and nobody checked.',
  },
  {
    domain: 'Google Drive',
    suites: ['drive', 'sheets', 'google-live'],
    verdict: 'Partial',
    gap: "DRIVE IS NOT ACTUALLY REACHABLE. verify:google-live gets http 403 — the Drive API has never been enabled in the Google Cloud project holding the credential, so every Drive capability the office believes it has would fail on first real use. One click in the Cloud Console, and it is Grant's account.",
  },
  {
    domain: 'Google Calendar',
    suites: ['calendar', 'google-live'],
    verdict: 'Partial',
    gap: 'Faked in verify:calendar on purpose; verify:google-live confirms the real API answers and five calendars are visible.',
  },
  {
    domain: 'NotebookLM',
    suites: ['notebook'],
    verdict: 'Partial',
    gap: 'verify:notebook (#227) tests the CLAIM rather than the connector, because ADR-0013 means there is no API to test. Nine of the eleven capability rows said verified_by=probe with no probe running, which is the web.search defect exactly. It now resolves the adapter the way handlers/sync.ts does and asks it. What it CANNOT cover is whether the unofficial paths still work end to end — that needs the Python tooling this environment lacks (npm run setup:python), and the adapter currently reports unavailable for that reason. So the reach values marked unofficial are trusted, not proven.',
  },
  {
    domain: 'Notion',
    suites: ['notion', 'notion-write', 'sync'],
    verdict: 'Full',
    gap: 'notion-write exercises the whole capability matrix against the real API.',
  },
  {
    domain: 'Slack',
    suites: ['slack', 'channels', 'transport', 'echo'],
    verdict: 'Full',
    gap: 'Canonical behaviour and real transport already separated. Fixtures are named zz-test at CREATION, because a crashed run never reaches teardown and Slack refuses to delete an archived channel.',
  },
  {
    domain: 'Telegram',
    suites: ['telegram', 'transport', 'channels'],
    verdict: 'Full',
    gap: 'A limited real-transport set against a fixture chat; the rest is canonical simulation.',
  },
  {
    domain: 'Voice and dictation',
    suites: ['talk', 'tts', 'dictation', 'cors'],
    verdict: 'Partial',
    gap: 'Everything safe without a microphone. cors exists because a server-side fetch sends no Origin and therefore cannot detect the misconfiguration that killed the voice call for weeks. Real microphone UX is HUMAN-ONLY.',
  },
  {
    domain: 'Approvals, permissions, destructive actions',
    suites: ['boundary', 'security', 'credentials', 'disconnect', 'oauth', 'dryrun'],
    verdict: 'Full',
    gap: 'boundary attacks the boundary rather than describing it. disconnect wraps every call in a transaction after a run of it really disconnected Slack (#210).',
  },
  {
    domain: 'Undo and recovery',
    suites: ['undo', 'restore', 'offline'],
    verdict: 'Partial',
    gap: 'restore restores a backup over the live database and is excluded from every batch by name — run deliberately, by a person.',
  },
  {
    domain: 'Learning, skills, proposals',
    suites: ['learning', 'lessons', 'skills', 'proposes', 'impediments', 'governs', 'notice'],
    verdict: 'Full',
    gap: 'Append-only throughout, so each suite retires its subject rather than deleting it.',
  },
  {
    domain: 'Job engine',
    suites: ['jobs', 'worker', 'transitions', 'ledger', 'failures', 'chaos'],
    verdict: 'Partial',
    gap: "verify:chaos went 21 -> 29 for #228: two workers dequeuing at once (exactly one wins, and the winner's lease carries its own name), an expired lease RECOVERED to retrying with the dead worker's claim released, a migration recorded twice refused by the ledger, empty title and empty content recorded rather than judged, and a terminal job refused a move back into flight. Still uncovered: cold starts, a 100MB file, rate limiting as distinct from one 429, and tool-response corruption that is valid JSON of the wrong shape.",
  },
  {
    domain: 'Recurring duties',
    suites: ['duties', 'worker'],
    verdict: 'Partial',
    gap: 'verify:duties (#225) covers due detection, the idempotency key, dispatch, duplicate prevention, disabled duties, the cadence floor and staleness — every call inside a rollback, because dispatch_due_responsibilities() fires EVERY due duty and would otherwise fire Grant\'s. What it deliberately does NOT do is run a duty HANDLER: dispatch creates a job, and running it is verify:worker\'s business. So the arc from "the duty fired" to "the thing the duty is for actually happened" is still only covered for the kinds verify:worker drives. That is the remaining gap, and it is why this is Partial rather than Full.',
  },
  {
    domain: 'Schema and reachability',
    suites: ['schema', 'wrappers', 'db'],
    verdict: 'Full',
    gap: 'wrappers is the one that catches the PostgREST trap: an app.* RPC with no public wrapper works perfectly and cannot be called by anything with a browser.',
  },
  {
    domain: 'Cost and providers',
    suites: ['router', 'tts', 'hq'],
    verdict: 'Partial',
    gap: 'Spend is reported as measured AND modelled. Free-tier headroom against Supabase, Vercel and OpenRouter is not asserted anywhere.',
  },
  {
    domain: 'MCP',
    suites: ['mcp', 'oauth'],
    verdict: 'Full',
    gap: 'Both the tool surface and the flow a client actually walks.',
  },
  {
    domain: 'Knowledge layer',
    suites: ['knowledge'],
    verdict: 'Partial',
    gap: 'Checked against the live database. What the office holds is exercised; whether it retrieves the RIGHT thing under a vague question is a judgement and belongs to the evaluator (#171), not here.',
  },
  {
    domain: 'Briefings',
    suites: ['briefing'],
    verdict: 'Full',
    gap: 'The morning briefing happens, ONCE, and says only true things. The once matters as much as the true.',
  },
  {
    domain: 'Modules and milestones',
    suites: ['modules'],
    verdict: 'Full',
    gap: 'A module is a milestone that gathers, and the page draws it.',
  },
  {
    domain: 'Phase acceptance scenarios',
    suites: ['agents', 'autonomy', 'scenario-a'],
    verdict: 'Partial',
    gap: "These demonstrate whole PHASES against the live database rather than one capability, so a red here is a scenario clause rather than a unit. scenario-a is the only suite that runs an arc end to end. §22 B's last clause — generated code in an isolated workspace — is not built, because nothing generates code yet.",
  },
]

/** Suites the deep sweep will not start, and the reason, kept in step with e2e.ts. */
const EXCLUDED = new Set(['all', 'restore', 'github-token', 'db', 'controls'])

/**
 * Frontend audits, named rather than merely absent.
 *
 * These belong to the UX QA standard (`docs/spec/ux-qa-governance-2026-09-14.md`),
 * not to this matrix. Subtracting them by name is what makes the unclaimed list
 * below worth reading: without it, eleven browser suites sit in the same list
 * as a backend domain nobody has thought about, and the signal is gone.
 */
const FRONTEND = new Set([
  'access',
  'arrangement',
  'chat',
  'controls:settings',
  'controls:studio',
  'controls:team',
  'conversation-all',
  'design',
  'dictation',
  'layouts',
  'motion',
  'offline',
  'pulse',
  'settings',
  'talk',
  'times',
  'ui',
  'wired',
])

const headline = async (suite: string): Promise<string> => {
  const file = `scripts/verify/${suite.replace(':', '-')}.ts`
  if (!existsSync(file)) return ''
  const head = (await readFile(file, 'utf8')).split('\n').slice(0, 8)
  for (const line of head) {
    const m = /^\s*\*\s+([A-Z].*)$/.exec(line)
    if (m?.[1] !== undefined) return m[1].replace(/\s+$/, '')
  }
  return ''
}

const results: Record<string, Result> = existsSync('.out/e2e-results.json')
  ? (JSON.parse(await readFile('.out/e2e-results.json', 'utf8')) as Record<string, Result>)
  : {}

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
  scripts: Record<string, string>
}
const allSuites = Object.keys(pkg.scripts)
  .filter((k) => k.startsWith('verify:'))
  .map((k) => k.slice('verify:'.length))
  .sort()

const claimed = new Set(DOMAINS.flatMap((d) => d.suites))
const files = (await readdir('scripts/verify')).filter((f) => f.endsWith('.ts'))

const verdictCount = (v: string): number => DOMAINS.filter((d) => d.verdict === v).length
const stamp = new Date().toISOString().slice(0, 10)

const out: string[] = [
  '# Backend capability coverage',
  '',
  `Generated by \`npm run coverage\` on ${stamp}. Issue #224, Phase 1.`,
  '',
  '**Derived from the repository, not maintained by hand.** The suites come from',
  "`package.json`, each description is the suite's own header sentence, and each",
  'verdict is the last recorded result of `npm run e2e`. The only hand-written',
  'column is the GAP — what is not covered — because that is the only part no',
  'file can know, and it is the only part worth reading.',
  '',
  '## Where the office stands',
  '',
  `| | |`,
  `|---|---|`,
  `| domains | **${String(DOMAINS.length)}** |`,
  `| fully exercised | **${String(verdictCount('Full'))}** |`,
  `| partially exercised | **${String(verdictCount('Partial'))}** |`,
  `| not exercised at all | **${String(verdictCount('None'))}** |`,
  `| \`verify:*\` suites in the repository | **${String(allSuites.length)}** |`,
  `| suites with a recorded result | **${String(Object.keys(results).length)}** |`,
  '',
  '## Domains with NO suite at all',
  '',
  ...DOMAINS.filter((d) => d.verdict === 'None').flatMap((d) => [`### ${d.domain}`, '', d.gap, '']),
  '## Every domain',
  '',
]

for (const d of DOMAINS) {
  out.push(`### ${d.domain} — ${d.verdict}`, '')
  if (d.suites.length === 0) {
    out.push('_No suite._', '')
  } else {
    out.push('| suite | what it checks | last result |', '|---|---|---|')
    for (const s of d.suites) {
      const r = results[s]
      const verdict =
        r === undefined
          ? '_not run in the last sweep_'
          : r.status === 'pass'
            ? `green — ${r.tally === '' ? 'exit 0' : r.tally}`
            : `**${r.status.toUpperCase()}** — ${r.tally}`
      out.push(`| \`verify:${s}\` | ${await headline(s)} | ${verdict} |`)
    }
    out.push('')
  }
  out.push(`**Gap.** ${d.gap}`, '')
}

/*
  The check that keeps this document honest.

  A matrix is worth exactly as much as its claim to be complete, and the way
  that claim rots is a suite being added and nobody putting it in a domain. So
  the unclaimed list is printed rather than quietly omitted — the same rule the
  deep sweep follows about a suite it could not run.
*/
const unclaimed = allSuites.filter((s) => !claimed.has(s) && !EXCLUDED.has(s) && !FRONTEND.has(s))
out.push(
  '## Suites not claimed by any domain above',
  '',
  unclaimed.length === 0
    ? 'None — every suite in `package.json` belongs to a domain.'
    : `${String(unclaimed.length)} backend suite(s) this matrix has not placed. An unplaced suite is a domain nobody has named:\n\n${unclaimed.map((s) => `\`${s}\``).join(', ')}`,
  '',
  `_${String(FRONTEND.size)} frontend audits are deliberately out of scope here. They belong to the UX QA standard in \`docs/spec/ux-qa-governance-2026-09-14.md\`._`,
  '',
  '## Human-only',
  '',
  'What genuinely cannot be proven without Grant, and therefore must not be',
  'pushed onto him disguised as something a script forgot:',
  '',
  '- real microphone capture and release, and whether the voice call FEELS responsive',
  '- conversational naturalness — whether the office reads like a colleague',
  '- visual taste, and the WOW gate',
  '- notification feel: whether a buzz at that moment was welcome',
  '- subjective latency tolerance',
  '',
  '---',
  '',
  `_${String(files.length)} files in \`scripts/verify\`. ${String(allSuites.length)} are npm scripts; the rest are measurement tools (\`probe\`, \`space\`, \`wide\`, \`press\`, \`smoke\`, \`studio\`, \`seed-appearance\`, \`texture-sheet\`)._`,
  '',
)

await mkdir('docs/testing', { recursive: true })
await writeFile('docs/testing/capability-coverage.md', out.join('\n'))
console.log(
  `coverage — ${String(DOMAINS.length)} domains: ${String(verdictCount('Full'))} full, ${String(verdictCount('Partial'))} partial, ${String(verdictCount('None'))} none`,
)
if (unclaimed.length > 0) {
  console.log(
    `  ${String(unclaimed.length)} suite(s) not claimed by any domain: ${unclaimed.join(', ')}`,
  )
}
console.log('report: docs/testing/capability-coverage.md')
