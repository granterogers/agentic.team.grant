/**
 * Starts a REAL Hermes API server (the pinned source, installed outside this repository) with a per-run home directory.
 *
 * Hermes is untrusted code: it gets a minimal environment (no credential from this shell), its own HERMES_HOME, and a working
 * directory that is not inside either its own source or this repository. The caller stops it.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Child, sleep, start, waitFor } from './lib.ts'

/** Every built-in toolset the contracts disable (INTERFACE-CONTRACTS.md section 6). */
export const DISABLED_TOOLSETS = [
  'terminal',
  'file',
  'web',
  'search',
  'browser',
  'vision',
  'image_gen',
  'skills',
  'skills_hub',
  'todo',
  'tts',
  'cronjob',
  'memory',
  'session_search',
  'code_execution',
  'delegation',
  'clarify',
  'messaging',
  'connections',
  'kanban',
  'project',
  'context_engine',
  'computer_use',
] as const

export const OFFICE_READ_TOOLS = [
  'list_projects',
  'search_documents',
  'read_document',
  'search_project',
  'list_tasks',
  'list_staff',
  'recent_work',
  'check_job',
  'inspect_activity',
  'list_events',
] as const

export interface HermesOptions {
  /** Directory holding venv/, src/, work/ (the M0 host area). */
  readonly hostDir: string
  /** A fresh directory for this run's HERMES_HOME. */
  readonly home: string
  readonly outDir: string
  readonly port: number
  readonly apiKey: string
  /** The model endpoint Hermes talks to (the double, or the guard). Never a real provider. */
  readonly modelBase: string
  readonly modelName?: string
  readonly modelKey?: string
  /** model.context_length. Default 131072; null omits it so Hermes detects the window itself (used to test its 64K floor). */
  readonly contextLength?: number | null
  readonly mcpUrl?: string
  readonly mcpToken?: string
  /** Which office tools Hermes may expose (default: the v1 read list). A test widens it to prove the SERVER still refuses. */
  readonly mcpInclude?: readonly string[]
  readonly maxConcurrentRuns?: number
  /** Extra YAML appended verbatim, for the experiments that vary the config. */
  readonly extraConfig?: string
  /** Replace the platform toolset list (default: only the office server). */
  readonly toolsets?: readonly string[]
  readonly disabledToolsets?: readonly string[]
  /**
   * tools.tool_search.enabled. Hermes's default ("auto") hides MCP tools behind three bridge tools (tool_search, tool_describe,
   * tool_call); "off" offers each MCP tool to the model by its own name. M0 finding V12: the contracts need "off".
   */
  readonly toolSearch?: 'off' | 'auto' | 'on'
  readonly env?: Record<string, string>
  /** Reuse an existing home instead of wiping it (to test what survives a restart). */
  readonly keepHome?: boolean
  /** skills.create_dir: where Hermes writes a skill it creates (an isolated directory the bridge can harvest). */
  readonly skillsCreateDir?: string
  /** The fetch used for the start-up health probe. A proof whose global fetch is wrapped by the edge emulator passes the real one. */
  readonly fetcher?: (input: string) => Promise<Response>
  readonly label: string
}

export interface HermesHost {
  readonly url: string
  readonly child: Child
  readonly key: string
  stop: () => Promise<void>
}

export const configYaml = (o: HermesOptions): string => {
  const toolsets = o.toolsets ?? (o.mcpUrl === undefined ? [] : ['office'])
  const disabled = o.disabledToolsets ?? DISABLED_TOOLSETS
  const mcp =
    o.mcpUrl === undefined
      ? 'mcp_servers: {}'
      : [
          'mcp_servers:',
          '  office:',
          `    url: "${o.mcpUrl}"`,
          '    headers:',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal placeholder that Hermes interpolates from its own environment
          '      Authorization: "Bearer ${OFFICE_ENGINE_MCP_TOKEN}"',
          '    trust: full',
          '    connect_timeout: 20',
          '    tools:',
          `      include: [${(o.mcpInclude ?? OFFICE_READ_TOOLS).join(', ')}]`,
        ].join('\n')
  return [
    'model:',
    '  provider: custom',
    `  default: "${o.modelName ?? 'mock-model'}"`,
    `  base_url: "${o.modelBase}/v1"`,
    `  api_key: "${o.modelKey ?? 'dummy-model-key'}"`,
    ...(o.contextLength === null
      ? []
      : [`  context_length: ${String(o.contextLength ?? 131_072)}`]),
    'auxiliary:',
    '  free_only: true',
    'background_review:',
    '  enabled: false',
    'memory:',
    '  memory_enabled: false',
    '  user_profile_enabled: false',
    'skills:',
    '  creation_nudge_interval: 0',
    ...(o.skillsCreateDir === undefined ? [] : [`  create_dir: "${o.skillsCreateDir}"`]),
    'gateway:',
    '  api_server:',
    `    max_concurrent_runs: ${String(o.maxConcurrentRuns ?? 1)}`,
    'platform_toolsets:',
    `  api_server: [${toolsets.join(', ')}]`,
    'agent:',
    `  disabled_toolsets: [${disabled.join(', ')}]`,
    'tools:',
    '  tool_search:',
    // Quoted: an unquoted off is a YAML boolean.
    `    enabled: "${o.toolSearch ?? 'off'}"`,
    mcp,
    o.extraConfig ?? '',
    '',
  ].join('\n')
}

export const startHermes = async (o: HermesOptions): Promise<HermesHost> => {
  if (o.keepHome !== true) rmSync(o.home, { recursive: true, force: true })
  mkdirSync(o.home, { recursive: true })
  const work = join(o.hostDir, 'work')
  mkdirSync(work, { recursive: true })
  writeFileSync(join(o.home, 'config.yaml'), configYaml(o))
  const env: Record<string, string> = {
    PATH: `${join(o.hostDir, 'venv/bin')}:/usr/bin:/bin`,
    HOME: work,
    HERMES_HOME: o.home,
    API_SERVER_ENABLED: 'true',
    API_SERVER_HOST: '127.0.0.1',
    API_SERVER_PORT: String(o.port),
    API_SERVER_KEY: o.apiKey,
    ...(o.mcpToken === undefined ? {} : { OFFICE_ENGINE_MCP_TOKEN: o.mcpToken }),
    ...(o.env ?? {}),
  }
  const child = start(join(o.hostDir, 'venv/bin/hermes'), ['gateway', 'run'], {
    env,
    cwd: work,
    logFile: join(o.outDir, `hermes-${o.label}.log`),
  })
  const url = `http://127.0.0.1:${String(o.port)}`
  try {
    await waitFor(
      'the Hermes API server',
      async () => (await (o.fetcher ?? fetch)(`${url}/health`)).ok,
      90_000,
      500,
    )
  } catch (error) {
    await child.stop()
    throw error
  }
  // Let MCP discovery finish: it runs after the HTTP listener is up.
  await sleep(1500)
  return { url, child, key: o.apiKey, stop: () => child.stop() }
}

/** An authenticated call to the local Hermes API. */
export const hermes = async (
  host: HermesHost,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown; headers: Headers }> => {
  const response = await fetch(`${host.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${host.key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    /* keep text */
  }
  return { status: response.status, body: parsed, headers: response.headers }
}
