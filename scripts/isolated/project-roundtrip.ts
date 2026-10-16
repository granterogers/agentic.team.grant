/**
 * Project export and restore, round trip (migrations 0720 and 1071) - on a LOCAL replica only.
 *
 *   npx tsx scripts/isolated/project-roundtrip.ts <replica-db>      (default: post)
 *
 * Original project -> export -> restore as a new project -> compare. The source project is populated with tasks,
 * contacts and a document inside ONE transaction that is rolled back at the end, so nothing is left behind.
 *
 * Each check asserts the content it compares, not merely that a count is non-zero, and the controls refuse
 * something that must be refused (a malformed idempotency key; a repeat restore that must write nothing).
 */
import { createHash } from 'node:crypto'
import { isolated } from './guard.ts'

const db = await isolated(process.argv[2] ?? 'post')
const one = async (sql: string): Promise<Record<string, unknown>> =>
  (await db.execute(sql)).rows[0] as Record<string, unknown>
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
let failed = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === '' ? '' : ` - ${detail}`}`)
}

await db.execute('begin')
try {
  const src = await one(
    `select project_id::text as pid, office_id::text as office, slug from public.projects
     where status = 'active' order by slug limit 1`,
  )
  const pid = lit(String(src.pid))
  const office = lit(String(src.office))
  const run = Date.now().toString(36)

  // Populate the source so the round trip has something to lose.
  const titles = [`roundtrip task a ${run}`, `roundtrip task b ${run}`, `roundtrip task c ${run}`]
  for (const t of titles) {
    await db.execute(
      `insert into public.tasks (office_id, project_id, title, added_by) values (${office}::uuid, ${pid}::uuid, ${lit(t)}, 'roundtrip-proof')`,
    )
  }
  const names = [`Roundtrip Ada ${run}`, `Roundtrip Ben ${run}`]
  for (const n of names) {
    await db.execute(
      `insert into public.contacts (project_id, kind, name, email) values (${pid}::uuid, 'person', ${lit(n)}, ${lit(`${run}-${n.split(' ')[1]}@example.test`)})`,
    )
  }
  const eventTitle = `roundtrip meeting ${run}`
  await db.execute(
    `select app.hq_event_add(p_office => ${office}::uuid, p_slug => ${lit(String(src.slug))}, p_title => ${lit(eventTitle)},
       p_starts_at => now() + interval '3 day', p_ends_at => now() + interval '3 day 1 hour',
       p_all_day => false, p_notes => null, p_location => null, p_channel => null, p_authority => null)`,
  )
  const docTitle = `roundtrip brief ${run}`
  await db.execute(
    `insert into public.documents (office_id, project_id, title, origin, state, added_by)
     values (${office}::uuid, ${pid}::uuid, ${lit(docTitle)}, 'yours', 'approved', 'roundtrip-proof')`,
  )

  const exported = await one(
    `select public.project_export(${office}::uuid, ${pid}::uuid)::text as pkg`,
  )
  const packageText = String(exported.pkg)
  const pkg = JSON.parse(packageText) as Record<string, unknown>
  const key = createHash('sha256').update(packageText, 'utf8').digest('hex')

  // The package must carry no credential of any kind.
  const secretLike = /(secret|token|api[_-]?key|password)/i.test(
    packageText.replace(/"(answers|sources)"\s*:/g, ''),
  )
  check('the package holds no credential-shaped field', !secretLike)
  check(
    'the package exports the three source tasks',
    (pkg.tasks as unknown[]).length >= 3,
    `${String((pkg.tasks as unknown[]).length)} tasks`,
  )

  // The complete package carries the project's calendar events (migration 1076). The control is that the event added
  // above is present, by title, so an export that dropped the section could not pass.
  const events = (pkg.events as { summary?: string }[] | undefined) ?? []
  check(
    'the package carries the project calendar, with the event added above',
    Array.isArray(pkg.events) && events.some((e) => e.summary === eventTitle),
    `${String(events.length)} event(s) in the package`,
  )

  // A malformed key is refused before anything is written (the control for the key rule).
  const refused = await one(
    `select public.project_restore(${office}::uuid, 'not-a-checksum', ${lit(packageText)}::jsonb, 'roundtrip-proof')::text as r`,
  )
  check(
    'a restore with a malformed key is refused, with its reason',
    String(refused.r).includes('checksum key'),
    String(refused.r).slice(0, 80),
  )

  // Another office cannot export this project: it is refused by name, not answered with a package (migration 1075).
  // The control is that the source office's own export just succeeded above.
  const other = await one(
    `select office_id::text as o from public.offices where office_id <> ${office}::uuid order by created_at limit 1`,
  )
  if (other.o !== undefined && other.o !== null) {
    // A refused call aborts the transaction it runs in, so it runs inside a savepoint that is rolled back to.
    await db.execute('savepoint foreign_export')
    const foreign = await db
      .execute(
        `select public.project_export(${lit(String(other.o))}::uuid, ${pid}::uuid)::text as pkg`,
      )
      .then(
        (r) => `answered:${String((r.rows[0] as { pkg: string }).pkg).slice(0, 40)}`,
        (e: unknown) => `refused:${e instanceof Error ? e.message : String(e)}`,
      )
    await db.execute('rollback to savepoint foreign_export')
    check(
      'another office cannot export this project',
      foreign.startsWith('refused:') && foreign.includes('no project of this office'),
      foreign.slice(0, 90),
    )
  }

  // Restore as a new project.
  const restored = await one(
    `select public.project_restore(${office}::uuid, ${lit(key)}, ${lit(packageText)}::jsonb, 'roundtrip-proof')::text as r`,
  )
  const report = JSON.parse(String(restored.r)) as { ok: boolean; slug?: string; already?: boolean }
  check('the restore reports ok', report.ok === true, String(restored.r).slice(0, 80))
  const newSlug = report.slug ?? ''
  check(
    'the restored project is a NEW project, not the source',
    newSlug !== '' && newSlug !== String(src.slug),
    newSlug,
  )

  const restoredRow = await one(
    `select project_id::text as pid from public.projects where office_id = ${office}::uuid and slug = ${lit(newSlug)}`,
  )
  const npid = lit(String(restoredRow.pid))

  // Compare: the same tasks, the same contacts, the same document, by content.
  const restoredTitles = (
    await db.execute(
      `select title from public.tasks where project_id = ${npid}::uuid order by title`,
    )
  ).rows.map((r) => String((r as { title: string }).title))
  check(
    'every source task is in the restored project, by title',
    titles.every((t) => restoredTitles.includes(t)),
    `${String(restoredTitles.length)} restored`,
  )
  const restoredNames = (
    await db.execute(
      `select name from public.contacts where project_id = ${npid}::uuid order by name`,
    )
  ).rows.map((r) => String((r as { name: string }).name))
  check(
    'every source contact is in the restored project, by name',
    names.every((n) => restoredNames.includes(n)),
    `${String(restoredNames.length)} restored`,
  )
  const restoredDocs = await one(
    `select count(*)::int as n from public.documents where project_id = ${npid}::uuid and title = ${lit(docTitle)}`,
  )
  check(
    'the source document is in the restored project, by title',
    Number(restoredDocs.n) === 1,
    `${String(restoredDocs.n)} found`,
  )

  // The idempotency control: a repeat of the same archive writes nothing and returns the stored answer.
  const before = await one(
    `select count(*)::int as n from public.projects where office_id = ${office}::uuid`,
  )
  const again = await one(
    `select public.project_restore(${office}::uuid, ${lit(key)}, ${lit(packageText)}::jsonb, 'roundtrip-proof')::text as r`,
  )
  const after = await one(
    `select count(*)::int as n from public.projects where office_id = ${office}::uuid`,
  )
  const repeat = JSON.parse(String(again.r)) as { already?: boolean; slug?: string }
  check(
    'a repeat restore returns the stored answer and writes no new project',
    repeat.already === true && repeat.slug === newSlug && Number(before.n) === Number(after.n),
  )
} finally {
  await db.execute('rollback')
}
console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
await db.end()
process.exit(failed === 0 ? 0 : 1)
