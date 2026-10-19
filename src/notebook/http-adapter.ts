/**
 * The `NotebookAdapter` that needs no subprocess — reads over HTTPS.
 *
 * §7 required a strict adapter boundary. `UnavailableNotebookAdapter` proved
 * the degradation path, `LiveNotebookAdapter` proved the boundary was worth
 * having, and this is the one that paid for it: the runtime underneath changed
 * completely and nothing above the interface knows.
 *
 * ## Why it had to exist
 *
 * Every notebook read went through `scripts/notebook/read.py` in a subprocess.
 * That was fine while a GitHub Actions runner was the worker. Actions are off
 * (Grant: *"stop using github actions completely please .. for any process"*),
 * the only worker is a Supabase Edge Function, and Deno has no subprocesses —
 * so five notebook job kinds and the whole of §22 scenario A's "detected
 * within the sync interval" had no runtime that could run them.
 *
 * The way out was measuring rather than assuming: `notebooklm-py` depends on
 * `click`, `filelock`, `httpx` and `rich`. Playwright appears only in the
 * login capture path, which happens once, by hand, and already happened. So
 * the reads are plain HTTPS in a few hundred kilobytes of pure Python, and fit
 * as a serverless function on the Vercel project that already serves Team HQ —
 * free, and no new account.
 *
 * `api/notebook.py` is that function. It speaks the same four operations
 * `read.py` does, with the same JSON shapes, deliberately: two
 * implementations of one contract is the point, two contracts would be a
 * second thing to keep in step.
 *
 * ## Why the credential travels with the request
 *
 * §15 puts secrets in the Supabase Vault and nowhere else. This adapter has
 * vault access; the Vercel function does not, and stores nothing. So the
 * cookie jar is read here and sent, over TLS, for the life of one call. The
 * alternative — a copy of Grant's Google session in a Vercel environment
 * variable — is a second home for a credential and a second thing to rotate.
 *
 * The cost, stated rather than glossed: the jar transits a third party on
 * every read. `api/notebook.py` never logs a request body and every error
 * message it returns is a constant.
 *
 * ## Writes are absent here too
 *
 * For exactly the reason they are absent from the live adapter: every Notebook
 * write goes through `notebook_sync_queue` (0015), where §7's prohibition on
 * retrying an ambiguous write is enforced by a database trigger. An adapter
 * that could write directly would be a way around that trigger.
 */

import { credentialSql } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import {
  type Capability,
  type CapabilityState,
  type NotebookAdapter,
  NotebookUnavailableError,
  type SourceText,
} from './adapter.ts'
import { type MasterToken, masterTokenFrom } from './master-token.ts'

export { type MasterToken, masterTokenFrom }

/** How long one read may take before it is treated as an outage. */
const READ_TIMEOUT_MS = 55_000

const STATES = [
  'available',
  'available_unofficial',
  'degraded',
  'unavailable',
  'auth_required',
] as const

