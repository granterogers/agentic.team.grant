-- 1074: a project's archive can be in progress, and an archived project can be restored in progress.
--
-- The lifecycle is active -> archiving -> archived -> restoring -> active (src/portability/lifecycle.ts holds the rules).
-- `archiving` and `restoring` hold a long operation, so a second press cannot start the same work again.
--
-- Two parts, and both are needed:
--
--   1. The constraint admits the two new states. Migration 0002 named it `projects_status_known`, and nothing has
--      changed it since.
--
--   2. Every function that refuses work on an archived project by naming it (`status <> 'archived'`) must refuse work on
--      an archiving or restoring project too. Otherwise a task could be written into a project half way through its
--      archive. Those fourteen functions are rebuilt from their LIVE definitions (pg_get_functiondef), changing only
--      that one predicate, so nothing is retyped from memory. The predicate becomes
--      `status not in ('archived', 'archiving', 'restoring')`, which leaves `paused` projects behaving as they do now.
--
-- Readers that ask for `status = 'active'` already exclude the new states and need no change.
-- The final block is a control: if any of the fourteen still names the old predicate, this migration refuses to apply.

alter table public.projects drop constraint projects_status_known;

alter table public.projects
  add constraint projects_status_known
  check (status in ('active', 'paused', 'archiving', 'archived', 'restoring'));

do $$
declare
  f record;
  def text;
  rebuilt int := 0;
begin
  for f in
    select p.oid, n.nspname, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.prokind = 'f'
      and p.proname in (
        'add_project_alias', 'add_project_reference', 'alias_is_free_among_active', 'create_automation',
        'hq_event_add', 'hq_event_assign', 'hq_project_events', 'hq_rename_project', 'hq_style_set',
        'my_task_add', 'set_project_instruction', 'set_project_staff', 'style_adopt_from_document',
        'style_source_candidates'
      )
  loop
    def := pg_get_functiondef(f.oid);
    -- Only real SQL, never a comment: a comment quotes the predicate in backticks, which the leading space or dot excludes.
    def := regexp_replace(
      def,
      $re$([ .])status <> 'archived'$re$,
      $re$\1status not in ('archived', 'archiving', 'restoring')$re$,
      'g'
    );
    execute def;
    rebuilt := rebuilt + 1;
  end loop;

  if rebuilt <> 14 then
    raise exception 'expected to rebuild 14 project readers, rebuilt %', rebuilt;
  end if;

  -- The control: no rebuilt reader may still refuse only the archived state.
  for f in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.prokind = 'f'
      and p.proname in (
        'add_project_alias', 'add_project_reference', 'alias_is_free_among_active', 'create_automation',
        'hq_event_add', 'hq_event_assign', 'hq_project_events', 'hq_rename_project', 'hq_style_set',
        'my_task_add', 'set_project_instruction', 'set_project_staff', 'style_adopt_from_document',
        'style_source_candidates'
      )
      and pg_get_functiondef(p.oid) ~ $re$(\s|\.)status\s*<>\s*'archived'$re$
  loop
    raise exception 'app.% still refuses only the archived state after 1074', f.proname;
  end loop;
end $$;
