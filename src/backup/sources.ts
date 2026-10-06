/**
 * Where a restore reads an archive FROM. Two sources, one interface (`ArchiveSource` in restore.ts).
 *
 * `MemoryArchive` holds the objects of one run as bytes and is what the replica proofs and the unit tests use: it needs
 * no network and no Storage. `StorageFolderSource` reads the same run out of the private `backups` bucket and is the
 * source a real recovery would use; it is type-checked and has NOT been exercised against a live bucket (that needs a
 * production read, which is parked, see docs/ops/restore-procedure.md).
 */

import type { Manifest, ObservedObject } from './manifest.ts'
import { checksum, downloadArchive, listUnder } from './portable.ts'
import type { ArchiveSource } from './restore.ts'

/** Un-gzip to TEXT, never to a parsed value: row numbers must not pass through a JavaScript double. */
export async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

export class MemoryArchive implements ArchiveSource {
  readonly objects = new Map<string, Uint8Array>()
  constructor(readonly prefix: string) {}

  put(key: string, bytes: Uint8Array): void {
    this.objects.set(key, bytes)
  }

  async manifest(): Promise<Manifest> {
    const bytes = this.objects.get(`${this.prefix}/manifest.json.gz`)
    if (bytes === undefined)
      throw new Error('this folder has no manifest: it is an interrupted run, not a backup')
    return JSON.parse(await gunzipText(bytes)) as Manifest
  }

  async observed(): Promise<ReadonlyMap<string, ObservedObject>> {
    const out = new Map<string, ObservedObject>()
    for (const [key, bytes] of this.objects)
      out.set(key, { sha256: await checksum(bytes), bytes: bytes.length })
    return out
  }

  async table(qualified: string): Promise<{ text: string; sha256: string; bytes: number } | null> {
    const bytes = this.objects.get(`${this.prefix}/${qualified}.json.gz`)
    if (bytes === undefined) return null
    return { text: await gunzipText(bytes), sha256: await checksum(bytes), bytes: bytes.length }
  }
}

export class StorageFolderSource implements ArchiveSource {
  constructor(
    private readonly ref: string,
    private readonly serviceKey: string,
    readonly prefix: string,
  ) {}

  async manifest(): Promise<Manifest> {
    const bytes = await downloadArchive(
      this.ref,
      this.serviceKey,
      `${this.prefix}/manifest.json.gz`,
    )
    return JSON.parse(await gunzipText(bytes)) as Manifest
  }

  async observed(): Promise<ReadonlyMap<string, ObservedObject>> {
    // The listing says what exists; the checksum is of the bytes themselves, compared with the sidecar written beside each.
    const out = new Map<string, ObservedObject>()
    for (const o of await listUnder(this.ref, this.serviceKey, this.prefix)) {
      if (!o.name.endsWith('.json.gz')) continue
      const bytes = await downloadArchive(this.ref, this.serviceKey, o.name)
      const stated = await downloadArchive(this.ref, this.serviceKey, `${o.name}.sha256`)
        .then((b) => new TextDecoder().decode(b).trim().split(/\s+/)[0] ?? '')
        .catch(() => '')
      const actual = await checksum(bytes)
      // A stored sidecar that disagrees with the bytes is a corrupt object: report the sidecar's value so the
      // manifest comparison and verifyArchive both fail on it rather than a restore loading it.
      out.set(o.name, {
        sha256: stated !== '' && stated !== actual ? stated : actual,
        bytes: bytes.length,
      })
    }
    return out
  }

  async table(qualified: string): Promise<{ text: string; sha256: string; bytes: number } | null> {
    const key = `${this.prefix}/${qualified}.json.gz`
    const bytes = await downloadArchive(this.ref, this.serviceKey, key).catch(() => null)
    if (bytes === null) return null
    return { text: await gunzipText(bytes), sha256: await checksum(bytes), bytes: bytes.length }
  }
}
