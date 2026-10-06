/**
 * The project functions (migration 0711, cluster a-projects): lifecycle, attachments, references, automations,
 * project staff and briefs, layouts, project-seen and say_in_project.
 *
 * Person A and Person B each have a project called "shared" (the SAME slug) and B has a project A has never heard of.
 * Every converted function is driven as A against B's slugs and B's ids, and the proof is three-sided:
 *   - a foreign slug/id and one that exists nowhere give the SAME answer (the slug text itself aside);
 *   - nothing of B's moved (carrier tables by office, derived tables through B's projects);
 *   - a reader's output carries B's canary nowhere and A's own canary where it should.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

const S = 'service_role'
const DERIVED = [
  'project_references',
  'project_attachments',
  'project_staff',
  'project_connector_choices',
  'project_aliases',
  'dashboard_layouts',
  'plane_layouts',
  'project_seen',
] as const

export async function cases(c: Ctx): Promise<void> {
  const { A, B, canary } = c
  const q = lit
  const run = async (sql: string): Promise<unknown> => c.exec(S, sql)

  // ---- who the two people are: a person office speaks under the key of its member --------------------------------------
  await c.db.execute(
    `insert into public.office_members (email, owner_key, kind) values
       ('person.a@example.invalid', 'person-a', 'person'), ('person.b@example.invalid', 'person-b', 'person')
     on conflict (email) do nothing`,
  )
  const actorA = String((await c.db.execute(`select app.office_actor('${A}') as a`)).rows[0]?.a)
  const actorB = String((await c.db.execute(`select app.office_actor('${B}') as a`)).rows[0]?.a)
  c.check(
    actorA === 'person-a' && actorB === 'person-b',
    "each office speaks under its own member's key, never under 'grant'",
    `${actorA} ${actorB}`,
  )

  const bridgeNow = async (): Promise<number> =>
    Number(
      (
        await c.db.execute(
          `select coalesce(sum(n),0)::int as n from public.office_bridge_use
            where table_name in ('projects','responsibilities','undoable_actions','inbound_commands','workspace_layouts','jobs')`,
        )
      ).rows[0]?.n,
    )
  const bridge0 = await bridgeNow()

  // ---- the world: both have "shared"; B also has a project A has never heard of --------------------------------------
  const mkProject = async (office: string, slug: string, name: string, status = 'active') => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${q(slug)}, ${q(name)}, ${q(status)}, '${office}') on conflict do nothing;
       ${
         status === 'active'
           ? `insert into public.project_attachments (project_id, connector, external_ref, display_name, role, enabled)
                select project_id, 'upload', ${q(`${slug}-src`)}, ${q(`${name} uploads`)}, 'source', true
                  from public.projects where slug = ${q(slug)} and office_id = '${office}' on conflict do nothing;`
           : ''
}`,
    )
    return String(
      (
        await c.db.execute(
          `select project_id from public.projects where slug = ${q(slug)} and office_id = '${office}'`,
        )
      ).rows[0]?.project_id,
    )
  }
  const shA = await mkProject(A, 'shared', `Shared ${canary.A}`)
  const shB = await mkProject(B, 'shared', `Shared ${canary.B}`)
  const onlyB = await mkProject(B, 'only-b', `Only B ${canary.B}`)
  const archB = await mkProject(B, 'only-b-archive', `Archive B ${canary.B}`)
  void archB

  // B's private facts, written through the converted writers AS B (so the positive control is part of the setup)
  const bRef = (await run(
    `select public.add_project_reference(${q(B)}, 'shared', ${q(`https://b.example/${canary.B}`)}, ${q(`B ref ${canary.B}`)})`,
  )) as { ok?: boolean; reference?: string }
  const bAuto = (await run(
    `select public.create_automation(${q(B)}, 'shared', ${q(`${canary.B} check the supplier prices every day please`)}, 1440)`,
  )) as { ok?: boolean; automation?: string }
  await run(
    `select public.set_project_instruction(${q(B)}, 'shared', 'research-director', ${q(`${canary.B} brief for the research director`)})`,
  )
  await run(`select public.hq_dashboard_layout_set(${q(B)}, 'shared', '[{"id":"b-panel"}]'::jsonb)`)
  await run(
    `select public.hq_plane_layout_set(${q(B)}, '${shB}', ${q(`{"${canary.B}":{"x":1,"y":2}}`)}::jsonb, '{}'::jsonb)`,
  )
  await run(
    `select public.hq_workspace_layout_set(${q(B)}, ${q(`[{"id":"${canary.B}","x":0,"y":0,"w":1,"h":1}]`)}::jsonb)`,
  )
  await run(`select public.hq_project_seen(${q(B)}, '${shB}')`)
  const bAttach = String(
    (
      await c.db.execute(
        `select attachment_id from public.project_attachments where project_id = '${shB}' limit 1`,
      )
    ).rows[0]?.attachment_id,
  )
  const bArchiveOffer = (await run(`select public.archive_project(${q(B)}, 'only-b-archive')`)) as {
    undo?: string
  }
  c.check(
    bRef.ok === true && bAuto.ok === true && typeof bArchiveOffer.undo === 'string',
    "B's private facts exist (reference, automation, brief, layouts, seen, an undo offer)",
    c.json([bRef, bAuto]).slice(0, 140),
  )

  const tables = [
    'projects',
    'responsibilities',
    'undoable_actions',
    'inbound_commands',
    'workspace_layouts',
  ]
  const derivedOf = async (office: string): Promise<string> => {
    const parts: string[] = []
    for (const t of DERIVED) {
      const r = await c.db.execute(
        `select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-') as h
           from public.${t} x join public.projects p on p.project_id = x.project_id where p.office_id = '${office}'`,
      )
      parts.push(`${t}=${String(r.rows[0]?.h)}`)
    }
    return parts.join(',')
  }
  const jobsOf = async (office: string): Promise<string> =>
    String(
      (
        await c.db.execute(
          `select coalesce(md5(string_agg(j::text, '|' order by j::text)), '-') as h from public.jobs j where j.office_id = '${office}'`,
        )
      ).rows[0]?.h,
    )
  const worldB = async (): Promise<string> =>
    `${await c.snapshot(B, tables)}|${await derivedOf(B)}|${await jobsOf(B)}`

  const attackB0 = await worldB()
  const diff = (a: string, b: string): string =>
    a
      .split(/[,|]/)
      .filter((x, i) => x !== b.split(/[,|]/)[i])
      .map((x) => x.split('=')[0])
      .join(' ')

  // ---- 1. a foreign slug / id and one that exists nowhere are indistinguishable ---------------------------------------------
  const norm = (v: unknown, ...slugs: string[]): string =>
    [...slugs]
      .sort((a, b) => b.length - a.length)
      .reduce((s, x) => s.replaceAll(x, '<SLUG>'), c.json(v))
  const bAutoSlugText = String(bAuto.automation)
  const unwrap = (r: { ok: true; value: unknown } | { ok: false; error: string }): unknown =>
    r.ok ? r.value : r
  const sameSlug = async (what: string, mk: (slug: string) => string): Promise<void> => {
    const foreign = norm(
      unwrap(await c.try_(S, mk('only-b'))),
      'only-b',
      'only-b-ghost',
      bAutoSlugText,
      'no-such-duty',
    )
    const missing = norm(
      unwrap(await c.try_(S, mk('only-b-ghost'))),
      'only-b',
      'only-b-ghost',
      bAutoSlugText,
      'no-such-duty',
    )
    c.check(
      foreign === missing && !foreign.includes('"ok":true') && !foreign.includes(canary.B),
      `${what}: B's slug and a slug that exists nowhere are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 90)
        : `${foreign.slice(0, 70)} vs ${missing.slice(0, 70)}`,
    )
  }
  const sameId = async (
    what: string,
    mk: (id: string) => string,
    foreignId: string,
  ): Promise<void> => {
    const foreign = norm(unwrap(await c.try_(S, mk(foreignId))), bAutoSlugText, 'no-such-duty')
    const missing = norm(unwrap(await c.try_(S, mk(c.nobody()))), bAutoSlugText, 'no-such-duty')
    c.check(
      foreign === missing && !foreign.includes(canary.B),
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 90)
        : `${foreign.slice(0, 70)} vs ${missing.slice(0, 70)}`,
    )
  }

  await sameSlug(
    'add_project_reference',
    (s) => `select public.add_project_reference(${q(A)}, ${q(s)}, 'https://x.example/a')`,
  )
  await sameSlug('archive_project', (s) => `select public.archive_project(${q(A)}, ${q(s)})`)
  await sameSlug('unarchive_project', (s) => `select public.unarchive_project(${q(A)}, ${q(s)})`)
  await sameSlug(
    'create_automation',
    (s) =>
      `select public.create_automation(${q(A)}, ${q(s)}, 'do the daily thing for the whole project please')`,
  )
  await sameSlug('hq_attach', (s) => `select public.hq_attach(${q(A)}, ${q(s)}, 'upload', 'x-ref')`)
  await sameSlug(
    'hq_connection_choose',
    (s) => `select public.hq_connection_choose(${q(A)}, ${q(s)}, 'notion', 'declined')`,
  )
  await sameSlug(
    'hq_rename_project',
    (s) => `select public.hq_rename_project(${q(A)}, ${q(s)}, 'Taken over')`,
  )
  await sameSlug(
    'hq_project_look',
    (s) => `select public.hq_project_look(${q(A)}, ${q(s)}, 'rocket')`,
  )
  await sameSlug(
    'set_project_staff',
    (s) => `select public.set_project_staff(${q(A)}, ${q(s)}, 'finance-director', false)`,
  )
  await sameSlug(
    'set_project_instruction',
    (s) =>
      `select public.set_project_instruction(${q(A)}, ${q(s)}, 'research-director', 'a brief long enough to count')`,
  )
  await sameSlug(
    'hq_dashboard_layout_set',
    (s) => `select public.hq_dashboard_layout_set(${q(A)}, ${q(s)}, '[{"id":"x"}]'::jsonb)`,
  )
  await sameSlug(
    'hq_dashboard_layout_reset',
    (s) => `select public.hq_dashboard_layout_reset(${q(A)}, ${q(s)})`,
  )
  await sameSlug(
    'set_automation',
    (s) => `select public.set_automation(${q(A)}, ${q(`${s}-auto`)}, false)`,
  )
  await sameSlug(
    'remove_automation',
    (s) => `select public.remove_automation(${q(A)}, ${q(`${s}-auto`)})`,
  )
  // B's REAL automation slug, against a slug that exists nowhere
  const bAutoSlug = String(bAuto.automation)
  await sameId(
    "set_automation (B's real automation)",
    (id) =>
      `select public.set_automation(${q(A)}, ${q(id === c.nobody() ? 'no-such-duty' : bAutoSlug)}, false)`,
    bAutoSlug,
  )
  await sameId(
    "remove_automation (B's real automation)",
    (id) =>
      `select public.remove_automation(${q(A)}, ${q(id === c.nobody() ? 'no-such-duty' : bAutoSlug)})`,
    bAutoSlug,
  )

  await sameId('hq_detach', (id) => `select public.hq_detach(${q(A)}, '${id}')`, bAttach)
  await sameId('hq_reattach', (id) => `select public.hq_reattach(${q(A)}, '${id}')`, bAttach)
  await sameId(
    'remove_project_reference',
    (id) => `select public.remove_project_reference(${q(A)}, '${id}')`,
    String(bRef.reference),
  )
  await sameId('hq_project_seen', (id) => `select public.hq_project_seen(${q(A)}, '${id}')`, shB)
  await sameId(
    'hq_plane_layout_set',
    (id) =>
      `select public.hq_plane_layout_set(${q(A)}, '${id}', '{"n":{"x":1}}'::jsonb, '{}'::jsonb)`,
    shB,
  )
  await sameId(
    'hq_plane_layout_reset',
    (id) => `select public.hq_plane_layout_reset(${q(A)}, '${id}')`,
    shB,
  )
  await sameId(
    'hq_plane_layout (reader)',
    (id) => `select public.hq_plane_layout(${q(A)}, '${id}')`,
    shB,
  )
  await sameId('project_team (reader)', (id) => `select public.project_team(${q(A)}, '${id}')`, shB)
  await sameId(
    'project_automations (reader)',
    (id) => `select public.project_automations(${q(A)}, '${id}')`,
    shB,
  )
  await sameId(
    'staff_on_project (reader)',
    (id) => `select public.staff_on_project(${q(A)}, '${id}')`,
    shB,
  )
  await sameId(
    'say_in_project',
    (id) => `select public.say_in_project(${q(A)}, '${id}', 'hello team')`,
    shB,
  )
  await sameId(
    "hq_undo of B's archive offer",
    (id) => `select public.hq_undo(${q(A)}, '${id}')`,
    String(bArchiveOffer.undo),
  )

  c.check(
    attackB0 === (await worldB()),
    "nothing of B's moved while A attacked it (projects, duties, undo, commands, layouts, jobs and every derived table)",
    '',
  )

  // ---- 2. the same slug means two different projects: A's writes land in A's, and only there ---------------------------------
  const aRef = (await run(
    `select public.add_project_reference(${q(A)}, 'shared', ${q(`https://a.example/${canary.A}`)}, ${q(`A ref ${canary.A}`)})`,
  )) as { ok?: boolean; reference?: string }
  const refOwner = async (id: string): Promise<string> =>
    String(
      (
        await c.db.execute(
          `select p.office_id from public.project_references r join public.projects p using (project_id) where r.reference_id = '${id}'`,
        )
      ).rows[0]?.office_id,
    )
  c.check(
    aRef.ok === true && (await refOwner(String(aRef.reference))) === A,
    'A "shared" reference lands in A\'s project, not B\'s',
    '',
  )
  const aAuto = (await run(
    `select public.create_automation(${q(A)}, 'shared', ${q(`${canary.A} check the supplier prices every day please`)}, 1440)`,
  )) as { ok?: boolean; automation?: string }
  const autoOwner = String(
    (
      await c.db.execute(
        `select office_id from public.responsibilities where slug = ${q(String(aAuto.automation))} and office_id = '${A}'`,
      )
    ).rows[0]?.office_id,
  )
  c.check(
    aAuto.ok === true && autoOwner === A,
    "A's automation is filed in A's office under A's project",
    c.json(aAuto).slice(0, 100),
  )
  await run(
    `select public.set_project_instruction(${q(A)}, 'shared', 'research-director', ${q(`${canary.A} brief for the research director`)})`,
  )
  await run(`select public.set_project_staff(${q(A)}, 'shared', 'finance-director', false)`)
  await run(`select public.hq_dashboard_layout_set(${q(A)}, 'shared', '[{"id":"a-panel"}]'::jsonb)`)
  await run(
    `select public.hq_plane_layout_set(${q(A)}, '${shA}', ${q(`{"${canary.A}":{"x":1,"y":2}}`)}::jsonb, '{}'::jsonb)`,
  )
  await run(
    `select public.hq_workspace_layout_set(${q(A)}, ${q(`[{"id":"${canary.A}","x":0,"y":0,"w":1,"h":1}]`)}::jsonb)`,
  )
  await run(`select public.hq_project_seen(${q(A)}, '${shA}')`)

  // ---- 3. readers: A sees A's, never B's --------------------------------------------------------------------------------------
  const readers: [string, string][] = [
    ['hq_projects', `select public.hq_projects(${q(A)})`],
    ['project_team', `select public.project_team(${q(A)}, '${shA}')`],
    ['project_automations', `select public.project_automations(${q(A)}, '${shA}')`],
    ['hq_plane_layout', `select public.hq_plane_layout(${q(A)}, '${shA}')`],
    ['hq_workspace_layout', `select public.hq_workspace_layout(${q(A)})`],
  ]
  for (const [name, sql] of readers) {
    const out = c.json(await run(sql))
    c.check(
      out.includes(canary.A) && !out.includes(canary.B),
      `${name}: A's answer holds A's canary and never B's`,
      out.slice(0, 80),
    )
  }
  const asB = c.json(await run(`select public.hq_projects(${q(B)})`))
  c.check(
    asB.includes(canary.B) && !asB.includes(canary.A),
    "hq_projects: B's answer holds B's canary and never A's",
    '',
  )
  const teamA = (await run(`select public.staff_on_project(${q(A)}, '${shA}')`)) as string[]
  const teamB = (await run(`select public.staff_on_project(${q(B)}, '${shB}')`)) as string[]
  c.check(
    !teamA.includes('finance-director') && teamB.includes('finance-director'),
    "A turning finance off on A's project does not turn it off on B's (staff_on_project)",
    `${teamA.length} ${teamB.length}`,
  )
  const wsOwners = (
    await c.db.execute(`select owner, office_id from public.workspace_layouts order by owner`)
  ).rows as { owner: string; office_id: string }[]
  c.check(
    wsOwners.some((r) => r.owner === 'person-a' && r.office_id === A) &&
      wsOwners.some((r) => r.owner === 'person-b' && r.office_id === B) &&
      !wsOwners.some((r) => r.owner === 'grant' && r.office_id !== c.G),
    "workspace layouts are keyed by the office's own person, never by a literal grant",
    c.json(wsOwners).slice(0, 120),
  )
  const seenOwners = (
    await c.db.execute(
      `select s.owner, p.office_id from public.project_seen s join public.projects p using (project_id)`,
    )
  ).rows as { owner: string; office_id: string }[]
  c.check(
    seenOwners.every((r) =>
      r.owner === 'person-a'
        ? r.office_id === A
        : r.owner === 'person-b'
          ? r.office_id === B
          : true,
    ),
    "project_seen rows carry the person of the project's own office",
    c.json(seenOwners).slice(0, 100),
  )

  // ---- 4. hq_create_project: a name or a slug B holds is not a reason to refuse or to talk to A about B ---------------------
  const mine = (await run(
    `select public.hq_create_project(${q(A)}, ${q(`Only B ${canary.B}`)}, 'upload', ${q(`a-ref-${canary.A}`)})`,
  )) as {
    project_id?: string
    needs_confirmation?: boolean
    candidates?: unknown
    slug?: string
    error?: string
  }
  c.check(
    mine.project_id !== undefined && mine.needs_confirmation === undefined,
    'A creating a project whose name B already uses is not asked "did you mean" about B\'s project',
    c.json(mine).slice(0, 140),
  )
  const mineOffice = String(
    (
      await c.db.execute(
        `select office_id from public.projects where project_id = '${String(mine.project_id)}'`,
      )
    ).rows[0]?.office_id,
  )
  c.check(mineOffice === A, "the created project belongs to A's office", '')
  const dup = (await run(
    `select public.hq_create_project(${q(A)}, ${q(`Shared ${canary.A}`)}, 'upload', ${q(`a-ref2-${canary.A}`)})`,
  )) as {
    needs_confirmation?: boolean
    candidates?: { slug: string }[]
  }
  c.check(
    dup.needs_confirmation === true &&
      c.json(dup.candidates).includes(canary.A) &&
      !c.json(dup.candidates).includes(canary.B),
    "within A's own office a duplicate name still asks (and names only A's projects)",
    c.json(dup).slice(0, 120),
  )
  const sameSlugMade = (await run(
    `select public.hq_create_project(${q(A)}, 'Only B', 'upload', ${q(`a-ref3-${canary.A}`)}, p_force => true)`,
  )) as {
    slug?: string
    project_id?: string
  }
  c.check(
    sameSlugMade.slug === 'only-b' &&
      String(
        (
          await c.db.execute(
            `select office_id from public.projects where project_id = '${String(sameSlugMade.project_id)}'`,
          )
        ).rows[0]?.office_id,
      ) === A,
    "A can have a project with the slug B has (slugs are unique per office), filed in A's office",
    c.json(sameSlugMade).slice(0, 100),
  )
  const renamedClash = c.json(
    await c.try_(
      S,
      `select public.hq_rename_project(${q(A)}, 'shared', ${q(`Shared ${canary.B}`)})`,
    ),
  )
  c.check(
    renamedClash.includes('"ok":true') && !renamedClash.includes('already belongs'),
    "renaming A's project to a name B uses is not refused on B's account",
    renamedClash.slice(0, 120),
  )
  await run(`select public.hq_rename_project(${q(A)}, 'shared', ${q(`Shared ${canary.A}`)})`)

  // the alias trigger is a rule inside an office: B holds a phrase, A may hold the same words
  await c.db.execute(
    `select app.add_project_alias('${B}'::uuid, '${shB}'::uuid, 'zebra crossing ${canary.B}', 'grant', 1.0)`,
  )
  const aliasA = (
    await c.db.execute(
      `select app.add_project_alias('${A}'::uuid, '${shA}'::uuid, 'zebra crossing ${canary.B}', 'grant', 1.0) as r`,
    )
  ).rows[0]?.r
  c.check(
    c.json(aliasA).includes('"ok":true') && !c.json(aliasA).includes('already means'),
    "the same routing phrase in two offices is no conflict, and A is never told B's project holds it",
    c.json(aliasA).slice(0, 120),
  )
  const seen = c.json(
    (
      await c.db.execute(
        `select r.project_id from app.resolve_project_by_name('${A}'::uuid, 'zebra crossing ${canary.B}') r`,
      )
    ).rows,
  )
  c.check(
    seen.includes(shA) && !seen.includes(shB) && !seen.includes(onlyB),
    "resolving that phrase as A finds A's project, and B's project holding the same words is not in the answer",
    seen,
  )

  // ---- 5. machine_project_ok is a function of the name and the office ----------------------------------------------------------
  await mkProject(B, `fixture-b-${canary.B.toLowerCase()}`, 'Fixture B', 'paused')
  const mok = async (office: string, ref: string) =>
    c.json(await run(`select public.machine_project_ok(${q(office)}, ${q(ref)})`))
  c.check(
    (await mok(A, 'only-b')) === (await mok(A, 'only-b-ghost')) &&
      (await mok(A, 'only-b')) === 'false',
    'machine_project_ok: B\'s real slug and a slug that exists nowhere both say "not a test project" to A',
    '',
  )
  c.check(
    (await mok(A, 'fixture-anything')) === 'true',
    'machine_project_ok: a fixture-shaped name is a test project',
    '',
  )

  const attackB1 = await worldB() // B's setup is finished; from here A makes its own writes
  // ---- 6. the positive controls: the same calls as the right office work -------------------------------------------------------
  const ctl = async (what: string, sql: string, ok: (r: Record<string, unknown>) => boolean) => {
    const r = await c.try_(S, sql)
    c.check(
      r.ok && ok(r.value as Record<string, unknown>),
      `A can ${what}`,
      c.json(r).slice(0, 100),
    )
    return r.ok ? (r.value as Record<string, unknown>) : {}
  }
  const att = await ctl(
    'attach a source to its own project',
    `select public.hq_attach(${q(A)}, 'shared', 'upload', 'second-src', 'source', null, 'Second')`,
    (r) => typeof r.attachment_id === 'string',
  )
  const det = await ctl(
    'detach it and is offered an undo',
    `select public.hq_detach(${q(A)}, ${q(String(att.attachment_id))})`,
    (r) => typeof r.undo === 'string',
  )
  await ctl(
    'undo the detach through hq_undo',
    `select public.hq_undo(${q(A)}, ${q(String(det.undo))})`,
    (r) => r.ok === true,
  )
  const enabled = (
    await c.db.execute(
      `select enabled from public.project_attachments where attachment_id = '${String(att.attachment_id)}'`,
    )
  ).rows[0]?.enabled
  c.check(enabled === true, 'the undone detach is attached again', '')
  await ctl(
    'choose a connector for its own project',
    `select public.hq_connection_choose(${q(A)}, 'shared', 'notion', 'declined', 'not now')`,
    (r) => r.ok === true,
  )
  const ren = await ctl(
    'rename its project and is offered an undo',
    `select public.hq_rename_project(${q(A)}, 'shared', ${q(`Renamed ${canary.A}`)})`,
    (r) => typeof r.undo === 'string',
  )
  const renJob = (
    await c.db.execute(
      `select office_id from public.jobs where kind = 'office.rename_channels' and project_id = '${shA}' order by created_at desc limit 1`,
    )
  ).rows[0]?.office_id
  c.check(renJob === A, "the rename-channels job is written in A's office", String(renJob))
  await ctl(
    'undo the rename',
    `select public.hq_undo(${q(A)}, ${q(String(ren.undo))})`,
    (r) => r.ok === true,
  )
  const look = await ctl(
    'change how its project looks and is offered an undo',
    `select public.hq_project_look(${q(A)}, 'shared', 'rocket', 'p-plum')`,
    (r) => typeof r.undo === 'string',
  )
  await ctl(
    'undo the look',
    `select public.hq_undo(${q(A)}, ${q(String(look.undo))})`,
    (r) => r.ok === true,
  )
  const arch = await ctl(
    'archive its project, stopping its automation',
    `select public.archive_project(${q(A)}, 'shared')`,
    (r) => r.ok === true && Number(r.automations_stopped) >= 1,
  )
  const stoppedB = (
    await c.db.execute(
      `select enabled from public.responsibilities where office_id = '${B}' and slug = ${q(String(bAuto.automation))}`,
    )
  ).rows[0]?.enabled
  c.check(
    stoppedB === true,
    'archiving A\'s "shared" did not switch off B\'s automation under the same project slug',
    '',
  )
  await ctl(
    'bring it back through hq_undo',
    `select public.hq_undo(${q(A)}, ${q(String(arch.undo))})`,
    (r) => r.ok === true,
  )
  const back = (
    await c.db.execute(`select status from public.projects where project_id = '${shA}'`)
  ).rows[0]?.status
  c.check(back === 'active', "A's project is active again", String(back))
  const stillArchivedB = (
    await c.db.execute(
      `select status from public.projects where office_id = '${B}' and slug = 'only-b-archive'`,
    )
  ).rows[0]?.status
  c.check(
    stillArchivedB === 'archived',
    "B's archived project stays archived (A's undo of its own archive did not touch it)",
    String(stillArchivedB),
  )
  await ctl(
    'turn its automation off and on',
    `select public.set_automation(${q(A)}, ${q(String(aAuto.automation))}, true)`,
    (r) => r.ok === true,
  )
  const ex = await ctl(
    'remove its automation',
    `select public.remove_automation(${q(A)}, ${q(String(aAuto.automation))})`,
    (r) => r.ok === true,
  )
  void ex
  const stillB = (
    await c.db.execute(
      `select count(*)::int as n from public.responsibilities where office_id = '${B}' and slug = ${q(String(bAuto.automation))}`,
    )
  ).rows[0]?.n
  c.check(
    Number(stillB) === 1,
    "removing A's automation of that slug left B's automation of the same slug",
    String(stillB),
  )
  await ctl(
    'remove its reference',
    `select public.remove_project_reference(${q(A)}, ${q(String(aRef.reference))})`,
    (r) => r.ok === true,
  )
  await ctl(
    'clear a brief',
    `select public.set_project_instruction(${q(A)}, 'shared', 'research-director', '')`,
    (r) => r.ok === true,
  )
  await ctl(
    'reset its dashboard layout',
    `select public.hq_dashboard_layout_reset(${q(A)}, 'shared')`,
    (r) => r.ok === true,
  )
  await ctl(
    'reset its plane layout',
    `select public.hq_plane_layout_reset(${q(A)}, '${shA}')`,
    (r) => r.reset === true && r.had_one === true,
  )
  await ctl(
    'reset its workspace',
    `select public.hq_workspace_layout_reset(${q(A)})`,
    (r) => Number(r.removed) === 1,
  )
  const bWs = (
    await c.db.execute(
      `select count(*)::int as n from public.workspace_layouts where office_id = '${B}'`,
    )
  ).rows[0]?.n
  c.check(Number(bWs) === 1, "resetting A's workspace left B's workspace", String(bWs))
  const said = await ctl(
    'say something in its own project',
    `select public.say_in_project(${q(A)}, '${shA}', ${q(`hello ${canary.A}`)})`,
    (r) => r.ok === true,
  )
  const cmdOffice = (
    await c.db.execute(
      `select office_id, actor from public.inbound_commands where command_id = '${String(said.command)}'`,
    )
  ).rows[0] as { office_id: string; actor: string }
  c.check(
    cmdOffice?.office_id === A && cmdOffice.actor === 'person-a',
    "the command is written in A's office, said by A's person",
    c.json(cmdOffice),
  )
  const unknownSay = await c.try_(
    S,
    `select public.say_in_project(${q(A)}, '${shA}', 'x', null, '{}'::text[], 'nobody-we-know')`,
  )
  c.check(
    unknownSay.ok === false || c.json(unknownSay).includes('false'),
    'a principal the office does not know is still refused (the authority check was kept)',
    c.json(unknownSay).slice(0, 100),
  )

  c.check(
    attackB1 === (await worldB()),
    "after every write A made under the shared slug, B's world is still byte-identical to before A began",
    attackB1 === (await worldB()) ? '' : diff(attackB1, await worldB()),
  )

  // ---- 7. no office, no work ------------------------------------------------------------------------------------------------------
  const doors: Record<string, (o: string) => string> = {
    add_project_reference: (o) =>
      `public.add_project_reference(${o}, 'shared', 'https://x.example/d')`,
    archive_project: (o) => `public.archive_project(${o}, 'shared')`,
    create_automation: (o) =>
      `public.create_automation(${o}, 'shared', 'do the daily thing for the project please')`,
    hq_attach: (o) => `public.hq_attach(${o}, 'shared', 'upload', 'r')`,
    hq_connection_choose: (o) => `public.hq_connection_choose(${o}, 'shared', 'notion', 'clear')`,
    hq_create_project: (o) =>
      `public.hq_create_project(${o}, 'Door project', 'upload', 'door-ref')`,
    hq_dashboard_layout_reset: (o) => `public.hq_dashboard_layout_reset(${o}, 'shared')`,
    hq_dashboard_layout_set: (o) =>
      `public.hq_dashboard_layout_set(${o}, 'shared', '[{"id":"x"}]'::jsonb)`,
    hq_detach: (o) => `public.hq_detach(${o}, '${c.nobody()}')`,
    hq_plane_layout: (o) => `public.hq_plane_layout(${o}, '${shA}')`,
    hq_plane_layout_reset: (o) => `public.hq_plane_layout_reset(${o}, '${shA}')`,
    hq_plane_layout_set: (o) =>
      `public.hq_plane_layout_set(${o}, '${shA}', '{"n":{"x":1}}'::jsonb, '{}'::jsonb)`,
    hq_project_look: (o) => `public.hq_project_look(${o}, 'shared', 'rocket')`,
    hq_project_seen: (o) => `public.hq_project_seen(${o}, '${shA}')`,
    hq_projects: (o) => `public.hq_projects(${o})`,
    hq_reattach: (o) => `public.hq_reattach(${o}, '${c.nobody()}')`,
    hq_rename_project: (o) => `public.hq_rename_project(${o}, 'shared', 'A name')`,
    hq_workspace_layout: (o) => `public.hq_workspace_layout(${o})`,
    hq_workspace_layout_reset: (o) => `public.hq_workspace_layout_reset(${o})`,
    hq_workspace_layout_set: (o) =>
      `public.hq_workspace_layout_set(${o}, '[{"id":"x","x":0,"y":0,"w":1,"h":1}]'::jsonb)`,
    machine_project_ok: (o) => `public.machine_project_ok(${o}, 'shared')`,
    project_automations: (o) => `public.project_automations(${o}, '${shA}')`,
    project_team: (o) => `public.project_team(${o}, '${shA}')`,
    remove_automation: (o) => `public.remove_automation(${o}, 'nothing')`,
    remove_project_reference: (o) => `public.remove_project_reference(${o}, '${c.nobody()}')`,
    say_in_project: (o) => `public.say_in_project(${o}, '${shA}', 'hello')`,
    set_automation: (o) => `public.set_automation(${o}, 'nothing', true)`,
    set_project_instruction: (o) =>
      `public.set_project_instruction(${o}, 'shared', 'research-director', '')`,
    set_project_staff: (o) => `public.set_project_staff(${o}, 'shared', 'finance-director', true)`,
    staff_on_project: (o) => `public.staff_on_project(${o}, '${shA}')`,
    unarchive_project: (o) => `public.unarchive_project(${o}, 'nothing')`,
  }
  const listed = (await c.db.execute(`select 1`)).rows.length // keep the connection warm
  void listed
  const expected = 31
  c.check(
    Object.keys(doors).length === expected,
    `every one of the ${String(expected)} functions has a door probe`,
    String(Object.keys(doors).length),
  )
  let leaked = 0
  for (const [name, mk] of Object.entries(doors)) {
    for (const [what, office] of [
      ['a null office', 'null::uuid'],
      ['an office that does not exist', `${q(c.nobody())}::uuid`],
    ] as const) {
      const msg = await c.refusal(S, `select ${mk(office)}`)
      if (!msg.includes('no_office')) {
        leaked += 1
        c.check(false, `${name}: ${what} is refused`, msg.slice(0, 80))
      }
    }
  }
  c.check(
    leaked === 0,
    'all 31 doors refuse a null office and a nonexistent office with no_office',
    `${String(leaked)} did not`,
  )

  // ---- 8. the doors are shut to the browser's own roles -----------------------------------------------------------------------------
  let open = 0
  for (const [name, mk] of Object.entries(doors))
    for (const role of callerRoles) {
      const msg = await c.refusal(role, `select ${mk(q(A))}`)
      if (!msg.includes('permission denied')) {
        open += 1
        c.check(false, `${role} cannot call ${name}`, msg.slice(0, 80))
      }
    }
  c.check(
    open === 0,
    'anon and authenticated cannot execute any of the 31 doors',
    `${String(open)} open`,
  )

  // ---- 9. no legacy door is left, and the bridge was not needed ----------------------------------------------------------------------
  const legacy = (
    await c.db.execute(`
      select p.pronamespace::regnamespace::text || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
        from pg_proc p
       where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
         and p.proname in ('add_project_reference','archive_project','create_automation','hq_attach','hq_connection_choose','hq_create_project','hq_detach','hq_project_look','hq_project_seen','hq_projects','hq_reattach','hq_rename_project','machine_project_ok','project_automations','project_team','remove_automation','remove_project_reference','say_in_project','set_automation','set_project_instruction','set_project_staff','staff_on_project','unarchive_project','hq_dashboard_layout_reset','hq_dashboard_layout_set','hq_plane_layout','hq_plane_layout_reset','hq_plane_layout_set','hq_workspace_layout','hq_workspace_layout_reset','hq_workspace_layout_set')
         and pg_get_function_identity_arguments(p.oid) not like 'p_office uuid%'`)
  ).rows as { sig: string }[]
  c.check(
    legacy.length === 0,
    'no overload without an office is left in either schema',
    c.json(legacy).slice(0, 120),
  )
  const bridge1 = await bridgeNow()
  c.check(
    bridge1 === bridge0,
    'the converted writers never relied on the compatibility bridge (projects, duties, commands, layouts, undo, jobs)',
    `bridge uses ${String(bridge0)} -> ${String(bridge1)}`,
  )

  // tidy: the two members this file added (the P2 suite counts members)
  await c.db.execute(
    `delete from public.office_members where email in ('person.a@example.invalid', 'person.b@example.invalid')`,
  )
}
