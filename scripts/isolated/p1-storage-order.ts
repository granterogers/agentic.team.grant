/**
 * Multi-user P1.4 (#400): authenticate -> authorize the DATABASE target -> only then write the object.
 *
 *   npx tsx scripts/isolated/p1-storage-order.ts <replica-db>
 *
 * The REAL hq-api runs against the replica. The edge emulator refuses every URL that is not the replica and
 * RECORDS it, so a storage write the gateway attempts shows up as a recorded `/storage/v1/object/files/...` URL.
 * That makes "zero storage writes" a measured count and not an inference. Every refusal has its positive control
 * (the same call against a target the caller is entitled to DOES reach storage, at the canonical path), because a
 * suite of refusals passes against a gateway that refuses everything.
 *
 * SABOTAGE (docs/multi-user/P1-CLOSURE.md): make hq-api skip uploadTarget() and the mismatch / missing / foreign
 * groups go red.
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: { what: string; ok: boolean }[] = []
const check = (what: string, ok: boolean, detail: string) => {
  results.push({ what, ok })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what} - ${detail}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const TOKEN = 'isolated-hq-token'
const S_GRANT = `aaa.bbb.${'g'.repeat(70)}`
const S_HARNESS = `aaa.bbb.${'h'.repeat(70)}`
const S_STRANGER = `aaa.bbb.${'x'.repeat(70)}`
const ZERO = '00000000-0000-4000-8000-000000000000'
// A 1x1 png, as the page would send it.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const member = async (owner: string) =>
  String(
    (await one(`select email from public.office_members where owner_key = ${lit(owner)}`)).email,
  )

const makeProject = async (label: string, fixture: boolean): Promise<string> => {
  const name = fixture ? `fixture-p1storage-${label}-${run}` : `P1 storage ${label} ${run}`
  return String(
    json(
      (
        await one(
          `select app.hq_create_project(${lit(name)}, 'upload', ${lit(`p1storage-${label}-${run}`)}, ${lit(name)}, true) as v`,
        )
      ).v,
    ).project_id,
  )
}
const makeContact = async (project: string, name: string): Promise<string> =>
  String(
    (
      await one(
        `insert into public.contacts (project_id, name) values (${lit(project)}::uuid, ${lit(name)}) returning contact_id::text as id`,
      )
    ).id,
  )

let exit = 1
try {
  const realA = await makeProject('a', false)
  const realB = await makeProject('b', false)
  const fixture = await makeProject('fixture', true)
  const contactA = await makeContact(realA, `A ${run}`)
  const contactB = await makeContact(realB, `B ${run}`)
  const contactF = await makeContact(fixture, `F ${run}`)

  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: {
      HQ_API_TOKEN: TOKEN,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
      SUPABASE_ANON_KEY: 'isolated-anon',
      SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid',
    },
    authUsers: {
      [S_GRANT]: await member('grant'),
      [S_HARNESS]: await member('verify-operator'),
      [S_STRANGER]: 'not.a.member@example.com',
    },
  })

  type Out = { status: number; body: Record<string, unknown>; writes: string[] }
  /** One call; `writes` are the storage URLs the gateway tried to reach DURING it. */
  const act = async (
    bearer: string,
    action: string,
    args: Record<string, unknown>,
  ): Promise<Out> => {
    const before = gw.storageWrites.length
    let status = 0
    let body: Record<string, unknown> = {}
    try {
      const r = await gw.call(
        new Request('https://gw.invalid/functions/v1/hq-api', {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, args }),
        }),
      )
      status = r.status
      body = (await r.json().catch(() => ({}))) as Record<string, unknown>
    } catch {
      status = 0
    }
    // Storage is recorded by the emulator, never forwarded: a write the gateway attempted is a row here.
    return {
      status,
      body,
      writes: gw.storageWrites.slice(before).map((w) => w.path),
    }
  }
  const photo = (project: string, contact: string, b64 = PNG) => ({
    p_project_id: project,
    p_contact_id: contact,
    p_mime: 'image/png',
    p_base64: b64,
  })
  const upload = (project: string) => ({
    p_project_id: project,
    p_name: 'note.txt',
    p_mime: 'text/plain',
    p_base64: btoa('hello'),
  })
  const reached = (o: Out, path: string) =>
    o.writes.some((u) => u.includes(`/object/files/${path}`))

  // ---- contact_photo ---------------------------------------------------------------------------------------
  const own = await act(S_GRANT, 'contact_photo', photo(realA, contactA))
  check(
    "POSITIVE CONTROL: a person's own contact photo reaches storage, at the canonical path",
    reached(own, `${realA}/contacts/${contactA}.png`),
    `${String(own.writes.length)} write(s)`,
  )

  const mismatch = await act(S_GRANT, 'contact_photo', photo(realB, contactA))
  const missingContact = await act(S_GRANT, 'contact_photo', photo(realA, ZERO))
  const missingProject = await act(S_GRANT, 'contact_photo', photo(ZERO, contactA))
  const refusal = (o: Out) =>
    o.status === 404 && o.body.error === 'no such contact' && o.writes.length === 0
  check(
    'a contact named under ANOTHER project is refused with zero storage writes',
    refusal(mismatch),
    `http ${String(mismatch.status)}, ${String(mismatch.writes.length)} write(s)`,
  )
  check(
    'a contact that does not exist is refused with zero storage writes',
    refusal(missingContact),
    `http ${String(missingContact.status)}, ${String(missingContact.writes.length)} write(s)`,
  )
  check(
    'a project that does not exist is refused with zero storage writes',
    refusal(missingProject),
    `http ${String(missingProject.status)}, ${String(missingProject.writes.length)} write(s)`,
  )
  check(
    'and the three refusals are the SAME answer (no existence oracle: foreign, mismatched and missing look alike)',
    JSON.stringify(mismatch.body) === JSON.stringify(missingContact.body) &&
      JSON.stringify(missingContact.body) === JSON.stringify(missingProject.body),
    JSON.stringify(mismatch.body),
  )

  const removeMismatch = await act(S_GRANT, 'contact_photo', photo(realB, contactA, ''))
  check(
    'removing a photo through a mismatched project is refused too (before any database write)',
    refusal(removeMismatch),
    `http ${String(removeMismatch.status)}`,
  )

  const hReal = await act(S_HARNESS, 'contact_photo', photo(realA, contactA))
  const hFixture = await act(S_HARNESS, 'contact_photo', photo(fixture, contactF))
  check(
    'a TEST member is refused on a REAL contact, with zero storage writes, in the same words as a missing one',
    refusal(hReal) && JSON.stringify(hReal.body) === JSON.stringify(mismatch.body),
    `http ${String(hReal.status)}`,
  )
  check(
    "POSITIVE CONTROL: the same test member reaches storage for a TEST project's contact",
    reached(hFixture, `${fixture}/contacts/${contactF}.png`),
    `${String(hFixture.writes.length)} write(s)`,
  )

  const mKey = await act(TOKEN, 'contact_photo', photo(realA, contactA))
  const mBad = await act(TOKEN, 'contact_photo', photo(realB, contactA))
  check(
    'the machine key (a service, no principal) is still served for a valid target...',
    reached(mKey, `${realA}/contacts/${contactA}.png`),
    `${String(mKey.writes.length)} write(s)`,
  )
  check('...and refused for a mismatched one', refusal(mBad), `http ${String(mBad.status)}`)

  const stranger = await act(S_STRANGER, 'contact_photo', photo(realA, contactA))
  check(
    'an unauthenticated stranger is refused (401) with zero storage writes',
    stranger.status === 401 && stranger.writes.length === 0,
    `http ${String(stranger.status)}`,
  )

  const stillOurs = (
    await one(`select photo_path from public.contacts where contact_id = ${lit(contactB)}::uuid`)
  ).photo_path
  check(
    "no refused call attached a path to the other project's contact",
    stillOurs === null,
    String(stillOurs),
  )

  // ---- document_upload -------------------------------------------------------------------------------------
  const up = await act(S_GRANT, 'document_upload', upload(realA))
  check(
    "POSITIVE CONTROL: a person's upload to their own project reaches storage under that project's prefix",
    up.writes.some((u) => u.includes(`/object/files/${realA}/upload/`)),
    `${String(up.writes.length)} write(s)`,
  )
  const upMissing = await act(S_GRANT, 'document_upload', upload(ZERO))
  check(
    'an upload to a project that does not exist is refused with zero storage writes',
    upMissing.status === 404 && upMissing.writes.length === 0,
    `http ${String(upMissing.status)}: ${String(upMissing.body.error)}`,
  )
  const upH = await act(S_HARNESS, 'document_upload', upload(realA))
  check(
    "a TEST member's upload to a REAL project is refused with zero storage writes",
    upH.status === 403 && upH.writes.length === 0,
    `http ${String(upH.status)}`,
  )
  const upHF = await act(S_HARNESS, 'document_upload', upload(fixture))
  check(
    'POSITIVE CONTROL: the same test member reaches storage for a TEST project',
    upHF.writes.some((u) => u.includes(`/object/files/${fixture}/upload/`)),
    `${String(upHF.writes.length)} write(s)`,
  )
  const upStranger = await act(S_STRANGER, 'document_upload', upload(realA))
  check(
    'an unauthenticated stranger is refused (401) with zero storage writes',
    upStranger.status === 401 && upStranger.writes.length === 0,
    `http ${String(upStranger.status)}`,
  )
  const upMachine = await act(TOKEN, 'document_upload', upload(realA))
  check(
    'the machine key cannot upload at all (not on its list), and writes nothing',
    upMachine.status === 403 && upMachine.writes.length === 0,
    `http ${String(upMachine.status)}`,
  )
} finally {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
  exit = failed === 0 ? 0 : 1
  await db.end()
}
process.exitCode = exit
