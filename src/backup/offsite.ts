/**
 * The pure half of an OFF-PROJECT backup (G-2 of the 6 October 2026 audit).
 *
 * The folder backup lives in the SAME Supabase project it protects, so losing the project (or filling its storage, which
 * G-1 shows is close) loses the only copy. An off-failure-domain copy needs three things this file provides without
 * touching any service:
 *
 *   1. PACKAGING: the folder (every table object, its checksum, the manifest) as ONE file with a header that vouches for
 *      every byte in it, so a corrupted or truncated bundle is refused rather than half restored;
 *   2. ENCRYPTION behind an interface, with no unencrypted path: `sealForOffsite` cannot be called without an
 *      `Encryptor`, and the two implementations here encrypt to a PUBLIC recipient only. The machine that seals holds no
 *      key that can open it; the identity that can is held off-project by a person (docs/ops/restore-procedure.md);
 *   3. VERIFICATION of a bundle against its own manifest before it is trusted (`verifyBundle`).
 *
 * What is NOT here: any upload. Moving the sealed bundle to a user-owned free store (Cloudflare R2, Backblaze B2, a disk
 * the owner keeps) is a deliberate, separately approved step with its own credential; the candidates and their limits are
 * in the document, marked UNVERIFIED where they cannot be checked offline.
 *
 * Nothing here is secret-bearing: a bundle is encrypted data, a recipient is a public key, and both implementations
 * refuse a recipient that looks like a private key.
 */

import { spawn } from 'node:child_process'
import { type Manifest, type ObservedObject, type Verdict, verifyArchive } from './manifest.ts'
import { checksum } from './portable.ts'

const MAGIC = new TextEncoder().encode('AITHQBK1')

export interface BundleMeta {
  readonly created_at: string
  /** Which project the bundle came from. A label for a person, never a credential. */
  readonly source: string
  /** The run folder inside the bundle (`run-<uuid>`). */
  readonly prefix: string
}

export interface BundleEntry {
  readonly name: string
  readonly bytes: Uint8Array
}

interface HeaderEntry {
  readonly name: string
  readonly offset: number
  readonly length: number
  readonly sha256: string
}

export interface BundleHeader extends BundleMeta {
  readonly v: 1
  readonly manifest_sha256: string
  readonly entries: readonly HeaderEntry[]
}

/** A name a bundle may carry: relative, no traversal, no empty or dot segments, no backslash or NUL. */
export const safeEntryName = (name: string): boolean =>
  name !== '' &&
  !name.startsWith('/') &&
  !name.includes('\\') &&
  !name.includes('\0') &&
  name.split('/').every((s) => s !== '' && s !== '.' && s !== '..')

export async function packBundle(
  entries: readonly BundleEntry[],
  meta: BundleMeta,
): Promise<Uint8Array> {
  const seen = new Set<string>()
  const header: HeaderEntry[] = []
  let offset = 0
  for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!safeEntryName(e.name))
      throw new Error(`refusing to pack an unsafe name: ${JSON.stringify(e.name)}`)
    if (seen.has(e.name)) throw new Error(`refusing to pack ${e.name} twice`)
    seen.add(e.name)
    header.push({ name: e.name, offset, length: e.bytes.length, sha256: await checksum(e.bytes) })
    offset += e.bytes.length
  }
  const manifestEntry = header.find((h) => h.name === `${meta.prefix}/manifest.json.gz`)
  if (manifestEntry === undefined)
    throw new Error(
      "a bundle must contain the run's manifest: without it nothing can vouch for the rest",
    )
  const head = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      ...meta,
      manifest_sha256: manifestEntry.sha256,
      entries: header,
    } satisfies BundleHeader),
  )
  const out = new Uint8Array(MAGIC.length + 4 + head.length + offset)
  out.set(MAGIC, 0)
  new DataView(out.buffer).setUint32(MAGIC.length, head.length, false)
  out.set(head, MAGIC.length + 4)
  const base = MAGIC.length + 4 + head.length
  const byName = new Map(entries.map((e) => [e.name, e.bytes]))
  for (const h of header) out.set(byName.get(h.name) as Uint8Array, base + h.offset)
  return out
}

