// biome-ignore-all lint/suspicious/noExplicitAny: gateway answers are untyped JSON
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * A project's own background picture, through the REAL hq-api against the isolated replica (#445, migration 1024).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/background-storage.ts [replica-db]
 *
 * Storage is not replicated: the edge emulator keeps the objects under `<office>/backgrounds/` in memory and refuses every URL
 * that is not the replica, so "no object was written" is a measured count. Everything runs inside one transaction that ends in
 * ROLLBACK. Each refusal has its positive control (the same call, entitled, DOES write), because a suite of refusals passes
 * against a gateway that refuses everything. The last group is a SABOTAGE: the office predicate is removed from the target check,
 * and the cross-tenant write must then succeed, which proves that predicate is what refused it.
 *
 *   1. own picture: stored under the office/project key, link and revision returned, read back by the section
 *   2. replace in place (same key), a different format replaces the old object, nothing is left behind
 *   3. another person's slug (write and read) is the same answer as a missing one; zero objects; client-supplied office ignored
 *   4. a Sample visitor and the machine key are refused; reading as a visitor shows nothing of anyone else's
 *   5. bad bodies refused with zero writes: not base64, empty, over 3 MB, SVG, HTML, a PDF, a lying header, oversize dimensions
 *   6. path-shaped slugs write nothing outside an office prefix
 *   7. twelve pictures per office; the thirteenth is refused, replacing one is not
 *   8. remove; a deleted project's picture is swept on the next write; a person's objects survive another's sweep
 *   9. SABOTAGE: with the office predicate removed from hq_upload_target, check 3 turns red
 */
import { startEdge } from './edge-emulator.ts'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const run = Date.now().toString(36)
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any

const TOKEN = 'isolated-hq-token'
const S_A = `aaa.bbb.${'a'.repeat(70)}`
const S_B = `aaa.bbb.${'b'.repeat(70)}`
const S_GUEST = `aaa.bbb.${'z'.repeat(70)}`
const A_EMAIL = `bg-a-${run}@example.com`
const B_EMAIL = `bg-b-${run}@example.com`
const G_EMAIL = `bg-g-${run}@example.com`

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
/** A PNG header that claims w x h pixels, padded to `len` bytes. Enough for the gateway, which reads only the header. */
const png = (w: number, h: number, len = 64): Uint8Array => {
  const b = new Uint8Array(Math.max(len, 33))
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
/** A JPEG with a start-of-frame segment claiming w x h pixels. */
const jpg = (w: number, h: number): Uint8Array => {
  const b = new Uint8Array(40)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3])
  return b
}
const text = (s: string) => new TextEncoder().encode(s.padEnd(64, ' '))

