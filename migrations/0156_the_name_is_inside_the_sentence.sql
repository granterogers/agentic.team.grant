-- The name is inside the sentence.
--
-- 0153's fourth resolution step reads the name out of what was said. It was
-- given the whole utterance and matched it as a whole string, which means it
-- worked only when Grant said nothing but the name:
--
--     "the wellness thing"                       → resolved
--     "have a look at the wellness thing"        → nothing
--
-- Nobody types the first one. `verify:identity` asked with a real sentence and
-- got null, which is the harness doing exactly its job — the unit tests could
-- not have caught it, because both halves are SQL and neither is wrong on its
-- own.
--
-- ## Containment, and why it sits below the exact routes
--
-- An alias that appears INSIDE the sentence is good evidence and not quite as
-- good as a sentence that is nothing but the alias: "let's not use the wellness
-- thing for this" contains the phrase and means the opposite. So a contained
-- match scores below every whole-string route, which keeps the two
-- distinguishable at the threshold — an exact alias still clears 0.90 and acts,
-- and a contained one has to be the only candidate to get there.
--
-- ## Word boundaries, and a floor on length
--
-- Matched with `\m` and `\M` so "hq" does not match inside "hq test", and only
-- for aliases of four characters or more. A two-letter alias inside a sentence
-- is a coin toss wearing a confidence score, and the cost of being wrong here
-- is work filed against the wrong project without anyone being asked.
--
-- Short aliases still work exactly. This narrows the fuzzy route only.

begin;

create or replace function app.resolve_project_by_name(p_text text)
returns table (
  project_id  uuid,
  slug        text,
  name        text,
  confidence  numeric,
  how         text
)
language sql
stable
security definer
set search_path to ''
as $$
  with asked as (
    select app.normalise_name(p_text) as n
  ),
  scored as (
    -- The slug, typed exactly. The one unambiguous thing a person can say.
    select p.project_id, p.slug, p.name, 1.00::numeric as confidence, 'slug'::text as how
      from public.projects p
     cross join asked a
     where p.status = 'active' and a.n is not null
       and app.normalise_name(p.slug) = a.n

    union all

    -- A name he has used for it, including its own name and slug from the
    -- backfill. Confidence carries through from the alias, so something he
    -- said himself outranks something the system guessed.
    select p.project_id, p.slug, p.name,
           least(0.99, 0.90 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you call it that'
                          when 'name' then 'its name'
                          when 'slug' then 'its slug'
                          else 'a name we picked up' end
      from public.project_aliases al
      join public.projects p on p.project_id = al.project_id
     cross join asked a
     where p.status = 'active' and a.n is not null
       and al.normalised = a.n

    union all

    -- The name inside a sentence (0156). Capped at 0.95 so a whole-string match
    -- always wins, and floored at four characters so a short alias cannot be
    -- found by accident in the middle of unrelated words.
    select p.project_id, p.slug, p.name,
           least(0.95, 0.86 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you called it that, in what you said'
                          when 'name' then 'its name, in what you said'
                          else 'a name we know, in what you said' end
      from public.project_aliases al
      join public.projects p on p.project_id = al.project_id
     cross join asked a
     where p.status = 'active' and a.n is not null
       and length(al.normalised) >= 4
       and al.normalised <> a.n
       and a.n ~ ('\m' || regexp_replace(al.normalised, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')

    union all

    -- Close, but not the same. Scored by similarity and capped below every
    -- route above, so a fuzzy hit can never outrank a real one.
    select p.project_id, p.slug, p.name,
           (0.40 + (0.45 * greatest(
              extensions.similarity(app.normalise_name(p.name), a.n),
              coalesce((select max(extensions.similarity(al2.normalised, a.n))
                          from public.project_aliases al2
                         where al2.project_id = p.project_id), 0),
              -- A description is weaker evidence than a name, so it is scaled
              -- down rather than allowed to win on its own.
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           )))::numeric,
           'a close match on the name'::text
      from public.projects p
     cross join asked a
     where p.status = 'active' and a.n is not null
       and greatest(
             extensions.similarity(app.normalise_name(p.name), a.n),
             coalesce((select max(extensions.similarity(al3.normalised, a.n))
                         from public.project_aliases al3
                        where al3.project_id = p.project_id), 0),
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           ) >= 0.34
  )
  -- One row per project: its best route, not every route it matched by.
  select distinct on (s.project_id)
         s.project_id, s.slug, s.name, round(s.confidence, 3), s.how
    from scored s
   order by s.project_id, s.confidence desc
$$;

commit;
