/**
 * "learning my AI team" — a notebook of the whole repository.
 *
 *   npm run notebook:learning            # say what it would do
 *   npm run notebook:learning -- --go    # do it
 *
 * Issue #58. Grant, 11 September 2026:
 *
 *     "Create a new Google notebook. Call it learning my AI team. Upload to
 *      that notebook the complete documentation associated with my agentic team
 *      GitHub... relevant source code, documentation, original prompts,
 *      everything. And then I want you to instruct notebook to create an audio
 *      overview long one on the theme of setting this up, what to do, and how
 *      to make the best use out of it."
 *
 * ## "Complete" cannot mean every file, and pretending otherwise is the failure
 *
 * The repository is 190 migrations, ~50 handlers, ~90 scripts, two verbatim
 * specs, fifteen ADRs and CLAUDE.md. The notebook tier allows **50 sources**.
 * So a file-per-source upload gets 50 arbitrary files and stops, and the thing
 * he actually asked for — a notebook you could learn this system from — would
 * be missing whichever half the alphabet cut off.
 *
 * The selection is therefore the work, not the upload. Related files are
 * COMPOSED into one source each with a header saying what it is and why it is
 * here, so 50 sources carry the whole repository rather than a tenth of it.
 *
 * ## The prompts come first
 *
 * He said "original prompts" and those are the highest-value documents here:
 * the two verbatim specifications, the master spec, and the briefs captured
 * this week. They are what the system was built FROM, and a notebook that
 * spent its 50 slots on TypeScript would answer "how does this work" and not
 * "why is it like this". They are uploaded first so that if anything is cut,
 * it is the source code.
 *
 * ## Reproducible, not a one-off
 *
 * A script rather than a session, because #58 asks for it and because the
 * repository will move. Re-running adds what is new; it does not duplicate.
 */

import '../../src/safety/require-production-writes.ts'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotebookActions } from '../../src/notebook/actions.ts'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (token === undefined || token === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  token,
)

const go = process.argv.includes('--go')
const TITLE = 'learning my AI team'
const ROOT = process.cwd()

/*
  A notebook source has a size limit that nobody publishes, and a composed
  source of forty migrations would find it. 180k characters is well under what
  has worked and well over what any single group here needs; a group that
  exceeds it is split rather than truncated, because a source that stops
  mid-sentence teaches the notebook something false.
*/
const MAX_SOURCE = 180_000
const MAX_SOURCES = 50

interface Group {
  readonly name: string
  /** Why this is in the notebook. Becomes the source's opening paragraph. */
  readonly why: string
  readonly files: readonly string[]
}

/** Every file under a directory, sorted, filtered. */
async function walk(dir: string, keep: (p: string) => boolean): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', '.git', '.out', 'dist', 'vendor', 'fonts'].includes(e.name)) continue
      out.push(...(await walk(full, keep)))
    } else if (keep(full)) {
      out.push(full)
    }
  }
  return out.sort()
}

/*
  The order is the priority order.

  If the 50-source ceiling bites, it bites the bottom of this list — so the
  specifications, the standing brief and the decisions survive and the
  migrations are what gets cut. That is the right way round: the notebook is
  for learning the system, and the SQL is the least learnable and most
  replaceable part of it.
*/
async function groups(): Promise<Group[]> {
  const md = (p: string) => p.endsWith('.md')
  const ts = (p: string) => p.endsWith('.ts')

  const specs = await walk(join(ROOT, 'docs/spec'), md)
  const adrs = await walk(join(ROOT, 'docs/adr'), md)
  const docs = (await walk(join(ROOT, 'docs'), md)).filter(
    (p) => !specs.includes(p) && !adrs.includes(p),
  )
  const migrations = await walk(join(ROOT, 'migrations'), (p) => p.endsWith('.sql'))
  const handlers = await walk(join(ROOT, 'src/handlers'), ts)
  const src = (await walk(join(ROOT, 'src'), ts)).filter((p) => !handlers.includes(p))
  const scripts = await walk(join(ROOT, 'scripts'), ts)
  const web = await walk(join(ROOT, 'web'), (p) => /\.(html|css|js)$/.test(p))

  return [
    {
      name: 'The standing brief — how to work on this system',
      why:
        'CLAUDE.md is the first thing anyone picks this project up with. It is ' +
        "Grant's own standing instructions, the hard constraints, and the traps " +
        'the repository has already fallen into. Read it before anything else.',
      files: [join(ROOT, 'CLAUDE.md')],
    },
    {
      name: 'The original prompts and specifications',
      why:
        "What the system was built FROM, in Grant's own words and unedited. The " +
        'project dashboard information architecture, the frontend build prompt, ' +
        'and the briefs he gave for bot intelligence and for instructing the ' +
        'office directly. These are the source of truth for intent; everything ' +
        'else is an implementation of them.',
      files: [join(ROOT, 'AI_TEAM_HQ_MASTER_SPEC.md'), ...specs],
    },
    {
      name: 'Decisions, and why each was made',
      why:
        'The architecture decision records. Each one exists because a future ' +
        'reader could otherwise reverse it by accident, so they are the answer ' +
        'to "why is it like this" rather than "how does it work".',
      files: adrs,
    },
    {
      name: 'Where the project stands, and how it is put together',
      why: 'The handover, the integration assessment, the architecture notes and the testing record.',
      files: docs,
    },
    {
      name: 'The agents themselves — what each one does',
      why:
        'The job handlers. One file per kind of work the office can do, which ' +
        'is the most direct answer to "what can this team actually do for me".',
      files: handlers,
    },
    {
      name: 'The engine — queue, channels, providers, text',
      why:
        'The job queue and its state machine, the channel adapters that may only ' +
        'translate, the model router, and how an agent is given a voice.',
      files: src,
    },
    {
      name: 'The database — every migration in order',
      why:
        'The schema, as it was built, in order, with the reasoning in the ' +
        'comments. Most of the interesting work in this system happens in ' +
        'Postgres, so this is where the behaviour actually lives.',
      files: migrations,
    },
    {
      name: 'The dashboard and the studio',
      why:
        'Two hand-written HTML files, deliberately: no React, no bundler, no ' +
        'build step (ADR-0002, ADR-0011).',
      files: web,
    },
    {
      name: 'Operations — deploying, verifying, backing up',
      why:
        'Every script the office is run and checked with. The verification ' +
        'suites are the most useful part: each one states a property the system ' +
        'is supposed to have, and exercises it rather than asserting it.',
      files: scripts,
    },
  ]
}

