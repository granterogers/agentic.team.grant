-- The build diary's screenshots prune with their rows (#21).
--
-- 0170 records what the build session is doing and prunes `build_steps` at
-- thirty days. The PICTURES were never in that sentence: 160 objects and 74 MB
-- of a 1 GB free tier are sitting in the `build` bucket, of which only 122 are
-- still referenced by a row. The rest are orphans of pruned steps, and nothing
-- anywhere was ever going to remove them.
--
-- ## The public bucket, decided rather than inherited
--
-- ADR-0034 records this in full. In short: the bucket STAYS public, because
-- Grant's instruction about screenshots is explicit and load-bearing —
-- *"I can't see anything.. you will always have to give me the image links
-- each time to judge"* — and a ten-minute signed URL in a message he reads
-- that evening is a link that does not work. A thirty-day signed URL would be
-- a public URL with extra machinery.
--
-- What makes that acceptable is not the bucket, it is the three things around
-- it: the repository the links are pasted into is PRIVATE; the object names
-- are unguessable; and the pictures cannot contain a credential, because the
-- page never renders one — `verify:hq` scans the rendered page for six
-- credential shapes with a synthetic specimen of each as its control, and the
-- token field is a password input that is never repopulated.
--
-- The retention window is the fourth thing, and it is what this migration
-- adds: a URL that leaks stops working within thirty days.
--
-- ## What counts as orphaned
--
-- An object no row points at. Derived from `build_steps.shot_url` rather than
-- from the object's age, because the ROW's retention is the rule and the
-- object should follow it — two windows written separately are two windows
-- that will disagree, which is the defect this file records about copied
-- flags.

create or replace function app.build_shots_orphaned(p_limit integer default 200)
returns table (object_name text)
language sql
stable
security definer
set search_path to 'public', 'storage', 'pg_catalog'
as $function$
  select o.name::text
    from storage.objects o
   where o.bucket_id = 'build'
     and not exists (
       select 1 from public.build_steps b
        where b.shot_url is not null
          and b.shot_url like '%' || o.name
     )
   order by o.created_at
   limit greatest(coalesce(p_limit, 200), 1)
$function$;

comment on function app.build_shots_orphaned(integer) is
  'Screenshot objects in the build bucket that no build_steps row points at (#21). '
  'The handler office.prune_build_shots deletes them through the storage API; '
  'deleting the storage.objects row here would leave the bytes behind.';

grant execute on function app.build_shots_orphaned(integer) to ai_team_app, service_role;

-- Marcus, daily, because retention is operations and the volume is a picture
-- every few minutes at worst rather than a row per model call.
insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes)
select
  'build-shot-retention',
  s.staff_id,
  'Delete build-diary screenshots that no step points at any more. The rows '
  'prune at thirty days and the pictures did not, so the bucket only ever grew '
  'against a 1 GB allowance.',
  'office.prune_build_shots',
  1440
  from public.staff s
 where s.slug = 'operations-director'
on conflict (slug) do nothing;
