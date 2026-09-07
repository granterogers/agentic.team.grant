-- 0079 — First names only, and a team you can edit
--
-- Grant, on the roster: *"only need their first name. I don't need a fucking
-- surname as well… please change all the names to be regular British/American
-- first names… I changed my mind on the photorealistic — everyone should have
-- more of a cartoony avatar, and make sure the gender of the name matches the
-- photograph."*
--
-- And: *"with regards to the actual members of staff, there should be something
-- that's also configurable in the front end. Their names, their roles, there
-- should be a link to the Telegram bot. So I should be able to add and move
-- stuff, adjust names, all that kind of stuff."*
--
-- ## Why surnames were there, and why they go
--
-- 0071 gave the team full names to make them read as people rather than as
-- roles. Half right: the names did that, the surnames did not. Nobody in a
-- Slack workspace of eight is "Marchetti" — you say "ask Rachel" — and a
-- surname on every message is the tell that a system generated the roster.
--
-- ## Gender is recorded because an avatar has to match it
--
-- Not for its own sake. The avatars are generated from a prompt, and a prompt
-- that does not say produces whatever the model's average is — which is how a
-- team called Grace and Marcus ends up illustrated as two indistinguishable
-- men. `pronouns` is the field the generator reads, so the two cannot drift
-- apart silently.
--
-- ## Editing a person is not the same as deleting one
--
-- `hq_staff_update` changes a name, a title, a remit. `hq_staff_retire` sets
-- `active = false`. There is no delete, and there will not be: `outputs`,
-- `routing_decisions` and `deliveries` all name a staff member, and a roster
-- that can lose a row is a history that stops explaining itself. A retired
-- person keeps their past and takes no new work.

begin;

alter table public.staff
  add column pronouns text,
  add column telegram_username text;

comment on column public.staff.pronouns is
  'Read by the avatar generator so the picture matches the name, and by nothing '
  'else. Recorded rather than inferred: a prompt that does not say produces the '
  'model''s average, which is how a team of eight ends up illustrated as three.';
comment on column public.staff.telegram_username is
  'Their bot, without the @. Grant asked for a link to it on the staff page, '
  'and the registry (0054) already knows it - this is the copy the page reads, '
  'kept in step by `npm run telegram:roster`.';

-- --------------------------------------------------------------------------
-- The team, by first name
-- --------------------------------------------------------------------------
--
-- Distinct initials, deliberately: eight names in a sidebar are scanned by
-- their first letter long before they are read.

update public.staff set name = 'Claire',  pronouns = 'she/her'
 where slug = 'chief-of-staff';
update public.staff set name = 'Tom',     pronouns = 'he/him'
 where slug = 'strategy-director';
update public.staff set name = 'Emma',    pronouns = 'she/her'
 where slug = 'research-director';
update public.staff set name = 'Daniel',  pronouns = 'he/him'
 where slug = 'finance-director';
update public.staff set name = 'Ruby',    pronouns = 'she/her'
 where slug = 'growth-director';
update public.staff set name = 'Marcus',  pronouns = 'he/him'
 where slug = 'operations-director';
update public.staff set name = 'Grace',   pronouns = 'she/her'
 where slug = 'quality-director';
update public.staff set name = 'Oliver',  pronouns = 'he/him'
 where slug = 'communications-director';

-- The bots they answer on, from the registry rather than typed again here.
update public.staff s
   set telegram_username = b.username
  from public.telegram_bots b
 where b.staff_slug = s.slug and b.username is not null;

-- --------------------------------------------------------------------------
-- Editing the team from the front end
-- --------------------------------------------------------------------------

create or replace function app.hq_team()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(jsonb_agg(t order by t.sort, t.name), '[]'::jsonb)
    from (
      select s.slug, s.name, s.title, s.pronouns, s.responsibilities,
             s.telegram_username, s.avatar_ref, s.active, s.permanent,
             case s.slug when 'chief-of-staff' then 0 else 1 end as sort,
             (select count(*)::int from public.outputs o
               join public.routing_decisions r on r.job_id = o.job_id
              where r.roster[1] = s.slug) as pieces_of_work
        from public.staff s
       where s.slug not like 'fixture-%'
       order by sort, s.name
    ) t
$$;

create or replace function app.hq_staff_update(
  p_slug     text,
  p_name     text default null,
  p_title    text default null,
  p_pronouns text default null,
  p_remit    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
begin
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  -- A first name, and the page says so. Enforced here rather than trusted to
  -- the page, because the page is not the only caller and 0071 already learned
  -- that a rule kept in one of two places is kept in neither.
  if p_name is not null and trim(p_name) ~ '\s' then
    return jsonb_build_object(
      'error', 'first names only — "' || trim(p_name) || '" has more than one word'
    );
  end if;
  if p_name is not null and coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('error', 'a name cannot be empty');
  end if;
  if p_pronouns is not null and p_pronouns not in ('she/her', 'he/him', 'they/them') then
    return jsonb_build_object('error', format('%L is not a pronoun set the generator knows', p_pronouns));
  end if;

  update public.staff
     set name       = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         title      = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
         pronouns   = coalesce(nullif(trim(coalesce(p_pronouns, '')), ''), pronouns),
         responsibilities = coalesce(nullif(trim(coalesce(p_remit, '')), ''), responsibilities)
   where slug = p_slug
  returning jsonb_build_object('slug', slug, 'name', name, 'title', title,
                               'pronouns', pronouns) into v;
  return v;
end;
$$;

/**
 * Retire someone, or bring them back. Never delete.
 *
 * `outputs`, `routing_decisions` and `deliveries` all name a staff member. A
 * roster that can lose a row is a history that stops explaining itself.
 */
create or replace function app.hq_staff_retire(p_slug text, p_active boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
begin
  if p_slug = 'chief-of-staff' and not p_active then
    -- Everything unaddressed routes through the Chief of Staff. Retiring them
    -- is not a smaller team, it is a team nothing reaches.
    return jsonb_build_object('error', 'the Chief of Staff cannot be retired — every unaddressed message routes through them');
  end if;
  update public.staff set active = p_active where slug = p_slug
  returning jsonb_build_object('slug', slug, 'name', name, 'active', active) into v;
  return coalesce(v, jsonb_build_object('error', format('no one called %L', p_slug)));
end;
$$;

create or replace function public.hq_team()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.hq_team() $$;

create or replace function public.hq_staff_update(
  p_slug text, p_name text default null, p_title text default null,
  p_pronouns text default null, p_remit text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_update(p_slug, p_name, p_title, p_pronouns, p_remit) $$;

create or replace function public.hq_staff_retire(p_slug text, p_active boolean default false)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_staff_retire(p_slug, p_active) $$;

commit;
