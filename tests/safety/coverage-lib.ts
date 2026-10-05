/**
 * Static analysis for the production-access gate: which commands CAN reach production, and does each pass through the gate?
 *
 * Everything takes a `Fs` so the controls can run it over an in-memory tree and prove the detector can FAIL (a detector that
 * has only ever been shown a passing tree is the found-nothing shape this repository keeps recording).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

export type Fs = { read(path: string): string | null; list(dir: string): string[] }

export const realFs = (root: string): Fs => {
  const cache = new Map<string, string | null>()
  return {
    read: (p) => {
      const hit = cache.get(p)
      if (hit !== undefined) return hit
      const f = join(root, p)
      const text = existsSync(f) && statSync(f).isFile() ? readFileSync(f, 'utf8') : null
      cache.set(p, text)
      return text
    },
    list: (dir) => {
      const walk = (d: string): string[] =>
        readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`],
        )
      return existsSync(join(root, dir)) ? walk(dir) : []
    },
  }
}

/** Anything that names a production target or the credential for one. A mention in a comment still counts: over-inclusion is the safe direction. */
export const CONTACT =
  /ManagementApiExecutor|PgExecutor|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_URL|SERVICE_ROLE|api\.supabase\.com|\.supabase\.co|vercel\.app|functions\/v1/

/** Files that put the gate in a process. */
export const GATE_MODULES = [
  'src/safety/arm.ts',
  'src/safety/production-gate.ts',
  'src/safety/require-production-checks.ts',
  'src/safety/require-production-writes.ts',
  'src/safety/require-production-site.ts',
  'src/safety/require-production-if-targeted.ts',
  'src/safety/require-production-unless-replica.ts',
  'src/safety/require-production-when-live.ts',
  'src/db/executor.ts',
  'src/db/pg-executor.ts',
]

const IMPORT =
  /(?:import|export)[^'"`;]*?from\s*['"](\.[^'"]+)['"]|import\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g

const resolveSpec = (fs: Fs, from: string, spec: string): string | null => {
  const base = normalize(join(dirname(from), spec)).replace(/\\/g, '/')
  for (const c of [base, `${base}.ts`, `${base}/index.ts`])
    if (fs.read(c) !== null && c.endsWith('.ts')) return c
  return null
}

/** The set of repository files a script can load, itself included. */
export const closure = (fs: Fs, entry: string): Set<string> => {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const f = stack.pop() as string
    if (seen.has(f) || !f.endsWith('.ts')) continue
    const text = fs.read(f)
    if (text === null) continue
    seen.add(f)
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]
      const r = spec === undefined ? null : resolveSpec(fs, f, spec)
      if (r !== null) stack.push(r)
    }
  }
  return seen
}

export const reachesProduction = (fs: Fs, entry: string): boolean =>
  [...closure(fs, entry)].some((f) => CONTACT.test(fs.read(f) ?? ''))

export const hasGate = (fs: Fs, entry: string): boolean =>
  [...closure(fs, entry)].some((f) => GATE_MODULES.includes(f))

/** Entry files an npm command runs. `npm run x` chains are resolved by the caller through the script names. */
export const entriesOf = (command: string): string[] =>
  [...command.matchAll(/(?:tsx|bash|python3)\s+(scripts\/[\w./-]+)/g)].map((m) => m[1] as string)

export const npmRefs = (command: string): string[] =>
  [...command.matchAll(/npm run (?:--silent )?([\w:-]+)/g)].map((m) => m[1] as string)

/** The module specifier of the FIRST import statement in a file, which is what runs first. */
export const firstImport = (source: string): string | null => {
  const m = /^import\s+(?:[^'"\n]*?from\s*)?['"]([^'"]+)['"]/m.exec(source)
  return m?.[1] ?? null
}

export const firstImportIs = (source: string, ...modules: string[]): boolean => {
  const first = firstImport(source)
  return first !== null && modules.some((m) => first.endsWith(`safety/${m}.ts`))
}

export const relativeTo = (root: string, p: string): string => relative(root, p).replace(/\\/g, '/')
