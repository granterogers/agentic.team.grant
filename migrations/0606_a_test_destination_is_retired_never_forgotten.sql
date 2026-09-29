-- 0606 - A test destination is retired, never forgotten (#381).
--
-- public.test_destinations is the one sanctioned way for harness work to reach
-- an outside destination (0523): a suite registers the room it created, the
-- guard lets harness work reach exactly that room, and the suite removes the
-- row in teardown. Removing the row is the defect. On 29 September verify:slack
-- sent its end-to-end result to #zz_test_slack_81928391 while the channel was
-- registered, then deleted the registration, and the independent witness -
-- which reads registrations as they stand NOW - correctly reported a harness
-- send to an unregistered destination (delivery 454f2ea2). The send was
-- allowed; the evidence of why was the thing the suite threw away.
--
-- So a registration now has a lifecycle, ACTIVE -> RETIRED, and no DELETE:
--
--   retired_at                   null while active; set once, never unset.
--   app.retire_test_destination  the teardown. Idempotent: a second call
--                                changes nothing and says so (0).
--   app.test_destination_at      was this destination registered at this
--                                instant? What the witness asks of history.
--   the guard                    app.delivery_refusal and app.deliverable_to
--                                honour ACTIVE registrations only, so a retry
--                                after teardown, or any descendant of the
--                                run, is refused like any other harness send.
--
-- A retired row cannot be re-registered either: the primary key holds it, and
-- the suites' `on conflict do nothing` leaves it retired. Fixture ids are
-- minted per run, so two runs never share a row.
--
-- The historical send cannot be reconstructed - its registration no longer
-- exists and inventing one would be writing evidence after the fact. It is
-- acknowledged in public.known_escapes, the table 0583 made for exactly this,
-- so the witness can say "known, none new". Nothing in public.deliveries is
-- touched.

alter table public.test_destinations
  add column if not exists retired_at timestamptz;

alter table public.test_destinations
  drop constraint if exists test_destinations_retired_after_registered;
alter table public.test_destinations
  add constraint test_destinations_retired_after_registered
  check (retired_at is null or retired_at >= created_at);

comment on column public.test_destinations.retired_at is
  'When the run that registered this destination finished with it (#381). '
  'Null while active. Set once by app.retire_test_destination and never '
  'unset; the row is kept so the witness can tell a send that was allowed at '
  'the time from one that never was.';

-- The not-a-real-destination check is about REGISTERING a destination, so it
-- runs on insert only. On update it would count the run's own job-less test
-- sends as real deliveries and refuse the retirement.
drop trigger if exists test_destinations_not_real on public.test_destinations;
create trigger test_destinations_not_real
  before insert on public.test_destinations
  for each row execute function app.test_destination_is_not_real();

create or replace function app.test_destinations_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  if tg_op = 'DELETE' then
    raise exception 'test_destinations is evidence: retire % % with app.retire_test_destination, never delete it (#381)',
      old.channel, old.target_ref;
  end if;
  if new.channel is distinct from old.channel
     or new.target_ref is distinct from old.target_ref
     or new.why is distinct from old.why
     or new.created_at is distinct from old.created_at then
    raise exception 'test_destinations: a registration is written once; only its retirement may be recorded (#381)';
  end if;
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then
    raise exception 'test_destinations: % % is retired and stays retired (#381)', old.channel, old.target_ref;
  end if;
  return new;
end
$f$;

drop trigger if exists test_destinations_lifecycle on public.test_destinations;
create trigger test_destinations_lifecycle
  before update or delete on public.test_destinations
  for each row execute function app.test_destinations_lifecycle();

create or replace function app.retire_test_destination(p_channel text, p_target_ref text)
returns integer
language sql
security definer
set search_path = ''
as $f$
  with r as (
    update public.test_destinations set retired_at = app.now_utc()
     where channel = p_channel and target_ref = p_target_ref and retired_at is null
    returning 1)
  select count(*)::int from r
$f$;

create or replace function app.test_destination_at(p_channel text, p_target_ref text, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select exists (
    select 1 from public.test_destinations t
     where t.channel = p_channel and t.target_ref = p_target_ref
       and t.created_at <= p_at
       and (t.retired_at is null or t.retired_at > p_at))
$f$;

revoke execute on function app.retire_test_destination(text, text) from public;

-- 0603's policy, with the test-destination branch asking for an ACTIVE row.
-- Everything else unchanged.
create or replace function app.delivery_refusal(
  p_job_id uuid, p_dedupe_key text, p_channel text, p_target_ref text)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref
                    and t.retired_at is null) then null
    when p_job_id is null then
      case when exists (select 1 from public.operator_senders s
                         where s.namespace = split_part(coalesce(p_dedupe_key, ''), ':', 1))
           then null
           else 'no provenance: a delivery must name its job or a registered operator sender'
      end
    when not exists (select 1 from public.jobs j where j.job_id = p_job_id) then
      'no provenance: the job this delivery names does not exist'
    else
      case app.job_origin(p_job_id)
        when 'harness' then 'harness traffic may not reach a production destination'
        when 'unknown' then 'unknown origin: no production door or office process made this work'
        else null
      end
  end
$f$;

create or replace function app.deliverable_to(p_job_id uuid, p_channel text, p_target_ref text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $f$
  select case
    when exists (select 1 from public.test_destinations t
                  where t.channel = p_channel and t.target_ref = p_target_ref
                    and t.retired_at is null) then true
    when p_job_id is null then false
    else app.may_act_outside(p_job_id)
  end
$f$;

-- The escape count: a harness send to a destination that was registered for
-- tests WHEN THE GUARD DECIDED (the delivery's creation) is not an escape.
-- Everything else as it was.
create or replace function app.harness_escapes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with out as (
    select d.delivery_id, d.channel, d.target_ref, d.sent_at, j.requested_by,
           k.issue, k.why
      from public.deliveries d
      join public.jobs j on j.job_id = d.job_id
      left join public.known_escapes k on k.delivery_id = d.delivery_id
     where app.harness_job(d.job_id)
       and d.sent_at is not null
       and d.created_at > app.harness_guard_since()
       and not app.test_destination_at(d.channel::text, d.target_ref, d.created_at)
  )
  select jsonb_build_object(
    'since', app.harness_guard_since(),
    'escaped', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at,
               'known', o.issue is not null, 'issue', o.issue)
               order by o.sent_at desc) from out o), '[]'::jsonb),
    'known', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at,
               'issue', o.issue, 'why', o.why)
               order by o.sent_at desc) from out o where o.issue is not null), '[]'::jsonb),
    'new', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at)
               order by o.sent_at desc) from out o where o.issue is null), '[]'::jsonb),
    'refused', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id)
         and d.state = 'suppressed'
         and d.suppressed_reason like '%production destination%'
         and d.created_at > app.harness_guard_since()), 0),
    'before_the_guard', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id) and d.sent_at is not null
         and d.created_at <= app.harness_guard_since()), 0))
