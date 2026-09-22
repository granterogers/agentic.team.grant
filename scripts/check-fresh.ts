/**
 * THE FRESH-INSTALL GUARD.
 *
 *   npm run check:fresh
 *
 * §15 asks for a permanent, repeatable guard against the things that make an
 * installation work for exactly one person. `npm run fresh:accept` proves the
 * journeys; this is the static half, and it runs in seconds so it can sit in
 * the gate.
 *
 * It enforces user-level invariants, not implementation trivia — which is
 * §15's own wording, and the reason there is no rule here about how a script
 * is formatted.
 */
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CONTRACT } from '../src/fresh/contract.ts'
import { GRANT_PRODUCTION_PROJECT_REF } from '../src/fresh/forbidden.ts'

interface Finding {
  readonly rule: string
  readonly where: string
  readonly what: string
}

const findings: Finding[] = []
const note = (rule: string, where: string, what: string): void => {
  findings.push({ rule, where, what })
}

/**
 * Findings that are real and are somebody else's to fix.
 *
 * Printed every run, never silent, and never a failure. `web/studio` belongs to
 * the frontend workstream, and a gate this branch cannot make pass is a gate
 * somebody switches off — but a silent skip would be worse, because the next
 * person would have no way to know the rule had stopped applying there.
 */
const elsewhere: Finding[] = []
const noteElsewhere = (rule: string, where: string, what: string): void => {
  elsewhere.push({ rule, where, what })
}

/**
 * The code, with the comments taken out.
 *
 * CLAUDE.md: *"A COMMENT IS NOT A CALL, and a dangling-reference check cannot
 * tell the difference."* `supabase/functions/mcp/index.ts` explains, in prose,
 * that the function "does not own baujwlzcziasnfhhkchg.supabase.co" — which is
 * the rule being OBEYED, reported as the rule being broken. A check that points
 * somewhere, and somewhere wrong, is worse than a bare count.
 *
 * Removing text is the one way this could go quietly blind, so
 * `provedStripperCanStillSee` below plants a reference in code and requires it
 * to survive. Naive about strings containing `//`, which is the safe direction:
 * it keeps too much rather than too little.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*--.*$/gm, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

/**
 * CONTROL: the stripper must still be able to see a real reference.
 *
 * Runs every time, not once when it was written. A check that only ever
 * reported zero is indistinguishable from a check that cannot report anything.
 */
function provedStripperCanStillSee(): boolean {
  const planted =
    `// this line is a comment naming ${GRANT_PRODUCTION_PROJECT_REF}\n` +
    `const url = 'https://${GRANT_PRODUCTION_PROJECT_REF}.supabase.co'\n`
  const stripped = withoutComments(planted)
  return (
    stripped.includes(GRANT_PRODUCTION_PROJECT_REF) && !stripped.includes('this line is a comment')
  )
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path, out)
    else out.push(path)
  }
  return out
}

/**
 * Files allowed to name the development project.
 *
 * Not a count — a count goes stale the day somebody adds a file, and a stale
 * baseline is either a rule nobody can satisfy or a rule that stopped
 * checking. These are the places where naming it is the POINT: the deny list
 * that refuses it, the resolver that explains it, the scanner that hunts it,
 * and the documents about it.
 */
const MAY_NAME_IT = [
  'src/fresh/forbidden.ts',
  'src/fresh/project-ref.ts',
  'scripts/fresh/baseline.ts',
  'scripts/fresh/accept.ts',
  'scripts/fresh/doctor.ts',
  'scripts/check-fresh.ts',
  'docs/fresh-install/',
  'migrations/', // history is immutable; 0534 removed the live one
  'docs/', // historical records of this project's own setup
  '.github/',
  'tests/',
]

