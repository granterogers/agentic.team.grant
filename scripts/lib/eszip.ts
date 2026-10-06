/**
 * A reader for the ESZIP2 bundle the Management API returns from `GET /functions/{slug}/body`.
 *
 * Why this exists: a deployed edge function has no reproducible source in Git (the Sample Office went out from an
 * uncommitted tree, ADR-0067), and a version number cannot be redeployed. What CAN be restored is the module sources
 * inside the bundle. This reads them out so a rollback artifact is actual restorable content. It does not execute
 * anything and holds no credential.
 *
 * Format (ESZIP 2.3, as the platform writes it today): magic `ESZIP2.3`; an options block (u32 length, then
 * `[kind, value]` byte pairs: kind 0 = checksum algorithm, kind 1 = checksum size); a modules header (u32 length, then
 * entries); an npm snapshot (u32 length, bytes); a sources block and a source-maps block (each u32 length, then bytes).
 * An entry is `u32 specifier length, specifier, u8 kind`; kind 0 (module) is followed by `u32 source offset, u32 source
 * length, u32 map offset, u32 map length, u8 module kind`, kind 1 (redirect) and kind 2 (npm specifier) by
 * `u32 length, target`.
 *
 * The platform declares NO per-section checksum (algorithm 0, size 0), so there is none to verify; this reader REFUSES a
 * bundle that declares one rather than reading what it cannot check, and refuses anything whose lengths do not add up.
 * Integrity of a capture is then carried by the caller, which records a sha256 of the bundle and of every extracted file.
 *
 * The sources in the bundle are the TRANSPILED modules (types stripped), not the repository's TypeScript.
 */
export type EszipModule = {
  readonly specifier: string
  readonly kind: 'module' | 'redirect' | 'npm'
  readonly target?: string
  readonly moduleKind?: number
  readonly source?: Uint8Array
}

export type Eszip = { readonly modules: EszipModule[]; readonly npmSnapshotBytes: number }

export class EszipError extends Error {}

export const readEszip = (buf: Uint8Array): Eszip => {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
  if (b.length < 12 || b.subarray(0, 8).toString('latin1') !== 'ESZIP2.3')
    throw new EszipError('not an ESZIP2.3 bundle')
  let p = 8
  const need = (n: number): void => {
    if (n < 0 || p + n > b.length) throw new EszipError('truncated bundle')
  }
  const u32 = (): number => {
    need(4)
    const v = b.readUInt32BE(p)
    p += 4
    return v
  }
  const u8 = (): number => {
    need(1)
    const v = b[p] as number
    p += 1
    return v
  }
  const optLen = u32()
  need(optLen)
  for (let i = 0; i + 1 < optLen; i += 2) {
    const kind = b[p + i] as number
    const value = b[p + i + 1] as number
    if ((kind === 0 || kind === 1) && value !== 0) {
      throw new EszipError('this bundle declares a checksum, which this reader does not verify')
    }
  }
  p += optLen

  const headerLen = u32()
  need(headerLen)
  const headerEnd = p + headerLen
  type Entry = {
    specifier: string
    kind: number
    off: number
    len: number
    mk: number
    target: string
  }
  const entries: Entry[] = []
  while (p < headerEnd) {
    const sl = u32()
    need(sl)
    const specifier = b.subarray(p, p + sl).toString('utf8')
    p += sl
    const kind = u8()
    if (kind === 0) {
      const off = u32()
      const len = u32()
      u32() // source-map offset
      u32() // source-map length
      entries.push({ specifier, kind, off, len, mk: u8(), target: '' })
    } else if (kind === 1 || kind === 2) {
      const tl = u32()
      need(tl)
      entries.push({
        specifier,
        kind,
        off: 0,
        len: 0,
        mk: 0,
        target: b.subarray(p, p + tl).toString('utf8'),
      })
      p += tl
    } else throw new EszipError(`unknown entry kind ${String(kind)} for ${specifier}`)
  }
  if (p !== headerEnd) throw new EszipError('modules header length does not add up')

  // A non-empty npm snapshot means the function imports npm packages; they are re-resolved when the sources are
  // redeployed, so the caller is told (npmSnapshotBytes) rather than the bytes being kept.
  const npmSnapshotBytes = u32()
  need(npmSnapshotBytes)
  p += npmSnapshotBytes

  const srcLen = u32()
  need(srcLen)
  const sources = b.subarray(p, p + srcLen)
  const out: EszipModule[] = []
  for (const e of entries) {
    if (e.kind === 0) {
      if (e.off + e.len > sources.length)
        throw new EszipError(`source for ${e.specifier} is cut short`)
      out.push({
        specifier: e.specifier,
        kind: 'module',
        moduleKind: e.mk,
        source: new Uint8Array(sources.subarray(e.off, e.off + e.len)),
      })
    } else
      out.push({
        specifier: e.specifier,
        kind: e.kind === 1 ? 'redirect' : 'npm',
        target: e.target,
      })
  }
  return { modules: out, npmSnapshotBytes }
}
