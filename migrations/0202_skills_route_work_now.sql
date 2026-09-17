-- Skills route work now, so the editor has to survive them.
--
-- Issue #65. 0200 and 0201 made `staff.expertise` decide who gets a piece of
-- work. That turned a descriptive field into a functional one, and the editor
-- built for the descriptive version has two faults it did not have yesterday.
--
-- ## 1. The cap is now wrong
--
-- `hq_staff_update` refuses more than twelve skills, with a comment that says
-- exactly why:
--
--     A prompt listing thirty skills describes nobody. The cap is a writing
--     constraint, not a storage one.
--
-- That was right when the words only shaped how someone wrote. It is wrong now
-- that they also decide who Grant's request goes to: Ruby needs `instagram`,
-- `linkedin`, `seo`, `funnel`, `leads` and `social` to be findable by the words
-- he actually types, and none of those describe her any better than "growth"
-- does.
--
-- 0201's seeding already pushed several people past twelve, so the editor
-- currently REFUSES to save anyone it can load. Raised to thirty, which is
-- still a bound and no longer a writing rule pretending to be a limit.
--
-- ## 2. Clearing them is now consequential
--
-- Emptying the field used to make someone's prompt vaguer. It now makes them
-- unroutable — they would never be chosen for anything again, silently.
--
-- Still allowed, because "this person should not be picked by subject" is a
-- legitimate thing to want. But it is reported: the result says how many words
-- were removed, so a page can say so and an accident is visible in the
-- response rather than discovered weeks later by wondering why Ruby never gets
-- anything.

begin;

create or replace function app.hq_staff_update(
  p_slug     text,
  p_name     text default null,
  p_title    text default null,
  p_pronouns text default null,
  p_remit    text default null,
  p_skills   text default null,
  p_style    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_skills text[];
  v_before integer;
  v        jsonb;
begin
  if not exists (select 1 from public.staff where slug = p_slug) then
    return jsonb_build_object('error', format('no one called %L', p_slug));
  end if;

  if p_name is not null and trim(p_name) ~ '\s' then
    return jsonb_build_object(
      'error', 'first names only — "' || trim(p_name) || '" has more than one word'
    );
  end if;

  select coalesce(array_length(expertise, 1), 0) into v_before
    from public.staff where slug = p_slug;

  if p_skills is not null then
    select array_agg(distinct lower(btrim(t)) order by lower(btrim(t)))
      into v_skills
      from unnest(string_to_array(p_skills, ',')) as t
     where btrim(t) <> '';

    if v_skills is null then
      -- Emptying the list is allowed; sending only commas is a typo.
      if trim(p_skills) <> '' then
        return jsonb_build_object('error', 'skills must be a comma-separated list');
      end if;
      v_skills := array[]::text[];
    end if;

    /*
      Thirty, not twelve.

      Twelve was a writing constraint — "a prompt listing thirty skills
      describes nobody" — and it was right while these words only shaped a
      voice. They now decide who Grant's request reaches, and the words he
      types ("instagram", "seo", "funnel") are not descriptions of a person.
      A bound still exists because an unbounded list is a person who matches
      everything, which is the same as nobody being chosen.
    */
    if array_length(v_skills, 1) > 30 then
      return jsonb_build_object(
        'error', 'thirty subject words is the most one person can usefully own');
    end if;
  end if;

  update public.staff
     set name       = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
         title      = coalesce(nullif(trim(coalesce(p_title, '')), ''), title),
         pronouns   = coalesce(nullif(trim(coalesce(p_pronouns, '')), ''), pronouns),
         responsibilities =
                      coalesce(nullif(trim(coalesce(p_remit, '')), ''), responsibilities),
         communication_style =
                      coalesce(nullif(trim(coalesce(p_style, '')), ''), communication_style),
         expertise  = coalesce(v_skills, expertise),
         updated_at = app.now_utc()
   where slug = p_slug
  returning jsonb_build_object(
    'slug', slug, 'name', name, 'title', title, 'pronouns', pronouns,
    'skills', expertise,
    /*
      Said out loud, because it is now consequential.

      Clearing the list makes someone unroutable — they would never be picked
      for anything again, and nothing about the page would look wrong. The
      count of what went lets the caller say so at the moment it happens.
    */
    'skills_removed', greatest(v_before - coalesce(array_length(expertise, 1), 0), 0)
  ) into v;

  return v;
end;
$$;

comment on function app.hq_staff_update(text, text, text, text, text, text, text) is
  'Edit a person. Since 0200 their skills also decide who work is routed to, so '
  'the cap is thirty rather than twelve and clearing the list reports how many '
  'words went — an unroutable specialist is invisible otherwise.';

commit;