$function$;

-- The 29 September acceptance send, accounted for rather than removed.
insert into public.known_escapes (delivery_id, issue, why, acknowledged_at)
select d.delivery_id,
       '#381',
       'RC2 production acceptance, 29 September: verify:slack''s end-to-end '
       || 'result in #zz_test_slack_81928391, a channel it had registered as a '
       || 'test destination and whose registration its teardown then DELETED, '
       || 'so the send could no longer be reconciled. The provisioner had also '
       || 'invited Grant into that channel. 0606 retires registrations instead '
       || 'of deleting them; the fixture channel no longer invites anybody.',
       app.now_utc()
  from public.deliveries d
 where d.delivery_id = '454f2ea2-63b1-4345-a3db-d324e6a3bad2'
   and not exists (select 1 from public.known_escapes k where k.delivery_id = d.delivery_id);

/* Driven, in a subtransaction that always rolls back. */
do $proof$
declare
  v_t text := '-7' || lpad((floor(random() * 1e14))::bigint::text, 15, '0');
  v_ok boolean;
  v_n int;
  v_at timestamptz;
begin
  begin
    insert into public.test_destinations (channel, target_ref, why)
    values ('telegram', v_t, 'migration 0606 proof, rolled back');
    select created_at into v_at from public.test_destinations where channel = 'telegram' and target_ref = v_t;
    if app.delivery_refusal(null, 'x:y', 'telegram', v_t) is not null then
      raise exception '0606 proof: an active destination was refused';
    end if;
    -- The clock is the transaction's, so a retirement "later" is simulated by
    -- asking about an instant after it, which is what the witness does.
    if app.retire_test_destination('telegram', v_t) <> 1 then raise exception '0606 proof: retire'; end if;
    if app.retire_test_destination('telegram', v_t) <> 0 then raise exception '0606 proof: retire is not idempotent'; end if;
    if app.delivery_refusal(null, 'x:y', 'telegram', v_t) is null then
      raise exception '0606 proof: a retired destination still permits sends';
    end if;
    if app.deliverable_to(null, 'telegram', v_t) then raise exception '0606 proof: deliverable_to'; end if;
    begin
      update public.test_destinations set retired_at = null where channel = 'telegram' and target_ref = v_t;
      raise exception '0606 proof: un-retired';
    exception when others then if sqlerrm not like '%stays retired%' then raise; end if;
    end;
    begin
      delete from public.test_destinations where channel = 'telegram' and target_ref = v_t;
      raise exception '0606 proof: deleted';
    exception when others then if sqlerrm not like '%never delete%' then raise; end if;
    end;
    insert into public.test_destinations (channel, target_ref, why)
    values ('telegram', v_t, 'migration 0606 proof, re-register') on conflict do nothing;
    select count(*) filter (where retired_at is null) into v_n from public.test_destinations
     where channel = 'telegram' and target_ref = v_t;
    if v_n <> 0 then raise exception '0606 proof: a retired destination was re-activated'; end if;
    v_ok := not app.test_destination_at('telegram', v_t, v_at - interval '1 second');
    if not v_ok then raise exception '0606 proof: registered before it existed'; end if;
    if not exists (select 1 from public.known_escapes where delivery_id = '454f2ea2-63b1-4345-a3db-d324e6a3bad2')
       and exists (select 1 from public.deliveries where delivery_id = '454f2ea2-63b1-4345-a3db-d324e6a3bad2') then
      raise exception '0606 proof: the acceptance send is not acknowledged';
    end if;
    raise exception 'rollback-0606-proof';
  exception when others then
    if sqlerrm <> 'rollback-0606-proof' then raise; end if;
  end;
end
$proof$;
