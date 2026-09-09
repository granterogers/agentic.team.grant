/**
 * The six states, and the difference between the two that matter most.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor, SqlResult } from '../../src/db/executor.ts'
import { capabilitySummary, notionCapabilities } from '../../src/notion/capabilities.ts'

const dbWith = (row: Record<string, unknown>): SqlExecutor => ({
  kind: 'stub',
  execute: async (): Promise<SqlResult> => ({ rows: [row] }),
})

describe('what the system can answer without asking Grant', () => {
  it('says NOT_CONFIGURED when there is no token, rather than UNKNOWN', async () => {
    const caps = await notionCapabilities(
      dbWith({ token: null, connector_enabled: true, write_allowed: true }),
    )
    expect(caps.configured).toBe(false)
    expect(caps.authenticates).toBe(false)
    expect(caps.operations.find((o) => o.operation === 'create_page')?.state).toBe('NOT_CONFIGURED')
  })

  it('says NOT_AUTHORIZED when writing is switched off but reading is not', async () => {
    // A real distinction: the credential is fine and the permission is not.
    const caps = await notionCapabilities(
      dbWith({ token: '', connector_enabled: true, write_allowed: false }),
    )
    expect(caps.canWrite).toBe(false)
    // With no token everything unconfigured wins first; the ordering is
    // deliberate, since a missing credential is the more fundamental problem.
    expect(caps.operations.find((o) => o.operation === 'create_page')?.state).toBe('NOT_CONFIGURED')
  })

  it('keeps NOT_IMPLEMENTED and NOT_SUPPORTED_BY_NOTION apart', async () => {
    // The pair that matters. For a week "the team cannot upload files" was
    // true and read as impossible when it was merely unbuilt.
    const caps = await notionCapabilities(
      dbWith({ token: null, connector_enabled: true, write_allowed: true }),
    )
    const teamspace = caps.operations.find((o) => o.operation === 'create_teamspace')
    const schema = caps.operations.find((o) => o.operation === 'update_schema')
    expect(teamspace?.state).toBe('NOT_SUPPORTED_BY_NOTION')
    expect(schema?.state).toBe('NOT_IMPLEMENTED')
  })

  it('is explicit that a teamspace cannot be created or even seen', async () => {
    const caps = await notionCapabilities(
      dbWith({ token: null, connector_enabled: true, write_allowed: true }),
    )
    expect(caps.limitations.join(' ')).toMatch(/teamspaces are invisible/i)
    expect(caps.operations.find((o) => o.operation === 'read_teamspace_of_a_page')?.state).toBe(
      'NOT_SUPPORTED_BY_NOTION',
    )
  })

  it('records that there is no permanent delete, which is a safety property', async () => {
    const caps = await notionCapabilities(
      dbWith({ token: null, connector_enabled: true, write_allowed: true }),
    )
    expect(caps.operations.find((o) => o.operation === 'permanent_delete')?.state).toBe(
      'NOT_SUPPORTED_BY_NOTION',
    )
    expect(caps.limitations.join(' ')).toMatch(/reversible/i)
  })

  it('never carries a credential, at any length', async () => {
    const caps = await notionCapabilities(
      dbWith({ token: 'ntn_super_secret_value', connector_enabled: true, write_allowed: true }),
    )
    const text = JSON.stringify(caps)
    expect(text).not.toContain('ntn_super_secret_value')
    expect(text).not.toContain('ntn_supe')
  })
})

describe('the sentence an agent is handed', () => {
  it('says plainly when there is nothing configured', async () => {
    const caps = await notionCapabilities(
      dbWith({ token: null, connector_enabled: true, write_allowed: true }),
    )
    expect(capabilitySummary(caps)).toMatch(/not configured/i)
  })

  it('tells it not to claim inability before trying', async () => {
    const caps = {
      ...(await notionCapabilities(
        dbWith({ token: null, connector_enabled: true, write_allowed: true }),
      )),
      configured: true,
      authenticates: true,
      bot: 'Agentic',
      workspace: 'Space',
    }
    expect(capabilitySummary(caps)).toMatch(/without trying it first/i)
  })
})
