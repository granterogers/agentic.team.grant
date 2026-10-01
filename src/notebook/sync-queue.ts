/**
 * The pending-Notebook-sync queue.
 *
 * §7: *"If Notebook is unavailable: continue operational work, store pending
 * Notebook synchronization, and reconcile on return. **Never lose completed
 * research because Notebook is down.**"*
 *
 * The emphasis is the design constraint. Losing the work is easy to do by
 * accident in three different ways, and each is closed here:
 *
 *   1. Queue a *reference* to the work and regenerate it later. It cannot
 *      always be regenerated — the inference that produced it was not free of
 *      quota, and the model may answer differently. So the payload is stored
 *      in full.
 *   2. Retry an ambiguous write and duplicate it, then clean up by deleting.
 *      §7 forbids the blind retry, and the database enforces that (0015).
 *   3. Drop a write that failed "permanently". Abandonment here always
 *      records a reason, and the CHECK constraint means it cannot be
 *      abandoned silently.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { OfficeId } from '../office/context.ts'
import type { Capability, NotebookAdapter } from './adapter.ts'
import { AmbiguousWriteError, fingerprint, NotebookUnavailableError } from './adapter.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | undefined): string => (v === undefined ? 'null' : lit(v))

export type NotebookOperation =
  | 'add_source'
  | 'add_note'
  | 'create_notebook'
  | 'delete_source'
  | 'generate_artifact'
  | 'update_note'

export interface QueueRequest {
  /** The office the write belongs to: the claimed job's. Every statement here is confined to it. */
  readonly office: OfficeId
  readonly operation: NotebookOperation
  readonly payload: Record<string, unknown>
  readonly projectId?: string | undefined
  readonly jobId?: string | undefined
}

export interface QueueResult {
  readonly syncId: string
  readonly contentFingerprint: string
  /** True when identical content was already queued and this collided. */
  readonly deduplicated: boolean
}

/**
 * Queue a write.
 *
 * Returns rather than throws on a duplicate: queueing the same research twice
 * is a normal consequence of a retried job, not an error, and §6's idempotency
 * posture is that identical logical work should collide rather than duplicate.
 */
export const enqueue = async (db: SqlExecutor, request: QueueRequest): Promise<QueueResult> => {
  const fp = await fingerprint(request.operation, request.payload)

  // `on conflict do nothing` against the partial unique index, then read back.
  // A pre-check would race: two workers finishing the same research
  // simultaneously would both find nothing and both insert.
  const office = lit(request.office)
  // The project and the job, when named, must be THIS office's: a foreign one is refused the same way a missing one
  // is (no row is written), never carried into the queue.
  const inserted = await db.execute(`
    insert into public.notebook_sync_queue
      (project_id, job_id, operation, payload, fingerprint, office_id)
    select
      ${nul(request.projectId)}::uuid, ${nul(request.jobId)}::uuid,
       ${lit(request.operation)}, ${lit(JSON.stringify(request.payload))}::jsonb, ${lit(fp)},
       ${office}::uuid
     where app.require_office(${office}::uuid) is not null
       and (${nul(request.projectId)}::uuid is null
            or exists (select 1 from public.projects p
                        where p.project_id = ${nul(request.projectId)}::uuid
                          and p.office_id = ${office}::uuid))
       and (${nul(request.jobId)}::uuid is null
            or exists (select 1 from public.jobs j
                        where j.job_id = ${nul(request.jobId)}::uuid
                          and j.office_id = ${office}::uuid))
    on conflict do nothing
    returning sync_id::text as sync_id
  `)

  const newId = inserted.rows[0]?.sync_id
  if (typeof newId === 'string') {
    return { syncId: newId, contentFingerprint: fp, deduplicated: false }
  }

  const existing = await db.execute(`
    select sync_id::text as sync_id from public.notebook_sync_queue
    where office_id = ${office}::uuid
      and fingerprint = ${lit(fp)}
      and state in ('pending', 'in_flight', 'uncertain', 'reconciling')
  `)
  const id = existing.rows[0]?.sync_id
  if (typeof id !== 'string') {
    // The insert was refused and no live row exists, which means the conflict
    // was on something else. Surfaced rather than swallowed: silently
    // returning a fabricated id would report queued work that is not queued.
    throw new Error(`queueing ${request.operation} was refused and no live row exists`)
  }
  return { syncId: id, contentFingerprint: fp, deduplicated: true }
}

