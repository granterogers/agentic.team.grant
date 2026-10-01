/**
 * The import graph an edge function is uploaded with.
 *
 * `deploy:worker` has always uploaded every file its entrypoint imports, at the repository's own
 * layout, so the uploaded copy is the tested copy. `voice` and `voice-token` were uploaded as one
 * file each, which is why they could not share anything and `voice` carried a private copy of the
 * session check that `voice-token` did without (#400). They bundle the same way now.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Every relative import, transitively.
 *
 * Only relative specifiers are followed: a bare specifier is a Deno remote or a built-in and is not
 * ours to upload. Both `import` and `export ... from` count.
 */
export const walk = async (
  file: string,
  found = new Map<string, string>(),
): Promise<Map<string, string>> => {
  const abs = path.resolve(file)
  if (found.has(abs)) return found
  const source = await readFile(abs, 'utf8')
  found.set(abs, source)
  for (const match of source.matchAll(/\bfrom\s+'(\.[^']+)'/g)) {
    const spec = match[1]
    if (spec === undefined) continue
    await walk(path.resolve(path.dirname(abs), spec), found)
  }
  return found
}

/** Where a file goes in the bundle: the repository's own layout, so no import is rewritten. */
export const bundlePath = (abs: string): string => path.relative(process.cwd(), abs)

/** The multipart form for a function deploy: metadata plus every file in the import graph. */
export const bundleForm = async (
  slug: string,
  entry: string,
): Promise<{ form: FormData; files: number }> => {
  const files = await walk(entry)
  const form = new FormData()
  form.append(
    'metadata',
    // No JWT: each function authorises its own callers (the HQ bearer or a signed-in session).
    JSON.stringify({ name: slug, entrypoint_path: entry, verify_jwt: false }),
  )
  for (const [abs, source] of files) {
    form.append('file', new File([source], bundlePath(abs), { type: 'application/typescript' }))
  }
  return { form, files: files.size }
}
