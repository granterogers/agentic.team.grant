/**
 * The storage side of project sets (#471, item 5). The gateway calls these; the tests call them with an in-memory store.
 *
 * Export: prepareSet reads each original once, in turn, keeping its checksum, and builds the index. The index, the package and
 *         the plan (which stored file goes in which part) are kept under exports/, so every part request reads the same set
 *         even if the project changes between requests. buildSetPart reads only the files of the part it builds.
 * Restore: restorePart writes one part's originals under restores/<office>/<set key>/, and records what it wrote in a marker
 *         BEFORE each write, so a failed part can be rolled back exactly. commitSet creates the project only when every part is
 *         present, and discards everything the set wrote if the database refuses. abandonSet discards an uncommitted set.
 *
 * Plain words in this file's comments; no backticks, because the template check reads it.
 */
import { ArchiveError, sha256Hex } from './archive.ts'
import {
  discardOriginals,
  type ExtensionFor,
  type OriginalStore,
  writeOriginals,
} from './originals.ts'
import {
  attachOriginals,
  buildPart,
  indexBytes,
  openPart,
  planParts,
  SET_FORMAT,
  SET_LIMITS,
  SET_VERSION,
  type SetEntry,
  type SetIndex,
  setKeyOf,
} from './parts.ts'

export type SetResult<T> = ({ ok: true } & T) | { ok: false; status: number; error: string }

/** One planned file: where it is stored now, and where it sits in the set. */
export interface PlannedFile {
  readonly archive_name: string
  readonly storage_path: string
  readonly sha256: string
  readonly bytes: number
  readonly part: number
}

export interface PreparedSet {
  readonly index: SetIndex
  readonly indexBytes: Uint8Array
  readonly setKey: string
  /** The package as the archive carries it: each original's checksum and archive name, and no storage path. */
  readonly packageBytes: Uint8Array
  readonly plan: readonly PlannedFile[]
  readonly partCount: number
}

type Doc = Record<string, unknown> & { title?: unknown; original?: unknown }
type Orig = { mime_type?: unknown; bytes?: unknown; storage_path?: unknown }

const documentsOf = (pkg: { documents?: unknown }): Doc[] =>
  Array.isArray(pkg.documents) ? (pkg.documents as Doc[]) : []

const titleOf = (doc: Doc): string =>
  typeof doc.title === 'string' && doc.title !== '' ? doc.title : 'untitled'

const extOf = (mime: string, extension: ExtensionFor): string => {
  const ext = extension(mime)
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
}

/**
 * Read each original once and build the set. Refused before any read when a size is missing, when one file is too large, or
 * when the set would be too large or need too many parts. A stored file that is missing or the wrong size refuses the whole set,
 * as it does for a single archive: a backup that quietly lacks a document is worse than none.
 */
