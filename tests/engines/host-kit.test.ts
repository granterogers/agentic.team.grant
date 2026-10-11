// biome-ignore-all format: dense template checks kept readable as written
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DISABLED_TOOLSETS, OFFICE_READ_TOOLS } from '../../scripts/hermes-m0/hermes-host.ts'
import { ENGINE_READ_TOOLS } from '../../src/engines/hermes/timing.ts'

/*
  The host kit (docs/hermes/host) is a TEMPLATE a person copies onto a machine, so nothing runs it here. What can be checked is that it
  says what M0 validated: the same disabled toolsets and tool list the real Hermes was run with, the quoted "off", and no value
  where a secret belongs. There is no YAML parser in this repository and none is added for a template, so the checks read the text.
*/
const config = readFileSync('docs/hermes/host/config.yaml', 'utf8')
const env = readFileSync('docs/hermes/host/.env.example', 'utf8')
const bridgeUnit = readFileSync('docs/hermes/host/hermes-bridge.service', 'utf8')
const hermesUnit = readFileSync('docs/hermes/host/hermes-gateway.service', 'utf8')
const noComments = (s: string): string => s.replace(/^\s*#.*$/gm, '').replace(/\s+#.*$/gm, '')
const body = noComments(config)

const listAfter = (key: string): string[] => {
  const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`, 's').exec(body)
  return (m?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')
}

describe('the Hermes config template', () => {
  it('enables the office server and nothing else, and says so in every place Hermes reads', () => {
    expect(body).toMatch(/platform_toolsets:\s*\n\s*api_server:\s*\[office\]/)
    expect(body).toMatch(/mcp_servers:\s*\n\s*office:/)
  })
  it('disables exactly the toolsets the M0 run disabled, none missing and none added', () => {
    expect(listAfter('disabled_toolsets').sort()).toEqual([...DISABLED_TOOLSETS].sort())
  })
  it('offers exactly the v1 read tools, the same list as the MCP gate and the M0 run', () => {
    expect(listAfter('include').sort()).toEqual([...ENGINE_READ_TOOLS].sort())
    expect([...OFFICE_READ_TOOLS].sort()).toEqual([...ENGINE_READ_TOOLS].sort())
  })
  it('quotes the tool-search switch: a bare off is a YAML boolean and hides the tools', () => {
    expect(body).toMatch(/tool_search:\s*\n\s*enabled:\s*"off"/)
    expect(body).not.toMatch(/enabled:\s*off\b/)
  })
  it('allows one run at a time, and no memory, no skill creation and no background review', () => {
    expect(body).toMatch(/max_concurrent_runs:\s*1\b/)
    expect(body).toMatch(/memory_enabled:\s*false/)
    expect(body).toMatch(/user_profile_enabled:\s*false/)
    expect(body).toMatch(/creation_nudge_interval:\s*0\b/)
    expect(body).toMatch(/background_review:\s*\n\s*enabled:\s*false/)
    expect(body).toMatch(/free_only:\s*true/)
  })
  it('uses a free model only', () => {
    const model = /default:\s*"([^"]+)"/.exec(body)?.[1] ?? ''
    expect(model.endsWith(':free')).toBe(true)
    expect(body).toMatch(/provider:\s*openrouter/)
  })
  it('holds no secret: the only credential is an environment placeholder', () => {
    const interpolations = [...body.matchAll(/\$\{([A-Z_]+)\}/g)].map((m) => m[1])
    expect(interpolations).toEqual(['OFFICE_ENGINE_MCP_TOKEN'])
    expect(body).not.toMatch(/\b(sk-|ebt_|mcp_[0-9a-f]{8}|xox[bp]-|AIza)/)
    expect(body).not.toMatch(/api_key\s*:/i)
  })
  it('points at the office MCP function through a placeholder, not a real project', () => {
    expect(body).toContain('https://<project-ref>.supabase.co/functions/v1/mcp')
  })
})

describe('the environment example', () => {
  const lines = noComments(env).split('\n').filter((l) => /^[A-Z_]+=/.test(l))
  const value = (name: string): string | undefined => lines.find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim()
  it('lists every secret by name with NO value', () => {
    for (const n of ['API_SERVER_KEY', 'OPENROUTER_API_KEY', 'OFFICE_ENGINE_MCP_TOKEN', 'ENGINE_BRIDGE_TOKEN', 'HERMES_API_KEY', 'ENGINE_GATEWAY_URL'])
      expect(value(n), n).toBe('')
  })
  it('keeps Hermes on loopback', () => {
    expect(value('API_SERVER_HOST')).toBe('127.0.0.1')
    expect(value('HERMES_URL')).toMatch(/^http:\/\/127\.0\.0\.1:/)
  })
  it('never names a database or Supabase credential for the bridge, or the YOLO switch', () => {
    expect(lines.join('\n')).not.toMatch(/^(SUPABASE_|DATABASE_URL|POSTGRES|HERMES_YOLO_MODE)/m)
  })
})

describe('the service units', () => {
  it('a bridge whose token was retired is not restarted into a polling loop', () => {
    expect(bridgeUnit).toMatch(/RestartPreventExitStatus=1 2/)
  })
  it('both run unprivileged and with the filesystem read-only except their own state', () => {
    for (const unit of [bridgeUnit, hermesUnit]) {
      expect(unit).toMatch(/NoNewPrivileges=true/)
      expect(unit).toMatch(/ProtectSystem=strict/)
      expect(unit).toMatch(/^User=hermes$/m)
    }
  })
  it('Hermes cannot write the skills export directory: it is outside every path Hermes\'s unit may write, and only the bridge lists it', () => {
    // Hermes's own skill_manage edits and deletes a skill in skills.external_dirs (measured on the pinned commit), so the operating
    // system is the only read-only guarantee the reference directory has. Both units run as the same user, so it is the sandbox that decides.
    const rw = (unit: string): string[] => [...noComments(unit).matchAll(/^ReadWritePaths=(.*)$/gm)].flatMap((m) => (m[1] ?? '').trim().split(/\s+/))
    const exportDir = '/var/lib/hermes-skills-export'
    expect(rw(bridgeUnit)).toContain(exportDir)
    for (const path of rw(hermesUnit)) {
      expect(exportDir.startsWith(`${path.replace(/\/$/, '')}/`) || exportDir === path, `the Hermes unit may write ${path}, which holds the export directory`).toBe(false)
    }
    expect(rw(hermesUnit)).toEqual(['/var/lib/hermes'])
    // And it is made read-only for Hermes by name, not left to the absence of a ReadWritePaths line: the kernel's read-only mount is what the
    // real-Hermes proof (engine-learning-host) showed to refuse skill_manage's edit and delete with EROFS, even for the same user. The parent is
    // mounted, because the bridge replaces its directory by rename.
    const ro = [...noComments(hermesUnit).matchAll(/^ReadOnlyPaths=(.*)$/gm)].flatMap((m) => (m[1] ?? '').trim().split(/\s+/)).map((p) => p.replace(/^-/, ''))
    expect(ro).toContain('/var/lib/hermes-skills-export')
    // Hermes may not rewrite its own configuration either (a run that could would change the NEXT run's toolsets): both profiles' config.yaml.
    expect(ro).toContain('/var/lib/hermes/home/config.yaml')
    expect(ro).toContain('/var/lib/hermes/home/profiles/hermes-learn/config.yaml')
    expect(rw(bridgeUnit)).not.toContain('/var/lib/hermes')
    expect(noComments(hermesUnit)).toMatch(/^RestrictNamespaces=true$/m)
    expect(noComments(hermesUnit)).toMatch(/^CapabilityBoundingSet=$/m)
  })
  it('the bridge listens on no port and is started after Hermes', () => {
    expect(noComments(bridgeUnit)).not.toMatch(/ListenStream|ListenAddress|_PORT|\bPort=/i)
    expect(bridgeUnit).toMatch(/Requires=hermes-gateway\.service/)
  })
})
