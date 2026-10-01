/**
 * Notebook discovery and source sync.
 *
 * Phase 4's acceptance sentence:
 *
 *   "a new notebook is discovered and becomes a project unattended; 50 sources
 *    added rapidly are processed without duplication; a worker crash mid-sync
 *    resumes cleanly; Notebook outage degrades rather than fails."
 *
 * Three of those four are settled in `migrations/0016_project_sync.sql` rather
 * than here, because they are properties of the schema: de-duplication is a
 * unique index, resumability needs a sync to be a row with a lease rather than
 * a function call, and degradation is structural — nothing in this file is
 * reachable from `jobs`, `events` or `system_config`.
 *
 * What is left for code is the discovery itself, and one judgement that the
 * schema cannot make: **what to do about a source that has disappeared.**
 * See `countRemoved` below.
 *
 * ## Reading, not writing
 *
 * This module only ever *reads* from Notebook. Every write goes through
 * `notebook_sync_queue` (0015), which is what makes §7's "never blindly retry
 * an ambiguous write" enforceable — a module that wrote directly could not be
 * held to it.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { stripBoilerplate } from '../knowledge/boilerplate.ts'
import type { Capability, NotebookAdapter, SourceText } from '../notebook/adapter.ts'
import { NotebookUnavailableError } from '../notebook/adapter.ts'
import type { OfficeId } from '../office/context.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null | undefined): string =>
  v === null || v === undefined ? 'null' : lit(v)

/** A notebook as discovery sees it. Deliberately minimal. */
export interface RemoteNotebook {
  readonly id: string
  readonly title: string
}

export interface SyncOutcome {
  readonly runId: string
  readonly state: 'complete' | 'failed'
  readonly notebooksSeen: number
  readonly projectsCreated: number
  readonly sourcesSeen: number
  readonly sourcesAdded: number
  readonly sourcesChanged: number
  readonly sourcesRemoved: number
  readonly sourcesArchived: number
  readonly sourcesRestored: number
  readonly reconcileRefusals: readonly string[]
  readonly detail: string
}

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('a sync run is already in flight')
    this.name = 'SyncAlreadyRunningError'
  }
}

/**
 * Turn a notebook title into a project slug.
 *
 * Deterministic, because a project's slug is its stable handle and a rename
 * upstream must not create a second project. Collisions are resolved by the
 * caller against the database, not by adding randomness here — a random suffix
 * would make the function untestable and the slug meaningless.
 */
export const slugify = (title: string): string => {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    // Strip combining marks so "Café" and "Cafe" produce the same slug rather
    // than one that fails the projects_slug_format CHECK.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // The CHECK constraint is `^[a-z0-9]+(-[a-z0-9]+)*$`, which an empty string
  // fails. A title of only punctuation is unusual but not invalid upstream.
  return base === '' ? 'untitled' : base.slice(0, 60).replace(/-+$/, '')
}

/**
 * Claim a sync run.
 *
 * The insert is the lock. `sync_runs_one_at_a_time` is a partial unique index
 * on a constant, so a second concurrent claim collides at the database rather
 * than being decided by a race — and unlike an advisory lock it survives the
 * worker dying, which is precisely when an in-flight run must stay visible.
 */
export const claimRun = async (
  db: SqlExecutor,
  workerId: string,
  /** The office this cycle runs for. The run is recorded under it and settled only by it. */
  office: OfficeId,
  leaseMinutes = 15,
): Promise<string> => {
  // Recover first. A previous crash holds the unique index until its lease is
  // reaped, so a worker that did not sweep would be permanently locked out by
  // a machine that died last week.
  await db.execute('select app.recover_stalled_syncs()')

  const { rows } = await db.execute(`
    insert into public.sync_runs (leased_by, leased_until, office_id)
    values (${lit(workerId)}, app.now_utc() + make_interval(mins => ${String(leaseMinutes)}),
            ${lit(office)}::uuid)
    on conflict do nothing
    returning run_id::text as run_id
  `)
  const runId = rows[0]?.run_id
  if (typeof runId !== 'string') throw new SyncAlreadyRunningError()
  return runId
}

interface Counters {
  notebooksSeen: number
  projectsCreated: number
  sourcesSeen: number
  sourcesAdded: number
  sourcesChanged: number
  sourcesRemoved: number
  sourcesArchived: number
  sourcesRestored: number
  /** Notebooks whose reconciliation refused, with the reason. */
  reconcileRefusals: string[]
}

