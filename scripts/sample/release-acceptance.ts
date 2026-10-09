// biome-ignore-all lint/suspicious/noExplicitAny: gateway answers are untyped JSON
// biome-ignore-all format: a dense acceptance script kept readable as written
/**
 * Production acceptance of the #442 / #445 release (migrations 1040, 1041; hq-api v898) through the DEPLOYED gateway.
 *
 *   ALLOW_PRODUCTION_CHECKS=1 ALLOW_PRODUCTION_WRITES=1 npx tsx scripts/sample/release-acceptance.ts
 *
 * Identities: the Sample Person (a real person office, never Grant's) through TWO independent password-grant sessions (two
 * devices), and an ordinary public-Sample visitor session minted by the real `signin` function. Everything is written into the
 * Sample Person's own project and removed again; nothing touches Grant's office. A cross-office attempt is made only BY the Sample
 * Person AGAINST the public Sample's project (never against Grant's), and every attempt has its positive control.
 */
import '../../src/safety/require-production-writes.ts'
import { act, read, REF, secondSession } from '../p4/lib.ts'
import { guardOffice } from './guard.ts'
import { rows, sampleOffice } from './lib.ts'

const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
void guardOffice
const office = await sampleOffice()
const gw: any = (r: { json: unknown }) => r.json ?? {}
const res = (r: { json: unknown }): any => (gw(r).result ?? {})
const data = (r: { json: unknown }): any => (gw(r).data ?? null)

const png = (w: number, h: number, len = 600): string => {
  const b = new Uint8Array(len)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return Buffer.from(b).toString('base64')
}
const text = (s: string) => Buffer.from(s.padEnd(64, ' ')).toString('base64')

// Two independent sessions of the Sample Person (two devices), and a public-Sample visitor.
const [s1, s2] = [await secondSession(), await secondSession()]
check('two independent sessions of the Sample Person were minted', s1.access_token !== s2.access_token)
const signin = await fetch(`https://${REF}.supabase.co/functions/v1/signin`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: 'https://ai-team-hq.vercel.app' }, body: JSON.stringify({ action: 'sample' }) })
const visitor = (await signin.json().catch(() => ({}))) as { access_token?: string; ok?: boolean }
check('a public-Sample visitor session was minted by the real signin function', typeof visitor.access_token === 'string', `http ${signin.status}`)
const V = visitor.access_token ?? ''

