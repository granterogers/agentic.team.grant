/**
 * The simulated world, made real enough to be asked about.
 *
 * ## The problem this solves
 *
 * #295. The corpus asks about `simgrant Match Funding Bid` and the live
 * office has never heard of it, so the office answers honestly that it has
 * no record, the evaluator scores the turn green, and nothing has been
 * measured. 68 of 132 scenarios and 40 of 66 families are in that position.
 *
 * ## Why these are FIXTURE projects and why that is now enough
 *
 * A real project resolves and is permanent: it gathers a job, a job can
 * never be deleted, `app.project_delete` refuses it for ever, and after
 * fifteen minutes `app.provision_missing_channels` earns it a Slack channel
 * that Slack cannot delete.
 *
 * A fixture project is exempt from all of that — 0419 requires
 * `not is_fixture` — and until migration 0534 could not be resolved by name,
 * because `app.resolve_project_by_name` filters fixtures and all four of its
 * scoring branches join that filter.
 *
 * 0534 gives the resolver the parameter `app.impediments_tally` has had
 * since 0297 and `app.my_tasks` since 0533. The production handler passes
 * `app.harness_job(job_id)`, which the database answers and which is false
 * for every message a person sends. So these projects are visible to
 * harness traffic and to nothing else: not to Grant's switcher, not to the
 * public wrapper, not to anything with a browser.
 *
 * ## Created ONCE and reused, deliberately
 *
 * Every function here is idempotent on the slug. A fixture project that has
 * gathered a job cannot be deleted either, so a world provisioned per RUN
 * would be the debris pile CLAUDE.md records being built twice. One world,
 * reused for ever, is infrastructure rather than litter — and `check:leaks`
 * counts it so it cannot quietly multiply.
 *
 * ## What this does NOT do
 *
 * It does not simulate the office. Nothing here answers a question, routes a
 * request, plans, or writes an output. It writes rows of the same shape the
 * real product writes, and then every message goes through the real
 * understanding, planning, routing, execution, persistence and response
 * path. A world is state, not a fork.
 */

import type { SqlExecutor } from '../db/executor.ts'
import { DEFAULT_WORLD } from './world.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The slug prefix, which is what makes every one of these a fixture.
 *
 * `projects.is_fixture` is GENERATED from the slug — `fixture-%`,
 * `verify-%` or `ledger-proof-%` — so the prefix is not a convention this
 * file maintains. It is the thing the database reads.
 */
export const WORLD_PREFIX = 'fixture-simgrant-'

export const slugFor = (label: string): string => `${WORLD_PREFIX}${label}`

export interface WorldReport {
  readonly projects: number
  readonly aliases: number
  readonly documents: number
  readonly created: readonly string[]
  readonly already: readonly string[]
}

/**
 * Provision, or confirm, the whole world. Safe to run any number of times.
 *
 * Every statement is scoped to a `fixture-simgrant-` slug. There is no path
 * through this file that can touch a row belonging to a real project, and
 * `assertContained` proves it afterwards rather than trusting the reading.
 */
