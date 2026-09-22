/**
 * BUILD THE FRESH-INSTALL BASELINE.
 *
 *   npm run fresh:baseline
 *
 * ## Why a baseline exists
 *
 * `migrations/` is two things at once: the append-only record of how Grant's
 * database became what it is, and the only installer a new user has. It is
 * excellent as a record and cannot work as an installer, because nine of its
 * migrations assert facts about his DATA — a project called "Legacy Coaching
 * Course" holding material, a chat that has received real deliveries, at least
 * a hundred harness deliveries that escaped before a guard existed. No
 * credential, account or configuration produces those. Only running the system
 * for months does. That is F-002, and it cannot be repaired in place: applied
 * migrations are immutable and checksum-enforced, and a forward-only fix cannot
 * help a run that dies at migration 54 of 533.
 *
 * So the two roles are separated. `migrations/` is untouched. This builds the
 * other half: the schema as it stands after all 533, as STRUCTURE plus the seed
 * data that is genuinely part of the product, with everything belonging to
 * Grant left out — and a scan that FAILS the build if any of it got through.
 *
 * ## How it works
 *
 *   1. `npm run fresh:zero-state -- --preconditions` builds a scaffold database
 *      by replaying the whole corpus, standing in for Grant's data where a
 *      migration demands it.
 *   2. `pg_dump --schema-only` captures the structure.
 *   3. `pg_dump --data-only` captures ONLY the allow-listed product tables.
 *   4. Everything written is scanned for Grant's identifiers. A hit is a failed
 *      build, not a warning.
 *
 * The allow-list is an allow-list on purpose. A deny-list would ship whatever
 * a future migration seeds that nobody remembered to exclude, and the failure
 * direction of that mistake is "a stranger's data in a new user's database".
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { GRANT_PRODUCTION_PROJECT_REF, HARNESS_DB_PREFIX } from '../../src/fresh/forbidden.ts'

const DB = `${HARNESS_DB_PREFIX}baseline`
const OUT = 'migrations/baseline'

/**
 * Tables whose rows ARE the product.
 *
 * Every one of these is a list the office needs in order to be itself: who the
 * staff are, which connectors exist, what each tool is for, what an autonomy
 * level permits. None of it is about any particular person. Anything not named
 * here is left out, including tables that are empty today — an empty table and
 * an excluded one are the same file, and the list should say what was intended.
 */
const PRODUCT_SEED: readonly string[] = [
  'public.staff',
  'public.staff_prompts',
  'public.staff_tools',
  'public.tool_permissions',
  'public.knowledge_connectors',
  'public.connector_capabilities',
  'public.responsibilities',
  'public.job_kind_needs',
  'public.output_shapes',
  'public.asset_actions',
  'public.autonomy_policy',
  // `public.eval_cases` is deliberately NOT here. It is the grading corpus —
  // DEV_ONLY by the §4 classification, useless to somebody trying to send their
  // first instruction — and its prose names Grant's own projects, so including
  // it would put "Legacy Coaching Course" in a stranger's database to no end.
  'public.breadth_dimensions',
  'public.icon_defaults',
  'public.model_prices',
  'public.provider_models',
  'public.providers',
  'public.google_services',
  'public.self_improvement_kinds',
  'public.notebook_operation_cost',
  'public.ci_workflows',
  'public.contact_labels',
  'public.system_config',
]

/**
 * Anything in the dump matching one of these is Grant's, and finding one is a
 * failed build.
 *
 * Structural where it can be (a Telegram chat id is nine or ten digits and the
 * office has exactly one real one) and literal where the value is the only
 * thing that identifies it. CLAUDE.md's rule is to assert the property rather
 * than the artefact — which applies to a check that must keep working as the
 * product grows. This one is the opposite case: it must catch what is known to
 * exist TODAY, and a miss costs a stranger's identifiers in a new user's
 * database.
 */