let exit = 1
try {
  await db.execute('begin')
  await db.execute(`update public.offices set state = 'disabled', disabled_at = now() where kind = 'sample' and state = 'active'`)
  for (const e of [A_EMAIL, B_EMAIL, G_EMAIL]) await db.execute(`insert into auth.users (id, email) values (gen_random_uuid(), ${lit(e)})`)
  const officeA = String(json((await one(`select app.provision_person_office('Person A', ${lit(A_EMAIL)}, ${lit(`bga-${run}`)}) as r`)).r).office_id)
  const officeB = String(json((await one(`select app.provision_person_office('Person B', ${lit(B_EMAIL)}, ${lit(`bgb-${run}`)}) as r`)).r).office_id)
  const sampleOffice = String(json((await one(`select app.provision_sample_office('Sample Office', ${lit(G_EMAIL)}, ${lit(`bgg-${run}`)}) as r`)).r).office_id)
  // Sealing the office is what makes its member a visitor (kind guest): an open sample is still being seeded by its owner.
  await one(`select app.sample_office_open(${lit(sampleOffice)}::uuid, false) as r`)

  const mkProject = async (office: string, name: string): Promise<{ id: string; slug: string }> => {
    const r = json((await one(`select app.hq_create_project(${lit(office)}::uuid, ${lit(name)}, 'upload', ${lit(`bg-${run}-${name.toLowerCase().replace(/\W+/g, '-')}`)}, ${lit(name)}, true) as v`)).v)
    const id = String(r.project_id)
    return { id, slug: String((await one(`select slug from public.projects where project_id = ${lit(id)}::uuid`)).slug) }
  }
  const pa = await mkProject(officeA, `Alpha ${run}`)
  const pb = await mkProject(officeB, `Bravo ${run}`)

  const gw = await startEdge({
    db,
    edgeFile: 'supabase/functions/hq-api/index.ts',
    env: { HQ_API_TOKEN: TOKEN, SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key', SUPABASE_ANON_KEY: 'isolated-anon', SIGNIN_ALLOWED_ORIGIN: 'https://page.invalid' },
    authUsers: { [S_A]: A_EMAIL, [S_B]: B_EMAIL, [S_GUEST]: G_EMAIL },
  })
  type Out = { status: number; body: any; writes: string[] }
  const call = async (bearer: string, req: { action?: string; args?: Record<string, unknown>; section?: string; query?: string }): Promise<Out> => {
    const before = gw.storageWrites.length
    let status = 0
    let body: any = {}
    try {
      const r = req.section !== undefined
        ? await gw.call(new Request(`https://gw.invalid/functions/v1/hq-api?section=${req.section}&${req.query ?? ''}`, { headers: { Authorization: `Bearer ${bearer}` } }))
        : await gw.call(new Request('https://gw.invalid/functions/v1/hq-api', { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: req.action, args: req.args }) }))
      status = r.status
      body = await r.json().catch(() => ({}))
    } catch {
      status = 0
    }
    return { status, body, writes: gw.storageWrites.slice(before).map((w) => `${w.method} ${w.path}`) }
  }
  const put = (bearer: string, slug: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) => call(bearer, { action: 'project_background_put', args: { p_slug: slug, p_base64: b64(bytes), ...extra } })
  const del = (bearer: string, slug: string) => call(bearer, { action: 'project_background_delete', args: { p_slug: slug } })
  const read = (bearer: string, slug: string) => call(bearer, { section: 'project_background', query: `slug=${encodeURIComponent(slug)}` })
  const keysOf = (office: string) => [...gw.objects.keys()].filter((k) => k.startsWith(`${office}/backgrounds/`))
  const wrote = (o: Out) => o.writes.some((w) => w.startsWith('POST /storage/v1/object/files/') && w.includes('/backgrounds/'))

  /* 1. own picture */
  const own = await put(S_A, pa.slug, png(1600, 900, 4000))
  check('POSITIVE CONTROL: a person stores a picture for their own project, under <office>/backgrounds/<project>.png', own.status === 200 && own.body.result?.ok === true && gw.objects.has(`${officeA}/backgrounds/${pa.id}.png`), `http ${own.status} ${JSON.stringify(own.body).slice(0, 160)}`)
  check('the answer carries a revision, the size read from the header, and a signed link', typeof own.body.result?.rev === 'string' && own.body.result.w === 1600 && own.body.result.h === 900 && String(own.body.result.url).includes('token='), String(own.body.result?.rev))
  const got = await read(S_A, pa.slug)
  check('the section returns the same revision and a link', got.body.data?.rev === own.body.result?.rev && typeof got.body.data?.url === 'string', JSON.stringify(got.body).slice(0, 140))

  /* 2. replace */
  await new Promise((r) => setTimeout(r, 5))
  const again = await put(S_A, pa.slug, png(1200, 800, 3000))
  check('replacing the picture keeps one object and changes the revision', keysOf(officeA).length === 1 && again.body.result?.rev !== own.body.result?.rev, `${keysOf(officeA).length} object(s)`)
  const asJpeg = await put(S_A, pa.slug, jpg(800, 600))
  check('a different format replaces the old object (no png left behind), jpg now', asJpeg.body.result?.ok === true && JSON.stringify(keysOf(officeA)) === JSON.stringify([`${officeA}/backgrounds/${pa.id}.jpg`]), JSON.stringify(keysOf(officeA)))

  /* 3. another person */
  const before = gw.objects.size
  const xw = await put(S_B, pa.slug, png(100, 100))
  const missingW = await put(S_B, `no-such-project-${run}`, png(100, 100))
  check("another person's slug is refused on write with ZERO storage writes, in the same words as a missing project", xw.status === 404 && !wrote(xw) && gw.objects.size === before && JSON.stringify(xw.body) === JSON.stringify(missingW.body), `http ${xw.status} ${JSON.stringify(xw.body)}`)
  const xr = await read(S_B, pa.slug)
  const missingR = await read(S_B, `no-such-project-${run}`)
  check("another person's slug reads as nothing, identical to a missing project (no existence oracle)", xr.status === 200 && xr.body.data === null && JSON.stringify(xr.body) === JSON.stringify(missingR.body), JSON.stringify(xr.body))
  check('and nothing in the answer to the refused read names a link or a key', !JSON.stringify(xr.body).includes(officeA) && !JSON.stringify(xr.body).includes(pa.id))
  const spoof = await put(S_B, pb.slug, png(300, 300), { p_office: officeA, office_id: officeA, owner_key: 'grant', p_project_id: pa.id })
  check('a client-supplied office, owner or project id is ignored: the picture lands under the verified office and the resolved project', spoof.body.result?.ok === true && gw.objects.has(`${officeB}/backgrounds/${pb.id}.png`) && keysOf(officeA).length === 1, JSON.stringify(keysOf(officeB)))
  const bOwn = await read(S_B, pb.slug)
  check('and each person reads only their own', bOwn.body.data?.url?.includes(officeB) === true && !String(got.body.data?.url).includes(officeB) && String(got.body.data?.url).includes(officeA))

  /* 4. visitor and machine key */
  const g = await put(S_GUEST, pa.slug, png(100, 100))
  check('a Sample visitor is refused, with a sentence, and nothing is written', g.status === 403 && g.body.error === 'sample_readonly' && g.writes.length === 0, `http ${g.status} ${g.body.error}`)
  const gr = await read(S_GUEST, pa.slug)
  check("a visitor reading another office's project gets nothing", gr.body.data === null, JSON.stringify(gr.body))
  const m = await put(TOKEN, pa.slug, png(100, 100))
  check('the machine key is not a person and is refused', m.status === 403 && m.body.error === 'person_required' && m.writes.length === 0, `http ${m.status} ${m.body.error}`)

  /* 5. bad bodies */
  const slugB = (await mkProject(officeB, `Charlie ${run}`)).slug
  const bad: [string, Uint8Array | string][] = [
    ['not base64', '%%%not-base64%%%'],
    ['empty', new Uint8Array(0)],
    ['over 3 MB', png(100, 100, 3 * 1024 * 1024 + 1)],
    ['an SVG', text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['an XML SVG with a prolog', text('<?xml version="1.0"?><svg/>')],
    ['HTML renamed .png', text('<html><body><script>alert(1)</script></body></html>')],
    ['a PDF', text('%PDF-1.7 not a picture')],
    ['plain text', text('hello world, I am not an image at all')],
    ['a PNG header claiming 70000 x 70000', png(70000, 70000)],
    ['a PNG header claiming 4096 x 4096 (over 16 MP)', png(4096, 4096)],
    ['a PNG header claiming 5000 x 10', png(5000, 10)],
    ['a PNG header claiming 0 x 0', png(0, 0)],
    ['a JPEG header claiming 9000 x 9000', jpg(9000, 9000)],
  ]
  for (const [what, body] of bad) {
    const o = typeof body === 'string' ? await call(S_B, { action: 'project_background_put', args: { p_slug: slugB, p_base64: body } }) : await put(S_B, slugB, body)
    // The empty body is refused by the required-argument check before the handler; both are refusals with no write.
    check(`${what}: refused with a sentence and no write`, o.status >= 400 && o.status < 500 && !wrote(o) && !keysOf(officeB).some((k) => k.includes('charlie')), `http ${o.status} ${String(o.body.error ?? '').slice(0, 80)}`)
  }
  const edge = await put(S_B, slugB, png(4096, 3906))
  check('POSITIVE CONTROL: a picture exactly at the limits (4096 x 3906 = under 16 MP) IS accepted', edge.body.result?.ok === true, JSON.stringify(edge.body).slice(0, 100))

  /* 6. path-shaped slugs */
  for (const s of ['../x', 'a/b', '..%2f..%2fetc', `${pa.slug}/../${pb.slug}`, '', ' ', 'x'.repeat(200)]) {
    const o = await put(S_B, s, png(100, 100))
    check(`slug ${JSON.stringify(s.slice(0, 24))} writes nothing`, !wrote(o), `http ${o.status}`)
  }
  check('every stored key begins with an office id and stays inside <office>/backgrounds/', [...gw.objects.keys()].every((k) => /^[0-9a-f-]{36}\/backgrounds\/[0-9a-f-]{36}\.(png|jpg|webp|avif)$/.test(k)), JSON.stringify([...gw.objects.keys()].map((k) => k.slice(37))).slice(0, 120))

  /* 7. quota */
  const ps: { id: string; slug: string }[] = []
  for (let i = 0; i < 12; i += 1) ps.push(await mkProject(officeA, `Quota ${String(i)} ${run}`))
  const have = keysOf(officeA).length
  let accepted = 0
  let refused: Out | null = null
  for (const p of ps) {
    const o = await put(S_A, p.slug, png(200, 200))
    if (o.body.result?.ok === true) accepted += 1
    else refused = o
  }
  check('an office keeps at most twelve pictures: the first fills the allowance, the rest are refused', keysOf(officeA).length === 12 && accepted === 12 - have && refused !== null && String(refused.body.error).includes('12'), `${accepted} accepted, ${keysOf(officeA).length} held, "${String(refused?.body?.error)}"`)
  const replaced = await put(S_A, pa.slug, png(300, 300))
  check('replacing one of the twelve is not a thirteenth', replaced.body.result?.ok === true && keysOf(officeA).length === 12)
  check("another office's allowance is separate", (await put(S_B, pb.slug, png(150, 150))).body.result?.ok === true)

  /* 8. remove, sweep */
  const d = await del(S_A, pa.slug)
  check('remove deletes the object, and the section then reads nothing', d.body.result?.ok === true && d.body.result.removed === 1 && !gw.objects.has(`${officeA}/backgrounds/${pa.id}.jpg`) && (await read(S_A, pa.slug)).body.data === null)
  check('removing again is harmless (removed 0)', (await del(S_A, pa.slug)).body.result?.removed === 0)
  const xd = await del(S_B, ps[0]?.slug ?? '')
  check("another person cannot remove somebody else's picture", xd.status === 404 && gw.objects.has(`${officeA}/backgrounds/${ps[0]?.id}.png`), `http ${xd.status}`)
  /* a project removed by the operator leaves its picture; the next write in that office sweeps it */
  const doomed = ps[1]
  await db.execute(`select app.project_delete(${lit(doomed?.slug ?? '')})`).catch(async () => {
    await db.execute(`delete from public.project_attachments where project_id = ${lit(doomed?.id ?? '')}::uuid`)
    await db.execute(`delete from public.projects where project_id = ${lit(doomed?.id ?? '')}::uuid`)
  })
  const stillThere = (await one(`select count(*)::int c from public.projects where project_id = ${lit(doomed?.id ?? '')}::uuid`)).c === 0
  check('(the project was deleted in the database)', stillThere)
  check('its picture is still in storage until something sweeps it', gw.objects.has(`${officeA}/backgrounds/${doomed?.id}.png`))
  const swept = await del(S_A, ps[2]?.slug ?? '')
  check("the next write in that office sweeps the deleted project's picture, and only that", swept.body.result?.ok === true && !gw.objects.has(`${officeA}/backgrounds/${doomed?.id}.png`) && gw.objects.has(`${officeA}/backgrounds/${ps[3]?.id}.png`) && keysOf(officeB).length >= 2)
  check("and a sweep in one office never touches another's pictures", keysOf(officeB).length >= 2)

  /* 9. sabotage: the office predicate removed from the target check */
  const def = String((await one(`select pg_get_functiondef('public.hq_upload_target(uuid,text,uuid,uuid,text,text)'::regprocedure) d`)).d)
  const broken = def.replace('where p.slug = p_slug and p.office_id = p_office;', 'where p.slug = p_slug;')
  check('(the sabotage applied: the project lookup no longer names the office)', broken !== def)
  await db.execute(broken)
  const sab = await put(S_B, pa.slug, png(100, 100))
  check("SABOTAGE: with the office predicate removed, another person's slug is accepted (check 3 would turn red)", sab.body.result?.ok === true && wrote(sab), `http ${sab.status}`)
  const sabRead = await read(S_B, pa.slug)
  check('SABOTAGE: and the cross-tenant READ then returns a link (the read check turns red as well)', typeof sabRead.body.data?.url === 'string', JSON.stringify(sabRead.body).slice(0, 100))

  check('the emulator refused no URL: nothing but the replica was reached', gw.refusedUrls.length === 0, JSON.stringify(gw.refusedUrls))
  exit = results.every(Boolean) ? 0 : 1
} finally {
  await db.execute('rollback').catch(() => undefined)
  await db.end().catch(() => undefined)
}
const bad = results.filter((r) => !r).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(exit)
