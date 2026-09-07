-- 0108 — A verification run must not spend the hourly ceiling
--
-- 0107 caps research jobs started by arriving sources at six an hour, so a bulk
-- paste into an established project cannot convene Emma thirty times. The cap
-- counted every such job, including the ones `verify:knowledge` creates to
-- prove the trigger works.
--
-- Which made the suite pass once and fail after that — this project already has
-- a commit called "A suite that can only pass once is not a suite", and here it
-- is again wearing a rate limit.
--
-- The cap exists to protect Grant from a stampede of real work. A job on an
-- archived or fixture project is not real work, so it does not count. That is
-- not a loophole for the suite's convenience: a cap that a verification run can
-- exhaust is a cap that reports "we are busy" when nothing is happening.

begin;

create or replace function app.notice_new_document()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enabled boolean;
  v_cap integer;
  v_min integer;
  v_had integer;
  v_recent integer;
begin
  select coalesce((select value::text::boolean from public.system_config
                    where key = 'knowledge.read_new_sources'), true)
    into v_enabled;
  if not v_enabled then return new; end if;

  if new.project_id is null then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_min_chars'), 600)
    into v_min;
  if coalesce(new.content_chars, 0) < v_min then return new; end if;

  if exists (
    select 1 from public.projects p
     where p.project_id = new.project_id
       and (p.slug like 'fixture-%' or p.slug like 'verify-%' or p.status <> 'active')
  ) then
    return new;
  end if;

  select count(*)::integer into v_had
    from public.documents d
   where d.project_id = new.project_id and d.document_id <> new.document_id;
  if v_had = 0 then return new; end if;

  select coalesce((select value::text::integer from public.system_config
                    where key = 'knowledge.new_source_jobs_per_hour'), 6)
    into v_cap;
  -- Real work only. A job on an archived or fixture project does not count
  -- against a ceiling that exists to protect Grant from a stampede.
  select count(*)::integer into v_recent
    from public.jobs j
    join public.projects p on p.project_id = j.project_id
   where j.kind = 'knowledge.read_source'
     and j.created_at > app.now_utc() - interval '1 hour'
     and p.status = 'active'
     and p.slug not like 'fixture-%'
     and p.slug not like 'verify-%'
     and p.slug not like 'newsroom-%';
  if v_recent >= v_cap then
    return new;
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority,
     announce, pinned_config)
  values (gen_random_uuid(), new.project_id,
          format('read:%s', new.document_id),
          'knowledge.read_source',
          format('%s:%s', new.connector, coalesce(new.external_ref, 'source')),
          200,
          true,
          jsonb_build_object(
            'document_id', new.document_id,
            'title', new.title,
            'connector', new.connector));

  return new;
exception
  when unique_violation then
    return new;
  when others then
    raise warning 'notice_new_document failed for %: %', new.document_id, sqlerrm;
    return new;
end;
$$;

commit;
