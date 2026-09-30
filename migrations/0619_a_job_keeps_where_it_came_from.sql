/*
  0619 - a job keeps where it came from (Run 4, durable origin)

  WHAT WAS WRONG (reproduced on the isolated replica, and read from production)

  Where a job came from was never RECORDED. `app.job_origin` re-derived it at every read by walking up
  `parent_job_id` to the root and asking whether the root's `pinned_config` mentioned a `command_id`, and
  whether that command still existed. Three consequences:

    D1  the mere PRESENCE of `command_id` in a root's config decided trust. A duty or trigger root whose config
        carried a real Telegram command's id read as `trusted`, whatever `requested_by` said. Not reachable from
        the public surface (both tables are operator tables), but nothing checked that the job was MADE the way
        `app.enqueue_inbound` makes one.
    D2  the command row was the only durable evidence of a job's channel, and rows of that table are deleted by
        suite teardown. 68 real roots on production had already lost it and read `unknown`, with `requested_by`
        still saying `telegram:grant`. A fact frozen at the wrong moment: it should have been taken when the
        command was known to exist, and kept.
    D5  the CAUSE of a job (a person's message, a delegated child, an approval, a duty, a trigger) survived only
        as the prefix of an idempotency key, and `child-<kind>-<random uuid>` carries no cause at all. There was
        no root column either, so "which job began all this" was a recursive walk.

  WHAT THIS DOES

  Five columns, written ONCE at insert by one trigger and never changed (a second trigger refuses any change):

    root_job_id         the job that began the tree (itself, for a root). A structural fact, so it is also
                        backfilled for every existing row.
    origin_kind         why the job exists: inbound | child | obligation | approved | duty | trigger | mcp | system
    origin_class        the trust of the ROOT, taken at creation: trusted | harness | unknown. Null for a root
                        the office made itself (a duty, a trigger, a connector); those keep being answered by
                        `app.internal_root_ok`, which reads what the office is configured to do.
    origin_command_id   the inbound command that began the tree - recorded ONLY when the job is exactly what
                        `app.enqueue_inbound` makes: idempotency key `inbound-<command>` and a `requested_by`
                        that begins with that command's channel. A `command_id` merely present in a config is
                        not evidence of anything.
    origin_channel      the command's channel, taken at the same moment.

  A child copies these from its parent, so a delegation cannot change what its root was. It cannot be MORE
  trusted than the tree it hangs from, because there is nowhere to state a different class.

  `app.job_origin` reads the stored class for any job created from now on. A job created before this migration
  has `origin_kind` null and is answered exactly as before (the legacy branch is the old function, unchanged):
  nothing is upgraded, nothing is manufactured. The BACKFILL stamps only what is unambiguous - a root whose key
  is `inbound-<command>`, whose command still exists and whose `requested_by` matches - which is precisely the
  case the old function already answered `trusted` or `harness`, now frozen so a later delete cannot move it.
  Everything else stays legacy and keeps its answer.

  WHAT THIS DOES NOT DO (kept honest)

  It does not make a duty ask Grant. Who is asking when no human began the job is answered here - `origin_kind`
  says `duty`, `trigger` or `system` and no principal is invented - but whether such an action should be
  ASKED, or covered by a standing authorization, is #389 and is his decision.

  Compatibility: an old worker reading the new schema ignores the columns and the function keeps answering
  (an old `job_origin` body is replaced by this one in the same migration, and both agree on legacy rows). A new
  worker on the old schema never sees this function change. Rollback is at the foot of this file.
*/

alter table public.jobs
  add column if not exists root_job_id uuid references public.jobs (job_id),
  add column if not exists origin_kind text,
  add column if not exists origin_class text,
  add column if not exists origin_command_id uuid,
  add column if not exists origin_channel text;

alter table public.jobs drop constraint if exists jobs_origin_kind_known;
alter table public.jobs add constraint jobs_origin_kind_known check (
  origin_kind is null
  or origin_kind in ('inbound', 'child', 'obligation', 'approved', 'duty', 'trigger', 'mcp', 'system'));