/**
 * Attempt one queued write.
 *
 * The three outcomes are the point:
 *
 *   - it worked, and we know the remote reference
 *   - Notebook is unavailable, so the row stays `pending` and the work is
 *     still safe
 *   - the outcome is unknown, so the row becomes `uncertain` and **no retry is
 *     possible** until something reconciles it
 *
 * A `NotebookUnavailableError` explicitly does NOT mark the row uncertain. The
 * distinction is the whole reason those are separate error types: an outage
 * means the write never started, and treating it as ambiguous would send
 * every outage into a reconciliation queue that needs a human.
 */
export const attempt = async (
  db: SqlExecutor,
  adapter: NotebookAdapter,
  syncId: string,
  /** The office draining its queue: a row of any other office is "no such sync row". */
  office: OfficeId,
): Promise<'applied' | 'pending' | 'uncertain'> => {
  const { rows } = await db.execute(`
    select operation, payload::text as payload, fingerprint, state::text as state
    from public.notebook_sync_queue where sync_id = ${lit(syncId)}::uuid and office_id = ${lit(office)}::uuid
  `)
  const row = rows[0]
  if (row === undefined) throw new Error(`no such sync row ${syncId}`)
  if (row.state !== 'pending') {
    throw new Error(`sync ${syncId} is ${String(row.state)}, not pending`)
  }

  const operation = String(row.operation)
  const payload = JSON.parse(String(row.payload)) as Record<string, unknown>

  await db.execute(`
    update public.notebook_sync_queue
    set state = 'in_flight', attempt = attempt + 1
    where sync_id = ${lit(syncId)}::uuid
      and office_id = ${lit(office)}::uuid
  `)

  try {
    const remoteRef = await dispatch(adapter, operation, payload)
    await db.execute(`
      update public.notebook_sync_queue
      set state = 'applied', remote_ref = ${lit(remoteRef)}, last_error = null
      where sync_id = ${lit(syncId)}::uuid
        and office_id = ${lit(office)}::uuid
    `)
    return 'applied'
  } catch (error) {
    if (error instanceof NotebookUnavailableError) {
      // Back to pending. The write never happened, so there is nothing
      // ambiguous about it, and the work remains queued and intact.
      await db.execute(`
        update public.notebook_sync_queue
        set state = 'pending', last_error = ${lit(error.message.slice(0, 400))}
        where sync_id = ${lit(syncId)}::uuid
          and office_id = ${lit(office)}::uuid
      `)
      return 'pending'
    }

    if (error instanceof AmbiguousWriteError) {
      await db.execute(`
        update public.notebook_sync_queue
        set state = 'uncertain', uncertain_since = app.now_utc(),
            last_error = ${lit(error.message.slice(0, 400))}
        where sync_id = ${lit(syncId)}::uuid
          and office_id = ${lit(office)}::uuid
      `)
      return 'uncertain'
    }

    // An unrecognised error from an undocumented RPC is treated as ambiguous,
    // not as a failure. §7: "Assume undocumented operations may not be cleanly
    // idempotent" — so the safe reading of an unknown error is that the write
    // might have landed.
    const unrecognised = `unrecognised error, treated as ambiguous: ${(error as Error).message.slice(0, 300)}`
    await db.execute(`
      update public.notebook_sync_queue
      set state = 'uncertain', uncertain_since = app.now_utc(),
          last_error = ${lit(unrecognised)}
      where sync_id = ${lit(syncId)}::uuid
        and office_id = ${lit(office)}::uuid
    `)
    return 'uncertain'
  }
}

