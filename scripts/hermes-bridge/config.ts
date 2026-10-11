/**
 * The bridge's configuration, read from its own environment, and the things it refuses to start with.
 *
 * The bridge is outbound-only and holds exactly two secrets: its bridge token (which can claim, heartbeat and finish ONE office's
 * Hermes runs and nothing else) and the key to the Hermes API on this same machine. It never holds a database credential, so an
 * environment that carries one is refused outright rather than trusted not to use it.
 */
import { OFFICE_TOOL_PREFIX } from '../../src/engines/hermes/timing.ts'
import type { BridgeConfig } from '../../src/engines/hermes/types.ts'

export type ConfigResult =
  | { readonly ok: true; readonly config: BridgeConfig }
  | { readonly ok: false; readonly problems: readonly string[] }

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** Names that mean "a database or Supabase credential". A bridge host has no business holding any of them. */
const FORBIDDEN = /^(SUPABASE_|DATABASE_URL$|POSTGRES|PG(HOST|PASSWORD|USER|DATABASE)$)/i
const BRIDGE_TOKEN = /^ebt_[0-9a-f]{64}$/

const parse = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export const parseBridgeConfig = (
  env: Readonly<Record<string, string | undefined>>,
): ConfigResult => {
  const problems: string[] = []

  const forbidden = Object.keys(env).filter((k) => FORBIDDEN.test(k) && (env[k] ?? '') !== '')
  if (forbidden.length > 0)
    problems.push(
      `the bridge's environment holds a database or Supabase credential (${forbidden.join(', ')}); the bridge never needs one, so it will not start with one`,
    )

  const yolo = env.HERMES_YOLO_MODE
  if (yolo !== undefined && yolo !== '' && !/^(0|false|no|off)$/i.test(yolo))
    problems.push('HERMES_YOLO_MODE is set; it disables every approval and must be unset')

  const token = env.ENGINE_BRIDGE_TOKEN ?? ''
  if (!BRIDGE_TOKEN.test(token))
    problems.push('ENGINE_BRIDGE_TOKEN is missing or is not a bridge token')

  const gateway = parse(env.ENGINE_GATEWAY_URL ?? '')
  const insecureOk = env.ENGINE_BRIDGE_ALLOW_INSECURE_LOOPBACK === '1'
  if (gateway === null) {
    problems.push('ENGINE_GATEWAY_URL is missing or is not a URL')
  } else {
    const loopback = LOOPBACK.has(gateway.hostname)
    if (gateway.protocol !== 'https:' && !(insecureOk && loopback && gateway.protocol === 'http:'))
      problems.push('ENGINE_GATEWAY_URL must be https')
    if (gateway.username !== '' || gateway.password !== '')
      problems.push('ENGINE_GATEWAY_URL must not carry credentials')
    if (gateway.search !== '' || gateway.hash !== '')
      problems.push('ENGINE_GATEWAY_URL must not carry a query or a fragment')
  }

  const hermesRaw = env.HERMES_URL ?? 'http://127.0.0.1:8642'
  const hermes = parse(hermesRaw)
  if (hermes === null) problems.push('HERMES_URL is not a URL')
  else if (!LOOPBACK.has(hermes.hostname) || hermes.protocol !== 'http:')
    problems.push(
      'HERMES_URL must be http on this machine (127.0.0.1, localhost or ::1): Hermes is never reached over a network',
    )

  const key = env.HERMES_API_KEY ?? ''
  if (key.length < 32) problems.push('HERMES_API_KEY is missing or shorter than 32 characters')

  // Learning is off unless the host names a directory for it. Each must be absolute, a real place (never the root or a home directory),
  // and the two must not contain one another: a learning run's own folder is deleted, and the export is replaced, so neither may be
  // somebody's working directory.
  const dirOf = (name: string): string | undefined => {
    const v = (env[name] ?? '').trim()
    if (v === '') return undefined
    if (
      !v.startsWith('/') ||
      v.split('/').filter(Boolean).length < 2 ||
      v.includes('..') ||
      /[\0\r\n]/.test(v)
    )
      problems.push(`${name} must be an absolute path at least two levels deep, with no '..'`)
    return v.replace(/\/+$/, '')
  }
  const learnDir = dirOf('HERMES_LEARN_DIR')
  const skillsExportDir = dirOf('HERMES_SKILLS_EXPORT_DIR')
  if (learnDir !== undefined && skillsExportDir !== undefined) {
    if (
      learnDir === skillsExportDir ||
      learnDir.startsWith(`${skillsExportDir}/`) ||
      skillsExportDir.startsWith(`${learnDir}/`)
    )
      problems.push(
        'HERMES_LEARN_DIR and HERMES_SKILLS_EXPORT_DIR must be two separate directories, neither inside the other',
      )
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    config: {
      gatewayUrl: (gateway as URL).toString().replace(/\/+$/, ''),
      bridgeToken: token,
      hermesUrl: (hermes as URL).toString().replace(/\/+$/, ''),
      hermesKey: key,
      officeToolPrefix: OFFICE_TOOL_PREFIX,
      ...(learnDir === undefined ? {} : { learnDir }),
      ...(skillsExportDir === undefined ? {} : { skillsExportDir }),
    },
  }
}
