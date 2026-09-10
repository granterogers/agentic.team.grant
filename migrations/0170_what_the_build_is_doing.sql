-- What the build is doing.
--
-- Grant: *"I want to see what it is that you're doing if you're working the
-- video steps and so on so that I can pop into the application and see what it
-- is you're doing."*
--
-- The office already reports itself — jobs, outputs, `app.office_health`, the
-- activity view. The BUILD session does not. So while I am doing the work that
-- changes the product, the only way for him to see it is to open a terminal and
-- read scrollback, which is precisely the dependence he has spent weeks trying
-- to reduce.
--
-- ## The same requirement as §9, pointed at me
--
-- §9 of the build prompt asks that an activity item answer: who did what, for
-- which project, why, when, what happened, and what was produced. That is a
-- reasonable standard for the agents; it is a reasonable standard for me.
--
-- ## Screenshots are the point
--
-- The render→capture→critique loop §14A mandates produces images, and an image
-- is the only honest way to report visual work. `shot_url` carries them —
-- uploaded to the same Storage bucket pattern the avatars already use, so no
-- new vendor and no new credential. A step that says "improved the spacing" is
-- worth nothing; the same step with a before and after is worth looking at.
--
-- ## Append-only, and it prunes itself
--
-- Steps are never updated in place except to finish them, because a log that
-- rewrites history is not a log. Thirty days is kept; a build diary older than
-- that is archaeology, and the free tier is 500 MB.

begin;

create table if not exists public.build_steps (
  step_id      uuid primary key default extensions.gen_random_uuid(),
  -- The run this belongs to, so a page can group "today's work" without
  -- guessing from timestamps.
  session_ref  text        not null,
  -- What milestone or issue it serves. Free text on purpose: it is written by
  -- hand, and a foreign key to a GitHub issue number that may not exist yet
  -- would stop the log rather than record it.
  towards      text,
  headline     text        not null,
  -- The reasoning. §9's "why", and the half that a diff cannot carry.
  detail       text,
  state        text        not null default 'doing'
                 check (state in ('doing', 'done', 'blocked', 'abandoned')),
  -- What came out: a URL, a file path, a migration number, a check result.
  produced     text,
  shot_url     text,
  started_at   timestamptz not null default app.now_utc(),
  finished_at  timestamptz,
  constraint build_step_headline_said check (length(trim(headline)) > 0)
);

comment on table public.build_steps is
  'What the build session is doing, as it does it, so Grant can open the page '
  'and see rather than open a terminal and read scrollback. The same standard '
  '§9 sets for the agents: who did what, why, when, and what came out. '
  'Screenshots carry the visual work, because a sentence about spacing is worth '
  'nothing and a picture of it is worth looking at (0170).';

create index if not exists build_steps_recent on public.build_steps (started_at desc);
create index if not exists build_steps_session on public.build_steps (session_ref, started_at desc);

-- ---------------------------------------------------------------------------
-- Writing one
-- ---------------------------------------------------------------------------

create or replace function app.build_step(
  p_session  text,
  p_headline text,
  p_towards  text default null,
  p_detail   text default null,
  p_state    text default 'doing',
  p_produced text default null,
  p_shot     text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_id uuid;
begin
  insert into public.build_steps
    (session_ref, headline, towards, detail, state, produced, shot_url, finished_at)
  values (p_session, p_headline, p_towards, p_detail, p_state, p_produced, p_shot,
          case when p_state in ('done', 'blocked', 'abandoned') then app.now_utc() end)
  returning step_id into v_id;

  -- Thirty days. Older than that and it is archaeology, and the free tier is
  -- 500 MB. Pruned on write so nothing has to remember to run.
  delete from public.build_steps where started_at < app.now_utc() - interval '30 days';

  return v_id;
end;
$function$;

create or replace function app.build_step_finish(
  p_id       uuid,
  p_state    text default 'done',
  p_produced text default null,
  p_shot     text default null
)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  update public.build_steps
     set state = p_state,
         produced = coalesce(p_produced, produced),
         shot_url = coalesce(p_shot, shot_url),
         finished_at = app.now_utc()
   where step_id = p_id
  returning true
$function$;

-- ---------------------------------------------------------------------------
-- Reading it
-- ---------------------------------------------------------------------------

create or replace function app.hq_build()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    -- The one thing he actually wants at a glance: is anything happening.
    'now', (
      select jsonb_build_object(
               'headline', b.headline, 'towards', b.towards,
               'detail', b.detail, 'since', b.started_at)
        from public.build_steps b
       where b.state = 'doing'
       order by b.started_at desc limit 1
    ),
    'blocked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'headline', b.headline, 'detail', b.detail, 'since', b.started_at)
             order by b.started_at), '[]'::jsonb)
        from public.build_steps b
       where b.state = 'blocked'
    ),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'headline', b.headline,
               'towards', b.towards,
               'detail', b.detail,
               'state', b.state,
               'produced', b.produced,
               'shot', b.shot_url,
               'started_at', b.started_at,
               'finished_at', b.finished_at,
               'minutes', case when b.finished_at is null then null
                          else round(extract(epoch from (b.finished_at - b.started_at)) / 60.0) end)
             order by b.started_at desc), '[]'::jsonb)
        from (select * from public.build_steps order by started_at desc limit 40) b
    ),
    'today', (
      select jsonb_build_object(
        'done', count(*) filter (where state = 'done'),
        'doing', count(*) filter (where state = 'doing'),
        'blocked', count(*) filter (where state = 'blocked'))
        from public.build_steps
       where started_at > app.now_utc() - interval '24 hours'
    )
  )
$function$;

comment on function app.hq_build is
  'The build diary for the dashboard: what is happening now, what is blocked, '
  'and the last forty steps with their screenshots (0170).';

-- PostgREST only sees public.
create or replace function public.hq_build()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_build() $$;

revoke all on function public.hq_build() from public;
grant execute on function public.hq_build() to service_role;

create or replace function public.build_step(
  p_session text, p_headline text, p_towards text default null,
  p_detail text default null, p_state text default 'doing',
  p_produced text default null, p_shot text default null)
returns uuid language sql security definer set search_path = public, pg_catalog
as $$ select app.build_step(p_session, p_headline, p_towards, p_detail, p_state, p_produced, p_shot) $$;

revoke all on function public.build_step(text, text, text, text, text, text, text) from public;
grant execute on function public.build_step(text, text, text, text, text, text, text) to service_role;

create or replace function public.build_step_finish(
  p_id uuid, p_state text default 'done', p_produced text default null, p_shot text default null)
returns boolean language sql security definer set search_path = public, pg_catalog
as $$ select app.build_step_finish(p_id, p_state, p_produced, p_shot) $$;

revoke all on function public.build_step_finish(uuid, text, text, text) from public;
grant execute on function public.build_step_finish(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Prove it round-trips
-- ---------------------------------------------------------------------------

do $$
declare
  v_id uuid;
  v    jsonb;
begin
  v_id := app.build_step('migration-selftest', 'Proving the build diary records a step',
                         'M0', 'Written by 0170 and removed at the end of this block.');
  v := app.hq_build();
  if v->'now'->>'headline' is null then
    raise exception 'a step was recorded but hq_build reports nothing in progress';
  end if;
  perform app.build_step_finish(v_id, 'done', 'the assertion you are reading');
  v := app.hq_build();
  if v->'now'->>'headline' is not null then
    raise exception 'a finished step is still reported as in progress';
  end if;
  delete from public.build_steps where session_ref = 'migration-selftest';
end
$$;

commit;
