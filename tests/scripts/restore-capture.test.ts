import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { EszipError, readEszip } from '../../scripts/lib/eszip.ts'
import { buildRestorePlan, RestoreRefusal } from '../../scripts/lib/restore-plan.ts'

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}
/** A bundle in the shape the platform writes: no checksums, the two metadata entries, and an optional npm snapshot. */
const bundle = (
  files: Record<string, string>,
  opts: { options?: number[]; npm?: number } = {},
): Buffer => {
  const options = Buffer.from(opts.options ?? [0, 0, 1, 0])
  const sources: Buffer[] = []
  let off = 0
  const header: Buffer[] = []
  const entry = (spec: string, kind: number, rest: Buffer): void => {
    header.push(u32(Buffer.byteLength(spec)), Buffer.from(spec), Buffer.from([kind]), rest)
  }
  for (const [spec, text] of Object.entries(files)) {
    const body = Buffer.from(text)
    sources.push(body)
    entry(spec, 0, Buffer.concat([u32(off), u32(body.length), u32(0), u32(0), Buffer.from([0])]))
    off += body.length
  }
  entry('npm:postgres@3.4.5', 1, Buffer.concat([u32(5), Buffer.from('a/b/c')]))
  const h = Buffer.concat(header)
  const npm = Buffer.alloc(opts.npm ?? 0)
  return Buffer.concat([
    Buffer.from('ESZIP2.3'),
    u32(options.length),
    options,
    u32(h.length),
    h,
    u32(npm.length),
    npm,
    u32(off),
    ...sources,
    u32(0),
  ])
}

describe('ESZIP reader', () => {
  it('reads every module source and the redirect, byte for byte', () => {
    const z = readEszip(
      bundle({ 'source/index.ts': 'export const a = 1;\n', 'source/src/b.ts': '// b\n' }),
    )
    const mods = z.modules.filter((m) => m.kind === 'module')
    expect(mods.map((m) => m.specifier)).toEqual(['source/index.ts', 'source/src/b.ts'])
    expect(Buffer.from(mods[0]?.source ?? []).toString()).toBe('export const a = 1;\n')
    expect(Buffer.from(mods[1]?.source ?? []).toString()).toBe('// b\n')
    expect(z.modules.find((m) => m.kind === 'redirect')?.target).toBe('a/b/c')
    expect(z.npmSnapshotBytes).toBe(0)
  })
  it('reports an npm snapshot rather than dropping it silently', () => {
    expect(readEszip(bundle({ 'source/index.ts': 'x' }, { npm: 22 })).npmSnapshotBytes).toBe(22)
  })
  it('refuses what it cannot check: a wrong magic, a truncation, a declared checksum', () => {
    const good = bundle({ 'source/index.ts': 'export {}\n' })
    expect(() => readEszip(Buffer.from('NOTAZIP2xxxxxxxx'))).toThrow(EszipError)
    expect(() => readEszip(good.subarray(0, good.length - 20))).toThrow(EszipError)
    expect(() => readEszip(bundle({ 'source/index.ts': 'x' }, { options: [0, 1, 1, 32] }))).toThrow(
      /declares a checksum/,
    )
  })
  it('refuses a source range that runs past the sources block', () => {
    const b = bundle({ 'source/index.ts': 'abcdef' })
    // corrupt the declared source length (second u32 of the first entry) to be larger than the block
    const at = b.indexOf(Buffer.from('source/index.ts')) + 'source/index.ts'.length + 1 + 4
    b.writeUInt32BE(9999, at)
    expect(() => readEszip(b)).toThrow(/cut short/)
  })
})

describe('restore plan', () => {
  const root = mkdtempSync(join(tmpdir(), 'restore-plan-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const capture = (
    name: string,
    files: Record<string, string>,
    entrypoint = 'index.ts',
  ): string => {
    const dir = join(root, name)
    const rows = Object.entries(files).map(([path, text]) => {
      const target = join(dir, 'source', path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      return {
        path,
        bytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
      }
    })
    writeFileSync(
      join(dir, 'RESTORE.json'),
      JSON.stringify({ slug: name, version: 7, verify_jwt: false, entrypoint, files: rows }),
    )
    return dir
  }
  it('builds the same request every deploy sends: metadata plus one file part per source, at its own path', () => {
    const plan = buildRestorePlan(
      capture('fn-a', { 'index.ts': 'export {}\n', 'src/x.ts': '// x\n' }),
    )
    const parts = [...plan.form.entries()]
    expect(parts.map(([k]) => k)).toEqual(['metadata', 'file', 'file'])
    expect(JSON.parse(String(parts[0]?.[1]))).toEqual({
      name: 'fn-a',
      entrypoint_path: 'index.ts',
      verify_jwt: false,
    })
    expect(parts.slice(1).map(([, v]) => (v as File).name)).toEqual(['index.ts', 'src/x.ts'])
  })
  it('refuses a capture whose content changed, whose entrypoint is missing, or whose path escapes', () => {
    const dir = capture('fn-b', { 'index.ts': 'one\n' })
    writeFileSync(join(dir, 'source', 'index.ts'), 'two\n')
    expect(() => buildRestorePlan(dir)).toThrow(RestoreRefusal)
    expect(() => buildRestorePlan(capture('fn-c', { 'other.ts': 'x\n' }))).toThrow(/entrypoint/)
    expect(() =>
      buildRestorePlan(capture('fn-d', { 'index.ts': 'x\n', '../escape.ts': 'y\n' })),
    ).toThrow(/not a path inside the bundle/)
  })
})
