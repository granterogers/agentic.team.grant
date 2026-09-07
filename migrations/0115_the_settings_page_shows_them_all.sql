-- 0115 — The settings page shows them all
--
-- 0114 widened what `hq_set_setting` will accept. `hq_settings` still described
-- nine keys, so the page rendered nine boxes and the other seventeen were
-- editable by anything that knew their names — which is to say by nothing,
-- because the page is the only caller.
--
-- A permission that no interface exposes is not a feature. Both lists come from
-- one place now, so they cannot drift again.
--
-- ## Grouped, because twenty-six boxes in a column is not a settings page
--
-- Three groups in the order someone needs them: where things live, how the team
-- behaves, and the limits. The page renders whatever it is given, so the
-- grouping lives here next to the keys rather than as a second list in
-- JavaScript that would have to be kept in step.

begin;

/**
 * Every key the page may change, with its group and a sentence.
 *
 * One source for the allow-list, the descriptions and the grouping. 0114's
 * function validates against its own list and this describes it; the check at
 * the bottom of this migration proves they agree, so the next person to add a
 * key cannot add it to one and not the other.
 */
create or replace function app.hq_editable_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_agg(row_to_json(k) order by k.ord)
    from (
      values
        (1, 'Where things live', 'db.project_ref', 'The Supabase project the tooling connects to. Declared, not live: changing it tells the next run where to look and moves nothing.'),
        (2, 'Where things live', 'db.region', 'Where that project is hosted. Recorded for this page; not enforced.'),
        (3, 'Where things live', 'backup.s3_bucket', 'The bucket nightly backups are written to.'),
        (4, 'Where things live', 'backup.s3_endpoint', 'The S3 endpoint for that bucket.'),
        (5, 'Where things live', 'backup.s3_region', 'The region for that bucket.'),
        (6, 'Where things live', 'grant.timezone', 'The timezone every date in this system is reported in. Checked against the list Postgres knows, because a timezone that does not exist silently makes everything UTC.'),

        (10, 'How the team behaves', 'notebook.enabled', 'Whether the team may use NotebookLM at all.'),
        (11, 'How the team behaves', 'calendar.enabled', 'Whether your calendar is read. Needs Google connected first.'),
        (12, 'How the team behaves', 'calendar.calendar_id', 'Which calendar to read. "primary" is the account''s own.'),
        (13, 'How the team behaves', 'knowledge.read_new_sources', 'Whether a source arriving in an established project starts a research job. Off makes the corpus passive: documents are stored and nobody looks at them.'),
        (14, 'How the team behaves', 'notebook.sync_interval_minutes', 'How often the notebook is checked for new sources.'),
        (15, 'How the team behaves', 'conversation.window_minutes', 'How far back a reply looks for the messages before it. A chat has no "conversation ended" event, so this is a window rather than a session.'),
        (16, 'How the team behaves', 'conversation.max_turns', 'How many of those turns to carry. Enough to hold a real exchange; not so many that the question being answered is buried.'),

        (20, 'Limits', 'agents.max_simultaneous_jobs', 'How many jobs run at once.'),
        (21, 'Limits', 'agents.max_delegation_depth', 'How far one piece of work may delegate before it has to come back to you.'),
        (22, 'Limits', 'agents.max_specialists_per_job', 'How many people one job may convene.'),
        (23, 'Limits', 'agents.max_live_specialists', 'How many temporary specialists may exist at once.'),
        (24, 'Limits', 'agents.max_investigations_per_project_per_day', 'How much unprompted digging one project may generate in a day.'),
        (25, 'Limits', 'notebook.window_units', 'Our estimate of the notebook allowance in one five-hour window. A guess until a refusal measures it.'),
        (26, 'Limits', 'notebook.week_units', 'The weekly ceiling, same currency, same caveat.'),
        (27, 'Limits', 'knowledge.new_source_jobs_per_hour', 'Ceiling on research jobs started by arriving sources. A bulk paste into an established project looks exactly like news, and this is what makes that survivable.'),
        (28, 'Limits', 'knowledge.new_source_min_chars', 'Below this a document is not worth convening anyone over.'),
        (29, 'Limits', 'ui.needs_me_cap', 'How many things may sit at the top of Today before the rest are folded away.')
    ) as k(ord, "group", key, description)
$$;

grant execute on function app.hq_editable_settings() to ai_team_app, service_role;

create or replace function app.hq_settings()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'live', jsonb_build_object(
      'database', current_database(),
      'server', 'PostgreSQL ' || split_part(current_setting('server_version'), ' ', 1),
      'size', pg_size_pretty(pg_database_size(current_database())),
      'tables', (select count(*)::int from information_schema.tables
                  where table_schema = 'public' and table_type = 'BASE TABLE')
    ),
    'settings', coalesce((
      select jsonb_object_agg(c.key, jsonb_build_object(
               'value', c.value, 'description', c.description))
        from public.system_config c
       where c.key in (select e ->> 'key' from jsonb_array_elements(app.hq_editable_settings()) e)
    ), '{}'::jsonb),
    -- The shape the page renders: key, group and sentence together, so it does
    -- not have to hold its own copy of any of the three.
    'editable', app.hq_editable_settings(),
    'notebook', app.notebook_allowance(),
    'google', app.hq_google()
  )
$$;

-- The two lists must agree. A key the page offers and the setter refuses is a
-- box that silently does nothing; the reverse is a permission nothing exposes.
-- Proven here rather than remembered.
do $$
declare
  k text;
  r jsonb;
begin
  for k in select e ->> 'key' from jsonb_array_elements(app.hq_editable_settings()) e loop
    -- A value guaranteed invalid for every type, so nothing is actually written:
    -- the only error that may come back is a validation one, never "not a
    -- setting this page may change".
    r := app.hq_set_setting(k, '~~probe~~');
    if r ? 'error' and r ->> 'error' like '%is not a setting this page may change%' then
      raise exception 'hq_editable_settings offers %, which hq_set_setting refuses', k;
    end if;
  end loop;
end $$;

commit;