export class HttpNotebookAdapter implements NotebookAdapter {
  /**
   * @param endpoint The reader's URL, e.g. `https://…/api/notebook`.
   * @param secret The shared secret the reader compares in constant time.
   * @param storageState The cookie jar, as JSON text. Passed in rather than
   *   read here so the adapter has no opinion about where credentials live,
   *   and so a test can drive it with a fixture.
   */
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly storageState: string,
    // The durable master token, when the vault holds one. The reader mints a fresh jar from it per call,
    // so a stored jar that has gone stale no longer stops the reads.
    private readonly master: MasterToken | null = null,
  ) {}

  /**
   * Build one from the vault, or `null` if anything it needs is missing.
   *
   * Null rather than throwing, for the same reason `LiveNotebookAdapter.fromVault`
   * returns null: "there is no credential" is a state the caller handles by
   * installing the unavailable adapter, not an exception.
   */
  static async fromVault(db: SqlExecutor, endpoint?: string): Promise<HttpNotebookAdapter | null> {
    const { rows } = await db.execute(`
      select
        ${credentialSql('notebook.reader_secret')} as secret,
        ${credentialSql('notebook.storage_state')} as jar,
        ${credentialSql('notebook.master_token_json')} as master,
        (select value #>> '{}' from public.system_config
          where key = 'notebook.reader_url') as url
    `)
    const row = rows[0] as {
      secret?: string | null
      jar?: string | null
      master?: string | null
      url?: string | null
    }
    const secret = String(row?.secret ?? '')
    const jar = String(row?.jar ?? '')
    const master = masterTokenFrom(String(row?.master ?? ''))
    const url = endpoint ?? String(row?.url ?? '')
    // A master token is enough on its own: the reader mints the jar from it.
    if (secret === '' || url === '' || (jar === '' && master === null)) return null
    return new HttpNotebookAdapter(url, secret, jar, master)
  }

  private async call(op: string, extra: Record<string, string> = {}): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          op,
          storage_state: this.storageState,
          ...(this.master === null ? {} : { master_token: this.master }),
          ...extra,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      // A timeout or a network failure. `unavailable`, not `degraded`: we did
      // not reach the reader at all.
      throw new NotebookUnavailableError(
        'unavailable',
        `the notebook reader could not be reached: ${(error as Error).message.slice(0, 200)}`,
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      // An HTML error page from the platform rather than the function. Worth
      // distinguishing, because it means the deployment is wrong rather than
      // Google being unavailable.
      throw new NotebookUnavailableError(
        'unavailable',
        `the notebook reader answered ${String(response.status)} with ${text.slice(0, 120)}`,
      )
    }

    if (!response.ok) {
      const message = String((payload as { error?: string }).error ?? response.status)
      throw new NotebookUnavailableError(
        // A refused credential is an auth problem, not an outage, and the two
        // need opposite responses: sign in again versus wait.
        /auth|sign-in|login|unauthorized|401/i.test(message) ? 'auth_required' : 'degraded',
        message.slice(0, 400),
      )
    }
    return payload
  }

  async probe(): Promise<Capability> {
    const base = { adapter: 'notebooklm-py/http', adapterVersion: null }
    try {
      const raw = (await this.call('probe')) as {
        state?: string
        capabilities?: string[]
        detected_tier?: number | null
        notebook_limit?: number | null
        source_limit?: number | null
        detail?: string
        latency_ms?: number | null
      }
      return {
        ...base,
        // Clamped to the five §7 states rather than trusted: a sixth state
        // would not fit the Postgres enum, and finding that out at an INSERT
        // is worse than finding it out here.
        state: STATES.find((s) => s === raw.state) ?? 'degraded',
        capabilities: raw.capabilities ?? [],
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
        error instanceof NotebookUnavailableError && error.state === 'auth_required'
          ? 'auth_required'
          : 'unavailable'
      return {
        ...base,
        state,
        capabilities: [],
        detectedTier: null,
        notebookLimit: null,
        sourceLimit: null,
        detail: (error as Error).message.slice(0, 400),
        latencyMs: null,
      }
    }
  }

  async listNotebooks(): Promise<readonly { id: string; title: string }[]> {
    const raw = (await this.call('notebooks')) as { id?: string; title?: string }[]
    return raw.map((n) => ({ id: String(n.id), title: String(n.title ?? '') }))
  }

  async listSources(remoteNotebookId: string): Promise<readonly SourceText[]> {
    const raw = (await this.call('sources', { notebook_id: remoteNotebookId })) as Record<
      string,
      unknown
    >[]
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
    const s = (await this.call('fulltext', {
      notebook_id: remoteNotebookId,
      source_id: remoteSourceId,
    })) as Record<string, unknown>
    return {
      remoteNotebookId: String(s.remote_notebook_id),
      remoteSourceId: String(s.remote_source_id),
      title: s.title === null || s.title === undefined ? null : String(s.title),
      content: String(s.content ?? ''),
      remoteUpdatedAt: null,
    }
  }

  private refuseWrite(operation: string): never {
    throw new NotebookUnavailableError(
      'degraded',
      `${operation} is not available on a read adapter by design: every Notebook ` +
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
