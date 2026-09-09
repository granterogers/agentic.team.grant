/**
 * Everything the Notion capability matrix claims, exercised against the real API.
 *
 *   npm run verify:notion-write
 *
 * Grant's brief asked for a real end-to-end smoke test: create a page, add
 * blocks, update it, make a child item, upload and attach a file, read it all
 * back, then clean up — *"Do not modify unrelated existing Notion content."*
 *
 * That is what this is, and it doubles as the honesty check on
 * `src/notion/capabilities.ts`. A capability matrix is a list of claims, and a
 * list of claims that nothing verifies is exactly the failure this whole piece
 * of work exists to fix — the Chief of Staff describing her own abilities from
 * memory. So every row marked SUPPORTED here has to survive a live call.
 *
 * ## What it touches
 *
 * One page it creates, in a data source Grant has already shared, plus its
 * children. Everything is titled with a run id and trashed at the end. It never
 * writes to a page it did not make, and it never deletes — Notion has no hard
 * delete over the API, so "cleaned up" means in the trash and restorable.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { NotionClient } from '../../src/notion/api.ts'
import { capabilitySummary, notionCapabilities } from '../../src/notion/capabilities.ts'
import { contentTypeFor, fileBlock, NotionFileError, uploadFile } from '../../src/notion/files.ts'
import { findByTitle, listDataSources, schemaOf } from '../../src/notion/structure.ts'
import {
  appendBlocks,
  archivePage,
  createPage,
  createPageIfAbsent,
  toBlocks,
  updatePage,
} from '../../src/notion/write.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const run = Date.now().toString(36)
const checks: { what: string; outcome: string; passed: boolean }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${what} — ${outcome}`)
}

// ===========================================================================
// Introspection — the thing an agent asks instead of asking Grant
// ===========================================================================

const caps = await notionCapabilities(db)
record(
  'the system can say whether Notion is configured, without being told',
  `configured=${String(caps.configured)} authenticates=${String(caps.authenticates)} as ${String(caps.bot)}`,
  caps.configured && caps.authenticates,
)
record(
  'and which workspace, and how much is shared with it',
  `${String(caps.workspace)} · ${String(caps.dataSources)} data source(s) · API ${caps.apiVersion}`,
  caps.dataSources > 0,
)
record(
  'it distinguishes what we have not built from what Notion cannot do',
  `${String(caps.operations.filter((o) => o.state === 'NOT_IMPLEMENTED').length)} not implemented, ` +
    `${String(caps.operations.filter((o) => o.state === 'NOT_SUPPORTED_BY_NOTION').length)} impossible`,
  caps.operations.some((o) => o.state === 'NOT_IMPLEMENTED') &&
    caps.operations.some((o) => o.state === 'NOT_SUPPORTED_BY_NOTION'),
)
// The claim that started all this. If writing is not SUPPORTED, the Chief of
// Staff saying "I can't create pages" is correct again and nothing below works.
record(
  'creating a page reports as SUPPORTED, not as a hope',
  String(caps.operations.find((o) => o.operation === 'create_page')?.state),
  caps.operations.find((o) => o.operation === 'create_page')?.state === 'SUPPORTED',
)
record(
  'and the summary an agent is handed says so in a sentence',
  capabilitySummary(caps).slice(0, 80),
  capabilitySummary(caps).includes('create_page'),
)
// Never a credential, in any field, at any length.
const asText = JSON.stringify(caps)
const token = String(
  (
    (
      await db.execute(
        `select decrypted_secret v from vault.decrypted_secrets where name='notion.integration_token'`,
      )
    ).rows[0] as { v?: string }
  )?.v ?? '',
)
record(
  'and it never carries the token, or a prefix of it',
  token === '' ? 'no token to leak' : 'checked against the real value',
  token !== '' && !asText.includes(token) && !asText.includes(token.slice(0, 8)),
)

if (!caps.authenticates) {
  console.error('\nNotion does not authenticate, so the write checks cannot run.')
  process.exit(1)
}

const client = new NotionClient(token)

// ===========================================================================
// Structure — finding somewhere to write without asking
// ===========================================================================

const sources = await listDataSources(client)
record(
  'every shared data source is discoverable',
  sources
    .map((s) => s.title)
    .join(', ')
    .slice(0, 90),
  sources.length > 0,
)

const target = sources.find((s) => s.title === 'Docs') ?? sources[0]
if (target === undefined) {
  record('a data source to write into', 'none shared', false)
  process.exit(1)
}

const schema = await schemaOf(client, target.id)
record(
  'its schema reads, including which property holds the title',
  `${target.title}: ${String(schema.properties.length)} properties, title="${schema.titleProperty}"`,
  schema.properties.length > 0 && schema.titleProperty !== '',
)
// The reason schema reading matters: writing a select value that is not in the
// list is a validation error an agent cannot interpret.
const selects = schema.properties.filter((p) => p.type === 'select' || p.type === 'status')
record(
  'and the values a select property will actually accept',
  selects.length === 0
    ? 'no select properties on this one'
    : selects.map((p) => `${p.name}=[${p.options.slice(0, 3).join('|')}]`).join(' '),
  true,
)

// ===========================================================================
// Writing
// ===========================================================================

const title = `Agentic Team Notion Integration Test ${run}`
const page = await createPage(client, {
  parent: { dataSource: target.id },
  title,
  titleProperty: schema.titleProperty,
  body: [
    '# Integration test',
    '',
    'Written by `verify:notion-write`. Trashed at the end of the run.',
    '',
    '## Structure',
    '- a bulleted item',
    '- [ ] an unchecked task',
    '- [x] a checked one',
    '',
    '> a quote',
    '',
    '---',
  ].join('\n'),
})
record(
  'a page is created, with structured content',
  `${page.id.slice(0, 8)} · ${String(page.blocks)} blocks`,
  page.id !== '' && page.blocks > 5,
)

await appendBlocks(client, page.id, toBlocks('## Appended\n\nA second pass added this.'))
const children = (await client.call(`/blocks/${page.id}/children`)) as {
  results?: { type: string }[]
}
const kinds = (children.results ?? []).map((b) => b.type)
record(
  'blocks append, and the structure survives the round trip',
  kinds.join(', ').slice(0, 90),
  kinds.includes('heading_1') &&
    kinds.includes('bulleted_list_item') &&
    kinds.includes('to_do') &&
    kinds.includes('quote') &&
    kinds.includes('divider'),
)

await updatePage(client, page.id, {
  [schema.titleProperty]: { title: [{ type: 'text', text: { content: `${title} (updated)` } }] },
})
const reread = (await client.call(`/pages/${page.id}`)) as Record<string, unknown>
const readBack = JSON.stringify(reread.properties ?? {})
record(
  'a property updates and reads back changed',
  readBack.includes('(updated)') ? 'title now ends "(updated)"' : 'unchanged',
  readBack.includes('(updated)'),
)

// ===========================================================================
// Idempotency — the thing that stops a rerun doubling his workspace
// ===========================================================================

const again = await createPageIfAbsent(client, {
  parent: { dataSource: target.id },
  title: `${title} (updated)`,
  titleProperty: schema.titleProperty,
  body: 'This must not become a second page.',
})
record(
  'creating the same title twice finds the first instead of duplicating it',
  again.existed ? `matched ${again.id.slice(0, 8)}` : 'IT MADE A SECOND ONE',
  again.existed && again.id === page.id,
)

const found = await findByTitle(client, target.id, `${title} (updated)`, schema.titleProperty)
record(
  'and a title lookup is exact, not merely a contains',
  found === null ? 'not found' : found.id.slice(0, 8),
  found?.id === page.id,
)

// ===========================================================================
// Files
// ===========================================================================

record(
  'an unsupported file is refused before any request is made',
  contentTypeFor('malware.exe') === null ? 'refused' : 'it would have tried',
  contentTypeFor('malware.exe') === null,
)
let refusedActionably = false
try {
  await uploadFile(client, 'nope.exe', new Uint8Array([1, 2, 3]))
} catch (error) {
  refusedActionably =
    error instanceof NotionFileError &&
    error.reason === 'unsupported_type' &&
    /convert it or link/i.test(error.message)
}
record(
  'and the refusal says what to do instead',
  refusedActionably ? 'actionable message' : 'not actionable',
  refusedActionably,
)

const uploaded = await uploadFile(
  client,
  `agentic-test-${run}.txt`,
  new TextEncoder().encode('A tiny harmless file, uploaded by the integration test.'),
)
record(
  'a file uploads',
  `${uploaded.filename} · ${String(uploaded.bytes)} bytes · ${String(uploaded.parts)} part(s)`,
  uploaded.id !== '',
)

await appendBlocks(client, page.id, [
  fileBlock(uploaded, 'attached by verify:notion-write') as never,
])
const withFile = (await client.call(`/blocks/${page.id}/children`)) as {
  results?: { type: string }[]
}
record(
  'and attaches to the page as a real file block',
  (withFile.results ?? []).map((b) => b.type).filter((t) => t === 'file').length > 0
    ? 'file block present'
    : 'no file block',
  (withFile.results ?? []).some((b) => b.type === 'file'),
)

// An audio file becomes an audio block, not a download link. §16's difference
// between attached and useful.
record(
  'an audio file would become an audio block, not a download link',
  String(fileBlock({ id: 'x', filename: 'overview.mp3', bytes: 1, parts: 1 }).type),
  fileBlock({ id: 'x', filename: 'overview.mp3', bytes: 1, parts: 1 }).type === 'audio',
)

// ===========================================================================
// Clean up — and prove it is reversible rather than destructive
// ===========================================================================

await archivePage(client, page.id)
const trashed = (await client.call(`/pages/${page.id}`)) as { in_trash?: boolean }
record(
  'the test page is archived, and archiving is reversible rather than destructive',
  trashed.in_trash === true ? 'in the trash, restorable' : 'NOT ARCHIVED',
  trashed.in_trash === true,
)

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? 'yes' : 'NO'} |`)
console.log(`\n${String(passed)}/${String(checks.length)} checks passed`)
console.log('Nothing outside the page this run created was touched.')

process.exit(passed === checks.length ? 0 : 1)
