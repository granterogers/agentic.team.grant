/**
 * The contact functions (migration 0730): contacts, contact labels and their links, the contact photograph path,
 * the archived-project list, and the contact branches of undo. Person A and Person B each have a project with the
 * SAME slug and a contact with the SAME name and the SAME email, so any lookup that is not scoped to the office
 * finds the wrong one.
 */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B, canary } = c
  const S = 'service_role'
  const q = (office: string) => lit(office)
  const SHARED_EMAIL = `shared-${canary.A.slice(-6)}@example.test`
  const TAG = canary.A.slice(-8).toLowerCase()
  const SLUG = `ctc-shared-${TAG}`
  const ONLY_B = `ctc-only-b-${TAG}`
  const ARCH_A = `ctc-arch-a-${TAG}`
  const ARCH_B = `ctc-arch-b-${TAG}`
  const TWIN = `Pat Twin ${TAG}`
  const SHARED_LABEL = `Shared label ${TAG}`

  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values ('${SLUG}', 'Contacts ${who}', 'paused', '${office}') on conflict do nothing`,
    )
  }

  /** A digest of everything an office holds in the contact tables: contacts (through its projects), labels, links. */
  const contactState = async (office: string): Promise<string> => {
    const r = await c.db.execute(
      `select
         (select coalesce(md5(string_agg(x::text, '|' order by x::text)), '-')
            from public.contacts x join public.projects p on p.project_id = x.project_id where p.office_id = '${office}') as contacts,
         (select coalesce(md5(string_agg(l::text, '|' order by l::text)), '-')
            from public.contact_labels l where l.office_id = '${office}') as labels,
         (select coalesce(md5(string_agg(k::text, '|' order by k::text)), '-')
            from public.contact_label_links k join public.contacts x on x.contact_id = k.contact_id
            join public.projects p on p.project_id = x.project_id where p.office_id = '${office}') as links`,
    )
    const row = r.rows[0] as { contacts: string; labels: string; links: string }
    return `${row.contacts}/${row.labels}/${row.links}`
  }
  const bridgeBefore = (
    (
      await c.db.execute(
        `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in ('contact_labels','undoable_actions')`,
      )
    ).rows[0] as { n: number }
  ).n

  // ---- the writers put everything in the caller's office; the same slug, name and email are two contacts -------------------
  const addA = (await c.exec(
    S,
    `select public.hq_contact_add(${q(A)}, '${SLUG}', ${lit(`${canary.A} Pat`)}, p_email => ${lit(SHARED_EMAIL)}, p_phone => '111-A')`,
  )) as { id: string; error?: string }
  const addB = (await c.exec(
    S,
    `select public.hq_contact_add(${q(B)}, '${SLUG}', ${lit(`${canary.B} Pat`)}, p_email => ${lit(SHARED_EMAIL)}, p_phone => '222-B')`,
  )) as { id: string; error?: string }
  c.check(
    typeof addA.id === 'string' && typeof addB.id === 'string',
    'A and B each add a contact to the project both call "ctc-shared", with the SAME email',
    c.json([addA, addB]).slice(0, 140),
  )
  const sameNameA = (await c.exec(
    S,
    `select public.hq_contact_add(${q(A)}, '${SLUG}', ${lit(TWIN)}, p_email => ${lit(SHARED_EMAIL)})`,
  )) as { id?: string }
  const sameNameB = (await c.exec(
    S,
    `select public.hq_contact_add(${q(B)}, '${SLUG}', ${lit(TWIN)}, p_email => ${lit(SHARED_EMAIL)})`,
  )) as { id?: string }
  c.check(
    typeof sameNameA.id === 'string' && typeof sameNameB.id === 'string',
    'the same NAME and the same EMAIL in two offices are two independent contacts (the duplicate check is per office)',
    c.json([sameNameA, sameNameB]).slice(0, 140),
  )
  const dupInOffice = (await c.exec(
    S,
    `select public.hq_contact_add(${q(A)}, '${SLUG}', ${lit(TWIN.toUpperCase())})`,
  )) as { error?: string }
  c.check(
    typeof dupInOffice.error === 'string' && dupInOffice.error.includes('already a contact'),
    'inside ONE office the same name on the project is still refused',
    c.json(dupInOffice).slice(0, 100),
  )
  const where = async (id: string) =>
    (
      await c.db.execute(
        `select p.office_id, x.email from public.contacts x join public.projects p using (project_id) where x.contact_id = '${id}'`,
      )
    ).rows[0] as { office_id: string; email: string }
  const wa = await where(addA.id)
  const wb = await where(addB.id)
  c.check(
    wa.office_id === A &&
      wb.office_id === B &&
      wa.email === SHARED_EMAIL &&
      wb.email === SHARED_EMAIL,
    "each contact is filed under its own office's project",
    '',
  )
  const noProject = c.json(
    await c.exec(S, `select public.hq_contact_add(${q(A)}, '${ONLY_B}', 'Nobody')`),
  )
  await c.db.execute(
    `insert into public.projects (slug, name, status, office_id) values ('${ONLY_B}', 'B only', 'paused', '${B}') on conflict do nothing`,
  )
  const foreignProject = c.json(
    await c.exec(S, `select public.hq_contact_add(${q(A)}, '${ONLY_B}', 'Nobody')`),
  )
  c.check(
    noProject === foreignProject,
    "B's private project slug answers A exactly as a slug that exists nowhere does",
    foreignProject.slice(0, 90),
  )
  const strayInB = (
    await c.db.execute(
      `select count(*)::int as n from public.contacts x join public.projects p using (project_id) where p.slug = '${ONLY_B}'`,
    )
  ).rows[0] as { n: number }
  c.check(strayInB.n === 0, "no contact landed in B's private project", String(strayInB.n))

  // ---- labels: the same name in two offices is two labels, and each list is its own -------------------------------------------
  const labA = (await c.exec(
    S,
    `select public.hq_contact_label_add(${q(A)}, ${lit(`${canary.A} VIP`)})`,
  )) as { ok: boolean; label: string; labels: { id: string; name: string }[] }
  const labB = (await c.exec(
    S,
    `select public.hq_contact_label_add(${q(B)}, ${lit(`${canary.B} VIP`)})`,
  )) as { ok: boolean; label: string; labels: { id: string; name: string }[] }
  c.check(
    labA.ok === true && labB.ok === true,
    'A and B each create a label',
    c.json([labA, labB]).slice(0, 100),
  )
  const sameLabelA = (await c.exec(
    S,
    `select public.hq_contact_label_add(${q(A)}, ${lit(SHARED_LABEL)})`,
  )) as {
    ok?: boolean
  }
  const sameLabelB = (await c.exec(
    S,
    `select public.hq_contact_label_add(${q(B)}, ${lit(SHARED_LABEL)})`,
  )) as {
    ok?: boolean
  }
  c.check(
    sameLabelA.ok === true && sameLabelB.ok === true,
    'the same label NAME in two offices is allowed (the uniqueness is per office)',
    c.json([sameLabelA, sameLabelB]).slice(0, 100),
  )
  const dupLabel = (await c.exec(
    S,
    `select public.hq_contact_label_add(${q(A)}, ${lit(SHARED_LABEL.toUpperCase().replace(' ', '  '))})`,
  )) as {
    error?: string
  }
  c.check(
    typeof dupLabel.error === 'string' && dupLabel.error.includes('already a label'),
    'inside ONE office the same label name is refused',
    c.json(dupLabel).slice(0, 100),
  )
  const listA = c.json(labA.labels)
  c.check(
    listA.includes(canary.A) && !listA.includes(canary.B),
    "A's label list holds A's canary and not B's",
    '',
  )
  const listB = c.json(labB.labels)
  c.check(
    listB.includes(canary.B) && !listB.includes(canary.A),
    "B's label list holds B's canary and not A's",
    '',
  )
  const owners = (
    await c.db.execute(
      `select office_id, owner from public.contact_labels where label_id in ('${labA.label}','${labB.label}') order by office_id`,
    )
  ).rows as { office_id: string; owner: string }[]
  c.check(
    owners.length === 2 && owners.every((o) => o.owner !== 'grant'),
    'a label created for a person other than Grant is not stamped as "grant"',
    c.json(owners).slice(0, 120),
  )

  // ---- A gives its own contact a label, a field, a photograph: the positive controls --------------------------------------
  const setLabelA = (await c.exec(
    S,
    `select public.hq_contact_labels_set(${q(A)}, '${addA.id}', jsonb_build_array('${labA.label}'::text))`,
  )) as { ok?: boolean; undo?: string }
  c.check(setLabelA.ok === true, "A can label A's contact", c.json(setLabelA).slice(0, 80))
  const linkRows = (
    await c.db.execute(
      `select l.office_id, k.owner from public.contact_label_links k join public.contact_labels l on l.owner = k.owner and l.label_id = k.label_id where k.contact_id = '${addA.id}'`,
    )
  ).rows as { office_id: string; owner: string }[]
  c.check(
    linkRows.length === 1 && linkRows[0]?.office_id === A,
    "the link carries the label's own owner and office",
    c.json(linkRows).slice(0, 100),
  )
  const fieldsA = (await c.exec(
    S,
    `select public.hq_contact_fields_set(${q(A)}, '${addA.id}', ${lit(JSON.stringify([{ label: 'Spouse', value: canary.A }]))}::jsonb)`,
  )) as { ok?: boolean; undo?: string }
  c.check(fieldsA.ok === true, "A can set fields on A's contact", c.json(fieldsA).slice(0, 80))
  const photoOwn = (await c.exec(
    S,
    `select public.hq_contact_photo_set(${q(A)}, '${addA.id}', (select project_id::text from public.projects where office_id = '${A}' and slug = '${SLUG}') || '/contacts/${addA.id}.jpg')`,
  )) as { ok?: boolean; error?: string }
  c.check(
    photoOwn.ok === true,
    "A can record a photograph under A's own project",
    c.json(photoOwn).slice(0, 80),
  )
  const photoOfficePrefix = (await c.exec(
    S,
    `select public.hq_contact_photo_set(${q(A)}, '${addA.id}', '${A}/contacts/${addA.id}.png')`,
  )) as { ok?: boolean }
  c.check(photoOfficePrefix.ok === true, "A can record a photograph under A's office prefix", '')

  // ---- the photograph path cannot point into somebody else's folder ------------------------------------------------------------
  const bProject = (
    (
      await c.db.execute(
        `select project_id from public.projects where office_id = '${B}' and slug = '${SLUG}'`,
      )
    ).rows[0] as { project_id: string }
  ).project_id
  const aProject = (
    (
      await c.db.execute(
        `select project_id from public.projects where office_id = '${A}' and slug = '${SLUG}'`,
      )
    ).rows[0] as { project_id: string }
  ).project_id
  const photoBefore = await contactState(A)
  for (const [what, path] of [
    ["another office's project folder", `${bProject}/contacts/${addB.id}.jpg`],
    ["another office's prefix", `${B}/contacts/${addB.id}.jpg`],
    ['a path that climbs out of the folder', `${aProject}/contacts/../${bProject}/contacts/x.jpg`],
    ['an unrelated path', 'somewhere/else.jpg'],
    ['a path under the project but not under its contacts folder', `${aProject}/documents/x.pdf`],
  ] as const) {
    const r = (await c.exec(
      S,
      `select public.hq_contact_photo_set(${q(A)}, '${addA.id}', ${lit(path)})`,
    )) as { error?: string; ok?: boolean }
    c.check(
      r.ok !== true && typeof r.error === 'string',
      `a photograph path into ${what} is refused`,
      c.json(r).slice(0, 100),
    )
  }
  c.check(
    photoBefore === (await contactState(A)),
    'and the refused photograph paths changed nothing',
    '',
  )
  const removePhoto = (await c.exec(
    S,
    `select public.hq_contact_photo_set(${q(A)}, '${addA.id}', null)`,
  )) as {
    ok?: boolean
  }
  c.check(removePhoto.ok === true, 'removing a photograph (no path) is always allowed', '')

  // ---- a foreign id and a nonexistent id get THE SAME ANSWER, and nothing of B's moves -----------------------------------------
  const bBefore = await contactState(B)
  const bUndoBefore = await c.snapshot(B, ['undoable_actions'])
  const nobody = c.nobody()
  const same = async (what: string, mk: (id: string) => string, foreignId: string) => {
    const foreign = c.json(await c.exec(S, mk(foreignId)))
    const missing = c.json(await c.exec(S, mk(nobody)))
    c.check(
      foreign === missing,
      `${what}: B's id and a nonexistent id are indistinguishable to A`,
      foreign === missing
        ? foreign.slice(0, 80)
        : `${foreign.slice(0, 60)} vs ${missing.slice(0, 60)}`,
    )
  }
  await same(
    'hq_contact_update',
    (id) =>
      `select public.hq_contact_update(${q(A)}, '${id}', p_name => 'taken', p_email => 'taken@x.test')`,
    addB.id,
  )
  await same(
    'hq_contact_archive',
    (id) => `select public.hq_contact_archive(${q(A)}, '${id}')`,
    addB.id,
  )
  await same(
    'hq_contact_archive (bring back)',
    (id) => `select public.hq_contact_archive(${q(A)}, '${id}', false)`,
    addB.id,
  )
  await same(
    'hq_contact_fields_set',
    (id) =>
      `select public.hq_contact_fields_set(${q(A)}, '${id}', '[{"label":"x","value":"taken"}]'::jsonb)`,
    addB.id,
  )
  await same(
    'hq_contact_labels_set',
    (id) => `select public.hq_contact_labels_set(${q(A)}, '${id}', '[]'::jsonb)`,
    addB.id,
  )
  await same(
    'hq_contact_photo_set',
    (id) =>
      `select public.hq_contact_photo_set(${q(A)}, '${id}', '${aProject}/contacts/${id}.jpg')`,
    addB.id,
  )
  await same(
    'hq_contact_label_rename',
    (id) => `select public.hq_contact_label_rename(${q(A)}, '${id}', 'taken')`,
    labB.label,
  )
  await same(
    'hq_contact_label_remove',
    (id) => `select public.hq_contact_label_remove(${q(A)}, '${id}')`,
    labB.label,
  )
  // A tries to hang B's LABEL on A's own contact: a label of another office does not exist to A.
  await same(
    "hq_contact_labels_set with another office's label",
    (id) =>
      `select public.hq_contact_labels_set(${q(A)}, '${addA.id}', jsonb_build_array('${id}'::text))`,
    labB.label,
  )
  await same('hq_undo of an action id', (id) => `select public.hq_undo(${q(A)}, '${id}')`, nobody)
  c.check(
    bBefore === (await contactState(B)),
    "nothing of B's (contacts, labels, links) moved while A attacked",
    '',
  )
  c.check(
    bUndoBefore === (await c.snapshot(B, ['undoable_actions'])),
    "and B's undo offers are unchanged",
    '',
  )

  // ---- and the other way round: B attacks A -------------------------------------------------------------------------------------
  const aBefore = await contactState(A)
  const rb = c.json(
    await c.exec(
      S,
      `select jsonb_build_array(
         public.hq_contact_update(${q(B)}, '${addA.id}', p_name => 'taken'),
         public.hq_contact_archive(${q(B)}, '${addA.id}'),
         public.hq_contact_label_remove(${q(B)}, '${labA.label}'),
         public.hq_contact_label_rename(${q(B)}, '${labA.label}', 'taken'),
         public.hq_contact_photo_set(${q(B)}, '${addA.id}', null))`,
    ),
  )
  c.check(
    !rb.includes('"ok":true') && aBefore === (await contactState(A)),
    "B cannot touch A's contact or label, and A's state is unchanged",
    rb.slice(0, 120),
  )

  // ---- a reader's output never holds the other office's canary --------------------------------------------------------------------
  await c.db.execute(
    `insert into public.projects (slug, name, status, office_id) values ('${ARCH_A}', ${lit(`${canary.A} Archived`)}, 'archived', '${A}'), ('${ARCH_B}', ${lit(`${canary.B} Archived`)}, 'archived', '${B}') on conflict do nothing`,
  )
  for (const [office, slug] of [
    [A, ARCH_A],
    [B, ARCH_B],
  ] as const) {
    await c.db.execute(
      `insert into public.contacts (project_id, name) select project_id, 'held there' from public.projects where office_id = '${office}' and slug = '${slug}'`,
    )
  }
  const recA = c.json(await c.exec(S, `select public.recoverable_projects(${q(A)})`))
  const recB = c.json(await c.exec(S, `select public.recoverable_projects(${q(B)})`))
  c.check(
    recA.includes(canary.A) && !recA.includes(canary.B),
    "A's recoverable projects hold A's archived project and not B's",
    recA.slice(0, 100),
  )
  c.check(
    recB.includes(canary.B) && !recB.includes(canary.A),
    "B's recoverable projects hold B's archived project and not A's",
    '',
  )
  // a project of another office held by documents of this office does not count: the count is the office's own
  const heldA = (JSON.parse(recA) as { slug: string; held: number }[]).find(
    (r) => r.slug === ARCH_A,
  )
  c.check(
    heldA?.held === 1,
    'what an archived project holds is counted inside the office',
    c.json(heldA),
  )

  // ---- undo: the six contact branches perform inside the office ---------------------------------------------------------------------
  const upd = (await c.exec(
    S,
    `select public.hq_contact_update(${q(A)}, '${addA.id}', p_name => ${lit(`${canary.A} Renamed`)}, p_phone => '999')`,
  )) as { ok?: boolean; undo?: string }
  c.check(
    typeof upd.undo === 'string',
    "A can change A's contact and is offered an undo",
    c.json(upd).slice(0, 80),
  )
  const crossUndo = c.json(await c.exec(S, `select public.hq_undo(${q(B)}, '${upd.undo ?? ''}')`))
  c.check(
    crossUndo === c.json(await c.exec(S, `select public.hq_undo(${q(B)}, '${c.nobody()}')`)),
    "B cannot undo A's contact change, and cannot tell it exists",
    crossUndo.slice(0, 80),
  )
  const undoUpd = (await c.exec(S, `select public.hq_undo(${q(A)}, '${upd.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const restored = (
    await c.db.execute(`select name, phone from public.contacts where contact_id = '${addA.id}'`)
  ).rows[0] as { name: string; phone: string }
  c.check(
    undoUpd.ok === true && restored.name === `${canary.A} Pat` && restored.phone === '111-A',
    "A can undo A's contact change (contact_update branch)",
    c.json(restored),
  )

  const arch = (await c.exec(
    S,
    `select public.hq_contact_archive(${q(A)}, '${sameNameA.id}')`,
  )) as {
    undo?: string
  }
  const undoArch = (await c.exec(S, `select public.hq_undo(${q(A)}, '${arch.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const archived = (
    await c.db.execute(
      `select archived_at from public.contacts where contact_id = '${sameNameA.id}'`,
    )
  ).rows[0] as { archived_at: string | null }
  c.check(
    undoArch.ok === true && archived.archived_at === null,
    'A can put a contact away and undo it (contact_archive branch)',
    c.json(undoArch).slice(0, 80),
  )

  const ren = (await c.exec(
    S,
    `select public.hq_contact_label_rename(${q(A)}, '${labA.label}', 'Renamed VIP')`,
  )) as {
    undo?: string
    ok?: boolean
  }
  const undoRen = (await c.exec(S, `select public.hq_undo(${q(A)}, '${ren.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const labName = (
    await c.db.execute(`select name from public.contact_labels where label_id = '${labA.label}'`)
  ).rows[0] as { name: string }
  c.check(
    ren.ok === true && undoRen.ok === true && labName.name === `${canary.A} VIP`,
    'A can rename a label and undo it (contact_label_rename branch)',
    c.json(labName),
  )

  const lset = (await c.exec(
    S,
    `select public.hq_contact_labels_set(${q(A)}, '${addA.id}', '[]'::jsonb)`,
  )) as {
    undo?: string
  }
  const undoLset = (await c.exec(S, `select public.hq_undo(${q(A)}, '${lset.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const linksNow = (
    await c.db.execute(
      `select count(*)::int as n from public.contact_label_links where contact_id = '${addA.id}'`,
    )
  ).rows[0] as { n: number }
  c.check(
    undoLset.ok === true && linksNow.n === 1,
    "A can clear a contact's labels and undo it (contact_labels_set branch)",
    c.json(undoLset).slice(0, 80),
  )

  const fset = (await c.exec(
    S,
    `select public.hq_contact_fields_set(${q(A)}, '${addA.id}', '[]'::jsonb)`,
  )) as {
    undo?: string
  }
  const undoFset = (await c.exec(S, `select public.hq_undo(${q(A)}, '${fset.undo ?? ''}')`)) as {
    ok?: boolean
  }
  const fieldsNow = (
    await c.db.execute(`select fields from public.contacts where contact_id = '${addA.id}'`)
  ).rows[0] as { fields: { value: string }[] }
  c.check(
    undoFset.ok === true && fieldsNow.fields[0]?.value === canary.A,
    "A can clear a contact's fields and undo it (contact_fields_set branch)",
    c.json(undoFset).slice(0, 80),
  )

  const pset = (await c.exec(
    S,
    `select public.hq_contact_photo_set(${q(A)}, '${addA.id}', '${aProject}/contacts/${addA.id}.webp')`,
  )) as { undo?: string }
  const undoPset = (await c.exec(S, `select public.hq_undo(${q(A)}, '${pset.undo ?? ''}')`)) as {
    ok?: boolean
  }
  c.check(
    undoPset.ok === true,
    'A can change a photograph and undo it (contact_photo_set branch)',
    c.json(undoPset).slice(0, 80),
  )

  // ---- removing a label counts only the office's own links; the cascade stays inside the office ---------------------------------
  await c.exec(
    S,
    `select public.hq_contact_labels_set(${q(B)}, '${addB.id}', jsonb_build_array('${labB.label}'::text))`,
  )
  const bLinks = await contactState(B)
  const rm = (await c.exec(
    S,
    `select public.hq_contact_label_remove(${q(A)}, '${labA.label}')`,
  )) as {
    ok?: boolean
    removed_from?: number
    labels?: unknown
  }
  c.check(
    rm.ok === true && rm.removed_from === 1 && !c.json(rm.labels).includes(canary.B),
    "A removes A's label: it was on one contact, and the answer lists no label of B's",
    c.json(rm).slice(0, 100),
  )
  c.check(
    bLinks === (await contactState(B)),
    "removing A's label left B's labels and links alone",
    '',
  )

  // ---- no office, no work ----------------------------------------------------------------------------------------------------------
  const calls: readonly [string, (office: string) => string][] = [
    ['hq_contact_add', (o) => `select public.hq_contact_add(${o}, '${SLUG}', 'x')`],
    [
      'hq_contact_update',
      (o) => `select public.hq_contact_update(${o}, '${addA.id}', p_name => 'x')`,
    ],
    ['hq_contact_archive', (o) => `select public.hq_contact_archive(${o}, '${addA.id}')`],
    [
      'hq_contact_fields_set',
      (o) => `select public.hq_contact_fields_set(${o}, '${addA.id}', '[]'::jsonb)`,
    ],
    [
      'hq_contact_labels_set',
      (o) => `select public.hq_contact_labels_set(${o}, '${addA.id}', '[]'::jsonb)`,
    ],
    ['hq_contact_photo_set', (o) => `select public.hq_contact_photo_set(${o}, '${addA.id}', null)`],
    ['hq_contact_label_add', (o) => `select public.hq_contact_label_add(${o}, 'x')`],
    [
      'hq_contact_label_rename',
      (o) => `select public.hq_contact_label_rename(${o}, '${labB.label}', 'x')`,
    ],
    [
      'hq_contact_label_remove',
      (o) => `select public.hq_contact_label_remove(${o}, '${labB.label}')`,
    ],
    ['recoverable_projects', (o) => `select public.recoverable_projects(${o})`],
  ]
  for (const [fn, mk] of calls) {
    for (const [what, office] of [
      ['a null office', 'null::uuid'],
      ['an office that does not exist', `${lit(c.nobody())}::uuid`],
    ] as const) {
      const msg = await c.refusal(S, mk(office))
      c.check(msg.includes('no_office'), `${fn}: ${what} is refused`, msg.slice(0, 80))
    }
  }

  // ---- the doors are shut to the browser's own roles ---------------------------------------------------------------------------------
  for (const [fn, mk] of calls) {
    for (const role of callerRoles) {
      const msg = await c.refusal(role, mk(q(A)))
      c.check(msg.includes('permission denied'), `${role} cannot call ${fn}`, msg.slice(0, 80))
    }
  }

  // ---- the app side is not a door at all -----------------------------------------------------------------------------------------------
  const appDoor = await c.refusal(
    S,
    `select app.hq_contact_update(${q(A)}, '${addA.id}', p_name => 'x')`,
  )
  c.check(
    appDoor.includes('permission denied'),
    'service_role cannot reach app.hq_contact_update directly',
    appDoor.slice(0, 80),
  )

  // ---- the old, unscoped signatures are gone ---------------------------------------------------------------------------------------------
  const old = (
    await c.db.execute(
      `select count(*)::int as n from pg_proc p
        where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
          and p.proname in ('hq_contact_add','hq_contact_update','hq_contact_archive','hq_contact_fields_set',
                            'hq_contact_labels_set','hq_contact_photo_set','hq_contact_label_add',
                            'hq_contact_label_rename','hq_contact_label_remove','recoverable_projects')
          and pg_get_function_arguments(p.oid) not like 'p_office uuid%'`,
    )
  ).rows[0] as { n: number }
  c.check(
    old.n === 0,
    'no overload of a contact function without an office survives',
    String(old.n),
  )

  // ---- and the bridge was not needed ---------------------------------------------------------------------------------------------------
  const bridgeAfter = (
    (
      await c.db.execute(
        `select coalesce(sum(n),0)::int as n from public.office_bridge_use where table_name in ('contact_labels','undoable_actions')`,
      )
    ).rows[0] as { n: number }
  ).n
  c.check(
    bridgeAfter === bridgeBefore,
    'the converted contact writers never relied on the compatibility bridge',
    `bridge uses on contact_labels/undoable_actions: before ${String(bridgeBefore)}, after ${String(bridgeAfter)}`,
  )
}
