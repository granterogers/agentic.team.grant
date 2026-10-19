/**
 * The notebook jobs' writer path, with the credential the vault holds (src/notebook/actions.ts).
 *
 * The bug this guards: the jobs that generate, add sources and collect read only the stored cookie jar, which goes
 * stale, so they failed with "no NotebookLM credential" while the reader could list notebooks with the master token.
 * The writer now takes the master token and mints a fresh jar, the same as the reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotebookActions } from '../../src/notebook/actions.ts'

const master = JSON.stringify({
  email: 'grant.e.rogers@gmail.com',
  android_id: '0123456789abcdef',
  master_token: 'aas_et/AKppINZexample',
  version: 1,
})

function vault(row: { jar?: string; master?: string; secret?: string; url?: string }) {
  return {
    execute: async () => ({
      rows: [
        {
          jar: '',
          master: '',
          secret: 'reader-secret',
          url: 'https://reader.example/api/notebook-act',
          ...row,
        },
      ],
    }),
  } as unknown as Parameters<typeof NotebookActions.fromVault>[0]
}

function stubWriter(): { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(
        JSON.stringify({ ok: true, notebooks: [{ notebook_id: 'nb-1', title: 'Team' }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }),
  )
  return { bodies }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NotebookActions with the vault credential', () => {
  it('sends the master token, and no stored jar, when the vault holds one', async () => {
    const { bodies } = stubWriter()
    const actions = await NotebookActions.fromVault(vault({ jar: '{"stale":true}', master }))
    expect(actions).not.toBeNull()
    if (actions === null) throw new Error('the vault credential was not read')
    const listed = await actions.notebooks()
    expect(listed).toEqual([{ id: 'nb-1', title: 'Team' }])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      action: 'notebooks',
      master_token: { email: 'grant.e.rogers@gmail.com', master_token: 'aas_et/AKppINZexample' },
    })
    expect(bodies[0]).not.toHaveProperty('storage_state')
  })

  it('still sends the stored jar when there is no master token', async () => {
    const { bodies } = stubWriter()
    const actions = await NotebookActions.fromVault(vault({ jar: '{"cookies":[]}' }))
    expect(actions).not.toBeNull()
    if (actions === null) throw new Error('the vault credential was not read')
    await actions.notebooks()
    expect(bodies[0]).toMatchObject({ action: 'notebooks', storage_state: '{"cookies":[]}' })
    expect(bodies[0]).not.toHaveProperty('master_token')
  })

  it('is null when the vault holds neither a master token nor a jar, which is the only true "no credential"', async () => {
    expect(await NotebookActions.fromVault(vault({}))).toBeNull()
  })

  it('is null when the master token is not a master token', async () => {
    expect(
      await NotebookActions.fromVault(
        vault({ master: JSON.stringify({ master_token: 'not-a-token' }) }),
      ),
    ).toBeNull()
  })

  it('is null when the writer is not configured and there is no stored jar to run the subprocess with', async () => {
    expect(await NotebookActions.fromVault(vault({ master, url: '' }))).toBeNull()
  })
})