/** Open a bundle and verify every byte against the header. Throws on anything that does not add up. */
export async function unpackBundle(
  bytes: Uint8Array,
): Promise<{ header: BundleHeader; entries: Map<string, Uint8Array> }> {
  if (bytes.length < MAGIC.length + 4 || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('not a backup bundle: bad magic')
  }
  const headLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length, false)
  const start = MAGIC.length + 4
  if (headLen === 0 || start + headLen > bytes.length) throw new Error('bundle header is truncated')
  let header: BundleHeader
  try {
    header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(start, start + headLen)),
    ) as BundleHeader
  } catch {
    throw new Error('bundle header is not valid JSON')
  }
  if (header.v !== 1 || !Array.isArray(header.entries)) throw new Error('unknown bundle version')
  const base = start + headLen
  const payload = bytes.length - base
  const entries = new Map<string, Uint8Array>()
  let end = 0
  for (const h of header.entries) {
    if (!safeEntryName(h.name))
      throw new Error(`bundle names an unsafe path: ${JSON.stringify(h.name)}`)
    if (entries.has(h.name)) throw new Error(`bundle lists ${h.name} twice`)
    if (
      !Number.isInteger(h.offset) ||
      !Number.isInteger(h.length) ||
      h.offset < 0 ||
      h.length < 0
    ) {
      throw new Error(`${h.name}: bad offset or length`)
    }
    if (h.offset !== end) throw new Error(`${h.name}: entries overlap or leave a gap`)
    if (h.offset + h.length > payload) throw new Error(`${h.name}: the bundle is truncated`)
    const slice = bytes.slice(base + h.offset, base + h.offset + h.length)
    if ((await checksum(slice)) !== h.sha256) throw new Error(`${h.name}: checksum mismatch`)
    entries.set(h.name, slice)
    end = h.offset + h.length
  }
  if (end !== payload) throw new Error('the bundle carries bytes its header does not account for')
  const manifest = entries.get(`${header.prefix}/manifest.json.gz`)
  if (manifest === undefined || (await checksum(manifest)) !== header.manifest_sha256) {
    throw new Error("the bundle's manifest is missing or is not the one the header names")
  }
  return { header, entries }
}

/** A bundle is trusted only after its own manifest agrees with its own contents. */
export async function verifyBundle(
  header: BundleHeader,
  entries: ReadonlyMap<string, Uint8Array>,
  manifest: Manifest,
): Promise<Verdict> {
  const observed = new Map<string, ObservedObject>()
  for (const [name, bytes] of entries)
    observed.set(name, { sha256: await checksum(bytes), bytes: bytes.length })
  return verifyArchive(manifest, header.prefix, observed)
}

// ---------------------------------------------------------------------------------------------------- encryption

export interface Encryptor {
  readonly name: string
  encrypt(plain: Uint8Array): Promise<Uint8Array>
}
export interface Decryptor {
  readonly name: string
  decrypt(cipher: Uint8Array): Promise<Uint8Array>
}

/** Run a program with bytes on stdin. Injected so the argument lists can be asserted without the program. */
export type Run = (cmd: string, args: readonly string[], stdin: Uint8Array) => Promise<Uint8Array>

export const runProgram: Run = (cmd, args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(new Uint8Array(Buffer.concat(out)))
      else
        reject(
          new Error(
            `${cmd} exited ${String(code)}: ${Buffer.concat(err).toString('utf8').slice(0, 200)}`,
          ),
        )
    })
    child.stdin.end(Buffer.from(stdin))
  })

const AGE_PUBLIC = /^age1[0-9a-z]{50,}$/

/** Encrypts to an age PUBLIC recipient. The private identity is never needed here, never accepted, never logged. */
export class AgeEncryptor implements Encryptor {
  readonly name = 'age'
  constructor(
    private readonly recipient: string,
    private readonly run: Run = runProgram,
  ) {
    if (/AGE-SECRET-KEY-/i.test(recipient)) {
      throw new Error(
        'that is an age PRIVATE key. Refusing it: only a public recipient (age1...) may be given to the sealing side.',
      )
    }
    if (!AGE_PUBLIC.test(recipient))
      throw new Error('the recipient is not an age public key (age1...)')
  }
  encrypt(plain: Uint8Array): Promise<Uint8Array> {
    return this.run('age', ['--recipient', this.recipient], plain)
  }
}

