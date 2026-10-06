/**
 * Turn a captured function directory (scripts/forensics/capture-functions.ts) into the request that puts it back.
 *
 * Pure and local: it reads files and builds a `FormData`, it never touches the network. That is what lets the plan be
 * checked, and tested, without a deploy. The request it describes is the one every `deploy:*` script already sends
 * (`POST /v1/projects/{ref}/functions/deploy?slug=…`, a `metadata` part and one `file` part per source), so the
 * restore path is the deploy path with the bytes taken from the capture instead of from the working tree.
 *
 * Every file is re-hashed against `RESTORE.json` first. A directory whose contents changed since the capture is refused.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type RestoreRow = {
  slug: string
  version: number
  verify_jwt: boolean
  entrypoint: string
  npm_redirects?: string[]
  files: { path: string; bytes: number; sha256: string }[]
}

export type RestorePlan = {
  slug: string
  capturedVersion: number
  entrypoint: string
  verifyJwt: boolean
  files: { path: string; bytes: number }[]
  npmDependencies: string[]
  form: FormData
}

export class RestoreRefusal extends Error {}

export const buildRestorePlan = (dir: string): RestorePlan => {
  const row = JSON.parse(readFileSync(join(dir, 'RESTORE.json'), 'utf8')) as RestoreRow
  if (row.files.length === 0)
    throw new RestoreRefusal(`${row.slug}: the capture holds no source files`)
  if (!row.files.some((f) => f.path === row.entrypoint)) {
    throw new RestoreRefusal(
      `${row.slug}: the entrypoint ${row.entrypoint} is not among the captured files`,
    )
  }
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({ name: row.slug, entrypoint_path: row.entrypoint, verify_jwt: row.verify_jwt }),
  )
  for (const f of row.files) {
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) {
      throw new RestoreRefusal(`${row.slug}: ${f.path} is not a path inside the bundle`)
    }
    const bytes = readFileSync(join(dir, 'source', f.path))
    if (createHash('sha256').update(bytes).digest('hex') !== f.sha256 || bytes.length !== f.bytes) {
      throw new RestoreRefusal(`${row.slug}: ${f.path} changed since it was captured`)
    }
    form.append('file', new File([bytes], f.path, { type: 'application/typescript' }))
  }
  return {
    slug: row.slug,
    capturedVersion: row.version,
    entrypoint: row.entrypoint,
    verifyJwt: row.verify_jwt,
    files: row.files.map((f) => ({ path: f.path, bytes: f.bytes })),
    npmDependencies: row.npm_redirects ?? [],
    form,
  }
}