// The Sample Person's own project, and a project of the public Sample (for the cross-office attempts only).
const mine = data(await read(s1.access_token, 'studio')).projects as any[]
const slug = String(mine.find((p) => p.status !== 'archived')?.slug ?? mine[0]?.slug)
const theirs = (data(await read(V, 'studio'))?.projects ?? []) as any[]
const foreign = String(theirs[0]?.slug ?? '')
check('a Sample Person project and a public-Sample project were found, and they are different', slug !== '' && foreign !== '' && slug !== foreign, `${slug} / ${foreign}`)
const doc = (t: string) => [{ id: 'tasks', x: 1, y: 1, w: 400, h: 300, z: 1, tint: null }, { id: '__workspace', v: 2, hasMods: true, zoom: 1, pan: { x: 0, y: 0 }, postits: [{ id: `n_${t}`, text: t, x: 0, y: 0, w: 200, h: 120, z: 1, at: Date.now() }], gone: {} }]
const layoutOf = async (token: string, s = slug) => data(await read(token, 'layout', `&slug=${encodeURIComponent(s)}&surface=basecamp`))
let created = false
try {
  // ---- #442: revisioned saves ----
  const base = await layoutOf(s1.access_token)
  check('the layout section answers { panels, rev, now } for an authenticated person', base !== null && typeof base.rev === 'number' && typeof base.now === 'number', JSON.stringify(base)?.slice(0, 120))
  const legacy = res(await act(s1.access_token, 'dashboard_layout_set', { p_slug: slug, p_panels: doc('legacy'), p_surface: 'basecamp' }))
  created = true
  check('an earlier-style caller (no p_expected_rev) still saves, and the answer carries a revision', legacy.ok === true && typeof legacy.rev === 'number', JSON.stringify(legacy))
  const r0 = await layoutOf(s2.access_token)
  check('a second session reads the same arrangement and revision (per-person, per-project)', r0.rev === legacy.rev && r0.panels?.[1]?.postits?.[0]?.text === 'legacy')
  const w1 = res(await act(s1.access_token, 'dashboard_layout_set', { p_slug: slug, p_panels: doc('from-device-1'), p_surface: 'basecamp', p_expected_rev: r0.rev }))
  const w2 = res(await act(s2.access_token, 'dashboard_layout_set', { p_slug: slug, p_panels: doc('from-device-2'), p_surface: 'basecamp', p_expected_rev: r0.rev }))
  check('two sessions save from the same revision: the first is stored, the second is refused with the current copy and nothing is overwritten', w1.ok === true && w2.conflict === true && w2.panels?.[1]?.postits?.[0]?.text === 'from-device-1' && (await layoutOf(s1.access_token)).panels[1].postits[0].text === 'from-device-1', JSON.stringify({ w1: w1.ok, w2: w2.conflict }))
  const cur = await layoutOf(s1.access_token)
  const race = await Promise.all(Array.from({ length: 6 }, (_, i) => act((i % 2 === 0 ? s1 : s2).access_token, 'dashboard_layout_set', { p_slug: slug, p_panels: doc(`racer-${i}`), p_surface: 'basecamp', p_expected_rev: cur.rev })))
  const wins = race.filter((r) => res(r).ok === true).length
  check('six simultaneous saves from two sessions at one revision: exactly one wins, five are refused', wins === 1 && race.filter((r) => res(r).conflict === true).length === 5, `${wins} winner(s)`)
  const after = await layoutOf(s2.access_token)
  const stale = res(await act(s1.access_token, 'dashboard_layout_set', { p_slug: slug, p_panels: [], p_surface: 'basecamp', p_expected_rev: cur.rev }))
  check('a reset (empty layout) made from a stale revision is refused and the arrangement survives', stale.conflict === true && (await layoutOf(s1.access_token)).rev === after.rev)
  const v = await read(V, 'layout', `&slug=${encodeURIComponent(slug)}&surface=basecamp`)
  check("a public-Sample visitor cannot read the Sample Person's arrangement", data(v)?.panels === undefined || data(v) === null, JSON.stringify(gw(v)).slice(0, 120))
  const vw = await act(V, 'dashboard_layout_set', { p_slug: foreign, p_panels: doc('x'), p_surface: 'basecamp' })
  check('a visitor cannot save an arrangement (sample_readonly)', vw.status === 403 && gw(vw).error === 'sample_readonly', `http ${vw.status}`)
  const xr = await read(s1.access_token, 'layout', `&slug=${encodeURIComponent(foreign)}&surface=basecamp`)
  check("the Sample Person reading the public Sample's project gets no arrangement", data(xr)?.error !== undefined || data(xr)?.panels === null || data(xr) === null, JSON.stringify(gw(xr)).slice(0, 140))

  // ---- #445: backgrounds ----
  const A = res(await act(s1.access_token, 'project_background_put', { p_slug: slug, p_base64: png(1600, 900) }))
  check('device 1 stores a valid picture: ok, a revision, a signed link', A.ok === true && typeof A.rev === 'string' && String(A.url).includes('/object/sign/files/') && String(A.url).includes(office.officeId), JSON.stringify({ ...A, url: String(A.url).slice(0, 70) }))
  const f1 = await fetch(String(A.url))
  const bytes1 = Buffer.from(await f1.arrayBuffer())
  check('the signed link serves the picture (200, image/png, the stored size)', f1.status === 200 && /image\/png/.test(f1.headers.get('content-type') ?? '') && bytes1.length === 600, `http ${f1.status} ${bytes1.length} bytes`)
  const B = data(await read(s2.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  const f2 = await fetch(String(B?.url))
  check('device 2 (an independent session) is told about it and can fetch the same picture', B?.rev === A.rev && f2.status === 200 && Buffer.from(await f2.arrayBuffer()).equals(bytes1), `rev ${B?.rev}`)
  const jwt = (u: string) => JSON.parse(Buffer.from(String(new URL(u).searchParams.get('token')).split('.')[1] ?? '', 'base64url').toString())
  const exp1 = jwt(String(A.url)).exp
  await new Promise((r) => setTimeout(r, 1100))
  const B2 = data(await read(s2.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  const exp2 = jwt(String(B2.url)).exp
  check('a signed link lasts about an hour, and asking again renews it (a later expiry, the same revision)', exp1 - Math.floor(Date.now() / 1000) > 3000 && exp1 - Math.floor(Date.now() / 1000) <= 3700 && exp2 > exp1 && B2.rev === A.rev, `expires in ${exp1 - Math.floor(Date.now() / 1000)} s; renewed +${exp2 - exp1} s`)
  const Vr = data(await read(V, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  check("a public-Sample visitor naming the Sample Person's project gets nothing (no link)", Vr === null, JSON.stringify(Vr))
  const Xr = data(await read(s1.access_token, 'project_background', `&slug=${encodeURIComponent(foreign)}`))
  check("the Sample Person naming the public Sample's project gets nothing (no link)", Xr === null, JSON.stringify(Xr))
  const missing = data(await read(s1.access_token, 'project_background', `&slug=no-such-project-${Date.now()}`))
  check('and a missing project answers the same as a foreign one (no existence oracle)', JSON.stringify(missing) === JSON.stringify(Xr))
  const Vp = await act(V, 'project_background_put', { p_slug: foreign, p_base64: png(100, 100) })
  check('a visitor cannot upload (403 sample_readonly)', Vp.status === 403 && gw(Vp).error === 'sample_readonly', `http ${Vp.status}`)
  const Xp = await act(s1.access_token, 'project_background_put', { p_slug: foreign, p_base64: png(100, 100) })
  check("the Sample Person cannot upload to the public Sample's project (404, same words as a missing project)", Xp.status === 404 && gw(Xp).error === 'no such dashboard project', `http ${Xp.status} ${JSON.stringify(gw(Xp))}`)
  const Mp = await act(s1.access_token, 'project_background_put', { p_slug: `no-such-project-${Date.now()}`, p_base64: png(100, 100) })
  check('...which equals the answer for a project that does not exist', Mp.status === 404 && JSON.stringify(gw(Mp)) === JSON.stringify(gw(Xp)))
  const bad: [string, string][] = [['an SVG', text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], ['HTML named as an image', text('<html><body>x</body></html>')], ['a 70000 x 70000 header', png(70000, 70000)], ['a 4096 x 4096 header (over 16 MP)', png(4096, 4096)], ['not base64', '%%%nope%%%'], ['plain text', text('hello, not an image at all')]]
  for (const [what, body] of bad) {
    const o = await act(s1.access_token, 'project_background_put', { p_slug: slug, p_base64: body })
    check(`${what} is rejected with a sentence`, o.status === 400 && typeof gw(o).error === 'string', `http ${o.status} ${String(gw(o).error).slice(0, 70)}`)
  }
  const still = data(await read(s1.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  check('and none of the rejected bodies replaced the stored picture', still?.rev === A.rev)
  await new Promise((r) => setTimeout(r, 1100))
  const C = res(await act(s2.access_token, 'project_background_put', { p_slug: slug, p_base64: png(1200, 700, 900) }))
  const afterC = data(await read(s1.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  check('device 2 replaces the picture: a new revision, one object, device 1 sees it', C.ok === true && C.rev !== A.rev && afterC?.rev === C.rev && afterC?.bytes === 900, `${A.rev} -> ${C.rev}`)
  const D = res(await act(s1.access_token, 'project_background_delete', { p_slug: slug }))
  const gone = data(await read(s2.access_token, 'project_background', `&slug=${encodeURIComponent(slug)}`))
  check('removing the picture clears it for every session', D.ok === true && D.removed === 1 && gone === null, JSON.stringify(D))
  check('the old link no longer serves the removed picture', (await fetch(String(A.url))).status >= 400)
  const D2 = res(await act(s1.access_token, 'project_background_delete', { p_slug: slug }))
  check('removing twice is harmless', D2.ok === true && D2.removed === 0)

  // ---- compatibility: the five-argument upload-target call the unchanged paths make ----
  const pid = String((await rows(`select project_id::text p from public.projects where slug = '${slug.replace(/'/g, "''")}' and office_id = '${office.officeId}'::uuid`))[0]?.p)
  const t5 = (await rows(`select public.hq_upload_target('${office.officeId}'::uuid, 'document_upload', '${pid}'::uuid, null, null) r`))[0]?.r as any
  check('the earlier five-argument form of hq_upload_target (document uploads, contact photos) still resolves and answers', t5?.ok === true && t5?.project_id === pid, JSON.stringify(t5))
} finally {
  const cleaned = res(await act(s1.access_token, 'dashboard_layout_reset', { p_slug: slug, p_surface: 'basecamp' }))
  await act(s1.access_token, 'project_background_delete', { p_slug: slug })
  const left = await layoutOf(s1.access_token)
  check('cleanup: the Sample Person project has no arrangement and no picture left', created === false || (cleaned.ok === true && left.panels === null))
}
const bad = results.filter((r) => !r).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad === 0 ? 0 : 1)
