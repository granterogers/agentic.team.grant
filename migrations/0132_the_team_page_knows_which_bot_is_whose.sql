-- 0132 — The team page knows which bot is whose
--
-- 0131 made a bot assignable; this puts the assignment where it is decided.
-- The picker needs the person AND the pool in one payload, and 0120 already
-- settled the principle for the tool catalogue: one call, not nine, because a
-- page that fetches per row feels broken while being correct.
--
-- Copied programmatically from 0120 with one key added — the same discipline
-- 0130 adopted after 0128, which existed because I retyped a long function and
-- got two column names wrong.

begin;

create or replace function app.hq_team()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    -- Which bot speaks as whom, and which are spare. Here rather than in a
    -- second section because the team page needs both together to render a
    -- picker, and two fetches for one screen is the thing 0120 already
    -- refused for the tool catalogue.
    'bots', (app.hq_bots() -> 'bots'),
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

commit;