/** One group, composed into as many sources as it needs. */
async function compose(g: Group): Promise<{ title: string; text: string }[]> {
  const parts: { title: string; text: string }[] = []
  let body = ''
  let n = 1

  const flush = () => {
    if (body.trim() === '') return
    const title = parts.length === 0 && body.length < MAX_SOURCE ? g.name : `${g.name} (${n})`
    parts.push({
      title,
      // The "why" leads every part, so a source retrieved on its own still
      // says what it is. A notebook quotes sources without their context.
      text: `# ${title}\n\n${g.why}\n\n${body}`,
    })
    body = ''
    n += 1
  }

  for (const f of g.files) {
    const rel = relative(ROOT, f)
    const size = (await stat(f)).size
    if (size > MAX_SOURCE) {
      console.log(`  skipping ${rel} — ${String(Math.round(size / 1024))}kb, too large alone`)
      continue
    }
    const text = await readFile(f, 'utf8')
    const chunk = `\n\n---\n\n## ${rel}\n\n${text}`
    if (body.length + chunk.length > MAX_SOURCE) flush()
    body += chunk
  }
  flush()
  return parts
}

// --- go ----------------------------------------------------------------------

const gs = await groups()
const planned: { title: string; text: string }[] = []
for (const g of gs) {
  const parts = await compose(g)
  planned.push(...parts)
  console.log(`${g.name} — ${String(g.files.length)} file(s) → ${String(parts.length)} source(s)`)
}

console.log(
  `\n${String(planned.length)} sources, ${String(
    Math.round(planned.reduce((n, p) => n + p.text.length, 0) / 1024),
  )}kb total. The tier allows ${String(MAX_SOURCES)}.`,
)

if (planned.length > MAX_SOURCES) {
  // The priority order above exists for this moment. Cutting from the end
  // keeps the specifications and drops the SQL, which is the right way round.
  console.log(`Trimming to ${String(MAX_SOURCES)}; the last groups are the ones cut.`)
  planned.length = MAX_SOURCES
}

if (!go) {
  console.log('\nDry run. Nothing was created. Re-run with --go.')
  process.exit(0)
}

const actions = await NotebookActions.fromVault(db)
if (actions === null) {
  console.error('no notebook credential in the vault — see npm run notebook:bootstrap')
  process.exit(1)
}

/*
  Re-running must not make a second notebook of the same name.

  Grant: *"please don't assume I wish to create a new project — this is a large
  task and should always be confirmed."* A notebook is not a project, but the
  same reasoning applies to anything this expensive to undo, and a duplicate
  called "learning my AI team" would be worse than useless.
*/
const existing = (await actions.notebooks()).find(
  (n) => n.title.trim().toLowerCase() === TITLE.toLowerCase(),
)
const notebook = existing ?? (await actions.createNotebook(TITLE))
console.log(`\n${existing === undefined ? 'created' : 'using existing'} notebook ${notebook.id}`)

// What is already in it, so a re-run tops up rather than duplicates.
const have = new Set(
  (await actions.sources(notebook.id, false)).map((s) => String(s.title ?? '').trim()),
)

let added = 0
for (const p of planned) {
  if (have.has(p.title)) {
    console.log(`  already there: ${p.title}`)
    continue
  }
  const id = await actions.addText(notebook.id, p.text, p.title)
  console.log(`  added ${p.title} — ${id === null ? 'no id returned' : id}`)
  added += 1
}
console.log(`\n${String(added)} source(s) added.`)

/*
  The audio overview.

  "long one on the theme of setting this up, what to do, and how to make the
  best use out of it" — his words, and the instructions say all three because
  an audio overview given no steer produces a summary of the documents rather
  than the guide he asked for.
*/
const INSTRUCTIONS =
  'Make a LONG, in-depth audio overview — the extended format, not the short one. ' +
  'The audience is Grant Rogers, who owns this system and is not a programmer. ' +
  'Theme it on three things, in this order: how this agentic team is set up and ' +
  'what the pieces are; what he should actually do with it day to day; and how to ' +
  'get the very best out of it, including the things it can do that he probably ' +
  'has not realised. Draw the intent from the specification and brief documents, ' +
  'which are in his own words, and use the code and migrations only as evidence ' +
  'for how something really behaves. Be concrete and name real features. Do not ' +
  'read out file listings.'

const gen = await actions.generate(notebook.id, 'audio', INSTRUCTIONS)
console.log(`audio overview started — task ${gen.taskId ?? 'unknown'}, ${gen.state}`)
console.log(
  '\nIt takes several minutes. Follow it with:\n' +
    `  npm run notebook:probe -- --artifacts ${notebook.id}`,
)
