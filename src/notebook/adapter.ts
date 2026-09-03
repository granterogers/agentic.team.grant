/**
 * The `NotebookAdapter` boundary.
 *
 * §7: *"Maintain a strict `NotebookAdapter` boundary."* The reason it is an
 * interface with a null implementation, rather than a class that calls the
 * library, is the sentence after it: consumer Notebook automation relies on
 * *"undocumented private RPC behaviour"*, and §7's last rule is that
 *
 *   "a Notebook outage or breaking API change must degrade Notebook
 *    functionality without corrupting or disabling the rest of Team HQ."
 *
 * A boundary only delivers that if the rest of the system depends on the
 * *interface* and never on the implementation. So the interface is defined
 * here, the unavailable implementation is here too, and it is the one that
 * ships until Gate 2 passes — which means the degradation path is the default
 * path and gets exercised on every run rather than only during an outage.
 *
 * Nothing in `src/jobs`, `src/providers` or `src/channels` imports this file.
 * That is the *"never make operational state depend on Notebook"* rule, and it
 * is checked by a test rather than left to discipline.
 */

/** §7's five states, no more and no fewer. */
export type CapabilityState =
  | 'available'
  | 'available_unofficial'
  | 'degraded'
  | 'unavailable'
  | 'auth_required'

export interface Capability {
  readonly state: CapabilityState
  /** Individually confirmed capabilities. Empty when nothing was confirmed. */
  readonly capabilities: readonly string[]
  readonly adapter: string
  readonly adapterVersion: string | null
  /**
   * §11: *"Read `AccountLimits.tier` at startup and derive budgets from the
   * detected tier — never hard-code quota numbers, which Google changes
   * without updating its own published tables."* Null when unread, and a null
   * must never be replaced with a documented default: that is the hard-coding
   * the rule forbids, wearing a fallback's clothes.
   */
  readonly detectedTier: number | null
  readonly notebookLimit: number | null
  readonly sourceLimit: number | null
  /** Non-secret. Never a credential, never a token. */
  readonly detail: string
  readonly latencyMs: number | null
}

export class NotebookUnavailableError extends Error {
  constructor(
    readonly state: CapabilityState,
    readonly detail: string,
  ) {
    super(`Notebook is ${state}: ${detail}`)
    this.name = 'NotebookUnavailableError'
  }
}

/**
 * Raised when a write's outcome cannot be determined.
 *
 * §7: *"Never blindly retry an ambiguous Notebook write. After a timeout or
 * uncertain write, reconcile actual Notebook state first. Assume undocumented
 * operations may not be cleanly idempotent."*
 *
 * Deliberately **not** a subclass of `NotebookUnavailableError`. An outage and
 * an ambiguous write need opposite responses — wait versus investigate — and a
 * shared supertype invites one `catch` to handle both, which would turn every
 * timeout into a retry.
 */
export class AmbiguousWriteError extends Error {
  constructor(
    readonly operation: string,
    readonly contentFingerprint: string,
  ) {
    super(
      `the outcome of ${operation} (${contentFingerprint.slice(0, 12)}) is unknown. ` +
        'Reconcile actual Notebook state before any retry (§7).',
    )
    this.name = 'AmbiguousWriteError'
  }
}

export interface SourceText {
  readonly remoteNotebookId: string
  readonly remoteSourceId: string
  readonly title: string | null
  readonly content: string
  readonly remoteUpdatedAt: string | null
}

/**
 * What the rest of the system is allowed to know about Notebook.
 *
 * Read operations return data. Write operations return a remote reference or
 * throw `AmbiguousWriteError` — there is no boolean success, because a boolean
 * cannot express "it may have worked", which is the case §7 cares about.
 */
export interface NotebookAdapter {
  probe(): Promise<Capability>
  listSources(remoteNotebookId: string): Promise<readonly SourceText[]>
  fetchSourceText(remoteNotebookId: string, remoteSourceId: string): Promise<SourceText>
  addSource(remoteNotebookId: string, url: string): Promise<string>
  addNote(remoteNotebookId: string, title: string, body: string): Promise<string>
}

/**
 * The implementation that ships until Gate 2 passes.
 *
 * Every read and write throws `NotebookUnavailableError`. That is not a stub
 * standing in for real behaviour — it is the *correct* behaviour for the
 * current state, because there is no credential, and §7 requires the adapter
 * to report `AUTH_REQUIRED` rather than fail obscurely at a call site.
 *
 * Shipping this as the default has a second effect worth the trade: the
 * degradation path is exercised continuously rather than first discovered
 * during an outage.
 */
export class UnavailableNotebookAdapter implements NotebookAdapter {
  constructor(
    private readonly state: CapabilityState = 'auth_required',
    private readonly detail = 'no Notebook credential exists - see HUMAN_ONLY_PREREQUISITES.md Phase 4',
  ) {}

  async probe(): Promise<Capability> {
    return {
      state: this.state,
      capabilities: [],
      adapter: 'unavailable',
      adapterVersion: null,
      detectedTier: null,
      notebookLimit: null,
      sourceLimit: null,
      detail: this.detail,
      latencyMs: null,
    }
  }

  private refuse(): never {
    throw new NotebookUnavailableError(this.state, this.detail)
  }

  // The full parameter lists are declared even though none is read. TypeScript
  // lets a class satisfy an interface with fewer parameters, so `listSources()`
  // compiled — and then a subclass overriding it with the real signature did
  // not, because the override would widen what the base class accepts. The
  // error surfaced at the call site rather than at the class, which is the
  // wrong end to find out. Declaring the contract in full keeps the class
  // substitutable and any subclass free to use the arguments.
  async listSources(_remoteNotebookId: string): Promise<readonly SourceText[]> {
    this.refuse()
  }
  async fetchSourceText(_remoteNotebookId: string, _remoteSourceId: string): Promise<SourceText> {
    this.refuse()
  }
  async addSource(_remoteNotebookId: string, _url: string): Promise<string> {
    this.refuse()
  }
  async addNote(_remoteNotebookId: string, _title: string, _body: string): Promise<string> {
    this.refuse()
  }
}

/**
 * Content fingerprint for a queued write.
 *
 * §7: *"Fingerprint sources and AI-generated writes; prevent duplicate
 * processing."* Content-addressed, so the same content queued twice collides at
 * the unique index rather than being written twice — which is the only version
 * of this that survives a crash between the check and the write.
 *
 * The operation is part of the input: adding a note and adding a source with
 * identical text are different intentions, and one must not suppress the other.
 */
export const fingerprint = async (operation: string, payload: unknown): Promise<string> => {
  // Sorted keys, so two payloads differing only in property order fingerprint
  // identically. Without it the de-duplication would depend on serialisation
  // order, which nothing guarantees.
  const canonical = JSON.stringify(sortDeep(payload))
  const bytes = new TextEncoder().encode(`${operation} ${canonical}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortDeep(v)]),
    )
  }
  return value
}
