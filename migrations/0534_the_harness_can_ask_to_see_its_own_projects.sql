/*
  0534 — the harness can ask to see its own projects, and only the harness

  #295. `src/simulation/canonical.ts` was driven against the live office for
  the first time on 21 September. It works, it is contained, and roughly half
  the corpus cannot be tested through it, because the world the corpus asks
  about is not there.

  `project.lookup/grant-like/0` says *"ok so give me the satte of play on the
  funding one"*. DEFAULT_WORLD calls that `simgrant Match Funding Bid`. The
  live office's active non-fixture projects are legacy-coaching-course,
  unnamed, ai-team-hq-test, learning-my-ai-team and ai-learning. There is no
  funding project, the office says so honestly, and the turn is green having
  measured nothing. 68 of 132 scenarios and 40 of 66 families are in that
  position.

  ## Why the two obvious answers are both wrong

  A REAL project resolves and is permanent: it gathers a job, a job can never
  be deleted, `app.project_delete` refuses it for ever, and after fifteen
  minutes `app.provision_missing_channels` earns it a Slack channel that Slack
  cannot delete. CLAUDE.md records that pile being built twice, the second
  time by somebody quoting the rule that caused it.

  A FIXTURE project is safe from all of that - 0419 requires `not is_fixture`
  - and cannot be resolved by name, because the `live` CTE below filters
  `not p.is_fixture` and every one of the four scoring branches joins it. So
  the referent families would fail for the wrong reason, which is worse than
  not running them.

  That is #45 in its sharpest form: a suite testing a feature which FILTERS
  fixtures cannot name its subjects the way the filter matches.

  ## What this does instead

  Exactly what 0297 did for `app.impediments_tally` and 0533 did for
  `app.my_tasks`, eight hours ago, for the same reason. The reader gains a
  parameter. Three properties make it safe, and they are the three 0533
  names:

    * it DEFAULTS TO FALSE, so every existing caller is unchanged, and Grant's
      own traffic resolves against byte-identically the same rows as before;
    * the PUBLIC WRAPPER does not take it and is re-created here unchanged,
      so nothing with a browser can ask for fixture projects - PostgREST is
      the only thing that can reach a wrapper;
    * the suite asserts BOTH DIRECTIONS. A reader parameter with only the
      positive check is an untested filter.

  ## Why this is not a simulator fork

  The handler does not decide, and does not learn a mode. It passes its own
  job id, and the DATABASE answers from `app.harness_job`, which is canonical
  and is already what decides whether a delivery may reach a destination
  (0523) and whether a task appears on Grant's list (0530/0533). The same
  resolver, the same scoring, the same planning, routing, execution and
  persistence. Only the visible set differs, and it differs on a fact the
  office already computes about the asker.

  `app.harness_job` is false for every message Grant sends, so his resolver
  behaviour cannot change. The suite proves that rather than asserting it.

  ## The two traps this migration is written around

  `create or replace` does not replace a function whose argument list changed
  - it adds an overload and calls become ambiguous - so the old signature is
  dropped by exact signature first, and the PUBLIC WRAPPER is dropped with it
  because it depends on the app function.

  `pg_get_functiondef` emits no trailing semicolon. Recorded twice in
  CLAUDE.md, hit twice, and this body was spliced FROM the live definition
  rather than transcribed, so the terminator is added deliberately below.
*/

drop function if exists public.resolve_project_by_name(text);
drop function if exists app.resolve_project_by_name(text);

CREATE OR REPLACE FUNCTION app.resolve_project_by_name(p_text text, p_include_fixtures boolean DEFAULT false)
 RETURNS TABLE(project_id uuid, slug text, name text, confidence numeric, how text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with asked as (
    select app.normalise_name(p_text) as n
  ),
  live as (
    -- One place the fixture rule is applied, rather than four.
    --
    -- The flag widens this set and nothing else, so every branch below keeps
    -- scoring exactly as it did. It defaults to false, so every existing
    -- caller - and every message Grant sends - resolves against precisely
    -- the same rows as before.
    select p.* from public.projects p
     where p.status = 'active'
       and (p_include_fixtures or not p.is_fixture)
  ),
  scored as (
    select p.project_id, p.slug, p.name, 1.00::numeric as confidence, 'slug'::text as how
      from live p
     cross join asked a
     where a.n is not null and app.normalise_name(p.slug) = a.n

    union all

    select p.project_id, p.slug, p.name,
           least(0.99, 0.90 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you call it that'
                          when 'name' then 'its name'
                          when 'slug' then 'its slug'
                          else 'a name we picked up' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null and al.normalised = a.n

    union all

    -- The name inside a sentence (0156).
    select p.project_id, p.slug, p.name,
           least(0.95, 0.86 + (al.confidence * 0.09))::numeric,
           case al.source when 'grant' then 'you called it that, in what you said'
                          when 'name' then 'its name, in what you said'
                          else 'a name we know, in what you said' end
      from public.project_aliases al
      join live p on p.project_id = al.project_id
     cross join asked a
     where a.n is not null
       and length(al.normalised) >= 4
       and al.normalised <> a.n
       and a.n ~ ('\m' || regexp_replace(al.normalised, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '\M')

    union all

    select p.project_id, p.slug, p.name,
           (0.40 + (0.45 * greatest(
              extensions.similarity(app.normalise_name(p.name), a.n),
              coalesce((select max(extensions.similarity(al2.normalised, a.n))
                          from public.project_aliases al2
                         where al2.project_id = p.project_id), 0),
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
              coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           )))::numeric,
           'a close match on the name'::text
      from live p
     cross join asked a
     where a.n is not null
       and greatest(
             extensions.similarity(app.normalise_name(p.name), a.n),
             coalesce((select max(extensions.similarity(al3.normalised, a.n))
                         from public.project_aliases al3
                        where al3.project_id = p.project_id), 0),
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.description, '')), a.n), 0) * 0.6,
             coalesce(extensions.similarity(app.normalise_name(coalesce(p.purpose, '')), a.n), 0) * 0.6
           ) >= 0.34
  )
  select distinct on (s.project_id)
         s.project_id, s.slug, s.name, round(s.confidence, 3), s.how
    from scored s
   order by s.project_id, s.confidence desc
$function$;

comment on function app.resolve_project_by_name(text, boolean) is
  'Score active dashboard projects against a phrase. p_include_fixtures widens '
  'the candidate set to fixture projects and is for harness traffic only: the '
  'production caller passes app.harness_job(job_id), which is false for every '
  'message a person sends (#295, 0534).';

/*
  The wrapper, re-created unchanged and WITHOUT the parameter.

  This is the half CLAUDE.md says is silently dropped when a signature
  changes, and here it is also the security boundary: PostgREST can only
  reach a wrapper, so a wrapper that cannot ask for fixtures means nothing
  with a browser can.
*/
CREATE OR REPLACE FUNCTION public.resolve_project_by_name(p_text text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $wrapper$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.confidence desc), '[]'::jsonb)
    from app.resolve_project_by_name(p_text) r
$wrapper$;

grant execute on function public.resolve_project_by_name(text)
  to anon, authenticated, service_role;
