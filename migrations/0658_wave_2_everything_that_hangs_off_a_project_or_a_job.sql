-- 0658 - ownership wave 2: every carrier that hangs off a project or a job (multi-user P2).
--
-- Twenty-seven carriers. Ownership is proved in tiers, strongest first, and a row takes the first tier that proves it:
--   1 LINK        the project, job or sibling row it names already has an owner (and they must all agree - the
--                 composite keys below refuse a disagreement);
--   2 PRINCIPAL   what the row itself records as its principal: the owner key that acted, or the registered
--                 destination a message went to (a harness message that physically reached the person's own chat is
--                 delivered to that person's office and counted as such);
--   3 POINTER     an id inside the row's payload that names rows of exactly one office;
--   4 HARNESS     a run token or a suite's own name in the row (a suite builds real-looking subjects on purpose);
--   5 UNATTRIBUTABLE  terminal history that no evidence reaches: a model call made with no job, a settled undo offer
--                 naming nothing, a ledger line whose subject was deleted. These go to the SYSTEM office, never to a
--                 person: a person's view fails closed rather than absorbing rows nobody can prove are theirs. Each is
--                 counted under a rule name starting UNATTRIBUTABLE in office_backfill_report. Only append-only
--                 history that nothing reads to decide behaviour is eligible; anything live that is not proved aborts.
-- Nothing here maps "unknown" to the person. A table with an unproved row aborts the wave and names itself.
--
-- Dry run: select set_config('p2.dry_run','0658',true); in front of the whole chain raises the report at the end.

create or replace function pg_temp.p2_h(r jsonb) returns boolean language sql immutable as $f$
  -- values only: a column called is_fixture or a key called "probe" says nothing about the row
  select coalesce(r ->> 'is_fixture', 'false') = 'true'
      or (select string_agg(e.value::text, ' ') from jsonb_each(r) e) ~* '(^|[^a-z0-9])m[s-v][0-9a-z]{6}([^a-z0-9]|$)'
      or (select string_agg(e.value::text, ' ') from jsonb_each(r) e) ~* '(fixture|verify|probe|proof|harness|nb-gate|gate-?[0-9]|zz[ _]test|phase-1|verifier|synthetic)'
$f$;

create or replace function pg_temp.p2_owner_office(k text) returns uuid language sql stable as $f$
  select min(o.office_id::text)::uuid from public.office_members m
    join auth.users u on lower(u.email) = m.email
    join public.offices o on o.auth_user_id = u.id and o.kind = 'person'
   where m.kind = 'person' and m.owner_key = k
$f$;

create function pg_temp.p2_named_office(j jsonb) returns uuid language sql stable as $f$
  select case when count(distinct x.office_id) = 1 then min(x.office_id::text)::uuid end from (
    select office_id from public.jobs where job_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.tasks where task_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.projects where project_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.tool_requests where request_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.skills where skill_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.lessons where lesson_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.suggestions where suggestion_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select p.office_id from public.project_attachments a join public.projects p using (project_id)
               where a.attachment_id::text in (select m[1] from regexp_matches(j::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
    union all select office_id from public.projects where slug = j -> 'args' ->> 'p_slug') x
   where x.office_id is not null
$f$;

do $m$
declare
  v_person uuid := app.sole_person_office();
  v_test   uuid := app.test_office();
  v_system uuid := app.system_office();
  spec jsonb := $j$[
   ["tasks",["P(project_id)","J(job_id)","S(tasks,task_id,parent_task_id)","S(blockers,blocker_id,satisfies_blocker)"]],
   ["documents",["P(project_id)","J(produced_by_job)","S(documents,document_id,mirrors_document_id)","S(documents,document_id,superseded_by)"]],
   ["inbound_commands",["P(project_id)","J(job_id)","S(inbound_commands,command_id,paired_with)","S(events,event_id,compensates_event_id)"]],
   ["blockers",["P(project_id)","J(job_id)"]],
   ["browser_actions",["P(project_id)","J(job_id)"]],
   ["decisions",["P(project_id)","J(from_job)"]],
   ["deliveries",["J(job_id)","S(blockers,blocker_id,blocker_id)"]],
   ["events",["P(project_id)","J(related_job_id)","S(tasks,task_id,related_task_id)","S(events,event_id,compensates_event_id)"]],
   ["failure_signatures",["J(last_job_id)"]],
   ["inference_usage",["J(job_id)"]],
   ["lessons",["P(project_id)","J(from_job)"]],
   ["notebook_spend",["P(project_id)","J(job_id)"]],
   ["notebook_sync_queue",["P(project_id)","J(job_id)"]],
   ["notification_events",["P(project_id)"]],
   ["project_switches",["P(project_id)"]],
   ["proposals",["J(delivered_by_job)"]],
   ["signals",["P(project_id)","J(caused_by_job)"]],
   ["skills",["P(project_id)","J(from_job)"]],
   ["standing_authorizations",["P(project_id)"]],
   ["suggestions",["P(project_id)"]],
   ["tool_requests",["J(from_job)"]],
   ["undoable_actions",["J(job_id)"]],
   ["autonomy_settings",["P(project_id)"]],
   ["event_triggers",["P(project_id)"]],
   ["preference_proposals",["P(project_id)"]],
   ["notification_preferences",["P(project_id)"]],
   ["notebook_chat_usage",["P(project_id)"]]
  ]$j$;
  s jsonb; e text; ex text; tbl text; pk text; n bigint; v_report text := ''; v_sample text; a text[]; rc bigint; v_unres text := ''; v_quarantine uuid;
begin
  create temp table p2_rep(tbl text, rule text, n bigint) on commit drop;
  for s in select * from jsonb_array_elements(spec) loop
    execute format('alter table public.%I disable trigger user', s->>0);
  end loop;

  -- 0. scope repair: a suite's command whose project is the chat's default scope while its job lives elsewhere. The job
  -- is the truth; a command cannot sit in two offices. Its project becomes the job's own project, or - the column is NOT
  -- NULL and the suite never chose a scope - a quarantine project in the test office that exists for this alone.
  insert into public.projects (slug, name, status, office_id)
  values ('fixture-p2-default-scope', 'Fixture: where a suite''s command points when it chose no project', 'archived', v_test)
  on conflict (slug) do nothing;
  select project_id into v_quarantine from public.projects where slug = 'fixture-p2-default-scope';
  update public.inbound_commands c set project_id = coalesce(j.project_id, v_quarantine)
    from public.jobs j, public.projects pj
   where c.job_id = j.job_id and pj.project_id = c.project_id and c.project_id is distinct from j.project_id
     and pj.office_id <> j.office_id and app.harness_job(j.job_id);
  get diagnostics rc = row_count; insert into p2_rep values ('inbound_commands', 'REPAIR: a suite command''s default scope replaced by its job''s own project (or the quarantine project)', rc);

  -- 1. ownership proved by a link to a row whose owner is already known (project, job, or a sibling row)
  for pass in 1..3 loop
    for s in select * from jsonb_array_elements(spec) loop
      tbl := s->>0;
      for e in select jsonb_array_elements_text(s->1) loop
        if e like 'P(%' then ex := format('(select x.office_id from public.projects x where x.project_id = t.%s)', substr(e, 3, length(e)-3));
        elsif e like 'J(%' then ex := format('(select x.office_id from public.jobs x where x.job_id = t.%s)', substr(e, 3, length(e)-3));
        else a := string_to_array(substr(e, 3, length(e)-3), ',');
             ex := format('(select x.office_id from public.%I x where x.%I = t.%I)', a[1], a[2], a[3]);
        end if;
        execute format('update public.%I t set office_id = %s where t.office_id is null and %s is not null', tbl, ex, ex);
        get diagnostics rc = row_count;
        if rc > 0 then insert into p2_rep values (tbl, 'link ' || e, rc); end if;
      end loop;
    end loop;
  end loop;

  -- 2. rules that prove ownership from what the row itself records
  -- deliveries: a message belongs to the office whose registered destination it went to
  update public.deliveries t set office_id = (
      select min(pg_temp.p2_owner_office(c.subject)::text)::uuid from public.telegram_chats c where c.chat_id = t.target_ref)
   where t.office_id is null and t.channel = 'telegram';
  get diagnostics rc = row_count; insert into p2_rep values ('deliveries', 'destination: a person''s registered telegram chat', rc);
  update public.deliveries t set office_id = (select min(p.office_id::text)::uuid from public.slack_channel_map m join public.projects p using (project_id) where m.channel_id = t.target_ref)
   where t.office_id is null and t.channel = 'slack';
  get diagnostics rc = row_count; insert into p2_rep values ('deliveries', 'destination: a project''s slack channel', rc);
  update public.deliveries t set office_id = v_person
   where t.office_id is null and t.channel = 'slack'
     and exists (select 1 from public.slack_channel_map m where m.channel_id = t.target_ref and m.project_id is null);
  get diagnostics rc = row_count; insert into p2_rep values ('deliveries', 'destination: the installed workspace''s own channel (one person)', rc);

  -- notification_events about an output: the output's job's office
  update public.notification_events t set office_id = j.office_id
    from public.outputs o join public.jobs j on j.job_id = o.job_id
   where t.office_id is null and t.subject_kind = 'output' and o.output_id = t.subject_ref;
  get diagnostics rc = row_count; insert into p2_rep values ('notification_events', 'subject: an output of a job', rc);

  -- undoable_actions: the single office every row the reversal names agrees on
  update public.undoable_actions t set office_id = r.office_id
    from (
      select u.action_id, min(x.office_id::text)::uuid office_id
        from public.undoable_actions u
        cross join lateral (
          select office_id from public.jobs where job_id::text in (select m[1] from regexp_matches(u.reversal::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
          union all select office_id from public.tasks where task_id::text in (select m[1] from regexp_matches(u.reversal::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
          union all select office_id from public.projects where project_id::text in (select m[1] from regexp_matches(u.reversal::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
          union all select office_id from public.projects where slug = u.reversal -> 'args' ->> 'p_slug'
          union all select p.office_id from public.project_attachments a join public.projects p using (project_id)
                     where a.attachment_id::text in (select m[1] from regexp_matches(u.reversal::text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
        ) x
       where u.office_id is null group by u.action_id having count(distinct x.office_id) = 1) r
   where t.action_id = r.action_id;
  get diagnostics rc = row_count; insert into p2_rep values ('undoable_actions', 'reversal names rows of one office', rc);

  -- events: the recorded actor is a person's owner key
  update public.events t set office_id = pg_temp.p2_owner_office(t.actor)
   where t.office_id is null and t.actor_kind = 'user'
     and pg_temp.p2_owner_office(t.actor) is not null
     and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'recorded actor is the person''s owner key', rc);


  -- more principals: a pointer inside the row to something whose owner is known
  update public.suggestions t set office_id = j.office_id from public.jobs j
   where t.office_id is null and j.job_id::text = t.offer_args ->> 'from_job';
  get diagnostics rc = row_count; insert into p2_rep values ('suggestions', 'offer names the job it came from', rc);
  update public.signals t set office_id = d.office_id from public.documents d
   where t.office_id is null and d.document_id::text = t.detail ->> 'document_id';
  get diagnostics rc = row_count; insert into p2_rep values ('signals', 'detail names a document', rc);
  update public.events t set office_id = (select min(s.office_id::text)::uuid from public.suggestions s
       where s.suggestion_id::text in (select jsonb_array_elements_text(t.after_state -> 'suggestion_ids')))
   where t.office_id is null and t.action_type = 'office.noticed' and jsonb_typeof(t.after_state -> 'suggestion_ids') = 'array';
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'noticing names the suggestions it raised', rc);
  update public.deliveries t set office_id = v_person
   where t.office_id is null and t.channel = 'slack' and t.target_ref like 'D%'
     and exists (select 1 from public.slack_app_credentials);
  get diagnostics rc = row_count; insert into p2_rep values ('deliveries', 'destination: a direct message from the installed app', rc);
  update public.standing_authorizations t set office_id = d.office_id from public.responsibilities d
   where t.office_id is null and t.project_id is null and t.reason like '%' || replace(d.slug, '-', '-') || '%';
  get diagnostics rc = row_count; insert into p2_rep values ('standing_authorizations', 'reason names the duty it was granted for', rc);
  update public.autonomy_settings t set office_id = v_system
   where t.office_id is null and t.project_id is null and t.set_by like 'migration:%';
  get diagnostics rc = row_count; insert into p2_rep values ('autonomy_settings', 'deployment default written by a migration (system)', rc);
  update public.notebook_sync_queue t set office_id = v_test
   where t.office_id is null and (t.payload ->> 'notebook_id') ~ '^nb(-|$)';
  get diagnostics rc = row_count; insert into p2_rep values ('notebook_sync_queue', 'fixture notebook id', rc);
  update public.skills t set office_id = pg_temp.p2_owner_office(t.authored_by)
   where t.office_id is null and pg_temp.p2_owner_office(t.authored_by) is not null and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep values ('skills', 'authored by the person''s owner key', rc);


  update public.events t set office_id = pg_temp.p2_named_office(coalesce(t.after_state, '{}'::jsonb) || coalesce(t.before_state, '{}'::jsonb))
   where t.office_id is null and pg_temp.p2_named_office(coalesce(t.after_state, '{}'::jsonb) || coalesce(t.before_state, '{}'::jsonb)) is not null;
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'state names rows of one office', rc);
  update public.suggestions t set office_id = j.office_id from public.jobs j
   where t.office_id is null and j.job_id::text = t.because ->> 'last_job';
  get diagnostics rc = row_count; insert into p2_rep values ('suggestions', 'because names the last failing job', rc);
  update public.skills t set office_id = e.office_id from public.events e
   where t.office_id is null and e.action_type = 'office.skill_written' and e.office_id is not null and e.after_state ->> 'skill_id' = t.skill_id::text;
  get diagnostics rc = row_count; insert into p2_rep values ('skills', 'the event that recorded it', rc);


  -- 3. harness-shaped rows with no link: a suite's own traffic
  for s in select * from jsonb_array_elements(spec) loop
    tbl := s->>0;
    execute format('update public.%I t set office_id = %L where t.office_id is null and pg_temp.p2_h(to_jsonb(t) - ''search'')', tbl, v_test);
    get diagnostics rc = row_count;
    if rc > 0 then insert into p2_rep values (tbl, 'harness-shaped identity (run token / suite name)', rc); end if;
  end loop;


  update public.proposals t set office_id = v_test
   where t.office_id is null and t.needed ~ '^speak fluent welsh [a-z0-9]{8}$';
  get diagnostics rc = row_count; insert into p2_rep values ('proposals', 'the fixture need verify:proposes raises', rc);
  update public.signals t set office_id = v_system
   where t.office_id is null and t.event_type = 'document.added' and not exists (select 1 from public.documents d where d.document_id::text = t.detail ->> 'document_id');
  get diagnostics rc = row_count; insert into p2_rep values ('signals', 'UNATTRIBUTABLE history: a document.added whose document no longer exists (system, fail-closed)', rc);
  -- links again: harness rows stamped above can now carry their dependants
  for s in select * from jsonb_array_elements(spec) loop
    tbl := s->>0;
    for e in select jsonb_array_elements_text(s->1) loop
      if e like 'S(%' then
        a := string_to_array(substr(e, 3, length(e)-3), ',');
        execute format('update public.%I t set office_id = (select x.office_id from public.%I x where x.%I = t.%I) where t.office_id is null and (select x.office_id from public.%I x where x.%I = t.%I) is not null', tbl, a[1], a[2], a[3], a[1], a[2], a[3]);
        get diagnostics rc = row_count;
        if rc > 0 then insert into p2_rep values (tbl, 'link (late) ' || e, rc); end if;
      end if;
    end loop;
  end loop;

  update public.decisions t set office_id = v_test
   where t.office_id is null and t.question ~* 'speak fluent welsh [a-z0-9]{8}';
  get diagnostics rc = row_count; insert into p2_rep values ('decisions', 'the fixture need verify:proposes raises', rc);
  -- the recorded principal is a person's owner key and nothing in the row looks like a suite
  update public.tasks t set office_id = pg_temp.p2_owner_office(t.added_by)
   where t.office_id is null and pg_temp.p2_owner_office(t.added_by) is not null and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep values ('tasks', 'added by the person''s owner key', rc);
  update public.decisions t set office_id = pg_temp.p2_owner_office(t.decided_by)
   where t.office_id is null and pg_temp.p2_owner_office(t.decided_by) is not null and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep values ('decisions', 'decided by the person''s owner key', rc);
  update public.lessons t set office_id = pg_temp.p2_owner_office(t.learned_by)
   where t.office_id is null and pg_temp.p2_owner_office(t.learned_by) is not null and not pg_temp.p2_h(to_jsonb(t));
  get diagnostics rc = row_count; insert into p2_rep values ('lessons', 'learned by the person''s owner key', rc);
  -- a chore the office put on the operator's list (reconnect a credential, prove a backup) is the operator's task
  update public.tasks t set office_id = (select min(pg_temp.p2_owner_office(o.owner_key)::text)::uuid from public.deployment_operators o)
   where t.office_id is null and t.added_by = 'the office' and t.chore_key is not null and t.assigned_to_human
     and (select count(distinct pg_temp.p2_owner_office(o.owner_key)) from public.deployment_operators o) = 1;
  get diagnostics rc = row_count; insert into p2_rep values ('tasks', 'office chore addressed to the human, and the operator list names the one person', rc);

  -- the sole job running in a 60 second window around the write is a suite's, and was addressed to the writer
  update public.skills t set office_id = v_test
   where t.office_id is null
     and (select count(*) from public.jobs j where j.updated_at between t.created_at - interval '60 seconds' and t.created_at + interval '60 seconds') = 1
     and exists (select 1 from public.jobs j where j.updated_at between t.created_at - interval '60 seconds' and t.created_at + interval '60 seconds'
                   and j.recipient_agent = t.staff_slug and app.harness_job(j.job_id));
  get diagnostics rc = row_count; insert into p2_rep values ('skills', 'the only job in a 60s window was a suite''s, addressed to the author', rc);
  update public.events t set office_id = v_test
   where t.office_id is null and t.actor_kind = 'agent'
     and (select count(*) from public.jobs j where j.updated_at between t.occurred_at - interval '60 seconds' and t.occurred_at + interval '60 seconds') = 1
     and exists (select 1 from public.jobs j where j.updated_at between t.occurred_at - interval '60 seconds' and t.occurred_at + interval '60 seconds'
                   and j.recipient_agent = t.actor and app.harness_job(j.job_id));
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'the only job in a 60s window was a suite''s, addressed to the actor', rc);
  update public.events t set office_id = (select min(s.office_id::text)::uuid from public.suggestions s
       where s.suggestion_id::text in (select jsonb_array_elements_text(t.after_state -> 'suggestion_ids')))
   where t.office_id is null and t.action_type = 'office.noticed' and jsonb_typeof(t.after_state -> 'suggestion_ids') = 'array';
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'noticing names the suggestions it raised (late)', rc);

  update public.events t set office_id = v_system
   where t.office_id is null and t.action_type in ('office.noticed', 'tool.requested')
     and not exists (select 1 from public.suggestions x where x.suggestion_id::text in (select jsonb_array_elements_text(coalesce(t.after_state -> 'suggestion_ids', '[]'::jsonb))))
     and not exists (select 1 from public.tool_requests x where x.request_id::text = t.after_state ->> 'request_id');
  get diagnostics rc = row_count; insert into p2_rep values ('events', 'UNATTRIBUTABLE history: a ledger line whose subject row no longer exists (system, fail-closed)', rc);

  -- 3a. lineage: a retraction or a replacement stays in the office of what it replaces. A row with a project or a job of
  -- its own is settled and never moves; rows without one adopt the office of a settled neighbour, link by link along the
  -- chain; failing that, a replacement follows the row it replaced (the retraction keeps doing what it does today).
  create temp table p2_settled(tbl text, id uuid, primary key (tbl, id)) on commit drop;
  insert into p2_settled select 'lessons', lesson_id from public.lessons where project_id is not null or from_job is not null;
  insert into p2_settled select 'skills', skill_id from public.skills where project_id is not null or from_job is not null;
  insert into p2_settled select 'decisions', decision_id from public.decisions where project_id is not null or from_job is not null;
  for pass in 1..8 loop
    for s in select * from jsonb_array_elements('[["lessons","lesson_id"],["skills","skill_id"],["decisions","decision_id"]]'::jsonb) loop
      tbl := s->>0; pk := s->>1;
      execute format($q$
        with moves as (
          select t.%3$I as id, min(a.office_id::text)::uuid as office_id
            from public.%1$I t join public.%1$I a on (a.supersedes = t.%3$I or t.supersedes = a.%3$I)
           where not exists (select 1 from p2_settled z where z.tbl = %2$L and z.id = t.%3$I)
             and exists (select 1 from p2_settled z where z.tbl = %2$L and z.id = a.%3$I)
             and a.office_id <> t.office_id
           group by t.%3$I having count(distinct a.office_id) = 1)
        update public.%1$I t set office_id = m.office_id from moves m where t.%3$I = m.id$q$, tbl, tbl, pk);
      get diagnostics rc = row_count;
      if rc > 0 then insert into p2_rep values (tbl, 'FLAG: lineage - a row without a project or job took the office of its settled neighbour', rc); end if;
      execute format('insert into p2_settled select %L, t.%I from public.%I t where exists (select 1 from public.%I a where (a.supersedes = t.%I or t.supersedes = a.%I) and exists (select 1 from p2_settled z where z.tbl = %L and z.id = a.%I) and a.office_id = t.office_id) on conflict do nothing',
                     tbl, pk, tbl, tbl, pk, pk, tbl, pk);
    end loop;
  end loop;
  -- rows nothing else reached take the office of the row they replace or are replaced by
  for pass in 1..4 loop
    for s in select * from jsonb_array_elements('[["lessons","lesson_id"],["skills","skill_id"],["decisions","decision_id"]]'::jsonb) loop
      tbl := s->>0; pk := s->>1;
      execute format('update public.%I c set office_id = p.office_id from public.%I p where c.office_id is null and p.%I = c.supersedes and p.office_id is not null', tbl, tbl, pk);
      get diagnostics rc = row_count;
      if rc > 0 then insert into p2_rep values (tbl, 'lineage - an unowned replacement took the office of the row it replaced', rc); end if;
      execute format('update public.%I p set office_id = c.office_id from public.%I c where p.office_id is null and c.supersedes = p.%I and c.office_id is not null', tbl, tbl, pk);
      get diagnostics rc = row_count;
      if rc > 0 then insert into p2_rep values (tbl, 'lineage - an unowned row took the office of its replacement', rc); end if;
    end loop;
  end loop;

  for s in select * from jsonb_array_elements('[["lessons","lesson_id"],["skills","skill_id"],["decisions","decision_id"]]'::jsonb) loop
    tbl := s->>0; pk := s->>1;
    execute format('update public.%I c set office_id = p.office_id from public.%I p where c.supersedes = p.%I and p.office_id <> c.office_id and c.project_id is null and c.from_job is null', tbl, tbl, pk);
    get diagnostics rc = row_count;
    if rc > 0 then insert into p2_rep values (tbl, 'FLAG: lineage - a replacement with no project or job followed the row it replaced', rc); end if;
  end loop;

  -- 3b. terminal history nothing can attribute: quarantined to the system office, counted, never to a person
  update public.inference_usage t set office_id = v_system where t.office_id is null;
  get diagnostics rc = row_count; insert into p2_rep values ('inference_usage', 'UNATTRIBUTABLE history: a model call made with no job (system, fail-closed)', rc);
  update public.undoable_actions t set office_id = v_system where t.office_id is null and t.status in ('expired','undone','not_undoable');
  get diagnostics rc = row_count; insert into p2_rep values ('undoable_actions', 'UNATTRIBUTABLE history: a settled undo offer with no job or named row (system, fail-closed)', rc);


  -- 4. every row owned, or the wave stops here
  for s in select * from jsonb_array_elements(spec) loop
    tbl := s->>0;
    execute format('select count(*) from public.%I where office_id is null', tbl) into n;
    if n > 0 then
      execute format('select string_agg(left(to_jsonb(r)::text, 300), E''\n    '') from (select * from public.%I where office_id is null limit 2) r', tbl) into v_sample;
      v_unres := v_unres || tbl || ': unresolved=' || n || E'\n    ' || v_sample || E'\n';
    end if;
  end loop;
  if v_unres <> '' then raise exception E'0658: rows no rule proves an owner for:\n%', v_unres; end if;

  -- 5. every edge agrees before the composite keys are asked to (a clear message beats a constraint name)
  for s in select * from jsonb_array_elements($e$[["tasks", "project_id", "projects", "project_id"], ["tasks", "parent_task_id", "tasks", "task_id"], ["tasks", "job_id", "jobs", "job_id"], ["tasks", "satisfies_blocker", "blockers", "blocker_id"], ["documents", "mirrors_document_id", "documents", "document_id"], ["documents", "produced_by_job", "jobs", "job_id"], ["documents", "project_id", "projects", "project_id"], ["documents", "superseded_by", "documents", "document_id"], ["inbound_commands", "compensates_event_id", "events", "event_id"], ["inbound_commands", "job_id", "jobs", "job_id"], ["inbound_commands", "project_id", "projects", "project_id"], ["inbound_commands", "paired_with", "inbound_commands", "command_id"], ["blockers", "job_id", "jobs", "job_id"], ["blockers", "project_id", "projects", "project_id"], ["browser_actions", "job_id", "jobs", "job_id"], ["browser_actions", "project_id", "projects", "project_id"], ["decisions", "project_id", "projects", "project_id"], ["decisions", "from_job", "jobs", "job_id"], ["decisions", "supersedes", "decisions", "decision_id"], ["deliveries", "job_id", "jobs", "job_id"], ["deliveries", "blocker_id", "blockers", "blocker_id"], ["events", "project_id", "projects", "project_id"], ["events", "compensates_event_id", "events", "event_id"], ["events", "related_job_id", "jobs", "job_id"], ["failure_signatures", "last_job_id", "jobs", "job_id"], ["inference_usage", "job_id", "jobs", "job_id"], ["lessons", "from_job", "jobs", "job_id"], ["lessons", "supersedes", "lessons", "lesson_id"], ["lessons", "project_id", "projects", "project_id"], ["notebook_spend", "project_id", "projects", "project_id"], ["notebook_spend", "job_id", "jobs", "job_id"], ["notebook_sync_queue", "project_id", "projects", "project_id"], ["notebook_sync_queue", "job_id", "jobs", "job_id"], ["notification_events", "project_id", "projects", "project_id"], ["project_switches", "project_id", "projects", "project_id"], ["proposals", "delivered_by_job", "jobs", "job_id"], ["signals", "project_id", "projects", "project_id"], ["signals", "caused_by_job", "jobs", "job_id"], ["skills", "project_id", "projects", "project_id"], ["skills", "from_job", "jobs", "job_id"], ["skills", "supersedes", "skills", "skill_id"], ["standing_authorizations", "project_id", "projects", "project_id"], ["suggestions", "project_id", "projects", "project_id"], ["tool_requests", "from_job", "jobs", "job_id"], ["undoable_actions", "job_id", "jobs", "job_id"], ["autonomy_settings", "project_id", "projects", "project_id"], ["event_triggers", "project_id", "projects", "project_id"], ["preference_proposals", "project_id", "projects", "project_id"], ["notification_preferences", "project_id", "projects", "project_id"], ["notebook_chat_usage", "project_id", "projects", "project_id"]]$e$::jsonb) loop
    execute format('select count(*) from public.%I c join public.%I p on p.%I = c.%I where p.office_id <> c.office_id',
                   s->>0, s->>2, s->>3, s->>1) into n;
    if n > 0 and (s->>0) || '.' || (s->>1) = 'lessons.supersedes' and n <= 1 then
      -- the one known history exception (see office_edge_exceptions): named, fenced, and unable to grow
      execute format('insert into public.office_edge_exceptions (edge, child_table, child_id, parent_id, why)
                      select %L, %L, c.%I::text, c.%I::text, %L from public.%I c join public.%I p on p.%I = c.%I where p.office_id <> c.office_id',
                     'lessons.supersedes', 'lessons', 'lesson_id', 'supersedes',
                     'a harness session ran inside the real catch-all project and wrote a lesson replacing a fixture''s lesson; the ledger cannot be corrected',
                     'lessons', 'lessons', 'lesson_id', 'supersedes');
      insert into p2_rep values ('lessons', 'EXCEPTION: lessons.supersedes crosses offices on this many rows (recorded in office_edge_exceptions; key left NOT VALID)', n);
    elsif n > 0 then v_unres := v_unres || (s->>0) || '.' || (s->>1) || ' -> ' || (s->>2) || ': ' || n || ' row(s) cross offices' || E'\n'; end if;
  end loop;
  if v_unres <> '' then raise exception E'0658: rows whose parent is in another office:\n%', v_unres; end if;

  -- 6. record the working, flag what the person office holds that looks like a suite's, and give the triggers back
  insert into public.office_backfill_report (wave, table_name, rule, n)
  select '0658', r.tbl, r.rule, sum(r.n) from p2_rep r group by r.tbl, r.rule;
  for s in select * from jsonb_array_elements(spec) loop
    tbl := s->>0;
    execute format('select count(*) from public.%I t where t.office_id = %L and pg_temp.p2_h(to_jsonb(t) - ''search'')', tbl, v_person) into n;
    if n > 0 then
      insert into public.office_backfill_report (wave, table_name, rule, n)
      values ('0658', tbl, 'FLAG: in the person office and harness-shaped (kept there by a link to his project/job)', n);
    end if;
    execute format('alter table public.%I enable trigger user', tbl);
  end loop;
  if exists (select 1 from pg_trigger t where t.tgrelid::regclass::text = any(select 'public.' || (x->>0) from jsonb_array_elements(spec) x)
              and not t.tgisinternal and t.tgenabled <> 'O') then
    raise exception '0658: a trigger was left disabled';
  end if;
  select string_agg(r.tbl || ' | ' || r.rule || ' | ' || r.n, E'\n' order by r.tbl, r.rule) into v_report from p2_rep r;
  v_report := v_report || 'elapsed since the transaction began = ' || (clock_timestamp() - transaction_timestamp()) || E'\n';
  if current_setting('p2.dry_run', true) = '0658' then raise exception E'P2REPORT\n%', v_report; end if;
  raise notice E'0658 backfill:\n%', v_report;
end $m$;

-- ---- constrain ---------------------------------------------------------------------------------------------------
-- The parents of the new edges need a (key, office) pair to point at.
do $m$
declare
  tn text;
  pkc text;
begin
  for tn, pkc in select * from (values ('projects','project_id'), ('jobs','job_id'), ('tasks','task_id'), ('documents','document_id'), ('inbound_commands','command_id'), ('blockers','blocker_id'), ('decisions','decision_id'), ('events','event_id'), ('lessons','lesson_id'), ('skills','skill_id')) v(tname, pkname) where v.tname not in ('projects', 'jobs') loop
    execute format('alter table public.%I add constraint %I unique (%I, office_id)', tn, tn || '_id_office_key', pkc);
  end loop;
end $m$;

-- One composite key per edge, named for what it asserts. The original single-column keys stay: they carry the delete
-- behaviour. MATCH SIMPLE means a null optional parent column skips the check - and cannot erase ownership, because
-- office_id is NOT NULL on the child.
do $m$
declare
  e jsonb;
  pk jsonb := '{}'::jsonb;
  cname text;
begin
  for e in select * from jsonb_array_elements($e$[["tasks", "project_id", "projects", "project_id"], ["tasks", "parent_task_id", "tasks", "task_id"], ["tasks", "job_id", "jobs", "job_id"], ["tasks", "satisfies_blocker", "blockers", "blocker_id"], ["documents", "mirrors_document_id", "documents", "document_id"], ["documents", "produced_by_job", "jobs", "job_id"], ["documents", "project_id", "projects", "project_id"], ["documents", "superseded_by", "documents", "document_id"], ["inbound_commands", "compensates_event_id", "events", "event_id"], ["inbound_commands", "job_id", "jobs", "job_id"], ["inbound_commands", "project_id", "projects", "project_id"], ["inbound_commands", "paired_with", "inbound_commands", "command_id"], ["blockers", "job_id", "jobs", "job_id"], ["blockers", "project_id", "projects", "project_id"], ["browser_actions", "job_id", "jobs", "job_id"], ["browser_actions", "project_id", "projects", "project_id"], ["decisions", "project_id", "projects", "project_id"], ["decisions", "from_job", "jobs", "job_id"], ["decisions", "supersedes", "decisions", "decision_id"], ["deliveries", "job_id", "jobs", "job_id"], ["deliveries", "blocker_id", "blockers", "blocker_id"], ["events", "project_id", "projects", "project_id"], ["events", "compensates_event_id", "events", "event_id"], ["events", "related_job_id", "jobs", "job_id"], ["failure_signatures", "last_job_id", "jobs", "job_id"], ["inference_usage", "job_id", "jobs", "job_id"], ["lessons", "from_job", "jobs", "job_id"], ["lessons", "supersedes", "lessons", "lesson_id"], ["lessons", "project_id", "projects", "project_id"], ["notebook_spend", "project_id", "projects", "project_id"], ["notebook_spend", "job_id", "jobs", "job_id"], ["notebook_sync_queue", "project_id", "projects", "project_id"], ["notebook_sync_queue", "job_id", "jobs", "job_id"], ["notification_events", "project_id", "projects", "project_id"], ["project_switches", "project_id", "projects", "project_id"], ["proposals", "delivered_by_job", "jobs", "job_id"], ["signals", "project_id", "projects", "project_id"], ["signals", "caused_by_job", "jobs", "job_id"], ["skills", "project_id", "projects", "project_id"], ["skills", "from_job", "jobs", "job_id"], ["skills", "supersedes", "skills", "skill_id"], ["standing_authorizations", "project_id", "projects", "project_id"], ["suggestions", "project_id", "projects", "project_id"], ["tool_requests", "from_job", "jobs", "job_id"], ["undoable_actions", "job_id", "jobs", "job_id"], ["autonomy_settings", "project_id", "projects", "project_id"], ["event_triggers", "project_id", "projects", "project_id"], ["preference_proposals", "project_id", "projects", "project_id"], ["notification_preferences", "project_id", "projects", "project_id"], ["notebook_chat_usage", "project_id", "projects", "project_id"]]$e$::jsonb) loop
    cname := (e->>0) || '_' || (e->>1) || '_same_office';
    execute format('alter table public.%I add constraint %I foreign key (%I, office_id) references public.%I (%I, office_id) not valid',
                   e->>0, cname, e->>1, e->>2, e->>3);
    if cname = 'lessons_supersedes_same_office' and exists (select 1 from public.office_edge_exceptions x where x.edge = 'lessons.supersedes') then
      continue;   -- NOT VALID on purpose: refuses every new or changed row, tolerates the one recorded row
    end if;
    execute format('alter table public.%I validate constraint %I', e->>0, cname);
  end loop;
end $m$;

do $m$
declare
  t text;
begin
  for t in select unnest(array['tasks', 'documents', 'inbound_commands', 'blockers', 'browser_actions', 'decisions', 'deliveries', 'events', 'failure_signatures', 'inference_usage', 'lessons', 'notebook_spend', 'notebook_sync_queue', 'notification_events', 'project_switches', 'proposals', 'signals', 'skills', 'standing_authorizations', 'suggestions', 'tool_requests', 'undoable_actions', 'autonomy_settings', 'event_triggers', 'preference_proposals', 'notification_preferences', 'notebook_chat_usage']) loop
    execute format('alter table public.%I alter column office_id set not null', t);
  end loop;
end $m$;

select app.p2_guard_table('tasks', 'project_id', 'job_id', 'added_by');
select app.p2_guard_table('documents', 'project_id', 'produced_by_job', 'added_by');
select app.p2_guard_table('inbound_commands', 'project_id', 'job_id', 'actor');
select app.p2_guard_table('blockers', 'project_id', 'job_id', 'originating_agent');
select app.p2_guard_table('browser_actions', 'project_id', 'job_id', '');
select app.p2_guard_table('decisions', 'project_id', 'from_job', 'decided_by');
select app.p2_guard_table('deliveries', '', 'job_id', '');
select app.p2_guard_table('events', 'project_id', 'related_job_id', 'actor');
select app.p2_guard_table('failure_signatures', '', 'last_job_id', '');
select app.p2_guard_table('inference_usage', '', 'job_id', '');
select app.p2_guard_table('lessons', 'project_id', 'from_job', 'learned_by');
select app.p2_guard_table('notebook_spend', 'project_id', 'job_id', '');
select app.p2_guard_table('notebook_sync_queue', 'project_id', 'job_id', '');
select app.p2_guard_table('notification_events', 'project_id', '', '');
select app.p2_guard_table('project_switches', 'project_id', '', 'switched_by');
select app.p2_guard_table('proposals', '', 'delivered_by_job', '');
select app.p2_guard_table('signals', 'project_id', 'caused_by_job', '');
select app.p2_guard_table('skills', 'project_id', 'from_job', 'authored_by');
select app.p2_guard_table('standing_authorizations', 'project_id', '', 'granted_by');
select app.p2_guard_table('suggestions', 'project_id', '', '');
select app.p2_guard_table('tool_requests', '', 'from_job', 'asked_by');
select app.p2_guard_table('undoable_actions', '', 'job_id', '');
select app.p2_guard_table('autonomy_settings', 'project_id', '', 'set_by');
select app.p2_guard_table('event_triggers', 'project_id', '', 'created_by');
select app.p2_guard_table('preference_proposals', 'project_id', '', '');
select app.p2_guard_table('notification_preferences', 'project_id', '', 'subject');
select app.p2_guard_table('notebook_chat_usage', 'project_id', '', '');

-- ROLLBACK (not part of the migration): per table drop the a0_office_bridge and a1_office_write_once triggers and the *_same_office
-- constraints and the *_id_office_key keys; alter column office_id drop not null; the stamped values are harmless to keep.

