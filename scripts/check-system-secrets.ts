/**
 * Every read of a human-integration credential goes through the deployment's one resolver (P1.2, #400).
 *
 *   npm run check:system-secrets      # production catalogue, read-only
 *
 * Two questions, because the first alone passes when a new secret is added and nobody classifies it:
 *   1. SOURCE: no file in src/ or supabase/functions/ reads a human-integration secret straight out of the
 *      vault, calls the retired `vault_secret`, or reads a name built at run time (bar the vault export);
 *   2. VAULT: every name the vault actually holds has a credential class (`app.credential_class`).
 *
 * ## Its own controls
 *
 * Found-nothing is the shape this repository keeps getting wrong, so before it believes "clean" it asserts it
 * scanned a non-empty set, and that the same predicate REFUSES five injected sources: a direct read of a Google
 * secret, a `vault_secret` call, a run-time name, a name nobody classified - and ACCEPTS the two it must (an
 * infrastructure read, and a human name that appears only in a comment).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ClassOf,
  type DirectRead,
  findDirectReads,
  findRetiredReaderCalls,
  violations,
} from '../src/credentials/direct-reads.ts'
import { ManagementApiExecutor } from '../src/db/executor.ts'

const ROOTS = ['src', 'supabase/functions']

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

export const scan = (): { reads: DirectRead[]; retired: { file: string; line: number }[] } => {
  const reads: DirectRead[] = []
  const retired: { file: string; line: number }[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      // The scanner's own patterns mention the retired reader by name; it is not a reader.
      if (file === 'src/credentials/direct-reads.ts') continue
      const text = readFileSync(file, 'utf8')
      reads.push(...findDirectReads(file, text))
      retired.push(...findRetiredReaderCalls(file, text))
    }
  }
  return { reads, retired }
}

/** Five injected sources: three must be refused, one unclassified refused, two accepted. */
export const controls = (classOf: ClassOf): { name: string; ok: boolean; detail: string }[] => {
  const probe = (src: string, file = 'src/x.ts') =>
    violations(findDirectReads(file, src), findRetiredReaderCalls(file, src), classOf)
  const cases: [string, string[], boolean][] = [
    [
      'a direct read of a Google secret',
      probe(
        "db.execute(`select decrypted_secret from vault.decrypted_secrets where name = 'google.refresh_token'`)",
      ),
      true,
    ],
    [
      'a call to the retired reader',
      probe("db.execute(`select app.vault_secret('google.refresh_token')`)"),
      true,
    ],
    [
      'a name built at run time',
      probe(
        'db.execute(`select decrypted_secret from vault.decrypted_secrets where name = ${lit(n)}`)',
      ),
      true,
    ],
    [
      'a name nobody classified',
      probe(
        "db.execute(`select decrypted_secret from vault.decrypted_secrets where name = 'mystery.token'`)",
      ),
      true,
    ],
    [
      'an infrastructure read (must be ACCEPTED)',
      probe(
        "db.execute(`select decrypted_secret from vault.decrypted_secrets where name = 'openrouter.api_key'`)",
      ),
      false,
    ],
    [
      'a human name only in a comment (must be ACCEPTED)',
      probe(
        "// reads vault.decrypted_secrets where name = 'google.refresh_token' - see the resolver\nconst x = 1",
      ),
      false,
    ],
  ]
  return cases.map(([name, found, shouldFire]) => ({
    name,
    ok: shouldFire ? found.length > 0 : found.length === 0,
    detail: found[0] ?? 'nothing raised',
  }))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
  if (token === '') {
    console.error('SUPABASE_ACCESS_TOKEN is required')
    process.exit(2)
  }
  const db = new ManagementApiExecutor(
    process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
    token,
  )
  const held = (
    await db.execute(
      `select s.name, app.credential_class(s.name) as class from vault.secrets s order by s.name`,
    )
  ).rows as { name: string; class: string | null }[]

  const { reads, retired } = scan()
  const classes = new Map<string, string | null>(held.map((h) => [h.name, h.class]))
  // A literal name the vault does not hold is still classified by the function.
  const wanted = new Set<string>()
  for (const r of reads) if (r.names !== 'dynamic') for (const n of r.names) wanted.add(n)
  const missing = [...wanted].filter((n) => !classes.has(n))
  if (missing.length > 0) {
    const asked = (
      await db.execute(
        `select n as name, app.credential_class(n) as class from unnest(array[${missing
          .map((n) => `'${n.replace(/'/g, "''")}'`)
          .join(',')}]) n`,
      )
    ).rows as { name: string; class: string | null }[]
    for (const a of asked) classes.set(a.name, a.class)
  }
  const classOf: ClassOf = (name) => classes.get(name) ?? null

  console.log(
    `scanned ${String(reads.length)} direct vault read(s) and ${String(retired.length)} retired-reader mention(s); the vault holds ${String(held.length)} secret(s)`,
  )
  const ctl = controls(classOf)
  for (const c of ctl) console.log(`control: ${c.name} -> ${c.ok ? 'ok' : 'WRONG'}: ${c.detail}`)
  if (reads.length === 0 || held.length === 0 || ctl.some((c) => !c.ok)) {
    console.log(
      'FAIL the check looked at nothing or a control did not behave, so clean would mean nothing',
    )
    process.exit(1)
  }

  const problems = [
    ...violations(reads, retired, classOf),
    ...held
      .filter((h) => h.class === null)
      .map((h) => `vault secret ${h.name} has no credential class`),
  ]
  if (problems.length > 0) {
    console.log(`FAIL ${String(problems.length)} problem(s):`)
    for (const p of problems.slice(0, 30)) console.log(`  ${p}`)
    process.exit(1)
  }
  console.log(
    'ok   every human-integration credential is read through the resolver, and every vault secret has a class',
  )
}
