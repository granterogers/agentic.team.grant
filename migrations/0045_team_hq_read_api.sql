-- 0045 — what Team HQ is allowed to read
--
-- §12: *"Team HQ = canonical dashboards"*, and §25 wants it on a phone and on a
-- desktop. The data has existed for weeks — `today`, `needs_me`,
-- `project_attention()`, `notebook_budget` — with nothing to show it.
--
-- The whole of the security thinking is in one decision: **the browser cannot
-- name a table, a column or a query.** It names a SECTION, from a fixed list,
-- and the projection lives here where it can be reviewed. The obvious
-- alternative — expose the tables to PostgREST with the anon key and let the
-- page query what it likes — is how a private system becomes a public one, and
-- the RLS policies in this database are written for `ai_team_app`, not for an
-- anonymous browser.
--
-- Every function below lists its columns explicitly. Never `select *`, and the
-- reason is specific rather than stylistic: `usable_models` and
-- `credential_health` both carry `secret_ref`, and a `select *` in a dashboard
-- endpoint would publish it the day somebody adds a column. A secret reference
-- is not a secret, but it is exactly the "token/debug detail" §25's acceptance
-- says must not appear in normal workflow.
--
-- The functions return `jsonb` rather than rows. The endpoint is a JSON API and
-- a row-to-JSON conversion in the handler would be a second place where the
-- shape is decided.

begin;

/**
 * The front page: what is happening, what is stuck, what needs Grant.
 *
 * Counts and lists together, because a dashboard that shows a list of seven
 * things and does not say there are forty is worse than one that shows nothing:
 * §25's Needs Me reports its overflow rather than truncating silently, and this
 * is where that number comes from.
 */
create or replace function app.hq_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generated_at', app.now_utc(),
    'counts', jsonb_build_object(
      'live_jobs', (
        select count(*)::int from public.jobs
        where state not in ('complete', 'cancelled', 'failed')
      ),
      'needs_me', (select count(*)::int from public.needs_me),
      'needs_me_overdue', (select count(*)::int from public.needs_me where overdue),
      'active_projects', (select count(*)::int from public.projects where status = 'active'),
      'undo_offers', (select count(*)::int from public.undo_offers)
    ),
    -- Capped, and the cap is reported. A list that silently shows 7 of 40 looks
    -- healthy exactly when it stops being useful.
    'needs_me', coalesce((
      select jsonb_agg(row_to_json(n)) from (
        select blocker_id, project_id, requested_action, why_needed,
               consequences_of_delay, approval_options, real_deadline, overdue,
               work_can_continue, created_at
        from public.needs_me
        order by overdue desc, real_deadline nulls last, created_at
        limit 20
      ) n
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select job_id, project_id, project_name, kind, state, intent_class,
               priority, state_reason, waiting_on, minutes_since_change
        from public.today
        order by priority desc, minutes_since_change desc
        limit 40
      ) t
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(row_to_json(p)) from (
        select project_id, slug, name, open_blockers, overdue_blockers,
               live_jobs, failed_jobs_24h, stalled_jobs, hours_since_sync,
               has_brief, brief_is_stale
        from app.project_attention()
      ) p
    ), '[]'::jsonb)
  );
$$;

/**
 * The staff, as §9 presents them: name, title, avatar.
 *
 * `avatar_ref` is a path; the page joins it to the configured base, the same
 * way Slack does. Handing the browser a pre-built URL would be a second place
 * that knows how an avatar is addressed.
 */
create or replace function app.hq_staff()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'avatar_base', (
      select value #>> '{}' from public.system_config where key = 'staff.avatar_base_url'
    ),
    'staff', coalesce((
      select jsonb_agg(row_to_json(s) order by s.permanent desc, s.name) from (
        select staff_id, slug, name, title, responsibilities, expertise,
               communication_style, permanent, active, avatar_ref, prompt_version,
               (select count(*)::int from public.routing_decisions r
                 where st.slug = any (r.roster)) as jobs_convened_for
        from public.staff st
        where active
      ) s
    ), '[]'::jsonb)
  );
$$;

