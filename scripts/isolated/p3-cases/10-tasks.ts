/**
 * The task functions (migration 0670): the personal list, the project task writers, undo.
 * Person A and Person B each have a project with the SAME slug.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B, canary } = c
  const S = 'service_role'
  const q = (office: string) => lit(office)

  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values ('personal', 'Personal ${who}', 'paused', '${office}') on conflict do nothing`,
    )
  }

  // ---- the writers put the row in the caller's office, and the same slug means two different projects -------------------
  const a1 = (await c.exec(
    S,
    `select public.my_task_add(${q(A)}, ${lit(`${canary.A} write the report`)}, p_project => 'personal')`,
  )) as { ok: boolean; id: string }
  const b1 = (await c.exec(
    S,
    `select public.my_task_add(${q(B)}, ${lit(`${canary.B} write the report`)}, p_project => 'personal')`,
  )) as { ok: boolean; id: string }
  c.check(
    a1.ok === true && b1.ok === true,
    'A and B each add a personal task to a project both call "personal"',
    c.json([a1, b1]).slice(0, 120),
  )
  const owner = async (id: string) =>
    (
      await c.db.execute(
        `select t.office_id, p.office_id as project_office from public.tasks t join public.projects p using (project_id) where t.task_id = '${id}'`,
      )
    ).rows[0] as { office_id: string; project_office: string }
  const oa = await owner(a1.id)
  const ob = await owner(b1.id)
  c.check(
    oa.office_id === A && oa.project_office === A,
    "A's task is A's and is filed under A's \"personal\"",
    '',
  )
  c.check(
    ob.office_id === B && ob.project_office === B,
    "B's task is B's and is filed under B's \"personal\"",
    '',
  )

  // ---- reads: A sees A's list and never B's -----------------------------------------------------------------------------
  const listA = c.json(await c.exec(S, `select public.my_tasks(${q(A)}, 'all')`))
  c.check(
    listA.includes(canary.A) && !listA.includes(canary.B),
    "A's list holds A's canary and not B's",
    '',
  )
  const listB = c.json(await c.exec(S, `select public.my_tasks(${q(B)}, 'all')`))
  c.check(
    listB.includes(canary.B) && !listB.includes(canary.A),
    "B's list holds B's canary and not A's",
    '',
  )
  const countsA = c.json(await c.exec(S, `select public.my_tasks_counts(${q(A)})`))
  const countsB = c.json(await c.exec(S, `select public.my_tasks_counts(${q(B)})`))
  c.check(
    JSON.parse(countsA).all === 1 && JSON.parse(countsB).all === 1,
    'each office counts only its own tasks',
    `${countsA} ${countsB}`,
  )

  // ---- a foreign id and a nonexistent id get THE SAME ANSWER, and nothing of B's moves -------------------------------------
  const before = await c.snapshot(B, ['tasks', 'projects', 'undoable_actions'])
  const nobody = c.nobody()
  const same = async (what: string, mk: (id: string) => string) => {
    const foreign = c.json(await c.exec(S, mk(b1.id)))
    const missing = c.json(await c.exec(S, mk(nobody)))
    c.check(
      foreign === missing,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 80)
        : `${foreign.slice(0, 60)} vs ${missing.slice(0, 60)}`,
    )
  }
  await same('hq_task_state', (id) => `select public.hq_task_state(${q(A)}, '${id}', 'done')`)
  await same(
    'hq_task_update',
    (id) => `select public.hq_task_update(${q(A)}, '${id}', p_title => 'taken')`,
  )
  await same(
    'my_task_set',
    (id) => `select public.my_task_set(${q(A)}, '${id}', p_title => 'taken')`,
  )
  await same('my_task_delete', (id) => `select public.my_task_delete(${q(A)}, '${id}')`)
  await same('my_task_reparent', (id) => `select public.my_task_reparent(${q(A)}, '${id}', null)`)
  await same(
    'my_task_add under a parent',
    (id) => `select public.my_task_add(${q(A)}, 'child', p_parent => '${id}')`,
  )
  await same('hq_undo', (id) => `select public.hq_undo(${q(A)}, '${id}')`)
  c.check(
    before === (await c.snapshot(B, ['tasks', 'projects', 'undoable_actions'])),
    "nothing of B's moved while A attacked",
    '',
  )

  // ---- A cannot reach B's project by its slug alone ------------------------------------------------------------------------
  const viaSlug = (await c.exec(
    S,
    `select public.hq_task_add(${q(A)}, 'personal', ${lit('slug attack')})`,
  )) as { id?: string; error?: string }
  const landed = viaSlug.id === undefined ? null : await owner(viaSlug.id)
  c.check(
    landed?.office_id === A && landed.project_office === A,
    'the slug "personal" resolves inside A\'s office, never B\'s',
    c.json(viaSlug).slice(0, 100),
  )
  const ghost = c.json(
    await c.exec(S, `select public.hq_task_add(${q(A)}, 'only-b-has-this', 'x')`),
  )
  await c.db.execute(
    `insert into public.projects (slug, name, status, office_id) values ('only-b-has-this', 'B only', 'paused', '${B}') on conflict do nothing`,
  )
  const foreignSlug = c.json(
    await c.exec(S, `select public.hq_task_add(${q(A)}, 'only-b-has-this', 'x')`),
  )
  c.check(
    ghost === foreignSlug,
    "B's private slug answers A exactly as a slug that exists nowhere does",
    foreignSlug.slice(0, 90),
  )

  // ---- undo is the office's own -------------------------------------------------------------------------------------------
  const st = (await c.exec(S, `select public.hq_task_state(${q(A)}, '${a1.id}', 'done')`)) as {
    undo?: string
  }
  c.check(typeof st.undo === 'string', "A can mark A's task done and is offered an undo", '')
  const crossUndo = c.json(await c.exec(S, `select public.hq_undo(${q(B)}, '${st.undo ?? ''}')`))
  c.check(
    crossUndo === c.json(await c.exec(S, `select public.hq_undo(${q(B)}, '${c.nobody()}')`)),
    "B cannot undo A's action, and cannot tell it exists",
    crossUndo.slice(0, 80),
  )
  const ownUndo = (await c.exec(S, `select public.hq_undo(${q(A)}, '${st.undo ?? ''}')`)) as {
    ok?: boolean
  }
  c.check(ownUndo.ok === true, "A can undo A's own action", c.json(ownUndo).slice(0, 80))

  // ---- no office, no work ----------------------------------------------------------------------------------------------------
  for (const [what, sql] of [
    ['a null office', `select public.my_tasks(null::uuid, 'all')`],
    ['an office that does not exist', `select public.my_tasks(${lit(c.nobody())}::uuid, 'all')`],
  ] as const) {
    const msg = await c.refusal(S, sql)
    c.check(msg.includes('no_office'), `${what} does the task functions no good`, msg.slice(0, 80))
  }

  // ---- the doors are shut to the browser's own roles ------------------------------------------------------------------------
  for (const role of callerRoles) {
    const msg = await c.refusal(role, `select public.my_tasks(${q(A)}, 'all')`)
    c.check(
      msg.includes('permission denied'),
      `${role} cannot call the task functions`,
      msg.slice(0, 80),
    )
  }

  // ---- and the bridge was not needed -----------------------------------------------------------------------------------------
  const bridge = (
    await c.db.execute(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in ('tasks','undoable_actions')`,
    )
  ).rows[0] as { n: number }
  c.check(
    bridge.n === 0,
    'the converted task writers never relied on the compatibility bridge',
    `bridge uses on tasks/undoable_actions: ${String(bridge.n)}`,
  )
}
