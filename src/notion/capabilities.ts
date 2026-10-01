/**
 * What we can do with Notion, answered by the system rather than by the user.
 *
 * Grant, after the Chief of Staff asked him for configuration the system
 * already held:
 *
 *     "An agent should not have to ask me 'Do we have a Notion token?' 'What
 *      operations do I have?' 'Is the integration read-only?' … when the system
 *      can determine those things itself."
 *
 * Every one of those is answerable from the vault, the tool registry and one
 * live call. So this answers them, in the six states he asked for, and the
 * distinction between them is the whole value:
 *
 *     SUPPORTED               built, permitted, and the credential works
 *     NOT_IMPLEMENTED         Notion can, we have not written it
 *     NOT_AUTHORIZED          built, and this team is not permitted it
 *     NOT_CONFIGURED          built and permitted, and there is no credential
 *     NOT_SUPPORTED_BY_NOTION nobody can; stop asking
 *     UNKNOWN                 could not be determined, and says so
 *
 * `NOT_IMPLEMENTED` against `NOT_SUPPORTED_BY_NOTION` is the pair that matters
 * most. For a week "the team cannot upload files to Notion" was true and read
 * as the second when it was the first — and the difference is a morning's work
 * versus an impossibility.
 *
 * ## Never a credential
 *
 * Not the token, not a prefix, not a length. `configured` is a boolean and
 * `authenticates` is the result of asking Notion who we are. That answer names
 * the bot and the workspace, which is information about the connection rather
 * than the secret behind it.
 */

import { credentialSql } from '../credentials/deployment.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { NotionApiError, NotionClient } from './api.ts'

export type State =
  | 'SUPPORTED'
  | 'NOT_IMPLEMENTED'
  | 'NOT_AUTHORIZED'
  | 'NOT_CONFIGURED'
  | 'NOT_SUPPORTED_BY_NOTION'
  | 'UNKNOWN'

export interface Operation {
  readonly operation: string
  readonly state: State
  readonly note: string
}

export interface NotionCapabilities {
  readonly configured: boolean
  readonly authenticates: boolean
  readonly bot: string | null
  readonly workspace: string | null
  readonly apiVersion: string
  readonly connectorEnabled: boolean
  readonly canRead: boolean
  readonly canWrite: boolean
  readonly dataSources: number
  readonly operations: readonly Operation[]
  readonly limitations: readonly string[]
}

/**
 * Everything we implement, and what Notion allows regardless of us.
 *
 * `implemented` is a fact about this repository and is asserted by
 * `verify:notion-capabilities`, which walks this table and checks the exported
 * function actually exists. A row that claims something we deleted is worse
 * than no row — it is the same category of lie the Chief of Staff was telling,
 * with better provenance.
 */
const OPERATIONS: readonly {
  operation: string
  implemented: boolean
  write: boolean
  notionSupports: boolean
  note: string
}[] = [
  // --- read ---------------------------------------------------------------
  {
    operation: 'search',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'listShared / paginate("/search")',
  },
  {
    operation: 'retrieve_page',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'call("/pages/:id")',
  },
  {
    operation: 'retrieve_block_children',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'fetchBlocks, recursive',
  },
  {
    operation: 'list_data_sources',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'structure.listDataSources',
  },
  {
    operation: 'inspect_schema',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'structure.schemaOf — property types and select options',
  },
  {
    operation: 'query_data_source',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'structure.queryDataSource',
  },
  {
    operation: 'find_by_title',
    implemented: true,
    write: false,
    notionSupports: true,
    note: 'structure.findByTitle — the idempotency key',
  },
  // --- write --------------------------------------------------------------
  {
    operation: 'create_page',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.createPage, under a data source or a page',
  },
  {
    operation: 'update_page_properties',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.updatePage',
  },
  {
    operation: 'append_blocks',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.appendBlocks, batched at 100',
  },
  {
    operation: 'update_block',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.updateBlock',
  },
  {
    operation: 'archive_page',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.archivePage — in_trash, reversible',
  },
  {
    operation: 'archive_block',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.archiveBlock — reversible',
  },
  {
    operation: 'set_relation',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.relate — Task to Project',
  },
  {
    operation: 'markdown_to_blocks',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'write.toBlocks',
  },
  // --- files --------------------------------------------------------------
  {
    operation: 'upload_file',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'files.uploadFile — single and multi-part',
  },
  {
    operation: 'attach_file_to_block',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'files.fileBlock — audio, video, image, pdf, file',
  },
  {
    operation: 'attach_file_to_property',
    implemented: true,
    write: true,
    notionSupports: true,
    note: 'files.fileProperty',
  },
  // --- not built ----------------------------------------------------------
  {
    operation: 'create_data_source',
    implemented: false,
    write: true,
    notionSupports: true,
    note: 'Notion allows it; nothing here calls it. Grant creates databases by hand today.',
  },
  {
    operation: 'update_schema',
    implemented: false,
    write: true,
    notionSupports: true,
    note: 'Notion allows adding properties; not built, and changing his schema is his call.',
  },
  {
    operation: 'comments',
    implemented: false,
    write: true,
    notionSupports: true,
    note: 'Notion has a comments API; nothing here needs it yet.',
  },
  {
    operation: 'list_users',
    implemented: false,
    write: false,
    notionSupports: true,
    note: 'Needs the user-information capability on the integration; nothing here needs it.',
  },
  {
    operation: 'permanent_delete',
    implemented: false,
    write: true,
    notionSupports: false,
    note: 'Notion has no hard delete over the API. Archiving to the trash is the strongest thing there is — which suits §13.',
  },
  {
    operation: 'create_teamspace',
    implemented: false,
    write: true,
    notionSupports: false,
    note: 'No endpoint, no field, no parent type, on every version tested. Grant creates these by hand and 0163 prompts him to.',
  },
  {
    operation: 'read_teamspace_of_a_page',
    implemented: false,
    write: false,
    notionSupports: false,
    note: 'A page inside a teamspace reports its parent as the workspace. The teamspace is invisible to the API.',
  },
]

