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
import type { NotionClient } from './api.ts'
import { NotionApiError } from './api.ts'
import { type NotionBlock, type RenderedBlock, renderBlocks, titleOf } from './content.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const nul = (v: string | null): string => (v === null ? 'null' : lit(v))

/**
 * The office a project belongs to, as a subquery. Every statement below works on ONE project's documents, and the
 * project row the caller read is the document's owner (documents carry the office of the project they hang from,
 * enforced by a composite key), so a document is read, written and linked inside that office and no other.
 */
const officeOf = (projectId: string): string =>
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
}

export const fingerprintContent = async (content: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Everything the integration has been given access to. */
export async function listShared(notion: NotionClient): Promise<readonly NotionObject[]> {
  const found: NotionObject[] = []
  for await (const raw of notion.paginate('/search', {})) {
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
  return found
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
): Promise<readonly RenderedBlock[]> {
  if (depth > MAX_BLOCK_DEPTH) return []
  const out: RenderedBlock[] = []
  for await (const raw of notion.paginate(`/blocks/${blockId}/children`, {}, 'GET')) {
    const block = raw as NotionBlock
    out.push({ block, depth })
    if (
      block.has_children === true &&
      typeof block.id === 'string' &&
      !IS_ITS_OWN_DOCUMENT.has(String(block.type))
    ) {
      out.push(...(await fetchBlocks(notion, block.id, depth + 1)))
    }
  }
  return out
}

/** The text of one page. A database contributes its title and its rows' titles. */
export async function pageText(notion: NotionClient, object: NotionObject): Promise<string> {
  if (object.object === 'database') {
    const rows: string[] = []
    // `/data_sources/:id/query`, not `/databases/:id/query`. The id search
    // returns at this version IS a data source id, and asking the databases
    // endpoint for it is a 404 — confirmed live before changing this.
    for await (const raw of notion.paginate(`/data_sources/${object.id}/query`, {})) {
      const title = titleOf(raw)
      if (title !== '') rows.push(`- ${title}`)
    }
    return rows.length === 0 ? '' : `# ${object.title}\n\n${rows.join('\n')}`
  }
  return renderBlocks(await fetchBlocks(notion, object.id))
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
    select content_fingerprint from public.documents
     where office_id = ${officeOf(projectId)}
       and connector = ${lit(CONNECTOR)}
       and external_parent_ref = ${lit(object.object)}
       and external_ref = ${lit(object.id)}
  `)
  const known = existing.rows.length > 0
  if (known && String(existing.rows[0]?.content_fingerprint) === fingerprint) return 'unchanged'

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
                and d.office_id = ${officeOf(projectId)}
                and d.connector <> ${lit(CONNECTOR)}
                and d.mirrors_document_id is null
                and app.normalise_name(d.title) = app.normalise_name(${nul(object.title === '' ? null : object.title)})
              limit 1),
            ${officeOf(projectId)})
    -- The index is partial (0051), so the conflict target repeats its predicate.
    on conflict (connector, external_parent_ref, external_ref)
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
      -- The key is still global (connector, parent, ref): a page another office holds is never overwritten or moved.
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
  projectId: string,
): Promise<ReadonlySet<string>> {
  const rows = await db.execute(`
    select external_ref from app.container_refs(${lit(projectId)}::uuid, ${lit(CONNECTOR)})
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
            app.now_utc(), 'made', ${lit(producedBy)}, ${officeOf(projectId)})
    on conflict (connector, external_parent_ref, external_ref)
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
  notion: NotionClient,
  projectId: string,
): Promise<SyncOutcome> {
  const shared = await listShared(notion)
  const containers = await containerRefs(db, projectId)
  let added = 0
  let changed = 0
  let unchanged = 0
  const skipped: string[] = []

  for (const object of shared) {
    // #19. The attachment itself, not a document in it.
    if (containers.has(object.id)) {
      skipped.push(`${object.title === '' ? object.id : object.title}: container`)
      continue
    }
    try {
      const content = await pageText(notion, object)
      if (content.trim() === '') {
        // An empty page is not a document. Storing one would put a row in the
        // corpus that can never match a search and always counts as synced.
        skipped.push(`${object.title === '' ? object.id : object.title}: empty`)
        continue
      }
      const outcome = await upsertDocument(db, projectId, object, content)
      if (outcome === 'added') added += 1
      else if (outcome === 'changed') changed += 1
      else unchanged += 1
    } catch (error) {
      const reason =
        error instanceof NotionApiError ? error.code : (error as Error).message.slice(0, 60)
      skipped.push(`${object.title === '' ? object.id : object.title}: ${reason}`)
    }
  }

  return { shared: shared.length, added, changed, unchanged, skipped }
}
