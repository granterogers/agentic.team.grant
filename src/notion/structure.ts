/**
 * Finding your way around a Notion workspace.
 *
 * The Chief of Staff, asked to build a curriculum in Notion, replied:
 *
 *     "I need the current Notion teamspace ID and which Projects already exist
 *      so I don't duplicate anything."
 *
 * Grant's objection to that whole exchange was the right one: *"An agent should
 * not have to ask me 'Do we have a Notion token?' … when the system can
 * determine those things itself."* Every part of that question is discoverable.
 * What existed was `listShared`, which returns a flat list of pages and
 * databases with no schema, no parentage and no way to ask "which one is
 * Tasks?".
 *
 * ## Data sources, not databases
 *
 * From `2025-09-03` a database is a container and the queryable thing inside it
 * is a **data source**. Pages are parented to a `data_source_id`, queries go to
 * `/data_sources/:id/query`, and search returns `data_source` objects. At
 * `2026-03-11` — the version this client now speaks — asking
 * `/databases/{that id}` is a 404. Confirmed live before any of this was
 * written.
 *
 * ## What is deliberately not here
 *
 * Teamspaces. The API exposes none: no endpoint, no field, no parent type, on
 * every version tested. A data source inside a teamspace reports its parent as
 * the workspace. So "which teamspace is this in" is unanswerable, and the
 * honest thing is to say so rather than to return something teamspace-shaped
 * that is really a guess.
 */

import type { NotionClient } from './api.ts'
import { titleOf } from './content.ts'

export interface DataSource {
  readonly id: string
  readonly title: string
  /** The database that contains it, when Notion reports one. */
  readonly databaseId: string | null
  readonly url: string | null
}

export interface PropertySpec {
  readonly name: string
  /** `title`, `rich_text`, `select`, `status`, `date`, `relation`, `files`… */
  readonly type: string
  /** For select and status: what it will accept. Writing anything else fails. */
  readonly options: readonly string[]
  /** For a relation: the data source it points at. */
  readonly relatesTo: string | null
}

export interface Schema {
  readonly id: string
  readonly title: string
  readonly properties: readonly PropertySpec[]
  /** The property holding the page title. Notion lets each database name it. */
  readonly titleProperty: string
}

/** Every data source the integration has been given. */
export async function listDataSources(client: NotionClient): Promise<DataSource[]> {
  const found: DataSource[] = []
  for await (const raw of client.paginate('/search', {
    filter: { property: 'object', value: 'data_source' },
  })) {
    const parent = raw.parent as { database_id?: string } | undefined
    found.push({
      id: String(raw.id),
      title: titleOf(raw),
      databaseId: parent?.database_id === undefined ? null : String(parent.database_id),
      url: typeof raw.url === 'string' ? raw.url : null,
    })
  }
  return found
}

/**
 * What one data source will accept.
 *
 * The reason this matters more than it looks: Notion rejects a write that names
 * a property it does not have, or a select option that is not in its list. An
 * agent that guesses "Status: In Progress" against a database whose options are
 * "Not started / Doing / Done" gets a validation error it cannot interpret. The
 * options are readable, so they should be read.
 */
export async function schemaOf(client: NotionClient, dataSourceId: string): Promise<Schema> {
  const raw = await client.call(`/data_sources/${dataSourceId}`)
  const props = (raw.properties ?? {}) as Record<string, Record<string, unknown>>

  const properties: PropertySpec[] = Object.entries(props).map(([name, spec]) => {
    const type = String(spec.type ?? 'unknown')
    const body = (spec[type] ?? {}) as {
      options?: { name?: string }[]
      groups?: unknown
      data_source_id?: string
      database_id?: string
    }
    return {
      name,
      type,
      options: (body.options ?? []).map((o) => String(o.name ?? '')).filter((o) => o !== ''),
      relatesTo:
        body.data_source_id === undefined
          ? body.database_id === undefined
            ? null
            : String(body.database_id)
          : String(body.data_source_id),
    }
  })

  return {
    id: dataSourceId,
    title: titleOf(raw),
    properties,
    // Every database has exactly one title property and it can be called
    // anything — "Name", "Task", "Project". Writing to the wrong key is a
    // validation error, so it is read rather than assumed.
    titleProperty: properties.find((p) => p.type === 'title')?.name ?? 'Name',
  }
}

/**
 * The data source somebody means by a name.
 *
 * Exact match first, then case-insensitive, then a contains — so "tasks",
 * "Tasks" and "Task list" all find the same thing. Returns null on an ambiguous
 * or absent match rather than picking, for the reason the project resolver does
 * the same: writing to the wrong database is silent and annoying to undo.
 */
export function findDataSource(sources: readonly DataSource[], name: string): DataSource | null {
  const wanted = name.trim().toLowerCase()
  if (wanted === '') return null
  const exact = sources.filter((s) => s.title.toLowerCase() === wanted)
  if (exact.length === 1) return exact[0] ?? null
  if (exact.length > 1) return null
  const partial = sources.filter((s) => s.title.toLowerCase().includes(wanted))
  return partial.length === 1 ? (partial[0] ?? null) : null
}

export interface Row {
  readonly id: string
  readonly title: string
  readonly url: string | null
  readonly properties: Record<string, unknown>
}

/**
 * Rows from a data source, optionally filtered.
 *
 * `limit` because an agent checking "does this already exist?" wants a handful,
 * and paging an entire Tasks database to answer it is a lot of requests for a
 * question with a cheap answer.
 */
export async function queryDataSource(
  client: NotionClient,
  dataSourceId: string,
  options: { filter?: unknown; sorts?: unknown[]; limit?: number } = {},
): Promise<Row[]> {
  const rows: Row[] = []
  const body: Record<string, unknown> = {}
  if (options.filter !== undefined) body.filter = options.filter
  if (options.sorts !== undefined) body.sorts = options.sorts

  for await (const raw of client.paginate(`/data_sources/${dataSourceId}/query`, body)) {
    rows.push({
      id: String(raw.id),
      title: titleOf(raw),
      url: typeof raw.url === 'string' ? raw.url : null,
      properties: (raw.properties ?? {}) as Record<string, unknown>,
    })
    if (options.limit !== undefined && rows.length >= options.limit) break
  }
  return rows
}

/**
 * Is there already a row with this title?
 *
 * Grant: *"Avoid duplicate creation when rerunning an import."* An import that
 * is run twice — because it failed halfway, or because he asked again — must
 * not double everything, and the cheapest reliable key is the title, since it
 * is the one property every data source has.
 *
 * Compared after normalising case and whitespace, because "Module 1: Intro" and
 * "Module 1:  Intro" are the same task to a person and the second is what you
 * get when a model regenerates a list.
 */
export async function findByTitle(
  client: NotionClient,
  dataSourceId: string,
  title: string,
  titleProperty = 'Name',
): Promise<Row | null> {
  const wanted = title.trim().toLowerCase().replace(/\s+/g, ' ')
  const rows = await queryDataSource(client, dataSourceId, {
    // Notion's `contains` is the closest server-side filter to what is wanted;
    // the exact comparison happens here, because Notion's is case-sensitive and
    // whitespace-sensitive and a person's idea of "the same title" is neither.
    filter: { property: titleProperty, title: { contains: title.trim().slice(0, 100) } },
    limit: 25,
  })
  return rows.find((r) => r.title.trim().toLowerCase().replace(/\s+/g, ' ') === wanted) ?? null
}
