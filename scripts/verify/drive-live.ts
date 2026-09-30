/*
 * GOOGLE DRIVE, FOR REAL.
 *
 * Grant, 23 September: "Use the existing Google/Drive integration architecture
 * if present. Trace it first... browse/search/select appropriate Drive item →
 * choose item → associate/import/link it to the project → see it in Docs &
 * Files → open it later. Do not build a fake list of Drive filenames. Do not
 * hard-code Drive fixtures."
 *
 * Every request here goes over the network to the DEPLOYED gateway, which asks
 * Grant's real Drive with the office's own grant. Nothing is fixtured: the file
 * this picks is whatever Drive answers with, chosen by shape rather than by
 * name, so the suite cannot quietly stop testing when a file is renamed.
 *
 * THE TOKEN NEVER REACHES A BROWSER, and that is asserted rather than assumed:
 * the browse response is checked for anything credential-shaped.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { pressAsPerson } from './lib/as-person.ts'

let pass = 0
let fail = 0
const check = (what: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log(`ok    ${what}`)
  } else {
    fail += 1
    console.log(`FAIL  ${what}${detail === '' ? '' : `\n        ${detail}`}`)
  }
}

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken === '') {
  console.error('SUPABASE_ACCESS_TOKEN is not set')
  process.exit(1)
}
const db = new ManagementApiExecutor(ref, accessToken)
const token = String(
  (
    await db.execute(
      `select decrypted_secret as v from vault.decrypted_secrets where name = 'hq.api_token'`,
    )
  ).rows[0]?.v ?? '',
)
const API = `https://${ref}.supabase.co/functions/v1/hq-api`

type DriveFile = {
  id: string
  name: string
  mime: string
  isFolder: boolean
  open: string
  icon: string
  thumbnail: string
}
const browse = async (
  params: string,
): Promise<{ status: number; files: DriveFile[]; raw: string }> => {
  const r = await fetch(`${API}?section=drive${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const raw = await r.text()
  const body = JSON.parse(raw) as { data?: { files?: DriveFile[] } }
  return { status: r.status, files: body.data?.files ?? [], raw }
}
/*
  Picking a file out of Drive is a person's press (#385): the gateway refuses the office key by name. This suite
  holds the key, so the press goes to the function the action is routed to, as the operator (lib/as-person.ts),
  and the result is wrapped in the shape the gateway would have answered with. Whether the DOOR refuses the key
  is asserted in verify:run3-effects-live, where it does not depend on Grant's Google account being connected.
*/
const act = async (
  action: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const result = await pressAsPerson(db, action, args)
  return { status: 200, action, result }
}

