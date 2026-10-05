/**
 * The `excludeFiles` pattern that keeps the static site out of the two Python function bundles, and a matcher for it.
 *
 * Measured (preview experiment, 5 October 2026, docs/performance/vercel-storage-audit-2026-10-05.md): every file the page
 * deployment uploads is also packed into each Python function, so the studio (5 MB, uploaded under `studio/` and again at the
 * root) is stored three times over. Excluding it took each bundle from 21.49 to 17.16 MiB (-20.2%) and changed no response.
 *
 * Why a brace pattern of extensions and directories, not a list of names: Vercel rejects an `excludeFiles` longer than 256
 * characters (found the hard way: 44 enumerated names, 455 characters, failed the build). Why it fails safe: a root file with an extension the
 * pattern does not name is simply left in the bundle (bigger, never broken); and `uncovered` reports it so the pattern can be
 * extended. What it must never match is a runtime file, which `tests/deploy/function-exclude.test.ts` asserts.
 */

/** Root-level studio copies by extension, then the studio's own directory and each root-level asset directory. */
export const EXCLUDE_GLOB =
  '{*.css,*.html,*.js,studio/**,bc/**,fonts/**,logos/**,samples/**,textures/**,vendor/**}'

/** Vercel's limit on the length of an `excludeFiles` value. */
export const MAX_EXCLUDE_LENGTH = 256

/** Files a function needs at run time. None of these may ever be excluded. */
export const RUNTIME_FILES = [
  'api/notebook.py',
  'api/notebook-act.py',
  'scripts/notebook/act.py',
  'requirements.txt',
  'vercel.json',
] as const

const alternatives = (glob: string): string[] =>
  glob.startsWith('{') && glob.endsWith('}') ? glob.slice(1, -1).split(',') : [glob]

/**
 * Does `glob` exclude `path`? Understands exactly the grammar used above: a brace set of `*.ext` (a root-level file with that
 * extension) and `dir/**` (anything under that directory). Anything else throws, so a pattern this cannot judge is never
 * silently treated as matching nothing.
 */
export function excludes(glob: string, path: string): boolean {
  return alternatives(glob).some((alt) => {
    if (/^\*\.[A-Za-z0-9]+$/.test(alt)) return !path.includes('/') && path.endsWith(alt.slice(1))
    if (/^[A-Za-z0-9._-]+\/\*\*$/.test(alt)) return path.startsWith(`${alt.slice(0, -2)}`)
    throw new Error(`unsupported excludeFiles alternative: ${alt}`)
  })
}

/** Uploaded paths that are not runtime files and that `glob` leaves in the bundle. */
export function uncovered(glob: string, uploaded: Iterable<string>): string[] {
  const runtime = new Set<string>(RUNTIME_FILES)
  return [...uploaded].filter((p) => !runtime.has(p) && !excludes(glob, p)).sort()
}