/**
 * What has happened lately.
 *
 * From `job_state_transitions` rather than from `events`: the ledger is the record
 * of everything, which is the wrong altitude for a person glancing at a phone.
 * A state change has a job, a reason and a time, and that is the story.
 */
create or replace function app.hq_activity(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
    select c.job_id, j.kind, j.project_id, p.name as project_name,
           c.from_state::text as from_state, c.to_state::text as to_state,
           c.reason, c.attempt, c.occurred_at
    from public.job_state_transitions c
    join public.jobs j on j.job_id = c.job_id
    left join public.projects p on p.project_id = j.project_id
    order by c.occurred_at desc
    limit least(greatest(p_limit, 1), 200)
  ) a;
$$;

/**
 * Usage and capacity — §25 names this as a dashboard of its own.
 *
 * Every figure carries how it was obtained. §11 is categorical that estimated
 * quota must never be presented as authoritative, and Notebook in particular
 * has NO live counters, so its numbers are always estimates. The page cannot
 * render an honest label unless the API sends one, so `provenance` is a field
 * rather than a footnote in the documentation.
 */
create or replace function app.hq_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'inference', jsonb_build_object(
      'provenance', 'measured',
      'note', 'Every inference attempt is recorded locally, successes and failures alike.',
      'calls_30d', (
        select count(*)::int from public.inference_usage
        where occurred_at > app.now_utc() - interval '30 days'
      ),
      'cost_usd_30d', (
        select coalesce(sum(cost_usd), 0)::numeric(12,6) from public.inference_usage
        where occurred_at > app.now_utc() - interval '30 days'
      ),
      'by_outcome', coalesce((
        select jsonb_object_agg(outcome, n) from (
          select outcome::text as outcome, count(*)::int as n
          from public.inference_usage
          where occurred_at > app.now_utc() - interval '30 days'
          group by 1
        ) o
      ), '{}'::jsonb)
    ),
    'tts', jsonb_build_object(
      'provenance', 'measured',
      'note', 'Counted by us: Google exposes no live counter for Chirp 3.',
      'characters_this_month', app.tts_characters_this_month('google.chirp3-hd'),
      'monthly_free_allowance', 1000000
    ),
    'notebook', jsonb_build_object(
      -- The important one. There is no API for this and there never was; the
      -- figures come from a capability probe, and calling them anything but
      -- estimated would be the exact misrepresentation §11 forbids.
      'provenance', 'estimated',
      'note', 'Notebook publishes no usage counters. These are inferred from a capability probe and may be wrong.',
      'detected_tier', (select detected_tier from public.notebook_budget),
      'notebook_limit', (select notebook_limit from public.notebook_budget),
      'source_limit', (select source_limit from public.notebook_budget),
      'daily_chat_budget', (select daily_chat_budget from public.notebook_budget),
      'computed_at', (select computed_at from public.notebook_budget)
    ),
    'queue', jsonb_build_object(
      'provenance', 'measured',
      'max_concurrent', app.capacity_limit('max_concurrent_jobs', 3),
      'in_flight', (
        select count(*)::int from public.jobs
        where state not in ('complete', 'cancelled', 'failed')
      )
    ),
    'delivery', coalesce((
      select jsonb_agg(row_to_json(d)) from (
        select channel, state, deliveries, needed_more_than_one_attempt, leases_expired
        from public.delivery_health
      ) d
    ), '[]'::jsonb),
    'models', coalesce((
      -- Explicitly WITHOUT secret_ref and base_url. A secret reference is not a
      -- secret, and it is still not something a dashboard needs.
      select jsonb_agg(row_to_json(m)) from (
        select provider, model_id, priority, last_success_at
        from public.usable_models
        order by priority, provider
      ) m
    ), '[]'::jsonb)
  );
$$;

-- Read-only, and only these four. The application role gets them too, so
-- anything server-side can render the same view without a second projection.
grant execute on function app.hq_overview() to ai_team_app, service_role;
grant execute on function app.hq_staff() to ai_team_app, service_role;
grant execute on function app.hq_activity(integer) to ai_team_app, service_role;
grant execute on function app.hq_usage() to ai_team_app, service_role;

commit;
