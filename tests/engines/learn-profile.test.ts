// biome-ignore-all format: dense template checks kept readable as written
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DISABLED_TOOLSETS } from '../../scripts/hermes-m0/hermes-host.ts'
import {
  LEARN_DISABLED_TOOLSETS,
  LEARN_PREFIX,
  LEARN_TOOLSETS_ALLOWED,
  learnProfileConfig,
  learnToolsetsOk,
} from '../../src/engines/hermes/learn-profile.ts'
import { ENGINE_READ_TOOLS } from '../../src/engines/hermes/timing.ts'

const MODEL = 'model:\n  provider: openrouter\n  default: "nvidia/nemotron-3-super-120b-a12b:free"'
const yaml = learnProfileConfig({ modelBlock: MODEL, createDir: '/var/lib/hermes/learn', exportDir: '/var/lib/hermes-skills-export/office', mcpUrl: 'https://x.supabase.co/functions/v1/mcp' })

describe('the hermes-learn profile', () => {
  it('differs from the default profile in the skills toolset and nothing else: every other built-in toolset stays disabled', () => {
    expect([...LEARN_DISABLED_TOOLSETS, 'skills'].sort()).toEqual([...DISABLED_TOOLSETS].sort())
    expect(LEARN_DISABLED_TOOLSETS).not.toContain('skills')
    expect(LEARN_DISABLED_TOOLSETS).toContain('skills_hub')
    expect(LEARN_DISABLED_TOOLSETS).toContain('terminal')
    expect(yaml).toMatch(/platform_toolsets:\n {2}api_server: \[office, skills\]/)
  })
  it('writes where the bridge reads (create_dir) and reads where the bridge writes (external_dirs), and nowhere else', () => {
    expect(yaml).toMatch(/create_dir: "\/var\/lib\/hermes\/learn"/)
    expect(yaml).toMatch(/external_dirs:\n {4}- "\/var\/lib\/hermes-skills-export\/office"/)
    expect([...yaml.matchAll(/\/var\/lib\/[a-z-]+(?:\/[a-z]+)?/g)].map((m) => m[0]).sort()).toEqual(['/var/lib/hermes-skills-export/office', '/var/lib/hermes/learn'])
  })
  it('keeps the default profile\'s other guarantees: the read-only office tools only, memory and background review off, free models only, one run at a time, tool search quoted off', () => {
    expect(yaml).toContain(`include: [${ENGINE_READ_TOOLS.join(', ')}]`)
    expect(yaml).toMatch(/memory_enabled: false/)
    expect(yaml).toMatch(/background_review:\n {2}enabled: false/)
    expect(yaml).toMatch(/free_only: true/)
    expect(yaml).toMatch(/max_concurrent_runs: 1/)
    expect(yaml).toMatch(/tool_search:\n {4}enabled: "off"/)
    expect(yaml).not.toMatch(/(api_key|token|secret)\s*:\s*"?[A-Za-z0-9]{12,}/i)
  })
  it('puts no credential in the file: the MCP token is an environment placeholder', () => {
    expect(yaml).toContain('Authorization: "Bearer ${OFFICE_ENGINE_MCP_TOKEN}"')
  })
  it('a path that tries to inject YAML is neutered: a quote, a backslash or a newline cannot end the string', () => {
    const evil = learnProfileConfig({ modelBlock: MODEL, createDir: '/x"\n  - /etc', exportDir: '/y\\', mcpUrl: 'https://x/mcp' })
    expect(evil).not.toMatch(/\n\s*- \/etc/)
    expect(evil.split('\n').filter((l) => l.startsWith('    - ')).length).toBe(1)
  })
  it('the prefix is the one the real Hermes serves: /p/<profile>', () => {
    expect(LEARN_PREFIX).toBe('/p/hermes-learn')
  })
  it('the toolset verdict: skills (the only built-in Hermes lists as enabled on a learning profile), the office name and nothing at all are safe; anything else and an unreadable list are not (each beside a positive control)', () => {
    expect(learnToolsetsOk(['office'])).toBe(true)
    expect(learnToolsetsOk(['office', 'skills'])).toBe(true)
    expect(learnToolsetsOk(['office', 'skills', 'terminal'])).toBe(false)
    expect(learnToolsetsOk(['office', 'skills_hub'])).toBe(false)
    expect(learnToolsetsOk(['skills'])).toBe(true)
    expect(learnToolsetsOk([])).toBe(true)
    expect(learnToolsetsOk(['skills', 'web'])).toBe(false)
    expect(learnToolsetsOk(null)).toBe(false)
    expect([...LEARN_TOOLSETS_ALLOWED]).toEqual(['office', 'skills'])
  })
  it('the host kit template is exactly what this module renders (so the profile a person copies is the one that was proved)', () => {
    const template = readFileSync('docs/hermes/host/learn-profile.config.yaml', 'utf8')
    const rendered = learnProfileConfig({
      modelBlock: 'model:\n  provider: openrouter\n  default: "nvidia/nemotron-3-super-120b-a12b:free"',
      createDir: '/var/lib/hermes/learn',
      exportDir: '/var/lib/hermes-skills-export/office',
      mcpUrl: 'https://<project-ref>.supabase.co/functions/v1/mcp',
    })
    expect(template).toBe(rendered)
  })
})
