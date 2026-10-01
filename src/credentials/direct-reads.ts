/**
 * Finding the places that read a vault secret without going through the deployment's resolver (P1.2, #400).
 *
 * Pure, so a control can run an injected source through the same predicate the gate uses. The classes come from
 * the DATABASE (`app.credential_class`, 0648); this module knows nothing about which name is which.
 *
 * What it reads, and what it deliberately does not:
 *   - COMMENTS ARE STRIPPED FIRST. `google.refresh_token` in an explanation of why a read is guarded is not a
 *     read; the repository has recorded a check that could not tell the two apart more than once;
 *   - a direct read is a `vault.decrypted_secrets` select. A literal `name = '...'` or `name in ('...')` yields
 *     names; a name built at run time yields 'dynamic', which only an allow-listed file may do;
 *   - `vault_secret` in any form is a violation: the function was retired, and a call to it is either dead or
 *     a path around the resolver.
 */

export type DirectRead = {
  readonly file: string
  readonly line: number
  readonly names: readonly string[] | 'dynamic'
}

const stripComments = (source: string): string =>
  source
    // Block comments, keeping newlines so line numbers stay true.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // Line comments, and SQL comments inside template literals.
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (_m, pre: string) => pre)
    .replace(/--[^\n`]*/g, (m) => ' '.repeat(m.length))

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length

export const findDirectReads = (file: string, raw: string): DirectRead[] => {
  const source = stripComments(raw)
  const reads: DirectRead[] = []
  for (const m of source.matchAll(/vault\.decrypted_secrets/g)) {
    const at = m.index ?? 0
    const window = source.slice(at, at + 260)
    const literal = window.match(/\bname\s*=\s*'([^']+)'/)
    const list = window.match(/\bname\s+in\s*\(([^)]*)\)/)
    let names: string[] | 'dynamic'
    if (list?.[1] !== undefined && !list[1].includes('${')) {
      names = [...list[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as string)
    } else if (literal?.[1] !== undefined) {
      names = [literal[1]]
    } else {
      names = 'dynamic'
    }
    reads.push({ file, line: lineOf(source, at), names })
  }
  return reads
}

export const findRetiredReaderCalls = (
  file: string,
  raw: string,
): { file: string; line: number }[] => {
  const source = stripComments(raw)
  return [...source.matchAll(/\bvault_secret\b(?!_ref)/g)].map((m) => ({
    file,
    line: lineOf(source, m.index ?? 0),
  }))
}

/** Files allowed to read a name nobody can predict, with the reason. */
export const DYNAMIC_ALLOWED: Readonly<Record<string, string>> = {
  'src/handlers/vault-export.ts':
    'the operator-sealed export of the WHOLE vault; a disabled duty no conversation can start',
}

export type ClassOf = (name: string) => string | null

export const violations = (
  reads: readonly DirectRead[],
  retired: readonly { file: string; line: number }[],
  classOf: ClassOf,
): string[] => {
  const out: string[] = []
  for (const r of retired) {
    out.push(`${r.file}:${String(r.line)} calls vault_secret, which is retired - use the resolver`)
  }
  for (const r of reads) {
    if (r.names === 'dynamic') {
      if (DYNAMIC_ALLOWED[r.file] === undefined) {
        out.push(`${r.file}:${String(r.line)} reads a vault secret by a name built at run time`)
      }
      continue
    }
    for (const name of r.names) {
      const cls = classOf(name)
      if (cls === 'human_integration') {
        out.push(
          `${r.file}:${String(r.line)} reads the human-integration secret ${name} directly - use readCredential / credentialSql`,
        )
      } else if (cls === null) {
        out.push(`${r.file}:${String(r.line)} reads ${name}, which has no credential class (0648)`)
      }
    }
  }
  return out
}
