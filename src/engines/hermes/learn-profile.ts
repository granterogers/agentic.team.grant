/**
 * The `hermes-learn` profile, as the host runs it (Hermes, M8 host completion).
 *
 * A learning run is answered by a SECOND Hermes profile, served by the same gateway under `/p/hermes-learn/` (Hermes multiplexes profiles; a
 * prefix the host does not serve is a 404 and the run fails closed, never answered by the default profile). It differs from the default profile in
 * exactly three things, and everything else the host kit says about the default profile still holds:
 *
 *   1. the `skills` toolset is ON, so Hermes can SEE a reference skill and can WRITE a new one (and nothing else is added: no skills hub, no terminal,
 *      no files, no web, no memory, no delegation);
 *   2. `skills.create_dir` is the learn directory: a skill Hermes writes lands there, where the bridge reads it, proposes it and deletes it;
 *   3. `skills.external_dirs` lists the export directory: the office's approved skills, written by the bridge, offered as read-only reference.
 *
 * What makes the export directory read-only is NOT this file and NOT Hermes: Hermes's own `skill_manage` edits and deletes a skill in an external
 * directory unless the operating system refuses (measured, scripts/hermes-m0/m8-learning-probe.ts P8). So the host must run Hermes as a user that
 * cannot write that directory (docs/hermes/host/RUNBOOK.md 9a; proved on a real Hermes by scripts/isolated/engine-learning-host.ts).
 *
 * Pure: values in, text out. Nothing here reads the environment or the disk.
 */
import { ENGINE_READ_TOOLS } from './timing.ts'

export const LEARN_PROFILE = 'hermes-learn'

/** The URL prefix the bridge's learning client uses. */
export const LEARN_PREFIX = `/p/${LEARN_PROFILE}`

/** The only enabled toolsets a learning profile may report: the office's MCP server and the skills toolset. Anything else fails the learning preflight. */
export const LEARN_TOOLSETS_ALLOWED: readonly string[] = ['office', 'skills']

/**
 * The tools of the `skills` toolset, which a learning run may call and no other run may: list and read skills, and write one (`skill_manage`, which
 * is how Hermes drafts a skill into skills.create_dir). A tool outside the office's read tools and this list still stops the run as a containment
 * event. Found by the real-Hermes end-to-end run: without this every learning run that touched a skill tool was killed by the bridge's own check.
 */
export const LEARN_TOOLS: readonly string[] = ['skills_list', 'skill_view', 'skill_manage']

/** Every built-in toolset the DEFAULT profile disables, minus `skills`, which the learning profile turns on and nothing else. */
export const LEARN_DISABLED_TOOLSETS: readonly string[] = [
  'terminal',
  'file',
  'web',
  'search',
  'browser',
  'vision',
  'image_gen',
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
]

/**
 * Whether the learning profile's enabled BUILT-IN toolsets are safe to run a learning run on: readable, and nothing outside the allowed pair.
 * Hermes's `/v1/toolsets` lists only its built-in toolsets (the office's MCP server is not one of them, measured on the pinned commit), so on a
 * correctly configured learning profile the answer is `skills` alone, and on the default profile it is nothing at all. `skills_hub`, a terminal, files,
 * the web, memory or anything else enabled fails it, and so does a list that could not be read.
 */
export const learnToolsetsOk = (enabled: readonly string[] | null): boolean =>
  enabled !== null && enabled.every((name) => LEARN_TOOLSETS_ALLOWED.includes(name))

export interface LearnProfileOptions {
  /** `model:` block, rendered verbatim as already-indented lines (the host's own model choice; it must be a `:free` model). */
  readonly modelBlock: string
  /** Where Hermes writes a skill it creates; the bridge's HERMES_LEARN_DIR. Absolute. */
  readonly createDir: string
  /** The reference directory; the bridge's HERMES_SKILLS_EXPORT_DIR. Absolute, outside every path Hermes's own unit may write. */
  readonly exportDir: string
  readonly mcpUrl: string
  readonly mcpInclude?: readonly string[]
  /** 0 = Hermes is never nudged to write a skill; a positive number lets it propose after that many tool calls. */
  readonly creationNudgeInterval?: number
}

const quote = (s: string): string => `"${s.replace(/["\\\n\r]/g, '')}"`

export const learnProfileConfig = (o: LearnProfileOptions): string =>
  [
    '# The hermes-learn profile (docs/hermes/host/RUNBOOK.md 9a). Rendered by src/engines/hermes/learn-profile.ts; do not hand-edit.',
    '# It differs from the default profile in exactly the skills toolset, skills.create_dir and skills.external_dirs.',
    o.modelBlock.trimEnd(),
    'auxiliary:',
    '  free_only: true',
    'background_review:',
    '  enabled: false',
    'memory:',
    '  memory_enabled: false',
    '  user_profile_enabled: false',
    'skills:',
    `  creation_nudge_interval: ${String(o.creationNudgeInterval ?? 0)}`,
    `  create_dir: ${quote(o.createDir)}`,
    '  external_dirs:',
    `    - ${quote(o.exportDir)}`,
    'gateway:',
    '  api_server:',
    '    max_concurrent_runs: 1',
    'platform_toolsets:',
    '  api_server: [office, skills]',
    'agent:',
    `  disabled_toolsets: [${LEARN_DISABLED_TOOLSETS.join(', ')}]`,
    'tools:',
    '  tool_search:',
    '    enabled: "off"',
    'mcp_servers:',
    '  office:',
    `    url: ${quote(o.mcpUrl)}`,
    '    headers:',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal placeholder that Hermes interpolates from its own environment
    '      Authorization: "Bearer ${OFFICE_ENGINE_MCP_TOKEN}"',
    '    trust: full',
    '    connect_timeout: 20',
    '    tools:',
    `      include: [${(o.mcpInclude ?? ENGINE_READ_TOOLS).join(', ')}]`,
    '',
  ].join('\n')
