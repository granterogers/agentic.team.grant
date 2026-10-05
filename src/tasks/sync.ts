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
import {
  type CanonicalTask,
  ProviderAuthError,
  ProviderDownError,
  type TaskProvider,
} from './provider.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const asJson = (v: unknown): Record<string, unknown> =>
  (typeof v === 'string' ? JSON.parse(v) : (v ?? {})) as Record<string, unknown>

/**
 * What the round may do outside the office, asked per effect (final policy closure).
 *
 * `write` is create-or-update at the provider: it is decided once per round, because what authorises it is the
 * connection of one board (a standing yes for that destination), not anything about one task. `delete` is decided per
 * task and always as an exact approval - a standing yes for writing never reaches it, because it is a different tool
 * at a level that cannot hold one. A refusal here is not an error: the task stays as it is on both sides and the round
 * goes on.
 */
export interface SyncGate {
  mayWrite(verb: 'create' | 'update'): Promise<boolean>
  /** What is deleted is the REMOTE task, so that is what an approval is about: its external id. */
  mayDelete(what: { readonly title: string; readonly externalId: string }): Promise<boolean>
}

/**
 * A gate that allows everything. For a suite that tests the ENGINE against a real provider (`verify:vikunja`), where the
 * question under test is whether two lists converge, not whether anyone permitted it. A handler never uses it: the
 * duty builds its own gate from the authorization policy, and a test pins that.
 */
export const permitEverything: SyncGate = {
  mayWrite: async () => true,
  mayDelete: async () => true,
}

export interface SyncReport {
  readonly provider: string
  readonly pushed: number
  readonly deleted: number
  readonly pulled: number
  readonly created: number
  readonly conflicts: number
  readonly failed: number
  /** Effects the gate did not allow this round: they wait, on both sides, untouched. */
  readonly held: number
  /** Set when the provider could not be reached. Nothing else ran. */
  readonly down: string | null
  /** Why it is down: `refused` is a credential the provider answered and turned away; `unreachable` is everything else. */
  readonly downKind?: 'unreachable' | 'refused' | null
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
  gate: SyncGate,
  opts: { readonly office: string; readonly limit?: number },
): Promise<SyncReport> {
  const name = provider.name
  let pushed = 0
  let deleted = 0
  let pulled = 0
  let created = 0
  let conflicts = 0
  let failed = 0
  let held = 0

  try {
    const work = asJson(
      (
        await db.execute(
          `select app.tasks_to_push(${lit(opts.office)}::uuid, ${lit(name)}, ${String(opts.limit ?? 200)}) as v`,
        )
      ).rows[0]?.v,
    )
    const upserts = (work.upserts ?? []) as Pushable[]
    const deletes = (work.deletes ?? []) as Deletable[]

    // --- 1. deletions, before anything can recreate them ---------------------
    for (const d of deletes) {
      const link = (d.links ?? []).find((l) => l.provider === name)
      const ext = String(link?.external_id ?? '')
      if (ext === '') {
        /*
          Nothing was ever made at the provider (the database does not offer a placeholder as an id), so there is
          nothing to remove and nothing to ask about: the debt is simply cleared. Leaving it open meant it was listed
          again on every round for ever.
        */
        await db.execute(
          `select app.task_delete_pushed(${lit(opts.office)}::uuid, ${lit(d.id)}::uuid, ${lit(name)})`,
        )
        continue
      }
      if (!(await gate.mayDelete({ title: d.title, externalId: ext }))) {
        held += 1
        continue
      }
      try {
        await provider.remove(ext)
      } catch (error) {
        if (error instanceof ProviderDownError) throw error
        // One refused delete must not stop the other forty tasks syncing. The tombstone stays, so it is offered again.
        failed += 1
        continue
      }
      await db.execute(
        `select app.task_delete_pushed(${lit(opts.office)}::uuid, ${lit(d.id)}::uuid, ${lit(name)})`,
      )
      deleted += 1
    }

    // --- 2. everything the office has moved ----------------------------------
    for (const t of upserts) {
      if (
        !(await gate.mayWrite(t.external_id === null || t.external_id === '' ? 'create' : 'update'))
      ) {
        held += 1
        continue
      }
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
            ${lit(opts.office)}::uuid, ${lit(t.id)}::uuid, ${lit(name)}, ${lit(got.externalId)},
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
            select app.task_push_failed(${lit(opts.office)}::uuid, ${lit(t.id)}::uuid, ${lit(name)},
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
      // The office's own mark, when the provider's copy carries one: how a lost create is told from a stranger's task.
      if (r.canonicalId !== null && r.canonicalId !== undefined) fields.canonical_id = r.canonicalId
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
            select app.task_pulled(${lit(opts.office)}::uuid, ${lit(name)}, ${lit(r.externalId)},
              ${lit(JSON.stringify(fields))}::jsonb) as v`)
        ).rows[0]?.v,
      )
      if (said.deleted === true) {
        /*
          The provider is holding something Grant deleted here. Telling it
          again is the only way the two lists ever agree, and `remove` is
          idempotent, so a provider that already dropped it costs one 404.
        */
        if (!(await gate.mayDelete({ title: r.title, externalId: r.externalId }))) {
          held += 1
          continue
        }
        try {
          await provider.remove(r.externalId)
        } catch (error) {
          if (error instanceof ProviderDownError) throw error
          failed += 1
          continue
        }
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
        held,
        down: error.detail,
        downKind: error instanceof ProviderAuthError ? 'refused' : 'unreachable',
      }
    }
    throw error
  }

  return {
    provider: name,
    pushed,
    deleted,
    pulled,
    created,
    conflicts,
    failed,
    held,
    down: null,
    downKind: null,
  }
}