export async function prepareSet(input: {
  pkg: { documents?: unknown } & Record<string, unknown>
  slug: string
  store: OriginalStore
  extension: ExtensionFor
}): Promise<SetResult<PreparedSet>> {
  const docs = documentsOf(input.pkg)
  const items: { doc: number; title: string; bytes: number; orig: Orig }[] = []
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]
    const orig = doc?.original as Orig | null | undefined
    if (doc === undefined || orig === null || orig === undefined || typeof orig !== 'object')
      continue
    if (!Number.isInteger(orig.bytes) || (orig.bytes as number) < 0) {
      return {
        ok: false,
        status: 409,
        error: `the original of "${titleOf(doc)}" has no recorded size`,
      }
    }
    items.push({ doc: i, title: titleOf(doc), bytes: orig.bytes as number, orig })
  }
  const plan = planParts(items.map((x) => ({ title: x.title, bytes: x.bytes })))
  if (!plan.ok) return { ok: false, status: plan.status, error: plan.reason }

  const partOf = new Map<number, number>()
  plan.parts.forEach((group, p) => {
    for (const i of group) partOf.set(i, p + 1)
  })

  const entries: SetEntry[] = []
  const planned: PlannedFile[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  const packageDocs = structuredClone(input.pkg) as { documents?: unknown }
  const packageList = documentsOf(packageDocs)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    const path = typeof item.orig.storage_path === 'string' ? item.orig.storage_path : ''
    const stored = path === '' ? null : await input.store.read(path)
    if (stored === null || stored.bytes.length !== item.bytes) {
      missing.push(item.title)
      continue
    }
    const sha = await sha256Hex(stored.bytes)
    const mime = typeof item.orig.mime_type === 'string' ? item.orig.mime_type : ''
    const archiveName = `files/${sha}.${extOf(mime, input.extension)}`
    const part = partOf.get(i) ?? 1
    entries.push({
      doc: item.doc,
      sha256: sha,
      bytes: item.bytes,
      mime,
      archive_name: archiveName,
      part,
    })
    if (!seen.has(archiveName)) {
      seen.add(archiveName)
      planned.push({
        archive_name: archiveName,
        storage_path: path,
        sha256: sha,
        bytes: item.bytes,
        part,
      })
    }
    const doc = packageList[item.doc]
    if (doc !== undefined)
      doc.original = { mime_type: mime, bytes: item.bytes, sha256: sha, archive_name: archiveName }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `the stored file for ${missing.map((t) => `"${t}"`).join(', ')} could not be read, so a complete archive cannot be made`,
    }
  }

  const packageBytes = new TextEncoder().encode(JSON.stringify(packageDocs))
  if (packageBytes.length > SET_LIMITS.packageBytes) {
    return {
      ok: false,
      status: 413,
      error: 'the project itself (its text, documents and tasks) is larger than a set may carry',
    }
  }
  const index: SetIndex = {
    format: SET_FORMAT,
    version: SET_VERSION,
    slug: input.slug,
    package_sha256: await sha256Hex(packageBytes),
    part_count: plan.parts.length,
    entries,
  }
  const bytes = indexBytes(index)
  return {
    ok: true,
    index,
    indexBytes: bytes,
    setKey: await setKeyOf(bytes),
    packageBytes,
    plan: planned,
    partCount: plan.parts.length,
  }
}

/** Where the export cache for one export lives. Kept until the set is downloaded, and never shared. */
export const exportCachePaths = (office: string, cacheId: string) => ({
  index: `exports/${office}/${cacheId}/set.json`,
  pkg: `exports/${office}/${cacheId}/project.json`,
  plan: `exports/${office}/${cacheId}/plan.json`,
})

export async function storeExportCache(
  store: OriginalStore,
  office: string,
  cacheId: string,
  prepared: PreparedSet,
): Promise<boolean> {
  const p = exportCachePaths(office, cacheId)
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))
  const writes: [string, Uint8Array, string][] = [
    [p.index, prepared.indexBytes, 'application/json'],
    [p.pkg, prepared.packageBytes, 'application/json'],
    [p.plan, json(prepared.plan), 'application/json'],
  ]
  for (const [path, bytes, mime] of writes) {
    try {
      const r = await store.put(path, bytes, mime)
      if (!r.ok) return false
    } catch {
      return false
    }
  }
  return true
}

/** One part of an export, built from the cache: only that part's files are read. */
export async function buildSetPart(input: {
  office: string
  cacheId: string
  setKey: string
  number: number
  store: OriginalStore
  exportedAt: string
}): Promise<SetResult<{ bytes: Uint8Array; slug: string; partCount: number }>> {
  const p = exportCachePaths(input.office, input.cacheId)
  const idx = await input.store.read(p.index)
  if (idx === null)
    return {
      ok: false,
      status: 404,
      error: 'that export is no longer held; start the download again',
    }
  if ((await sha256Hex(idx.bytes)) !== input.setKey) {
    return { ok: false, status: 409, error: 'that part belongs to another set' }
  }
  const index = JSON.parse(new TextDecoder().decode(idx.bytes)) as SetIndex
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > index.part_count) {
    return { ok: false, status: 400, error: 'there is no part with that number in this set' }
  }
  const planRaw = await input.store.read(p.plan)
  if (planRaw === null)
    return {
      ok: false,
      status: 404,
      error: 'that export is no longer held; start the download again',
    }
  const plan = JSON.parse(new TextDecoder().decode(planRaw.bytes)) as PlannedFile[]
  const files: { name: string; data: Uint8Array }[] = []
  for (const f of plan.filter((x) => x.part === input.number)) {
    const stored = await input.store.read(f.storage_path)
    if (stored === null || stored.bytes.length !== f.bytes) {
      return {
        ok: false,
        status: 409,
        error: 'a file of this set could not be read, so the part was not made',
      }
    }
    if ((await sha256Hex(stored.bytes)) !== f.sha256) {
      return {
        ok: false,
        status: 409,
        error: 'a file of this set no longer matches its recorded checksum',
      }
    }
    files.push({ name: f.archive_name, data: stored.bytes })
  }
  let pkg: Uint8Array | null = null
  if (input.number === 1) {
    const raw = await input.store.read(p.pkg)
    if (raw === null)
      return {
        ok: false,
        status: 404,
        error: 'that export is no longer held; start the download again',
      }
    pkg = raw.bytes
  }
  try {
    const bytes = buildPart({
      index: idx.bytes,
      number: input.number,
      files,
      pkg,
      exportedAt: input.exportedAt,
    })
    return { ok: true, bytes, slug: index.slug, partCount: index.part_count }
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof ArchiveError ? error.message : 'the part could not be made',
    }
  }
}

