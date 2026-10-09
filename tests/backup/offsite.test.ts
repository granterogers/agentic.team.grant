import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Manifest } from '../../src/backup/manifest.ts'
import {
  AgeDecryptor,
  AgeEncryptor,
  type Encryptor,
  GpgEncryptor,
  openOffsite,
  packBundle,
  safeEntryName,
  sealForOffsite,
  unpackBundle,
  verifyBundle,
} from '../../src/backup/offsite.ts'
import { checksum } from '../../src/backup/portable.ts'
import { gunzipText } from '../../src/backup/sources.ts'

const P = 'run-aaaaaaaa-0000-4000-8000-000000000000'
const gz = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  )
const META = { created_at: '2026-10-06T12:00:00Z', source: 'a-project-label', prefix: P }
const CANARY = 'PLAINTEXT-CANARY-ROW-VALUE'

/** A real small archive: one table with a canary, and a manifest that vouches for it. */
const archive = async () => {
  const table = await gz(`{"table":"public.t","rows":[{"id": 1, "v": "${CANARY}"}]}`)
  const manifest: Manifest = {
    row_counts: { 'public.t': 1 },
    tables: 1,
    rows: 1,
    objects: { [`${P}/public.t.json.gz`]: { sha256: await checksum(table), bytes: table.length } },
  }
  const mbytes = await gz(JSON.stringify(manifest))
  return [
    { name: `${P}/public.t.json.gz`, bytes: table },
    { name: `${P}/manifest.json.gz`, bytes: mbytes },
  ]
}

describe('the bundle', () => {
  it('round trips, and every byte is vouched for by the header', async () => {
    const entries = await archive()
    const { header, entries: back } = await unpackBundle(await packBundle(entries, META))
    expect([...back.keys()].sort()).toEqual(entries.map((e) => e.name).sort())
    expect(header.entries).toHaveLength(2)
    for (const e of entries) expect(back.get(e.name)).toEqual(e.bytes)
  })

  it('refuses an unsafe entry name when packing and when unpacking', async () => {
    for (const name of ['../x', '/etc/passwd', 'a/../b', 'a//b', '', 'a\\b', 'a/./b']) {
      expect(safeEntryName(name), name).toBe(false)
      await expect(
        packBundle([...(await archive()), { name, bytes: new Uint8Array(1) }], META),
      ).rejects.toThrow(/unsafe/)
    }
    expect(safeEntryName(`${P}/public.t.json.gz`)).toBe(true)
  })

  it('refuses a bundle with no manifest, and one packed twice with the same name', async () => {
    const e = await archive()
    await expect(packBundle([e[0] as never], META)).rejects.toThrow(/manifest/)
    await expect(packBundle([...e, e[0] as never], META)).rejects.toThrow(/twice/)
  })

  it('detects a flipped byte in any entry, a truncated bundle, a wrong magic and trailing bytes', async () => {
    const packed = await packBundle(await archive(), META)
    const flipped = packed.slice()
    flipped[flipped.length - 3] = (flipped[flipped.length - 3] as number) ^ 0xff
    await expect(unpackBundle(flipped)).rejects.toThrow(/checksum mismatch/)
    await expect(unpackBundle(packed.slice(0, packed.length - 5))).rejects.toThrow(/truncated/)
    const magic = packed.slice()
    magic[0] = 0
    await expect(unpackBundle(magic)).rejects.toThrow(/bad magic/)
    const extra = new Uint8Array(packed.length + 4)
    extra.set(packed)
    await expect(unpackBundle(extra)).rejects.toThrow(/does not account/)
  })

  it('verifyBundle agrees with the manifest it carries, and fails when an object is swapped for a valid-looking other', async () => {
    const e = await archive()
    const { header, entries } = await unpackBundle(await packBundle(e, META))
    const manifest = JSON.parse(
      await gunzipText(entries.get(`${P}/manifest.json.gz`) as Uint8Array),
    ) as Manifest
    expect((await verifyBundle(header, entries, manifest)).ok).toBe(true)
    const swapped = new Map(entries)
    swapped.set(`${P}/public.t.json.gz`, await gz('{"table":"public.t","rows":[]}'))
    const v = await verifyBundle(header, swapped, manifest)
    expect(v.ok).toBe(false)
    expect(v.errors.join()).toContain('does not match the checksum')
  })
})

describe('encryption has no plaintext path', () => {
  it('rejects a private key where only a public recipient may go', () => {
    expect(
      () =>
        new AgeEncryptor(
          'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ',
        ),
    ).toThrow(/PRIVATE/)
    expect(() => new AgeEncryptor('not a key')).toThrow(/public key/)
    expect(() => new AgeEncryptor('')).toThrow()
    expect(() => new AgeDecryptor('AGE-SECRET-KEY-1ABC')).toThrow(/PATH/)
    expect(() => new GpgEncryptor('has spaces')).toThrow(/fingerprint or an email/)
  })

  it('passes a public recipient and nothing secret to the program', async () => {
    const calls: { cmd: string; args: readonly string[] }[] = []
    const recipient = `age1${'q'.repeat(58)}`
    const enc = new AgeEncryptor(recipient, async (cmd, args, stdin) => {
      calls.push({ cmd, args })
      return new Uint8Array([...new TextEncoder().encode('X'), ...stdin.slice(0, 3)])
    })
    await enc.encrypt(new Uint8Array([1, 2, 3]))
    expect(calls).toEqual([{ cmd: 'age', args: ['--recipient', recipient] }])
  })

  it('sealForOffsite refuses an encryptor that hands the plaintext back', async () => {
    const passthrough: Encryptor = { name: 'oops', encrypt: async (p) => p }
    await expect(sealForOffsite(await archive(), META, passthrough)).rejects.toThrow(/did nothing/)
    const empty: Encryptor = { name: 'empty', encrypt: async () => new Uint8Array(0) }
    await expect(sealForOffsite(await archive(), META, empty)).rejects.toThrow(/returned nothing/)
  })

  const haveAge = spawnSync('age', ['--version']).status === 0
  it.runIf(haveAge)(
    'REAL age: seals to a public key, the ciphertext holds no plaintext, and only the identity opens it',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'age-test-'))
      try {
        const identity = join(dir, 'identity.txt')
        execFileSync('age-keygen', ['-o', identity], { stdio: 'pipe' })
        const recipient = /public key: (age1[0-9a-z]+)/.exec(
          readFileSync(identity, 'utf8'),
        )?.[1] as string
        const sealed = await sealForOffsite(await archive(), META, new AgeEncryptor(recipient))
        const text = Buffer.from(sealed.bytes).toString('latin1')
        expect(text).not.toContain(CANARY)
        expect(text).not.toContain('public.t')
        expect(sealed.encryptedWith).toBe('age')
        const opened = await openOffsite(sealed.bytes, new AgeDecryptor(identity))
        expect(opened.verdict.ok).toBe(true)
        expect(
          await gunzipText(opened.entries.get(`${P}/public.t.json.gz`) as Uint8Array),
        ).toContain(CANARY)
        // a different identity cannot open it (the control that proves the encryption is doing something)
        const other = join(dir, 'other.txt')
        execFileSync('age-keygen', ['-o', other], { stdio: 'pipe' })
        await expect(openOffsite(sealed.bytes, new AgeDecryptor(other))).rejects.toThrow()
        // and a flipped ciphertext byte is refused
        const bad = sealed.bytes.slice()
        bad[bad.length - 10] = (bad[bad.length - 10] as number) ^ 1
        await expect(openOffsite(bad, new AgeDecryptor(identity))).rejects.toThrow()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
