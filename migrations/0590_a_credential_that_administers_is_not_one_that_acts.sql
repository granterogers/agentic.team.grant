-- #363. Every agent was told it cannot post to Slack while it was posting.
--
-- `app.capability_index_core` builds the reach list that goes into EVERY
-- agent's prompt on EVERY turn. It takes one `connection_health` row per
-- service, ordered worst-state-first, so the unhealthiest credential speaks
-- for the whole service. Slack has two credentials doing different jobs:
--
--   bot token          ok    -- what messages are carried on
--   config token (12h) dead  -- how the app is administered
--
-- So the service read `reachable = false` from 18 September onwards while
-- 268 Slack messages went out, 11 of them the day this was fixed. That is
-- 0298's defect with the sign reversed, and this repository already records
-- which direction is expensive: a false NO produces nothing at all, and
-- `capabilityLies` cannot catch the false denial because, given the index,
-- the denial is true.
--
-- ## Worst-state-wins is right, and it is right somewhere else
--
-- `app.project_connections` says so in its own comment -- "so one dead
-- credential is not hidden by a healthy row beside it" -- and for a surface
-- REPORTING health to Grant that is correct and stays. `app.hq_connections`,
-- `app.project_connections` and `app.chores_for_credentials` are untouched:
-- the dead config token is a real problem and he must keep seeing it.
--
-- What changes is only the reader that tells an AGENT what it can do, where
-- the question is not "is anything wrong with this service" but "is the
-- credential the office acts through alive".
--
-- ## The distinction is the repository's own, not an invention
--
--   src/slack/rotation.ts:158  "the config token is how the app is administered"
--   src/handlers/slack-rotation.ts  "rotating a credential is maintenance"
--   src/handlers/slack-rotation.ts  "the existing access token keeps working"
--
-- The last one is the whole finding stated in advance: the repository already
-- knew a dead config token does not stop posting, and nothing carried that
-- across to the index.
--
-- ## Why this cannot manufacture a false yes
--
-- `purpose` defaults to 'acts', so every row that exists today keeps exactly
-- the meaning it had and no service becomes reachable by being reclassified.
-- And the preference is expressed as an ORDER BY rather than a WHERE, so a
-- service whose every credential is marked 'maintains' still surfaces its
-- worst row instead of matching nothing and falling through `coalesce(state,
-- 'ok')` to reachable. A filter there would be the found-nothing shape that
-- this repository has recorded four times, on the one surface where it would
-- read as success.

alter table public.connection_health
  add column if not exists purpose text not null default 'acts';

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'connection_health_purpose_known') then
    alter table public.connection_health
      add constraint connection_health_purpose_known
      check (purpose in ('acts', 'maintains'));
  end if;
end $c$;

comment on column public.connection_health.purpose is
  'What this credential is FOR. ''acts'': the office carries work on it, so its '
  'death denies the capability. ''maintains'': it administers or renews the '
  'connection, so its death is an operational problem for Grant and NOT a '
  'statement about what the office can do. Defaults to ''acts'' because that is '
  'the conservative reading: an unclassified credential keeps its old meaning. '
  'Only app.capability_index_core reads it -- the surfaces that report health to '
  'Grant still take the worst row of the service, deliberately (#363).';

-- The one credential the evidence classifies. Slack's config token rotates the
-- app's administration pair; the bot token is what messages ride on, and the
-- rotation handler states in its own header that a failed rotation leaves the
-- access token working.
update public.connection_health
   set purpose = 'maintains'
 where service = 'Slack' and credential = 'config token (12h)';

-- Splice the two orderings in app.capability_index_core from its LIVE
-- definition rather than transcribing 4,000 characters of a function this
-- migration changes two lines of.
do $splice$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'capability_index_core';
  if v_src is null then raise exception '0590: app.capability_index_core is missing'; end if;

  -- the knowledge-connector lateral
  v_old := 'order by case ch.state when ''dead'' then 0 when ''missing'' then 1';
  v_new := 'order by (ch.purpose = ''maintains''), case ch.state when ''dead'' then 0 when ''missing'' then 1';
  if position(v_old in v_src) = 0 then raise exception '0590: connector ordering not found'; end if;
  v_src := replace(v_src, v_old, v_new);

  -- the Slack/Telegram surfaces branch
  v_old := 'order by c.service,'
        || E'\n                case c.state when ''dead'' then 0 when ''missing'' then 1';
  v_new := 'order by c.service, (c.purpose = ''maintains''),'
        || E'\n                case c.state when ''dead'' then 0 when ''missing'' then 1';
  if position(v_old in v_src) = 0 then raise exception '0590: surfaces ordering not found'; end if;
  v_src := replace(v_src, v_old, v_new);

  execute v_src;
end $splice$;

-- Drive it. Reading a migration proves it parses.
do $drive$
declare
  v_reach jsonb;
  v_slack boolean;
  v_tg boolean;
  v_before boolean;
begin
  v_reach := app.capability_index_core() -> 'reach';

  select (r ->> 'reachable')::boolean into v_slack
    from jsonb_array_elements(v_reach) r where r ->> 'service' = 'Slack';
  select (r ->> 'reachable')::boolean into v_tg
    from jsonb_array_elements(v_reach) r where r ->> 'service' = 'Telegram';

  if v_slack is distinct from true then
    raise exception '0590: Slack still reads unreachable on a live bot token';
  end if;
  if v_tg is distinct from true then
    raise exception '0590: Telegram moved, and this migration must not touch it';
  end if;

  -- A maintaining credential must not be able to make a service reachable on
  -- its own: kill the bot token inside a subtransaction and the answer must
  -- flip, or the ORDER BY is preferring a healthy maintenance row over a dead
  -- acting one. This is the control that stops the fix from becoming a
  -- blanket "ignore dead credentials".
  begin
    update public.connection_health set state = 'dead'
     where service = 'Slack' and credential = 'bot token';
    select (r ->> 'reachable')::boolean into v_before
      from jsonb_array_elements(app.capability_index_core() -> 'reach') r
     where r ->> 'service' = 'Slack';
    raise exception 'CONTROL:%', coalesce(v_before::text, 'absent');
  exception when others then
    if SQLERRM = 'CONTROL:false' then
      null;                                   -- the acting credential decides
    elsif SQLERRM like 'CONTROL:%' then
      raise exception '0590: a dead ACTING credential still read reachable (%) '
                      '-- the ordering prefers maintenance rows', SQLERRM;
    else
      raise;
    end if;
  end;

  -- And a service whose every credential is marked 'maintains' must still
  -- surface its worst row rather than matching nothing and falling through to
  -- reachable. This is the found-nothing control: the ORDER BY earns its
  -- place over a WHERE here, and nothing else in the suite would catch it.
  begin
    update public.connection_health set purpose = 'maintains', state = 'dead'
     where service = 'Slack';
    select (r ->> 'reachable')::boolean into v_before
      from jsonb_array_elements(app.capability_index_core() -> 'reach') r
     where r ->> 'service' = 'Slack';
    raise exception 'NOACTING:%', coalesce(v_before::text, 'absent');
  exception when others then
    if SQLERRM = 'NOACTING:false' then
      null;                                   -- the worst row still speaks
    elsif SQLERRM = 'NOACTING:absent' then
      raise exception '0590: with no acting credential the service vanished '
                      'from the reach list instead of reporting its worst row';
    elsif SQLERRM like 'NOACTING:%' then
      raise exception '0590: with every credential dead and marked maintains, '
                      'Slack still read reachable (%)', SQLERRM;
    else
      raise;
    end if;
  end;
end $drive$;