export const provisionWorld = async (db: SqlExecutor): Promise<WorldReport> => {
  const created: string[] = []
  const already: string[] = []

  for (const project of DEFAULT_WORLD.projects) {
    const slug = slugFor(project.label)
    const archived = project.archived === true
    const status = archived ? 'archived' : 'active'

    const { rows } = await db.execute(`
      select count(*)::int as n from public.projects where slug = ${lit(slug)}
    `)
    const exists = Number((rows[0] as { n: number }).n) > 0
    if (exists) already.push(slug)
    else created.push(slug)

    /*
      The project, and its attachment, in ONE statement.

      `projects_need_an_attachment` refuses an ACTIVE project with no enabled
      attachment, and it is a constraint trigger, so an insert followed by a
      separate attachment insert fails at the first commit. The attachment is
      `upload`, which is the one connector that reaches nothing outside this
      database: no Drive call, no Notion call, no notebook.

      An archived project needs no attachment — the trigger says so in its
      own comment — and the retired project in the world is archived, which
      is exactly what makes it correctly unresolvable.
    */
    await db.execute(`
      insert into public.projects (slug, name, status)
      values (${lit(slug)}, ${lit(project.name)}, ${lit(status)})
      on conflict (slug) do update set name = excluded.name, status = excluded.status;
      ${
        archived
          ? ''
          : `insert into public.project_attachments
               (project_id, connector, external_ref, display_name, role, enabled)
             select p.project_id, 'upload', ${lit(`${slug}-source`)},
                    ${lit(`${project.name} uploads`)}, 'source', true
               from public.projects p where p.slug = ${lit(slug)}
             on conflict do nothing;`
      }
    `)

    /*
      The nicknames, as aliases Grant is recorded as having taught.

      `source = 'grant'` is what the resolver scores highest and what its
      `how` renders as "you call it that" — which is the thing the referent
      families are actually testing. `add_project_alias` does not filter
      fixtures, so these land; before 0534 they were unreachable anyway,
      because the resolver filtered at the PROJECT level and every branch
      joined that filter.
    */
    for (const nickname of project.nicknames ?? []) {
      await db.execute(`
        select app.add_project_alias(p.project_id, ${lit(nickname)}, 'grant', 1.0)
          from public.projects p where p.slug = ${lit(slug)}
      `)
    }
  }

  const count = async (sql: string): Promise<number> =>
    Number(((await db.execute(sql)).rows[0] as { n: number } | undefined)?.n ?? 0)

  return {
    projects: await count(
      `select count(*)::int n from public.projects where slug like ${lit(`${WORLD_PREFIX}%`)}`,
    ),
    aliases: await count(`
      select count(*)::int n from public.project_aliases a
        join public.projects p on p.project_id = a.project_id
       where p.slug like ${lit(`${WORLD_PREFIX}%`)}`),
    documents: await count(`
      select count(*)::int n from public.documents d
        join public.projects p on p.project_id = d.project_id
       where p.slug like ${lit(`${WORLD_PREFIX}%`)}`),
    created,
    already,
  }
}

/**
 * Prove the world is contained, rather than assuming it.
 *
 * CLAUDE.md: a teardown that matches nothing looks exactly like a teardown
 * that worked, and the same is true of a boundary. This asserts the three
 * properties that keep the world off Grant's screen, and it asserts them
 * against the database rather than against this file's intentions.
 */
export const assertContained = async (db: SqlExecutor): Promise<readonly string[]> => {
  const problems: string[] = []

  const { rows } = await db.execute(`
    select
      (select count(*)::int from public.projects
        where slug like ${lit(`${WORLD_PREFIX}%`)} and not is_fixture) as not_fixture,
      (select count(*)::int from public.projects
        where name like 'simgrant %' and slug not like ${lit(`${WORLD_PREFIX}%`)}) as stray_real,
      (select jsonb_array_length(public.resolve_project_by_name('the funding one'))) as wrapper_sees,
      (select count(*)::int from public.slack_channel_map m
         join public.projects p on p.project_id = m.project_id
        where p.slug like ${lit(`${WORLD_PREFIX}%`)}) as slack_channels
  `)
  const r = rows[0] as Record<string, number>

  if (Number(r.not_fixture) > 0)
    problems.push(
      `${String(r.not_fixture)} world project(s) are NOT fixtures - they would reach Grant's switcher and earn a Slack channel`,
    )
  if (Number(r.stray_real) > 0)
    problems.push(
      `${String(r.stray_real)} project(s) named "simgrant ..." exist OUTSIDE the fixture prefix - a real project was created for the simulated world`,
    )
  if (Number(r.wrapper_sees) > 0)
    problems.push(
      `the PUBLIC wrapper resolved a world nickname (${String(r.wrapper_sees)} candidate(s)) - anything with a browser can see the simulated world`,
    )
  if (Number(r.slack_channels) > 0)
    problems.push(`${String(r.slack_channels)} world project(s) have a Slack channel mapped`)

  return problems
}
