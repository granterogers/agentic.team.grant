-- Two projects saying the same thing are two facts, not a repeat (#355).
--
-- 0584 keyed public.duty_said on job_kind alone. That is right for a duty whose
-- run covers everything at once -- office.notion_sync produces ONE output across
-- every attached project -- and wrong for a duty that runs per project, which
-- office.provision_channels does. Two projects whose news happens to read
-- identically ("Nothing new.") would have had the second one muted, and muting a
-- DIFFERENT project's message is losing real information rather than sparing him
-- a repeat. That is the expensive direction, so it is closed before it can
-- happen: duty_said has never held a row, and no message has been muted yet.
--
-- Keyed on the project as well, with a sentinel for the duties that have none,
-- because a NULL in a primary key is not a value and on conflict would never
-- match -- which is the documents_one_per_external_ref defect that cost four
-- migrations to learn.

alter table public.duty_said drop constraint duty_said_pkey;

alter table public.duty_said
  add column if not exists project_id uuid references public.projects(project_id) on delete cascade;

-- Not nullable in the key: app.unnamed_project() is the office's own word for
-- "no particular project", so the key is always a real pair of values.
update public.duty_said set project_id = app.unnamed_project() where project_id is null;
alter table public.duty_said alter column project_id set not null;
alter table public.duty_said alter column project_id set default app.unnamed_project();

alter table public.duty_said add primary key (job_kind, project_id);

comment on column public.duty_said.project_id is
  'The project this duty run was about, or app.unnamed_project() when it was '
  'about everything. In the key so one project cannot silence another (#355).';

create or replace function app.say_once(p_job_id uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_kind text;
  v_project uuid;
  v_is_duty boolean;
  v_print text;
  v_prev text;
  v_said timestamptz;
begin
  select kind, coalesce(project_id, app.unnamed_project())
    into v_kind, v_project
    from public.jobs where job_id = p_job_id;

  if v_kind is null then
    return true;
  end if;

  -- Only the clock repeats itself. A person asking twice deserves two answers.
  select exists (select 1 from public.responsibilities r where r.job_kind = v_kind)
    into v_is_duty;
  if not v_is_duty then
    return true;
  end if;

  v_print := md5(coalesce(p_body, ''));

  select fingerprint, said_at into v_prev, v_said
    from public.duty_said
   where job_kind = v_kind and project_id = v_project;

  if v_prev is distinct from v_print
     or v_said < app.now_utc() - interval '20 hours' then
    insert into public.duty_said
      (job_kind, project_id, fingerprint, said_at, repeats, last_seen_at)
    values (v_kind, v_project, v_print, app.now_utc(), 0, app.now_utc())
    on conflict (job_kind, project_id) do update
      set fingerprint = excluded.fingerprint,
          said_at = excluded.said_at,
          repeats = 0,
          last_seen_at = excluded.last_seen_at;
    return true;
  end if;

  update public.duty_said
     set repeats = repeats + 1,
         last_seen_at = app.now_utc()
   where job_kind = v_kind and project_id = v_project;
  return false;
end
$function$;

-- Drive it. The new case is the one worth proving: two jobs of one duty kind,
-- on DIFFERENT projects, saying the identical sentence -- both must speak.
do $$
declare
  v_a uuid;
  v_b uuid;
  v_chat uuid;
  v_first boolean;
  v_again boolean;
  v_other boolean;
  v_conv boolean;
begin
  begin
    -- drive.watch is the duty that genuinely runs PER PROJECT -- 14 jobs
    -- across 14 projects. office.notion_sync covers every project in one run
    -- and carries no project_id, which is the case the sentinel handles and
    -- the wrong subject for a cross-project control.
    select job_id into v_a from public.jobs
     where kind = 'drive.watch' and project_id is not null
     order by created_at desc limit 1;

    select job_id into v_b from public.jobs
     where kind = 'drive.watch' and project_id is not null
       and project_id <> (select project_id from public.jobs where job_id = v_a)
     order by created_at desc limit 1;

    select job_id into v_chat from public.jobs
     where kind = 'office.instruction' order by created_at desc limit 1;

    if v_a is null or v_chat is null then
      raise exception 'no subject to drive with';
    end if;

    delete from public.duty_said where job_kind = 'drive.watch';

    v_first := app.say_once(v_a, 'Nothing new.');
    v_again := app.say_once(v_a, 'Nothing new.');

    if not v_first then raise exception 'the first time was not said'; end if;
    if v_again then raise exception 'the duty repeated itself within the hour'; end if;

    -- THE NEW CONTROL. Only meaningful if a second project exists to test with;
    -- claiming it passed when there was nothing to compare would be the vacuous
    -- control this file keeps finding.
    if v_b is not null then
      v_other := app.say_once(v_b, 'Nothing new.');
      if not v_other then
        raise exception 'one project silenced another, which is the defect this fixes';
      end if;
    else
      raise warning 'no second project to drive the cross-project control with';
    end if;

    v_conv := app.say_once(v_chat, 'The margin is 35 percent.');
    if not v_conv then raise exception 'conversation was silenced'; end if;

    raise exception 'ROLLBACK_FIXTURES';
  exception
    when others then
      if sqlerrm <> 'ROLLBACK_FIXTURES' then raise; end if;
  end;
end $$;
