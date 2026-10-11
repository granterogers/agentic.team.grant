// biome-ignore-all format: dense scenario tests kept readable as written
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provisionLearnProfile, readNeeded } from '../../scripts/ops/hermes-learn-profile.ts'

let root: string
let home: string
const SECRET_A = `ak_${'a1'.repeat(20)}`
const SECRET_B = `mt_${'b2'.repeat(20)}`
const SECRET_C = `or_${'c3'.repeat(20)}`
const opts = (over: Record<string, string> = {}) => ({ hermesHome: home, learnDir: join(root, 'var', 'learn'), exportDir: join(root, 'export', 'office'), mcpUrl: 'https://abc.supabase.co/functions/v1/mcp', model: 'nvidia/nemotron-3-super-120b-a12b:free', ...over })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'learn-profile-'))
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  await writeFile(join(home, '.env'), `API_SERVER_ENABLED=true\nAPI_SERVER_KEY=${SECRET_A}\nOFFICE_ENGINE_MCP_TOKEN=${SECRET_B}\nOPENROUTER_API_KEY=${SECRET_C}\nSOME_OTHER_SECRET=never-copied\n`)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('creating the hermes-learn profile on a host', () => {
  it('writes the rendered config and a 0600 .env holding exactly the two values it needs, copied from the default profile, and nothing else', async () => {
    const r = await provisionLearnProfile(opts())
    const config = await readFile(join(r.profileDir, 'config.yaml'), 'utf8')
    expect(config).toMatch(/api_server: \[office, skills\]/)
    expect(config).toContain(`create_dir: "${join(root, 'var', 'learn')}"`)
    expect(config).toContain('"nvidia/nemotron-3-super-120b-a12b:free"')
    const env = await readFile(join(r.profileDir, '.env'), 'utf8')
    expect(env).toBe(`API_SERVER_KEY=${SECRET_A}\nOFFICE_ENGINE_MCP_TOKEN=${SECRET_B}\nOPENROUTER_API_KEY=${SECRET_C}\n`)
    expect(env).not.toContain('API_SERVER_ENABLED')
    expect(((await stat(join(r.profileDir, '.env'))).mode & 0o777).toString(8)).toBe('600')
    expect(((await stat(r.profileDir)).mode & 0o777).toString(8)).toBe('700')
    expect(config).not.toContain(SECRET_A)
    expect(config).not.toContain(SECRET_B)
    expect(config).not.toContain(SECRET_C)
    expect(env).not.toContain('never-copied')
  })
  it('tightens a profile directory and a .env that already exist with wider modes (a file keeps its old mode when rewritten)', async () => {
    const pd = join(home, 'profiles', 'hermes-learn')
    await mkdir(pd, { recursive: true, mode: 0o755 })
    await writeFile(join(pd, '.env'), 'OLD=1\n', { mode: 0o644 })
    const r = await provisionLearnProfile(opts())
    expect(((await stat(join(r.profileDir, '.env'))).mode & 0o777).toString(8)).toBe('600')
    expect(((await stat(r.profileDir)).mode & 0o777).toString(8)).toBe('700')
    expect(await readFile(join(r.profileDir, '.env'), 'utf8')).not.toContain('OLD=1')
  })
  it('refuses a model that is not a :free slug (the zero-spend rule is not ours to bend), and a malformed one', async () => {
    for (const model of ['nvidia/nemotron-3-super-120b-a12b', 'openai/gpt-5', 'free', ':free', 'a/b:free-not']) await expect(provisionLearnProfile(opts({ model })), model).rejects.toThrow(/:free/)
    await expect(provisionLearnProfile(opts({ model: 'vendor/name:free' }))).resolves.toBeDefined()
  })
  it('refuses a relative path, a path with .., and an export directory inside Hermes\'s home or the learn directory (Hermes must not be able to write it)', async () => {
    await expect(provisionLearnProfile(opts({ learnDir: 'relative/learn' }))).rejects.toThrow(/absolute/)
    await expect(provisionLearnProfile(opts({ exportDir: `${root}/a/../b` }))).rejects.toThrow(/absolute/)
    await expect(provisionLearnProfile(opts({ exportDir: join(home, 'skills', 'office') }))).rejects.toThrow(/OUTSIDE/)
    await expect(provisionLearnProfile(opts({ exportDir: join(root, 'var', 'learn', 'ref') }))).rejects.toThrow(/separate/)
    await expect(provisionLearnProfile(opts({ learnDir: join(root, 'export', 'office', 'learn') }))).rejects.toThrow(/separate/)
  })
  it('refuses when the default .env does not hold the two values, and says which, without typing a secret anywhere', async () => {
    await writeFile(join(home, '.env'), 'API_SERVER_KEY=\nOTHER=1\n')
    await expect(provisionLearnProfile(opts())).rejects.toThrow(/API_SERVER_KEY and OFFICE_ENGINE_MCP_TOKEN and OPENROUTER_API_KEY|API_SERVER_KEY, OFFICE_ENGINE_MCP_TOKEN|API_SERVER_KEY and OFFICE/)
    await rm(join(home, '.env'))
    await expect(provisionLearnProfile(opts())).rejects.toThrow(/does not hold/)
  })
  it('refuses an MCP URL that is not the office function over https', async () => {
    for (const mcpUrl of ['http://abc.supabase.co/functions/v1/mcp', 'https://abc.supabase.co/functions/v1/engine', 'https://x/mcp?x=1']) await expect(provisionLearnProfile(opts({ mcpUrl })), mcpUrl).rejects.toThrow(/MCP URL/)
  })
  it('the .env reader takes quoted and unquoted values, ignores empty ones and other names, and finds nothing in nothing', () => {
    expect(readNeeded('API_SERVER_KEY="x1"\nOFFICE_ENGINE_MCP_TOKEN=y2\nOTHER=z')).toEqual({ API_SERVER_KEY: 'x1', OFFICE_ENGINE_MCP_TOKEN: 'y2', OPENROUTER_API_KEY: null })
    expect(readNeeded('API_SERVER_KEY=\n')).toEqual({ API_SERVER_KEY: null, OFFICE_ENGINE_MCP_TOKEN: null, OPENROUTER_API_KEY: null })
    expect(readNeeded('')).toEqual({ API_SERVER_KEY: null, OFFICE_ENGINE_MCP_TOKEN: null, OPENROUTER_API_KEY: null })
  })
})
