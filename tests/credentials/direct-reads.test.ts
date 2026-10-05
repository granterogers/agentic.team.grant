/**
 * The source scan behind check:system-secrets (P1.2): it finds what it must, ignores what it must, and the
 * committed tree is clean. Each rule is driven with an injected defect AND its legitimate neighbour.
 */
import { describe, expect, it } from 'vitest'
import { controls, scan } from '../../scripts/check-system-secrets.ts'
import { credentialSql, currentJob, withJobScope } from '../../src/credentials/deployment.ts'
import {
  type ClassOf,
  findDirectReads,
  findRetiredReaderCalls,
  violations,
} from '../../src/credentials/direct-reads.ts'

const CLASSES: Record<string, string> = {
  'google.refresh_token': 'human_integration',
  'notion.integration_token': 'human_integration',
  'openrouter.api_key': 'infra',
  'slack.config_refresh_token': 'channel',
}
const classOf: ClassOf = (n) => CLASSES[n] ?? null
const problems = (src: string, file = 'src/x.ts') =>
  violations(findDirectReads(file, src), findRetiredReaderCalls(file, src), classOf)

describe('findDirectReads / violations', () => {
  it('refuses a direct read of a human-integration secret, with file and line', () => {
    const p = problems(
      "\n\ndb.execute(`select decrypted_secret from vault.decrypted_secrets where name = 'google.refresh_token'`)",
    )
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('src/x.ts:3')
    expect(p[0]).toContain('google.refresh_token')
  })

  it('reads a name list, not just the first name', () => {
    const p = problems(
      "db.execute(`select name from vault.decrypted_secrets where name in ('openrouter.api_key', 'notion.integration_token')`)",
    )
    expect(p.some((x) => x.includes('notion.integration_token'))).toBe(true)
    expect(p.some((x) => x.includes('openrouter.api_key'))).toBe(false)
  })

  it("accepts infrastructure and channel reads (the deployment's own)", () => {
    expect(
      problems("`select 1 from vault.decrypted_secrets where name = 'openrouter.api_key'`"),
    ).toEqual([])
    expect(
      problems(
        "`select 1 from vault.decrypted_secrets\n where name = 'slack.config_refresh_token'`",
      ),
    ).toEqual([])
  })

  it('refuses a name nobody classified and a name built at run time', () => {
    expect(
      problems("`select 1 from vault.decrypted_secrets where name = 'mystery.token'`")[0],
    ).toContain('no credential class')
    expect(
      problems('`select 1 from vault.decrypted_secrets where name = ${lit(name)}`')[0],
    ).toContain('built at run time')
  })

  it('lets only the vault export read a name nobody can predict', () => {
    expect(
      problems(
        '`select 1 from vault.decrypted_secrets where name = ${lit(n)}`',
        'src/handlers/vault-export.ts',
      ),
    ).toEqual([])
  })

  it('does not mistake a COMMENT for a read', () => {
    const src = [
      "// reads vault.decrypted_secrets where name = 'google.refresh_token'",
      "/* vault.decrypted_secrets where name = 'google.refresh_token' */",
      "const sql = `select 1 -- vault.decrypted_secrets where name = 'google.refresh_token'\n from t`",
    ].join('\n')
    expect(findDirectReads('src/x.ts', src)).toEqual([])
  })

  it('refuses the retired reader in every form, and not the ref type that shares its prefix', () => {
    expect(problems("db.execute(`select app.vault_secret('x')`)")).toHaveLength(1)
    expect(problems("await ask('vault_secret', { p_name: 'x' })")).toHaveLength(1)
    expect(problems("rpc('vault_secret', {})")).toHaveLength(1)
    expect(problems('select app.resolve_secret(p.secret_ref::app.vault_secret_ref)')).toEqual([])
  })
})

describe('the committed tree', () => {
  it('has a non-empty scan (the check looked at something)', () => {
    const { reads } = scan()
    expect(reads.length).toBeGreaterThan(3)
  })

  it('reads no human-integration secret except through the resolver', () => {
    const { reads, retired } = scan()
    const real: ClassOf = (n) => {
      if (/^(google|notion|vikunja|github\.read|notebook|telegram\.(user|api))/.test(n))
        return 'human_integration'
      if (
        /^(openrouter|supabase|backup|browser|github\.dispatch|github\.token|hq|voice|worker)/.test(
          n,
        )
      )
        return 'infra'
      if (/^(slack|telegram)/.test(n)) return 'channel'
      return null
    }
    expect(violations(reads, retired, real)).toEqual([])
  })

  it('has controls that behave (three refused, the legitimate two accepted)', () => {
    for (const c of controls(classOf)) expect(c.ok, c.name).toBe(true)
  })
})

describe('the job scope', () => {
  const J1 = '11111111-1111-4111-8111-111111111111'
  const J2 = '22222222-2222-4222-8222-222222222222'

  it('is the deployment (system) with none, and the job inside withJobScope', async () => {
    expect(currentJob()).toBeNull()
    expect(credentialSql('google.refresh_token')).toContain(', null, null, true)')
    await withJobScope(J1, async () => {
      expect(currentJob()).toBe(J1)
      expect(credentialSql('google.refresh_token')).toContain(`'${J1}'::uuid, false)`)
    })
    expect(currentJob()).toBeNull()
  })

  it('does not leak between two jobs running at once', async () => {
    const seen = await Promise.all([
      withJobScope(J1, async () => {
        await new Promise((r) => setTimeout(r, 10))
        return currentJob()
      }),
      withJobScope(J2, async () => currentJob()),
    ])
    expect(seen).toEqual([J1, J2])
  })

  it('refuses a scope that is not a job id (nothing is spliced into SQL)', () => {
    expect(() => withJobScope("x'; drop table jobs; --", async () => 1)).toThrow()
  })

  it('escapes a credential name', () => {
    expect(credentialSql("a'b")).toContain("'a''b'")
  })
})
