-- 0120 — The team page shows skills and tools
--
-- 0119 added the two things Grant asked for. This puts them where he asked for
-- them: on the team page, in the payload it already reads.
--
-- One call, not nine. The obvious build is a checkbox list that fetches each
-- person's tools when their row is opened, and it is wrong here for a reason
-- worth writing down: `hq_staff_tools` is a small query, but nine round trips
-- over a phone connection is a page that feels broken while being correct, and
-- §25 cares how it feels in a hand. The tool catalogue is seventeen rows. It
-- travels with the roster.
--
-- `tools` is per-person and includes the ungranted ones, because a permission
-- screen that lists only what is granted cannot be used to grant anything.

begin;

create or replace function app.hq_team()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'avatar_base', (
      select value #>> '{}' from public.system_config where key = 'staff.avatar_base_url'
    ),
    'staff', coalesce((
      select jsonb_agg(t order by t.sort, t.name)
        from (
          select s.slug, s.name, s.title, s.pronouns, s.responsibilities,
                 s.telegram_username, s.avatar_ref, s.active, s.permanent,
                 s.prompt_version,
                 -- Skills. Description, not permission: this goes into the
                 -- prompt and grants nothing, which is why it is a free text
                 -- field on the page and the tool list is not.
                 coalesce(s.expertise, array[]::text[]) as skills,
                 s.communication_style,
                 app.hq_staff_tools(s.slug) as tools,
                 case s.slug when 'chief-of-staff' then 0 else 1 end as sort,
                 (select count(*)::int
                    from public.routing_decisions r
                   where r.roster[1] = s.slug) as convened_for
            from public.staff s
           where s.slug not like 'fixture-%'
        ) t
    ), '[]'::jsonb)
  )
$$;

comment on function app.hq_team is
  'The roster as the front end edits it: names, titles, pronouns, remits, '
  'skills, per-person tool grants, bot links, and the avatar host. Retired '
  'people included, because a page that hides them offers no way to bring one '
  'back.';

commit;
