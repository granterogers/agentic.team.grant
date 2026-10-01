/**
 * The live `NotebookAdapter`, behind the same boundary as the unavailable one.
 *
 * §7 requires a strict `NotebookAdapter` boundary, and the value of one is only
 * realised when there are two implementations: the rest of the system depends
 * on the interface and cannot tell which is installed. `UnavailableNotebookAdapter`
 * proved the degradation path; this proves the boundary was worth having.
 *
 * Every call shells out to `scripts/notebook/read.py`. That looks indirect and
 * is the cheaper of two bad options: the alternative is re-implementing
 * NotebookLM's undocumented private RPC in TypeScript, which is precisely the
 * risk §7 says to contain rather than take on. A subprocess boundary is a
 * known cost; a hand-maintained wire format is not.
 *
 * ## Every write is absent on purpose
 *
 * `addSource` and `addNote` throw `NotebookUnavailableError` even when the
 * credential is fine, and the message says why: writes belong in
 * `notebook_sync_queue` (migration 0015), where §7's prohibition on blindly
 * retrying an ambiguous write is enforced by a database trigger. An adapter
 * that could write directly would be a way around that trigger, so it cannot.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readCredential } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import {
  type Capability,
  type CapabilityState,
  type NotebookAdapter,
  NotebookUnavailableError,
  type SourceText,
} from './adapter.ts'

const run = promisify(execFile)

/** How long a single read may take before it is treated as an outage. */
const READ_TIMEOUT_MS = 240_000

export class LiveNotebookAdapter implements NotebookAdapter {
  /**
   * @param storageState The vaulted cookie jar. Passed in rather than read
   *   here so the adapter has no opinion about where credentials live, and so
   *   a test can drive it with a fixture.
   */
  constructor(private readonly storageState: string) {}

  /**
   * Load the credential from the vault and build an adapter.
   *
   * Returns `null` rather than throwing when there is no credential, because
   * "Notebook is not configured" is a normal state that the caller handles by
   * installing the unavailable adapter — not an exception.
   */
  static async fromVault(db: SqlExecutor): Promise<LiveNotebookAdapter | null> {
    const state = (await readCredential(db, 'notebook.storage_state')) ?? ''
    return state === '' ? null : new LiveNotebookAdapter(state)
  }

  private async read(args: readonly string[]): Promise<unknown> {
    let stdout: string
    try {
      const result = await run('python3', ['scripts/notebook/read.py', ...args], {
        // Through the environment, not argv: argv is world-readable in `ps`,
        // and this is a Google session.
        env: { ...process.env, NOTEBOOK_STORAGE_STATE: this.storageState },
        maxBuffer: 64 * 1024 * 1024,
        timeout: READ_TIMEOUT_MS,
      })
      stdout = result.stdout
    } catch (error) {
      const e = error as { stdout?: string; message?: string }
      // The reader prints `{"error": …}` and exits 1 for a handled failure, so
      // its stdout is worth reading even on a non-zero exit. Anything else is
      // an outage.
      const text = e.stdout ?? ''
      const detail =
        text.trim() !== '' ? text.trim().slice(0, 300) : (e.message ?? '').slice(0, 300)
      throw new NotebookUnavailableError('unavailable', detail)
    }

    const first = Math.min(...[stdout.indexOf('{'), stdout.indexOf('[')].filter((i) => i !== -1))
    if (!Number.isFinite(first)) {
      throw new NotebookUnavailableError('unavailable', 'the reader produced no JSON')
    }
    const parsed: unknown = JSON.parse(stdout.slice(first))
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      throw new NotebookUnavailableError(
        'unavailable',
        String((parsed as { error: unknown }).error).slice(0, 300),
      )
    }
    return parsed
  }

  async probe(): Promise<Capability> {
    try {
      const raw = (await this.read(['probe'])) as {
        state?: string
        capabilities?: string[]
        detected_tier?: number | null
        notebook_limit?: number | null
        source_limit?: number | null
        detail?: string
        latency_ms?: number | null
      }
      return {
        // Clamped to the five §7 states rather than trusted: a sixth state
        // invented downstream would not fit the Postgres enum, and finding
        // that out at an INSERT is worse than finding it out here.
        state:
          (
            [
              'available',
              'available_unofficial',
              'degraded',
              'unavailable',
              'auth_required',
            ] as const
          ).find((s) => s === raw.state) ?? 'degraded',
        capabilities: raw.capabilities ?? [],
        adapter: 'notebooklm-py',
        adapterVersion: null,
        detectedTier: raw.detected_tier ?? null,
        notebookLimit: raw.notebook_limit ?? null,
        sourceLimit: raw.source_limit ?? null,
        detail: String(raw.detail ?? ''),
        latencyMs: raw.latency_ms ?? null,
      }
    } catch (error) {
      // A probe never throws. Its whole job is to report a state, and an
      // unreachable dependency is a state rather than an absence of one.
      const state: CapabilityState =
        error instanceof NotebookUnavailableError && /auth|sign-in|login/i.test(error.detail)
          ? 'auth_required'
          : 'unavailable'
      return {
        state,
        capabilities: [],
        adapter: 'notebooklm-py',
        adapterVersion: null,
        detectedTier: null,
        notebookLimit: null,
        sourceLimit: null,
        detail: (error as Error).message.slice(0, 400),
        latencyMs: null,
      }
    }
  }

  async listNotebooks(): Promise<readonly { id: string; title: string }[]> {
    const raw = (await this.read(['notebooks'])) as { id?: string; title?: string }[]
    return raw.map((n) => ({ id: String(n.id), title: String(n.title ?? '') }))
  }

  async listSources(remoteNotebookId: string): Promise<readonly SourceText[]> {
    const raw = (await this.read(['sources', remoteNotebookId])) as Record<string, unknown>[]
    return raw.map((s) => ({
      remoteNotebookId: String(s.remote_notebook_id),
      remoteSourceId: String(s.remote_source_id),
      title: s.title === null || s.title === undefined ? null : String(s.title),
      content: String(s.content ?? ''),
      remoteUpdatedAt:
        s.remote_updated_at === null || s.remote_updated_at === undefined
          ? null
          : String(s.remote_updated_at),
    }))
  }

  async fetchSourceText(remoteNotebookId: string, remoteSourceId: string): Promise<SourceText> {
    const s = (await this.read(['fulltext', remoteNotebookId, remoteSourceId])) as Record<
      string,
      unknown
    >
    return {
      remoteNotebookId: String(s.remote_notebook_id),
      remoteSourceId: String(s.remote_source_id),
      title: s.title === null || s.title === undefined ? null : String(s.title),
      content: String(s.content ?? ''),
      remoteUpdatedAt: null,
    }
  }

  /** See the note on writes in this file's header. */
  private refuseWrite(operation: string): never {
    throw new NotebookUnavailableError(
      'degraded',
      `${operation} is not available on the read adapter by design: every Notebook ` +
        "write goes through notebook_sync_queue, where §7's prohibition on retrying " +
        'an ambiguous write is enforced by a database trigger. A direct write here ' +
        'would be a way around it.',
    )
  }

  async addSource(): Promise<string> {
    this.refuseWrite('addSource')
  }
  async addNote(): Promise<string> {
    this.refuseWrite('addNote')
  }
}
