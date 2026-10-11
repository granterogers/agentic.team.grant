/**
 * The bridge's two skill duties (Hermes, M8b; docs/hermes/LEARNING-AND-SKILL-TRANSFER.md sections 6 and 7). Both are OFF unless the host
 * names a directory for them, and the office only hands the bridge a learning run when it has switched learning on for itself.
 *
 *   export   The office's approved, live skills for the claimed run, written as read-only reference files into a directory Hermes lists in
 *            `skills.external_dirs` (a place Hermes can read and never writes). The directory is REPLACED as a whole, atomically, on every
 *            run, so a skill that was withdrawn, superseded or never approved cannot be left behind; and when the office cannot be asked,
 *            or the run is not a learning run, the directory is EMPTIED (fail closed: stale material is never the fallback).
 *   harvest  After a learning run, read what Hermes wrote into an empty directory made for that run, hand each draft (at most three) to the
 *            office as a PROPOSAL, and delete the directory. Nothing is kept on the host between runs, so Hermes can never reuse a skill
 *            nobody approved. Hermes's own skills guard checks installs and not what it writes itself, so the office's validator is the gate.
 *
 * Nothing here decides whether a skill is good. It moves text between two directories and the office, and the office decides.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { HermesSkillDraft } from '../../src/engines/hermes/skills.ts'
import { parseSkillMd, SLUG, skillFile } from '../../src/engines/hermes/skills.ts'

export const MAX_DRAFTS = 3
export const MAX_FILE_BYTES = 20_000
export const MAX_ENTRIES = 400
const MAX_DEPTH = 4
const EXPORT_MARK = '.office-skills-export'

export interface ExportedSkill {
  readonly slug: string
  readonly name: string
  readonly when_to_use: string
  readonly procedure: string
}

/**
 * Replace `dir` with the given skills, atomically: write a sibling, move the old one aside, move the new one in, delete the old.
 * A directory that is not one this function made (no marker) is refused: the bridge is never pointed at somebody's own folder.
 */
export const writeExport = async (
  dir: string,
  skills: readonly ExportedSkill[],
): Promise<number> => {
  await assertOurs(dir)
  const fresh = `${dir}.new`
  const old = `${dir}.old`
  await rm(fresh, { recursive: true, force: true })
  await rm(old, { recursive: true, force: true })
  await mkdir(fresh, { recursive: true })
  await writeFile(join(fresh, EXPORT_MARK), 'written by the engine bridge; replaced on every run\n')
  let written = 0
  for (const s of skills) {
    // The folder name is the office's slug or it is nothing: a name a model chose never becomes a path.
    if (!SLUG.test(s.slug)) continue
    await mkdir(join(fresh, s.slug), { recursive: true })
    await writeFile(join(fresh, s.slug, 'SKILL.md'), skillFile(s))
    written += 1
  }
  if (await exists(dir)) await rename(dir, old)
  await rename(fresh, dir)
  await rm(old, { recursive: true, force: true })
  return written
}

/** Leave `dir` empty (still ours), so nothing exported earlier can be read. */
export const clearExport = async (dir: string): Promise<void> => {
  await writeExport(dir, [])
}

const exists = async (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  )

const assertOurs = async (dir: string): Promise<void> => {
  if (!(await exists(dir))) return
  if (!(await exists(join(dir, EXPORT_MARK))))
    throw new Error(
      'the skills export directory exists and is not one this bridge made; it will not be replaced',
    )
}

/** Delete a per-run directory entirely and make it again empty, so what Hermes writes next is only what that run wrote. */
export const emptyDir = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

const walk = async (root: string, dir: string, depth: number, out: string[]): Promise<void> => {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (out.length >= MAX_ENTRIES) return
    const full = join(dir, entry.name)
    // A link is never followed: it could point out of the directory.
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await walk(root, full, depth + 1, out)
    else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'))
  }
}

/**
 * What Hermes wrote in a per-run directory: every `SKILL.md` it can read as a name, a description and a body, at most three, each at most
 * 20 KB, with the NAMES (never the contents) of the other files beside it. Anything unreadable is skipped, not repaired.
 */
export const harvestDrafts = async (dir: string): Promise<HermesSkillDraft[]> => {
  if (!(await exists(dir))) return []
  const all: string[] = []
  await walk(dir, dir, 0, all)
  const drafts: HermesSkillDraft[] = []
  for (const path of all.filter((p) => /(^|\/)SKILL\.md$/.test(p)).sort()) {
    if (drafts.length >= MAX_DRAFTS) break
    const info = await stat(join(dir, path))
    if (info.size > MAX_FILE_BYTES) continue
    const parsed = parseSkillMd(await readFile(join(dir, path), 'utf8'))
    if (parsed === null) continue
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    drafts.push({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      files: all
        .filter((p) => p.startsWith(folder) && !p.endsWith('SKILL.md'))
        .map((p) => p.slice(folder.length)),
    })
  }
  return drafts
}
