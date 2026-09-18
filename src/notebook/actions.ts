/**
 * NotebookLM write actions, from TypeScript.
 *
 * The read side is `live-adapter.ts`; this is separate because the two carry
 * different risk. A read that fails costs a retry. A write that half-succeeds
 * leaves something in Grant's notebook that nothing in Postgres knows about,
 * and a notebook has no transaction to roll it back with.
 *
 * ## What this is FOR
 *
 * Grant's reason for the Python binding, in his words: *"so that through Claude
 * you can tell it to generate an audio overview, a presentation, all the stuff
 * that the notebook does."* NotebookLM's value here is that it **produces** —
 * Notion stores, the notebook generates — so these are the productive actions
 * plus what is needed to feed them.
 *
 * ## Generation does not wait, on purpose
 *
 * An audio overview takes minutes. Blocking a tool call for four minutes is a
 * tool call that times out in every MCP client, so `generate` starts the work
 * and returns an id, and `poll` reports on it. Two calls is a worse interface
 * than one and it is the honest one: the alternative appears to work and fails
 * on the first real artifact.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SqlExecutor } from '../db/executor.ts'
import { AmbiguousWriteError } from './adapter.ts'

const run = promisify(execFile)

/** Generous: adding a URL source makes Google fetch and process the page. */
const ACTION_TIMEOUT_MS = 120_000

export type ArtifactKind =
  | 'audio'
  | 'slides'
  | 'video'
  | 'mindmap'
  | 'report'
  | 'infographic'
  | 'quiz'
  | 'flashcards'
  | 'study_guide'

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'audio',
  'slides',
  'video',
  'mindmap',
  'report',
  'infographic',
  'quiz',
  'flashcards',
  'study_guide',
]

/**
 * The library's word for a kind, translated into the office's.
 *
 * ## Two vocabularies, found by listing a real notebook
 *
 * The provider answers `slide_deck` and `mind_map`; this office says `slides`
 * and `mindmap`, and `ARTIFACT_KINDS`, the request matcher, the job payloads
 * and the page's `KIND_SAID` all speak the second. Adoption stored the wire
 * word verbatim, `public.artifacts.kind` has no CHECK to refuse it, and the
 * page falls through to the raw string for a kind it has no English for — so
 * a slide deck Grant made himself appeared on his Sources tab as
 * **"slide_deck"**, and a mind map as **"mind_map"**.
 *
 * Nothing failed, which is why nothing caught it: the unknown-kind fallback
 * exists precisely so a new type does not break enumeration, and it did its
 * job over a type that is not new at all. Found by running a real listing —
 * 4 of the 12 artifacts in Grant's four notebooks are these two kinds.
 *
 * 0311 is the migration about this exact shape: two words for one thing, and
 * no reader able to tell them apart. The answer there was to speak one
 * vocabulary and translate at the boundary, which is what this is.
 *
 * Unknown stays unknown rather than being guessed at. A kind nobody has
 * mapped is a kind this office genuinely does not have a word for, and
 * inventing one would put a wrong label on a real artifact.
 */
const FROM_LIBRARY: Readonly<Record<string, ArtifactKind>> = {
  audio: 'audio',
  flashcards: 'flashcards',
  infographic: 'infographic',
  mind_map: 'mindmap',
  quiz: 'quiz',
  report: 'report',
  slide_deck: 'slides',
  study_guide: 'study_guide',
  video: 'video',
}

export function officeKind(libraryKind: string): string {
  return FROM_LIBRARY[libraryKind] ?? libraryKind
}

/** One row of the notebook's artifact listing. */
export interface ArtifactListing {
  readonly artifactId: string
  readonly title: string | null
  /**
   * The library's own `ArtifactType`: audio, slide_deck, mind_map, report…
   *
   * Read through the library rather than mapped from the wire integer here.
   * It knows things a table of ours would not — type 4 is a quiz, a flashcard
   * set OR an interactive mind map depending on a variant field — and the first
   * version of this file, whose table was built by looking at Grant's notebook,
   * had no entry for a mind map at all and quietly never found one.
   */
  readonly kind: string
  /** The raw code behind `kind`. Diagnostic only; never matched on. */
  readonly type: string
  /** `status_str`: pending | in_progress | completed | failed | … */
  readonly status: string
  /**
   * The library's own verdict, not ours.
   *
   * Read from `is_completed` / `is_failed` rather than compared against a code
   * table here. The library says in as many words that the integers are not to
   * be read directly, and it is right: PENDING and PROCESSING were transposed
   * on the wire in an earlier release. A table of our own would have gone on
   * reading the old meaning without a symptom.
   */
  readonly done: boolean
  readonly failed: boolean
  readonly createdAt: string | null
}