/**
 * Ask the system, then ask Notion once.
 *
 * One live call, to `/users/me`. It is the cheapest thing that distinguishes
 * "there is a token" from "the token works", and those are different answers to
 * different questions — a revoked token is `configured` and not
 * `authenticates`.
 */
export async function notionCapabilities(db: SqlExecutor): Promise<NotionCapabilities> {
  const { rows } = await db.execute(`
    select
      ${credentialSql('notion.integration_token')} as token,
      coalesce((select enabled from public.knowledge_connectors
        where connector = 'notion'), false) as connector_enabled,
      coalesce((select enabled from public.tool_permissions
        where tool = 'notion.write'), false) as write_allowed,
      coalesce((select enabled from public.tool_permissions
        where tool = 'notebook.read'), true) as read_allowed
  `)
  const row = rows[0] as {
    token?: string | null
    connector_enabled?: boolean
    write_allowed?: boolean
    read_allowed?: boolean
  }

  const token = String(row.token ?? '')
  const configured = token !== ''
  const connectorEnabled = row.connector_enabled === true
  const canWrite = row.write_allowed === true && connectorEnabled
  const canRead = connectorEnabled

  let authenticates = false
  let bot: string | null = null
  let workspace: string | null = null
  let dataSources = 0
  let reachable: boolean | null = configured ? null : false

  if (configured) {
    const client = new NotionClient(token)
    try {
      const me = (await client.call('/users/me')) as {
        name?: string
        bot?: { workspace_name?: string }
      }
      authenticates = true
      reachable = true
      bot = me.name === undefined ? null : String(me.name)
      workspace = me.bot?.workspace_name === undefined ? null : String(me.bot.workspace_name)
      // How much has actually been shared. "Authenticated with nothing shared"
      // is a real and confusing state, and it looks identical to a broken
      // integration from the outside.
      const { listDataSources } = await import('./structure.ts')
      dataSources = (await listDataSources(client)).length
    } catch (error) {
      // An auth failure is a definite no; anything else leaves it unknown
      // rather than claiming the credential is bad.
      authenticates = false
      reachable = error instanceof NotionApiError && error.kind === 'auth' ? false : null
    }
  }

  const stateFor = (op: (typeof OPERATIONS)[number]): State => {
    if (!op.notionSupports) return 'NOT_SUPPORTED_BY_NOTION'
    if (!op.implemented) return 'NOT_IMPLEMENTED'
    if (!configured) return 'NOT_CONFIGURED'
    if (op.write ? !canWrite : !canRead) return 'NOT_AUTHORIZED'
    if (reachable === null) return 'UNKNOWN'
    return reachable ? 'SUPPORTED' : 'NOT_CONFIGURED'
  }

  const limitations = [
    'Teamspaces are invisible to the API — they cannot be created, listed, or read as a page’s parent.',
    'There is no permanent delete. Archiving moves a page to the trash and is reversible.',
    'A page can only be reached if it, or an ancestor, has been shared with the integration.',
    `Files: single request up to 20MB, multi-part above that. A free workspace caps one file at 5 MiB.`,
    ...(dataSources === 0 && authenticates
      ? ['Nothing is shared with the integration yet, so there is nowhere to write.']
      : []),
  ]

  return {
    configured,
    authenticates,
    bot,
    workspace,
    apiVersion: (await import('./api.ts')).NOTION_VERSION,
    connectorEnabled,
    canRead,
    canWrite,
    dataSources,
    operations: OPERATIONS.map((op) => ({
      operation: op.operation,
      state: stateFor(op),
      note: op.note,
    })),
    limitations,
  }
}

/** The names this module claims to implement, for the check that verifies it. */
export const claimedImplementations = (): readonly string[] =>
  OPERATIONS.filter((o) => o.implemented).map((o) => o.operation)

/**
 * The same thing, as a paragraph an agent can be handed.
 *
 * Short on purpose. A capability list long enough to be complete is long enough
 * to be skimmed, and the two sentences that change behaviour are "you can
 * write" and "here is what you cannot do at all".
 */
export function capabilitySummary(c: NotionCapabilities): string {
  if (!c.configured) return 'Notion is not configured — there is no integration token.'
  if (!c.authenticates) return 'Notion is configured and the token is not being accepted.'
  const can = c.operations.filter((o) => o.state === 'SUPPORTED').map((o) => o.operation)
  const impossible = c.operations
    .filter((o) => o.state === 'NOT_SUPPORTED_BY_NOTION')
    .map((o) => o.operation)
  return (
    `Notion is connected as ${String(c.bot)} in ${String(c.workspace)}, with ` +
    `${String(c.dataSources)} data source(s) shared. You CAN: ${can.join(', ')}. ` +
    `Notion itself cannot do: ${impossible.join(', ')}. ` +
    'Do not tell Grant you are unable to do something on this list without trying it first.'
  )
}
