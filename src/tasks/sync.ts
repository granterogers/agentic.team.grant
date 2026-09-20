/**
 * Keeping one list in two places, without either of them becoming the other.
 *
 * Supabase is canonical (CLAUDE.md, #259's first invariant). A provider is a
 * PROJECTION: it may be told everything, it may report a change, and it may
 * never be the thing consulted to answer "what is on Grant's list". Every rule
 * below follows from that one sentence.
 *
 * ## The round, in order, and why that order
 *
 *   1. PUSH deletions first. A provider that learns about a creation before a
 *      deletion will eventually apply them out of order and resurrect a task
 *      Grant deleted — which is why `app.tasks_to_push` returns both in one
 *      answer rather than leaving a caller to fetch them separately.
 *   2. PUSH upserts. Anything whose canonical revision has moved past the
 *      watermark.
 *   3. PULL. Everything the provider holds, applied through
 *      `app.task_pulled`, which owns the conflict policy and the tombstone
 *      rule.
 *
 * Push before pull, deliberately: a conflict is then decided against the
 * freshest canonical value rather than against one this round was about to
 * change anyway.
 *
 * ## An outage is not a disagreement
 *
 * `ProviderDownError` ends the round and touches nothing. The canonical list
 * is unchanged, no watermark moves, and the next round starts from exactly
 * where this one did — which is what makes reconnecting a catch-up rather than
 * a reconciliation. Any other failure is recorded against the one task it
 * belongs to (`app.task_push_failed`) and the round continues, because one
 * refused task must not stop the other forty.
 */
import type { SqlExecutor } from '../db/executor.ts'
import { type CanonicalTask, ProviderDownError, type TaskProvider } from './provider.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

export interface SyncReport {
  readonly provider: string
  readonly pushed: number
  readonly deleted: number
  readonly pulled: number
  readonly created: number
  readonly conflicts: number
  readonly failed: number
  /** Set when the provider could not be reached. Nothing else ran. */
  readonly down: string | null
}

interface Pushable {
  id: string
  revision: number
  title: string
  detail: string | null
  done: boolean
  priority: number | null
  due_on: string | null
  external_id: string | null
  external_project_id: string | null
}

interface Deletable {
  id: string
  title: string
  links: { provider?: string; external_id?: string }[]
}

/**
 * One round. Safe to run again immediately; safe to run while Grant is typing.
 */
export async function syncOnce(
  db: SqlExecutor,
  provider: TaskProvider,
  opts: { readonly limit?: number } = {},
): Promise<SyncReport> {
  const name = provider.name
  let pushed = 0
  let deleted = 0
  let pulled = 0
  let created = 0
  let conflicts = 0
  let failed = 0

  try {
    const work = asJson(
      (
        await db.execute(
          `select app.tasks_to_push(${lit(name)}, ${String(opts.limit ?? 200)}) as v`,
        )
      ).rows[0]?.v,
    )
    const upserts = (work.upserts ?? []) as Pushable[]
    const deletes = (work.deletes ?? []) as Deletable[]

    // --- 1. deletions, before anything can recreate them ---------------------
    for (const d of deletes) {
      const link = (d.links ?? []).find((l) => l.provider === name)
      const ext = String(link?.external_id ?? '')
      if (ext === '') continue
      await provider.remove(ext)
      await db.execute(`select app.task_delete_pushed(${lit(d.id)}::uuid, ${lit(name)})`)
      deleted += 1
    }

    // --- 2. everything the office has moved ----------------------------------
    for (const t of upserts) {
      const task: CanonicalTask = {
        id: t.id,
        revision: t.revision,
        title: t.title,
        detail: t.detail ?? '',
        done: t.done,
        priority: t.priority,
        dueOn: t.due_on,
        externalId: t.external_id,
        externalProjectId: t.external_project_id,
      }
      try {
        const got = await provider.upsert(task)
        await db.execute(`
          select app.task_pushed(
            ${lit(t.id)}::uuid, ${lit(name)}, ${lit(got.externalId)},
            ${String(t.revision)}, ${lit(got.externalProjectId)}, ${lit(got.externalRevision)})`)
        pushed += 1
      } catch (error) {
        if (error instanceof ProviderDownError) throw error
        /*
          One task's refusal is recorded against that task and the round goes
          on. A loop that gave up here would let one 400 — a title too long, a
          project the provider has lost — stop every other task from syncing,
          and the symptom would be "sync stopped working" rather than "this one
          task is wrong".
        */
        await db
          .execute(`
            select app.task_push_failed(${lit(t.id)}::uuid, ${lit(name)},
              ${lit(String((error as Error).message).slice(0, 400))})`)
          .catch(() => undefined)
        failed += 1
      }
    }

    // --- 3. what the provider has to say -------------------------------------
    for (const r of await provider.list()) {
      const fields: Record<string, unknown> = {
        title: r.title,
        detail: r.detail,
        done: r.done,
        due_on: r.dueOn,
        external_revision: r.externalRevision,
        external_project_id: r.externalProjectId,
      }
      /*
        A priority the provider did not set is LEFT OUT of the payload, not
        sent as null. `app.task_pulled` only touches a field the payload
        carries, so omitting it is how "nobody said" travels — sending null
        would read as "clear it" and demote a task Grant marked urgent here.
      */
      if (r.priority !== null) fields.priority = r.priority
      const said = asJson(
        (
          await db.execute(`
            select app.task_pulled(${lit(name)}, ${lit(r.externalId)},
              ${lit(JSON.stringify(fields))}::jsonb) as v`)
        ).rows[0]?.v,
      )
      if (said.deleted === true) {
        /*
          The provider is holding something Grant deleted here. Telling it
          again is the only way the two lists ever agree, and `remove` is
          idempotent, so a provider that already dropped it costs one 404.
        */
        await provider.remove(r.externalId)
        deleted += 1
        continue
      }
      if (said.ok === true) {
        pulled += 1
        if (said.created === true) created += 1
        if (said.conflict === true) conflicts += 1
      }
    }
  } catch (error) {
    if (error instanceof ProviderDownError) {
      return {
        provider: name,
        pushed,
        deleted,
        pulled,
        created,
        conflicts,
        failed,
        down: error.detail,
      }
    }
    throw error
  }

  return { provider: name, pushed, deleted, pulled, created, conflicts, failed, down: null }
}
