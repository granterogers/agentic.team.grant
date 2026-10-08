/**
 * Pulling Notion into `public.documents`.
 *
 * ADR-0013's connector, doing the one job a connector has: bring documents in,
 * and leave the corpus intact when it stops working. Nothing here writes to
 * `projects` beyond attaching documents to one — a Notion page does not create
 * a project, because under ADR-0013 the project is the source of truth and a
 * connector does not get to define what exists.
 *
 * ## Only what has been shared
 *
 * Notion's `search` returns exactly the pages and databases a human has shared
 * with the integration, and nothing else. That is the permission model doing
 * the right thing, and it means "0 shared objects" is a normal first state
 * rather than a fault — reported plainly, because an empty sync that says
 * nothing is indistinguishable from a broken one.
 *
 * ## Fingerprints, for the same reason the notebook sync has them
 *
 * A page whose text has not changed is not rewritten. Without that, every sync
 * rewrites every row and "changed" stops being a signal any downstream
 * consumer can use.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { officeOf, type RetrievalOffice } from '../knowledge/office.ts'
import type { NotionClient } from './api.ts'
import { NotionApiError } from './api.ts'
import { type NotionBlock, type RenderedBlock, renderBlocks, titleOf } from './content.ts'
import { isDatabaseLinkFailure } from './infra.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null): string => (v === null ? 'null' : lit(v))

/**
 * The office a project belongs to, as a subquery. Every statement below works on ONE project's documents, and the
 * project row the caller read is the document's owner (documents carry the office of the project they hang from,
 * enforced by a composite key), so a document is read, written and linked inside that office and no other.
 */
const officeOfProject = (projectId: string): string =>
  `(select p.office_id from public.projects p where p.project_id = ${lit(projectId)}::uuid)`

export const CONNECTOR = 'notion'

/** How deep to follow toggles, columns and nested lists. */
export const MAX_BLOCK_DEPTH = 4

export interface NotionObject {
  readonly id: string
  readonly object: 'page' | 'database'
  readonly title: string
  readonly lastEdited: string | null
  readonly url: string | null
}

export interface SyncOutcome {
  readonly shared: number
  readonly added: number
  readonly changed: number
  readonly unchanged: number
  readonly skipped: readonly string[]
  /** Pages the run ran out of time before reading. Nothing is lost: the next run starts with them. */
  readonly deferred: number
}

/**
 * How long a run may keep reading. The edge worker is killed at a wall-clock limit and only declines to START a job
 * past its own deadline, so a job that outlives the limit dies mid-run, its lease lapses, and recovery retries the same
 * crawl until the attempts are spent ("recovery: 5 attempts exhausted while in running"). A run that stops itself,
 * says what it left, and is continued by the next one cannot be killed that way.
 */
export interface RunBudget {
  readonly expired: () => boolean
}

/** Thrown from inside a page read when the budget runs out, so a single enormous page cannot hold the run past it. */
export class RunBudgetExceeded extends Error {
  constructor() {
    super('the run budget was spent')
    this.name = 'RunBudgetExceeded'
  }
}

export interface SyncOptions {
  /** The workspace listing, read once per run by a caller that syncs several projects. Read here when absent. */
  readonly shared?: readonly NotionObject[]
  readonly budget?: RunBudget
  /**
   * The most time ONE page may take. A page that needs more than a run can give it can never be read, and with
   * progress held only in the documents it would sit first in the queue for ever and starve every page behind it. It is
   * reported as too large for one pass and the run goes on to the next.
   */
  readonly pageBudgetMs?: number
  /** Milliseconds; a test passes its own. */
  readonly clock?: () => number
}

/** Notion failing this many pages in a row (timeouts, 429s, 5xx) means Notion is unwell: stop and try next time. */
export const MAX_CONSECUTIVE_TRANSIENT = 3

const guardOf = (budget: RunBudget | undefined) => (): void => {
  if (budget?.expired() === true) throw new RunBudgetExceeded()
}

export const fingerprintContent = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * The workspace listing under a budget. A listing the budget cut short is returned as far as it got and says so: the
 * pages it did reach are read as usual, and the report says the list was partial rather than presenting a prefix of the
 * workspace as all of it.
 */
export async function listSharedWithin(
  notion: NotionClient,
  budget: RunBudget,
): Promise<{ readonly objects: readonly NotionObject[]; readonly complete: boolean }> {
  const found: NotionObject[] = []
  try {
    await collectShared(notion, found, guardOf(budget))
  } catch (error) {
    if (error instanceof RunBudgetExceeded) return { objects: found, complete: false }
    throw error
  }
  return { objects: found, complete: true }
}