/** The stored path of a restored original, under this office and this set. The package never names it. */
export const restorePathFor = (
  office: string,
  setKey: string,
  e: SetEntry,
  extension: ExtensionFor,
): string => `restores/${office}/${setKey}/${e.sha256}.${extOf(e.mime, extension)}`

const restoreRoot = (office: string, setKey: string) => `restores/${office}/${setKey}`
const markerOf = (office: string, setKey: string, number: number) =>
  `${restoreRoot(office, setKey)}/_parts/${String(number)}.json`
const indexOf = (office: string, setKey: string) => `${restoreRoot(office, setKey)}/_index.json`
const packageOf = (office: string, setKey: string) => `${restoreRoot(office, setKey)}/_package.json`
const committedOf = (office: string, setKey: string) =>
  `${restoreRoot(office, setKey)}/_committed.json`

interface Marker {
  readonly number: number
  readonly written: string[]
}

async function readMarkers(
  store: OriginalStore,
  office: string,
  setKey: string,
  count: number,
): Promise<Map<number, Marker>> {
  const out = new Map<number, Marker>()
  for (let n = 1; n <= count; n++) {
    const raw = await store.read(markerOf(office, setKey, n))
    if (raw !== null) out.set(n, JSON.parse(new TextDecoder().decode(raw.bytes)) as Marker)
  }
  return out
}

/**
 * Write one part's originals. The part must belong to the set the request names, carry exactly the files its index entries
 * name, and (for part 1) carry the package. Re-sending a part that already landed is answered as already received.
 */
