import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prepareBundle } from '../../scripts/deploy/lib/bundle.ts'
import {
  generateCredentials,
  isUuid,
  mintStatement,
  retireStatement,
  sha256Hex,
} from '../../src/engines/hermes/credentials.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'

describe('generateCredentials', () => {
  it('makes two different tokens of the agreed shapes, and hashes that are their SHA-256', () => {
    const c = generateCredentials()
    expect(c.bridgeToken).toMatch(/^ebt_[0-9a-f]{64}$/)
    expect(c.mcpToken).toMatch(/^mcp_[0-9a-f]{48}$/)
    expect(c.bridgeToken).not.toBe(c.mcpToken)
    expect(c.bridgeSha256).toBe(sha256Hex(c.bridgeToken))
    expect(c.mcpSha256).toBe(sha256Hex(c.mcpToken))
    expect(c.bridgeSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(c.bridgeSha256).not.toBe(c.mcpSha256)
  })
  it('is random: two calls never share a token (the control for the shape test passing on a constant)', () => {
    const a = generateCredentials()
    const b = generateCredentials()
    expect(a.bridgeToken).not.toBe(b.bridgeToken)
    expect(a.mcpToken).not.toBe(b.mcpToken)
  })
  it('uses the random source it is given, so a test can prove the hashing without a real secret', () => {
    const fixed = generateCredentials((n) => new Uint8Array(n).fill(0xab))
    expect(fixed.bridgeToken).toBe(`ebt_${'ab'.repeat(32)}`)
    expect(fixed.mcpToken).toBe(`mcp_${'ab'.repeat(24)}`)
  })
})

describe('the statements carry hashes, never a token', () => {
  const c = generateCredentials()
  it('mint', () => {
    const sql = mintStatement(OFFICE, "Grant's laptop", c)
    expect(sql).toContain(c.bridgeSha256)
    expect(sql).toContain(c.mcpSha256)
    expect(sql).not.toContain(c.bridgeToken)
    expect(sql).not.toContain(c.mcpToken)
    expect(sql).toContain("p_display => 'Grant''s laptop'")
  })
  it('a hostile display name cannot break out of its literal', () => {
    const sql = mintStatement(OFFICE, "x'); drop table public.engine_runs; --", c)
    expect(sql).toContain("x''); drop table public.engine_runs; --")
    expect(sql.match(/drop table/g)?.length).toBe(1)
  })
  it('retire uses named arguments', () => {
    const sql = retireStatement(OFFICE, '22222222-2222-4222-8222-222222222222', 'decommissioned')
    expect(sql).toContain('p_office =>')
    expect(sql).toContain('p_bridge =>')
    expect(sql).toContain('p_reason =>')
  })
  it('isUuid accepts a uuid and nothing else', () => {
    expect(isUuid(OFFICE)).toBe(true)
    for (const v of [
      '',
      'operator',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      `${OFFICE}x`,
      "1'; drop",
    ])
      expect(isUuid(v), v).toBe(false)
  })
})

describe('the operator script never prints a clear credential', () => {
  const source = readFileSync('scripts/ops/engine-bridge-credential.ts', 'utf8')
  it('has no console call that mentions a token value', () => {
    const logs = source.split('\n').filter((l) => /console\.(log|error|warn|info)/.test(l))
    expect(logs.length).toBeGreaterThan(3)
    for (const l of logs) {
      expect(l, l).not.toMatch(/bridgeToken|mcpToken|creds\.(bridge|mcp)Token/)
    }
  })
  it('hands each clear value to the pager exactly once, as separate messages', () => {
    expect(source.match(/creds\.bridgeToken/g)?.length).toBe(1)
    expect(source.match(/creds\.mcpToken/g)?.length).toBe(1)
  })
  it('retires the bridge again when the credentials cannot be delivered', () => {
    expect(source.match(/retireStatement\(/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the engine function bundle', () => {
  it('is closed (every import is in the upload), its entry is index.ts, and it ships only its own two files', async () => {
    const b = await prepareBundle('engine', 'supabase/functions/engine/index.ts')
    expect([...b.files.keys()].sort()).toEqual([
      'supabase/functions/engine/index.ts',
      'supabase/functions/engine/routes.ts',
    ])
    const meta = JSON.parse(String(b.form.get('metadata')))
    expect(meta).toMatchObject({ name: 'engine', verify_jwt: false })
  })
  it('imports nothing from src/: the gateway carries no office logic of its own', () => {
    const idx = readFileSync('supabase/functions/engine/index.ts', 'utf8')
    const routes = readFileSync('supabase/functions/engine/routes.ts', 'utf8')
    for (const s of [idx, routes]) expect(s).not.toMatch(/from '\.\.\/\.\.\/\.\.\/src\//)
  })
})
