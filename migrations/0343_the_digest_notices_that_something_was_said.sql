begin;

/**
 * The digest notices that something was said.
 *
 * Issue #199. `hq_pulse` (0262) is how the studio knows the office moved
 * without holding a second credential — the page asks a cheap question every
 * twenty seconds and refetches only when the answer differs.
 *
 * Its own comment sets the rule: "anything that changes what the studio DRAWS
 * has to move one of these". #192 made the studio draw a conversation, and
 * nothing in the digest was about conversation.
 *
 * Most of it moved by accident. A message becomes a job, and `jobs_running`
 * counts it; an answer becomes an output, and `outputs` counts that. Most is
 * not all:
 *
 *   - a backfilled message makes no job at all (0340), deliberately;
 *   - a button press is a canonical command and not work;
 *   - and `latest` never looked at `inbound_commands`, so a message arriving
 *     against a job that already existed moved nothing.
 *
 * Two counters rather than a join to any of it. This function runs every
 * twenty seconds per open tab and its whole justification is being cheap.
 */

CREATE OR REPLACE FUNCTION app.hq_pulse()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select jsonb_build_object(
    'at', app.now_utc(),
    /*
      The digest. Anything that changes what the studio DRAWS has to move one of
      these, and nothing else should -- a digest that changes when nothing
      visible did is a page that redraws for no reason, which is worse than a
      stale one because it interrupts.
    */
    'jobs_running', (select count(*)::int from public.jobs
                      where state in ('running', 'queued') and not is_fixture),
    'jobs_done', (select count(*)::int from public.jobs
                   where state = 'complete' and not is_fixture),
    'outputs', (select count(*)::int from public.outputs o
                 join public.jobs j using (job_id) where not j.is_fixture),
    'tasks_open', (select count(*)::int from public.tasks
                    where state in ('todo', 'doing', 'blocked') and not is_fixture),
    'documents', (select count(*)::int from public.documents),
    /*
      0343. Something was SAID.

      Most conversation already moves this digest by accident: a message
      becomes a job, and `jobs_running` counts it. Most is not all — a
      backfilled message makes no job (0340), and neither does a button press.
      Without this the studio's chat would sit still while the conversation
      grew underneath it, which is exactly the "photograph, not a window"
      this function exists to stop.
    */
    'messages', (select count(*)::int from public.inbound_commands),
    -- The most recent moment anything the page shows was touched. Catches an
    -- edit that leaves every count identical -- a task renamed, a project
    -- given an icon -- which the counts alone cannot see.
    'latest', greatest(
      (select max(updated_at) from public.jobs where not is_fixture),
      (select max(created_at) from public.outputs),
      (select max(updated_at) from public.tasks where not is_fixture),
      (select max(updated_at) from public.projects),
      -- And an edit that changes no count: a message arriving on a surface
      -- whose job already existed.
      (select max(received_at) from public.inbound_commands)
    )
  )
$function$
;

commit;
