/**
 * The file set a Team HQ page deployment uploads, defined ONCE.
 *
 * `deploy:hq` and `deploy:hq-page` each build this set by hand today ("the SAME file set with the same rules", says the
 * second one's header), which is how two copies drift. The fingerprint that decides whether a redeploy can be skipped must be
 * computed over exactly what would be uploaded, so it reads the set from here; `tests/deploy/page-fingerprint.test.ts` fails
 * if either deploy script's own list stops matching this one.
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** [path in the deployment, path in the repository]. */
export const FIXED_PAGE_FILES: readonly (readonly [string, string])[] = [
  ['index.html', 'web/studio/index.html'],
  ['api/notebook.py', 'api/notebook.py'],
  ['api/notebook-act.py', 'api/notebook-act.py'],
  ['scripts/notebook/act.py', 'scripts/notebook/act.py'],
  ['requirements.txt', 'requirements.txt'],
  ['vercel.json', 'vercel.json'],
]

export const STUDIO_ROOT = 'web/studio'

/** Source photographs that exist only to be re-tuned; never uploaded. */
export const SKIP_DIRS: ReadonlySet<string> = new Set(['raw'])

export interface UploadFile {
  file: string
  sha: string
  size: number
}

/**
 * Every file a page deployment uploads, keyed by its path in the deployment. Each studio file goes up twice (under `studio/`
 * and at the root, because the page is served at `/`), except `index.html`, which is already a fixed entry at the root.
 */
export async function collectPageFiles(
  root = '.',
  /**
   * The studio folder to send, when it is not `web/studio` under `root`: a STAGED tree (the live bytes plus one change, which
   * `hq-page-delta.ts --root=` takes) is named here. It replaces the folder, including `index.html`, and nothing else.
   */
  studioDir?: string,
): Promise<Map<string, Buffer>> {
  const studio = studioDir ?? join(root, STUDIO_ROOT)
  const files = new Map<string, Buffer>()
  for (const [name, path] of FIXED_PAGE_FILES) {
    files.set(
      name,
      await readFile(name === 'index.html' ? join(studio, 'index.html') : join(root, path)),
    )
  }
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full)
        continue
      }
      const rel = relative(studio, full).split('\\').join('/')
      const body = await readFile(full)
      files.set(`studio/${rel}`, body)
      if (rel !== 'index.html') files.set(rel, body)
    }
  }
  await walk(studio)
  return files
}

const sha1 = (b: Buffer): string => createHash('sha1').update(b).digest('hex')

/** The shape Vercel's deployment API takes: path, content digest, size. Sorted so order never matters. */
export function toUploadList(files: ReadonlyMap<string, Buffer>): UploadFile[] {
  return [...files]
    .map(([file, body]) => ({ file, sha: sha1(body), size: body.length }))
    .sort((a, b) => a.file.localeCompare(b.file))
}
