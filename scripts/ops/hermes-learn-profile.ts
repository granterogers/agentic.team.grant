// biome-ignore-all format: a dense host command kept readable as written
/**
 * Create the `hermes-learn` profile on a Hermes host (Hermes, M8 host completion). A HOST command, run by the person who installs Hermes, as the
 * user Hermes runs as. It reads no office credential, calls nothing, and prints no secret.
 *
 *   npm run hermes:learn-profile -- --hermes-home=/var/lib/hermes/home --learn-dir=/var/lib/hermes/learn \
 *       --export-dir=/var/lib/hermes-skills-export/office --mcp-url=https://<project-ref>.supabase.co/functions/v1/mcp \
 *       --model=nvidia/nemotron-3-super-120b-a12b:free
 *
 * It writes `$HERMES_HOME/profiles/hermes-learn/config.yaml`, rendered by the product's own module (src/engines/hermes/learn-profile.ts, the one the
 * real-Hermes proof ran), and `.env` beside it. With two profiles Hermes multiplexes and reads a secret from the PROFILE'S OWN `.env` (a process
 * environment variable is not seen), so the profile needs the Hermes API key, the office MCP token and the Hermes-only zero-limit model key: they are COPIED from the default profile's
 * `.env` (mode 0600), never typed, never printed. It refuses a model that is not a `:free` slug, a directory that is not absolute, an export
 * directory inside Hermes's own home or the learn directory, and a default `.env` that lacks the three values.
 *
 * Isolation is not done here and cannot be: see docs/hermes/host/RUNBOOK.md 9a (the export directory's parent is read-only to Hermes's unit).
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import '../../src/safety/arm.ts' // this command makes no request; armed so that none to a production host could be made by accident
import { learnProfileConfig } from '../../src/engines/hermes/learn-profile.ts'

export interface ProvisionOptions {
  readonly hermesHome: string
  readonly learnDir: string
  readonly exportDir: string
  readonly mcpUrl: string
  /** A model slug, which must end in `:free`. */
  readonly model: string
}

export interface Provisioned {
  readonly profileDir: string
  readonly wrote: readonly string[]
}

const abs = (p: string): boolean => p.startsWith('/') && !p.split('/').includes('..') && p.split('/').filter(Boolean).length >= 2
const inside = (inner: string, outer: string): boolean => {
  const rel = relative(resolve(outer), resolve(inner))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}
const SLUG = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i
const NEEDED = ['API_SERVER_KEY', 'OFFICE_ENGINE_MCP_TOKEN', 'OPENROUTER_API_KEY'] as const

/** The three values the profile needs, read from the default profile's .env. Null for one that is absent or empty. */
export const readNeeded = (envText: string): Record<(typeof NEEDED)[number], string | null> => {
  const out: Record<string, string | null> = { API_SERVER_KEY: null, OFFICE_ENGINE_MCP_TOKEN: null, OPENROUTER_API_KEY: null }
  for (const line of envText.split(/\r?\n/)) {
    const m = /^\s*(API_SERVER_KEY|OFFICE_ENGINE_MCP_TOKEN|OPENROUTER_API_KEY)\s*=\s*(.*?)\s*$/.exec(line)
    if (m !== null) {
      const v = (m[2] ?? '').replace(/^["']|["']$/g, '')
      if (v !== '') out[m[1] as string] = v
    }
  }
  return out as Record<(typeof NEEDED)[number], string | null>
}

export async function provisionLearnProfile(o: ProvisionOptions): Promise<Provisioned> {
  for (const [name, p] of [['hermes home', o.hermesHome], ['learn directory', o.learnDir], ['export directory', o.exportDir]] as const)
    if (!abs(p)) throw new Error(`the ${name} must be an absolute path of at least two segments with no "..": ${p.slice(0, 80)}`)
  if (!o.model.endsWith(':free') || !SLUG.test(o.model)) throw new Error('the model must be a :free slug (vendor/name:free): the zero-spend rule is the provider\'s, not ours, and a slug without :free is refused here')
  if (!/^https:\/\/[a-z0-9.-]+\/functions\/v1\/mcp$/i.test(o.mcpUrl)) throw new Error('the MCP URL must be https://<host>/functions/v1/mcp')
  if (inside(o.exportDir, o.hermesHome) || inside(o.hermesHome, o.exportDir)) throw new Error('the export directory must be OUTSIDE Hermes\'s home: Hermes must not be able to write it')
  if (inside(o.exportDir, o.learnDir) || inside(o.learnDir, o.exportDir)) throw new Error('the learn directory and the export directory must be separate, neither inside the other')

  const defaultEnv = await readFile(join(o.hermesHome, '.env'), 'utf8').catch(() => '')
  const needed = readNeeded(defaultEnv)
  const missing = NEEDED.filter((k) => needed[k] === null)
  if (missing.length > 0) throw new Error(`the default profile's .env does not hold ${missing.join(' and ')}: set them there first (the learning profile copies them; it never asks you to type a secret)`)

  const profileDir = join(o.hermesHome, 'profiles', 'hermes-learn')
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  await mkdir(o.learnDir, { recursive: true })
  const config = learnProfileConfig({
    modelBlock: `model:\n  provider: openrouter\n  default: "${o.model}"`,
    createDir: o.learnDir,
    exportDir: o.exportDir,
    mcpUrl: o.mcpUrl,
  })
  const wrote: string[] = []
  await writeFile(join(profileDir, 'config.yaml'), config, { mode: 0o644 })
  wrote.push('config.yaml')
  await writeFile(join(profileDir, '.env'), `API_SERVER_KEY=${needed.API_SERVER_KEY}\nOFFICE_ENGINE_MCP_TOKEN=${needed.OFFICE_ENGINE_MCP_TOKEN}\nOPENROUTER_API_KEY=${needed.OPENROUTER_API_KEY}\n`, { mode: 0o600 })
  await chmod(join(profileDir, '.env'), 0o600)
  wrote.push('.env')
  return { profileDir, wrote }
}

if (process.argv[1] !== undefined && /hermes-learn-profile\.ts$/.test(process.argv[1])) {
  const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
  try {
    const r = await provisionLearnProfile({ hermesHome: arg('hermes-home'), learnDir: arg('learn-dir'), exportDir: arg('export-dir'), mcpUrl: arg('mcp-url'), model: arg('model') })
    console.log(`wrote ${r.wrote.join(' and ')} in ${r.profileDir} (the three secrets were copied from the default profile's .env and are not shown)`)
    console.log('next: make the export directory read-only to Hermes (docs/hermes/host/RUNBOOK.md 9a), restart hermes-gateway, then check /p/hermes-learn/v1/toolsets')
  } catch (error) {
    console.error(String((error as Error).message))
    process.exit(1)
  }
}