/**
 * A display name for a notebook that has none.
 *
 * NotebookLM permits an untitled notebook, and the first live sync found one:
 * `projects_name_present` refused the empty string and the cycle degraded
 * mid-way. The fallback names it after its id rather than inventing something
 * plausible - "Untitled notebook (45eb6a5c)" is obviously a placeholder and
 * traceable to the thing it stands for, where "New Project" would be neither.
 */
export const displayName = (notebook: RemoteNotebook): string => {
  const title = notebook.title.trim()
  return title === '' ? `Untitled notebook (${notebook.id.slice(0, 8)})` : title
}

/**
 * Ensure a project exists for a notebook, and return its id.
 *
 * Idempotent at the index (`projects_one_per_notebook`), not by a prior SELECT.
 * Two workers discovering the same new notebook simultaneously would both find
 * nothing and both insert; the index decides, and the loser reads back.
 */
export const ensureProject = async (
  db: SqlExecutor,
  office: OfficeId,
  notebook: RemoteNotebook,
): Promise<{ projectId: string; created: boolean }> => {
  const existing = await db.execute(`
    select project_id::text as project_id from public.projects
    where office_id = ${lit(office)}::uuid and notebook_ref = ${lit(notebook.id)}
  `)
  const found = existing.rows[0]?.project_id
  if (typeof found === 'string') return { projectId: found, created: false }

  const name = displayName(notebook)
  // Slug collisions are resolved here rather than by randomising the slug: two
  // notebooks legitimately called "Research" should produce `research` and
  // `research-2`, which stay meaningful, rather than two opaque handles.
  //
  // Slugged from the *display* name, so an untitled notebook gets
  // `untitled-notebook-45eb6a5c` rather than every untitled notebook fighting
  // over `untitled`.
  const base = slugify(name)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${String(attempt + 1)}`
    // The project AND its attachment, in one statement.
    //
    // 0067 requires an active project to be attached to something real, checked
    // by a deferred constraint trigger — so a project inserted alone fails at
    // commit, which is exactly what happened the first time this ran after that
    // migration: the sync reported "created 0 projects" and every downstream
    // check in `verify:sync` went red at once.
    //
    // The right fix is not to exempt the sync. A project discovered by syncing
    // a notebook IS attached to that notebook; it simply was not saying so.
    // Writing both here makes the constraint true rather than tolerated, and a
    // CTE keeps them one transaction without the caller having to remember.
    const inserted = await db.execute(`
      with created as (
        insert into public.projects (slug, name, notebook_ref, status, office_id)
        values (${lit(slug)}, ${lit(name)}, ${lit(notebook.id)}, 'active', ${lit(office)}::uuid)
        on conflict do nothing
        returning project_id
      ),
      attached as (
        insert into public.project_attachments
          (project_id, connector, external_ref, display_name, role)
        select project_id, 'notebooklm', ${lit(notebook.id)}, ${lit(name)}, 'source'
          from created
        on conflict do nothing
        returning project_id
      )
      select project_id::text as project_id from created
    `)
    const id = inserted.rows[0]?.project_id
    if (typeof id === 'string') return { projectId: id, created: true }

    // The insert was refused. Either the slug is taken by another notebook (try
    // the next suffix) or another worker just claimed this notebook (read it
    // back and agree with them).
    const raced = await db.execute(`
      select project_id::text as project_id from public.projects
      where office_id = ${lit(office)}::uuid and notebook_ref = ${lit(notebook.id)}
    `)
    const other = raced.rows[0]?.project_id
    if (typeof other === 'string') return { projectId: other, created: false }
  }
  throw new Error(`could not find a free slug for ${notebook.title}`)
}

/** SHA-256 of a source's text, as `documents.content_fingerprint`. */
export const fingerprintContent = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Upsert one source and report whether its content actually changed.
 *
 * The fingerprint comparison is what makes the 10-minute cycle affordable:
 * without it every sync would rewrite every row and every downstream consumer
 * would see everything as new. §7's caching design depends on "changed" being
 * a real signal rather than "was seen again".
 */
export const upsertSource = async (
  db: SqlExecutor,
  office: OfficeId,
  projectId: string,
  source: SourceText,
): Promise<'added' | 'changed' | 'unchanged'> => {
  // The furniture comes off before anything else, so the fingerprint is taken
  // over what we will actually store. Fingerprinting the raw text and storing
  // the cleaned one would make every re-clean look like a change, and every
  // change re-brief.
  //
  // Grant's Wikipedia article was 69,000 characters of which the first four
  // thousand were the navigation menu — all of it indexed, all of it citable,
  // and it had already been read back to him as an answer.
  const cleaned = stripBoilerplate(source.content)
  const content = cleaned.text
  const fingerprint = await fingerprintContent(content)

  const existing = await db.execute(`
    select content_fingerprint from public.documents
    where office_id = ${lit(office)}::uuid
      and connector = 'notebooklm'
      and external_parent_ref = ${lit(source.remoteNotebookId)}
      and external_ref = ${lit(source.remoteSourceId)}
  `)
  const previous = existing.rows[0]?.content_fingerprint
  const known = existing.rows.length > 0

  if (known && String(previous) === fingerprint) {
    // Nothing to write. Deliberately not even a touched-at bump: a write per
    // source per ten minutes is 144 writes/day/source that say nothing.
    return 'unchanged'
  }

  const written = await db.execute(`
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, content,
       content_fingerprint, content_chars, fetched_at, remote_updated_at, office_id)
    values
      (${lit(projectId)}::uuid, 'notebooklm', ${lit(source.remoteNotebookId)},
       ${lit(source.remoteSourceId)}, ${nul(source.title)}, ${lit(content)},
       ${lit(fingerprint)}, ${String(content.length)}, app.now_utc(),
       ${nul(source.remoteUpdatedAt)}::timestamptz, ${lit(office)}::uuid)
    -- The index this infers against is PARTIAL (0051: an upload has no external
    -- reference, so uniqueness is not asserted over a null). A conflict target
    -- without the same predicate matches no index and the insert fails — which
    -- is how the sync silently stored zero rows for one run.
    on conflict (connector, external_parent_ref, external_ref)
      where external_ref is not null
      do update
      set title = excluded.title,
          content = excluded.content,
          content_fingerprint = excluded.content_fingerprint,
          content_chars = excluded.content_chars,
          fetched_at = excluded.fetched_at,
          remote_updated_at = excluded.remote_updated_at,
          project_id = excluded.project_id
      -- The key is still global (connector, parent, ref): a source another office holds is never overwritten or moved.
      where public.documents.office_id = excluded.office_id
    returning document_id
  `)
  // Nothing written means another office already holds this source id. That is not this office's to overwrite and not
  // its to learn about: the cycle carries on and counts it as unchanged.
  if (written.rows.length === 0) return 'unchanged'
  return known ? 'changed' : 'added'
}

/**
 * What to do about a source that is no longer in the notebook.
 *
 * This is the one judgement the schema cannot make, and it is resolved
 * **conservatively: the cached row is kept.** Three reasons, in order of how
 * much they cost to get wrong:
 *
 *   1. A source missing from one listing is not proof of deletion. §7 says to
 *      assume undocumented behaviour, and a partial listing during an incident
 *      would otherwise delete the entire knowledge cache.
 *   2. Something may cite it. A brief records `source_fingerprints`, and
 *      deleting the text those refer to makes past briefs unauditable.
 *   3. Deleting is not reversible and keeping is. The cost of keeping a stale
 *      row is a stale row.
 *
 * It then said a real deletion policy needs Grant's decision. **He made it on
 * 2026-09-17 — ADR-0040: archive and hide, keep provenance, make restoration
 * possible** — so this now reconciles instead of only counting, and the three
 * reasons above are answered rather than overruled:
 *
 *   - (2) and (3) fall away, because an archived document keeps its row, its
 *     content, its fingerprint and every relation, and 0464 removes it from
 *     ordinary retrieval rather than from existence. `hq_document_restore` and
 *     `app.unarchive_document` bring it back as an ordinary action.
 *   - (1) is answered by `app.reconcile_vanished`, not by optimism: a source
 *     absent from ONE listing is marked and never hidden, a source absent from
 *     two consecutive listings is archived, a source that reappears is
 *     un-marked AND un-archived, and a pass that would archive more than half
 *     of what a notebook holds refuses outright — because "everything vanished
 *     between two hourly passes" is an auth failure far more often than it is
 *     Grant deleting forty files.
 *
 * The refusal is reported rather than swallowed. A sync that quietly declines
 * to reconcile is the same class of defect as one that quietly empties the
 * cache, and only one of them is visible.
 */
export interface Reconciled {
  /** Absent for the first time: marked, not hidden. */
  readonly marked: number
  /** Absent again, so now out of ordinary retrieval. */
  readonly archived: number
  /** Seen again, and brought back out of the archive. */
  readonly restored: number
  /** The pass declined to act, and why. Null when it acted. */
  readonly refused: string | null
}

export const reconcileVanished = async (
  db: SqlExecutor,
  /** The office whose cache is reconciled: a source of any other office under the same notebook is never touched. */
  office: OfficeId,
  remoteNotebookId: string,
  seenSourceIds: readonly string[],
): Promise<Reconciled> => {
  const list =
    seenSourceIds.length === 0
      ? `'{}'::text[]`
      : `array[${seenSourceIds.map((s) => lit(s)).join(', ')}]::text[]`
  const { rows } = await db.execute(`
    select app.reconcile_vanished(${lit(office)}::uuid, 'notebooklm', ${lit(remoteNotebookId)}, ${list}) as r
  `)
  const raw = rows[0]?.r
  const r = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as Record<string, unknown>
  return {
    marked: typeof r.marked === 'number' ? r.marked : 0,
    archived: typeof r.archived === 'number' ? r.archived : 0,
    restored: typeof r.restored === 'number' ? r.restored : 0,
    refused: r.ok === false ? String(r.error ?? 'the pass declined to act') : null,
  }
}

/** Derive and store budgets from a capability probe (§11, Phase 4). */
export const deriveBudget = async (
  db: SqlExecutor,
  office: OfficeId,
  capability: Capability,
): Promise<{ stored: boolean; detail: string }> => {
  if (
    capability.detectedTier === null ||
    capability.notebookLimit === null ||
    capability.sourceLimit === null
  ) {
    // No measured tier means no budget. §11 forbids the alternative, and the
    // alternative is the only other option.
    return { stored: false, detail: 'no tier was detected, so no budget was derived' }
  }

  const probe = await db.execute(`
    select probe_id::text as probe_id from public.notebook_capability_probes
     where office_id = ${lit(office)}::uuid
     order by probed_at desc limit 1
  `)
  const probeId = probe.rows[0]?.probe_id
  if (typeof probeId !== 'string') {
    return { stored: false, detail: 'the current probe has no id to attribute the budget to' }
  }

  // §7's measured plan: ~5-15 chats/day against a 50/day allowance. The
  // allowance is not in AccountLimits — Google does not report it — so the
  // budget is derived from the source limit, which IS reported, and kept well
  // under the documented figure. Deliberately conservative: exceeding a quota
  // costs a day of knowledge work, and under-using one costs nothing.
  const dailyChatBudget = Math.max(10, Math.min(30, capability.sourceLimit))
  // A fifth held back for urgent work. See app.notebook_chat_allowed.
  const chatReserve = Math.max(2, Math.floor(dailyChatBudget / 5))

  await db.execute(`
    insert into public.notebook_budgets
      (probe_id, detected_tier, notebook_limit, source_limit,
       daily_chat_budget, chat_reserve)
    select pr.probe_id, ${String(capability.detectedTier)},
       ${String(capability.notebookLimit)}, ${String(capability.sourceLimit)},
       ${String(dailyChatBudget)}, ${String(chatReserve)}
      from public.notebook_capability_probes pr
     where pr.probe_id = ${lit(probeId)}::uuid and pr.office_id = ${lit(office)}::uuid
  `)
  return {
    stored: true,
    detail:
      `tier ${String(capability.detectedTier)}: ` +
      `${String(dailyChatBudget)} chats/day with ${String(chatReserve)} reserved for urgent work`,
  }
}

export interface SyncDeps {
  readonly db: SqlExecutor
  readonly adapter: NotebookAdapter
  /** Injected so discovery is testable without a live account. */
  readonly listNotebooks: () => Promise<readonly RemoteNotebook[]>
  readonly workerId: string
  /**
   * The office this cycle discovers for: the claimed job's. Notebooks become projects of THIS office, sources are
   * cached into it, the run is recorded under it, and its budget is derived from its own probe.
   */
  readonly officeId: OfficeId
}

/**
 * One discovery and sync cycle.
 *
 * Returns rather than throws on a Notebook outage: Phase 4 requires an outage
 * to *degrade*, and a thrown error from the scheduler's point of view is
 * indistinguishable from the worker being broken. The run is recorded as
 * `failed` with the reason, which is a degraded cycle rather than a dead one.
 */
export const runSync = async (deps: SyncDeps): Promise<SyncOutcome> => {
  const { db, adapter, listNotebooks, workerId, officeId: office } = deps

  const leaseRow = await db.execute(
    `select value::text as v from public.system_config where key = 'notebook.sync_lease_minutes'`,
  )
  const leaseMinutes = Number(leaseRow.rows[0]?.v ?? '15')
  const runId = await claimRun(
    db,
    workerId,
    office,
    Number.isFinite(leaseMinutes) ? leaseMinutes : 15,
  )

  const counters: Counters = {
    notebooksSeen: 0,
    projectsCreated: 0,
    sourcesSeen: 0,
    sourcesAdded: 0,
    sourcesChanged: 0,
    sourcesRemoved: 0,
    sourcesArchived: 0,
    sourcesRestored: 0,
    reconcileRefusals: [],
  }

  const settle = async (state: 'complete' | 'failed', detail: string): Promise<SyncOutcome> => {
    await db.execute(`
      update public.sync_runs
      set state = ${lit(state)}::public.sync_run_state,
          finished_at = app.now_utc(),
          leased_by = null, leased_until = null,
          notebooks_seen = ${String(counters.notebooksSeen)},
          projects_created = ${String(counters.projectsCreated)},
          sources_seen = ${String(counters.sourcesSeen)},
          sources_added = ${String(counters.sourcesAdded)},
          sources_changed = ${String(counters.sourcesChanged)},
          sources_removed = ${String(counters.sourcesRemoved)},
          detail = ${lit(detail.slice(0, 1000))}
      where run_id = ${lit(runId)}::uuid and office_id = ${lit(office)}::uuid
    `)
    return { runId, state, ...counters, detail }
  }

  try {
    // Budgets first: a cycle that spends before knowing its allowance is the
    // hard-coded-quota failure wearing a different hat.
    const capability = await adapter.probe()
    const budget = await deriveBudget(db, office, capability)

    const excluded = new Set(
      (
        await db.execute(
          `select remote_notebook_id from public.notebook_exclusions where office_id = ${lit(office)}::uuid`,
        )
      ).rows.map((r) => String(r.remote_notebook_id)),
    )

    const notebooks = (await listNotebooks()).filter((n) => !excluded.has(n.id))
    counters.notebooksSeen = notebooks.length

    for (const notebook of notebooks) {
      const { projectId, created } = await ensureProject(db, office, notebook)
      if (created) counters.projectsCreated += 1

      const sources = await adapter.listSources(notebook.id)
      counters.sourcesSeen += sources.length

      for (const source of sources) {
        const result = await upsertSource(db, office, projectId, source)
        if (result === 'added') counters.sourcesAdded += 1
        if (result === 'changed') counters.sourcesChanged += 1
      }

      // A reconcile marks and archives documents, so it runs inside the one office that holds them: the cycle's own,
      // which is also the office ensureProject found or created the project in - never one named by the remote notebook.
      const reconciled = await reconcileVanished(
        db,
        office,
        notebook.id,
        sources.map((s) => s.remoteSourceId),
      )
      counters.sourcesRemoved += reconciled.marked + reconciled.archived
      counters.sourcesArchived += reconciled.archived
      counters.sourcesRestored += reconciled.restored
      if (reconciled.refused !== null) counters.reconcileRefusals.push(reconciled.refused)
    }

    return settle(
      'complete',
      `${budget.detail}; ${String(counters.notebooksSeen)} notebook(s)` +
        (excluded.size > 0 ? `, ${String(excluded.size)} excluded` : ''),
    )
  } catch (error) {
    // An outage is a degraded cycle, not a broken worker. Recorded and
    // returned so the scheduler exits zero and the next tick tries again.
    const unavailable = error instanceof NotebookUnavailableError
    return settle(
      'failed',
      unavailable
        ? `Notebook unavailable: ${error.message.slice(0, 300)}`
        : `${(error as Error).name}: ${(error as Error).message.slice(0, 300)}`,
    )
  }
}
