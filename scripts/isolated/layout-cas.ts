// biome-ignore-all lint/suspicious/noExplicitAny: SQL results are untyped rows
// biome-ignore-all format: a dense proof script kept readable as written
/**
 * Compare-and-swap on a project's saved arrangement, on the isolated replica only (#442, migration 1023).
 *
 *   bash scripts/isolated/replica.sh && npx tsx scripts/isolated/layout-cas.ts
 *
 * Unlike layout-isolation.ts this commits, because concurrency needs several real connections. Everything it makes is named
 * for the run and removed at the end. What is proved, each with a positive control beside the refusal:
 *   1. the old four-argument call still works (last writer wins) and every write moves the revision;
 *   2. a save naming the current revision is stored; one naming a stale revision stores NOTHING and returns the current copy;
 *   3. a first save (revision 0) wins once; a second first save is refused;
 *   4. ABA: after a reset and a new save, the revision an old device remembers matches nothing;
 *   5. a write by any other path (an undo, a later function) also moves the revision;
 *   6. twelve connections save the same revision at the same instant: exactly one wins, the rest are refused, the winner's copy is stored;
 *   7. twelve connections each add a different note by read, merge, compare-and-swap, retry (bounded): all twelve notes survive,
 *      and the number of attempts is bounded;
 *   8. a person cannot reach another person's arrangement, and the revisions of two surfaces and two projects are independent;
 *   9. an empty layout is still a reset, and is itself compare-and-swap;
 *  10. SABOTAGE: a copy of the writer with the comparison removed lets several of the twelve win, and check 6 turns red.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { isolated } from './guard.ts'

const DB = process.argv[2] ?? 'post'
const main = await isolated(DB)
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const run = Date.now().toString(36)
const results: boolean[] = []
const check = (what: string, ok: boolean, detail = ''): void => {
  results.push(ok)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : ` - ${detail}`}`)
}
const q = async (db: PgExecutor, sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]
const json = (v: unknown): any => (typeof v === 'string' ? JSON.parse(v) : v)

const doc = (notes: { id: string; text: string; at: number }[], gone: Record<string, number> = {}): string =>
  JSON.stringify([
    { id: 'tasks', x: 10, y: 10, w: 400, h: 300, z: 1, tint: null },
    { id: '__workspace', v: 2, hasMods: true, zoom: 1, pan: { x: 0, y: 0 }, postits: notes, gone },
  ])
const notesOf = (panels: any[] | null): { id: string; text: string; at: number }[] =>
  (panels?.find((m) => m.id === '__workspace')?.postits ?? []) as { id: string; text: string; at: number }[]

const made: { office: string; auth: string }[] = []
const mkOffice = async (name: string): Promise<string> => {
  const auth = String((await q(main, 'select gen_random_uuid()::text a'))[0]?.a)
  await q(main, `insert into auth.users (id, email) values (${lit(auth)}, ${lit(`${name}.${run}@example.invalid`)})`)
  await q(main, `insert into public.offices (auth_user_id, kind, name) values (${lit(auth)}, 'person', ${lit(`${name} ${run}`)})`)
  const office = String((await q(main, `select office_id::text o from public.offices where auth_user_id = ${lit(auth)}`))[0]?.o)
  made.push({ office, auth })
  return office
}
const mkProject = async (office: string, slug: string): Promise<void> => {
  await q(main, `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'archived',${lit(office)}::uuid)`)
}
const set = async (db: PgExecutor, office: string, slug: string, panels: string, expected: number | string | null, surface = 'basecamp', fn = 'app.hq_dashboard_layout_set'): Promise<any> =>
  json((await q(db, expected === null
    ? `select ${fn}(${lit(office)}::uuid, ${lit(slug)}, ${lit(panels)}::jsonb, ${lit(surface)}) r`
    : `select ${fn}(${lit(office)}::uuid, ${lit(slug)}, ${lit(panels)}::jsonb, ${lit(surface)}, ${String(expected)}::bigint) r`))[0]?.r)
const get = async (db: PgExecutor, office: string, slug: string, surface = 'basecamp'): Promise<any> =>
  json((await q(db, `select app.hq_dashboard_layout_get(${lit(office)}::uuid, ${lit(slug)}, ${lit(surface)}) r`))[0]?.r)
const stored = async (office: string, slug: string, surface = 'basecamp'): Promise<{ panels: any[]; rev: number } | null> => {
  const r = (await q(main, `select l.panels, l.rev::text rev from public.dashboard_layouts l join public.projects p on p.project_id = l.project_id where p.slug = ${lit(slug)} and p.office_id = ${lit(office)}::uuid and l.surface = ${lit(surface)}`))[0]
  return r === undefined ? null : { panels: json(r.panels), rev: Number(r.rev) }
}

const N = 12
const pool: PgExecutor[] = []
try {
  for (let i = 0; i < N; i += 1) pool.push(await isolated(DB))
  const A = await mkOffice('alice')
  const B = await mkOffice('bob')
  const S1 = `cas-a1-${run}`
  const S2 = `cas-a2-${run}`
  const SB = `cas-b-${run}`
  await mkProject(A, S1)
  await mkProject(A, S2)
  await mkProject(B, SB)

  /* 1. the old call, and the revision moves */
  const w1 = await set(main, A, S1, doc([{ id: 'n_1', text: 'one', at: 1 }]), null)
  const w2 = await set(main, A, S1, doc([{ id: 'n_1', text: 'two', at: 2 }]), null)
  check('the four-argument call still stores (last writer wins) and returns a revision', w1.ok === true && w2.ok === true && Number(w2.rev) > Number(w1.rev), `${String(w1.rev)} -> ${String(w2.rev)}`)
  check('the reader returns the stored panels, their revision and the database clock', (await get(main, A, S1)).rev === w2.rev && notesOf((await get(main, A, S1)).panels)[0]?.text === 'two' && Number((await get(main, A, S1)).now) > 1.7e12)
  check('an arrangement that does not exist reads as revision 0 and no panels', (await get(main, A, S2)).rev === 0 && (await get(main, A, S2)).panels === null)

  /* 2. compare-and-swap */
  const ok1 = await set(main, A, S1, doc([{ id: 'n_1', text: 'three', at: 3 }]), w2.rev)
  check('a save naming the current revision is stored, with a new revision', ok1.ok === true && Number(ok1.rev) > Number(w2.rev))
  const stale = await set(main, A, S1, doc([{ id: 'n_1', text: 'STALE', at: 4 }]), w2.rev)
  const after = await stored(A, S1)
  check('a save naming a stale revision is refused with the current copy, and stores nothing', stale.conflict === true && Number(stale.rev) === Number(ok1.rev) && notesOf(stale.panels)[0]?.text === 'three' && notesOf(after?.panels ?? null)[0]?.text === 'three' && after?.rev === Number(ok1.rev))

  /* 3. first saves */
  const f1 = await set(main, A, S2, doc([{ id: 'n_a', text: 'first', at: 1 }]), 0)
  const f2 = await set(main, A, S2, doc([{ id: 'n_b', text: 'second first', at: 1 }]), 0)
  check('a first save (revision 0) wins once and the second first save is refused', f1.ok === true && f2.conflict === true && notesOf((await stored(A, S2))?.panels ?? null)[0]?.text === 'first')

  /* 4. ABA */
  const before = await get(main, A, S2)
  await set(main, A, S2, '[]', before.rev)
  const gone = await get(main, A, S2)
  const again = await set(main, A, S2, doc([{ id: 'n_c', text: 'after reset', at: 9 }]), 0)
  check('a reset removes the row (revision 0) and a new row gets a revision that has never been used', gone.rev === 0 && again.ok === true && Number(again.rev) > Number(before.rev))
  const old = await set(main, A, S2, doc([{ id: 'n_d', text: 'from an old device', at: 10 }]), before.rev)
  const zero = await set(main, A, S2, doc([{ id: 'n_e', text: 'from a device that saw nothing', at: 11 }]), 0)
  check('after reset and recreate, the revision an old device remembers matches nothing (no ABA), nor does 0', old.conflict === true && zero.conflict === true && notesOf((await stored(A, S2))?.panels ?? null)[0]?.text === 'after reset')

  /* 5. a write by any other path moves the revision */
  const cur = await stored(A, S1)
  await q(main, `update public.dashboard_layouts l set panels = l.panels from public.projects p where p.project_id = l.project_id and p.slug = ${lit(S1)} and p.office_id = ${lit(A)}::uuid and l.surface = 'basecamp'`)
  const moved = await stored(A, S1)
  const viaOld = await set(main, A, S1, doc([{ id: 'n_1', text: 'late', at: 5 }]), cur?.rev ?? -1)
  check('a direct write (as an undo makes) moves the revision, so a save made before it is refused', (moved?.rev ?? 0) > (cur?.rev ?? 0) && viaOld.conflict === true)

  /* 6. the same revision, twelve connections, one instant */
  const base = await get(main, A, S1)
  const race = async (fn: string): Promise<{ wins: number; refused: number; rows: number }> => {
    await Promise.all(pool.map((db) => q(db, 'select 1')))
    const out = await Promise.all(pool.map((db, i) => set(db, A, S1, doc([{ id: `n_r${String(i)}`, text: `racer ${String(i)}`, at: 100 + i }]), base.rev, 'basecamp', fn)))
    return { wins: out.filter((r) => r.ok === true).length, refused: out.filter((r) => r.conflict === true).length, rows: notesOf((await stored(A, S1))?.panels ?? null).length }
  }
  const real = await race('app.hq_dashboard_layout_set')
  check(`twelve connections save one revision at once: exactly one wins and eleven are refused`, real.wins === 1 && real.refused === N - 1 && real.rows === 1, JSON.stringify(real))

  /* 10. sabotage: the writer with its comparison removed */
  const def = String((await q(main, `select pg_get_functiondef('app.hq_dashboard_layout_set(uuid,text,jsonb,text,bigint)'::regprocedure) d`))[0]?.d)
  const broken = def.replace('app.hq_dashboard_layout_set', 'app.hq_dashboard_layout_set_sabotaged').replace('if v_rev <> p_expected_rev then', 'if false then')
  check('(the sabotage applied: the copy differs from the real writer)', broken !== def && broken.includes('if false then'))
  await q(main, `drop function if exists app.hq_dashboard_layout_set_sabotaged(uuid,text,jsonb,text,bigint)`)
  await q(main, broken)
  const reBase = await get(main, A, S1)
  await set(main, A, S1, doc([{ id: 'n_1', text: 'reset for the sabotage run', at: 200 }]), reBase.rev)
  const base2 = await get(main, A, S1)
  const outB = await Promise.all(pool.map((db, i) => set(db, A, S1, doc([{ id: `n_s${String(i)}`, text: 'x', at: 300 + i }]), base2.rev, 'basecamp', 'app.hq_dashboard_layout_set_sabotaged')))
  const winsB = outB.filter((r) => r.ok === true).length
  check('SABOTAGE: with the comparison removed, many of the twelve win (check 6 turns red)', winsB > 1, `${String(winsB)} winners`)
  await q(main, `drop function app.hq_dashboard_layout_set_sabotaged(uuid,text,jsonb,text,bigint)`)

  /* 7. read, merge, swap, retry: no note is lost */
  await set(main, A, S1, doc([{ id: 'n_base', text: 'base', at: 1 }]), (await get(main, A, S1)).rev)
  let attempts = 0
  let maxTries = 0
  await Promise.all(pool.map(async (db, i) => {
    for (let tries = 1; tries <= 40; tries += 1) {
      const cur2 = await get(db, A, S1)
      const mine = { id: `n_m${String(i)}`, text: `mine ${String(i)}`, at: 1000 + i }
      const notes = notesOf(cur2.panels).filter((n) => n.id !== mine.id).concat(mine)
      attempts += 1
      const r = await set(db, A, S1, doc(notes), cur2.rev)
      if (r.ok === true) { maxTries = Math.max(maxTries, tries); return }
    }
    throw new Error(`connection ${String(i)} did not converge in 40 tries`)
  }))
  const finalNotes = notesOf((await stored(A, S1))?.panels ?? null).map((n) => n.id).sort()
  check('twelve devices each add a note by read, merge, swap and retry: all twelve survive with the base note', finalNotes.length === N + 1 && Array.from({ length: N }, (_, i) => `n_m${String(i)}`).every((id) => finalNotes.includes(id)) && finalNotes.includes('n_base'), `${String(finalNotes.length)} notes`)
  check('and the retries are bounded (a connection needs at most one try per rival, plus its own)', maxTries <= N && attempts <= (N * (N + 1)) / 2 + N, `max ${String(maxTries)} tries, ${String(attempts)} attempts`)

  /* 8. people, projects, surfaces */
  const cross = await set(main, B, S1, doc([{ id: 'n_x', text: 'bob into alice', at: 1 }]), 0)
  const crossRead = await get(main, B, S1)
  check('another person naming this project is refused on write and on read, and nothing of theirs is stored', typeof cross.error === 'string' && typeof crossRead.error === 'string' && (await stored(B, S1)) === null)
  const bw = await set(main, B, SB, doc([{ id: 'n_b', text: 'bob own', at: 1 }]), 0)
  check('a person can save their own project, and their revision has nothing to do with another person\'s', bw.ok === true && (await stored(A, S1))?.rev !== bw.rev)
  const st = await set(main, A, S1, doc([{ id: 'n_st', text: 'older studio surface', at: 1 }]), 0, 'studio')
  const bsNow = await get(main, A, S1, 'basecamp')
  const stNow = await get(main, A, S1, 'studio')
  const stStale = await set(main, A, S1, doc([{ id: 'n_st2', text: 'x', at: 2 }]), bsNow.rev, 'studio')
  check('the two surfaces keep separate rows and separate revisions (a revision from one is stale for the other)', st.ok === true && stNow.rev === st.rev && stNow.rev !== bsNow.rev && stStale.conflict === true)
  const two = await set(main, A, S2, doc([{ id: 'n_two', text: 'other project', at: 1 }]), (await get(main, A, S2)).rev)
  check('a revision belongs to one project: the other project of the same person is unaffected', two.ok === true && notesOf((await stored(A, S1))?.panels ?? null).length === N + 1)

  /* 9. an empty layout */
  const rr = await get(main, A, S2)
  const resetStale = await set(main, A, S2, '[]', Number(rr.rev) - 1)
  check('an empty layout is still a reset, and a reset made from a stale revision is refused', resetStale.conflict === true && (await stored(A, S2)) !== null)
  const resetOk = await set(main, A, S2, '[]', rr.rev)
  check('and from the current revision it removes the row', resetOk.reset === true && (await stored(A, S2)) === null)
} finally {
  for (const db of pool) await db.end().catch(() => undefined)
  for (const m of made) {
    await q(main, `delete from public.dashboard_layouts l using public.projects p where p.project_id = l.project_id and p.office_id = ${lit(m.office)}::uuid`).catch(() => undefined)
    await q(main, `delete from public.projects where office_id = ${lit(m.office)}::uuid`).catch(() => undefined)
  }
  await q(main, `drop function if exists app.hq_dashboard_layout_set_sabotaged(uuid,text,jsonb,text,bigint)`).catch(() => undefined)
  const left = Number((await q(main, `select count(*)::int c from public.dashboard_layouts l join public.projects p on p.project_id = l.project_id where p.slug like ${lit(`cas-%-${run}`)}`).catch(() => [{ c: -1 }]))[0]?.c)
  check('the proof left no arrangement behind', left === 0, String(left))
  await main.end()
}
const bad = results.filter((r) => !r).length
console.log(`\n${String(results.length - bad)}/${String(results.length)} passed`)
process.exit(bad === 0 ? 0 : 1)