/** Everything the integration has been given access to. */
export async function listShared(notion: NotionClient): Promise<readonly NotionObject[]> {
  const found: NotionObject[] = []
  await collectShared(notion, found)
  return found
}

async function collectShared(
  notion: NotionClient,
  found: NotionObject[],
  beforeRequest?: () => void,
): Promise<void> {
  for await (const raw of notion.paginate('/search', {}, 'POST', beforeRequest)) {
    // From 2025-09-03 a queryable collection comes back as `data_source`
    // rather than `database`; a database is now the container that holds one
    // or more of them. Both are accepted so a workspace part-way through
    // Notion's own migration still reads.
    const object = raw.object === 'data_source' || raw.object === 'database' ? 'database' : 'page'
    found.push({
      id: String(raw.id),
      object,
      title: titleOf(raw),
      lastEdited: typeof raw.last_edited_time === 'string' ? raw.last_edited_time : null,
      url: typeof raw.url === 'string' ? raw.url : null,
    })
  }
}

/**
 * A block that is a document in its own right, not part of this one.
 *
 * A child page and a child database both appear as blocks on their parent AND
 * as separate objects in `/search`, so descending into them stores their text
 * twice: once inside the parent's document and once as their own. That was
 * visible as a search for a marker word returning two hits for one page, and
 * as a parent page whose fingerprint changed whenever any descendant did — so
 * it re-synced for ever, and "changed" stopped meaning anything.
 *
 * Not descended into, therefore. The child is synced on its own row, where a
 * citation can point at the right page.
 */
const IS_ITS_OWN_DOCUMENT = new Set(['child_page', 'child_database'])

/**
 * A page's whole block tree, depth-first, flattened with its depth.
 *
 * Depth-bounded rather than unbounded: Notion permits arbitrarily deep nesting
 * and a synced page is not worth an unbounded number of requests. The bound is
 * named so a truncated page is a known limit rather than a mystery.
 */
export async function fetchBlocks(
  notion: NotionClient,
  blockId: string,
  depth = 0,
  budget?: RunBudget,
): Promise<readonly RenderedBlock[]> {
  if (depth > MAX_BLOCK_DEPTH) return []
  const out: RenderedBlock[] = []
  // Before EVERY request, the cursor pages of a long flat page included: the budget used to be asked only before a
  // child fetch, so a page of a few thousand blocks and no nesting ran as long as Notion kept answering.
  for await (const raw of notion.paginate(
    `/blocks/${blockId}/children`,
    {},
    'GET',
    guardOf(budget),
  )) {
    const block = raw as NotionBlock
    out.push({ block, depth })
    if (
      block.has_children === true &&
      typeof block.id === 'string' &&
      !IS_ITS_OWN_DOCUMENT.has(String(block.type))
    ) {
      // Checked BEFORE the next request, never after a reply: a page whose reads all finished is kept, not thrown away.
      if (budget?.expired() === true) throw new RunBudgetExceeded()
      out.push(...(await fetchBlocks(notion, block.id, depth + 1, budget)))
    }
  }
  return out
}

/** The text of one page. A database contributes its title and its rows' titles. */
export async function pageText(
  notion: NotionClient,
  object: NotionObject,
  budget?: RunBudget,
): Promise<string> {
  if (object.object === 'database') {
    const rows: string[] = []
    // `/data_sources/:id/query`, not `/databases/:id/query`. The id search
    // returns at this version IS a data source id, and asking the databases
    // endpoint for it is a 404 — confirmed live before changing this.
    for await (const raw of notion.paginate(
      `/data_sources/${object.id}/query`,
      {},
      'POST',
      guardOf(budget),
    )) {
      const title = titleOf(raw)
      if (title !== '') rows.push(`- ${title}`)
    }
    return rows.length === 0 ? '' : `# ${object.title}\n\n${rows.join('\n')}`
  }
  return renderBlocks(await fetchBlocks(notion, object.id, 0, budget))
}