async function main(): Promise<void> {
  if (!provedStripperCanStillSee()) {
    console.error(
      'check:fresh — REFUSING TO RUN: the comment stripper can no longer see a reference ' +
        'in code, so every clean result it produces would be meaningless.',
    )
    process.exit(1)
  }

  const files = [
    ...(await walk('src')),
    ...(await walk('scripts')),
    ...(await walk('supabase')),
    ...(await walk('web')),
  ]

  // ---------------------------------------------------------------------
  // 1. No NEW code names the development project.
  // ---------------------------------------------------------------------
  for (const file of files) {
    if (MAY_NAME_IT.some((allowed) => file.startsWith(allowed))) continue
    if (!/\.(ts|js|mjs|sql|json)$/.test(file)) continue
    const text = withoutComments(await readFile(file, 'utf8'))
    if (!text.includes(GRANT_PRODUCTION_PROJECT_REF)) continue
    /*
      The 252 existing call sites are not a finding.

      They all write `process.env.SUPABASE_PROJECT_REF ?? '<ref>'`, the default
      is load-bearing for a session that starts with no environment, and
      rewriting them all would be a diff across the whole repository in the name
      of a person who does not exist yet. `resolveProjectRef` makes the fallback
      say so out loud; this rule stops the SHAPE spreading anywhere new.
    */
    const asDefault = /process\.env\.SUPABASE_PROJECT_REF\s*\?\?\s*'/.test(text)
    if (asDefault) continue
    const message =
      'names the development project other than as an env-var fallback. Use ' +
      'resolveProjectRef() from src/fresh/project-ref.ts.'
    if (file.startsWith('web/')) {
      /*
        The dashboard writes `window.HQ_API || '<the development gateway>'`, so
        a second person's deployed dashboard talks to this project's gateway
        unless something sets that global. It is a genuine fresh-install defect
        and `web/studio/**` is owned by claude/basecamp-team-hq, so it is
        recorded in docs/fresh-install/INTEGRATION-REQUESTS.md rather than
        changed here.
      */
      noteElsewhere('no-new-hardcoded-project', file, message)
      continue
    }
    note('no-new-hardcoded-project', file, message)
  }

  // ---------------------------------------------------------------------
  // 2. Every command the contract promises must exist.
  //
  // "An offer may only promise what the press can perform" — the defect this
  // repository keeps paying for. A setup document naming `npm run fresh:foo`
  // where no such script exists is that defect aimed at somebody on their
  // first day.
  // ---------------------------------------------------------------------
  const pkg: unknown = JSON.parse(await readFile('package.json', 'utf8'))
  const scripts =
    pkg !== null && typeof pkg === 'object' && 'scripts' in pkg
      ? ((pkg as { scripts: Record<string, string> }).scripts ?? {})
      : {}

  const promised = new Set<string>()
  for (const entry of CONTRACT) {
    const lines = [entry.automatedBy ?? '', ...(entry.human?.steps ?? [])]
    for (const line of lines) {
      for (const match of line.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
        if (match[1] !== undefined) promised.add(match[1])
      }
    }
  }
  for (const name of [...promised].sort()) {
    if (scripts[name] === undefined) {
      note(
        'promise-without-a-command',
        'src/fresh/contract.ts',
        `promises "npm run ${name}", which package.json does not define.`,
      )
    }
  }

  // ---------------------------------------------------------------------
  // 3. Every core entry must be verifiable, and say how strongly.
  // ---------------------------------------------------------------------
  for (const entry of CONTRACT) {
    if (entry.requirement !== 'REQUIRED_FOR_CORE') continue
    if (entry.human === undefined && entry.automatedBy === undefined) {
      note(
        'no-way-to-satisfy-it',
        'src/fresh/contract.ts',
        `"${entry.id}" is required for core and names neither a command nor human steps.`,
      )
    }
    if (entry.human !== undefined && entry.human.steps.length === 0) {
      note('human-step-without-steps', 'src/fresh/contract.ts', `"${entry.id}" has no steps.`)
    }
    if (entry.human !== undefined && !entry.human.steps.some((s) => s.includes('http'))) {
      note(
        'human-step-without-a-url',
        'src/fresh/contract.ts',
        `"${entry.id}" asks a person to go somewhere and does not say where. ` +
          'Grant: "include full instructions each and every time with URLs".',
      )
    }
  }

  // ---------------------------------------------------------------------
  // 4. SETUP.md must be what the contract would produce.
  //
  // §17 wants one obvious starting point; §6 wants one machine-readable source
  // of truth. Those pull apart the moment somebody edits the prose, and the
  // drift is invisible because both halves look fine. So the document is
  // generated and this is what stops them disagreeing.
  // ---------------------------------------------------------------------
  try {
    execFileSync('npx', ['tsx', 'scripts/fresh/docs.ts', '--check'], { stdio: 'pipe' })
  } catch {
    note(
      'setup-doc-has-drifted',
      'SETUP.md',
      'is not what src/fresh/contract.ts would produce. It is generated, so the ' +
        'fix is never to edit it: change the contract and run npm run fresh:docs.',
    )
  }

  // ---------------------------------------------------------------------
  // 5. The baseline must exist and must represent every migration.
  // ---------------------------------------------------------------------
  try {
    const meta: unknown = JSON.parse(await readFile('migrations/baseline/baseline.json', 'utf8'))
    const represents =
      meta !== null && typeof meta === 'object' && 'represents' in meta
        ? Number((meta as { represents: unknown }).represents)
        : -1
    const actual = (await readdir('migrations')).filter((n) => /^\d{4}_.*\.sql$/.test(n)).length
    if (represents !== actual) {
      note(
        'baseline-is-behind',
        'migrations/baseline/baseline.json',
        `the baseline represents ${represents} migrations and there are ${actual}. ` +
          'A fresh install would arrive missing the difference. Run: npm run fresh:baseline',
      )
    }
  } catch {
    note(
      'no-baseline',
      'migrations/baseline/',
      'there is no baseline, so a fresh install has nothing to install. Run: npm run fresh:baseline',
    )
  }

  // ---------------------------------------------------------------------

  if (elsewhere.length > 0) {
    console.log(`check:fresh — ${elsewhere.length} finding(s) owned by another workstream:\n`)
    for (const f of elsewhere) console.log(`  [${f.rule}] ${f.where}\n      ${f.what}\n`)
    console.log('  See docs/fresh-install/INTEGRATION-REQUESTS.md\n')
  }

  if (findings.length === 0) {
    console.log('check:fresh — clean')
    return
  }
  console.error(`check:fresh — ${findings.length} finding(s)\n`)
  for (const f of findings) console.error(`  [${f.rule}] ${f.where}\n      ${f.what}\n`)
  process.exit(1)
}

await main()
