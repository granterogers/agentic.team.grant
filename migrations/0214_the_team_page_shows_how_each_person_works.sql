-- The team page shows how each person works, and lets Grant withdraw it.
--
-- Issue #50. Grant, on why this belongs on the dashboard: *"when it comes to
-- the dashboard, we're going to look at each agent what their skill sets are,
-- what tools they have access to, and adjust and add and refine."*
--
-- And a narrower reason, which is that `remember()` tells him in a Telegram
-- reply to "rename or retire it on the dashboard". That sentence has to be
-- true. A message that points somewhere is a promise about what is there.
--
-- ## Why the payload key is `procedures` and not `skills`
--
-- `skills` is taken. 0120 put `staff.expertise` on this payload under that name
-- and the page labels it Skills — it is routing vocabulary, it goes into the
-- prompt, and it grants nothing. A stored procedure is a different object with
-- a different lifecycle and a boundary of its own (ADR-0017).
--
-- Two things called Skills on one card is how somebody edits the wrong one, and
-- that has already happened once on this page: the Skills box read `s.skills`
-- while the API returned `expertise`, so saving a name would have wiped every
-- routing word the office had. So they are named apart here, and the page calls
-- the new one "How they work".
--
-- ## Retiring is an action, and creating is deliberately not one
--
-- ADRs 0013 and 0014 draw the dashboard's line at *configuring* rather than
-- *acting*, and a withdrawal is on the safe side of it: append-only, reversible
-- by writing the skill again, and it names who did it. Authoring is not here,
-- because authoring in a text box is a worse version of authoring in a sentence
-- on Telegram, which is what Grant actually asked for and what he already has.

begin;

/**
 * The procedures that apply to one person.
 *
 * Global ones included, because a procedure for the whole team governs this
 * person too and a card that showed only their own would understate what
 * shapes their work. `scope` is on each row so the page can say which is which.
 */
create or replace function app.hq_staff_procedures(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'skill_id', s.skill_id,
           'name', s.name,
           'scope', s.scope::text,
           'when_to_use', s.when_to_use,
           'procedure', s.procedure,
           'version', s.version,
           'authored_by', s.authored_by,
           'tools', coalesce((
             select array_agg(st.tool order by st.tool)
               from public.skill_tools st where st.skill_id = s.skill_id
           ), array[]::text[]),
           -- How many jobs have been shown it. A procedure with a lot of use
           -- and a poor record is the one worth arguing with; one with none is
           -- just noise in the prompt.
           'uses', (select count(*)::int from public.skill_uses u where u.skill_id = s.skill_id)
         ) order by case s.scope when 'staff' then 0 else 1 end, s.created_at desc),
         '[]'::jsonb)
    from public.skills_live s
   where s.scope = 'global'
      or (s.scope = 'staff' and s.staff_slug = p_slug)
$$;

comment on function app.hq_staff_procedures(text) is
  'The written-down procedures that shape one person''s work, theirs and the '
  'team''s (#50). Named apart from `skills` on the same payload, which is '
  'staff.expertise and is routing vocabulary rather than method.';

-- ---------------------------------------------------------------------------
-- The team payload, with them on it
--
-- Copied programmatically from 0132 with one key added, which is the discipline
-- 0130 adopted after 0128 — that one existed because a long function was
-- retyped and two column names came back wrong.
-- ---------------------------------------------------------------------------
create or replace function app.hq_team()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
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
$$;

-- ---------------------------------------------------------------------------
-- Withdrawing one from the page
-- ---------------------------------------------------------------------------
create or replace function app.hq_retire_skill(p_skill_id uuid, p_reason text default null)
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_catalog
as $$
  select app.retire_skill(
    p_skill_id, 'grant',
    -- A default that is honest rather than a default that is empty. He clicked
    -- the button; "Grant retired this from the dashboard" is exactly what
    -- happened and it beats an eight-character placeholder.
    coalesce(nullif(btrim(p_reason), ''), 'Retired by Grant from the dashboard')
  )
$$;

create or replace function public.hq_retire_skill(p_skill_id uuid, p_reason text default null)
returns jsonb language sql volatile security definer set search_path = ''
as $$ select app.hq_retire_skill(p_skill_id, p_reason) $$;

commit;