const CONTAMINATION: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "Grant's Supabase project ref", pattern: new RegExp(GRANT_PRODUCTION_PROJECT_REF) },
  { name: "Grant's Telegram chat id", pattern: /\b1386648496\b/ },
  { name: "Grant's Slack user id", pattern: /\bU0BUNF6AALC\b/ },
  { name: "Grant's Slack team id", pattern: /\bT0BUCJ2L5FD\b/ },
  { name: 'a Telegram bot username', pattern: /\batg_[a-z]+_bot\b/ },
  { name: "one of Grant's Telegram bot ids", pattern: /\b8(?:967954396|842154625|883385300|965090661|800409793|301012441)\b/ },
  { name: 'the name of one of his projects', pattern: /Legacy Coaching Course/i },
  { name: 'scaffolding the baseline build invented', pattern: /fresh-install-scaffold|baseline-scaffold|PLACEHOLDER-NOT-A-CREDENTIAL/ },
]

function pgDump(args: readonly string[]): string {
  const raw = execFileSync('su', ['postgres', '-c', `pg_dump ${args.join(' ')} ${DB}`], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  /*
    Strip psql meta-commands, because the consumer is a driver.

    pg_dump 16 wraps its output in `\restrict` / `\unrestrict`, which tell psql
    to refuse the meta-commands a hostile dump might carry. They are psql
    directives, not SQL, so `npm run fresh:install` — which applies this over
    the Management API or the wire protocol, never through psql — died on
    `42601: syntax error at or near "\"`, an error naming the one character in
    the file that is not a mistake.

    What is given up is psql's protection against a dump somebody else wrote.
    That protection is not what is guarding this file: the baseline is generated
    by this script from a database this script built, and every byte of it is
    scanned before it is written. A dump from an untrusted source should never
    be applied by this path at all, with or without the directive.
  */
  return raw
    .split('\n')
    .filter((line) => !/^\\(restrict|unrestrict)\b/.test(line))
    /*
      `public` always already exists.

      Every Postgres database is created with it, and Supabase's is where
      PostgREST looks — so a bare `CREATE SCHEMA public;` fails with 42P06 on
      every target this baseline could ever be applied to. pg_dump emits it
      because it is describing a schema it found, not writing an installer.
    */
    .map((line) => line.replace(/^CREATE SCHEMA (?!IF NOT EXISTS)/, 'CREATE SCHEMA IF NOT EXISTS '))
    .join('\n')
}

function scan(label: string, text: string): string[] {
  const found: string[] = []
  const lines = text.split('\n')
  for (const { name, pattern } of CONTAMINATION) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? ''
      const hit = new RegExp(pattern.source, pattern.flags).exec(line)
      if (hit === null) continue
      /*
        Print what was MATCHED, not only where.

        CLAUDE.md: "A report line must print the message it actually got, never
        one you decided in advance." A bare line number in a forty-thousand-line
        dump sends somebody to open the file; the matched text plus its
        surroundings usually says what to do without opening anything. The
        window is trimmed because some of these lines are a whole function body.
      */
      const from = Math.max(0, hit.index - 40)
      const excerpt = line.slice(from, hit.index + hit[0].length + 60).replace(/\s+/g, ' ')
      found.push(`${label}:${i + 1} — ${name}\n      …${excerpt}…`)
      break // one report per pattern; the first is enough to act on
    }
  }
  return found
}

