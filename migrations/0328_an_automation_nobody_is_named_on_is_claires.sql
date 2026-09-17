begin;

/**
 * An automation nobody is named on is Claire's.
 *
 * Issue #36. `responsibilities.staff_id` is NOT NULL — every one of the twelve
 * duties that run the office belongs to somebody — and 0324's writer passed
 * null when Grant did not name anyone, so creating an automation without
 * choosing a person failed on a constraint.
 *
 * Requiring a person on the form was the other option and is the wrong one:
 * *"summarise anything new each morning"* is a complete thought, and making
 * him answer "by whom" before it can be written down is the avoidable manual
 * configuration §31 calls a design failure.
 *
 * So an unaddressed automation belongs to the Chief of Staff, which is what an
 * empty roster means everywhere else in this office — `pickRoster` returns no
 * one and Claire picks it up, `app.staff_behind_job` falls back to her for a
 * duty routed by nothing, and the floor channel narrates it as *"Small enough
 * that I have not pulled anyone in — I am handling it."*
 *
 * `recipient_agent` stays null in that case, and the two columns are not in
 * conflict: `staff_id` is whose duty this is, `recipient_agent` is who the
 * instruction is addressed to. Claire owning a standing instruction while the
 * router picks who answers each run is exactly the arrangement Grant has when
 * he types the same sentence into Slack.
 */

create or replace function app.create_automation(
  p_slug text,
  p_instruction text,
  p_every_minutes int default 1440,
  p_at_time text default null,
  p_who text default null,
  p_by text default 'grant')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_project uuid;
  v_name    text;
  v_staff   uuid;
  v_named   text := nullif(btrim(coalesce(p_who, '')), '');
  v_what    text := btrim(coalesce(p_instruction, ''));
  v_at      time := case when btrim(coalesce(p_at_time, '')) = '' then null
                         else btrim(p_at_time)::time end;
  v_stem    text;
  v_slug    text;
  v_n       int := 1;
  v_id      uuid;
begin
  select project_id, name into v_project, v_name
    from public.projects where slug = p_slug and status <> 'archived';
  if v_project is null then
    return jsonb_build_object('ok', false, 'error', format('no active project called %s', p_slug));
  end if;

  -- Twenty characters, matching `responsibilities_description_substantive`.
  -- Checked here so the message is a sentence rather than a constraint name;
  -- the column still enforces it, which is what makes this a better error and
  -- not the only guard.
  if length(v_what) < 20 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Say what should happen in a sentence — this is the instruction the team will be given.');
  end if;

  if v_named is not null then
    select staff_id into v_staff from public.staff where slug = v_named and active;
    if v_staff is null then
      return jsonb_build_object('ok', false, 'error', format('nobody here is called %s', v_named));
    end if;
    -- An automation addressed to somebody who is not on this project would
    -- never produce anything, and the reason would be two tables away. 0323's
    -- rule, enforced at the point the decision is made.
    if not (v_named = any (app.staff_on_project(v_project))) then
      return jsonb_build_object(
        'ok', false,
        'error', format('%s is not on this project — put them on it first, in Team.', v_named));
    end if;
  else
    -- See the header. Not a placeholder: this is who actually has it.
    select staff_id into v_staff from public.staff where slug = 'chief-of-staff';
  end if;

  if p_every_minutes < 10 or p_every_minutes > 20160 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Anything from every ten minutes to once a fortnight.');
  end if;
  -- `responsibilities_one_schedule`. A time of day only means something on a
  -- period of a day or more; "every hour at 09:00" is two schedules.
  if v_at is not null and p_every_minutes < 1440 then
    return jsonb_build_object(
      'ok', false,
      'error', 'A time of day needs a daily or slower schedule.');
  end if;

  v_stem := regexp_replace(
              regexp_replace(lower(btrim(coalesce(v_name, 'project'))), '[^a-z0-9]+', '-', 'g'),
              '(^-+|-+$)', '', 'g');
  v_stem := left(coalesce(nullif(v_stem, ''), 'project'), 40) || '-auto';
  v_slug := v_stem;
  while exists (select 1 from public.responsibilities where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_stem || '-' || v_n::text;
  end loop;

  insert into public.responsibilities
    (slug, staff_id, project_id, description, job_kind, period_minutes, at_time,
     enabled, pinned_config, recipient_agent, created_by)
  values
    (v_slug, v_staff, v_project, v_what, 'office.instruction', p_every_minutes, v_at,
     true, jsonb_build_object('instruction', v_what), v_named, p_by)
  returning responsibility_id into v_id;

  return jsonb_build_object(
    'ok', true, 'automation', v_slug, 'id', v_id,
    'whose', coalesce(v_named, 'chief-of-staff'),
    'when', app.say_schedule(p_every_minutes, v_at, 'UTC'));
end;
$$;

grant execute on function app.create_automation(text, text, int, text, text, text) to ai_team_app;

commit;