alter table public.jobs drop constraint if exists jobs_origin_class_known;
alter table public.jobs add constraint jobs_origin_class_known check (
  origin_class is null or origin_class in ('trusted', 'harness', 'unknown'));

-- A recorded command is recorded together with its channel, and only for a job that says why it exists.
alter table public.jobs drop constraint if exists jobs_origin_command_has_channel;
alter table public.jobs add constraint jobs_origin_command_has_channel check (
  (origin_command_id is null) = (origin_channel is null));

/* ---- the trigger that records it ----------------------------------------------------------------------- */

create or replace function app.jobs_stamp_origin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  p public.jobs;
  c public.inbound_commands;
  v_cmd uuid;
  v_class text;
begin
  if new.root_job_id is null then
    new.root_job_id := coalesce(
      (select j.root_job_id from public.jobs j where j.job_id = new.parent_job_id),
      new.parent_job_id, new.job_id);
  end if;
  -- A caller cannot name its own origin: the columns are the trigger's to write.
  new.origin_kind := null; new.origin_class := null;
  new.origin_command_id := null; new.origin_channel := null;

  if new.parent_job_id is not null then
    select * into p from public.jobs where job_id = new.parent_job_id;
    -- The root of a tree decides. A parent from before this migration has nothing stored, so the answer the
    -- office would have given for it a moment ago is what the child records - and only ever downwards:
    -- inference can say trusted, harness or unknown, never something the tree did not already have.
    new.origin_kind := case
      when new.idempotency_key like 'obl-%' then 'obligation'
      when new.idempotency_key like 'approved-%' then 'approved'
      else 'child' end;
    if p.origin_kind is not null then
      new.origin_class := p.origin_class;
      new.origin_command_id := p.origin_command_id;
      new.origin_channel := p.origin_channel;
    else
      v_class := app.job_origin(p.job_id);
      new.origin_class := case when v_class in ('trusted', 'harness') then v_class
                               when v_class = 'internal' then null else 'unknown' end;
    end if;
    return new;
  end if;

  -- A root. An inbound turn is exactly what app.enqueue_inbound makes: its key, and its principal.
  if new.idempotency_key like 'inbound-%' then
    begin
      v_cmd := substring(new.idempotency_key from 9)::uuid;
    exception when others then
      v_cmd := null;
    end;
    if v_cmd is not null then
      select * into c from public.inbound_commands where command_id = v_cmd;
      if found and new.requested_by like c.origin_channel::text || ':%' then
        new.origin_kind := 'inbound';
        new.origin_command_id := c.command_id;
        new.origin_channel := c.origin_channel::text;
        new.origin_class := app.command_origin(c.command_id);
        if new.origin_class not in ('trusted', 'harness') then new.origin_class := 'unknown'; end if;
        return new;
      end if;
    end if;
    -- It says it is an inbound turn and is not one the office can find: recorded as such, and unknown.
    new.origin_kind := 'inbound';
    new.origin_class := 'unknown';
    return new;
  end if;

  new.origin_kind := case
    when new.requested_by like 'duty:%' then 'duty'
    when new.requested_by like 'trigger:%' then 'trigger'
    when new.requested_by like 'mcp:%' then 'mcp'
    else 'system' end;
  -- origin_class stays null: an office-made root is 'internal' only while what made it is still configured
  -- (app.internal_root_ok), and 'unknown' otherwise. A pinned command_id in its config is NOT read.
  return new;
end;
$fn$;

drop trigger if exists jobs_stamp_origin on public.jobs;
create trigger jobs_stamp_origin before insert on public.jobs
  for each row execute function app.jobs_stamp_origin();

/* ---- backfill: only what is unambiguous ----------------------------------------------------------------- */

/*
  root_job_id is structural, so every row gets it. The immutability trigger is not yet in force for a row whose
  root is still null (the rule above lets the first write through), and the recursive walk is bounded by the
  same 64 as app.job_origin.
*/
-- The backfill is not an event in a job's life: updated_at is left alone.
alter table public.jobs disable trigger jobs_touch_updated_at;

