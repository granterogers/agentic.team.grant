/**
 * A fingerprint of everything that decides what a Team HQ page deployment serves and how its functions run, so a redeploy
 * that would change nothing can be skipped, and one that would change something never is.
 *
 * Skipping is the dangerous direction: a missed input is a deployment that was needed and did not happen. So the rule fails
 * toward deploying. Anything unknown (no recorded fingerprint, a live deployment that is not READY, a different algorithm
 * version) means deploy. The fingerprint is stored on the deployment itself (`meta.pageFingerprint`), so the comparison reads
 * what is live, not a local file that can go stale.
 *
 * What it covers, and why each is an input (every row has a mutation in the test):
 *   - every uploaded file, by path and content digest: page code, assets, the two Python functions, `act.py`,
 *     `requirements.txt`, `vercel.json` (all are files in the upload, so the function configuration is covered too), and
 *     the generated, gitignored `web/studio/config.js` that `npm run config:site` writes from the environment. That one is
 *     only an input if it exists when the files are collected, so FINGERPRINT AFTER `config:site` RUNS; a tree without it
 *     fingerprints differently, which is the safe direction (a deployment without it points the page at no office);
 *   - the deployment request fields that are not files: name, target, projectSettings;
 *   - the project's build settings and its environment variable NAMES (adding or removing a variable needs a redeploy);
 *   - for every environment variable the deploy script does NOT itself supply, the time Vercel last updated it (a value
 *     changed by hand in the dashboard keeps its name and changes this); for a variable the script DOES supply, a salted
 *     digest of its value instead (the notebook reader secret: a rotation changes what the functions accept, and nothing in
 *     the files shows it). The value itself is never in the fingerprint inputs, a log or a request;
 *   - the algorithm version, so changing this file forces one redeploy.
 *
 * What it cannot cover, stated so nobody assumes otherwise: a new release of an UNPINNED dependency (`requirements.txt` names
 * `notebooklm-py` without a version, so identical inputs can rebuild to a different bundle) and Vercel's own build image.
 * Skipping in those cases means a dependency update is picked up at the next real change rather than by an identical
 * redeploy, which is the intended trade; `unpinnedRequirements` lets the deploy say so out loud.
 */
import { createHash } from 'node:crypto'
import type { UploadFile } from './page-files.ts'

/** Bump when the set of inputs or the encoding changes; the next run then deploys once. */
export const FINGERPRINT_SCHEMA = 2

/** The key the fingerprint is stored under in the deployment's `meta`. */
export const FINGERPRINT_META_KEY = 'pageFingerprint'

/**
 * The keys of the deployment request body, split by whether they decide what is deployed. A key in neither list is an input
 * this fingerprint does not know about; `tests/deploy/page-fingerprint.test.ts` fails when a deploy script sends one.
 */
export const COVERED_BODY_KEYS = ['name', 'target', 'files', 'projectSettings'] as const
/** Sent with the deployment but not an input: the fingerprint itself is stored here. */
export const OUTPUT_ONLY_BODY_KEYS = ['meta'] as const

/** Project settings that can change what a build produces. */
export const BUILD_AFFECTING_PROJECT_FIELDS = [
  'framework',
  'buildCommand',
  'devCommand',
  'installCommand',
  'outputDirectory',
  'rootDirectory',
  'nodeVersion',
  'serverlessFunctionRegion',
  'sourceFilesOutsideRootDirectory',
  'commandForIgnoringBuildStep',
  'autoExposeSystemEnvs',
] as const

export interface PageInputs {
  files: readonly UploadFile[]
  /** The non-file fields of the deployment request. */
  deployment: { name: string; target: string; projectSettings: unknown }
  /**
   * The project's build-affecting settings (see BUILD_AFFECTING_PROJECT_FIELDS), its environment variable names, and for each
   * variable the script does not supply, when Vercel last updated it (null for one the script supplies: see envDigests).
   */
  project: {
    settings: Record<string, unknown>
    envNames: readonly string[]
    envStamps: Readonly<Record<string, number | null>>
  }
  /** Digest of each environment value the deploy supplies, by variable name. Never the value. */
  envDigests: Readonly<Record<string, string>>
}

/** A digest that is not the bare hash of a secret: it is salted with a fixed label, and it is never printed. */
export const envDigest = (value: string): string =>
  createHash('sha256').update(`page-fingerprint:v${FINGERPRINT_SCHEMA}:env:${value}`).digest('hex')

export const pickProjectSettings = (project: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    BUILD_AFFECTING_PROJECT_FIELDS.map((k) => [k, project[k] === undefined ? null : project[k]]),
  )

/** JSON with every object's keys sorted, so the same inputs always encode to the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function pageFingerprint(inputs: PageInputs, schema: number = FINGERPRINT_SCHEMA): string {
  const files = [...inputs.files]
    .map((f) => ({ file: f.file, sha: f.sha, size: f.size }))
    .sort((a, b) => a.file.localeCompare(b.file))
  const names = [...inputs.project.envNames].sort()
  return createHash('sha256')
    .update(
      canonicalJson({
        schema,
        files,
        deployment: inputs.deployment,
        project: {
          settings: inputs.project.settings,
          envNames: names,
          envStamps: inputs.project.envStamps,
        },
        envDigests: inputs.envDigests,
      }),
    )
    .digest('hex')
}

export interface SkipDecision {
  skip: boolean
  reason: string
}

/**
 * Skip only when the live production deployment is READY and recorded exactly this fingerprint. Every other case deploys.
 * `force` exists because a person can always know something the inputs do not (a platform incident, a suspect deployment).
 */
export function decideSkip(
  live: { state: string; meta?: Record<string, string> | null } | null,
  fingerprint: string,
  force = false,
): SkipDecision {
  if (force) return { skip: false, reason: 'forced' }
  if (live === null) return { skip: false, reason: 'no live deployment to compare with' }
  if (live.state !== 'READY')
    return { skip: false, reason: `live deployment is ${live.state}, not READY` }
  const recorded = live.meta?.[FINGERPRINT_META_KEY]
  if (recorded === undefined || recorded === '') {
    return {
      skip: false,
      reason: 'the live deployment recorded no fingerprint (made before this check)',
    }
  }
  if (recorded !== fingerprint)
    return { skip: false, reason: 'an input changed since the live deployment' }
  return { skip: true, reason: 'every input matches the live deployment' }
}

/** Requirement lines with no exact version pin. An unpinned line means identical inputs can build to different output. */
export function unpinnedRequirements(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l !== '' && !l.startsWith('-') && !/==[^=]/.test(l))
}