/**
 * The pages this office already holds whose stored edit time still equals the one Notion reports now, by Notion id.
 *
 * A page is not read again while Notion says it has not been edited since it was read: the previous run's fingerprint
 * already proves the text. Pages only. A database is never skipped, because adding a row does not move the database's
 * own edit time and its document is a list of its rows. A page with no stored edit time (one the office wrote itself) is
 * never in the set, so it is read and fingerprinted exactly as before.
 *
 * Scoped to the OFFICE and deliberately not to the project. A Notion page is ONE document per office (the unique key is
 * office, connector, parent, ref), filed under whichever project read it first, and every attached project is offered
 * the same shared pages. A page another project of this office already holds at the same edit time is therefore
 * already read for this office: reading it again could only find the same fingerprint and write nothing, which is what
 * the previous behaviour did after spending the requests. Scoping this by project would multiply the reads by the number
 * of attached projects for no change in the data.
 */
export async function unchangedSinceRead(
  db: SqlExecutor,
  projectId: string,
  shared: readonly NotionObject[],
): Promise<ReadonlySet<string>> {
  const held = await db.execute(`
    select external_ref, (extract(epoch from remote_updated_at) * 1000)::bigint as ms
      from public.documents
     where office_id = ${officeOfProject(projectId)}
       and connector = ${lit(CONNECTOR)}
       and external_parent_ref = 'page'
       and external_ref is not null
       and remote_updated_at is not null
       and content is not null
  `)
  const at = new Map<string, number>()
  for (const r of held.rows) at.set(String(r.external_ref), Number(r.ms))
  const same = new Set<string>()
  for (const o of shared) {
    if (o.object !== 'page' || o.lastEdited === null) continue
    const stored = at.get(o.id)
    const now = Date.parse(o.lastEdited)
    if (stored !== undefined && Number.isFinite(now) && stored === now) same.add(o.id)
  }
  return same
}

/** Upsert one Notion object as a document, reporting whether it changed. */
export async function upsertDocument(
  db: SqlExecutor,
  projectId: string,
  object: NotionObject,
  content: string,
): Promise<'added' | 'changed' | 'unchanged'> {
  const fingerprint = await fingerprintContent(content)

  const existing = await db.execute(`
    select content_fingerprint, title from public.documents
     where office_id = ${officeOfProject(projectId)}
       and connector = ${lit(CONNECTOR)}
       and external_parent_ref = ${lit(object.object)}
       and external_ref = ${lit(object.id)}
  `)
  const known = existing.rows.length > 0
  if (known && String(existing.rows[0]?.content_fingerprint) === fingerprint) {
    /*
      The text is the same. Two things can still have moved, and an early return that records neither loses both.

      THE TITLE. A page renamed in Notion has the same body, so the old return said "unchanged" and the document kept
      its old name for ever: a change that was never missed by the reader but never made either.

      THE EDIT TIME. `unchangedSinceRead` skips a page only while its stored edit time equals Notion's. A page edited
      without changing its text (a reorder, a comment, a block replaced by an identical one) kept the OLD stored time,
      so it never became skippable again and cost a full block-tree read on every run, for ever. Stored now, whether or
      not the text moved, and only when it differs.
    */
    const stored = String(existing.rows[0]?.title ?? '')
    const renamed = object.title !== '' && stored !== object.title
    if (renamed || (object.object === 'page' && object.lastEdited !== null)) {
      await db.execute(`
        update public.documents
           set ${renamed ? `title = ${lit(object.title)},` : ''}
               remote_updated_at = coalesce(${nul(object.lastEdited)}::timestamptz, remote_updated_at)
         where office_id = ${officeOfProject(projectId)}
           and connector = ${lit(CONNECTOR)}
           and external_parent_ref = ${lit(object.object)}
           and external_ref = ${lit(object.id)}
           and (${renamed ? 'true' : 'false'} or remote_updated_at is distinct from ${nul(object.lastEdited)}::timestamptz)
      `)
    }
    return renamed ? 'changed' : 'unchanged'
  }

  /*
    A page we wrote is not new material.

    `office.notion_import` (0166) put Grant's NotebookLM sources into Notion as
    Docs pages. This sync then read them back and inserted them as documents,
    so the Legacy Coaching Course reported 33 documents when it held 12 things.
    Neither job was wrong on its own; the pair had no way to know they were
    talking about the same document.

    `mirrors_document_id` (0169) is that link, and it is set HERE at write time
    rather than inferred afterwards from titles — a title Grant edits in Notion
    would silently stop matching and duplicate all over again. Content
    fingerprint is the evidence: Notion round-trips text with small differences
    (37,697 characters became 37,476), so the match is on the ORIGINAL we
    already hold for this project with the closest content, not on equality.
  */
  const written = await db.execute(`
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, doc_type,
       content, content_fingerprint, content_chars, fetched_at, remote_updated_at,
       mirrors_document_id, office_id)
    values (${lit(projectId)}::uuid, ${lit(CONNECTOR)}, ${lit(object.object)}, ${lit(object.id)},
            ${nul(object.title === '' ? null : object.title)}, ${lit(object.object)},
            ${lit(content)}, ${lit(fingerprint)}, ${String(content.length)},
            app.now_utc(), ${nul(object.lastEdited)}::timestamptz,
            (select d.document_id from public.documents d
              where d.project_id = ${lit(projectId)}::uuid
                and d.office_id = ${officeOfProject(projectId)}
                and d.connector <> ${lit(CONNECTOR)}
                and d.mirrors_document_id is null
                and app.normalise_name(d.title) = app.normalise_name(${nul(object.title === '' ? null : object.title)})
              limit 1),
            ${officeOfProject(projectId)})
    -- The index is partial (0051), so the conflict target repeats its predicate.
    on conflict (office_id, connector, external_parent_ref, external_ref)
      where external_ref is not null
      do update
      set title = excluded.title,
          content = excluded.content,
          content_fingerprint = excluded.content_fingerprint,
          content_chars = excluded.content_chars,
          fetched_at = excluded.fetched_at,
          remote_updated_at = excluded.remote_updated_at,
          project_id = excluded.project_id,
          -- Keep a link once made. A page that stopped resolving to an original
          -- — because its title changed in Notion — must not silently become
          -- new material on the next sync.
          mirrors_document_id = coalesce(public.documents.mirrors_document_id,
                                         excluded.mirrors_document_id)
      -- The key is per office since 0862 (office, connector, parent, ref), so another office's row is not even a
      -- conflict; the guard stays as the second line, and one row exists per page per office.
      where public.documents.office_id = excluded.office_id
    returning document_id
  `)
  // The conflict guard wrote nothing: this page id is already filed by another office. Said plainly, and in words that
  // name no office, so the pass lists the page as skipped instead of reporting a write that did not happen.
  if (written.rows.length === 0)
    throw new Error('could not be filed: the page id is already in use')
  return known ? 'changed' : 'added'
}

