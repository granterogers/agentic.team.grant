/*
  0561 — "get another person to look at that" must put another person on it

  ## What v745 did

      Grant : have someone work out whether the venue deposit is refundable
              -> handed on
      Grant : get another person to look at that as well
              -> 0 children

  `wantsAnotherGo` recognised the authorisation and correctly did not suppress
  anything. Then the ordinary routing convened nobody, because the sentence
  names no subject — "that" is a pro-form and `who_knows_about` has nothing to
  match. So the office agreed to a second opinion and produced none.

  That is the defect this repository records as *an offer may only promise
  what the press can perform*, manufactured by the fix that added the offer:
  every duplicate-suppressing reply ends "say the word if you want somebody
  else to take a separate look", and the word did nothing.

  ## What a second pair of eyes needs

  Not the new sentence — it carries no subject. The ORIGINAL obligation, and
  somebody who is not already on it. Both are canonical:

    - the obligation is the most recent thing this conversation handed on,
      running or just finished, which `app.conversation_work` already returns
    - "not already on it" is every specialist carrying a live or recent job
      under that obligation

  Ranked by `app.who_knows_about` over the original text, so the second
  opinion goes to somebody with a reason to have one, and falling back to any
  live specialist rather than to nobody — an empty answer here is the whole
  defect.
*/

create or replace function app.another_pair_of_eyes(
  p_command_id uuid,
  p_except_under uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_work jsonb;
  v_item jsonb;
  v_about text;
  v_taken text[];
  v_slug text;
begin
  v_work := app.conversation_work(p_command_id, interval '24 hours', p_except_under);

  /*
    Running first, then just-finished. A second opinion on work still in
    flight is the commoner ask, and one on work that just came back is the
    other half of #316's list.
  */
  v_item := coalesce((v_work -> 'in_flight') -> -1, (v_work -> 'recently_done') -> -1);
  if v_item is null then
    return jsonb_build_object('ok', false, 'why', 'nothing to look at again');
  end if;
  v_about := coalesce(v_item ->> 'about', '');
  if btrim(v_about) = '' then
    return jsonb_build_object('ok', false, 'why', 'nothing to look at again');
  end if;

  /* Everybody already carrying this obligation, so a second opinion is one. */
  select coalesce(array_agg(distinct x.who), '{}')
    into v_taken
    from (
      select j.recipient_agent as who
        from jsonb_array_elements(coalesce(v_work -> 'in_flight', '[]'::jsonb)) e
        join public.jobs j on j.job_id = (e ->> 'job')::uuid
       where j.recipient_agent is not null
      union
      select j.recipient_agent
        from jsonb_array_elements(coalesce(v_work -> 'recently_done', '[]'::jsonb)) e
        join public.jobs j on j.job_id = (e ->> 'job')::uuid
       where j.recipient_agent is not null
    ) x;

  /*
    Somebody with a reason to have an opinion, then anybody at all. An empty
    answer is the defect this migration exists to remove, so the fallback is
    deliberate rather than tidy.
  */
  select k.slug into v_slug
    from app.who_knows_about(v_about, 8) k
   where not (k.slug = any(v_taken))
   limit 1;

  if v_slug is null then
    select s.slug into v_slug from public.staff s
     where s.retired_at is null
       and not (s.slug = any(v_taken))
     order by s.slug
     limit 1;
  end if;

  if v_slug is null then
    return jsonb_build_object('ok', false, 'why', 'everybody is already on it');
  end if;

  return jsonb_build_object('ok', true, 'slug', v_slug, 'about', v_about,
                            'already_on_it', to_jsonb(v_taken));
end;
$function$;

comment on function app.another_pair_of_eyes(uuid, uuid) is
  'The original obligation of this conversation and somebody not already on '
  'it, so "get another person to look at that" can put another person on it. '
  'The new sentence carries no subject, so the work comes from canonical '
  'state rather than from the words. 0561.';

do $drive$
declare
  v_p uuid; v_c uuid; v_parent uuid; v_kid uuid; v_got jsonb;
begin
  select project_id into v_p from public.projects
   where status = 'active' and not is_fixture
     and project_id <> app.unnamed_project() order by updated_at desc limit 1;
  if v_p is null then raise notice '0561: no real project; skipped'; return; end if;

  insert into public.inbound_commands
    (origin_channel, origin_ref, actor, instruction, dedupe_key)
  values ('teamhq', 'drive0561:1', 'grant', 'is the venue deposit refundable',
          'teamhq:drive:zero_five_six_one_a')
  returning command_id into v_c;
  insert into public.jobs (correlation_id, project_id, idempotency_key, kind,
                           requested_by, priority, state)
  values (extensions.gen_random_uuid(), v_p, 'drive-0561-parent', 'office.instruction',
          'teamhq:grant', 10, 'queued')
  returning job_id into v_parent;
  update public.inbound_commands set job_id = v_parent where command_id = v_c;

  /* Nothing handed on yet: there is nobody to add, and it says so. */
  v_got := app.another_pair_of_eyes(v_c);
  if coalesce((v_got ->> 'ok')::boolean, true) then
    raise exception '0561: it offered a second opinion on nothing: %', v_got;
  end if;

  select (app.enqueue_child_once(v_parent, 'office.instruction',
            'finance-director: is the venue deposit refundable') ->> 'job_id')::uuid
    into v_kid;
  update public.jobs set recipient_agent = 'finance-director' where job_id = v_kid;

  v_got := app.another_pair_of_eyes(v_c);
  if not coalesce((v_got ->> 'ok')::boolean, false) then
    raise exception '0561: it could not find anybody: %', v_got;
  end if;
  if (v_got ->> 'slug') = 'finance-director' then
    raise exception '0561: it picked the person already on it: %', v_got;
  end if;
  if coalesce(v_got ->> 'about', '') not like '%venue deposit%' then
    raise exception '0561: it lost the original obligation: %', v_got;
  end if;

  raise exception '0561 drive: nothing -> refuses; one on it -> names somebody else (%)',
    v_got ->> 'slug' using errcode = 'RS001';
exception when sqlstate 'RS001' then
  raise notice '0561 drive rolled back, as intended';
end
$drive$;
