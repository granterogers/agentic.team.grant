/*
 * CONTACTS, AGAINST THE REAL OFFICE.
 *
 * Grant, 23 September: "Against the REAL backend: create, save, appears; open,
 * correct; edit, save, refresh, persists; photo persists; notes persist; links
 * persist; delete/archive behaves correctly; failure, truthful recovery. No
 * prototype-memory acceptance."
 *
 * So every check here goes over the network to the DEPLOYED gateway with the
 * office's own bearer token, and reads back through the SAME reader the page
 * reads - not through the writer's return value, which would prove only that a
 * function returned something.
 *
 * ## What it does to Grant's database
 *
 * It creates one contact on a real project, edits it, gives it a photograph,
 * puts it away, brings it back, and then puts it away for good - because
 * `public.contacts` has no delete path by design (a contact who has been
 * corresponded with is referred to by things that happened, and deleting the
 * row makes that history anonymous).
 *
 * The subject is named so a person reading the list knows what it is, and the
 * teardown asserts nothing of it is left in view. CLAUDE.md's #45 question -
 * which side of the filter is this row on - is answered: `studio_contacts`
 * excludes `is_fixture`, so a fixture-named contact could not be READ back and
 * every assertion here would pass for the wrong reason. It uses a real one and
 * puts it away.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

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
if (token === '') {
  console.error('no hq.api_token in the vault')
  process.exit(1)
}

const API = `https://${ref}.supabase.co/functions/v1/hq-api`
const act = async (
  action: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args }),
  })
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return { status: r.status, ...body }
}
const read = async (section: string): Promise<Record<string, unknown>> => {
  const r = await fetch(`${API}?section=${encodeURIComponent(section)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await r.json().catch(() => ({}))) as { data?: Record<string, unknown> }).data ?? {}
}

/* A real project of Grant's, chosen by the office rather than named here. */
const project = (
  await db.execute(
    `select slug, project_id from public.projects
      where coalesce(status,'') <> 'archived' and not is_fixture
      order by created_at limit 1`,
  )
).rows[0] as { slug?: string; project_id?: string } | undefined
check(
  'there is a real project to put a contact on',
  project?.slug !== undefined,
  JSON.stringify(project),
)
const slug = String(project?.slug ?? '')
const projectId = String(project?.project_id ?? '')

const run = Math.random().toString(36).slice(2, 8)
const NAME = `Acceptance contact ${run}`

/* --- create ------------------------------------------------------------- */
const made = await act('contact_add', {
  p_project: slug,
  p_name: NAME,
  p_role: 'Prospective client',
  p_org: 'Northgate Studios',
  p_email: 'someone@example.com',
})
const id = String(((made.result ?? {}) as Record<string, unknown>).id ?? '')
check(
  'a contact is created through the deployed gateway',
  id !== '',
  JSON.stringify(made).slice(0, 200),
)

/* Read it back the way the page does, never from the writer's answer. */
const contactsOf = async (): Promise<Record<string, unknown>[]> => {
  const studio = await read('studio')
  const projects = (studio.projects ?? []) as Record<string, unknown>[]
  const mine = projects.find((p) => p.slug === slug)
  return ((mine?.contacts ?? []) as Record<string, unknown>[]) ?? []
}
let seen = (await contactsOf()).find((c) => c.id === id)
check(
  'and it appears in what the page reads',
  seen !== undefined,
  `${String((await contactsOf()).length)} contact(s)`,
)
check(
  'with the details it was given',
  seen?.org === 'Northgate Studios' && seen?.role === 'Prospective client',
  JSON.stringify(seen),
)

/* --- edit every field Grant listed --------------------------------------- */
const edited = await act('contact_update', {
  p_contact_id: id,
  p_name: `${NAME} (corrected)`,
  p_role: 'Client',
  p_org: 'Northgate Studios Ltd',
  p_email: 'corrected@example.com',
  p_phone: '+44 7700 900123',
  p_website: 'https://example.com',
  p_instagram: '@northgate',
  p_where: 'Leeds',
  p_note: 'Met at the Leeds workshop. Wants the three-layer version.',
})
check(
  'every field can be changed in one go',
  ((edited.result ?? {}) as Record<string, unknown>).ok === true,
  JSON.stringify(edited).slice(0, 200),
)

seen = (await contactsOf()).find((c) => c.id === id)
check(
  'the correction persisted, read back through the page reader',
  seen?.name === `${NAME} (corrected)`,
  JSON.stringify(seen),
)
for (const [field, want] of [
  ['role', 'Client'],
  ['org', 'Northgate Studios Ltd'],
  ['email', 'corrected@example.com'],
  ['phone', '+44 7700 900123'],
  ['website', 'https://example.com'],
  ['instagram', '@northgate'],
  ['where', 'Leeds'],
] as [string, string][]) {
  check(`  ${field} persisted`, seen?.[field] === want, `got ${String(seen?.[field])}`)
}
check(
  '  the note persisted, so it is not read-only decoration',
  String(seen?.note ?? '').includes('three-layer version'),
  String(seen?.note ?? ''),
)

/* --- clearing a field is different from leaving it alone ------------------ */
await act('contact_update', { p_contact_id: id, p_phone: '' })
seen = (await contactsOf()).find((c) => c.id === id)
check(
  'a field can be emptied, and emptying one leaves the others alone',
  seen?.phone === undefined && seen?.email === 'corrected@example.com',
  JSON.stringify(seen),
)

