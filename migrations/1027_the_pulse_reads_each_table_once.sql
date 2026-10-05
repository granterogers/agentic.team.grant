-- 1027 - the pulse reads each table once (efficiency run, 5 to 6 October 2026; NOT applied to production).
--
-- WHAT WAS MEASURED (replica seeded to production's 5 Oct shape; scripts/forensics/resource-probe.ts). Every open Team HQ tab asks
-- app.hq_pulse every twenty seconds (web/studio/pulse.js). One call: 53 ms, about 25,000 buffer hits, four sequential scans of
-- jobs/outputs/tasks-sized relations. The function asked ten questions of five tables and asked each table two or three times: jobs
-- three times (running count, done count, newest update), outputs twice (count, newest), tasks twice, inbound_commands twice. For an
-- office that owns nine tenths of every table an index cannot help, so each repeat was another full read.
--
-- WHAT CHANGED. Each table is read once and both answers come from that read (count(*) filter (...) and max(...) in one pass).
-- No index is added: this is a repeated-read defect, and a new index on the hottest-written table would cost every job state change.
--
-- WHAT DOES NOT CHANGE. Every key and value of the digest, from the same rows with the same predicates. Note the one asymmetry the
-- original has and this keeps: the outputs COUNT excludes fixture jobs while the outputs NEWEST-TIMESTAMP does not (it joins on
-- office only). The digest is compared whole by the page, so a value changing for a different reason would redraw it for no reason
-- or fail to redraw it; the proof compares the two byte for byte. Office isolation: the function still starts with
-- app.require_office(p_office) and every read is bound to p_office.
--
-- Proof: scripts/isolated/pulse-equivalence.ts. Roll back by re-applying the previous definition (create or replace; no data changed).

begin;

CREATE OR REPLACE FUNCTION app.hq_pulse(p_office uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_running   int;
  v_done      int;
  v_jobs_at   timestamptz;
  v_outputs   int;
  v_outs_at   timestamptz;
  v_open      int;
  v_tasks_at  timestamptz;
  v_docs      int;
  v_messages  int;
  v_msg_at    timestamptz;
  v_proj_at   timestamptz;
begin
  perform app.require_office(p_office);

  select count(*) filter (where state in ('running', 'queued'))::int,
         count(*) filter (where state = 'complete')::int,
         max(updated_at)
    into v_running, v_done, v_jobs_at
    from public.jobs where office_id = p_office and not is_fixture;

  -- The count leaves fixture jobs out; the newest-timestamp does not (it never did). One pass answers both.
  select count(*) filter (where not j.is_fixture)::int, max(o.created_at)
    into v_outputs, v_outs_at
    from public.outputs o join public.jobs j on j.job_id = o.job_id
   where j.office_id = p_office;

  select count(*) filter (where state in ('todo', 'doing', 'blocked'))::int, max(updated_at)
    into v_open, v_tasks_at
    from public.tasks where office_id = p_office and not is_fixture;

  select count(*)::int into v_docs from public.documents where office_id = p_office;

  select count(*)::int, max(received_at)
    into v_messages, v_msg_at
    from public.inbound_commands where office_id = p_office;

  select max(updated_at) into v_proj_at from public.projects where office_id = p_office;

  return jsonb_build_object(
    'at', app.now_utc(),
    /*
      The digest. Anything that changes what the studio DRAWS has to move one of
      these, and nothing else should -- a digest that changes when nothing
      visible did is a page that redraws for no reason, which is worse than a
      stale one because it interrupts.
    */
    'jobs_running', v_running,
    'jobs_done', v_done,
    'outputs', v_outputs,
    'tasks_open', v_open,
    'documents', v_docs,
    -- 0343. Something was SAID: a backfilled message makes no job and a button press makes none, so the conversation moves
    -- the digest by its own count.
    'messages', v_messages,
    -- The most recent moment anything the page shows was touched. Catches an edit that leaves every count identical -- a task
    -- renamed, a project given an icon -- which the counts alone cannot see.
    'latest', greatest(v_jobs_at, v_outs_at, v_tasks_at, v_proj_at, v_msg_at)
  );
end
$function$;

commit;
