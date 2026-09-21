-- 0542 — A job inherits whether it is real
--
-- 0541 stamps `inbound_commands.synthetic` from the door the work came
-- through. This carries that mark onto the JOB, which is what
-- `app.deliverable_to` actually asks about at send time.
--
-- ## Why a trigger rather than editing the creators
--
-- Eleven SQL functions insert into `public.jobs`. Two of them matter here —
-- `app.enqueue_inbound`, which turns a command into work, and
-- `app.enqueue_child`, which fans out — and splicing a new column into both
-- VALUES lists means rewriting two live functions for a fact that is purely
-- derivable from the row being inserted.
--
-- It is also strictly more robust. A future creator that follows either
-- convention is covered without anybody remembering, which is the failure
-- mode this whole run keeps finding: a rule learned at three call sites and
-- missed at three others.
--
-- ## The two conventions, read from the live definitions rather than assumed
--
--     enqueue_inbound   idempotency_key = format('inbound-%s', p_command_id)
--     enqueue_child     parent_job_id   = p_parent
--
-- So a job knows its lineage from its own columns: a child takes its
-- parent's mark, an inbound job takes its command's, and everything else
-- keeps the column default of false.
--
-- ## Why the default stays false, deliberately
--
-- The worker falls back to the Management API whenever its direct Postgres
-- connection is unavailable, and it calls several of those eleven creators.
-- Stamping a job by the connection it was created on would mean a degraded
-- worker silently stopped delivering Grant's real answers — a worse failure
-- than the one being fixed, and a silent one. Lineage cannot do that: it only
-- ever propagates a mark that a production door already refused to grant.

begin;

create or replace function app.job_inherits_synthetic()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_command uuid;
  v_mark boolean;
begin
  -- An explicit true is never softened. A caller that already knows this is
  -- synthetic outranks anything derived.
  if new.synthetic then
    return new;
  end if;

  if new.parent_job_id is not null then
    select j.synthetic into v_mark from public.jobs j where j.job_id = new.parent_job_id;
    if coalesce(v_mark, false) then
      new.synthetic := true;
    end if;
    return new;
  end if;

  -- app.enqueue_inbound composes this key. The uuid cast is guarded because
  -- the column is free text and a malformed key must not raise inside an
  -- insert -- a guard that breaks the write it protects is worse than no
  -- guard.
  if new.idempotency_key like 'inbound-%' then
    begin
      v_command := substring(new.idempotency_key from 9)::uuid;
    exception when others then
      return new;
    end;
    select c.synthetic into v_mark
      from public.inbound_commands c where c.command_id = v_command;
    if coalesce(v_mark, false) then
      new.synthetic := true;
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists jobs_inherit_synthetic on public.jobs;
create trigger jobs_inherit_synthetic
before insert on public.jobs
for each row execute function app.job_inherits_synthetic();

comment on function app.job_inherits_synthetic() is
  'Carry the synthetic mark onto a job from its lineage: a child from its '
  'parent, an inbound job from its command. Never from the connection, '
  'because a worker running degraded on the Management API fallback must not '
  'stop delivering real answers (0542).';

commit;
