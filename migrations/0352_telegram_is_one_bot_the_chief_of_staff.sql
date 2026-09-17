-- 0352 — Telegram is one bot, and it is Claire's
--
-- Issue #70. Grant, 13 September 2026:
--
--   "we don't need a different bot for each role. In fact, we only need the
--    chief of staff. And if I wish to speak to other team members directly, I
--    can do so via Slack. or within the own... our own portal."
--
-- #70 opened as a narrower complaint: seven directors have a bot and the chief
-- of staff — the ONE person permitted to speak to Grant, because
-- `telegram.only_chief_speaks` is true — has none. `telegram_bots` said the
-- pager belonged to nobody; `staff.telegram_username` said it was Claire's.
-- Two tables disagreeing about the same fact, each half plausible alone.
--
-- Grant's answer settles the disagreement AND removes the seven.
--
-- ## Three changes, and one that is deliberately not made
--
-- 1. THE PAGER IS CLAIRE'S BOT. `staff_slug = 'chief-of-staff'`, `is_pager`
--    stays true. The two tables now agree, `app.telegram_bot_for
--    ('chief-of-staff')` resolves, and `--decision` buzzing becomes a property
--    of a bot belonging to a person rather than of a nameless channel.
--
-- 2. THE SEVEN ARE DISABLED, NOT DELETED. `tool_permissions` taught this in
--    0298: a listed row that is off can become a proposal later; a deleted one
--    cannot. `disabled_reason` carries Grant's decision in his own words, so
--    whoever finds these in a year knows they were retired rather than lost.
--
-- 3. THE MIRROR STOPS BEING READ. `staff.telegram_username` was populated FROM
--    `telegram_bots` by 0082 — a copy of a fact, and CLAUDE.md's standing rule
--    is that the copy is the one that rots. It did: that rot is #70's opening
--    paragraph. Only two functions read it, so both derive it now, and the
--    column keeps its value with a comment saying what the source of truth is.
--
-- NOT MADE: the column is not dropped. Dropping is a one-way door and this is
-- reversible without one — nothing reads the column after this, so its value
-- can no longer mislead anybody.
--
-- ## What this does NOT do, and Grant has to
--
-- Disabling a bot stops the office using it. It does not revoke the token —
-- only BotFather can, with /revoke, and only a person can ask it. Same honest
-- line 0350 draws for disconnecting Telegram entirely. The seven tokens stay
-- in the vault until he revokes them, so the decision stays reversible.

begin;

/*
  The pager is Claire's. `is_pager` is untouched: it says how the bot behaves
  (it may interrupt), which is orthogonal to whose voice it is.
*/
update public.telegram_bots
   set staff_slug = 'chief-of-staff'
 where is_pager and staff_slug is null;

/*
  And the seven are retired.

  Scoped by `staff_slug is not null and not is_pager` rather than by a list of
  usernames: a list would silently miss an eighth bot added later, and the
  RULE Grant stated is "only the chief of staff", not "these seven names".
*/
update public.telegram_bots
   set enabled = false,
       disabled_reason =
         'Retired 14 September 2026 on Grant''s instruction (#70): "we don''t need a '
         || 'different bot for each role. In fact, we only need the chief of staff. And '
         || 'if I wish to speak to other team members directly, I can do so via Slack. '
         || 'or within the own... our own portal." The token is NOT revoked — only '
         || 'BotFather can do that. Re-enable by setting enabled = true; nothing was '
         || 'deleted.'
 where staff_slug is not null
   and not is_pager
   and enabled;

comment on column public.staff.telegram_username is
  'SUPERSEDED by public.telegram_bots (#70, 0352). A copy of the bot username, '
  'populated by 0082, which drifted from the registry it was copied from — the '
  'disagreement #70 was opened about. Nothing reads it: hq_team and '
  'hq_studio_settings derive the username from telegram_bots instead. Kept '
  'rather than dropped because dropping is a one-way door and a column nobody '
  'reads cannot mislead anybody.';

/*
  Derived, not mirrored.

  Same field name and same shape, so no caller changes — and now it answers
  the question a reader is really asking: which bot speaks for this person
  RIGHT NOW. A retired bot's owner correctly reads as having none.
*/
create or replace function app.hq_team()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object(
    'bots', (app.hq_bots() -> 'bots'),
    'avatar_base', (
      select value #>> '{}' from public.system_config where key = 'staff.avatar_base_url'
    ),
    'staff', coalesce((
      select jsonb_agg(t order by t.sort, t.name)
        from (
          select s.slug, s.name, s.title, s.pronouns, s.responsibilities,
                 -- #70, 0352: from the registry rather than from the copy of it
                 -- on this row. `enabled` is the point — a person whose bot has
                 -- been retired has no bot, and saying otherwise is the
                 -- disagreement this Issue was opened about.
                 (select b.username from public.telegram_bots b
                   where b.staff_slug = s.slug and b.enabled
                   limit 1) as telegram_username,
                 s.avatar_ref, s.active, s.permanent,
                 s.prompt_version,
                 coalesce(s.expertise, array[]::text[]) as skills,
                 s.communication_style,
                 app.hq_staff_tools(s.slug) as tools,
                 -- How they work, as opposed to what they know about.
                 app.hq_staff_procedures(s.slug) as procedures,
                 case s.slug when 'chief-of-staff' then 0 else 1 end as sort,
                 (select count(*)::int
                    from public.routing_decisions r
                   where r.roster[1] = s.slug) as convened_for
            from public.staff s
           where s.slug not like 'fixture-%'
        ) t
    ), '[]'::jsonb)
  )
$fn$;

commit;
