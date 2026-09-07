-- 0080 — The team page carries everything it needs to be edited
--
-- `hq_team` (0079) returned the roster and left the page to find the avatar
-- host somewhere else. `hq_staff` already had that problem solved and the two
-- would have drifted, so this returns the same envelope shape: the people, and
-- the base URL their pictures hang off.
--
-- Also the bot link Grant asked for. It is in `telegram_bots` and it is copied
-- onto `staff` (0079) rather than joined here, because the page shows one row
-- per person and a join that silently drops a person with no bot is a page that
-- silently drops a person.

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
  'The roster as the front end edits it: names, titles, pronouns, remits, bot '
  'links, and the avatar host. Retired people included, because a page that '
  'hides them offers no way to bring one back.';

commit;
