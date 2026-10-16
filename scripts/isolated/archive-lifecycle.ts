/**
 * Project archive lifecycle (migration 1074) - the writers that refuse work on a project in a non-live state, driven with
 * real rows, on a LOCAL replica only.
 *
 *   npx tsx scripts/isolated/archive-lifecycle.ts <replica-db>      (default: post)
 *
 * A project being archived or restored is not live, so no writer may put work into it. Before 1074 two of the fourteen
 * readers that gate writes named only `archived`, so a task or an event could land in a project half way through its
 * archive. This proof drives two of those writers in every state, inside ONE transaction that is rolled back at the end,
 * so nothing is left behind.
 *
 * Each refusal asserts the REASON it was refused with, never merely that something was. The paused and active rows are
 * the controls: a rule that refused everything would fail them.
 */
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

const migrated = await one(
  `select count(*)::int as n from pg_constraint c join pg_class t on t.oid = c.conrelid
   where t.relname = 'projects' and c.conname = 'projects_status_known'
     and pg_get_constraintdef(c.oid) like '%archiving%restoring%'`,
)
if (Number(migrated.n) !== 1) {
  console.log('FAIL the replica does not carry migration 1074: apply it to this replica first')
  await db.end()
  process.exit(1)
} else {
  await db.execute('begin')
  try {
    const project = await one(
      `select p.slug, p.office_id::text as office from public.projects p
       where p.status = 'active' order by p.slug limit 1`,
    )
    const slug = String(project.slug)
    const office = String(project.office)
    const attempt = async (state: string, kind: 'task' | 'event'): Promise<string> => {
      await db.execute(
        `update public.projects set status = ${lit(state)} where slug = ${lit(slug)} and office_id = ${lit(office)}::uuid`,
      )
      const sql =
        kind === 'task'
          ? `select app.my_task_add(p_office => ${lit(office)}::uuid, p_title => ${lit(`lifecycle proof ${state}`)}, p_project => ${lit(slug)})::text as r`
          : `select app.hq_event_add(p_office => ${lit(office)}::uuid, p_slug => ${lit(slug)}, p_title => ${lit(`lifecycle proof ${state}`)},
              p_starts_at => now() + interval '1 day', p_ends_at => now() + interval '1 day 1 hour',
              p_all_day => false, p_notes => null, p_location => null, p_channel => null, p_authority => null)::text as r`
      return String((await one(sql)).r)
    }

    // The controls: a live project and a paused one still take work, exactly as before.
    for (const state of ['active', 'paused']) {
      const task = await attempt(state, 'task')
      check(
        `a ${state} project takes a task (control)`,
        task.includes('"ok": true') || task.includes('"ok":true'),
        task.slice(0, 80),
      )
      const event = await attempt(state, 'event')
      check(
        `a ${state} project takes an event (control)`,
        event.includes('"ok": true') || event.includes('"ok":true'),
        event.slice(0, 80),
      )
    }

    // The refusals: every state that is not live refuses work, and says why.
    for (const state of ['archiving', 'restoring', 'archived']) {
      const task = await attempt(state, 'task')
      check(
        `a ${state} project refuses a task`,
        task.includes('no active project') &&
          !task.includes('"ok": true') &&
          !task.includes('"ok":true'),
        task.slice(0, 100),
      )
      const event = await attempt(state, 'event')
      check(
        `a ${state} project refuses an event`,
        event.includes('no active project') &&
          !event.includes('"ok": true') &&
          !event.includes('"ok":true'),
        event.slice(0, 100),
      )
    }
  } finally {
    await db.execute('rollback')
  }
  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
  await db.end()
  process.exit(failed === 0 ? 0 : 1)
}