/* --- the photograph ------------------------------------------------------ */
/*
  A REAL IMAGE: the smallest valid PNG, built here rather than read from disk so
  this suite carries no fixture file. What is asserted is not that a string was
  stored - it is that the DATABASE holds a storage PATH, that the page is handed
  a signed URL instead, and that the URL actually fetches the bytes back.
*/
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const photo = await act('contact_photo', {
  p_contact_id: id,
  p_project_id: projectId,
  p_mime: 'image/png',
  p_base64: PNG,
})
check(
  'a photograph is accepted',
  ((photo.result ?? {}) as Record<string, unknown>).ok === true,
  JSON.stringify(photo).slice(0, 200),
)
const stored = (
  await db.execute(`select photo_path from public.contacts where contact_id = '${id}'`)
).rows[0] as { photo_path?: string } | undefined
check(
  'and the DATABASE holds a path, not the image',
  typeof stored?.photo_path === 'string' &&
    stored.photo_path.includes(`${projectId}/contacts/`) &&
    !stored.photo_path.startsWith('data:'),
  JSON.stringify(stored),
)
seen = (await contactsOf()).find((c) => c.id === id)
const link = String(seen?.photo ?? '')
check('the page is handed a link rather than a path', link.startsWith('http'), link.slice(0, 80))
check(
  'and never learns where storage keeps it',
  !link.includes(`${projectId}/contacts/`) || link.includes('token='),
  link.slice(0, 120),
)
/* Only if there is a link at all: fetching '' throws, and a thrown suite
   reports nothing about the checks after it. */
const fetched = link.startsWith('http') ? await fetch(link) : null
check(
  'and that link really fetches the photograph back',
  fetched !== null && fetched.ok && Number(fetched.headers.get('content-length') ?? '0') > 0,
  fetched === null ? 'there was no link to follow' : `http ${String(fetched.status)}`,
)

/* --- and it can be taken off again ---------------------------------------- */
await act('contact_photo', { p_contact_id: id, p_project_id: projectId, p_base64: '' })
seen = (await contactsOf()).find((c) => c.id === id)
check('the photograph can be removed', seen?.photo === undefined, JSON.stringify(seen?.photo))

/* --- refusals ------------------------------------------------------------- */
const noName = await act('contact_update', { p_contact_id: id, p_name: '   ' })
check(
  'a contact cannot be left without a name, and is told why',
  String(((noName.result ?? {}) as Record<string, unknown>).error ?? '').includes('needs a name'),
  JSON.stringify(noName).slice(0, 160),
)
const notReal = await act('contact_update', {
  p_contact_id: '00000000-0000-0000-0000-000000000000',
  p_name: 'Nobody',
})
check(
  'and a contact that does not exist is refused rather than invented',
  String(((notReal.result ?? {}) as Record<string, unknown>).error ?? '').includes(
    'no such contact',
  ),
  JSON.stringify(notReal).slice(0, 160),
)
const tooBig = await act('contact_photo', {
  p_contact_id: id,
  p_project_id: projectId,
  p_mime: 'image/png',
  p_base64: 'A'.repeat(4 * 1024 * 1024),
})
check(
  'an oversized photograph is refused in a sentence',
  String(tooBig.error ?? '').includes('2 MB') ||
    String(tooBig.error ?? '').includes('could not be read'),
  JSON.stringify(tooBig).slice(0, 160),
)
const notAnImage = await act('contact_photo', {
  p_contact_id: id,
  p_project_id: projectId,
  p_mime: 'application/pdf',
  p_base64: PNG,
})
check(
  'and so is a file that is not an image',
  String(notAnImage.error ?? '').includes('has to be an image'),
  JSON.stringify(notAnImage).slice(0, 160),
)

/* --- putting away, and bringing back --------------------------------------- */
await act('contact_archive', { p_contact_id: id, p_put_away: true })
check(
  'a contact put away leaves the list',
  (await contactsOf()).find((c) => c.id === id) === undefined,
)
const stillThere = (
  await db.execute(`select count(*) as n from public.contacts where contact_id = '${id}'`)
).rows[0] as { n?: number }
check(
  'and is not deleted, so anything that referred to them still can',
  Number(stillThere?.n ?? 0) === 1,
  JSON.stringify(stillThere),
)
await act('contact_archive', { p_contact_id: id, p_put_away: false })
check('and can be brought back', (await contactsOf()).find((c) => c.id === id) !== undefined)

/* --- teardown, asserted, and by CLASS rather than by this run --------------- *
 *
 * A crashed run leaves its subject behind, and a teardown that only knows its
 * own run token can never collect it - CLAUDE.md records five tables where
 * exactly that built a pile. The first run of this suite died before its
 * teardown and left a contact on a real project; the check caught it on the
 * next run, which is what the check is for, and this sweep is what stops it
 * needing to.
 */
await act('contact_archive', { p_contact_id: id, p_put_away: true })
for (const other of await contactsOf()) {
  if (String(other.name ?? '').startsWith('Acceptance contact')) {
    await act('contact_archive', { p_contact_id: String(other.id), p_put_away: true })
  }
}
const left = (await contactsOf()).filter((c) =>
  String(c.name ?? '').startsWith('Acceptance contact'),
)
check('the suite leaves nothing of its own in Grant view', left.length === 0, JSON.stringify(left))

console.log(
  `\n${String(pass)}/${String(pass + fail)} passed — against the deployed gateway and the real database`,
)
process.exit(fail === 0 ? 0 : 1)