/**
 * The Notion objects that ARE this project's attachments (#19).
 *
 * `/search` returns the Projects, Tasks and Docs databases alongside the pages
 * in them, and `pageText` renders a database as a bulleted list of its rows'
 * titles. Storing that put an index of the container into the corpus: it
 * matched a search for any row title and landed the reader on a list, and its
 * fingerprint tracked every rename in the database so it re-synced for ever.
 *
 * The container is the attachment. What is inside it is the documents.
 */
export async function containerRefs(
  db: SqlExecutor,
  office: RetrievalOffice,
  projectId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db.execute(`
    select external_ref from app.container_refs(${officeOf(office)}, ${lit(projectId)}::uuid, ${lit(CONNECTOR)})
  `)
  return new Set(rows.rows.map((r) => String(r.external_ref)))
}

/**
 * Record a page the office wrote, as the office's own work (#20).
 *
 * `office.notion_import` authors module pages into the Projects database. The
 * sync then reads them back, and without this they arrive looking exactly like
 * something Grant supplied — six pages of the office's own output counted as
 * source material.
 *
 * Written HERE, in the pass that creates the page, for the reason 0169 gives
 * about `mirrors_document_id`: anything inferred afterwards from the title
 * stops matching the moment Grant renames it in Notion, and the row silently
 * becomes source material again.
 *
 * `origin` survives the sync because `upsertDocument`'s `do update` never
 * touches it — the sync owns the content, the writer owns the provenance.
 */
export async function registerAuthored(
  db: SqlExecutor,
  projectId: string,
  page: { readonly id: string; readonly title: string },
  body: string,
  producedBy: string,
): Promise<void> {
  const fingerprint = await fingerprintContent(body)
  const filed = await db.execute(`
    insert into public.documents
      (project_id, connector, external_parent_ref, external_ref, title, doc_type,
       content, content_fingerprint, content_chars, fetched_at, origin, produced_by, office_id)
    values (${lit(projectId)}::uuid, ${lit(CONNECTOR)}, 'page', ${lit(page.id)},
            ${nul(page.title === '' ? null : page.title)}, 'page',
            ${lit(body)}, ${lit(fingerprint)}, ${String(body.length)},
            app.now_utc(), 'made', ${lit(producedBy)}, ${officeOfProject(projectId)})
    on conflict (office_id, connector, external_parent_ref, external_ref)
      where external_ref is not null
      do update set origin = 'made',
                    produced_by = coalesce(public.documents.produced_by, excluded.produced_by)
      where public.documents.office_id = excluded.office_id
    returning document_id
  `)
  if (filed.rows.length === 0)
    throw new Error('could not be recorded: the page id is already in use')
}

