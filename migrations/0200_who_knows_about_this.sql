-- Who knows about this, from data Grant can edit.
--
-- Issue #65. He asked for the routing to be got right, and said why:
--
--     "when it comes to the dashboard, we're going to look at each agent, what
--      their skill sets are, what tools they have access to, and adjust and add
--      and refine... This whole concept is the core of the agentic workforce."
--
-- That last sentence decides the design. Subject-matter routing currently lives
-- in `TOPIC_ROLES`, a hardcoded list of five regexes in `src/agents/router.ts`.
-- It works. It is also the one thing he cannot adjust, add to or refine —
-- changing who handles pricing questions would need me, which is precisely the
-- dependence `CLAUDE.md` says outranks most other goals.
--
-- `staff.expertise` already exists, already holds the right words, and has
-- never been used for routing:
--
--     research-director       research, source evaluation, synthesis, provenance
--     finance-director        finance, unit economics, metrics, data analysis
--     growth-director         campaign copy, demand generation, image editing…
--
-- So this makes the roster read the roster.
--
-- ## What the research says, and what of it applies
--
-- The supervisor pattern — one orchestrator delegating to specialists — is the
-- one with the best-understood failure modes, and it is what this office
-- already is: Claire receives, specialists do. Two findings changed the design:
--
--   * **Route to a capability, then resolve to an agent.** Naming agents at the
--     call site couples the caller to the roster. Here the caller names a
--     SUBJECT and this function resolves it, so changing who owns pricing is a
--     row edit and nothing else moves.
--   * **Capability is contextual, not a static label.** A single score per
--     agent is not enough. So this returns ranked candidates WITH the matched
--     terms, and the caller applies §9's cost ceiling on top — expertise says
--     who could, policy says how many may.
--
-- Deliberately NOT adopted: bidding, debate, and swarm. Each spends several
-- model calls to decide who should spend one, against a ~£0 budget, for a
-- roster of eight whose remits do not overlap much.
--
-- ## Why matching is lexical and not embedded
--
-- An embedding would handle "how much should I charge" → finance without the
-- word "cost" appearing. It also costs a paid API or a model call per message.
-- `extensions.similarity` is free and already used elsewhere, and the office
-- can fall back to the intent ceiling when nothing matches — which is what it
-- does today for every message. Lexical first; the gap is measurable in
-- `routing_decisions.roster_reason` and can be revisited with evidence.

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
    -- The instruction, as comparable words. Short ones carry no subject —
    -- "the", "and", "for" would match everything at low similarity and turn
    -- the ranking into noise.
    select distinct w
      from unnest(regexp_split_to_array(lower(coalesce(p_text, '')), '[^a-z]+')) as w
     where length(w) >= 4
  ),
  -- Each person's expertise, one term per row, so a four-term expertise is
  -- four chances to match rather than one long string that matches nothing.
  terms as (
    select s.slug, s.name, lower(btrim(t)) as term
      from public.staff s, unnest(s.expertise) as t
     where s.active
  ),
  hits as (
    select t.slug, t.name, t.term, w.w,
           /*
             Whole-word containment, or a close spelling.

             `similarity` alone matched "metrics" to "metres" and "data" to
             "date". Requiring either containment or a high trigram score keeps
             the fuzzy match for plurals and typos — "sources" to "source",
             "forecasting" to "forecast" — without inviting coincidence.
           */
           greatest(
             case when t.term like '%' || w.w || '%' or w.w like '%' || t.term || '%'
                  then 1.0 else 0 end,
             extensions.similarity(t.term, w.w)
           ) as s
      from terms t
      join words w
        on t.term like '%' || w.w || '%'
        or w.w like '%' || t.term || '%'
        or extensions.similarity(t.term, w.w) > 0.62
  )
  select h.slug,
         h.name,
         array_agg(distinct h.term order by h.term) as matched,
         -- Sum, not max: an instruction touching three of someone's four
         -- expertise terms is more theirs than one touching a single term
         -- exactly. Capped per term so one repeated word cannot dominate.
         sum(least(h.s, 1.0))::real as score
    from hits h
   group by h.slug, h.name
   order by sum(least(h.s, 1.0)) desc, h.slug
   limit greatest(coalesce(p_limit, 3), 1)
$$;

comment on function app.who_knows_about(text, integer) is
  'Ranked specialists for a subject, from staff.expertise — data Grant edits '
  'on the dashboard rather than a regex in TypeScript (#65). Says WHICH terms '
  'matched, because a routing decision nobody can question is one nobody can '
  'correct.';

create or replace function public.who_knows_about(p_text text, p_limit integer default 3)
returns table (slug text, name text, matched text[], score real)
language sql stable security definer set search_path = ''
as $$ select * from app.who_knows_about(p_text, p_limit) $$;

commit;