/** Decrypts with an identity FILE kept off-project, on the machine of the person restoring. */
export class AgeDecryptor implements Decryptor {
  readonly name = 'age'
  constructor(
    private readonly identityFile: string,
    private readonly run: Run = runProgram,
  ) {
    if (identityFile === '' || /AGE-SECRET-KEY-/i.test(identityFile)) {
      throw new Error('give the PATH of the identity file, never the key itself')
    }
  }
  decrypt(cipher: Uint8Array): Promise<Uint8Array> {
    return this.run('age', ['--decrypt', '--identity', this.identityFile], cipher)
  }
}

/** GnuPG, to a recipient already present in the keyring as a public key. */
export class GpgEncryptor implements Encryptor {
  readonly name = 'gpg'
  constructor(
    private readonly recipient: string,
    private readonly homedir: string | null = null,
    private readonly run: Run = runProgram,
  ) {
    if (!/^[0-9A-Fa-f]{16,40}$|^[^\s@]+@[^\s@]+$/.test(recipient)) {
      throw new Error(
        'the gpg recipient must be a key fingerprint or an email address that names a PUBLIC key in the keyring',
      )
    }
  }
  encrypt(plain: Uint8Array): Promise<Uint8Array> {
    return this.run(
      'gpg',
      [
        ...(this.homedir === null ? [] : ['--homedir', this.homedir]),
        '--batch',
        '--yes',
        '--trust-model',
        'always',
        '--encrypt',
        '--recipient',
        this.recipient,
      ],
      plain,
    )
  }
}

export class GpgDecryptor implements Decryptor {
  readonly name = 'gpg'
  constructor(
    private readonly homedir: string | null = null,
    private readonly run: Run = runProgram,
  ) {}
  decrypt(cipher: Uint8Array): Promise<Uint8Array> {
    return this.run(
      'gpg',
      [...(this.homedir === null ? [] : ['--homedir', this.homedir]), '--batch', '--decrypt'],
      cipher,
    )
  }
}

export interface Sealed {
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly plaintextSha256: string
  readonly plaintextBytes: number
  readonly encryptedWith: string
}

/**
 * Package and encrypt. There is no overload without an encryptor and no flag to skip it: an off-project copy that is
 * readable by whoever holds the bucket would put every login and every document where the backup was kept to avoid it.
 */
export async function sealForOffsite(
  entries: readonly BundleEntry[],
  meta: BundleMeta,
  encryptor: Encryptor,
): Promise<Sealed> {
  const plain = await packBundle(entries, meta)
  const cipher = await encryptor.encrypt(plain)
  if (cipher.length === 0) throw new Error('the encryptor returned nothing')
  // a cheap tripwire against an encryptor that passes its input through: the bundle begins with a known magic
  if (MAGIC.every((b, i) => cipher[i] === b))
    throw new Error(
      'the "encrypted" bytes begin with the plaintext magic: the encryptor did nothing',
    )
  return {
    bytes: cipher,
    sha256: await checksum(cipher),
    plaintextSha256: await checksum(plain),
    plaintextBytes: plain.length,
    encryptedWith: encryptor.name,
  }
}

/** Decrypt, unpack and verify against the bundle's own manifest. Returns the verdict, never a partial bundle. */
export async function openOffsite(
  cipher: Uint8Array,
  decryptor: Decryptor,
): Promise<{
  header: BundleHeader
  entries: Map<string, Uint8Array>
  verdict: Verdict
  manifest: Manifest
}> {
  const plain = await decryptor.decrypt(cipher)
  const { header, entries } = await unpackBundle(plain)
  const manifestBytes = entries.get(`${header.prefix}/manifest.json.gz`) as Uint8Array
  const stream = new Blob([manifestBytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  const manifest = JSON.parse(await new Response(stream).text()) as Manifest
  return { header, entries, manifest, verdict: await verifyBundle(header, entries, manifest) }
}