export async function restorePart(input: {
  bytes: Uint8Array
  office: string
  setKey: string
  number: number
  store: OriginalStore
  extension: ExtensionFor
}): Promise<SetResult<{ number: number; partCount: number; written: number; already: boolean }>> {
  let opened: Awaited<ReturnType<typeof openPart>>
  try {
    opened = await openPart(input.bytes)
  } catch (error) {
    return {
      ok: false,
      status: 400,
      error: error instanceof ArchiveError ? error.message : 'the part could not be read',
    }
  }
  if ((await sha256Hex(opened.indexBytes)) !== input.setKey) {
    return { ok: false, status: 409, error: 'this part belongs to another set' }
  }
  if (opened.number !== input.number) {
    return {
      ok: false,
      status: 400,
      error: 'the part number in the file does not match the one requested',
    }
  }
  if (opened.number === 1) {
    const stored = await input.store.read(indexOf(input.office, input.setKey))
    if (stored === null) {
      const idx = await input.store.put(
        indexOf(input.office, input.setKey),
        opened.indexBytes,
        'application/json',
      )
      const pkg = await input.store.put(
        packageOf(input.office, input.setKey),
        opened.pkg ?? new Uint8Array(),
        'application/json',
      )
      if (!idx.ok || !pkg.ok)
        return {
          ok: false,
          status: 502,
          error: 'the set could not be recorded, so nothing was kept',
        }
    }
  } else {
    const have = await input.store.read(indexOf(input.office, input.setKey))
    if (have === null)
      return { ok: false, status: 409, error: 'send part 1 first: it carries the project itself' }
  }
  const already = await input.store.read(markerOf(input.office, input.setKey, input.number))
  if (already !== null) {
    const m = JSON.parse(new TextDecoder().decode(already.bytes)) as Marker
    // Received only if its files are still there. A marker whose files were removed (by a refused commit, say) is stale:
    // it is dropped, and the part is written again.
    let present = true
    for (const path of m.written) if ((await input.store.read(path)) === null) present = false
    if (present) {
      return {
        ok: true,
        number: input.number,
        partCount: opened.index.part_count,
        written: m.written.length,
        already: true,
      }
    }
    await input.store.remove(markerOf(input.office, input.setKey, input.number))
  }
  const writes = opened.index.entries
    .filter((e) => e.part === opened.number)
    .map((e) => e.archive_name)
    .filter((name, i, all) => all.indexOf(name) === i)
    .map((name) => {
      const data = opened.files.get(name)
      const e = opened.index.entries.find((x) => x.archive_name === name)
      if (data === undefined || e === undefined)
        throw new ArchiveError('a file the set names is missing')
      return {
        path: restorePathFor(input.office, input.setKey, e, input.extension),
        bytes: data,
        mime: e.mime,
        sha256: e.sha256,
      }
    })
  const result = await writeOriginals({ writes, store: input.store })
  if (!result.ok) return { ok: false, status: 502, error: result.reason }
  const marker: Marker = { number: input.number, written: result.written }
  const put = await input.store.put(
    markerOf(input.office, input.setKey, input.number),
    new TextEncoder().encode(JSON.stringify(marker)),
    'application/json',
  )
  if (!put.ok) {
    await discardOriginals({ store: input.store, written: result.written })
    return { ok: false, status: 502, error: 'the part could not be recorded, so it was not kept' }
  }
  return {
    ok: true,
    number: input.number,
    partCount: opened.index.part_count,
    written: result.written.length,
    already: false,
  }
}

/**
 * Create the project from a set once every part is present. The database call is handed the package with each original's
 * stored path set. If the database refuses, everything the set wrote is removed, so a refused commit leaves no file behind.
 */
export async function commitSet(input: {
  office: string
  setKey: string
  store: OriginalStore
  extension: ExtensionFor
  restore: (pkg: unknown) => Promise<{ ok: boolean; already?: boolean; error?: string } | null>
}): Promise<
  SetResult<{ already: boolean; out: { ok: boolean; already?: boolean; error?: string } }>
> {
  const rawIndex = await input.store.read(indexOf(input.office, input.setKey))
  if (rawIndex === null)
    return { ok: false, status: 404, error: 'there is no set to commit under that key' }
  if ((await sha256Hex(rawIndex.bytes)) !== input.setKey)
    return { ok: false, status: 409, error: 'the set key does not match' }
  const index = JSON.parse(new TextDecoder().decode(rawIndex.bytes)) as SetIndex
  const markers = await readMarkers(input.store, input.office, input.setKey, index.part_count)
  for (let n = 1; n <= index.part_count; n++) {
    if (!markers.has(n))
      return {
        ok: false,
        status: 409,
        error: `part ${String(n)} of ${String(index.part_count)} has not been received`,
      }
  }
  const pkgRaw = await input.store.read(packageOf(input.office, input.setKey))
  if (pkgRaw === null)
    return { ok: false, status: 409, error: 'the project itself has not been received' }
  const pkg = JSON.parse(new TextDecoder().decode(pkgRaw.bytes)) as {
    documents?: unknown
  } & Record<string, unknown>
  const attached = attachOriginals(pkg, index, (e) =>
    restorePathFor(input.office, input.setKey, e, input.extension),
  )
  if (!attached.ok) return { ok: false, status: 400, error: attached.reason }
  const out = await input.restore(attached.pkg).catch(() => null)
  const written = [...markers.values()].flatMap((m) => m.written)
  if (out === null || out.ok !== true) {
    // The files go, and so do the markers that said they were written: a part sent again must be written again, not
    // answered as already received, or a later commit would create a project over files that are not there.
    await discardOriginals({ store: input.store, written })
    for (const n of markers.keys())
      await input.store.remove(markerOf(input.office, input.setKey, n))
    // A refusal the database gave (a name in use, say) is the client's to act on: 400. A call that did not complete is 502.
    if (out === null) return { ok: false, status: 502, error: 'the restore could not be written' }
    return { ok: false, status: 400, error: out.error ?? 'the restore was refused' }
  }
  await input.store.put(
    committedOf(input.office, input.setKey),
    new TextEncoder().encode('{}'),
    'application/json',
  )
  return { ok: true, already: out.already === true, out }
}

