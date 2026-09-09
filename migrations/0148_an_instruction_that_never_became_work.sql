-- An instruction that never became work.
--
-- Grant: *"I need any messages that I send either in Telegram or in Slack to
-- be responded to within, say, a minute."* Slack was not slow. Slack was
-- silent: the events function stored the canonical command and never called
-- `enqueue_inbound`, so a message typed in the office was filed and nothing
-- ever picked it up. Thirty of them, going back three days.
--
-- The Telegram webhook has made that call since 0072 and the voice endpoint
-- since 0102. Slack — the surface §12 actually calls "the office" — never did,
-- and nothing noticed because a filed command looks exactly like a handled one
-- unless you join it to `jobs`.
--
-- The webhook now calls it. This is the other half.
--
-- ## Why a sweep as well as the fix
--
-- Because the fix is one call in one function, and the defect was one call
-- missing from one function. Three adapters each remembering to enqueue is
-- three chances to forget, and the third one forgot for three days.
--
-- So: a floor. Any inbound instruction with no job after a minute gets one.
-- The webhook stays the fast path — Grant's minute depends on it — and this
-- guarantees the work happens at all. Same shape as `recover_stalled_jobs`
-- beside the lease, and `resume_paused` beside the handler check (0147).
--
-- ## Why a minute
--
-- Long enough that it never races the webhook's own enqueue, short enough that
-- a dropped one costs a minute rather than a morning.

begin;

create or replace function app.enqueue_orphans()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, app, public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select c.command_id
      from public.inbound_commands c
     where c.job_id is null
       -- An instruction, not a reaction, a join notice or a button press.
       -- Those are canonical commands too and none of them is work; presses
       -- go through processCallbacks at the top of every pass.
       and coalesce(trim(c.instruction), '') <> ''
       and c.callback_action is null
       and c.received_at > app.now_utc() - interval '24 hours'
       and c.received_at < app.now_utc() - interval '1 minute'
     order by c.received_at
     limit 20
  loop
    begin
      perform app.enqueue_inbound(r.command_id);
      v_count := v_count + 1;
    exception when others then
      -- One command that cannot be enqueued must not stop the rest. The next
      -- pass tries again; after 24 hours it stops trying, because a command
      -- that has failed for a day needs a person rather than a retry.
      null;
    end;
  end loop;
  return v_count;
end
$$;

comment on function app.enqueue_orphans() is
  'Turn inbound instructions that never became jobs into jobs. A floor under '
  'the adapters, not a replacement for them: the webhook enqueueing directly '
  'is what makes a reply arrive in seconds, and this is what makes it arrive '
  'at all. Bounded to the last 24 hours — older than that needs a person.';

grant execute on function app.enqueue_orphans() to ai_team_app, service_role;

create or replace function public.enqueue_orphans()
returns integer language sql security definer set search_path = public, pg_catalog
as $$ select app.enqueue_orphans() $$;

revoke all on function public.enqueue_orphans() from public;
grant execute on function public.enqueue_orphans() to service_role;

commit;
