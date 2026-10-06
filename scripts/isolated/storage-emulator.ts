/**
 * An in-memory stand-in for the Supabase Storage endpoints the backup code calls, installed over `globalThis.fetch`.
 *
 * The backup handler and `src/backup/portable.ts` talk to `https://<ref>.supabase.co/storage/v1/...` with `fetch`. A proof
 * that wants to run the REAL handler and the REAL `StorageFolderSource` must not reach that host, so this replaces `fetch`
 * for exactly those URLs and REFUSES (throws) for every other: no URL outside the emulator is ever contacted, and a call
 * that tries one is recorded and fails the proof.
 *
 * It implements only what those functions use: create/get bucket, upsert an object, list one level under a prefix (a
 * folder entry has no id, as in the real list), and download an object.
 */

// The production fetch guard is armed first, like every script that owns a `fetch` to a Supabase host: this file
// REPLACES `fetch` for exactly one host and refuses every other, so it can never reach production, but it names the host.
import '../../src/safety/arm.ts'

export class StorageEmulator {
  readonly objects = new Map<string, { bytes: Uint8Array; createdAt: string }>()
  readonly refused: string[] = []
  readonly deleted: string[] = []
  bucketPublic = false
  bucketExists = false
  private clock = Date.parse('2026-10-06T00:00:00Z')

  /** A fixture object with a chosen creation time, for retention proofs. */
  seed(key: string, bytes: Uint8Array, createdAt: string): void {
    this.objects.set(key, { bytes, createdAt })
  }

  install(ref: string): () => void {
    const real = globalThis.fetch
    const base = `https://${ref}.supabase.co/storage/v1`
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (!url.startsWith(base)) {
        this.refused.push(url)
        throw new Error(`REFUSED by the storage emulator: ${url}`)
      }
      return this.handle(url.slice(base.length), init ?? {})
    }) as typeof fetch
    return () => {
      globalThis.fetch = real
    }
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  private async handle(path: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase()
    if (path === '/bucket/backups' && method === 'GET') {
      return this.bucketExists
        ? this.json({ id: 'backups', public: this.bucketPublic })
        : this.json({}, 404)
    }
    if (path === '/bucket' && method === 'POST') {
      this.bucketExists = true
      return this.json({ name: 'backups' })
    }
    if (path === '/object/list/backups' && method === 'POST') {
      const { prefix } = JSON.parse(String(init.body)) as { prefix: string }
      const root = prefix === '' ? '' : `${prefix}/`
      const seen = new Map<
        string,
        { name: string; id: string | null; created_at?: string; metadata?: { size: number } }
      >()
      for (const [key, o] of this.objects) {
        if (!key.startsWith(root)) continue
        const rest = key.slice(root.length)
        const slash = rest.indexOf('/')
        if (slash < 0)
          seen.set(rest, {
            name: rest,
            id: key,
            created_at: o.createdAt,
            metadata: { size: o.bytes.length },
          })
        else if (!seen.has(rest.slice(0, slash)))
          seen.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null })
      }
      return this.json([...seen.values()])
    }
    if (path.startsWith('/object/backups/') && method === 'DELETE') {
      const key = decodeURIComponent(path.slice('/object/backups/'.length))
      this.deleted.push(key)
      return this.objects.delete(key)
        ? this.json({ message: 'Successfully deleted' })
        : this.json({ error: 'not found' }, 404)
    }
    if (path.startsWith('/object/backups/') && method === 'POST') {
      const key = decodeURIComponent(path.slice('/object/backups/'.length))
      const body = init.body
      const bytes =
        typeof body === 'string'
          ? new TextEncoder().encode(body)
          : new Uint8Array(body as ArrayBuffer | Uint8Array)
      this.clock += 1000
      this.objects.set(key, {
        bytes: new Uint8Array(bytes),
        createdAt: new Date(this.clock).toISOString(),
      })
      return this.json({ Key: key })
    }
    if (path.startsWith('/object/backups/') && method === 'GET') {
      const key = decodeURIComponent(path.slice('/object/backups/'.length))
      const o = this.objects.get(key)
      return o === undefined
        ? this.json({ error: 'not found' }, 404)
        : new Response(o.bytes as Uint8Array<ArrayBuffer>)
    }
    return this.json({ error: `the emulator does not implement ${method} ${path}` }, 501)
  }
}
