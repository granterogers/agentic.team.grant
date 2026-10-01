/**
 * The read side of the dashboard (migrations 0750-0753, cluster e-views): the overview, pulse, studio, feeds,
 * counters, usage and cost views, conversation history, the health reading and delivery retry.
 *
 * Person A and Person B each get rows of every kind the payloads count - with canary text in everything a payload
 * prints, and DIFFERENT numbers of everything, so that a counter that sums across offices cannot equal both. The
 * rows are written once (fixed ids, `on conflict do nothing`) so the file can be run again against the same clone,
 * which the sabotage runs do.
 */
import { createHash } from 'node:crypto'
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

const CA = 'VIEWS-CANARY-AAA'
const CB = 'VIEWS-CANARY-BBB'
const uid = (label: string): string => {
  const h = createHash('md5').update(`views:${label}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** How many of each thing each office holds. They differ on purpose. */
const N = {
  A: {
    live: 2,
    done: 1,
    failed: 1,
    tasks: 2,
    blockers: 2,
    docs: 1,
    msgs: 1,
    events: 1,
    undo: 1,
    usage: 2,
    sent: 1,
    cal: 1,
  },
  B: {
    live: 3,
    done: 2,
    failed: 0,
    tasks: 3,
    blockers: 3,
    docs: 2,
    msgs: 2,
    events: 2,
    undo: 2,
    usage: 3,
    sent: 2,
    cal: 2,
  },
} as const

export async function cases(c: Ctx): Promise<void> {
  const { A, B, G, SYS } = c
  const S = 'service_role'
  const q = (x: string) => lit(x)
  const x = (sql: string) => c.db.execute(sql)

  const bridgeBefore = Number(
    (
      (await x('select coalesce(sum(n),0)::int as n from public.office_bridge_use')).rows[0] as {
        n: number
      }
    ).n,
  )

  /** An independent count, straight from the table, for the numbers a payload must agree with. */
  const count = async (sql: string): Promise<number> =>
    Number(((await x(sql)).rows[0] as { n: number }).n)
  const ownCount = (table: string, office: string, where = 'true') =>
    count(
      `select count(*)::int as n from public.${table} where office_id = '${office}' and ${where}`,
    )
  const LIVE = "state not in ('complete','cancelled','failed')"

  // ---- the seed -----------------------------------------------------------------------------------------------------------------
  const seed = async (who: 'A' | 'B', office: string, tag: string) => {
    const n = N[who]
    const l = who.toLowerCase()
    const proj = uid(`${l}-project`)
    // an active project must have an attachment (ADR-0014): both rows, in one transaction
    await x(`begin;
             insert into public.projects (project_id, slug, name, status, office_id)
             values ('${proj}', 'views-proj', '${tag} project', 'active', '${office}') on conflict do nothing;
             insert into public.project_attachments (project_id, connector, external_ref, display_name, role)
             select '${proj}', 'upload', 'views-${l}', 'views upload', 'source'
              where not exists (select 1 from public.project_attachments where project_id = '${proj}');
             commit;`)
    const job = (label: string, state: string, kind: string, extra = '') => {
      const id = uid(`${l}-job-${label}`)
      const terminal = state === 'complete' || state === 'failed'
      return {
        id,
        sql: `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state,
                                         recipient_agent, created_at ${terminal ? ', finished_at, started_at' : ''})
              values ('${id}', '${id}', 'views-key-${l}-${label}', '${kind}', 'teamhq:views-${l}', '${proj}', '${office}', '${state}',
                      'chief-of-staff', app.now_utc() - interval '3 hours' ${terminal ? ", app.now_utc() - interval '5 minutes', app.now_utc() - interval '20 minutes'" : ''}${extra})
              on conflict do nothing`,
      }
    }
    for (let i = 0; i < n.live; i++) await x(job(`live${i}`, 'queued', 'office.instruction').sql)
    for (let i = 0; i < n.done; i++) await x(job(`done${i}`, 'complete', 'office.instruction').sql)
    for (let i = 0; i < n.failed; i++) await x(job(`failed${i}`, 'failed', `office.views_${l}`).sql)
    // a harness job and a question on it: the harness filters must keep working
    await x(
      `insert into public.jobs (job_id, correlation_id, idempotency_key, kind, requested_by, project_id, office_id, state, created_at)
       values ('${uid(`${l}-job-harness`)}', '${uid(`${l}-job-harness`)}', 'views-key-${l}-harness', 'office.instruction', 'verify:views-${l}', '${proj}', '${office}', 'queued', app.now_utc() - interval '3 hours') on conflict do nothing`,
    )
    await x(
      `insert into public.blockers (blocker_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, project_id, job_id)
       values ('${uid(`${l}-blocker-harness`)}', '${tag} harness question', 'why', 'late', '{ok}', 'x', true, '${office}', '${proj}', '${uid(`${l}-job-harness`)}') on conflict do nothing`,
    )
    for (let i = 0; i < n.blockers; i++)
      await x(`insert into public.blockers (blocker_id, requested_action, why_needed, consequences_of_delay, approval_options, originating_agent, work_can_continue, office_id, project_id, job_id)
               values ('${uid(`${l}-blocker${i}`)}', '${tag} approve the thing ${i}', 'why', 'late', '{yes,no}', 'chief-of-staff', true, '${office}', '${proj}', '${uid(`${l}-job-live0`)}') on conflict do nothing`)
    for (let i = 0; i < n.tasks; i++)
      await x(`insert into public.tasks (task_id, title, office_id, project_id, state, assigned_to_human)
               values ('${uid(`${l}-task${i}`)}', '${tag} task ${i}', '${office}', '${proj}', 'todo', false) on conflict do nothing`)
    for (let i = 0; i < n.docs; i++)
      await x(`insert into public.documents (document_id, title, office_id, project_id, produced_by_job)
               values ('${uid(`${l}-doc${i}`)}', '${tag} document ${i}', '${office}', '${proj}', '${uid(`${l}-job-done0`)}') on conflict do nothing`)
    for (let i = 0; i < n.msgs; i++)
      await x(`insert into public.inbound_commands (command_id, origin_channel, origin_ref, actor, instruction, dedupe_key, office_id, project_id)
               values ('${uid(`${l}-msg${i}`)}', 'teamhq', 'views:${l}${i}', '${l}', '${tag} said ${i}', 'teamhq:views_${l}:m${i}', '${office}', '${proj}') on conflict do nothing`)
    for (let i = 0; i < n.done; i++)
      await x(`insert into public.outputs (output_id, job_id, body, confidence, evidence)
               values ('${uid(`${l}-out${i}`)}', '${uid(`${l}-job-done${i}`)}', '${tag} answer ${i}', 'high', 'verified') on conflict do nothing`)
    for (let i = 0; i < n.events; i++)
      await x(`insert into public.events (event_id, correlation_id, actor_kind, actor, trigger, action_type, reversible, office_id, project_id, rationale_summary)
               values ('${uid(`${l}-event${i}`)}', '${uid(`${l}-event${i}`)}', 'agent', 'chief-of-staff', 'x', 'document.created', false, '${office}', '${proj}', '${tag} why ${i}') on conflict do nothing`)
    for (let i = 0; i < n.undo; i++)
      await x(`insert into public.undoable_actions (action_id, correlation_id, kind, description, reversal, office_id, status, undo_deadline)
               values ('${uid(`${l}-undo${i}`)}', '${uid(`${l}-undo${i}`)}', 'task.state', '${tag} undo ${i}', '{"action":"task_state"}', '${office}', 'available', app.now_utc() + interval '1 hour') on conflict do nothing`)
    for (let i = 0; i < n.usage; i++)
      await x(`insert into public.inference_usage (usage_id, provider, model_id, job_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance, office_id)
               values ('${uid(`${l}-usage${i}`)}', 'openrouter', 'views/${l}-model', '${uid(`${l}-job-done0`)}', '${uid(`${l}-usage${i}`)}', 'ok', 100, 50, 0.01, 'calculated', '${office}') on conflict do nothing`)
    for (let i = 0; i < n.sent; i++)
      await x(`insert into public.deliveries (delivery_id, channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, job_id, sent_at, message_ref, office_id)
               values ('${uid(`${l}-delivery${i}`)}', 'slack', 'views-${l}-d${i}', 'acct', 'C0VIEWS${l.toUpperCase()}1', 'result', 'sent', 1, app.now_utc(), '${uid(`${l}-job-done0`)}', app.now_utc(), 'ref${i}', '${office}') on conflict do nothing`)
    // one delivery that failed, on the first finished job: the retry attack's subject
    await x(`insert into public.deliveries (delivery_id, channel, dedupe_key, account_ref, target_ref, purpose, state, attempt, lease_expires_at, job_id, office_id, error_code)
             values ('${uid(`${l}-delivery-failed`)}', 'telegram', 'views-${l}-failed', 'acct', '4242', 'result', 'failed', 3, app.now_utc(), '${uid(`${l}-job-done0`)}', '${office}', 'views_down') on conflict do nothing`)
    for (let i = 0; i < n.cal; i++)
      await x(`insert into public.calendar_events (event_id, calendar_id, summary, starts_at, ends_at, office_id)
               values ('views-${l}-cal${i}', 'cal', '${tag} meeting ${i}', app.now_utc() + interval '1 hour', app.now_utc() + interval '2 hours', '${office}') on conflict do nothing`)
    await x(`insert into public.contact_labels (label_id, name, hue, sort, owner, office_id)
             values ('${uid(`${l}-label`)}', '${tag} label', 'p-rust', 1, 'views', '${office}') on conflict do nothing`)
    await x(`insert into public.appearance_settings (owner, settings, office_id)
             values ('views-${l}', '{"canary":"${tag}"}', '${office}') on conflict do nothing`)
    await x(`insert into public.job_impediments (impediment_id, job_id, project_id, staff_slug, kind, needed_raw, noticed_by)
             values ('${uid(`${l}-wall`)}', '${uid(`${l}-job-done0`)}', '${proj}', 'chief-of-staff', 'missing_tool', '${tag} wall', 'views') on conflict do nothing`)
    return proj
  }
  const pa = await seed('A', A, CA)
  const pb = await seed('B', B, CB)
  // B's credential for Slack is dead; A has none - the channel reading must not leak across
  await x(`insert into public.connection_health (service, credential, state, detail, owner, office_id)
           values ('Slack', 'views-bot', 'dead', 'views detail ${CB}', 'views', '${B}') on conflict do nothing`)
  // the deployment's own model calls: no job, no person. They sit in the system office.
  for (let i = 0; i < 4; i++)
    await x(`insert into public.inference_usage (usage_id, provider, model_id, correlation_id, outcome, prompt_tokens, completion_tokens, cost_usd, provenance, office_id)
             values ('${uid(`sys-usage${i}`)}', 'openrouter', 'views/system-model', '${uid(`sys-usage${i}`)}', 'ok', 10, 5, 0.5, 'calculated', '${SYS}') on conflict do nothing`)

  const call = async (sql: string) => c.exec(S, sql)
  const text = async (sql: string) => c.json(await call(sql))
  const tx = (office: string, fn: string, rest = '') =>
    `select public.${fn}(${q(office)}${rest ? `, ${rest}` : ''})`
  const num = (v: unknown): number => Number(v)

  c.check(
    (
      await x(
        `select count(*)::int as n from public.jobs where office_id = '${A}' and kind = 'office.instruction' and state = 'queued' and requested_by = 'teamhq:views-a'`,
      )
    ).rows.length === 1,
    'the seed is written',
    '',
  )

  // ==== hq_pulse: every counter is the office's own =======================================================================
  const pulseA = (await call(tx(A, 'hq_pulse'))) as Record<string, number>
  const pulseB = (await call(tx(B, 'hq_pulse'))) as Record<string, number>
  c.check(
    pulseA.jobs_running === N.A.live && pulseB.jobs_running === N.B.live,
    "hq_pulse: jobs_running is the office's own live jobs, and the harness job is not counted",
    `A ${pulseA.jobs_running}/${N.A.live}, B ${pulseB.jobs_running}/${N.B.live}`,
  )
  c.check(
    pulseA.jobs_done === N.A.done &&
      pulseB.jobs_done === N.B.done &&
      pulseA.outputs === N.A.done &&
      pulseB.outputs === N.B.done,
    "hq_pulse: jobs_done and outputs are the office's own",
    c.json(pulseA),
  )
  // the other case files leave tasks in these offices too, so the expectation is counted from the table
  const ownOpen = async (office: string) =>
    Number(
      (
        (
          await x(
            `select count(*)::int as n from public.tasks where office_id = '${office}' and state in ('todo','doing','blocked') and not is_fixture`,
          )
        ).rows[0] as { n: number }
      ).n,
    )
  const openA = await ownOpen(A)
  const openB = await ownOpen(B)
  const docsA = await ownCount('documents', A)
  const docsB = await ownCount('documents', B)
  c.check(
    pulseA.tasks_open === openA &&
      pulseB.tasks_open === openB &&
      pulseA.documents === docsA &&
      pulseB.documents === docsB &&
      docsA !== docsB,
    "hq_pulse: tasks_open and documents are the office's own",
    c.json(pulseA),
  )
  const msgsA = await ownCount('inbound_commands', A)
  const msgsB = await ownCount('inbound_commands', B)
  c.check(
    pulseA.messages === msgsA && pulseB.messages === msgsB && msgsA !== msgsB,
    "hq_pulse: messages is the office's own",
    c.json(pulseA),
  )

  // ==== hq_overview: counts, the needs-me list, today, the projects, the calendar ===============================================
  const ovA = (await call(tx(A, 'hq_overview'))) as {
    counts: Record<string, number>
    needs_me: { requested_action: string }[]
    today: { project_name: string }[]
    projects: { slug: string; name: string; open_blockers: number; live_jobs: number }[]
    calendar: { events: { summary: string }[] }
  }
  const ovB = (await call(tx(B, 'hq_overview'))) as typeof ovA
  const ovAText = c.json(ovA)
  c.check(
    !ovAText.includes(CB) && ovAText.includes(CA),
    "hq_overview: A's payload holds A's canary and none of B's",
    '',
  )
  c.check(
    ovA.counts.needs_me === N.A.blockers && ovB.counts.needs_me === N.B.blockers,
    "hq_overview: the Needs You count is the office's own, and a harness question is not in it",
    `A ${ovA.counts.needs_me}/${N.A.blockers}, B ${ovB.counts.needs_me}/${N.B.blockers}`,
  )
  const liveA = await ownCount('jobs', A, LIVE)
  const liveB = await ownCount('jobs', B, LIVE)
  c.check(
    ovA.counts.live_jobs === liveA && ovB.counts.live_jobs === liveB && liveA !== liveB,
    "hq_overview: live_jobs is the office's own (the harness job is live and is counted here, as it always was)",
    `A ${ovA.counts.live_jobs}, B ${ovB.counts.live_jobs}`,
  )
  c.check(
    ovA.counts.undo_offers === N.A.undo && ovB.counts.undo_offers === N.B.undo,
    "hq_overview: undo_offers is the office's own",
    `A ${ovA.counts.undo_offers}, B ${ovB.counts.undo_offers}`,
  )
  const attA = ovA.projects.find((p) => p.name.includes(CA))
  c.check(
    ovA.projects.every((p) => !p.name.includes(CB)) &&
      attA !== undefined &&
      attA.open_blockers === N.A.blockers + 1 &&
      attA.live_jobs === N.A.live + 1,
    "hq_overview: the per-project attention rows are the office's own, with the office's own counts",
    c.json(attA),
  )
  c.check(
    ovA.today.length === liveA && ovB.today.length === liveB,
    "hq_overview: today lists only the office's live jobs",
    `${ovA.today.length} ${ovB.today.length}`,
  )
  c.check(
    ovA.calendar.events.length === N.A.cal &&
      ovA.calendar.events.every((e) => e.summary.includes(CA)),
    "hq_overview: the calendar is the office's own",
    c.json(ovA.calendar).slice(0, 100),
  )

  // ==== hq_studio ======================================================================================================================
  const stA = (await call(tx(A, 'hq_studio'))) as {
    projects: { name: string; docs: number; total: number }[]
    contactLabels: { name: string }[]
    appearance: { canary?: string }
    waiting: { what: string } | null
    health: { stalled: number }
  }
  const stAText = c.json(stA)
  c.check(
    !stAText.includes(CB) && stAText.includes(CA),
    "hq_studio: A's payload holds A's canary and none of B's",
    '',
  )
  const sp = stA.projects.find((p) => p.name.includes(CA))
  c.check(
    sp?.docs === N.A.docs && sp?.total === N.A.tasks,
    "hq_studio: the project card counts are the office's own",
    c.json(sp).slice(0, 100),
  )
  c.check(
    stA.contactLabels.length === 1 &&
      stA.contactLabels[0]?.name.includes(CA) === true &&
      stA.appearance.canary === CA,
    "hq_studio: contact labels and appearance are the office's own",
    '',
  )
  c.check(
    stA.waiting?.what.includes(CA) === true,
    "hq_studio: the banner question is the office's own",
    c.json(stA.waiting).slice(0, 100),
  )
  c.check(
    stA.health.stalled === N.A.live,
    "hq_studio: the stalled reading counts only the office's jobs",
    `${stA.health.stalled}`,
  )

  // ==== feeds: activity, lately ========================================================================================================
  const actA = await text(tx(A, 'hq_activity', '200'))
  c.check(
    !actA.includes(CB) &&
      actA.includes(CA) &&
      !actA.includes(uid('b-job-live0')) &&
      actA.includes(uid('a-job-live0')),
    "hq_activity: the feed is the office's own transitions",
    '',
  )
  const latA = (await call(tx(A, 'hq_studio_lately', '40'))) as {
    office: { why: string | null; times?: number }[]
    building: unknown
    today: { events: number; jobs_done: number; jobs_failed: number }
  }
  const latAText = c.json(latA)
  c.check(
    !latAText.includes(CB) && latAText.includes(CA),
    "hq_studio_lately: the feed is the office's own",
    '',
  )
  c.check(
    latA.today.events === N.A.events &&
      latA.today.jobs_done === N.A.done &&
      latA.today.jobs_failed === N.A.failed,
    "hq_studio_lately: the day's counters are the office's own",
    c.json(latA.today),
  )
  const latB = (await call(tx(B, 'hq_studio_lately', '40'))) as typeof latA
  c.check(
    latB.today.events === N.B.events &&
      latB.today.jobs_done === N.B.done &&
      latB.today.jobs_failed === N.B.failed,
    "hq_studio_lately: and B's are B's",
    c.json(latB.today),
  )
  c.check(
    c.json(latA.building) === '{}',
    'hq_studio_lately: the build log is withheld from an ordinary office',
    c.json(latA.building).slice(0, 60),
  )
  const latG = (await call(tx(G, 'hq_studio_lately', '5'))) as typeof latA
  c.check(
    c.json(latG.building) !== '{}',
    "hq_studio_lately: and the deployment's operator still reads it",
    c.json(latG.building).slice(0, 60),
  )

  // ==== portfolio, unseen, team work =====================================================================================================
  const pfA = (await call(tx(A, 'hq_portfolio_tasks', '200'))) as {
    counts: { open: number }
    tasks: { title: string }[]
  }
  c.check(
    pfA.counts.open === N.A.tasks && pfA.tasks.every((t) => t.title.includes(CA)),
    "hq_portfolio_tasks: the counts and the list are the office's own",
    c.json(pfA.counts),
  )
  const unA = (await call(tx(A, 'studio_unseen'))) as Record<
    string,
    { docs: number; tasks: number }
  >
  const unB = (await call(tx(B, 'studio_unseen'))) as Record<
    string,
    { docs: number; tasks: number }
  >
  c.check(
    unA['views-proj']?.docs === N.A.docs &&
      unA['views-proj']?.tasks === N.A.tasks &&
      unB['views-proj']?.docs === N.B.docs &&
      unB['views-proj']?.tasks === N.B.tasks,
    "studio_unseen: the same slug in two offices counts each office's own rows",
    `${c.json(unA['views-proj'])} ${c.json(unB['views-proj'])}`,
  )
  const twA = (await call(tx(A, 'studio_team_work', '14'))) as Record<
    string,
    {
      asked: number
      answered: number
      failed: number
      could_not: number
      walls: { needed: string }[]
    }
  >
  const twB = (await call(tx(B, 'studio_team_work', '14'))) as typeof twA
  const cosA = twA['chief-of-staff']
  const cosB = twB['chief-of-staff']
  c.check(
    cosA?.asked === N.A.live + N.A.done + N.A.failed &&
      cosB?.asked === N.B.live + N.B.done + N.B.failed,
    "studio_team_work: asked is the office's own jobs",
    `A ${cosA?.asked}, B ${cosB?.asked}`,
  )
  c.check(
    cosA?.answered === N.A.done && cosB?.answered === N.B.done && cosA?.failed === N.A.failed,
    "studio_team_work: answered and failed are the office's own",
    '',
  )
  c.check(
    cosA?.could_not === 1 &&
      cosA.walls.every((w) => !w.needed.includes(CB.toLowerCase())) &&
      c.json(cosA.walls).includes(CA.toLowerCase()),
    "studio_team_work: what the team could not do is the office's own",
    c.json(cosA?.walls).slice(0, 100),
  )
  c.check(!c.json(twA).includes(CB), "studio_team_work: no canary of B's", '')

  // ==== the plane and the history: a foreign project answers like a missing one ===========================================================
  const planeA = await text(tx(A, 'studio_plane', q(pa)))
  c.check(
    planeA.includes(CA) && !planeA.includes(CB),
    "studio_plane: A's own project draws A's tasks and documents",
    '',
  )
  c.check(
    (await text(tx(A, 'studio_plane', q(pb)))) ===
      (await text(tx(A, 'studio_plane', q(c.nobody())))),
    "studio_plane: B's project and a nonexistent project are indistinguishable to A",
    '',
  )
  const histA = await text(
    `select coalesce(jsonb_agg(h), '[]'::jsonb) from public.project_history(${q(A)}, ${q(pa)}, 50) h`,
  )
  c.check(
    histA.includes(CA) && !histA.includes(CB),
    "project_history: A's own project has A's story",
    histA.slice(0, 100),
  )
  c.check(
    (await text(
      `select coalesce(jsonb_agg(h), '[]'::jsonb) from public.project_history(${q(A)}, ${q(pb)}, 50) h`,
    )) ===
      (await text(
        `select coalesce(jsonb_agg(h), '[]'::jsonb) from public.project_history(${q(A)}, ${q(c.nobody())}, 50) h`,
      )),
    "project_history: B's project and a nonexistent project are indistinguishable to A",
    '',
  )

  // ==== the Vikunja panel =================================================================================================================
  await x(
    `insert into public.task_links (task_id, provider, external_id, sync_state) values ('${uid('b-task0')}', 'vikunja', 'views-ext', 'ok') on conflict do nothing`,
  ).catch(() => undefined)
  const tsA = (await call(tx(A, 'task_sync_panel'))) as { linked: number; configured: boolean }
  const tsB = (await call(tx(B, 'task_sync_panel'))) as { linked: number }
  c.check(
    tsA.linked === 0 && tsB.linked === 1,
    "task_sync_panel: the linked count is the office's own",
    `A ${tsA.linked}, B ${tsB.linked}`,
  )
  c.check(
    tsA.configured === false,
    "task_sync_panel: the deployment's Vikunja is not shown to an ordinary office",
    c.json(tsA).slice(0, 80),
  )

  // ==== usage: hq_series, hq_usage, usage_overview, hq_cost_per_outcome =====================================================================
  const sum = (v: unknown): number => (v as [string, number][]).reduce((s, p) => s + num(p[1]), 0)
  const seriesA = (await call(tx(A, 'hq_series', '30'))) as {
    inference_calls: unknown
    inference_cost_usd: unknown
    messages_sent: unknown
  }
  const seriesB = (await call(tx(B, 'hq_series', '30'))) as typeof seriesA
  c.check(
    sum(seriesA.inference_calls) === N.A.usage &&
      sum(seriesB.inference_calls) === N.B.usage &&
      Math.abs(sum(seriesA.inference_cost_usd) - 0.01 * N.A.usage) < 1e-9,
    "hq_series: the calls and the cost are the office's own",
    `A ${sum(seriesA.inference_calls)}, B ${sum(seriesB.inference_calls)}`,
  )
  c.check(
    sum(seriesA.messages_sent) === N.A.sent && sum(seriesB.messages_sent) === N.B.sent,
    "hq_series: messages sent are the office's own deliveries",
    `A ${sum(seriesA.messages_sent)}, B ${sum(seriesB.messages_sent)}`,
  )
  const usA = (await call(tx(A, 'hq_usage'))) as {
    inference: { calls_30d: number; cost_usd_30d: string }
    tts: { characters_this_month: number | null }
    notebook: { detected_tier: string | null }
    queue: { in_flight: number }
    delivery: { deliveries: number; state: string }[]
  }
  const usB = (await call(tx(B, 'hq_usage'))) as typeof usA
  c.check(
    usA.inference.calls_30d === N.A.usage && usB.inference.calls_30d === N.B.usage,
    "hq_usage: the 30-day call count is the office's own",
    `${usA.inference.calls_30d} ${usB.inference.calls_30d}`,
  )
  c.check(
    Math.abs(num(usA.inference.cost_usd_30d) - 0.01 * N.A.usage) < 1e-9,
    "hq_usage: the 30-day cost is the office's own, without the system calls",
    usA.inference.cost_usd_30d,
  )
  c.check(
    usA.queue.in_flight === liveA && usB.queue.in_flight === liveB,
    "hq_usage: the queue is the office's own",
    `${usA.queue.in_flight} ${usB.queue.in_flight}`,
  )
  c.check(
    usA.delivery.reduce((s, d) => s + d.deliveries, 0) === N.A.sent + 1 &&
      usB.delivery.reduce((s, d) => s + d.deliveries, 0) === N.B.sent + 1,
    "hq_usage: the delivery health counts the office's own deliveries",
    c.json(usA.delivery),
  )
  const usG = (await call(tx(G, 'hq_usage'))) as typeof usA
  c.check(
    usA.tts.characters_this_month === null && usA.notebook.detected_tier === null,
    'hq_usage: the speech quota and the notebook budget are withheld from an ordinary office',
    '',
  )
  c.check(
    usG.tts.characters_this_month !== null,
    "hq_usage: and the deployment's operator still reads the speech quota",
    c.json(usG.tts),
  )

  const ovuA = (await call(tx(A, 'usage_overview', '30'))) as {
    services: { key: string; secondary?: { calls?: number }; used?: unknown }[]
    top_models: { name: string }[]
    unattributed_system: unknown
    by_day: { calls: number }[]
  }
  const ovuB = (await call(tx(B, 'usage_overview', '30'))) as typeof ovuA
  const orA = ovuA.services.find((s) => s.key === 'openrouter')
  const orB = ovuB.services.find((s) => s.key === 'openrouter')
  c.check(
    orA?.secondary?.calls === N.A.usage && orB?.secondary?.calls === N.B.usage,
    "usage_overview: the model-call service is the office's own",
    `${orA?.secondary?.calls} ${orB?.secondary?.calls}`,
  )
  c.check(
    ovuA.top_models.length === 1 &&
      ovuA.top_models[0]?.name === 'views/a-model' &&
      ovuA.by_day.reduce((s, d) => s + d.calls, 0) === N.A.usage,
    "usage_overview: the top models and the daily series are the office's own",
    c.json(ovuA.top_models),
  )
  c.check(
    ovuA.unattributed_system === null &&
      !c.json(ovuA).includes('views/system-model') &&
      !ovuA.services.some((s) => ['tts', 'supabase_db', 'supabase_storage'].includes(s.key)),
    "usage_overview: the deployment's unattributed calls, database and speech are not shown to an ordinary office",
    '',
  )
  const ovuG = (await call(tx(G, 'usage_overview', '30'))) as typeof ovuA & {
    unattributed_system: { label: string; calls: number; cost: number }
  }
  c.check(
    ovuG.unattributed_system?.label === 'unattributed (system)' &&
      ovuG.unattributed_system.calls === 4 &&
      ovuG.services.some((s) => s.key === 'supabase_db'),
    "usage_overview: the operator sees the job-less calls as a line of their own, labelled, and the deployment's database",
    c.json(ovuG.unattributed_system),
  )
  const gOr = ovuG.services.find((s) => s.key === 'openrouter')
  c.check(
    (gOr?.secondary?.calls ?? -1) === 0,
    "usage_overview: and they are never added to the operator's own spend",
    `operator's own calls ${gOr?.secondary?.calls}`,
  )

  const cpA = (await call(tx(A, 'hq_cost_per_outcome', '30'))) as {
    totals: { outcomes: number }
    coverage: { total_calls: number; unattributed_calls: number }
    unattributed_system: unknown
  }
  const cpB = (await call(tx(B, 'hq_cost_per_outcome', '30'))) as typeof cpA
  c.check(
    cpA.totals.outcomes === N.A.done &&
      cpB.totals.outcomes === N.B.done &&
      cpA.coverage.total_calls === N.A.usage &&
      cpB.coverage.total_calls === N.B.usage,
    "hq_cost_per_outcome: the outcomes and the calls are the office's own",
    c.json(cpA.coverage),
  )
  c.check(
    cpA.coverage.unattributed_calls === 0 && cpA.unattributed_system === null,
    "hq_cost_per_outcome: the system's job-less calls are not an ordinary office's unattributed spend",
    c.json(cpA.coverage),
  )
  const cpG = (await call(tx(G, 'hq_cost_per_outcome', '30'))) as {
    unattributed_system: { label: string; calls: number; spent_usd: number }
    coverage: { total_calls: number }
  }
  c.check(
    cpG.unattributed_system?.calls === 4 &&
      cpG.unattributed_system.label === 'unattributed (system)' &&
      cpG.coverage.total_calls === 0,
    "hq_cost_per_outcome: the operator sees them as a labelled line, apart from the operator's own calls",
    c.json(cpG.unattributed_system),
  )

  // ==== conversation ===========================================================================================================================
  const chA = (await call(tx(A, 'conversation_channels'))) as {
    channel: string
    messages: number
    state: string
    last_error: string | null
  }[]
  const chB = (await call(tx(B, 'conversation_channels'))) as typeof chA
  c.check(
    chA.find((r) => r.channel === 'teamhq')?.messages === N.A.msgs &&
      chB.find((r) => r.channel === 'teamhq')?.messages === N.B.msgs,
    "conversation_channels: the message counts are the office's own",
    '',
  )
  c.check(
    chA.find((r) => r.channel === 'slack')?.state === 'unchecked' &&
      chB.find((r) => r.channel === 'slack')?.state !== 'unchecked',
    "conversation_channels: B's dead Slack credential does not colour A's reading",
    `${chA.find((r) => r.channel === 'slack')?.state} / ${chB.find((r) => r.channel === 'slack')?.state}`,
  )
  const chAslack = chA.find((r) => r.channel === 'telegram')
  c.check(
    chAslack?.messages === 0,
    'conversation_channels: a channel the office has not used reads empty',
    '',
  )
  const gwA = (await call(tx(A, 'conversation_growth'))) as {
    surfaces: { surface: string; rows: number }[]
    db_bytes: number | null
    years_of_room: number | null
    bytes_a_message: number | null
  }
  const gwG = (await call(tx(G, 'conversation_growth'))) as typeof gwA
  c.check(
    gwA.surfaces.reduce((s, r) => s + num(r.rows), 0) === N.A.msgs,
    "conversation_growth: the surfaces count the office's own messages",
    c.json(gwA.surfaces),
  )
  c.check(
    gwA.db_bytes === null && gwA.years_of_room === null && gwA.bytes_a_message === null,
    "conversation_growth: the size of the deployment's database is not shown to an ordinary office",
    c.json(gwA).slice(0, 100),
  )
  c.check(
    gwG.db_bytes !== null && num(gwG.db_bytes) > 0,
    'conversation_growth: and the operator still reads it',
    `${gwG.db_bytes}`,
  )
  const hiA = await text(tx(A, 'conversation_history', `${q(pa)}, 50, null`))
  c.check(
    hiA.includes(CA) && !hiA.includes(CB),
    "conversation_history: A's thread holds A's said and answered, and none of B's",
    hiA.slice(0, 100),
  )
  const hiRows = JSON.parse(hiA) as { kind: string; from: string; name: string }[]
  c.check(
    hiRows.some((r) => r.kind === 'said' && r.name === 'Person A') &&
      hiRows.filter((r) => r.kind === 'said').length === N.A.msgs,
    "conversation_history: A's own words are attributed to A, not to a literal",
    c.json(hiRows.filter((r) => r.kind === 'said')).slice(0, 120),
  )
  c.check(
    hiRows.filter((r) => r.kind === 'answered').length === N.A.done,
    "conversation_history: only A's answers are in A's thread",
    `${hiRows.filter((r) => r.kind === 'answered').length}`,
  )
  const hiForeign = await text(tx(A, 'conversation_history', `${q(pb)}, 50, null`))
  c.check(
    hiForeign === (await text(tx(A, 'conversation_history', `${q(c.nobody())}, 50, null`))),
    "conversation_history: B's project and a nonexistent project are indistinguishable to A",
    hiForeign.slice(0, 60),
  )

  // ==== the health reading =====================================================================================================================
  const hA = (await call(tx(A, 'office_health', '24'))) as {
    finished: number
    failed: number
    in_flight: number
    failing_kinds: { kind: string; n: number }[]
    stalled: number
    waiting: { jobs: number }
    excluded_fixtures: number
    backup: unknown
    progress: { runnable_now: number }
    held_for_budget: { jobs: number }
  }
  const hB = (await call(tx(B, 'office_health', '24'))) as typeof hA
  c.check(
    hA.finished === N.A.done &&
      hB.finished === N.B.done &&
      hA.failed === N.A.failed &&
      hB.failed === N.B.failed &&
      hA.in_flight === N.A.live &&
      hB.in_flight === N.B.live,
    "office_health: finished, failed and in-flight are the office's own",
    c.json({
      A: [hA.finished, hA.failed, hA.in_flight],
      B: [hB.finished, hB.failed, hB.in_flight],
    }),
  )
  c.check(
    hA.failing_kinds.length === 1 &&
      hA.failing_kinds[0]?.kind === 'office.views_a' &&
      hB.failing_kinds.length === 0,
    "office_health: the failing kinds are the office's own",
    c.json(hA.failing_kinds),
  )
  c.check(
    hA.stalled === N.A.live &&
      hB.stalled === N.B.live &&
      hA.waiting.jobs === N.A.live &&
      hB.waiting.jobs === N.B.live &&
      hA.progress.runnable_now === N.A.live,
    "office_health: stalled, waiting and runnable are the office's own",
    c.json({
      A: [hA.stalled, hA.waiting.jobs, hA.progress.runnable_now],
      B: [hB.stalled, hB.waiting.jobs],
    }),
  )
  const hjA = await count(
    `select count(*)::int as n from public.jobs where office_id = '${A}' and app.harness_job(job_id) and created_at > app.now_utc() - interval '24 hours'`,
  )
  const hjB = await count(
    `select count(*)::int as n from public.jobs where office_id = '${B}' and app.harness_job(job_id) and created_at > app.now_utc() - interval '24 hours'`,
  )
  c.check(
    hA.excluded_fixtures === hjA && hB.excluded_fixtures === hjB && hjA >= 1,
    'office_health: the harness traffic is reported per office, and still excluded',
    `${hA.excluded_fixtures}/${hjA} ${hB.excluded_fixtures}/${hjB}`,
  )
  c.check(
    hA.backup === null,
    "office_health: the backup reading is the deployment's and is not shown to an ordinary office",
    '',
  )
  const hG = (await call(tx(G, 'office_health', '24'))) as typeof hA
  c.check(hG.backup !== null, 'office_health: and the operator still reads it', '')

  // ==== retry: a delivery of another office cannot be retried, and cannot be told apart from a missing one ===============================================
  const beforeB = await c.snapshot(B, ['deliveries'])
  const sameRetry = async (what: string, mk: (id: string) => string) => {
    // the answer echoes the id the caller typed; everything else must match
    const foreign = c
      .json(await c.try_(S, mk(uid('b-job-done0'))))
      .replaceAll(uid('b-job-done0'), '<id>')
    const missing = c.json(await c.try_(S, mk(c.nobody()))).replaceAll(c.nobody(), '<id>')
    c.check(
      foreign === missing,
      `${what}: B's job and a nonexistent job are indistinguishable to A`,
      foreign.slice(0, 100),
    )
  }
  await sameRetry(
    'retry_job_deliveries',
    (id) => `select public.retry_job_deliveries(${q(A)}, ${q(id)})`,
  )
  const rd = async (id: string) =>
    c
      .json(await c.try_(S, `select public.retry_delivery(${q(A)}, ${q(id)})`))
      .replaceAll(id, '<id>')
  c.check(
    (await rd(uid('b-delivery-failed'))) === (await rd(c.nobody())),
    "retry_delivery: B's delivery and a nonexistent delivery are indistinguishable to A",
    (await rd(c.nobody())).slice(0, 100),
  )
  c.check(
    beforeB === (await c.snapshot(B, ['deliveries'])),
    "nothing of B's deliveries moved while A attacked",
    '',
  )
  // put the subject back as it was, so the file can be run twice against one clone
  await x(
    `update public.deliveries set state = 'failed', attempt = 3, error_code = 'views_down' where delivery_id = '${uid('a-delivery-failed')}'`,
  )
  const own = (await call(tx(A, 'retry_job_deliveries', q(uid('a-job-done0'))))) as {
    queued: number
  }
  c.check(
    own.queued === 1,
    'retry_job_deliveries: the office can retry its own failed delivery',
    c.json(own),
  )

  // ==== no office, no read ==========================================================================================================================
  const doors: [string, string][] = [
    ['hq_activity', '50'],
    ['hq_overview', ''],
    ['hq_pulse', ''],
    ['hq_studio', ''],
    ['hq_studio_lately', '40'],
    ['hq_portfolio_tasks', '200'],
    ['studio_unseen', ''],
    ['studio_team_work', '14'],
    ['studio_plane', q(pa)],
    ['task_sync_panel', ''],
    ['hq_series', '30'],
    ['hq_usage', ''],
    ['usage_overview', '30'],
    ['hq_cost_per_outcome', '30'],
    ['conversation_channels', ''],
    ['conversation_growth', ''],
    ['conversation_history', `${q(pa)}, 5, null`],
    ['office_health', '24'],
    ['retry_job_deliveries', q(uid('a-job-done0'))],
    ['retry_delivery', q(uid('a-delivery-failed'))],
  ]
  for (const [fn, rest] of doors) {
    const argsFor = (office: string) => `${office}${rest ? `, ${rest}` : ''}`
    const nullMsg = await c.refusal(S, `select public.${fn}(${argsFor('null::uuid')})`)
    const ghostMsg = await c.refusal(S, `select public.${fn}(${argsFor(`${q(c.nobody())}::uuid`)})`)
    c.check(
      nullMsg.includes('no_office') && ghostMsg.includes('no_office'),
      `${fn}: a null or nonexistent office is refused`,
      `${nullMsg.slice(0, 40)} | ${ghostMsg.slice(0, 40)}`,
    )
    for (const role of callerRoles) {
      const msg = await c.refusal(role, `select public.${fn}(${argsFor(q(A))})`)
      c.check(
        msg.includes('permission denied'),
        `${fn}: ${role} cannot execute the door`,
        msg.slice(0, 60),
      )
    }
  }
  const ph = await c.refusal(S, `select * from public.project_history(null::uuid, ${q(pa)}, 5)`)
  c.check(ph.includes('no_office'), 'project_history: a null office is refused', ph.slice(0, 60))
  for (const role of callerRoles) {
    const msg = await c.refusal(role, `select * from public.project_history(${q(A)}, ${q(pa)}, 5)`)
    c.check(
      msg.includes('permission denied'),
      `project_history: ${role} cannot execute the door`,
      msg.slice(0, 60),
    )
  }

  // ==== the legacy doors are gone ==============================================================================================================
  const legacy = (
    await x(`select p.oid::regprocedure::text as sig from pg_proc p
              where p.pronamespace = 'public'::regnamespace
                and p.proname in ('hq_activity','hq_cost_per_outcome','hq_overview','hq_portfolio_tasks','hq_pulse','hq_series','hq_studio',
                                  'hq_studio_lately','hq_usage','studio_plane','studio_team_work','studio_unseen','office_health','usage_overview',
                                  'project_history','conversation_channels','conversation_growth','conversation_history','retry_job_deliveries',
                                  'task_sync_panel','retry_delivery','jobs_stuck_queued','held_for_budget')
                and pg_get_function_arguments(p.oid) not like 'p_office uuid%'`)
  ).rows as { sig: string }[]
  c.check(
    legacy.length === 0,
    'no unscoped public door to the dashboard read side is left',
    legacy.map((r) => r.sig).join(' '),
  )

  // ==== the bridge was not needed ==============================================================================================================
  const bridgeAfter = Number(
    (
      (await x('select coalesce(sum(n),0)::int as n from public.office_bridge_use')).rows[0] as {
        n: number
      }
    ).n,
  )
  c.check(
    bridgeAfter === bridgeBefore,
    'the converted readers never relied on the compatibility bridge',
    `${bridgeBefore} -> ${bridgeAfter}`,
  )
}