/**
 * One full pass.
 *
 * A page that cannot be read is recorded in `skipped` and the pass continues.
 * The alternative — throwing — lets one un-shared child page stop the other
 * forty from syncing, which is the failure mode §7 rules out for the notebook
 * and which is no more acceptable here.
 */
export async function syncNotion(
  db: SqlExecutor,
  office: RetrievalOffice,
  notion: NotionClient,
  projectId: string,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const shared = options.shared ?? (await listShared(notion))
  const budget = options.budget
  const containers = await containerRefs(db, office, projectId)
  const fresh = await unchangedSinceRead(db, projectId, shared)
  let added = 0
  let changed = 0
  let unchanged = 0
  let deferred = 0
  let transientInARow = 0
  const clock = options.clock ?? Date.now
  const skipped: string[] = []

  /*
    Pages never read come first, then the rest, so a run that is cut short has spent its time on the work nobody has
    seen. The order within each group is Notion's own, which is stable, so a continuation resumes rather than restarts.
  */
  const held = new Set<string>()
  const heldRows = await db.execute(`
    select external_ref from public.documents
     where office_id = ${officeOfProject(projectId)} and connector = ${lit(CONNECTOR)} and external_ref is not null
  `)
  for (const r of heldRows.rows) held.add(String(r.external_ref))
  const ordered = [
    ...shared.filter((o) => !held.has(o.id)),
    ...shared.filter((o) => held.has(o.id)),
  ]

  for (const object of ordered) {
    // #19. The attachment itself, not a document in it.
    if (containers.has(object.id)) {
      skipped.push(`${object.title === '' ? object.id : object.title}: container`)
      continue
    }
    // Not edited since it was read: the stored fingerprint already proves the text, so no request is spent on it.
    if (fresh.has(object.id)) {
      unchanged += 1
      continue
    }
    if (budget?.expired() === true || transientInARow >= MAX_CONSECUTIVE_TRANSIENT) {
      deferred += 1
      continue
    }
    const startedPage = clock()
    const pageCap = options.pageBudgetMs
    const pageBudget: RunBudget | undefined =
      pageCap === undefined
        ? budget
        : { expired: () => budget?.expired() === true || clock() - startedPage >= pageCap }
    try {
      const content = await pageText(notion, object, pageBudget)
      if (content.trim() === '') {
        // An empty page is not a document. Storing one would put a row in the
        // corpus that can never match a search and always counts as synced.
        skipped.push(`${object.title === '' ? object.id : object.title}: empty`)
        continue
      }
      const outcome = await upsertDocument(db, projectId, object, content)
      transientInARow = 0
      if (outcome === 'added') added += 1
      else if (outcome === 'changed') changed += 1
      else unchanged += 1
    } catch (error) {
      const label = object.title === '' ? object.id : object.title
      // Ran out of time inside this page: it is deferred, not skipped, so it is read again and the report says why.
      if (error instanceof RunBudgetExceeded) {
        if (budget?.expired() === true) deferred += 1
        // The RUN had time and this one page used up its own share: it can never fit, so say so rather than queueing
        // it first for ever. The rest of the pass carries on.
        else skipped.push(`${label}: too large to read in one pass`)
        continue
      }
      if (error instanceof NotionApiError) {
        // The token stopped working part-way: that is the whole sync's problem, not this page's, and the handler
        // reports it once as such.
        if (error.kind === 'auth') throw error
        // Notion timing out, rate limiting or failing is not a property of the page. It is read again next time, and
        // a run of such failures means Notion is unwell, so the rest wait too instead of spending the budget on it.
        if (error.kind === 'transient') {
          deferred += 1
          transientInARow += 1
          continue
        }
        skipped.push(`${label}: ${error.code}`)
        continue
      }
      // The database link, not the page. Every remaining page would fail the same way, and recording each as
      // "left out: <driver text>" tells Grant about pages that are fine. The run ends and the job says what it was.
      if (isDatabaseLinkFailure(error)) throw error
      skipped.push(`${label}: ${(error as Error).message.slice(0, 60)}`)
    }
  }

  return { shared: shared.length, added, changed, unchanged, skipped, deferred }
}
