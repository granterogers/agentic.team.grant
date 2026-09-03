/**
 * §7's first rule, as a test rather than as discipline.
 *
 *   "**Never** make operational state depend on Notebook. Postgres remains
 *    authoritative for jobs, events, staff state, configuration, decisions,
 *    recovery, usage, approvals and history."
 *
 * The rule is easy to agree with and easy to break by adding one import. §13
 * says that if Gate 2 proves too brittle, *stop* — do not build the rest of
 * Team HQ around it. That instruction only remains available if the rest of
 * Team HQ has not quietly grown a dependency in the meantime, which is what
 * this file checks on every CI run.
 */
import { glob, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  AmbiguousWriteError,
  fingerprint,
  type NotebookAdapter,
  NotebookUnavailableError,
  UnavailableNotebookAdapter,
} from '../../src/notebook/adapter.ts'

const readAll = async (pattern: string): Promise<{ path: string; source: string }[]> => {
  const files: { path: string; source: string }[] = []
  for await (const path of glob(pattern)) {
    files.push({ path: String(path), source: await readFile(String(path), 'utf8') })
  }
  return files
}

describe('operational code does not depend on Notebook', () => {
  it('no operational module imports the Notebook adapter', async () => {
    // The directories §7 names as Postgres-authoritative. If one of these ever
    // needs Notebook, that is a design decision to argue for, not something to
    // discover from a red CI run — which is exactly why the failure message
    // names the file.
    const operational = await readAll('src/{jobs,providers,db,channels,slack,migrations}/*.ts')
    expect(operational.length).toBeGreaterThan(5)

    const offenders = operational
      .filter(({ source }) => /from\s+['"].*notebook/i.test(source))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('and the Notebook module does not reach back into the job engine', async () => {
    // The other direction. A Notebook module that transitions a job state has
    // made Notebook part of the operational path even without an import going
    // the other way.
    const notebook = await readAll('src/notebook/*.ts')
    expect(notebook.length).toBeGreaterThan(1)
    for (const { path, source } of notebook) {
      expect(source, `${path} imports the job engine`).not.toMatch(/from\s+['"].*\/jobs\//)
      expect(source, `${path} imports the provider router`).not.toMatch(
        /from\s+['"].*\/providers\//,
      )
    }
  })
})

describe('the unavailable adapter', () => {
  it('reports auth_required with no invented tier', async () => {
    const c = await new UnavailableNotebookAdapter().probe()
    expect(c.state).toBe('auth_required')
    expect(c.capabilities).toEqual([])
    // §11 forbids hard-coding quota. The temptation is a "sensible default" for
    // the free tier, which is the same mistake wearing a fallback's clothes.
    expect(c.detectedTier).toBeNull()
    expect(c.notebookLimit).toBeNull()
    expect(c.sourceLimit).toBeNull()
  })

  it('refuses every read and write with the same error type', async () => {
    const a: NotebookAdapter = new UnavailableNotebookAdapter()
    const calls: Promise<unknown>[] = [
      a.listSources('nb'),
      a.fetchSourceText('nb', 's'),
      a.addSource('nb', 'https://example.com'),
      a.addNote('nb', 't', 'b'),
    ]
    for (const call of calls) {
      await expect(call).rejects.toBeInstanceOf(NotebookUnavailableError)
    }
  })

  it('never leaks a credential path into its detail string', async () => {
    const c = await new UnavailableNotebookAdapter().probe()
    // The detail is shown to Grant and stored in the probe table, so it points
    // at the document that says what to do rather than at a token or a path
    // inside someone's home directory.
    expect(c.detail).toContain('HUMAN_ONLY_PREREQUISITES.md')
    expect(c.detail).not.toMatch(/\/home\/|\/Users\/|token=|Bearer/)
  })
})

describe('the two error types are deliberately unrelated', () => {
  it('an ambiguous write is not an unavailability', () => {
    // An outage means wait; an ambiguous write means investigate. A shared
    // supertype would invite one catch block to handle both, and the effect
    // would be retrying every timeout — which §7 forbids precisely because
    // undocumented operations may not be cleanly idempotent.
    const ambiguous = new AmbiguousWriteError('add_note', 'f'.repeat(64))
    const unavailable = new NotebookUnavailableError('unavailable', 'down')
    expect(ambiguous).not.toBeInstanceOf(NotebookUnavailableError)
    expect(unavailable).not.toBeInstanceOf(AmbiguousWriteError)
  })

  it('an ambiguous write says to reconcile, in the message itself', () => {
    // The message is what someone reads at 3am. It has to carry the
    // instruction, not just the fact.
    expect(new AmbiguousWriteError('add_note', 'f'.repeat(64)).message).toMatch(/reconcile/i)
  })
})

describe('fingerprinting', () => {
  it('is stable across property order', async () => {
    const a = await fingerprint('add_note', { title: 'x', body: 'y', notebook_id: 'n' })
    const b = await fingerprint('add_note', { notebook_id: 'n', body: 'y', title: 'x' })
    expect(a).toBe(b)
  })

  it('is stable through nesting', async () => {
    const a = await fingerprint('add_note', { meta: { b: 1, a: 2 }, list: [{ y: 1, x: 2 }] })
    const b = await fingerprint('add_note', { list: [{ x: 2, y: 1 }], meta: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })

  it('distinguishes the operation, so two intentions do not suppress each other', async () => {
    const payload = { notebook_id: 'n', url: 'https://example.com' }
    expect(await fingerprint('add_source', payload)).not.toBe(
      await fingerprint('delete_source', payload),
    )
  })

  it('changes when the content changes by one character', async () => {
    const a = await fingerprint('add_note', { body: 'finding' })
    const b = await fingerprint('add_note', { body: 'findings' })
    expect(a).not.toBe(b)
  })

  it('produces the shape the database CHECK constraint requires', async () => {
    // notebook_sync_queue_fingerprint_sha256 is `^[0-9a-f]{64}$`. Asserting it
    // here means a change to the digest fails in CI rather than at an insert.
    expect(await fingerprint('add_note', { body: 'x' })).toMatch(/^[0-9a-f]{64}$/)
  })
})