/** Discard an uncommitted set: its originals and its markers. A committed set is refused, because its files now belong to a project. */
export async function abandonSet(input: {
  office: string
  setKey: string
  store: OriginalStore
}): Promise<SetResult<{ removed: number }>> {
  if ((await input.store.read(committedOf(input.office, input.setKey))) !== null) {
    return { ok: false, status: 409, error: 'this set was restored, so it cannot be abandoned' }
  }
  const rawIndex = await input.store.read(indexOf(input.office, input.setKey))
  if (rawIndex === null) return { ok: true, removed: 0 }
  const index = JSON.parse(new TextDecoder().decode(rawIndex.bytes)) as SetIndex
  const markers = await readMarkers(input.store, input.office, input.setKey, index.part_count)
  const written = [...markers.values()].flatMap((m) => m.written)
  // Count only what is really there to remove: a path already gone is not a removal.
  let removed = 0
  for (const path of written) if ((await input.store.read(path)) !== null) removed += 1
  await discardOriginals({ store: input.store, written })
  for (const n of markers.keys()) await input.store.remove(markerOf(input.office, input.setKey, n))
  await input.store.remove(packageOf(input.office, input.setKey))
  await input.store.remove(indexOf(input.office, input.setKey))
  return { ok: true, removed }
}

/** How long an export cache or an uncommitted restore may sit before the sweep removes it (the owner's rule, 15 October 2026). */
export const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000

/** One stored object: its path and when it was created (milliseconds), or NaN when the store did not say. */
export interface StoredItem {
  readonly path: string
  readonly createdAt: number
}

/**
 * Remove what an office's set work left behind, and nothing else:
 *   - an export cache whose newest object is older than the limit, all of its objects together;
 *   - a restore that never committed (no committed marker) whose newest object is older than the limit, all of its objects.
 * A committed restore is never removed, because its files now belong to a project. An object whose age the store did not
 * report is kept: a sweep that guesses removes data it should not. Returns what it removed, so the caller can report it.
 */
export async function sweepOffice(input: {
  office: string
  now: number
  items: readonly StoredItem[]
  store: OriginalStore
}): Promise<{ removed: number; exportCaches: number; abandonedSets: number }> {
  const exportsPrefix = `exports/${input.office}/`
  const restorePrefix = `restores/${input.office}/`
  const groups = new Map<string, { kind: 'export' | 'restore'; items: StoredItem[] }>()
  for (const item of input.items) {
    let key: string | null = null
    let kind: 'export' | 'restore' = 'export'
    if (item.path.startsWith(exportsPrefix)) {
      key = `e:${item.path.slice(exportsPrefix.length).split('/')[0] ?? ''}`
    } else if (item.path.startsWith(restorePrefix)) {
      kind = 'restore'
      key = `r:${item.path.slice(restorePrefix.length).split('/')[0] ?? ''}`
    }
    if (key === null || key.endsWith(':')) continue
    const group = groups.get(key) ?? { kind, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  let removed = 0
  let exportCaches = 0
  let abandonedSets = 0
  for (const group of groups.values()) {
    const committed =
      group.kind === 'restore' && group.items.some((i) => i.path.endsWith('/_committed.json'))
    if (committed) continue
    const newest = Math.max(...group.items.map((i) => i.createdAt))
    // NaN fails every comparison, so an object whose age the store did not report keeps its group.
    if (!(input.now - newest > SWEEP_AFTER_MS)) continue
    for (const item of group.items) {
      if (await input.store.remove(item.path)) removed += 1
    }
    if (group.kind === 'export') exportCaches += 1
    else abandonedSets += 1
  }
  return { removed, exportCaches, abandonedSets }
}
