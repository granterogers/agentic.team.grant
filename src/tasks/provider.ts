/**
 * What a task provider is, and deliberately nothing about any one of them.
 *
 * #259's Phase 1 built the seam in the database — `task_links`,
 * `task_tombstones`, `tasks.revision`, a push watermark — and Phase 2 needs the
 * other half of the same idea in the code: ONE interface the sync engine talks
 * to, so `src/tasks/sync.ts` can be read without knowing whether the thing on
 * the other side is Vikunja, Todoist or a spreadsheet.
 *
 * The brief's test of this is exact: *"if the real Vikunja integration exposes
 * a weakness in the supposedly provider-neutral architecture, fix the
 * underlying abstraction rather than adding brittle Vikunja-specific
 * exceptions."* Two weaknesses turned up and both are fixed here rather than
 * there:
 *
 *   - there was no inbound door at all (migration 0518, `app.task_pulled`);
 *   - a provider's own revision is a STRING for some providers and a number
 *     for others, so `externalRevision` is text and nothing compares it with
 *     `<`. What decides staleness is the canonical `revision`, which the
 *     office owns.
 *
 * ## Supabase is canonical, and this file is where that is enforced in types
 *
 * A provider may report what it holds. It may never be the thing consulted to
 * answer "what is on Grant's list" — that is `app.my_tasks`, always. Nothing
 * in this interface returns a canonical id, because a provider does not have
 * one: the mapping lives in `public.task_links` and only the engine reads it.
 */

/** A task as the office holds it, flattened for a provider to write. */
export interface CanonicalTask {
  /** The canonical uuid. Stable for the life of the task (#259). */
  readonly id: string
  /** Moves on every material change. The staleness clock for the whole seam. */
  readonly revision: number
  readonly title: string
  readonly detail: string
  readonly done: boolean
  /** 10 urgent · 20 important · 50 normal · 100 whenever. LOWER is hotter. */
  readonly priority: number | null
  /** A DATE, not an instant. The provider decides what time of day means. */
  readonly dueOn: string | null
  /** Where this task already lives at the provider, when it has been there. */
  readonly externalId: string | null
  readonly externalProjectId: string | null
}

/** A task as a provider reports it. */
export interface RemoteTask {
  readonly externalId: string
  /**
   * The provider's own idea of "when this last changed", as TEXT.
   *
   * Never compared with `<` or parsed. Providers disagree about whether this
   * is a timestamp, an etag or a counter, and a seam that assumed one of those
   * would be the Vikunja-specific exception this interface exists to avoid.
   * It is carried so a human diagnosing a disagreement can see both sides.
   */
  readonly externalRevision: string
  readonly title: string
  readonly detail: string
  readonly done: boolean
  readonly priority: number | null
  readonly dueOn: string | null
  readonly externalProjectId: string
  /** The office's own mark on this task, when the provider carries one (the canonical id it was created from). */
  readonly canonicalId?: string | null
}

export interface UpsertResult {
  readonly externalId: string
  readonly externalRevision: string
  readonly externalProjectId: string
}

/**
 * The provider itself.
 *
 * Four verbs. Anything a provider can do beyond these is not part of keeping
 * two lists in step, and putting it here would invite the engine to use it.
 */
export interface TaskProvider {
  /** The name stored in `task_links.provider`. Lower case, stable for ever. */
  readonly name: string
  /** Create or update. Idempotent on `externalId` when one is supplied. */
  upsert(task: CanonicalTask): Promise<UpsertResult>
  /** Remove. Removing something already gone is a success, not an error. */
  remove(externalId: string): Promise<void>
  /** Everything the provider holds for this office. */
  list(): Promise<RemoteTask[]>
  /** Is it there at all? Used to tell an outage from a disagreement. */
  reachable(): Promise<boolean>
}

/** A provider that could not be reached. Never a reason to touch native data. */
export class ProviderDownError extends Error {
  constructor(
    readonly provider: string,
    readonly detail: string,
  ) {
    super(`${provider} could not be reached: ${detail}`)
    this.name = 'ProviderDownError'
  }
}