export class NotebookActionError extends Error {
  constructor(
    readonly action: string,
    readonly detail: string,
    /**
     * Google refused for quota rather than for cause.
     *
     * A distinct flag and not a substring the caller re-matches, because the
     * caller does something different about it — defers to the next window
     * instead of retrying into the same wall, and records the refusal as the
     * only real measurement of where the ceiling is (0078). Losing the
     * distinction costs five retries and the lesson.
     */
    readonly quota = false,
  ) {
    super(`notebook ${action} failed: ${detail}`)
    this.name = 'NotebookActionError'
  }
}

/**
 * How an action reaches Python.
 *
 * Two ways, one contract. `act.py` prints a single JSON object either way —
 * this type is the seam, and it exists because the runtime under the office
 * changed without the actions changing at all.
 */
export interface ActionTransport {
  readonly name: string
  perform(action: string, args: Record<string, unknown>): Promise<Record<string, unknown>>
}

/**
 * Spawn `act.py` here.
 *
 * The original arrangement, kept for a runtime that has Python — a developer
 * machine, this sandbox, the verification suite. Not available in Deno, which
 * is why the HTTP transport below exists.
 */
class SubprocessTransport implements ActionTransport {
  readonly name = 'subprocess'
  constructor(private readonly storageState: string) {}

  async perform(action: string, args: Record<string, unknown>) {
    let stdout: string
    try {
      const result = await run(
        'python3',
        ['scripts/notebook/act.py', action, JSON.stringify(args)],
        {
          // Through the environment, not argv: argv is world-readable in `ps`,
          // and this is a Google session cookie.
          env: { ...process.env, NOTEBOOK_STORAGE_STATE: this.storageState },
          maxBuffer: 16 * 1024 * 1024,
          timeout: ACTION_TIMEOUT_MS,
        },
      )
      stdout = result.stdout
    } catch (error) {
      const e = error as { stdout?: string; message?: string; killed?: boolean }
      // A killed process is §7's ambiguous write, not a failure: the write may
      // have reached Google before the timeout, and asking again is how one
      // source becomes three.
      if (e.killed === true) {
        throw new AmbiguousWriteError(action, JSON.stringify(args).slice(0, 60))
      }
      // The runner prints `{"ok":false,…}` and exits 1 for a handled failure,
      // so its stdout is worth reading even on a non-zero exit.
      const text = (e.stdout ?? '').trim()
      if (text !== '') {
        try {
          const parsed = JSON.parse(text.slice(text.indexOf('{'))) as {
            error?: string
            quota?: boolean
          }
          throw new NotebookActionError(
            action,
            String(parsed.error ?? text).slice(0, 300),
            parsed.quota === true,
          )
        } catch (parseError) {
          if (parseError instanceof NotebookActionError) throw parseError
        }
      }
      throw new NotebookActionError(action, (e.message ?? 'no output').slice(0, 300))
    }

    const start = stdout.indexOf('{')
    if (start === -1) throw new NotebookActionError(action, 'the runner produced no JSON')
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>
  }
}

/**
 * Ask the Vercel function to spawn it instead.
 *
 * Plain `fetch`, so it works in Deno — which is the whole reason it exists.
 * `api/notebook-act.py` runs the same `act.py` and relays its JSON verbatim,
 * so what comes back here is what the subprocess transport would have
 * produced.
 */
class HttpActionTransport implements ActionTransport {
  readonly name = 'http'
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly storageState: string,
  ) {}

  async perform(action: string, args: Record<string, unknown>) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACTION_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args, storage_state: this.storageState }),
        signal: controller.signal,
      })
    } catch (error) {
      // We never heard back. For a WRITE that is ambiguous by definition, and
      // §7 is explicit that it must not be blindly retried.
      throw new AmbiguousWriteError(
        action,
        `${(error as Error).message.slice(0, 60)} ${JSON.stringify(args).slice(0, 40)}`,
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let parsed: { ok?: boolean; error?: string; quota?: boolean; timeout?: boolean }
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      throw new NotebookActionError(
        action,
        `the writer answered ${String(response.status)} with ${text.slice(0, 120)}`,
      )
    }

    // The function's own word for "it may have happened".
    if (parsed.timeout === true) {
      throw new AmbiguousWriteError(action, String(parsed.error ?? '').slice(0, 60))
    }
    if (parsed.ok !== true) {
      throw new NotebookActionError(
        action,
        String(parsed.error ?? `http ${String(response.status)}`).slice(0, 300),
        parsed.quota === true,
      )
    }
    return parsed as Record<string, unknown>
  }
}

export class NotebookActions {
  private constructor(private readonly transport: ActionTransport) {}

  /** Which way this instance reaches Python. Reported, never assumed. */
  get via(): string {
    return this.transport.name
  }