with recursive up as (
  select j.job_id as leaf, j.job_id, j.parent_job_id, 0 as depth from public.jobs j
  union all
  select up.leaf, p.job_id, p.parent_job_id, up.depth + 1
    from up join public.jobs p on p.job_id = up.parent_job_id where up.depth < 64
),
roots as (select leaf, job_id as root from up where parent_job_id is null)
update public.jobs j set root_job_id = r.root from roots r where r.leaf = j.job_id and j.root_job_id is null;

/*
  A legacy ROOT is stamped only when it is provably what enqueue_inbound makes and its command still exists.
  That is the case app.job_origin already answered from the command row; freezing it protects it from a later
  delete. A root that fails any test is left with origin_kind null and keeps its old answer.
*/
update public.jobs j
   set origin_kind = 'inbound',
       origin_command_id = c.command_id,
       origin_channel = c.origin_channel::text,
       origin_class = case when app.command_origin(c.command_id) in ('trusted', 'harness')
                           then app.command_origin(c.command_id) else 'unknown' end
  from public.inbound_commands c
 where j.parent_job_id is null
   and j.origin_kind is null
   and j.idempotency_key = 'inbound-' || c.command_id::text
   and j.requested_by like c.origin_channel::text || ':%';

alter table public.jobs enable trigger jobs_touch_updated_at;

/* ---- and never changed ----------------------------------------------------------------------------------- */

create or replace function app.jobs_origin_is_immutable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.root_job_id is distinct from old.root_job_id and old.root_job_id is not null
     or new.origin_kind is distinct from old.origin_kind
     or new.origin_class is distinct from old.origin_class
     or new.origin_command_id is distinct from old.origin_command_id
     or new.origin_channel is distinct from old.origin_channel then
    raise exception 'the origin of job % is written once, when it is created, and cannot be changed', old.job_id
      using errcode = '23514',
            hint = 'A retry, a delegation or an approval is the same work with the same origin.';
  end if;
  return new;
end;
$fn$;

drop trigger if exists jobs_origin_immutable on public.jobs;
create trigger jobs_origin_immutable before update on public.jobs
  for each row execute function app.jobs_origin_is_immutable();

/* ---- the reader -------------------------------------------------------------------------------------------- */

create or replace function app.job_origin(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  with recursive up as (
    select j.job_id, j.parent_job_id, j.pinned_config, j.origin_kind, j.origin_class, 0 as depth
      from public.jobs j where j.job_id = p_job_id
    union all
    select p.job_id, p.parent_job_id, p.pinned_config, p.origin_kind, p.origin_class, up.depth + 1
      from up join public.jobs p on p.job_id = up.parent_job_id
     where up.depth < 64
  ),
  root as (select * from up where parent_job_id is null order by depth desc limit 1)
  select case
    when not exists (select 1 from up) then 'unknown'
    when app.harness_job(p_job_id) then 'harness'
    when not exists (select 1 from root) then 'unknown'      -- a chain that never ends
    -- Made after 0619: what was recorded when it was created (a child carries its tree's class from that
    -- moment, so a legacy root that later loses its command does not take a frozen child down with it).
    -- A pinned command_id is not read.
    when (select origin_kind from up where depth = 0) is not null then
      case
        when (select origin_class from up where depth = 0) is not null then (select origin_class from up where depth = 0)
        when app.internal_root_ok((select job_id from root)) then 'internal'
        else 'unknown'
      end
    -- Made before 0619: exactly as it was answered before, and no more.
    when (select pinned_config ? 'command_id' from root) then
      app.command_origin((select (pinned_config ->> 'command_id')::uuid from root))
    when app.internal_root_ok((select job_id from root)) then 'internal'
    else 'unknown'
  end
$fn$;

revoke all on function app.jobs_stamp_origin() from public, anon, authenticated;
revoke all on function app.jobs_origin_is_immutable() from public, anon, authenticated;

/*
  ROLLBACK (verified on the replica): drop trigger jobs_origin_immutable and jobs_stamp_origin, restore the
  previous app.job_origin body (the legacy branch above, verbatim), then drop the five columns and the three
  constraints. Nothing else reads them.
*/
