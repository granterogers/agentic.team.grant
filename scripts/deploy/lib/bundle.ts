/**
 * The import graph an edge function is uploaded with.
 *
 * `deploy:worker` has always uploaded every file its entrypoint imports, at the repository's own
 * layout, so the uploaded copy is the tested copy. `voice` and `voice-token` were uploaded as one
 * file each, which is why they could not share anything and `voice` carried a private copy of the
 * session check that `voice-token` did without (#400). They bundle the same way now.
 *
 * What counts as an import is decided by TypeScript's own scanner, not by a pattern: a pattern that
 * knew only `from '...'` missed the bare side-effect import `import '../safety/arm.ts'`, so the
 * worker was uploaded without a file it needs and the platform refused the bundle AFTER the
 * deploy script had already reset the function's secrets (6 October 2026). The scanner reads
 * every form (`import x from`, `import '...'`, `export ... from`, `import('...')`) and ignores
 * comments and string contents.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

/** A bundle that cannot be deployed, found locally. The message says which file and which import. */
export class BundleError extends Error {}

/** Every local (relative) module specifier a source file imports, in any form, once each. */
export const localImports = (source: string): string[] => {
  const found = ts.preProcessFile(source, true, true)
  const specs = new Set<string>()
  for (const imp of found.importedFiles) {
    // Only relative specifiers are ours to upload. A bare specifier is a Deno remote, an `npm:` or
    // `jsr:` package or a built-in, which the platform resolves itself.
    if (imp.fileName.startsWith('.')) specs.add(imp.fileName)
  }
  return [...specs]
}

/**
 * Every relative import, transitively, as absolute path -> source.
 *
 * A local import that does not resolve to a file is an error naming the importer and the specifier,
 * not a bare ENOENT, so the person reading it knows what to fix.
 */
export const walk = async (
  file: string,
  found = new Map<string, string>(),
  importer?: { file: string; spec: string },
): Promise<Map<string, string>> => {
  const abs = path.resolve(file)
  if (found.has(abs)) return found
  let source: string
  try {
    source = await readFile(abs, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    throw new BundleError(
      importer === undefined
        ? `the entrypoint ${bundlePath(abs)} does not exist`
        : `${bundlePath(importer.file)} imports '${importer.spec}', which does not exist (${bundlePath(abs)})`,
    )
  }
  found.set(abs, source)
  for (const spec of localImports(source)) {
    await walk(path.resolve(path.dirname(abs), spec), found, { file: abs, spec })
  }
  return found
}

/** Where a file goes in the bundle: the repository's own layout, so no import is rewritten. */
export const bundlePath = (abs: string): string => path.relative(process.cwd(), abs)

/**
 * Does the bundle, AS UPLOADED, contain everything its files import?
 *
 * Checked in the platform's frame (the uploaded names), not the file system's, because that is the
 * frame in which the platform resolves a specifier. Returns one sentence per problem; empty means
 * closed. It is also what a hand-listed upload (hq-api) is checked with.
 */
export const closureProblems = (files: ReadonlyMap<string, string>): string[] => {
  const problems: string[] = []
  const names = new Set(files.keys())
  for (const [name, source] of files) {
    if (name.startsWith('/') || name.split('/').includes('..')) {
      problems.push(`${name} is outside the bundle root, so it cannot be uploaded at that path`)
      continue
    }
    for (const spec of localImports(source)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec))
      if (!names.has(target))
        problems.push(`${name} imports '${spec}', but ${target} is not in the bundle`)
    }
  }
  return problems
}

export type PreparedBundle = {
  /** bundle path -> source, in the layout the platform will see */
  files: Map<string, string>
  form: FormData
}

/**
 * Resolve, validate and build a function's upload WITHOUT touching production.
 *
 * Throws BundleError for everything that can be known locally: an import that resolves to no file,
 * a file the platform could not place, an entrypoint that is not in the bundle. What this cannot
 * know is what only the platform decides (its own bundler's resolution of remote and `npm:`
 * specifiers, size limits, whether it accepts the request), and a deploy script must therefore
 * keep every production write AFTER this returns.
 */
export const prepareBundle = async (slug: string, entry: string): Promise<PreparedBundle> => {
  const abs = await walk(entry)
  const files = new Map<string, string>()
  for (const [file, source] of abs) files.set(bundlePath(file), source)
  const entryName = bundlePath(path.resolve(entry))
  if (!files.has(entryName))
    throw new BundleError(`the entrypoint ${entryName} is not in the bundle`)
  const problems = closureProblems(files)
  if (problems.length > 0) {
    throw new BundleError(`the ${slug} bundle is not closed:\n  - ${problems.join('\n  - ')}`)
  }
  const form = new FormData()
  form.append(
    'metadata',
    // No JWT: each function authorises its own callers (the HQ bearer or a signed-in session).
    JSON.stringify({ name: slug, entrypoint_path: entry, verify_jwt: false }),
  )
  for (const [name, source] of files) {
    form.append('file', new File([source], name, { type: 'application/typescript' }))
  }
  return { files, form }
}

/** The multipart form for a function deploy: metadata plus every file in the import graph. */
export const bundleForm = async (
  slug: string,
  entry: string,
): Promise<{ form: FormData; files: number }> => {
  const prepared = await prepareBundle(slug, entry)
  return { form: prepared.form, files: prepared.files.size }
}
