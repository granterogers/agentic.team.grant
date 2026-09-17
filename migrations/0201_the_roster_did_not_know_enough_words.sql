-- The roster did not know enough words.
--
-- Issue #65. 0200 made routing read `staff.expertise` instead of a hardcoded
-- regex list. The mechanism worked and the DATA did not:
--
--     "how much should we charge…"          -> nobody
--     "write me an announcement…"           -> nobody
--     "compare our competitors and pricing" -> nobody
--     "research how to make money coaching" -> research-director  ✓
--     "schedule and capacity for next month" -> operations-director ✓
--
-- Two separate causes, and only one of them is about words.
--
-- ## 1. "write" is not "writing"
--
-- Communications' expertise says `writing`; Grant says `write`. Neither
-- contains the other and trigram similarity puts them at about 0.5, under the
-- threshold. Same for `sources`/`source`, `forecasting`/`forecast`,
-- `metrics`/`metric`.
--
-- A stemmer would be right and Postgres has one — but `to_tsvector` stems
-- against a language configuration and would drag dictionary behaviour into a
-- routing decision Grant is supposed to be able to reason about. A shared
-- four-character prefix is cruder, is explainable in one sentence, and covers
-- every case above. Where it is wrong it is wrong visibly: `matched` is
-- returned, so a bad match can be seen rather than deduced.
--
-- ## 2. The vocabulary was a job title, not a skill set
--
-- `finance, unit economics, metrics, data analysis` is what a finance director
-- IS. It is not the words a person uses when they want one. Nobody types "unit
-- economics"; they type "how much should we charge".
--
-- The words below come from `TOPIC_ROLES` — the hardcoded list that has been
-- routing correctly all along — plus the ones its absence explains. Moving
-- them from TypeScript into a column is the whole point: this is now a table
-- Grant edits on the dashboard, and the regex list can go.
--
-- Deliberately generous. A wrong specialist reading a request costs one
-- routing decision and is visible in `roster_reason`; NOBODY reading it means
-- the intent ceiling picks the first name on a list, which is how everything
-- ended up with operations.

begin;

create or replace function app.who_knows_about(p_text text, p_limit integer default 3)
returns table (
  slug       text,
  name       text,
  matched    text[],
  score      real
)
language sql
stable
security definer
set search_path = ''
as $$
  with words as (
    select distinct w
      from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z]+')) as w
     where length(w) >= 4
  ),
  terms as (
    select s.slug, s.name, lower(btrim(t)) as term
      from public.staff s, unnest(s.expertise) as t
     where s.active
  ),
  hits as (
    select t.slug, t.name, t.term, w.w,
           greatest(
             case when t.term like '%' || w.w || '%' or w.w like '%' || t.term || '%'
                  then 1.0 else 0 end,
             /*
               A shared four-character prefix: write/writing, source/sources,
               forecast/forecasting. Scored a shade below an exact containment
               so a real match always outranks a stem match.
             */
             case when length(t.term) >= 5 and length(w.w) >= 5
                       and left(t.term, 4) = left(w.w, 4)
                  then 0.9 else 0 end,
             extensions.similarity(t.term, w.w)
           ) as s
      from terms t
      join words w
        on t.term like '%' || w.w || '%'
        or w.w like '%' || t.term || '%'
        or (length(t.term) >= 5 and length(w.w) >= 5 and left(t.term, 4) = left(w.w, 4))
        or extensions.similarity(t.term, w.w) > 0.62
  )
  select h.slug,
         h.name,
         array_agg(distinct h.term order by h.term) as matched,
         sum(least(h.s, 1.0))::real as score
    from hits h
   group by h.slug, h.name
   order by sum(least(h.s, 1.0)) desc, h.slug
   limit greatest(coalesce(p_limit, 3), 1)
$$;

-- ---------------------------------------------------------------------------
-- The words people actually use
--
-- `array_cat` with a de-duplicating pass rather than a replacement, so the
-- terms already there — and anything Grant has since added — survive.
-- ---------------------------------------------------------------------------
create or replace function app.teach_expertise(p_slug text, p_terms text[])
returns text[]
language sql
volatile
security definer
set search_path = ''
as $$
  update public.staff s
     set expertise = (
           select array_agg(distinct lower(btrim(t)) order by lower(btrim(t)))
             from unnest(s.expertise || p_terms) as t
            where btrim(t) <> ''
         ),
         updated_at = app.now_utc()
   where s.slug = p_slug
  returning s.expertise
$$;

comment on function app.teach_expertise(text, text[]) is
  'Add subject words to a specialist. Additive and de-duplicating, so terms '
  'Grant has added on the dashboard are never overwritten by a later seed.';

select app.teach_expertise('finance-director', array[
  'cost', 'costs', 'pricing', 'price', 'charge', 'budget', 'revenue',
  'margin', 'forecast', 'spend', 'profit', 'invoice', 'cashflow'
]);

select app.teach_expertise('growth-director', array[
  'marketing', 'positioning', 'messaging', 'audience', 'campaign', 'launch',
  'demand', 'brand', 'social', 'instagram', 'linkedin', 'seo', 'funnel', 'leads'
]);

select app.teach_expertise('communications-director', array[
  'write', 'draft', 'copy', 'announcement', 'email', 'post', 'blog',
  'wording', 'tone', 'newsletter', 'script', 'headline'
]);

select app.teach_expertise('operations-director', array[
  'process', 'schedule', 'capacity', 'sequence', 'rollout', 'deadline',
  'staffing', 'workflow', 'logistics', 'backlog'
]);

select app.teach_expertise('research-director', array[
  'research', 'evidence', 'source', 'sources', 'compare', 'competitor',
  'competitors', 'benchmark', 'study', 'market', 'landscape', 'survey', 'find'
]);

select app.teach_expertise('strategy-director', array[
  'strategy', 'options', 'trade', 'plan', 'roadmap', 'decide', 'decision',
  'priorities', 'approach', 'direction'
]);

select app.teach_expertise('quality-director', array[
  'quality', 'risk', 'review', 'check', 'verify', 'contradiction',
  'accuracy', 'compliance', 'audit'
]);

commit;
