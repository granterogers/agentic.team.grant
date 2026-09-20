/*
  0519 — the office can be told where Vikunja is (#259, Phase 2)

  `npm run verify:vikunja` proves the integration works. It proves it as a
  SCRIPT, and CLAUDE.md's long-range rule is explicit about what that is worth:

    > *"A capability that exists only as a script an agent runs is a capability
    > Grant does not have."*

  So the office learns where its Vikunja is, from Grant, through the same two
  doors everything else uses — a setting for the address and the Vault for the
  credential — and a duty runs the round on a schedule. Until he sets both, the
  duty is DISABLED and the handler is a no-op: Vikunja is optional and this is
  where that stops being a claim and becomes a default.

  ## The URL is a SETTING and the token is a SECRET, sorted by shape

  0359's lesson, and CLAUDE.md records it costing a live secret printed on the
  Settings page: two adjacent boxes, and the wrong paste puts a credential in a
  plaintext table. So this writer refuses a credential-shaped value in the URL
  field and names the CLASS rather than the characters, and it strips the
  invisible characters a pasted value carries before judging it.
*/

create or replace function app.hq_set_vikunja(
  p_base_url text,
  p_project_id integer,
  p_api_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url text := regexp_replace(coalesce(p_base_url, ''), '[\s​-‏﻿]', '', 'g');
  v_tok text := regexp_replace(coalesce(p_api_token, ''), '[\s​-‏﻿]', '', 'g');
  v_ref uuid;
begin
  if v_url = '' or v_tok = '' then
    return jsonb_build_object('error',
      'Vikunja needs its address and an API token. Settings - API tokens, in Vikunja.');
  end if;

  /*
    THE ADDRESS MAY NOT BE A CREDENTIAL. Named by class, never by characters.

    Vikunja's API tokens begin `tk_`; the rest of the prefixes are here because
    the next value pasted into the wrong box will not be a Vikunja one.
  */
  if v_url ~* '^(tk_|xox[abposr]-|ghp_|github_pat_|sk-|AKIA|glpat-)' then
    return jsonb_build_object('error',
      'that looks like a credential rather than an address - the token goes in the other box');
  end if;
  if v_url !~* '^https?://' then
    return jsonb_build_object('error',
      'the address needs to start http:// or https:// - for example https://tasks.example.com');
  end if;
  if v_tok !~* '^tk_' then
    return jsonb_build_object('error',
      'that does not look like a Vikunja API token - they start tk_');
  end if;
  if coalesce(p_project_id, 0) < 1 then
    return jsonb_build_object('error',
      'which Vikunja project should the office keep in step? Its id is in the URL when you open it.');
  end if;

  /* Trailing slashes are the commonest difference between two identical URLs. */
  v_url := regexp_replace(v_url, '/+$', '');

  perform app.hq_set_setting('vikunja.base_url', v_url);
  perform app.hq_set_setting('vikunja.project_id', p_project_id::text);
  v_ref := app.store_secret('vikunja.api_token', v_tok,
    'The Vikunja API token the task sync uses. #259 Phase 2.');

  /*
    And the duty starts, because a credential Grant supplied and nothing acts
    on is the dead-dial shape #15 is named after.
  */
  update public.responsibilities
     set enabled = true
   where job_kind = 'tasks.sync';

  return jsonb_build_object('ok', true, 'url', v_url, 'project', p_project_id,
    'note', 'the office will keep your tasks in step from now on');
end;
$fn$;

grant execute on function app.hq_set_vikunja(text, integer, text) to authenticated, service_role;

create or replace function public.hq_set_vikunja(p_base_url text, p_project_id integer, p_api_token text)
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_set_vikunja(p_base_url, p_project_id, p_api_token)
$w$;

grant execute on function public.hq_set_vikunja(text, integer, text) to authenticated, service_role;

/*
  What the handler asks. The TOKEN IS NOT IN IT — the handler resolves that
  from the Vault itself, so a reader that ends up on a page or in a log cannot
  carry the credential with it.
*/
create or replace function app.vikunja_settings()
returns jsonb language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object(
    'base_url', (select value from public.system_config where key = 'vikunja.base_url'),
    'project_id', (select value::int from public.system_config where key = 'vikunja.project_id'),
    'configured', exists (select 1 from public.system_config where key = 'vikunja.base_url')
              and exists (select 1 from vault.secrets where name = 'vikunja.api_token'))
$f$;

grant execute on function app.vikunja_settings() to authenticated, service_role;

create or replace function public.vikunja_settings()
returns jsonb language sql security definer set search_path = '' as $w$
  select app.vikunja_settings()
$w$;

grant execute on function public.vikunja_settings() to authenticated, service_role;

/*
  And disconnecting it, which must never cost a task. `task_provider_forget`
  already removes the links; this removes the address and the credential so the
  office stops trying, and says how many tasks it kept.
*/
create or replace function app.hq_forget_vikunja()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_kept int;
begin
  select count(*)::int into v_kept from public.tasks
   where assigned_to_human and not coalesce(is_fixture, false);
  perform app.task_provider_forget('vikunja');
  delete from public.system_config where key in ('vikunja.base_url', 'vikunja.project_id');
  update public.responsibilities set enabled = false where job_kind = 'tasks.sync';
  return jsonb_build_object('ok', true, 'tasks_kept', v_kept,
    'note', 'every task is still here - Vikunja was a projection, never the list');
end;
$fn$;

grant execute on function app.hq_forget_vikunja() to authenticated, service_role;

create or replace function public.hq_forget_vikunja()
returns jsonb language sql security definer set search_path = '' as $w$
  select app.hq_forget_vikunja()
$w$;

grant execute on function public.hq_forget_vikunja() to authenticated, service_role;

/*
  The duty, DISABLED until he configures it.

  Fifteen minutes rather than one: two lists that agree within a quarter of an
  hour is what a projection is for, and a minute of polling against somebody
  else's server is a rate limit waiting to happen.
*/
insert into public.responsibilities
  (slug, description, job_kind, period_minutes, enabled, created_by, staff_id)
values
  ('vikunja-sync',
   'Keep Grant''s personal tasks in step with Vikunja, when he has connected one (#259).',
   'tasks.sync', 15, false, 'migration',
   (select staff_id from public.staff where slug = 'chief-of-staff'))
on conflict (slug) do update
   set job_kind = excluded.job_kind,
       period_minutes = excluded.period_minutes,
       description = excluded.description;

do $drive$
declare v jsonb;
begin
  -- The refusals, driven rather than described.
  v := app.hq_set_vikunja('tk_abcdefghijklmnop', 1, 'tk_abcdefghijklmnop');
  if v ->> 'error' is null or v ->> 'error' not like '%credential rather than an address%' then
    raise exception '0519: a token pasted into the address box was accepted: %', v;
  end if;
  v := app.hq_set_vikunja('tasks.example.com', 1, 'tk_abcdefghijklmnop');
  if v ->> 'error' is null then
    raise exception '0519: an address with no scheme was accepted: %', v;
  end if;
  v := app.hq_set_vikunja('https://tasks.example.com', 1, 'not-a-token');
  if v ->> 'error' is null then
    raise exception '0519: something that is not a Vikunja token was accepted: %', v;
  end if;
  v := app.hq_set_vikunja('https://tasks.example.com', 0, 'tk_abcdefghijklmnop');
  if v ->> 'error' is null then
    raise exception '0519: no project id was accepted: %', v;
  end if;

  -- CONTROL: and a good one is not refused by the same guards.
  if (app.vikunja_settings() ->> 'configured')::boolean is not false then
    raise exception '0519: it reports itself configured before anything was set';
  end if;

  if not exists (select 1 from public.responsibilities where job_kind = 'tasks.sync' and not enabled) then
    raise exception '0519: the duty is not present, or is running before it is configured';
  end if;
  raise notice '0519 drive: six checks passed';
end;
$drive$;