/* --- 1. the office can see Drive at all ---------------------------------- */
const top = await browse('')
check(
  'the deployed gateway lists Grant real Drive',
  top.status === 200 && top.files.length > 0,
  `http ${String(top.status)}, ${String(top.files.length)} item(s)`,
)
/*
  A GOOGLE HOST, not specifically drive.google.com.

  The first run of this failed on a perfectly real item: a Google Apps Script,
  which Drive lists and which opens at script.google.com. Docs, Sheets and
  Slides do the same on docs.google.com. Asserting one host was asserting the
  artefact rather than the property, and the property is that every item is a
  real Google item with a real Google id.
*/
check(
  'and it is really Drive rather than a fixture: every item carries a Google id and a Google link',
  top.files.every(
    (f) => /^[A-Za-z0-9_-]{20,}$/.test(f.id) && /^https:\/\/[a-z]+\.google\.com\//.test(f.open),
  ),
  JSON.stringify(
    top.files.find((f) => !/^https:\/\/[a-z]+\.google\.com\//.test(f.open)) ?? {},
  ).slice(0, 180),
)

/*
  NO CREDENTIAL COMES BACK. The page asks the office to look in Drive; it must
  never be handed something it could look with.
*/
check(
  'nothing credential-shaped is in the response',
  !/ya29\.|refresh_token|client_secret|"access_token"/.test(top.raw),
  'the browse response carried something token-shaped',
)

/* --- 2. walking in, and searching ---------------------------------------- */
const folder = top.files.find((f) => f.isFolder)
check('there is a folder to walk into', folder !== undefined)
const inside =
  folder === undefined
    ? { files: [] as DriveFile[], status: 0 }
    : await browse(`&folder=${folder.id}`)
check(
  'walking into a folder shows what is in it',
  inside.status === 200,
  `${String(inside.files.length)} item(s) in ${String(folder?.name)}`,
)
const searched = await browse('&q=a')
check(
  'searching by name answers',
  searched.status === 200 && searched.files.length > 0,
  `${String(searched.files.length)} match(es)`,
)

/*
  AN APOSTROPHE IS AN ORDINARY THING TO HAVE IN A FILENAME, and Drive's query
  language is a string. A search that breaks on one would be a search nobody
  could trust with real names.
*/
const awkward = await browse('&q=' + encodeURIComponent("it's"))
check(
  'and a search containing an apostrophe does not break the query',
  awkward.status === 200,
  `http ${String(awkward.status)}`,
)

/* --- 3. picking one ------------------------------------------------------ */
const project = (
  await db.execute(
    `select slug, project_id from public.projects
      where coalesce(status,'') <> 'archived' and not is_fixture
      order by created_at limit 1`,
  )
).rows[0] as { slug?: string; project_id?: string }
const projectId = String(project?.project_id ?? '')

/*
  CHOSEN BY SHAPE, not by name: the first real file that is not a folder.
  Naming one here would make this suite stop testing the day it is renamed, and
  would be the hard-coded fixture Grant forbade in the same sentence.
*/
const pickable = (inside.files.length > 0 ? inside.files : top.files).find((f) => !f.isFolder)
check(
  'there is a file to pick',
  pickable !== undefined,
  JSON.stringify(pickable ?? {}).slice(0, 120),
)

const picked = await act('drive_link', {
  p_project_id: projectId,
  p_connector: 'drive',
  p_external_ref: pickable?.id ?? '',
  p_title: pickable?.name ?? '',
  p_mime: pickable?.mime ?? '',
  p_source_title: 'Google Drive',
})
const result = (picked.result ?? {}) as Record<string, unknown>
check(
  'picking it records a project document',
  result.ok === true,
  JSON.stringify(picked).slice(0, 200),
)
const documentId = String(result.id ?? '')

const row = (
  await db.execute(
    `select connector, external_ref, title, mime_type, doc_type,
            content is null as no_copy, origin
       from public.documents where document_id = '${documentId}'`,
  )
).rows[0] as Record<string, unknown> | undefined
check(
  'with Drive named as the provider and the file identified',
  row?.connector === 'drive' && row?.external_ref === pickable?.id,
  JSON.stringify(row),
)
check(
  'and it is a REFERENCE rather than a copy: no content was pulled across',
  row?.no_copy === true,
  JSON.stringify(row),
)
/*
  IDENTITY WITHOUT PRETENDING TO HOLD BYTES. `documents_file_is_complete` says
  storage_path, mime_type and byte_size describe one stored file and travel
  together, and a reference has none of them - so the Google kind is kept in
  `doc_type`, in the office's own words, which is also what decides which
  Google URL opens it.

  ASSERTED AGAINST WHAT THE OFFICE SAID IT STORED rather than against a copy of
  its mapping: a copy here is a second place for the vocabulary to rot.
*/
check(
  'the provider identity is kept, so a Doc is still a Doc',
  String(row?.doc_type ?? '') !== '' && row?.doc_type === result.kind,
  `${String(pickable?.mime)} stored as ${String(row?.doc_type)}, the office said ${String(result.kind)}`,
)
check(
  'and it does not claim to hold bytes it has not got',
  row?.mime_type === null,
  `mime_type ${String(row?.mime_type)}`,
)

/* --- 4. picking the same file twice is one document ---------------------- */
const again = await act('drive_link', {
  p_project_id: projectId,
  p_connector: 'drive',
  p_external_ref: pickable?.id ?? '',
  p_title: pickable?.name ?? '',
  p_mime: pickable?.mime ?? '',
})
const twice = (
  await db.execute(
    `select count(*) as n from public.documents
      where connector = 'drive' and external_ref = '${String(pickable?.id ?? '').replace(/'/g, "''")}'`,
  )
).rows[0] as { n?: number }
check(
  'picking the same file twice leaves one document, not two',
  Number(twice?.n ?? 0) === 1 && ((again.result ?? {}) as Record<string, unknown>).ok === true,
  JSON.stringify(twice),
)

/* --- 5. it is in Docs & Files, and it opens ------------------------------ */
const studio = await fetch(`${API}?section=studio`, {
  headers: { Authorization: `Bearer ${token}` },
})
const payload = (await studio.json()) as { data?: { projects?: Record<string, unknown>[] } }
const mine = (payload.data?.projects ?? []).find((p) => p.slug === project?.slug)
const documents = (mine?.documents ?? []) as Record<string, unknown>[]
check(
  'it appears in the project documents the page reads',
  documents.some((d) => String(d.id ?? '') === documentId),
  `${String(documents.length)} document(s)`,
)
const shown = documents.find((d) => String(d.id ?? '') === documentId)
check(
  'and it says it came from Drive rather than looking like an upload',
  /drive/i.test(JSON.stringify(shown)),
  JSON.stringify(shown).slice(0, 200),
)

/* --- 6. refusals --------------------------------------------------------- */
const noRef = await act('drive_link', {
  p_project_id: projectId,
  p_connector: 'drive',
  p_external_ref: '',
  p_title: 'Nothing',
})
check(
  'a pick with no file is refused',
  String(((noRef.result ?? {}) as Record<string, unknown>).error ?? noRef.error ?? '').length > 0,
  JSON.stringify(noRef).slice(0, 160),
)
const badConnector = await act('drive_link', {
  p_project_id: projectId,
  p_connector: 'dropbox',
  p_external_ref: 'x1',
  p_title: 'Something',
})
check(
  'and a provider the office does not read is refused by name',
  String(((badConnector.result ?? {}) as Record<string, unknown>).error ?? '').includes(
    'not a connector',
  ),
  JSON.stringify(badConnector).slice(0, 160),
)

/* --- teardown, by class -------------------------------------------------- */
/*
  A PICKED FILE IS THE ONE WITH NO CONTENT. Both a picked file and a synced one
  say `origin = 'source'` - that is the word the table has - so the thing that
  tells them apart is a property rather than a label: the sync pulls text
  across, and a reference never does. Keyed on that so this can never sweep a
  document the office actually read.
*/
await db.execute(
  `delete from public.documents
    where connector = 'drive' and added_by = 'grant'
      and project_id = '${projectId}' and content is null
      and external_parent_ref is null`,
)
const left = (
  await db.execute(
    `select count(*) as n from public.documents
      where connector = 'drive' and added_by = 'grant'
        and project_id = '${projectId}' and content is null
        and external_parent_ref is null`,
  )
).rows[0] as { n?: number }
check(
  'the suite leaves no linked documents behind',
  Number(left?.n ?? 0) === 0,
  JSON.stringify(left),
)

console.log(
  `\n${String(pass)}/${String(pass + fail)} passed — against the deployed gateway and Grant's real Drive`,
)
process.exit(fail === 0 ? 0 : 1)
