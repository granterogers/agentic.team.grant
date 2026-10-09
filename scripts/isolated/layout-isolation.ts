/**
 * Team HQ's saved arrangement (the `__workspace` document in `public.dashboard_layouts`) is private to a person and a
 * project, on the isolated replica only (ADR-0068, #439, P0 persistence).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/layout-isolation.ts
 *
 * An office holds one person, so "per user" is "per office". What is proved, with a positive control beside every refusal:
 *   1. each of two people keeps their own arrangement of their own project;
 *   2. one person cannot read, overwrite or reset the other's by naming the other's project;
 *   3. a person's two surfaces (the older studio and Team HQ) are separate rows;
 *   4. an arrangement is stored per project, so switching projects keeps both;
 *   5. an empty arrangement is a reset and never a stored value;
 *   6. SABOTAGE: with the office check removed from a copy of the writer, check 2 turns red.
 * Everything runs inside one transaction that is rolled back.
 */
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (sql: string) => (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>

const doc = (note: string) =>
  JSON.stringify([
    { id: 'tasks', x: 10, y: 10, w: 400, h: 300, z: 1, tint: null },
    {
      id: '__workspace',
      v: 2,
      hasMods: true,
      zoom: 1.5,
      pan: { x: 40, y: 60 },
      postits: [{ id: 'n_1', text: note }],
    },
  ])

await q('begin')
try {
  const mkOffice = async (name: string): Promise<string> => {
    const auth = String((await q('select gen_random_uuid()::text a'))[0]?.a)
    await q(
      `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`,
    )
    await q(
      `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`,
    )
    return String(
      (await q(`select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`))[0]
        ?.o,
    )
  }
  const project = async (office: string, slug: string): Promise<void> => {
    await q(
      `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'active', ${lit(office)}::uuid)`,
    )
  }
  const A = await mkOffice('alice')
  const B = await mkOffice('bob')
  const SA = `layout-a-${run}`
  const SA2 = `layout-a2-${run}`
  const SB = `layout-b-${run}`
  await project(A, SA)
  await project(A, SA2)
  await project(B, SB)
  const set = async (office: string, slug: string, panels: string, surface = 'basecamp') =>
    json(
      (
        await q(
          `select app.hq_dashboard_layout_set(${lit(office)}::uuid, ${lit(slug)}, ${lit(panels)}::jsonb, ${lit(surface)}) r`,
        )
      )[0]?.r,
    )
  const reset = async (office: string, slug: string, surface = 'basecamp') =>
    json(
      (
        await q(
          `select app.hq_dashboard_layout_reset(${lit(office)}::uuid, ${lit(slug)}, ${lit(surface)}) r`,
        )
      )[0]?.r,
    )
  const stored = async (slug: string, surface = 'basecamp') =>
    (
      await q(
        `select l.owner, l.panels::text p from public.dashboard_layouts l join public.projects pr on pr.project_id = l.project_id where pr.slug = ${lit(slug)} and l.surface = ${lit(surface)}`,
      )
    )[0]

  // 1. each person keeps their own
  check('Alice saves her arrangement', (await set(A, SA, doc('alice note'))).ok === true)
  check('Bob saves his arrangement', (await set(B, SB, doc('bob note'))).ok === true)
  const a1 = await stored(SA)
  const b1 = await stored(SB)
  check(
    'each is stored under its own person',
    a1?.owner !== undefined && b1?.owner !== undefined && a1.owner !== b1.owner,
    `${String(a1?.owner)} / ${String(b1?.owner)}`,
  )
  check(
    'Alice reads back only her own note',
    String(a1?.p).includes('alice note') && !String(a1?.p).includes('bob note'),
  )

  // 2. nobody reaches across by naming the other's project
  const cross = await set(B, SA, doc('BOB OVERWRITES ALICE'))
  check(
    'Bob cannot save over Alice by naming her project',
    typeof cross.error === 'string' && String(cross.error).includes('no project called'),
    JSON.stringify(cross),
  )
  const a2 = await stored(SA)
  check(
    "Alice's arrangement is unchanged after that attempt",
    a2?.p === a1?.p && !String(a2?.p).includes('BOB'),
  )
  const crossReset = await reset(B, SA)
  check(
    'Bob cannot reset Alice by naming her project',
    typeof crossReset.error === 'string' && String(crossReset.error).includes('no project called'),
    JSON.stringify(crossReset),
  )
  check("and Alice's row is still there", (await stored(SA)) !== undefined)

  // 3. two surfaces are two rows
  check(
    'Alice saves a studio arrangement of the same project',
    (await set(A, SA, doc('studio copy'), 'studio')).ok === true,
  )
  check(
    'the Team HQ copy is untouched by it',
    String((await stored(SA, 'basecamp'))?.p).includes('alice note'),
  )
  check(
    'the studio copy is its own row',
    String((await stored(SA, 'studio'))?.p).includes('studio copy'),
  )

  // 4. per project
  check(
    'Alice arranges a second project differently',
    (await set(A, SA2, doc('second project'))).ok === true,
  )
  check(
    'the first project keeps its own arrangement',
    String((await stored(SA))?.p).includes('alice note') &&
      !String((await stored(SA))?.p).includes('second project'),
  )

  // 5. empty is a reset
  const emptied = await set(A, SA2, '[]')
  check(
    'saving an empty arrangement is a reset, not a stored value',
    emptied.reset === true && (await stored(SA2)) === undefined,
    JSON.stringify(emptied),
  )

  // 6. sabotage: the same writer without the office check lets Bob in
  const def = String(
    (
      await q(
        `select pg_get_functiondef('app.hq_dashboard_layout_set(uuid,text,jsonb,text,bigint)'::regprocedure) d`,
      )
    )[0]?.d,
  )
  const needle = 'where slug = p_slug and office_id = p_office'
  const hurt = def
    .replace('app.hq_dashboard_layout_set(', 'app.hq_dashboard_layout_set_sabotaged(')
    .replace(needle, 'where slug = p_slug')
  check(
    'the sabotage applied',
    hurt !== def && hurt.includes('set_sabotaged') && !hurt.includes(needle),
  )
  await q(hurt)
  const overwritten = json(
    (
      await q(
        `select app.hq_dashboard_layout_set_sabotaged(${lit(B)}::uuid, ${lit(SA)}, ${lit(doc('BOB OVERWRITES ALICE'))}::jsonb, 'basecamp') r`,
      )
    )[0]?.r,
  )
  check(
    'with the office check removed, the writer accepts Bob over Alice (so check 2 can fail)',
    overwritten.error === undefined && overwritten.ok === true,
    JSON.stringify(overwritten),
  )
} finally {
  await q('rollback')
}
await db.end()
const failed = results.filter((r) => !r).length
console.log(`\n${String(results.length - failed)}/${String(results.length)} passed`)
process.exit(failed === 0 ? 0 : 1)