  /**
   * Build from the vault, or null when there is no credential.
   *
   * Null rather than throwing: no credential is a normal state — the
   * integration is §17-disableable and was off for two days this week — and a
   * caller that must handle "off" anyway should not also handle an exception.
   *
   * HTTP wins when it is configured, on every runtime rather than only on the
   * ones with no Python. One transport in use everywhere is one transport that
   * gets exercised; a fallback that only runs on a developer machine is a
   * fallback nobody finds out is broken.
   */
  static async fromVault(db: SqlExecutor): Promise<NotebookActions | null> {
    const { rows } = await db.execute(`
      select
        (select decrypted_secret from vault.decrypted_secrets
          where name = 'notebook.storage_state') as jar,
        (select decrypted_secret from vault.decrypted_secrets
          where name = 'notebook.reader_secret') as secret,
        (select value #>> '{}' from public.system_config
          where key = 'notebook.writer_url') as url
    `)
    const row = rows[0] as { jar?: string | null; secret?: string | null; url?: string | null }
    const state = String(row?.jar ?? '')
    if (state === '') return null

    const secret = String(row?.secret ?? '')
    const url = String(row?.url ?? '')
    return new NotebookActions(
      secret === '' || url === ''
        ? new SubprocessTransport(state)
        : new HttpActionTransport(url, secret, state),
    )
  }

  /**
   * One action, whichever way this instance reaches Python.
   *
   * Kept as a method rather than inlined at fourteen call sites: it is the
   * single place a failure becomes a typed error, and §7's distinction
   * between "it failed" and "it may have happened" is the reason that place
   * has to be single.
   */
  private async act(
    action: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = await this.transport.perform(action, args)
    if (parsed.ok !== true) {
      throw new NotebookActionError(
        action,
        String(parsed.error ?? 'unknown failure').slice(0, 300),
        parsed.quota === true,
      )
    }
    return parsed
  }

  /**
   * Make a new notebook.
   *
   * `notebook_id` is required by every other action here, so this is the one
   * that can be called without one — Grant asked for *"a new notebook project
   * called AI Learning"*, and until now the only way to get a notebook was for
   * him to make it and paste the link.
   */
  async createNotebook(title: string): Promise<{ id: string; title: string }> {
    const r = await this.act('create_notebook', { notebook_id: 'new', title })
    return { id: String(r.notebook_id), title: String(r.title ?? title) }
  }

  /**
   * Every notebook in Grant's account.
   *
   * Read before creating anything: he had a notebook called "AI learning" and
   * the planner made a second called "AI Learning" beside it, because nothing
   * looked. One network call is cheap against the cost of a duplicate nobody
   * asked for in somebody else's Google account.
   */
  async notebooks(): Promise<readonly { id: string; title: string }[]> {
    const r = await this.act('notebooks', { notebook_id: 'list' })
    return ((r.notebooks ?? []) as Record<string, unknown>[]).map((n) => ({
      id: String(n.notebook_id),
      title: String(n.title ?? ''),
    }))
  }

  /** Put text into a notebook as a source. */
  async addText(notebookId: string, text: string, title?: string): Promise<string | null> {
    const r = await this.act('add_text', { notebook_id: notebookId, text, title })
    return r.source_id === undefined || r.source_id === null ? null : String(r.source_id)
  }

  /** Put a URL into a notebook as a source; Google fetches and processes it. */
  async addUrl(notebookId: string, url: string): Promise<string | null> {
    const r = await this.act('add_url', { notebook_id: notebookId, url })
    return r.source_id === undefined || r.source_id === null ? null : String(r.source_id)
  }

  /** Write a note — a conclusion, back where Grant will read it. */
  async createNote(notebookId: string, content: string, title?: string): Promise<string | null> {
    const r = await this.act('create_note', { notebook_id: notebookId, content, title })
    return r.note_id === undefined || r.note_id === null ? null : String(r.note_id)
  }

  /**
   * Start an artifact. Returns immediately with a task id.
   *
   * A generator returns `GenerationStatus` — `task_id`, `status`, `url` — and
   * not an Artifact. Reading `.id` off it returned null, and the caller
   * cheerfully reported "generation started" with nothing to follow up: a
   * plausible success that could never be checked. Follow it with `artifacts`.
   */
  async generate(
    notebookId: string,
    kind: ArtifactKind,
    instructions?: string,
  ): Promise<{ taskId: string | null; state: string }> {
    const r = await this.act('generate', { notebook_id: notebookId, kind, instructions })
    return {
      taskId: r.task_id === undefined || r.task_id === null ? null : String(r.task_id),
      state: String(r.state ?? 'generating'),
    }
  }

