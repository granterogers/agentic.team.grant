/**
 * What a model is shown (migrations 0770-0775, cluster g-context): retrieval, lessons and skills, decisions, the project
 * brief, mail, the project router, offers and the noticing pass, the briefing, the calendar plan, notification
 * preferences and the capability brief.
 *
 * The heart of it is the CANARY. Person B is seeded with documents, lessons, skills, mail, contacts, a decision, standing
 * rules, preferences, credentials and a project, every one carrying text that exists nowhere in Person A's world; Person
 * A has its own. Every converted reader is then driven AS A - with B's ids, B's project name, B's alias and queries that
 * name B's canary exactly - and B's canary and ids must appear nowhere in what A is given, while A's own canary DOES
 * (a reader that returns nothing proves nothing). The same canaries are used by the sabotage runs.
 *
 * The converted functions are in schema app (no browser role can execute them), so they are driven as p2_worker, the
 * stand-in for the role the worker connects as. The rows are written once, with fixed ids and `on conflict do nothing`,
 * so the file can be run again against the same clone, which the sabotage runs do.
 */
import { createHash } from 'node:crypto'
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

const CA = 'zxqcanaryalpha'
const CB = 'zxqcanarybravo'
const WORD = 'ctxsearchword'
const W = 'p2_worker'
const uid = (label: string): string => {
  const h = createHash('md5').update(`ctx:${label}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const x = (sql: string) => c.db.execute(sql)
  const w = (sql: string) => c.exec(W, sql)
  const text = async (sql: string) => c.json(await w(sql))
  /** The rows of a set-returning function, as one jsonb value. */
  const rows = async <T = Record<string, unknown>>(fn: string): Promise<T[]> =>
    (await w(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${fn} t`)) as T[]
  const count = async (sql: string): Promise<number> =>
    Number(((await x(sql)).rows[0] as { n: number }).n)
  const q = (office: string) => `${lit(office)}::uuid`
  /** What the call said, whether it answered or refused, with a given id made anonymous. */
  const said = async (sql: string, ...ids: string[]): Promise<string> => {
    const r = await c.try_(W, sql)
    let s = r.ok ? c.json(r.value) : `ERROR ${r.error}`
    for (const id of ids) s = s.replaceAll(id, '<id>')
    return s
  }

  const bridge = async (): Promise<number> =>
    count(
      `select coalesce(sum(n),0)::int as n from public.office_bridge_use
        where table_name in ('lessons','events','suggestions','briefings','mail_messages','notification_preferences')`,
    )
  const bridgeBefore = await bridge()
  // Other case files write lessons into B too, so "nothing of B's changed" is measured against B as this file found it.
  const strangersLessonsInB = await count(
    `select count(*)::int as n from public.lessons where office_id = '${B}' and learned_by <> 'ctx-person'`,
  )

  // ---- the seed -----------------------------------------------------------------------------------------------------------------
  const P = { A: uid('a-proj'), B: uid('b-proj') }
  const S = { A: uid('a-sibling'), B: uid('b-sibling') }
  const NB = { A: uid('a-notebook'), B: uid('b-notebook') }
  const JOB = {
    A: { live: uid('a-job-live'), done: uid('a-job-done') },
    B: { live: uid('b-job-live'), done: uid('b-job-done') },
  }
  const NAME = { A: `Zxqcanaryalpha Venture`, B: `Zxqcanarybravo Venture` }
  const ALIAS = { A: 'zxqalphanick', B: 'zxqbravonick' }
  const SHARED = 'zxqsharednick'
  const MAIL = { A: 'a.person@alpha.example', B: 'b.person@bravo.example' }
  const TEAM = { A: 'T0CTXAXXXXXX', B: 'T0CTXBXXXXXX' }
  const CHAN = { A: 'C0CTXAAAA', B: 'C0CTXBBBB' }

  for (const [who, office, tag] of [
    ['A', A, CA],
    ['B', B, CB],
  ] as const) {
    const l = who.toLowerCase()
    await x(`begin;
      insert into public.projects (project_id, slug, name, status, office_id)
      values ('${P[who]}', 'ctx-proj', ${lit(NAME[who])}, 'active', '${office}'),
             ('${S[who]}', 'ctx-sibling', ${lit(`${tag} sibling`)}, 'active', '${office}') on conflict do nothing;
      insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
      select p, 'upload', 'ctx-' || p::text, 'ctx upload', 'source'
        from (values ('${P[who]}'::uuid), ('${S[who]}'::uuid)) v(p)
       where not exists (select 1 from public.project_attachments a where a.project_id = v.p);
      insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
      select '${P[who]}', 'notebooklm', '${NB[who]}', 'ctx notebook', 'source'
       where not exists (select 1 from public.project_attachments a where a.project_id = '${P[who]}' and a.connector = 'notebooklm');
      commit;`)
    // jobs: one live, one finished (a job is the thing a blocker and a failure hang off)
    for (const [state, id] of [
      ['queued', JOB[who].live],
      ['complete', JOB[who].done],
    ] as const) {
      const terminal = state === 'complete'
      await x(`insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state,
                                         recipient_agent, created_at ${terminal ? ', finished_at, started_at' : ''})
               values ('${id}', '${id}', 'ctx-key-${l}-${state}', 'office.instruction', 'teamhq:ctx-${l}', '${P[who]}', '${office}', '${state}',
                       'chief-of-staff', app.now_utc() - interval '1 hour' ${terminal ? ", app.now_utc() - interval '5 minutes', app.now_utc() - interval '20 minutes'" : ''})
               on conflict do nothing`)
    }
    // documents: A has ONE match for the search word, B has 200 (the ordering proof)
    const ndocs = who === 'A' ? 1 : 200
    await x(`insert into public.documents (document_id, project_id, title, connector, external_ref, content, content_chars, content_fingerprint, fetched_at, added_by, office_id)
             select md5('ctx:${l}-doc:' || g)::uuid, '${P[who]}', '${tag} note ' || g, 'upload', 'ctx-${l}-' || g,
                    '${WORD} ${tag} document number ' || g || ' ${WORD}', length('${WORD} ${tag} document number ' || g || ' ${WORD}'),
                    encode(extensions.digest('${l}' || g::text, 'sha256'), 'hex'), app.now_utc(), 'ctx-person', '${office}'
               from generate_series(1, ${String(ndocs)}) g
             on conflict do nothing`)
    // contacts and mail: B's mail includes a message FROM A's contact address (a contact must be matched in its own office)
    await x(`insert into public.contacts (project_id, kind, name, email)
             select '${P[who]}', 'person', '${tag} person', '${MAIL[who]}'
              where not exists (select 1 from public.contacts k where k.project_id = '${P[who]}')`)
    const other = who === 'A' ? 'B' : 'A'
    const msgs: [string, string, string, string, string][] = [
      // id, thread, subject, from, sent offset
      [`ctx${who}-m1`, `ctx${who}-t1`, `${ALIAS[who]} update ${tag}`, MAIL[who], '10 days'],
      [`ctx${who}-m2`, `ctx${who}-t2`, `${tag} contract renewal`, MAIL[who], '2 days'],
      [`ctx${who}-from${other}`, `ctx${who}-t3`, `Hello ${tag}`, MAIL[other], '3 days'],
      [`ctx${who}-old`, `ctx${who}-t4`, `${tag} an old thing`, MAIL[who], '400 days'],
    ]
    for (const [id, thread, subject, from, ago] of msgs)
      await x(`insert into public.mail_messages (message_id, thread_id, subject, from_name, from_address, sent_at, excerpt, labels, last_seen_at, office_id)
               values (${lit(id)}, ${lit(thread)}, ${lit(subject)}, ${lit(`${tag} sender`)}, ${lit(from)}, app.now_utc() - interval '${ago}', ${lit(`${tag} excerpt`)},
                       '{INBOX}', app.now_utc(), '${office}') on conflict do nothing`)
    await x(`insert into public.mail_messages (message_id, thread_id, subject, from_address, sent_at, excerpt, labels, last_seen_at, body, body_at, office_id)
             values (${lit(`ctx${who}-bodyold`)}, ${lit(`ctx${who}-t5`)}, ${lit(`${tag} aged body`)}, ${lit(MAIL[who])}, app.now_utc() - interval '31 days', 'x', '{INBOX}', app.now_utc(),
                     ${lit(`${tag} body that has aged out`)}, app.now_utc() - interval '30 days', '${office}') on conflict do nothing`)
    await x(`insert into public.mail_messages (message_id, thread_id, subject, from_address, sent_at, excerpt, labels, last_seen_at, body, body_at, office_id)
             values (${lit(`ctx${who}-bodynew`)}, ${lit(`ctx${who}-t6`)}, ${lit(`${tag} fresh body`)}, ${lit(MAIL[who])}, app.now_utc() - interval '1 day', 'x', '{INBOX}', app.now_utc(),
                     ${lit(`${tag} body that is fresh`)}, app.now_utc() - interval '1 day', '${office}') on conflict do nothing`)
    if (who === 'B')
      for (let i = 0; i < 25; i++)
        await x(`insert into public.mail_messages (message_id, thread_id, subject, from_address, sent_at, excerpt, labels, last_seen_at, office_id)
                 values ('ctxB-bulk${String(i)}', 'ctxB-tb${String(i)}', 'bulk ${CB} ${String(i)}', ${lit(MAIL.B)}, app.now_utc() - interval '5 days', 'x', '{INBOX}', app.now_utc(), '${office}') on conflict do nothing`)
    // skills (and the tool one of them needs); a decision; the project's instruction for one person on the roster
    await x(`insert into public.skills (skill_id, scope, name, when_to_use, procedure, authored_by, office_id)
             values ('${uid(`${l}-skill`)}', 'global', ${lit(`${tag} skill`)}, 'when the canary matters at all',
                     ${lit(`Step one: mention ${tag} in every reply. Step two: read the db. Step three: confirm it.`)}, 'ctx-person', '${office}') on conflict do nothing`)
    await x(
      `insert into public.skill_tools (skill_id, tool) values ('${uid(`${l}-skill`)}', 'drive.ingest') on conflict do nothing`,
    )
    await x(`insert into public.decisions (decision_id, question, chose, ruled_out, because, decided_by, project_id, office_id)
             values ('${uid(`${l}-decision`)}', ${lit(`Which ${tag} supplier do we use?`)}, ${lit(`${tag} Northgate`)}, array['Bellamy'],
                     ${lit(`${tag} could commit to the lead time.`)}, 'ctx-person', '${P[who]}', '${office}') on conflict do nothing`)
    await x(`insert into public.project_staff (project_id, staff_id, active, instruction)
             select '${P[who]}', staff_id, true, ${lit(`${tag} instruction for this project`)} from public.staff where slug = 'research-director'
             on conflict do nothing`)
    // needs-you, diary, tasks (one due soon and unowned, one that is done and has a calendar link), preferences, failures, impediments
    await x(`insert into public.blockers (blocker_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, project_id, job_id)
             values ('${uid(`${l}-blocker`)}', ${lit(`${tag} approve the thing`)}, 'why', 'late', '{yes,no}', 'chief-of-staff', true, '${office}', '${P[who]}', '${JOB[who].live}') on conflict do nothing`)
    if (who === 'B')
      await x(`insert into public.blockers (blocker_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, project_id, job_id)
               values ('${uid('b-blocker2')}', ${lit(`${CB} approve a second thing`)}, 'why', 'late', '{yes,no}', 'chief-of-staff', true, '${office}', '${P.B}', '${JOB.B.live}') on conflict do nothing`)
    await x(`insert into public.calendar_events (event_id, calendar_id, summary, starts_at, ends_at, office_id)
             values ('ctx-${l}-cal', 'cal', ${lit(`${tag} meeting today`)}, app.now_utc(), app.now_utc() + interval '1 hour', '${office}') on conflict do nothing`)
    await x(`insert into public.tasks (task_id, title, office_id, project_id, state, assigned_to_human, due_on)
             values ('${uid(`${l}-task`)}', ${lit(`${tag} write the report`)}, '${office}', '${P[who]}', 'todo', false, current_date + 1) on conflict do nothing`)
    await x(`insert into public.job_impediments (impediment_id, job_id, project_id, staff_slug, kind, needed_raw, noticed_by)
             select md5('ctx:${l}-wall:' || g)::uuid, '${JOB[who].done}', '${P[who]}', 'chief-of-staff', 'missing_tool', 'ctxneed${l}', 'ctx'
               from generate_series(1, ${who === 'A' ? '3' : '4'}) g on conflict do nothing`)
    await x(`insert into public.failure_signatures (job_kind, error_class, subject, seen, first_seen, last_seen, last_job_id, office_id)
             values ('office.instruction', 'timeout', 'ctx${l}', 5, app.now_utc() - interval '3 days', app.now_utc(), '${JOB[who].live}', '${office}') on conflict do nothing`)
    // preferences: one subject each (the global unique index is on the subject alone - reported, not widened)
    await x(`insert into public.notification_preferences (subject, muted_channels, blockers_always, office_id)
             values ('ctx-subject-${l}', ${who === 'A' ? "'{slack}'" : "'{telegram}'"}, false, '${office}') on conflict do nothing`)
    // credentials: A's Slack is dead (detail carries A's canary), B's Telegram is dead (detail carries B's)
    await x(`insert into public.connection_health (service, credential, state, detail, owner, office_id)
             values (${who === 'A' ? "'Slack'" : "'Telegram'"}, 'ctx-token', 'dead', ${lit(`${tag} credential is dead`)}, 'ctx', '${office}') on conflict do nothing`)
    // a tool one office asked for, and one it was refused
    await x(`insert into public.tool_requests (tool, asked_by, what_for, state, raised_at, settled_at, decided_by, decline_reason, declines, office_id)
             values (${lit(`ctx.wants${l}`)}, 'research-director', ${lit(`${tag} wants to read the venue plans`)}, 'open', app.now_utc(), null, null, null, 0, '${office}')
             on conflict do nothing`)
    if (who === 'B')
      await x(`insert into public.tool_requests (tool, asked_by, what_for, state, raised_at, settled_at, decided_by, decline_reason, declines, office_id)
               values ('ctx.declinedb', 'research-director', ${lit(`${CB} wanted to send the venue plans`)}, 'declined', app.now_utc(), app.now_utc(), 'ctx-person', ${lit(`${CB} declined for good reasons`)}, 1, '${office}')
               on conflict do nothing`)
    // Slack: a workspace and a channel mapped to each office's own project
    await x(
      `insert into public.slack_app_credentials (office_id, slack_app_id, team_id, app_name) values ('${office}', 'A0${TEAM[who]}', '${TEAM[who]}', 'ctx') on conflict do nothing`,
    )
    await x(
      `insert into public.slack_workspaces (office_id, team_id, team_name, installed, bot_user_id, app_id) values ('${office}', '${TEAM[who]}', 'ctx', true, 'U0BOT', 'A0${TEAM[who]}') on conflict do nothing`,
    )
    await x(
      `insert into public.slack_channel_map (channel_id, team_id, project_id, channel_name, active) values ('${CHAN[who]}', '${TEAM[who]}', '${P[who]}', 'room-${CHAN[who]}', true) on conflict do nothing`,
    )
  }
  // A grants a tool to a roster member; B does not (grants are per office)
  await x(`insert into public.staff_tools (staff_slug, tool, granted_by, office_id)
           select 'research-director', 'drive.ingest', 'ctx-person', '${A}'
            where not exists (select 1 from public.staff_tools where staff_slug = 'research-director' and tool = 'drive.ingest' and office_id = '${A}')`)
  // routing phrases, through the converted writer; B's alias text is B's alone, SHARED is held by both
  for (const [office, who] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    for (const a of [ALIAS[who], SHARED])
      await w(`select app.add_project_alias(${q(office)}, '${P[who]}', ${lit(a)}, 'grant', 1.0)`)
  }
  // lessons, through the converted writer
  const learn = async (
    office: string,
    scope: string,
    body: string,
    project: string | null,
    staff: string | null,
    kind: string | null,
  ) => {
    const exists = await count(
      `select count(*)::int as n from public.lessons where office_id = '${office}' and body = ${lit(body)}`,
    )
    if (exists > 0) return
    await w(
      `select app.learn(${q(office)}, '${scope}'::public.lesson_scope, ${lit(body)}, 'ctx-person', ${project === null ? 'null' : `'${project}'::uuid`}, ${staff === null ? 'null' : lit(staff)}, ${kind === null ? 'null' : lit(kind)}, null, 0.9, null)`,
    )
  }
  await learn(A, 'global', `Always mention ${CA} first in every reply`, null, null, null)
  await learn(A, 'project', `On this project call it ${CA} venture`, P.A, null, null)
  await learn(
    A,
    'staff',
    `Emma should quote ${CA} before summarising`,
    null,
    'research-director',
    null,
  )
  await learn(B, 'global', `Always mention ${CB} first in every reply`, null, null, null)
  await learn(B, 'project', `On this project call it ${CB} venture`, P.B, null, null)
  await learn(
    B,
    'staff',
    `Emma should quote ${CB} before summarising`,
    null,
    'research-director',
    null,
  )
  await learn(B, 'kind', `Instruction jobs must cite ${CB} twice`, null, null, 'office.instruction')
  const lessonB = String(
    (
      await x(
        `select lesson_id::text as id from public.lessons where office_id = '${B}' and body = ${lit(`Always mention ${CB} first in every reply`)} limit 1`,
      )
    ).rows[0]?.id,
  )
  c.check(
    (await count(
      `select count(*)::int as n from public.projects where office_id in ('${A}','${B}') and slug = 'ctx-proj'`,
    )) === 2 && lessonB.length === 36,
    'the seed is written: both offices hold a project of the same slug, documents, mail, lessons, skills and a decision',
    '',
  )

  const unnamed = {
    A: String(await w(`select app.unnamed_project(${q(A)})`)),
    B: String(await w(`select app.unnamed_project(${q(B)})`)),
  }

  // ==== 0. the shape of what is left: every overload takes an office first, or is a named deliberate legacy ==================
  const NAMES = [
    'search_documents',
    'hq_search_documents',
    'lessons_for',
    'learn',
    'skills_for',
    'project_instruction_for',
    'project_knowledge',
    'sibling_projects',
    'projects_named_in',
    'mail_for_project',
    'mail_search',
    'mail_awaiting',
    'mail_coverage',
    'forget_mail_before',
    'forget_mail_bodies_before',
    'decisions_about',
    'resolve_project',
    'resolve_project_by_name',
    'add_project_alias',
    'propose_standing_rule',
    'propose_standing_procedure',
    'raise_suggestions',
    'container_refs',
    'calendar_task_plan',
    'morning_briefing_facts',
    'write_briefing',
    'notification_allowed',
    'capability_index',
    'capability_index_core',
    'append_event',
    'notice',
    'recurring_failures',
    'impediments_tally',
    'reach_wanted',
    'needs_me_pressure',
    'references_in',
    'project_for_slack_channel',
    'staff_may_use',
    'hq_capability_index',
  ]
  /** Overloads left in place ON PURPOSE until their last unconverted caller moves (the lead drops them). */
  const legacy = (schema: string, name: string, args: string) => `${schema}.${name}(${args})`
  const LEGACY = new Set([
    legacy('app', 'learn', 'lesson_scope, text, text, uuid, text, text, uuid, numeric, uuid'), // the governance press
    legacy('app', 'search_documents', 'text, uuid, integer, text'), // the MCP door
    legacy('app', 'resolve_project_by_name', 'text, boolean'), // the voice door
    legacy('app', 'staff_may_use', 'text, text, boolean'), // authorize_effect, request_tool (governance)
    legacy(
      'public',
      'append_event',
      'uuid, text, text, text, text, boolean, uuid, jsonb, jsonb, text, jsonb, text, text, text, uuid, uuid, uuid',
    ), // many governance writers
    legacy('app', 'reach_wanted', ''), // the governance page still reads it through its public door
    legacy('public', 'reach_wanted', ''),
    legacy('app', 'recurring_failures', 'integer, integer'),
    legacy('app', 'impediments_tally', 'integer, integer, boolean'), // public.impediments_tally, app.hq_governance
    legacy('public', 'impediments_tally', 'integer, integer'),
  ])
  const overloads = (
    await x(`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
                    (pg_get_function_identity_arguments(p.oid) like 'p_office uuid%') as takes_office,
                    p.oid::regprocedure::text as reg
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('app','public') and p.proname = any(array[${NAMES.map(lit).join(',')}])`)
  ).rows as { sig: string; takes_office: boolean; reg: string }[]
  const stray = overloads.filter(
    (o) =>
      !o.takes_office &&
      !LEGACY.has(o.sig.replace(/p_[a-z_]+ /g, '').replace(/ DEFAULT [^,)]+/g, '')) &&
      !LEGACY.has(o.sig),
  )
  const strayShort = stray.map((o) => o.sig.slice(0, 60))
  c.check(
    stray.length === 0 && overloads.length > 30,
    'every remaining overload of a converted name takes the office first, or is a named legacy kept for an unconverted caller',
    strayShort.join(' | '),
  )
  const publicOffice = overloads.filter((o) => o.sig.startsWith('public.') && o.takes_office)
  c.check(
    publicOffice.length === 0,
    'no converted function has a public door: the model-context readers are for the worker, not a browser',
    publicOffice.map((o) => o.sig.slice(0, 50)).join(' | '),
  )
  let executable = ''
  for (const role of [...callerRoles, 'service_role'])
    for (const o of overloads.filter((o) => o.takes_office && o.sig.startsWith('app.')))
      if (
        (
          (
            await x(
              `select has_function_privilege('${role}', '${o.reg.replaceAll("'", "''")}', 'execute') as e`,
            )
          ).rows[0] as { e: boolean }
        ).e
      )
        executable += ` ${role}:${o.sig.slice(0, 40)}`
  c.check(
    executable === '',
    'no browser role and not service_role can execute a converted app function',
    executable.slice(0, 160),
  )

  // ==== 1. a null office and a nonexistent office are refused by name ==========================================================
  const nobody = c.nobody()
  const CALLS: [string, (o: string) => string][] = [
    [
      'search_documents',
      (o) => `select count(*) from app.search_documents(${o}, 'x', null, 5, 'all')`,
    ],
    [
      'lessons_for',
      (o) => `select count(*) from app.lessons_for(${o}, null, null, null, 8, false)`,
    ],
    ['learn', (o) => `select app.learn(${o}, 'global', 'a body long enough', 'ctx-person')`],
    ['skills_for', (o) => `select count(*) from app.skills_for(${o}, null, null, null, 4)`],
    ['decisions_about', (o) => `select app.decisions_about(${o}, 'x', 4)`],
    [
      'project_instruction_for',
      (o) => `select app.project_instruction_for(${o}, '${P.A}', 'research-director')`,
    ],
    ['project_knowledge', (o) => `select app.project_knowledge(${o}, '${P.A}')`],
    ['container_refs', (o) => `select count(*) from app.container_refs(${o}, '${P.A}', 'upload')`],
    ['sibling_projects', (o) => `select count(*) from app.sibling_projects(${o}, '${P.A}')`],
    ['projects_named_in', (o) => `select count(*) from app.projects_named_in(${o}, 'x', '${P.A}')`],
    ['mail_for_project', (o) => `select app.mail_for_project(${o}, '${P.A}', 5)`],
    ['mail_search', (o) => `select app.mail_search(${o}, 'renewal', null, 5)`],
    ['mail_awaiting', (o) => `select app.mail_awaiting(${o}, '${P.A}', 7, 5)`],
    ['mail_coverage', (o) => `select app.mail_coverage(${o}, '${P.A}')`],
    ['forget_mail_before', (o) => `select app.forget_mail_before(${o}, 9999)`],
    ['forget_mail_bodies_before', (o) => `select app.forget_mail_bodies_before(${o}, 9999)`],
    [
      'resolve_project',
      (o) => `select app.resolve_project(${o}, 'telegram_chat', 'ctx-chat-x', null, null)`,
    ],
    ['references_in', (o) => `select count(*) from app.references_in(${o}, 'x')`],
    ['project_for_slack_channel', (o) => `select app.project_for_slack_channel(${o}, '${CHAN.A}')`],
    [
      'append_event',
      (o) =>
        `select app.append_event(${o}, gen_random_uuid(), 'agent', 'ctx', 'ctx', 'ctx.test', false)`,
    ],
    [
      'propose_standing_rule',
      (o) => `select app.propose_standing_rule(${o}, 'a rule that says something', 'global')`,
    ],
    [
      'propose_standing_procedure',
      (o) =>
        `select app.propose_standing_procedure(${o}, 'name here', 'when', 'a procedure long enough text')`,
    ],
    ['raise_suggestions', (o) => `select app.raise_suggestions(${o}, 5)`],
    ['notice', (o) => `select count(*) from app.notice(${o}, 5)`],
    ['recurring_failures', (o) => `select count(*) from app.recurring_failures(${o}, 3, 14)`],
    ['impediments_tally', (o) => `select count(*) from app.impediments_tally(${o}, 30, 1, false)`],
    ['reach_wanted', (o) => `select count(*) from app.reach_wanted(${o})`],
    ['needs_me_pressure', (o) => `select count(*) from app.needs_me_pressure(${o})`],
    ['morning_briefing_facts', (o) => `select app.morning_briefing_facts(${o})`],
    [
      'write_briefing',
      (o) => `select app.write_briefing(${o}, 'morning', current_date, repeat('x', 50), '{}')`,
    ],
    ['calendar_task_plan', (o) => `select app.calendar_task_plan(${o})`],
    [
      'notification_allowed',
      (o) =>
        `select app.notification_allowed(${o}, 's', 'slack', 'routine'::public.notify_severity)`,
    ],
    ['capability_index', (o) => `select app.capability_index(${o}, null)`],
    ['capability_index_core', (o) => `select app.capability_index_core(${o}, null)`],
    ['staff_may_use', (o) => `select app.staff_may_use(${o}, 'research-director', 'drive.ingest')`],
    [
      'resolve_project_by_name',
      (o) => `select count(*) from app.resolve_project_by_name(${o}, 'x')`,
    ],
    ['add_project_alias', (o) => `select app.add_project_alias(${o}, '${P.A}', 'zxqnothing')`],
  ]
  for (const [name, mk] of CALLS) {
    const forNull = await c.try_(W, mk('null::uuid'))
    const forGhost = await c.try_(W, mk(`'${nobody}'::uuid`))
    c.check(
      !forNull.ok &&
        forNull.error.includes('no_office') &&
        !forGhost.ok &&
        forGhost.error.includes('no_office'),
      `${name}: a null office and a nonexistent office are both refused as no_office`,
      forNull.ok
        ? 'null office was ANSWERED'
        : forGhost.ok
          ? 'a nonexistent office was ANSWERED'
          : '',
    )
  }

  // ==== 2. retrieval: the office predicate is in the statement that fetches ================================================
  const srcSearch = String(
    (
      await x(
        `select pg_get_functiondef('app.search_documents(uuid,text,uuid,integer,text)'::regprocedure) as d`,
      )
    ).rows[0]?.d,
  )
  // between "from public.documents d" and "order by", the WHERE of the one statement that returns rows carries the office
  const fetching = srcSearch.slice(
    srcSearch.indexOf('from public.documents d'),
    srcSearch.indexOf('order by rank'),
  )
  c.check(
    /where\s+d\.office_id\s*=\s*p_office/.test(fetching) &&
      /perform\s+app\.require_office\(p_office\)/.test(srcSearch),
    'search_documents: the office predicate is in the WHERE of the statement that fetches (before order and limit), not applied afterwards, and the office is required first',
    '',
  )
  const hitsA = await rows<{ document_id: string; project_id: string; title: string }>(
    `app.search_documents(${q(A)}, ${lit(WORD)}, null, 10, 'all')`,
  )
  c.check(
    hitsA.length === 1 &&
      hitsA[0]?.title.includes(CA) === true &&
      c.json(hitsA).includes(P.A) &&
      !c.json(hitsA).includes(P.B),
    "search_documents: B holds 200 documents that match and A holds one - A's limit-10 search returns A's one, not B's ten",
    `${String(hitsA.length)} hit(s)`,
  )
  const hitsB = await rows<{ document_id: string; title: string }>(
    `app.search_documents(${q(B)}, ${lit(WORD)}, null, 10, 'all')`,
  )
  c.check(
    hitsB.length === 10 && hitsB.every((h) => h.title.includes(CB)),
    "search_documents: and B, with its 200, gets its ten (the control: the limit is not what made A's answer small)",
    `${String(hitsB.length)}`,
  )
  const capped = await rows(`app.search_documents(${q(B)}, ${lit(WORD)}, null, 500, 'all')`)
  c.check(
    capped.length === 100,
    'search_documents: the hundred-row ceiling still holds',
    `${String(capped.length)}`,
  )
  c.check(
    c
      .json(await rows(`app.search_documents(${q(A)}, ${lit(`${CB} ${WORD}`)}, null, 10, 'any')`))
      .includes(CB) === false,
    "search_documents: a query that names B's canary exactly finds none of B's documents as A",
    '',
  )
  c.check(
    c.json(await rows(`app.search_documents(${q(A)}, ${lit(CB)}, null, 10, 'all')`)) === '[]',
    "search_documents: A searching for B's canary alone gets nothing",
    '',
  )
  c.check(
    (await said(
      `select count(*) from app.search_documents(${q(A)}, ${lit(WORD)}, '${P.B}', 10, 'all')`,
    )) ===
      (await said(
        `select count(*) from app.search_documents(${q(A)}, ${lit(WORD)}, '${nobody}', 10, 'all')`,
      )),
    "search_documents: B's project id and a nonexistent one are indistinguishable to A (both find nothing)",
    '',
  )
  // the mirror clause is the office's too: a mirror steps aside only for an original A can see. A mirror of another
  // office's document is written inside a transaction that is rolled back, with the same-office key removed if there is one.
  const bDoc = String(
    (
      await x(
        `select document_id::text as id from public.documents where office_id = '${B}' and project_id = '${P.B}' limit 1`,
      )
    ).rows[0]?.id,
  )
  await x('begin')
  let mirrorSaw = ''
  try {
    await x(`do $m$ declare r record; begin
               for r in select conname from pg_constraint where conrelid = 'public.documents'::regclass and contype = 'f'
                         and pg_get_constraintdef(oid) ilike '%mirrors_document_id%office_id%' loop
                 execute format('alter table public.documents drop constraint %I', r.conname);
               end loop; end $m$`)
    await x(`insert into public.documents (document_id, project_id, title, connector, external_ref, content, content_chars, content_fingerprint, fetched_at, added_by, office_id, mirrors_document_id)
             values ('${uid('a-mirror')}', '${P.A}', '${CA} mirror', 'notion', 'ctx-a-mirror', '${WORD} ${CA} mirror ${WORD}', 30,
                     encode(extensions.digest('mirror', 'sha256'), 'hex'), app.now_utc(), 'ctx-person', '${A}', '${bDoc}')`)
    mirrorSaw = c.json(
      (
        await x(
          `select coalesce(jsonb_agg(title), '[]'::jsonb) as r from app.search_documents('${A}', ${lit(WORD)}, null, 10, 'all')`,
        )
      ).rows[0]?.r,
    )
  } catch (e) {
    mirrorSaw = `ERROR ${String((e as Error).message)}`
  } finally {
    await x('rollback').catch(() => undefined)
  }
  c.check(
    mirrorSaw.includes(`${CA} mirror`),
    "search_documents: A's document that claims to mirror a document of B is still found - B's original does not hide it (the mirror rule reads A's office only)",
    mirrorSaw.slice(0, 100),
  )

  // ==== 3. lessons: a carrier ====================================================================================================
  const lfA = await rows<{ body: string }>(
    `app.lessons_for(${q(A)}, '${P.A}', 'research-director', 'office.instruction', 50, false)`,
  )
  const lfAText = c.json(lfA)
  c.check(
    lfAText.includes(CA) && !lfAText.includes(CB) && lfA.length >= 3,
    "lessons_for: A is given A's global, project and staff lessons and none of B's",
    `${String(lfA.length)} lesson(s)`,
  )
  const lfB = c.json(
    await rows(
      `app.lessons_for(${q(B)}, '${P.B}', 'research-director', 'office.instruction', 50, false)`,
    ),
  )
  c.check(lfB.includes(CB) && !lfB.includes(CA), "lessons_for: and B's are B's alone", '')
  c.check(
    !c
      .json(
        await rows(
          `app.lessons_for(${q(A)}, '${P.B}', 'research-director', 'office.instruction', 50, true)`,
        ),
      )
      .includes(CB),
    "lessons_for: asking as A about B's project, with the harness door open, still yields none of B's lessons",
    '',
  )
  c.check(
    (await said(
      `select count(*) from app.lessons_for(${q(A)}, '${P.B}', null, null, 50, false)`,
    )) ===
      (await said(
        `select count(*) from app.lessons_for(${q(A)}, '${nobody}', null, null, 50, false)`,
      )),
    "lessons_for: B's project id and a nonexistent one are indistinguishable to A",
    '',
  )
  // learn
  const before = await c.snapshot(B, [
    'lessons',
    'events',
    'suggestions',
    'skills',
    'decisions',
    'mail_messages',
    'briefings',
  ])
  c.check(
    (await said(
      `select app.learn(${q(A)}, 'project', 'a lesson about a project', 'ctx-person', '${P.B}')`,
    )) ===
      (await said(
        `select app.learn(${q(A)}, 'project', 'a lesson about a project', 'ctx-person', '${nobody}')`,
      )),
    "learn: B's project and a nonexistent project are refused in the same words",
    await said(
      `select app.learn(${q(A)}, 'project', 'a lesson about a project', 'ctx-person', '${P.B}')`,
    ),
  )
  c.check(
    (await said(
      `select app.learn(${q(A)}, 'global', 'a lesson from a job', 'ctx-person', null, null, null, '${JOB.B.live}')`,
    )) ===
      (await said(
        `select app.learn(${q(A)}, 'global', 'a lesson from a job', 'ctx-person', null, null, null, '${nobody}')`,
      )),
    "learn: B's job and a nonexistent job are refused in the same words",
    '',
  )
  c.check(
    (await said(
      `select app.learn(${q(A)}, 'global', 'revising a stranger', 'ctx-person', null, null, null, null, 0.9, '${lessonB}')`,
      lessonB,
    )) ===
      (await said(
        `select app.learn(${q(A)}, 'global', 'revising a stranger', 'ctx-person', null, null, null, null, 0.9, '${nobody}')`,
        nobody,
      )),
    "learn: superseding B's lesson and superseding one that does not exist are refused in the same words",
    await said(
      `select app.learn(${q(A)}, 'global', 'revising a stranger', 'ctx-person', null, null, null, null, 0.9, '${lessonB}')`,
      lessonB,
    ),
  )
  const stillLiveForB = c.json(await rows(`app.lessons_for(${q(B)}, null, null, null, 50, false)`))
  c.check(
    stillLiveForB.includes(`Always mention ${CB} first`),
    "learn: A's attempt to supersede B's lesson did not retire it",
    '',
  )
  c.check(
    before ===
      (await c.snapshot(B, [
        'lessons',
        'events',
        'suggestions',
        'skills',
        'decisions',
        'mail_messages',
        'briefings',
      ])),
    "learn: nothing of B's moved while A attacked it with B's project, B's job and B's lesson",
    '',
  )
  // the cross-office supersedes edge: the same-office key is what stops one being written; with it removed (inside a
  // transaction that is rolled back) the READERS must still not let A's row retire B's lesson
  await x('begin')
  let edgeRead = ''
  let edgeWrite = ''
  try {
    await x('alter table public.lessons drop constraint lessons_supersedes_same_office')
    await x(`insert into public.lessons (row_kind, scope, body, learned_by, confidence, observations, supersedes, office_id)
             values ('lesson', 'global', 'a forged revision of another office', 'ctx-person', 0.9, 1, '${lessonB}', '${A}')`)
    edgeWrite = 'inserted'
    edgeRead = c.json(
      (
        await x(
          `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as r from app.lessons_for('${B}', null, null, null, 50, false) t`,
        )
      ).rows[0]?.r,
    )
  } catch (e) {
    edgeWrite = `ERROR ${String((e as Error).message)}`
  } finally {
    await x('rollback').catch(() => undefined)
  }
  c.check(
    edgeWrite === 'inserted' && edgeRead.includes(`Always mention ${CB} first`),
    "lessons.supersedes: with the same-office key removed and a forged edge written, B's lesson is STILL live for B (an edge only counts inside the office)",
    edgeWrite === 'inserted' ? '' : edgeWrite.slice(0, 120),
  )
  const forged = await c.refusal(
    W,
    `insert into public.lessons (row_kind, scope, body, learned_by, confidence, observations, supersedes, office_id)
     values ('lesson', 'global', 'a forged revision of another office', 'ctx-person', 0.9, 1, '${lessonB}', '${A}')`,
  )
  c.check(
    forged.includes('lessons_supersedes_same_office') || forged.includes('violates foreign key'),
    'lessons.supersedes: the same-office key refuses the forged edge in the first place',
    forged.slice(0, 100),
  )
  // positive: A revises its own lesson, and the revision replaces it for A
  const ownLesson = String(
    (
      await x(
        `select lesson_id::text as id from public.lessons where office_id = '${A}' and body = ${lit(`Always mention ${CA} first in every reply`)} limit 1`,
      )
    ).rows[0]?.id,
  )
  const revised = (await w(
    `select app.learn(${q(A)}, 'global', ${lit(`Always mention ${CA} first, then the project, in every reply`)}, 'ctx-person', null, null, null, null, 0.9, '${ownLesson}')`,
  )) as { lesson_id?: string; observations?: number; error?: string }
  const afterRevise = c.json(await rows(`app.lessons_for(${q(A)}, null, null, null, 50, false)`))
  c.check(
    (revised.lesson_id !== undefined || revised.error === 'that lesson has already been revised') &&
      afterRevise.includes(`${CA} first, then the project`) &&
      !afterRevise.includes(`Always mention ${CA} first in every reply`),
    "learn: the positive control - A revises its own lesson and the revision replaces it in A's prompt",
    c.json(revised).slice(0, 100),
  )
  c.check(
    (await count(
      `select count(*)::int as n from public.events where office_id = '${A}' and action_type = 'office.learned'`,
    )) >= 1 &&
      (await count(
        `select count(*)::int as n from public.lessons where office_id = '${A}' and body like '%${CB}%'`,
      )) === 0,
    "learn: the lesson and its ledger event are A's, written with the office stated (no bridge)",
    '',
  )

  // ==== 4. skills ====================================================================================================================
  const skA = await rows<{ name: string; missing: string[] }>(
    `app.skills_for(${q(A)}, 'research-director', null, null, 20)`,
  )
  const skB = await rows<{ name: string; missing: string[] }>(
    `app.skills_for(${q(B)}, 'research-director', null, null, 20)`,
  )
  c.check(
    skA.some((s) => s.name.includes(CA)) &&
      !c.json(skA).includes(CB) &&
      skB.some((s) => s.name.includes(CB)) &&
      !c.json(skB).includes(CA),
    "skills_for: each office is given its own skills and none of the other's",
    `${String(skA.length)} / ${String(skB.length)}`,
  )
  c.check(
    (skA.find((s) => s.name.includes(CA))?.missing.length ?? 9) === 0 &&
      (skB.find((s) => s.name.includes(CB))?.missing ?? []).includes('drive.ingest'),
    "skills_for: a tool grant is the office's own - A holds drive.ingest for Emma, B does not, so B's skill reports it missing and A's does not",
    c.json([skA[0]?.missing, skB[0]?.missing]),
  )
  c.check(
    (await w(`select app.staff_may_use(${q(A)}, 'research-director', 'drive.ingest')`)) === true &&
      (await w(`select app.staff_may_use(${q(B)}, 'research-director', 'drive.ingest')`)) === false,
    'staff_may_use: a grant in A is not a grant in B',
    '',
  )

  // ==== 5. decisions =================================================================================================================
  const dA = await text(
    `select app.decisions_about(${q(A)}, ${lit(`Which ${CA} supplier do we use`)}, 4)`,
  )
  c.check(dA.includes(CA) && !dA.includes(CB), "decisions_about: A is shown A's decision", '')
  const dX = await text(
    `select app.decisions_about(${q(A)}, ${lit(`Which ${CB} supplier do we use? ${CB} Northgate`)}, 4)`,
  )
  c.check(
    !dX.includes(CB),
    "decisions_about: a question that names B's decision exactly finds none of it as A",
    dX.slice(0, 80),
  )
  // the edge into a decision, the same shape as lessons
  const decisionB = uid('b-decision')
  await x('begin')
  let dEdge = ''
  try {
    await x('alter table public.decisions drop constraint decisions_supersedes_same_office')
    await x(`insert into public.decisions (question, chose, ruled_out, because, decided_by, project_id, office_id, supersedes)
             values ('a forged revision?', 'forged', array['x'], 'forged because', 'ctx-person', null, '${A}', '${decisionB}')`)
    dEdge = c.json(
      (
        await x(
          `select app.decisions_about('${B}', ${lit(`Which ${CB} supplier do we use`)}, 4) as r`,
        )
      ).rows[0]?.r,
    )
  } catch (e) {
    dEdge = `ERROR ${String((e as Error).message)}`
  } finally {
    await x('rollback').catch(() => undefined)
  }
  c.check(
    dEdge.includes(CB),
    "decisions.supersedes: a forged edge from A's office does not retire B's decision for B",
    dEdge.slice(0, 100),
  )

  // ==== 6. the project brief =========================================================================================================
  c.check(
    (await w(`select app.project_instruction_for(${q(A)}, '${P.A}', 'research-director')`)) ===
      `${CA} instruction for this project`,
    "project_instruction_for: A reads its own project's instruction",
    '',
  )
  c.check(
    (await said(`select app.project_instruction_for(${q(A)}, '${P.B}', 'research-director')`)) ===
      (await said(
        `select app.project_instruction_for(${q(A)}, '${nobody}', 'research-director')`,
      )) &&
      !(
        await said(`select app.project_instruction_for(${q(A)}, '${P.B}', 'research-director')`)
      ).includes(CB),
    "project_instruction_for: B's project and a nonexistent one both read as no instruction",
    '',
  )
  const kA = await text(`select app.project_knowledge(${q(A)}, '${P.A}') - 'as_of'`)
  c.check(
    JSON.parse(kA).documents === 1 && !kA.includes(CB),
    "project_knowledge: A's own project holds A's one document",
    kA.slice(0, 120),
  )
  c.check(
    (await text(`select app.project_knowledge(${q(A)}, '${P.B}') - 'as_of'`)) ===
      (await text(`select app.project_knowledge(${q(A)}, '${nobody}') - 'as_of'`)),
    "project_knowledge: B's project and a nonexistent one are indistinguishable to A (200 documents are not counted)",
    '',
  )
  const refsA = c.json(await rows(`app.container_refs(${q(A)}, '${P.A}', 'notebooklm')`))
  c.check(
    refsA.includes(NB.A) &&
      c.json(await rows(`app.container_refs(${q(A)}, '${P.B}', 'notebooklm')`)) === '[]' &&
      c.json(await rows(`app.container_refs(${q(A)}, '${nobody}', 'notebooklm')`)) === '[]',
    "container_refs: A reads its own attachment; B's project and a nonexistent one yield none",
    refsA.slice(0, 80),
  )

  // ==== 7. siblings: decision 6 is bounded by the office, never by a project id alone =============================================
  const sibA = await rows<{ project_id: string; name: string; account_level: boolean }>(
    `app.sibling_projects(${q(A)}, '${P.A}')`,
  )
  c.check(
    sibA.some((s) => s.project_id === S.A) &&
      sibA.every((s) => s.project_id !== P.B && s.project_id !== S.B) &&
      !c.json(sibA).includes(CB),
    "sibling_projects: the widening from A's project reaches A's other projects and never B's",
    c.json(sibA.map((s) => s.name)).slice(0, 100),
  )
  c.check(
    (await text(
      `select jsonb_agg(project_id order by project_id) from app.sibling_projects(${q(A)}, '${P.B}')`,
    )) ===
      (await text(
        `select jsonb_agg(project_id order by project_id) from app.sibling_projects(${q(A)}, '${nobody}')`,
      )),
    "sibling_projects: asked from B's project id, A is answered as for a nonexistent project - A's own projects, never B's",
    '',
  )
  const unnamedSibs = await rows<{ project_id: string; account_level: boolean }>(
    `app.sibling_projects(${q(A)}, '${P.A}')`,
  )
  c.check(
    unnamedSibs.some((s) => s.project_id === unnamed.A && s.account_level) &&
      unnamedSibs.every((s) => s.project_id !== unnamed.B),
    "sibling_projects: the account-level project is A's own Unnamed, not B's",
    '',
  )
  c.check(
    c.json(
      await rows(
        `app.projects_named_in(${q(A)}, ${lit(`what does ${NAME.B} say? and ${ALIAS.B}`)}, '${P.A}')`,
      ),
    ) === '[]',
    "projects_named_in: a sentence that names B's project by name and by alias names none of A's",
    '',
  )
  c.check(
    c
      .json(
        await rows(
          `app.projects_named_in(${q(A)}, ${lit(`and what about ${CA} sibling please`)}, '${P.A}')`,
        ),
      )
      .includes(S.A),
    "projects_named_in: the positive control - A's sibling is found when A names it",
    '',
  )

  // ==== 8. mail: the most personal corpus ==============================================================================================
  const mailBefore = await c.snapshot(B, ['mail_messages'])
  const mA = await text(`select app.mail_for_project(${q(A)}, '${P.A}', 100)`)
  c.check(
    mA.includes(`ctxA-m1`) &&
      mA.includes(CA) &&
      !mA.includes(CB) &&
      !mA.includes('ctxB-') &&
      !mA.includes('bulk'),
    "mail_for_project: A is given A's messages and none of B's - including B's message FROM A's contact address",
    '',
  )
  const mB = await text(`select app.mail_for_project(${q(B)}, '${P.B}', 100)`)
  c.check(
    mB.includes('ctxB-m1') && !mB.includes('ctxA-') && !mB.includes(CA),
    "mail_for_project: B's are B's, and A's message from B's contact address is not among them",
    '',
  )
  c.check(
    (await text(`select app.mail_for_project(${q(A)}, '${P.B}', 100)`)) === '[]' &&
      (await text(`select app.mail_for_project(${q(A)}, '${nobody}', 100)`)) === '[]',
    "mail_for_project: B's project and a nonexistent one both yield nothing",
    '',
  )
  const msA = await text(
    `select app.mail_search(${q(A)}, ${lit(`${CB} ${ALIAS.B} renewal contract`)}, null, 50)`,
  )
  c.check(
    !msA.includes(CB) && !msA.includes('ctxB-'),
    "mail_search: a query that names B's canary and B's alias returns none of B's mail as A (whole inbox)",
    msA.slice(0, 80),
  )
  c.check(
    (await text(`select app.mail_search(${q(A)}, ${lit(CA)}, null, 50)`)).includes('ctxA-m1'),
    'mail_search: the positive control - A finds its own message by its own canary',
    '',
  )
  c.check(
    (await text(`select app.mail_search(${q(A)}, ${lit(`${CB} renewal`)}, '${P.B}', 50)`)) ===
      '[]' &&
      (await text(`select app.mail_search(${q(A)}, ${lit(`${CB} renewal`)}, '${nobody}', 50)`)) ===
        '[]',
    "mail_search: scoped to B's project or to a nonexistent one, A finds nothing",
    '',
  )
  const awA = await text(`select app.mail_awaiting(${q(A)}, '${P.A}', 7, 10)`)
  c.check(
    awA.includes(CA) &&
      !awA.includes(CB) &&
      (await text(`select app.mail_awaiting(${q(A)}, '${P.B}', 7, 10)`)) === '[]',
    "mail_awaiting: A is told about A's threads only, and B's project yields none",
    awA.slice(0, 100),
  )
  const covA = JSON.parse(await text(`select app.mail_coverage(${q(A)}, '${P.A}')`)) as {
    cached: number
    contacts: number
    aliases: number
    associated: number
  }
  const ownMail = (o: string) =>
    count(`select count(*)::int as n from public.mail_messages where office_id = '${o}'`)
  c.check(
    covA.cached === (await ownMail(A)) &&
      covA.cached !== (await ownMail(B)) &&
      covA.contacts === 1 &&
      covA.aliases >= 1 &&
      covA.associated >= 1,
    "mail_coverage: the cache count, contacts and aliases are A's own (B holds a different number)",
    c.json(covA),
  )
  c.check(
    (await text(`select app.mail_coverage(${q(A)}, '${P.B}')`)) ===
      (await text(`select app.mail_coverage(${q(A)}, '${nobody}')`)),
    "mail_coverage: B's project and a nonexistent one are indistinguishable to A",
    '',
  )
  // retention is per office
  const bOldBefore = await count(
    `select count(*)::int as n from public.mail_messages where message_id = 'ctxB-old'`,
  )
  const ret = (await w(`select app.forget_mail_before(${q(A)}, 365)`)) as {
    ok?: boolean
    removed?: number
  }
  c.check(
    ret.ok === true &&
      (await count(
        `select count(*)::int as n from public.mail_messages where message_id = 'ctxA-old'`,
      )) === 0 &&
      (await count(
        `select count(*)::int as n from public.mail_messages where message_id = 'ctxB-old'`,
      )) === bOldBefore &&
      bOldBefore === 1,
    "forget_mail_before: A's sweep removed A's old mail and left B's old message alone",
    c.json(ret),
  )
  await w(`select app.forget_mail_bodies_before(${q(A)}, 7)`)
  const bodyOf = async (id: string) =>
    (await x(`select body is null as gone from public.mail_messages where message_id = '${id}'`))
      .rows[0] as { gone: boolean }
  c.check(
    (await bodyOf('ctxA-bodyold')).gone === true &&
      (await bodyOf('ctxA-bodynew')).gone === false &&
      (await bodyOf('ctxB-bodyold')).gone === false,
    "forget_mail_bodies_before: A's sweep forgot A's aged body, kept A's fresh one, and left B's aged body alone",
    '',
  )
  c.check(
    mailBefore === (await c.snapshot(B, ['mail_messages'])),
    "mail: B's cache is byte-identical after A's reads and A's retention sweeps",
    '',
  )

  // ==== 9. the project router ================================================================================================================
  // (the two names are alike on purpose, so a close match on A's own project may legitimately come back - what may not is B's)
  const byBName = c.json(await rows(`app.resolve_project_by_name(${q(A)}, ${lit(NAME.B)})`))
  const byBAlias = c.json(
    await rows(`app.resolve_project_by_name(${q(A)}, ${lit(`${ALIAS.B} ${CB}`)})`),
  )
  c.check(
    !byBName.includes(P.B) &&
      !byBName.includes(S.B) &&
      !byBName.includes('bravo') &&
      !byBAlias.includes(P.B) &&
      !byBAlias.includes(S.B),
    "resolve_project_by_name: B's project name and B's alias never resolve to B's project as A (A's own close match may come back; B's may not)",
    byBName.slice(0, 80),
  )
  c.check(
    c.json(await rows(`app.resolve_project_by_name(${q(A)}, ${lit(ALIAS.A)})`)).includes(P.A),
    "resolve_project_by_name: the positive control - A's alias resolves to A's project",
    '',
  )
  const sharedA = c.json(await rows(`app.resolve_project_by_name(${q(A)}, ${lit(SHARED)})`))
  const sharedB = c.json(await rows(`app.resolve_project_by_name(${q(B)}, ${lit(SHARED)})`))
  c.check(
    sharedA.includes(P.A) &&
      !sharedA.includes(P.B) &&
      sharedB.includes(P.B) &&
      !sharedB.includes(P.A),
    "resolve_project_by_name: a phrase both offices hold resolves to each office's own project",
    '',
  )
  const rp = (o: string, kind: string, ref: string, explicit: string | null, said: string | null) =>
    `select app.resolve_project(${q(o)}, '${kind}', ${lit(ref)}, ${explicit === null ? 'null' : `'${explicit}'::uuid`}, ${said === null ? 'null' : lit(said)})`
  c.check(
    (await w(rp(A, 'telegram_chat', 'ctx-chat-1', null, `look at ${ALIAS.B} please ${NAME.B}`))) ===
      null,
    "resolve_project: a sentence naming B's project by name and alias resolves to nobody for A (the router asks)",
    '',
  )
  c.check(
    (await w(rp(A, 'telegram_chat', 'ctx-chat-1', null, `look at ${ALIAS.A} please`))) === P.A,
    "resolve_project: the positive control - A's alias resolves to A's project",
    '',
  )
  c.check(
    (await w(rp(A, 'telegram_chat', 'ctx-chat-1', P.B, null))) ===
      (await w(rp(A, 'telegram_chat', 'ctx-chat-1', nobody, null))) &&
      (await w(rp(A, 'telegram_chat', 'ctx-chat-1', P.B, null))) === null &&
      (await w(rp(A, 'telegram_chat', 'ctx-chat-1', P.A, null))) === P.A,
    "resolve_project: an explicit project of B is not trusted - it reads exactly as one that does not exist (null), while A's own explicit project is accepted",
    '',
  )
  c.check(
    (await w(
      rp(A, 'telegram_chat', 'ctx-chat-2', null, `have a look at notebook ${NB.B} and tell me`),
    )) === null &&
      (await w(
        rp(B, 'telegram_chat', 'ctx-chat-2', null, `have a look at notebook ${NB.B} and tell me`),
      )) === P.B,
    'resolve_project: a notebook id typed in the words resolves to the office that holds it, and to nobody for the other office',
    '',
  )
  c.check(
    (await w(rp(A, 'slack_channel', CHAN.B, null, null))) === null &&
      (await w(rp(B, 'slack_channel', CHAN.B, null, null))) === P.B &&
      (await w(rp(A, 'slack_channel', CHAN.A, null, null))) === P.A,
    "resolve_project: B's mapped Slack channel resolves to nothing for A and to B's project for B; A's own channel resolves for A",
    '',
  )
  c.check(
    (await w(`select app.project_for_slack_channel(${q(A)}, '${CHAN.B}')`)) === null &&
      (await w(`select app.project_for_slack_channel(${q(B)}, '${CHAN.B}')`)) === P.B,
    "project_for_slack_channel: the channel map is read through the office's own projects",
    '',
  )
  c.check(
    c.json(await rows(`app.references_in(${q(A)}, ${lit(`see ${NB.B}`)})`)) === '[]' &&
      c.json(await rows(`app.references_in(${q(B)}, ${lit(`see ${NB.B}`)})`)).includes(P.B),
    'references_in: an attachment id named in words is found in its own office and in no other',
    '',
  )
  c.check(
    (await said(`select app.add_project_alias(${q(A)}, '${P.B}', 'zxqintruder')`)) ===
      (await said(`select app.add_project_alias(${q(A)}, '${nobody}', 'zxqintruder')`)) &&
      (await count(
        `select count(*)::int as n from public.project_aliases where alias = 'zxqintruder'`,
      )) === 0,
    "add_project_alias: B's project and a nonexistent one are refused in the same words, and nothing was written",
    '',
  )

  // ==== 10. offers and the noticing pass ========================================================================================================
  const RULE = `Always put ${c.canary.A.toLowerCase()} first in every single reply`
  const offerB = (await w(`select app.propose_standing_rule(${q(B)}, ${lit(RULE)}, 'global')`)) as {
    offered?: boolean
  }
  const offerA = (await w(`select app.propose_standing_rule(${q(A)}, ${lit(RULE)}, 'global')`)) as {
    offered?: boolean
    why?: string
  }
  const again = (await w(`select app.propose_standing_rule(${q(A)}, ${lit(RULE)}, 'global')`)) as {
    offered?: boolean
    why?: string
  }
  c.check(
    (offerA.offered === true && offerB.offered === true) ||
      (offerA.offered === false && again.offered === false),
    'propose_standing_rule: B\'s open offer of the same sentence does not make A\'s read "already offered" nor fail it',
    c.json([offerB, offerA, again]),
  )
  c.check(
    (await count(
      `select count(*)::int as n from public.suggestions where body = ${lit(RULE)} and office_id = '${A}'`,
    )) === 1 &&
      (await count(
        `select count(*)::int as n from public.suggestions where body = ${lit(RULE)} and office_id = '${B}'`,
      )) === 1 &&
      again.offered === false,
    'propose_standing_rule: each office holds its own one open offer, and the same office offering twice is told it has already offered',
    c.json(again),
  )
  c.check(
    (await said(
      `select app.propose_standing_rule(${q(A)}, 'a rule about a project here', 'project', null, '${P.B}')`,
    )) ===
      (await said(
        `select app.propose_standing_rule(${q(A)}, 'a rule about a project here', 'project', null, '${nobody}')`,
      )),
    "propose_standing_rule: B's project and a nonexistent project are refused in the same words",
    '',
  )
  const procA = (await w(
    `select app.propose_standing_procedure(${q(A)}, 'ctx procedure name', 'when it comes up', 'do the thing carefully and tell me')`,
  )) as { offered?: boolean; why?: string }
  const procB = (await w(
    `select app.propose_standing_procedure(${q(B)}, 'ctx procedure name', 'when it comes up', 'do the thing carefully and tell me')`,
  )) as { offered?: boolean; why?: string }
  c.check(
    (procA.offered === true || procA.why === 'already offered once') &&
      (procB.offered === true || procB.why === 'already offered once') &&
      (await count(
        `select count(*)::int as n from public.suggestions where kind = 'standing_procedure' and subject_ref like 'ctx-procedure-name%' and office_id = '${A}'`,
      )) === 1 &&
      (await count(
        `select count(*)::int as n from public.suggestions where kind = 'standing_procedure' and subject_ref like 'ctx-procedure-name%' and office_id = '${B}'`,
      )) === 1,
    'propose_standing_procedure: the same procedure offered in two offices is two offers',
    c.json([procA, procB]),
  )
  // the unique index is per office now
  const dupAttempt = async (office: string) =>
    c.refusal(
      W,
      `insert into public.suggestions (office_id, kind, subject_ref, body, state) values ('${office}', 'ctx_kind', 'same-ref', 'a suggestion body here', 'open')`,
    )
  await x(
    `insert into public.suggestions (office_id, kind, subject_ref, body, state) values ('${A}', 'ctx_kind', 'same-ref', 'a suggestion body here', 'open') on conflict do nothing`,
  )
  await x(
    `insert into public.suggestions (office_id, kind, subject_ref, body, state) values ('${B}', 'ctx_kind', 'same-ref', 'a suggestion body here', 'open') on conflict do nothing`,
  )
  c.check(
    (await count(
      `select count(*)::int as n from public.suggestions where kind = 'ctx_kind' and subject_ref = 'same-ref' and state = 'open'`,
    )) === 2 && (await dupAttempt(A)).includes('suggestions_one_open'),
    'suggestions_one_open: two offices may each hold an open suggestion of the same kind and reference; one office still may not hold two',
    (await dupAttempt(A)).slice(0, 100),
  )
  const noticeA = await text(
    `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.notice(${q(A)}, 100) t`,
  )
  const noticeB = await text(
    `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from app.notice(${q(B)}, 100) t`,
  )
  // an observation already offered is not offered again, so on a re-run the observation is read from what was raised
  const heldA = c.json(
    (
      await x(
        `select coalesce(jsonb_agg(body), '[]'::jsonb) as r from public.suggestions where office_id = '${A}'`,
      )
    ).rows[0]?.r,
  )
  const heldB = c.json(
    (
      await x(
        `select coalesce(jsonb_agg(body), '[]'::jsonb) as r from public.suggestions where office_id = '${B}'`,
      )
    ).rows[0]?.r,
  )
  c.check(
    (noticeA + heldA).includes(CA) &&
      !(noticeA + heldA).includes(CB) &&
      (noticeB + heldB).includes(CB) &&
      !(noticeB + heldB).includes(CA),
    "notice: the observations (an unowned deadline) are built from the office's own tasks",
    '',
  )
  c.check(
    (noticeA + heldA).includes('ctxneeda') &&
      !(noticeA + heldA).includes('ctxneedb') &&
      (noticeB + heldB).includes('ctxneedb') &&
      !(noticeB + heldB).includes('ctxneeda'),
    "notice: a capability the office keeps missing is counted from the office's own impediments",
    '',
  )
  c.check(
    c.json(await rows(`app.recurring_failures(${q(A)}, 3, 14)`)).includes('ctxa') &&
      !c.json(await rows(`app.recurring_failures(${q(A)}, 3, 14)`)).includes('ctxb'),
    "recurring_failures: A sees its own repeating failure and not B's",
    '',
  )
  c.check(
    c.json(await rows(`app.impediments_tally(${q(A)}, 30, 1, false)`)).includes('ctxneeda') &&
      !c.json(await rows(`app.impediments_tally(${q(A)}, 30, 1, false)`)).includes('ctxneedb'),
    "impediments_tally: A counts its own walls and not B's",
    '',
  )
  const bBefore = await c.snapshot(B, ['suggestions'])
  const raised = Number(await w(`select app.raise_suggestions(${q(A)}, 100)`))
  const raisedAgain = Number(await w(`select app.raise_suggestions(${q(A)}, 100)`))
  c.check(
    raised >= 0 && raisedAgain === 0 && bBefore === (await c.snapshot(B, ['suggestions'])),
    "raise_suggestions: A's pass raises suggestions in A, a second pass raises none, and B's suggestions are untouched",
    `${String(raised)} then ${String(raisedAgain)}`,
  )
  const sugA = c.json(
    (
      await x(
        `select coalesce(jsonb_agg(body), '[]'::jsonb) as r from public.suggestions where office_id = '${A}'`,
      )
    ).rows[0]?.r,
  )
  c.check(
    sugA.includes(CA) && !sugA.includes(CB),
    "raise_suggestions: the suggestions A holds name A's things and none of B's",
    '',
  )
  await w(`select app.raise_suggestions(${q(B)}, 100)`)
  c.check(
    (await count(
      `select count(*)::int as n from public.suggestions where office_id = '${B}' and body like '%${CB}%'`,
    )) >= 1 &&
      (await count(
        `select count(*)::int as n from public.suggestions where office_id = '${A}' and body like '%${CB}%'`,
      )) === 0,
    "raise_suggestions: B's pass raises B's own, none of which landed in A",
    '',
  )
  const rwA = c.json(await rows(`app.reach_wanted(${q(A)})`))
  c.check(
    rwA.includes('ctx.wantsa') && !rwA.includes('ctx.wantsb'),
    "reach_wanted: A's open asks are A's own",
    '',
  )
  const pressureA = (await rows<{ open_items: number }>(`app.needs_me_pressure(${q(A)})`))[0]
  c.check(
    pressureA?.open_items ===
      (await count(
        `select count(*)::int as n from public.blockers where office_id = '${A}' and state = 'open' and not coalesce(app.harness_job(job_id), false)`,
      )),
    "needs_me_pressure: the open count is the office's own",
    c.json(pressureA),
  )

  // ==== 11. the morning briefing ================================================================================================================
  const factsA = await text(`select app.morning_briefing_facts(${q(A)})`)
  const factsB = await text(`select app.morning_briefing_facts(${q(B)})`)
  c.check(
    factsA.includes(CA) && !factsA.includes(CB) && factsB.includes(CB) && !factsB.includes(CA),
    "morning_briefing_facts: what waits on the person, the diary and the noticed list are the office's own",
    '',
  )
  const fa = JSON.parse(factsA) as {
    waiting_on_you: unknown[]
    diary: unknown[]
    overnight: { finished: number }
    pressure: { open_items: number }
  }
  const fb = JSON.parse(factsB) as typeof fa
  const ownDone = (o: string) =>
    count(
      `select count(*)::int as n from public.jobs j where j.office_id = '${o}' and not app.harness_job(j.job_id) and j.updated_at >= app.now_utc() - interval '18 hours' and j.state = 'complete'`,
    )
  // the other case files leave blockers, jobs and diary entries in these offices too, so each expectation is counted
  // independently from the table, by the same definition, rather than written down
  const ownWaiting = (o: string) =>
    count(
      `select count(*)::int as n from public.blockers where office_id = '${o}' and state = 'open' and not coalesce(app.harness_job(job_id), false)`,
    )
  const ownDiary = (o: string) =>
    count(`select count(*)::int as n from public.calendar_events c where c.office_id = '${o}'
            and (c.starts_at at time zone app.grant_timezone())::date = (app.now_utc() at time zone app.grant_timezone())::date`)
  const wA = await ownWaiting(A)
  const wB = await ownWaiting(B)
  c.check(
    fa.waiting_on_you.length === wA &&
      fb.waiting_on_you.length === wB &&
      wA !== wB &&
      fa.diary.length === (await ownDiary(A)) &&
      fb.diary.length === (await ownDiary(B)) &&
      fa.overnight.finished === (await ownDone(A)) &&
      fb.overnight.finished === (await ownDone(B)) &&
      fa.pressure.open_items === wA &&
      fb.pressure.open_items === wB,
    "morning_briefing_facts: waiting, diary, overnight and pressure are each the office's own count (the two offices differ), never the sum",
    c.json([
      fa.waiting_on_you.length,
      fb.waiting_on_you.length,
      wA,
      wB,
      fa.overnight.finished,
      fb.overnight.finished,
    ]),
  )
  const body = `A morning briefing body for ${CA} that is comfortably over the forty character floor.`
  const day = '2031-01-02'
  const wbA = (await w(
    `select app.write_briefing(${q(A)}, 'morning', '${day}'::date, ${lit(body)}, '{}'::jsonb)`,
  )) as { briefing_id?: string; already_written?: boolean }
  const wbB = (await w(
    `select app.write_briefing(${q(B)}, 'morning', '${day}'::date, ${lit(body.replace(CA, CB))}, '{}'::jsonb)`,
  )) as { briefing_id?: string }
  const wbA2 = (await w(
    `select app.write_briefing(${q(A)}, 'morning', '${day}'::date, ${lit(body)}, '{}'::jsonb)`,
  )) as { briefing_id?: string; already_written?: boolean }
  const brief = async (id: string | undefined) =>
    (
      await x(
        `select office_id::text as o, scope_ref from public.briefings where briefing_id = '${String(id)}'`,
      )
    ).rows[0] as { o: string; scope_ref: string } | undefined
  c.check(
    wbA.briefing_id !== undefined &&
      wbB.briefing_id !== undefined &&
      wbA.briefing_id !== wbB.briefing_id &&
      wbA2.already_written === true &&
      wbA2.briefing_id === wbA.briefing_id &&
      (await brief(wbA.briefing_id))?.o === A &&
      (await brief(wbB.briefing_id))?.o === B,
    'write_briefing: each office writes its own briefing for the day; a repeat is "already written" with the OFFICE\'S OWN id, never the other\'s',
    c.json([wbA, wbB, wbA2]).slice(0, 160),
  )
  c.check(
    (await brief(wbA.briefing_id))?.scope_ref !== 'grant' &&
      (await brief(wbA.briefing_id))?.scope_ref ===
        String(await w(`select app.office_actor(${q(A)})`)),
    "write_briefing: the scope defaults to the office's own person, not to the literal 'grant'",
    '',
  )
  const clash = (await w(
    `select app.write_briefing(${q(A)}, 'morning', '${day}'::date, ${lit(body)}, '{}'::jsonb, ${lit(String((await brief(wbB.briefing_id))?.scope_ref))})`,
  )) as { briefing_id?: string }
  c.check(
    clash.briefing_id !== undefined &&
      clash.briefing_id !== wbB.briefing_id &&
      (await brief(clash.briefing_id))?.o === A,
    "write_briefing: A naming B's scope for the same day writes A's own row and is not handed B's id",
    c.json(clash).slice(0, 100),
  )

  // ==== 12. the calendar plan ===========================================================================================================================
  const doneTask = uid('b-task-done')
  await x(`insert into public.tasks (task_id, title, office_id, project_id, state, assigned_to_human, due_on, done_at)
           values ('${doneTask}', ${lit(`${CB} an old task`)}, '${B}', '${P.B}', 'done', false, current_date + 1, app.now_utc()) on conflict do nothing`)
  await x(`insert into public.task_calendar_links (task_id, calendar_id, event_id, pushed_hash)
           values ('${doneTask}', 'cal', ${lit(`event-${CB}`)}, 'h') on conflict do nothing`)
  const planA = await text(`select app.calendar_task_plan(${q(A)})`)
  const planB = await text(`select app.calendar_task_plan(${q(B)})`)
  c.check(
    planA.includes(`${CA} write the report`) &&
      !planA.includes(CB) &&
      planB.includes(`${CB} write the report`) &&
      !planB.includes(CA),
    "calendar_task_plan: the events to create are the office's own dated tasks",
    '',
  )
  c.check(
    JSON.parse(planB).remove.some((r: { event_id: string }) => r.event_id === `event-${CB}`) &&
      !JSON.parse(planA).remove.some((r: { event_id: string }) => r.event_id === `event-${CB}`),
    "calendar_task_plan: B's calendar link for a task that is no longer wanted is B's to remove - it is not in A's plan to delete from A's diary",
    '',
  )

  // ==== 13. notification preferences ====================================================================================================================
  const allowed = async (office: string, subject: string, channel: string) =>
    w(
      `select app.notification_allowed(${q(office)}, ${lit(subject)}, ${lit(channel)}, 'routine'::public.notify_severity)`,
    )
  c.check(
    (await allowed(A, 'ctx-subject-a', 'slack')) === false &&
      (await allowed(B, 'ctx-subject-a', 'slack')) === true,
    "notification_allowed: A's mute of its own subject binds A; B asking about the same subject text is not bound by it",
    '',
  )
  c.check(
    (await allowed(B, 'ctx-subject-b', 'telegram')) === false &&
      (await allowed(A, 'ctx-subject-b', 'telegram')) === true,
    "notification_allowed: and B's mute binds B alone",
    '',
  )

  // ==== 14. the capability brief ==========================================================================================================================
  const capA = await text(`select app.capability_index(${q(A)}, 'research-director')`)
  const capB = await text(`select app.capability_index(${q(B)}, 'research-director')`)
  const reachOf = (t: string, service: string) =>
    (JSON.parse(t).reach as { service: string; reachable: boolean; detail: string | null }[]).find(
      (r) => r.service === service,
    )
  c.check(
    reachOf(capA, 'Slack')?.reachable === false &&
      String(reachOf(capA, 'Slack')?.detail).includes(CA) &&
      !capA.includes(CB) &&
      reachOf(capB, 'Telegram')?.reachable === false &&
      String(reachOf(capB, 'Telegram')?.detail).includes(CB) &&
      !capB.includes(CA),
    "capability_index: the reach is the office's OWN credentials - A is told its Slack is dead, B is told its Telegram is, and neither reads the other's detail",
    '',
  )
  c.check(
    reachOf(capA, 'Telegram') === undefined || reachOf(capA, 'Telegram')?.reachable === true,
    "capability_index: B's dead Telegram credential does not make Telegram unreachable for A",
    c.json(reachOf(capA, 'Telegram')),
  )
  const canA = (JSON.parse(capA).can as { tool: string }[]).map((t) => t.tool)
  const canB = (JSON.parse(capB).can as { tool: string }[]).map((t) => t.tool)
  const askB = (JSON.parse(capB).must_ask as { tool: string }[]).map((t) => t.tool)
  c.check(
    canA.includes('drive.ingest') &&
      !canB.includes('drive.ingest') &&
      askB.includes('drive.ingest'),
    "capability_index: what an agent CAN do is the office's own grants - A granted Emma drive.ingest, B did not",
    '',
  )
  c.check(
    !capA.includes('ctx.declinedb') &&
      JSON.parse(capB).declined.some((d: { tool: string }) => d.tool === 'ctx.declinedb') &&
      !capA.includes('declined for good reasons'),
    "capability_index: B's declined request is B's to be told about, not A's",
    '',
  )

  // ==== 15. append_event: the ledger is a carrier ==========================================================================================================
  const ev = await w(
    `select app.append_event(${q(A)}, gen_random_uuid(), 'agent', 'ctx', 'ctx', 'ctx.test', false, '${P.A}')`,
  )
  c.check(
    (await count(
      `select count(*)::int as n from public.events where event_id = '${String(ev)}' and office_id = '${A}'`,
    )) === 1,
    'append_event: the event is filed under the office that wrote it, with the office stated',
    '',
  )
  const foreignProject = await c.try_(
    W,
    `select app.append_event(${q(A)}, gen_random_uuid(), 'agent', 'ctx', 'ctx', 'ctx.test', false, '${P.B}')`,
  )
  c.check(
    !foreignProject.ok,
    "append_event: A cannot file an event under B's project (the same-office key refuses it)",
    foreignProject.ok ? 'ACCEPTED' : foreignProject.error.slice(0, 80),
  )

  // ==== 16. B was untouched by all of it ====================================================================================================================
  c.check(
    (await count(
      `select count(*)::int as n from public.lessons where office_id = '${B}' and learned_by <> 'ctx-person'`,
    )) === strangersLessonsInB,
    "no lesson of B's was written or altered by A",
    '',
  )
  c.check(
    (await bridge()) === bridgeBefore,
    'the converted writers added no office_bridge_use rows (every office was stated explicitly)',
    `${String(bridgeBefore)} -> ${String(await bridge())}`,
  )
}