async function main(): Promise<void> {
  console.log('building the scaffold database by replaying the whole corpus…')
  execFileSync(
    'npx',
    ['tsx', 'scripts/fresh/zero-state.ts', '--preconditions', '--keep'],
    { env: { ...process.env, FRESH_DB: DB }, stdio: 'inherit' },
  )

  console.log('\ncapturing structure…')
  const schema = pgDump([
    '--schema-only',
    '--no-owner',
    // Privileges ARE kept: the grants to anon/authenticated/service_role are
    // not decoration, they are how §6's append-only ledger is enforced.
    '--schema=app',
    '--schema=public',
  ])

  /*
    Neutralise the per-install values before capturing the seed.

    `system_config` is a product table — the office genuinely needs its
    thresholds, intervals and policy — and a handful of its keys are not policy
    at all but Grant's own infrastructure: which Supabase project, which Slack
    user, where his avatars are served from, where Google sends him back. Those
    belong to an INSTALL, not to the product, and shipping them would point a
    new user's office at his.

    Blanked rather than deleted. A key that is absent looks like a key nobody
    thought of; a key that is present and empty is a question the setup can ask,
    and `npm run fresh:doctor` reads exactly these to say what is still missing.
  */
  console.log('neutralising per-install configuration…')
  execFileSync('su', [
    'postgres',
    '-c',
    `psql -q -v ON_ERROR_STOP=1 -d ${DB} -f ${process.cwd()}/scripts/fresh/sql/neutralise.sql`,
  ])

  console.log('capturing product seed…')
  const seed = pgDump([
    '--data-only',
    '--no-owner',
    /*
      INSERTs, not COPY.

      pg_dump's default data format is `COPY ... FROM stdin` terminated by a
      `\.` line, and those backslash lines are psql META-COMMANDS, not SQL. psql
      reads them; a database driver cannot. The seed would have been unusable by
      the very thing that installs it, and it announced itself as
      `42601: syntax error at or near "\"` — an error naming a backslash, in a
      file whose backslash is the one thing that is not a mistake.

      Slower to apply and larger on disk, and neither matters for 92KB applied
      once. Batched so the file is a few hundred statements rather than 3,000.
    */
    '--inserts',
    '--rows-per-insert=200',
    /*
      Do not re-fire triggers while restoring data.

      `system_config` has a trigger refusing a key that begins with a schema
      name — *"a function reading 'vault.naming' makes verify:schema report a
      dangling reference to a relation that does not exist"* — and the office's
      own `vault.naming` key predates it. So the seed contains a row that the
      live database holds happily and that could not be written today, and
      replaying it as an ordinary INSERT is refused.

      That is the general case, not one row: these triggers exist to govern
      what a PERSON or a HANDLER may write, and a restore is neither. pg_dump
      has `--disable-triggers` for exactly this and it is what a restore does.

      It needs to own the tables, which is true of `postgres` on Supabase and of
      the harness role locally. If a future target cannot, the seed will say so
      loudly rather than silently skipping rows.
    */
    '--disable-triggers',
    ...PRODUCT_SEED.map((t) => `--table=${t}`),
  ])

  const findings = [...scan('schema.sql', schema), ...scan('seed.sql', seed)]
  await mkdir(OUT, { recursive: true })

  const migrations = (await readdir('migrations'))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n))
    .sort()

  if (findings.length > 0) {
    console.error(`\nBASELINE REFUSED — ${findings.length} contamination finding(s):`)
    for (const f of findings) console.error(`  ${f}`)
    console.error(
      '\nNothing was written. A baseline carrying somebody else\'s identifiers is ' +
        'worse than no baseline, because it would be installed without being read.',
    )
    process.exit(1)
  }

  await writeFile(join(OUT, 'schema.sql'), schema, 'utf8')
  await writeFile(join(OUT, 'seed.sql'), seed, 'utf8')
  await writeFile(
    join(OUT, 'baseline.json'),
    `${JSON.stringify(
      {
        note:
          'The schema as it stands after every migration listed here, captured as ' +
          'structure plus product seed. Built by npm run fresh:baseline; never edited ' +
          'by hand. A fresh install applies this instead of replaying the corpus, ' +
          'because nine migrations assert the contents of Grant\'s database (F-002).',
        builtAt: new Date().toISOString(),
        represents: migrations.length,
        through: migrations[migrations.length - 1] ?? null,
        migrations,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  console.log(
    `\nBASELINE BUILT — ${migrations.length} migrations, ` +
      `${(schema.length / 1024).toFixed(0)}KB structure, ${(seed.length / 1024).toFixed(0)}KB seed, ` +
      'no contamination found',
  )
}

await main()