const dispatch = async (
  adapter: NotebookAdapter,
  operation: string,
  payload: Record<string, unknown>,
): Promise<string> => {
  switch (operation) {
    case 'add_source':
      return adapter.addSource(String(payload.notebook_id), String(payload.url))
    case 'add_note':
      return adapter.addNote(
        String(payload.notebook_id),
        String(payload.title),
        String(payload.body),
      )
    default:
      // Not "return a failure". An operation the dispatcher does not know is a
      // programming error, and pretending it failed would queue it forever.
      throw new Error(`no dispatch for Notebook operation ${operation}`)
  }
}

/**
 * Reconcile an uncertain write.
 *
 * §7 requires actual Notebook state to be checked before any retry, and this
 * is the only path out of `uncertain` — the database refuses
 * `uncertain -> in_flight` outright.
 *
 * @param found The remote reference if the write turns out to have landed, or
 *   null if it did not. Passed in rather than discovered here because
 *   discovering it needs a working adapter, and the caller is the one that has
 *   established Notebook is back.
 */
export const reconcile = async (
  db: SqlExecutor,
  syncId: string,
  found: string | null,
  /** The office reconciling its own queue. */
  office: OfficeId,
): Promise<'applied' | 'pending'> => {
  await db.execute(`
    update public.notebook_sync_queue
    set state = 'reconciling', reconciled_at = app.now_utc(), uncertain_since = null
    where sync_id = ${lit(syncId)}::uuid
      and office_id = ${lit(office)}::uuid
  `)

  if (found !== null) {
    await db.execute(`
      update public.notebook_sync_queue
      set state = 'applied', remote_ref = ${lit(found)}
      where sync_id = ${lit(syncId)}::uuid
        and office_id = ${lit(office)}::uuid
    `)
    return 'applied'
  }

  // It did not land, which is now a fact rather than an assumption, so retrying
  // is safe and the row goes back to pending.
  await db.execute(`
    update public.notebook_sync_queue
    set state = 'pending',
        last_error = 'reconciled: the write did not land, so a retry is safe'
    where sync_id = ${lit(syncId)}::uuid
      and office_id = ${lit(office)}::uuid
  `)
  return 'pending'
}

/** Record a capability probe. Every probe is kept; §7 wants the history. */
export const recordProbe = async (
  db: SqlExecutor,
  capability: Capability,
  /** The office whose Notebook connection was probed. A probe is never left to the bridge. */
  office: OfficeId,
): Promise<void> => {
  const arr =
    capability.capabilities.length === 0
      ? `'{}'::text[]`
      : `array[${capability.capabilities.map((c) => lit(c)).join(', ')}]::text[]`
  await db.execute(`
    insert into public.notebook_capability_probes
      (state, capabilities, adapter, adapter_version, detected_tier,
       notebook_limit, source_limit, detail, latency_ms, office_id)
    values
      (${lit(capability.state)}::public.notebook_capability_state, ${arr},
       ${lit(capability.adapter)}, ${nul(capability.adapterVersion ?? undefined)},
       ${capability.detectedTier === null ? 'null' : String(capability.detectedTier)},
       ${capability.notebookLimit === null ? 'null' : String(capability.notebookLimit)},
       ${capability.sourceLimit === null ? 'null' : String(capability.sourceLimit)},
       ${lit(capability.detail)},
       ${capability.latencyMs === null ? 'null' : String(capability.latencyMs)},
       ${lit(office)}::uuid)
  `)
}

/** Is the Notebook adapter switched on at all? §17's kill-switch. */
export const notebookEnabled = async (db: SqlExecutor): Promise<boolean> => {
  const { rows } = await db.execute(
    `select value::text as value from public.system_config where key = 'notebook.enabled'`,
  )
  return rows[0]?.value === 'true'
}
