/**
 * What a Python function bundle holds, modelled from the page upload set and a function's `excludeFiles`.
 *
 * Vercel packs every file of the deployment into each Python function except what its `excludeFiles` matches (plus the installed
 * dependencies, which this model does not carry: they are the same in every variant). This is the same rule the preview
 * experiment measured, so a bundle built here and served locally behaves like the deployed one for everything that depends on
 * which FILES are present. It cannot say anything about size on disk after Vercel's own packing (only a preview can), and it says
 * so: `bytes` is the raw size of the uploaded files kept.
 *
 * Pure: no filesystem, no network. scripts/verify/notebook-bundle.ts materialises and serves what this returns.
 */
import { excludes } from './function-exclude.ts'

export interface BundleModel {
  /** Paths kept in the bundle, sorted. */
  kept: string[]
  /** Paths the exclusion removed, sorted. */
  removed: string[]
  /** Raw bytes of the kept and removed uploaded files. */
  keptBytes: number
  removedBytes: number
}

/** The files of `uploaded` (path to size) that survive `globs`. A path is removed if ANY glob excludes it. */
export function modelBundle(
  uploaded: ReadonlyMap<string, number>,
  globs: readonly string[],
): BundleModel {
  const kept: string[] = []
  const removed: string[] = []
  let keptBytes = 0
  let removedBytes = 0
  for (const [path, size] of uploaded) {
    if (globs.some((g) => excludes(g, path))) {
      removed.push(path)
      removedBytes += size
    } else {
      kept.push(path)
      keptBytes += size
    }
  }
  return { kept: kept.sort(), removed: removed.sort(), keptBytes, removedBytes }
}
