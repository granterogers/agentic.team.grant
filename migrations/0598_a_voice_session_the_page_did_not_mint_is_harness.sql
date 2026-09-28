-- 0598 — A voice session the page did not mint is harness (#354, ledger R37).
--
-- `/voice/turn` is a production door. A turn posted to it is `voice:grant`,
-- `synthetic` is false (it IS a production request), and its project is real,
-- so the only signal left is the SESSION id in the dedupe key
-- (`voice:turn:<session>.<n>`). `app.harness_label` recognises a `verify-`
-- label there (0583) and nothing else, so every harness that named its session
-- anything else was answered and DELIVERED to Grant's real Telegram and Slack:
--
--     scenario-a-<run>   verify:scenario-a       36 deliveries, 8-24 Sep
--     deploy<ms>         deploy:voice probes     18
--     probe<ms>, uxfix1  hand probes              6
--
-- and `check:leaks` said "0 new" throughout, because it asks this predicate.
--
-- The production callers of this door can be enumerated completely: the
-- dashboard chat (`web/studio/chat.js`) and the call (`web/studio/call.js`),
-- and both mint `'s' + Math.random().toString(36).slice(2, 12)`. So on THIS
-- door deny-by-default is safe in a way it is not elsewhere: a session that is
-- not that shape was not minted by a page Grant uses. `npm run
-- check:voice-sessions` pins the premise from the other side, and fails if
-- either page stops minting it.
--
-- The expensive direction is suppressing a real turn of his. The drive below
-- asserts that every page-shaped session on record stays real.

create or replace function app.harness_voice_session(p_key text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(p_key, '') like 'voice:turn:%'
     and split_part(split_part(p_key, ':', 3), '.', 1) !~ '^s[a-z0-9]{1,10}$'
$$;

comment on function app.harness_voice_session(text) is
  'A voice:turn dedupe key whose session was not minted by the dashboard page '
  '(''s'' + base36, up to 10). Premise pinned by npm run check:voice-sessions. 0598.';

create or replace function app.harness_job(p_job_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    (select j.synthetic or j.is_fixture or coalesce(p.is_fixture, false)
              or (j.pinned_config ->> 'origin_namespace') = 'verify'
              or exists (
                   select 1 from public.inbound_commands c
                    where c.command_id = (j.pinned_config ->> 'command_id')::uuid
                      and (app.harness_label(c.dedupe_key)
                           or app.harness_voice_session(c.dedupe_key)))
              /*
                And work that harness work started (completion pass, R37). A
                child carries no command of its own and inherits only
                `synthetic` and `requested_by`, so a parent that is harness by
                its dedupe key alone - the voice-session shape above - had
                children that read as Grant's and could deliver. The isolated
                containment proof found it; production held none yet.
              */
              or (j.parent_job_id is not null and app.harness_job(j.parent_job_id))
       from public.jobs j
       left join public.projects p on p.project_id = j.project_id
      where j.job_id = p_job_id),
    false)
$function$;

-- Counted before, so the check below asserts that evidence was only ever
-- ADDED. Not a fixed number: on a fresh database there is none, and a floor
-- written against production's count would stop every clean install.
create temp table _0598_known_before on commit drop as
  select count(*)::int as n from public.known_escapes;

-- The evidence, kept: what the widened predicate can now see was delivered is
-- acknowledged, never removed, so the witness can say "N known, 0 new".
insert into public.known_escapes (delivery_id, issue, why, acknowledged_at)
select d.delivery_id,
       '#354',
       'invisible to app.harness_job until 0598: a script posted to the live '
       || '/voice/turn door with a session not named verify- (scenario-a-, '
       || 'deploy<ms>, uxfix1), and only the session could mark it harness.',
       app.now_utc()
  from public.deliveries d
 where app.harness_job(d.job_id)
   and d.sent_at is not null
   and d.created_at > app.harness_guard_since()
   and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id);

do $$
declare
  v_page_real int;
  v_page_harness int;
  v_named int;
  v_new int;
begin
  -- The expensive direction: no page-minted session became harness by 0598.
  select count(*) filter (where not app.harness_voice_session(c.dedupe_key)),
         count(*) filter (where app.harness_voice_session(c.dedupe_key))
    into v_page_real, v_page_harness
    from public.inbound_commands c
   where c.dedupe_key ~ '^voice:turn:s[a-z0-9]{1,10}\.';
  -- Zero page sessions is a fresh database, not a failure: the pure-function
  -- controls below are what prove the predicate can tell the two apart.
  if v_page_harness > 0 then
    raise exception 'page sessions: % real, % harness — 0598 would silence his page', v_page_real, v_page_harness;
  end if;

  -- The positive: the shapes that escaped are harness now.
  select count(*) into v_named from public.inbound_commands c
   where c.dedupe_key ~ '^voice:turn:(scenario-a-|deploy|uxfix)'
     and not app.harness_voice_session(c.dedupe_key);
  if v_named > 0 then
    raise exception '% escaping voice turn(s) still read as real', v_named;
  end if;

  -- Controls on the pure function itself.
  if app.harness_voice_session('telegram:123:456') or app.harness_voice_session(null)
     or app.harness_voice_session('voice:turn:s9czo3u0fw2.3')
     or not app.harness_voice_session('voice:turn:deploy1790157906882.1') then
    raise exception 'harness_voice_session controls failed';
  end if;

  select coalesce(jsonb_array_length(app.harness_escapes() -> 'new'), 0)
    into v_new;
  if v_new > 0 then
    raise exception '% escape(s) unaccounted for', v_new;
  end if;
  if (select count(*) from public.known_escapes) < (select n from _0598_known_before) then
    raise exception 'known escapes fell below what was recorded before 0598, so evidence was lost';
  end if;
end $$;