  /**
   * What the notebook holds now. How a started generation is followed.
   *
   * `type` and `createdAt` come through because they are how a collector picks
   * its own artifact out of the list. `generate` hands back a TASK id and the
   * artifact appears minutes later under an unrelated id, so identifying it
   * means comparing the listing against what was there before — and the type
   * is the tiebreak when two arrived in the same window.
   */
  async artifacts(notebookId: string): Promise<readonly ArtifactListing[]> {
    const r = await this.act('artifacts', { notebook_id: notebookId })
    return ((r.artifacts ?? []) as Record<string, unknown>[]).map((a) => ({
      artifactId: String(a.artifact_id),
      title: a.title === undefined || a.title === null ? null : String(a.title),
      kind: String(a.kind ?? 'unknown'),
      type: String(a.type ?? ''),
      status: String(a.status ?? 'unknown'),
      done: a.done === true,
      failed: a.failed === true,
      createdAt: a.created_at === undefined || a.created_at === null ? null : String(a.created_at),
    }))
  }

  async poll(
    notebookId: string,
    artifactId: string,
  ): Promise<{
    state: string
    done: boolean
    failed: boolean
    title: string | null
    url: string | null
  }> {
    const r = await this.act('poll', { notebook_id: notebookId, artifact_id: artifactId })
    return {
      state: String(r.state ?? 'unknown'),
      done: r.done === true,
      failed: r.failed === true,
      title: r.title === undefined || r.title === null ? null : String(r.title),
      url: r.url === undefined || r.url === null ? null : String(r.url),
    }
  }

  /**
   * The sources in a notebook, optionally with the first of each one's text.
   *
   * `withText` is how a person decides whether a source is worth keeping. Grant:
   * *"be careful of the stuff that you're generating — there's some really odd
   * looking files there, so inspect the content, make sure everything's seen."*
   * A title tells you nothing: the leftover probe source in his notebook was
   * called "AI Team HQ probe mtq92rvn", which is either a test fixture or a
   * research note depending on whether you read it.
   */
  async sources(
    notebookId: string,
    withText = false,
  ): Promise<
    readonly {
      sourceId: string
      title: string | null
      status: string
      chars: number | null
      opening: string | null
    }[]
  > {
    const r = await this.act('sources', { notebook_id: notebookId, with_text: withText })
    return ((r.sources ?? []) as Record<string, unknown>[]).map((x) => ({
      sourceId: String(x.source_id),
      title: x.title === undefined || x.title === null ? null : String(x.title),
      status: String(x.status ?? ''),
      chars: x.chars === undefined || x.chars === null ? null : Number(x.chars),
      opening: x.opening === undefined || x.opening === null ? null : String(x.opening),
    }))
  }

  /**
   * Remove a source, by its exact id.
   *
   * The only destructive operations in this class, and deliberately narrow:
   * there is no delete-by-title and no delete-all. A wildcard against Grant's
   * own notebook is not recoverable from our side, and the thing that would
   * make one tempting — a tidy-up script — is exactly the thing most likely to
   * be run without reading it first.
   */
  async deleteSource(notebookId: string, sourceId: string): Promise<void> {
    await this.act('delete_source', { notebook_id: notebookId, source_id: sourceId })
  }

  async deleteArtifact(notebookId: string, artifactId: string): Promise<void> {
    await this.act('delete_artifact', { notebook_id: notebookId, artifact_id: artifactId })
  }

  /** Ask the notebook about its own sources. */
  /**
   * The bytes of a finished artifact.
   *
   * Issue #66. Everything up to "the notebook has an artifact" existed and
   * nothing could get one out, so the chain stopped one step short of the only
   * step Grant cares about — having the audio in his hand rather than a reason
   * to go and open NotebookLM.
   *
   * Two shapes come back because the library offers two, and which one depends
   * on its version: a share URL, or the bytes. A URL is preferred and returned
   * as-is — it is smaller to pass through the JSON envelope, and the caller can
   * stream it rather than holding an audio file in memory on a serverless
   * function with a 60s ceiling.
   */
  async download(
    notebookId: string,
    artifactId: string,
  ): Promise<{
    url: string | null
    bytes: Uint8Array | null
    title: string | null
    kind: string
  }> {
    const r = await this.act('download', { notebook_id: notebookId, artifact_id: artifactId })
    const b64 = r.base64 === undefined || r.base64 === null ? null : String(r.base64)
    return {
      url: r.url === undefined || r.url === null ? null : String(r.url),
      // `Uint8Array`, not `Buffer`. This module is imported by code that runs
      // in Deno, where Buffer is not a global — bitten three times already.
      bytes: b64 === null ? null : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
      title: r.title === undefined || r.title === null ? null : String(r.title),
      kind: String(r.kind ?? 'unknown'),
    }
  }

  async ask(notebookId: string, question: string): Promise<string> {
    const r = await this.act('ask', { notebook_id: notebookId, question })
    return String(r.answer ?? '')
  }
}
