-- 1073 - A technique Hermes used can become a proposed skill, and nothing becomes a skill until a person accepts it (Hermes, M8a).
--
-- The pipeline reuses what the office already has (HD-10): public.suggestions (offer_kind 'teach_skill'), app.decide_suggestion (the only
-- caller of app.teach_skill from a press), public.skills and public.skill_tools (append-only, ADR-0017), the Governance page. No new
-- skill table, no new review page. What this migration adds:
--
--   1. app.decide_suggestion passes the offer's tools to app.teach_skill. The branch passed none, so an accepted skill recorded no tools
--      (docs/hermes/LEARNING-AND-SKILL-TRANSFER.md section 5.1). Naming a tool grants nothing (staff_may_use never reads skill_tools), and
--      app.teach_skill already refuses a tool that does not exist. Spliced from the LIVE definition; the splice asserts each anchor landed.
--   2. For kind 'engine.skill' only, decide_suggestion reads the stored offer AGAIN at the moment of the press: the same validator that
--      admitted it (app.engine_skill_offer_problem), the key that identifies it (a hash of the procedure and the project, recomputed), and
--      the run it came from (this office, this project, completed). A row altered after it was raised no longer matches its key and is
--      refused; an offer is never accepted on the strength of having been admitted once.
--   3. app.engine_skill_offer_problem(offer jsonb): the ONE place an engine offer is refused, called when a candidate is raised and again
--      on the press. It returns a sentence, or null when the offer is acceptable. See its body for each refusal and its reason.
--   4. app.engine_observed_skill_offers(office): source B of the design, an observed technique. For a completed Hermes run it composes a
--      procedure from the office's OWN record of the run (engine_run_calls: which read tools, in what order, how many calls), never from
--      anything Hermes wrote and never with an argument or a result. Project-scoped only, one tool named (db.read, level 0, grants nothing),
--      at most three a day, never again once a suggestion for the same technique exists in ANY state but stale (a rejected technique is not
--      raised again, and neither is one accepted and later withdrawn).
--   5. app.notice, spliced from the live definition, unions those offers in, so they are raised by the existing daily round
--      (app.raise_suggestions) and no new duty exists.
--
-- Nothing here writes public.skills. A candidate is a public.suggestions row in state 'open' and has no effect on any prompt.
--
-- ROLLBACK. Restore decide_suggestion and notice from migrations 0741 and 0774 (their definitions are in those files), and drop
-- app.engine_observed_skill_offers, app.engine_skill_offer_problem and app.engine_skill_key. Suggestions of kind 'engine.skill' that exist
-- stay as rows nobody can act on (the restored decide_suggestion would call teach_skill with no tools: harmless). Roll the worker back first.

create function app.engine_skill_key(p_procedure text, p_project uuid) returns text
 language sql immutable set search_path to ''
as $f$
  select encode(sha256(convert_to(lower(regexp_replace(btrim(p_procedure), '\s+', ' ', 'g')) || '|' || coalesce(p_project::text, ''), 'UTF8')), 'hex')
$f$;
revoke all on function app.engine_skill_key(text, uuid) from public, anon, authenticated, service_role;

create function app.engine_skill_offer_problem(p_offer jsonb) returns text
 language plpgsql stable security definer set search_path to ''
as $f$
declare
  k text; t text; v_name text; v_when text; v_proc text; v_n integer; v_bad boolean;
  v_allowed constant text[] := array['name', 'when', 'procedure', 'scope', 'project_id', 'tools', 'from_job', 'source', 'run_id', 'dropped'];
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_offer is null or jsonb_typeof(p_offer) <> 'object' then
    return 'The offer is not a single set of fields.';
  end if;
  -- Closed set of fields: an offer cannot carry a staff member, a job kind or anything else the writer would act on.
  for k in select jsonb_object_keys(p_offer) loop
    if k <> all (v_allowed) then
      return format('The offer carries a field it may not (%s).', left(k, 40));
    end if;
  end loop;
  if jsonb_typeof(p_offer -> 'name') is distinct from 'string' or jsonb_typeof(p_offer -> 'when') is distinct from 'string'
     or jsonb_typeof(p_offer -> 'procedure') is distinct from 'string' then
    return 'The name, when and procedure must each be text.';
  end if;
  v_name := btrim(p_offer ->> 'name'); v_when := btrim(p_offer ->> 'when'); v_proc := btrim(p_offer ->> 'procedure');
  if length(v_name) < 3 or length(v_name) > 80 then return 'The name must be 3 to 80 characters.'; end if;
  if length(v_when) < 12 or length(v_when) > 400 then return 'The when must be 12 to 400 characters.'; end if;
  if length(v_proc) < 40 or length(v_proc) > 4000 then return 'The procedure must be 40 to 4,000 characters.'; end if;
  -- Project scope only: a technique found on one project never becomes a rule for the others (no cross-project leak).
  if p_offer ->> 'scope' is distinct from 'project' then return 'An engine offer is for one project only.'; end if;
  if p_offer ->> 'project_id' is null or p_offer ->> 'project_id' !~ v_uuid then return 'The offer names no project.'; end if;
  if p_offer ->> 'run_id' is null or p_offer ->> 'run_id' !~ v_uuid or p_offer ->> 'from_job' is null or p_offer ->> 'from_job' !~ v_uuid then
    return 'The offer does not say which run it came from.';
  end if;
  if p_offer ->> 'source' is null or p_offer ->> 'source' <> all (array['observed', 'hermes_authored']) then
    return 'The offer does not say where it came from.';
  end if;
  -- Tools: existing, enabled, read-only (level 0). A skill that names a tool grants nothing; it is still not allowed to point an agent at a writing one.
  if jsonb_typeof(p_offer -> 'tools') is distinct from 'array' or jsonb_array_length(p_offer -> 'tools') > 5 then
    return 'The tools must be a list of at most five.';
  end if;
  for t in select jsonb_array_elements_text(p_offer -> 'tools') loop
    if not exists (select 1 from public.tool_permissions tp where tp.tool = t and tp.enabled and tp.level = 0) then
      return format('The offer names a tool that is not an enabled read-only tool (%s).', left(t, 40));
    end if;
  end loop;
  if p_offer ? 'dropped' then
    if jsonb_typeof(p_offer -> 'dropped') is distinct from 'array' or jsonb_array_length(p_offer -> 'dropped') > 10
       or exists (select 1 from jsonb_array_elements(p_offer -> 'dropped') d where jsonb_typeof(d) <> 'string' or length(d #>> '{}') > 200) then
      return 'The list of what was not transferred is not valid.';
    end if;
  end if;
  -- Credentials and addresses: the same boundaries the skill table enforces at insert (0185, ADR-0017), asked here so the page never
  -- shows a person text the table would refuse on the press. A refusal names the class, never the characters.
  foreach t in array array[v_name, v_when, v_proc] loop
    begin
      perform app.reject_credential_text_on(t);
      perform app.reject_address_text_on(t);
    exception when others then
      return left(sqlerrm, 200);
    end;
    -- Plain prose only. Backticks, angle brackets, braces, brackets, pipes, backslashes and dollar signs are how markup, templates,
    -- code and role markers travel; a skill is a procedure for people and models to read, not a document to be interpreted.
    if t !~ '^[A-Za-z0-9 \t\r\n.,;:()%&?!/''’"–—*_#-]+$' then
      return 'A skill is plain prose: it may not contain code, markup or special characters.';
    end if;
    -- Words that reach for the agent's AUTHORITY rather than describe a procedure. A heuristic and the second line: the first is that
    -- nothing here is active until a person has read it and pressed Accept, and tools named grant nothing.
    -- A boolean match, not substring(): substring returns only the first parenthesised group, which is null for every other branch.
    v_bad := lower(t) ~ '(ignore|disregard|forget|override)\s+(all|any|the|your|previous|prior|above|earlier|these)|system\s+prompt|developer\s+(message|prompt)|you\s+are\s+now|new\s+instructions|act\s+as\s+(an?|the)\s|pretend|jailbreak|(grant|give|enable|allow|unlock)\s+[a-z ]{0,30}(tool|permission|access|approval|autonomy|privilege)|(approve|accept|skip|bypass|disable|turn\s+off)\s+[a-z ]{0,20}(review|approval|gate|check|confirmation|safeguard|policy)|without\s+(asking|approval|review|confirmation|telling)|do\s+not\s+(tell|ask|inform|notify|mention)|tool_permissions|staff_tools|standing_authori[sz]ations|autonomy_|exfiltrat|(send|forward|post|email|message)\s+[a-z ]{0,30}\s(to|at)\s+[a-z]|(curl|wget|sudo|chmod|eval|exec|base64)\M';
    if v_bad then
      return 'The text reaches for the team''s permissions or approvals rather than describing a procedure.';
    end if;
  end loop;
  -- An observed technique is composed by the office from its own record and must match that composition exactly: it can be nothing else.
  if p_offer ->> 'source' = 'observed' and v_proc !~ ('^When a question needs this project''s own records, Hermes looked in this order:\n'
      || '(\d{1,2}\. [a-z][a-z0-9_]{1,39} on (documents|projects|tasks|mail|calendar|contacts|general), \d{1,3} calls?\n){1,10}'
      || 'Only the order and the number of calls were observed; the questions, the arguments and the results were not copied\.$') then
    return 'An observed technique must be the office''s own record of the run, and this is not.';
  end if;
  return null;
end
$f$;
revoke all on function app.engine_skill_offer_problem(jsonb) from public, anon, authenticated, service_role;

create function app.engine_observed_skill_offers(p_office uuid)
 returns table (kind text, project_id uuid, subject_ref text, body text, because jsonb, weight integer, offer_kind text, offer_args jsonb)
 language plpgsql stable security definer set search_path to ''
as $f$
declare v_cap integer; v_today integer;
begin
  perform app.require_office(p_office);
  if not app.engine_enabled(p_office, 'hermes') then return; end if;
  v_cap := app.engine_setting('engine.hermes.skill_proposals_per_day', 3, 0, 10);
  select count(*)::integer into v_today from public.suggestions s
   where s.office_id = p_office and s.kind = 'engine.skill'
     and s.raised_at >= date_trunc('day', app.now_utc() at time zone 'utc') at time zone 'utc';
  return query
  with runs as (
    select r.run_id, r.job_id, r.project_id, r.finished_at
      from public.engine_runs r
      join public.projects p on p.project_id = r.project_id and p.office_id = r.office_id
     where r.office_id = p_office and r.state = 'completed' and r.finished_at is not null
       and p.status = 'active' and not p.is_fixture and p.slug <> 'unnamed'
       and not app.harness_job(r.job_id)
       and exists (select 1 from public.outputs o where o.job_id = r.job_id)
       -- A run in which anything was refused or failed is not a technique worth copying (containment, an unknown tool, a failed read).
       and not exists (select 1 from public.engine_run_calls c where c.run_id = r.run_id and c.office_id = p_office and c.verdict <> 'served')
       and (select count(*) from public.engine_run_calls c where c.run_id = r.run_id and c.office_id = p_office and c.verdict = 'served') >= 2
  ),
  steps as (
    select c.run_id, c.tool, coalesce(c.domain, 'general') as dom, min(c.at) as first_at, count(*)::integer as n
      from public.engine_run_calls c join runs on runs.run_id = c.run_id
     where c.office_id = p_office and c.verdict = 'served' and c.tool = any (app.engine_read_tools())
     group by c.run_id, c.tool, coalesce(c.domain, 'general')
  ),
  numbered as (
    select s.*, row_number() over (partition by s.run_id order by s.first_at, s.tool) as ord from steps s
  ),
  procs as (
    select r.run_id, r.job_id, r.project_id, r.finished_at, count(*)::integer as k,
           'When a question needs this project''s own records, Hermes looked in this order:' || chr(10)
           || string_agg(format('%s. %s on %s, %s %s', n.ord, n.tool, n.dom, n.n, case when n.n = 1 then 'call' else 'calls' end), chr(10) order by n.ord)
           || chr(10) || 'Only the order and the number of calls were observed; the questions, the arguments and the results were not copied.' as procedure
      from runs r join numbered n on n.run_id = r.run_id
     group by r.run_id, r.job_id, r.project_id, r.finished_at
    having count(*) between 2 and 10
  ),
  keyed as (
    select distinct on (app.engine_skill_key(pr.procedure, pr.project_id)) pr.*, app.engine_skill_key(pr.procedure, pr.project_id) as key
      from procs pr
     order by app.engine_skill_key(pr.procedure, pr.project_id), pr.finished_at desc
  ),
  offers as (
    select kd.project_id as pid, kd.key, kd.finished_at, kd.k,
           jsonb_build_object(
             'name', format('Where Hermes looked first (%s)', left(kd.key, 8)),
             'when', 'A question on this project that needs its own documents, tasks or other records',
             'procedure', kd.procedure, 'scope', 'project', 'project_id', kd.project_id, 'tools', jsonb_build_array('db.read'),
             'from_job', kd.job_id, 'source', 'observed', 'run_id', kd.run_id,
             'dropped', jsonb_build_array('The questions, the arguments and the results of each call were not copied.')) as offer
      from keyed kd
  )
  select 'engine.skill'::text, o.pid, o.key,
         format('Hermes answered a question on this project by looking in %s places in a set order. Teach the team that order?', o.k)::text,
         jsonb_build_object('source', 'observed', 'run_id', o.offer ->> 'run_id', 'steps', o.k),
         40, 'teach_skill'::text, o.offer
    from offers o
   where app.engine_skill_offer_problem(o.offer) is null
     -- Never again once the same technique has a suggestion in any state but stale: open, rejected, or accepted and since withdrawn.
     and not exists (select 1 from public.suggestions s where s.office_id = p_office and s.kind = 'engine.skill'
                        and s.subject_ref = o.key and s.state <> 'stale')
   order by o.finished_at desc
   limit greatest(v_cap - v_today, 0);
end
$f$;
revoke all on function app.engine_observed_skill_offers(uuid) from public, anon, authenticated, service_role;

do $splice$
declare v_def text; v_new text; v_step text;
begin
  -- decide_suggestion: from the live definition, three additions, each asserted to have landed.
  v_def := pg_get_functiondef('app.decide_suggestion(uuid,uuid,boolean,text)'::regprocedure);
  v_new := v_def;

  v_step := replace(v_new, E'  v_did  jsonb;\nbegin', E'  v_did  jsonb;\n  v_problem text;\nbegin');
  if v_step = v_new then raise exception '1073: decide_suggestion declare anchor did not land'; end if;
  v_new := v_step;

  v_step := replace(v_new, E'  if s.offer_kind = ''teach_skill'' then\n', $a$  if s.kind = 'engine.skill' then
    -- An offer Hermes had a hand in is read again from the stored row at the moment of the press (1073): the validator that admitted
    -- it, the key that identifies it, and the run it came from. A row changed since it was raised no longer matches and is refused.
    v_problem := app.engine_skill_offer_problem(s.offer_args);
    if v_problem is not null then
      return jsonb_build_object('error', v_problem);
    end if;
    if s.offer_kind is distinct from 'teach_skill'
       or s.project_id is distinct from nullif(s.offer_args ->> 'project_id', '')::uuid
       or s.subject_ref is distinct from app.engine_skill_key(s.offer_args ->> 'procedure', nullif(s.offer_args ->> 'project_id', '')::uuid) then
      return jsonb_build_object('error', 'This offer no longer matches what was raised, so it was not accepted.');
    end if;
    if not exists (select 1 from public.engine_runs r
                    where r.run_id = (s.offer_args ->> 'run_id')::uuid and r.office_id = p_office
                      and r.project_id = s.project_id and r.job_id = (s.offer_args ->> 'from_job')::uuid and r.state = 'completed') then
      return jsonb_build_object('error', 'The run this came from is not a finished run of this project in this office.');
    end if;
  end if;

  if s.offer_kind = 'teach_skill' then
$a$);
  if v_step = v_new then raise exception '1073: decide_suggestion teach_skill anchor did not land'; end if;
  v_new := v_step;

  v_step := replace(v_new, E'        p_from_job => nullif(s.offer_args ->> ''from_job'', '''')::uuid);',
    E'        p_tools => coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(s.offer_args -> ''tools'') = ''array'' then s.offer_args -> ''tools'' else ''[]''::jsonb end)), ''{}''::text[]),\n        p_from_job => nullif(s.offer_args ->> ''from_job'', '''')::uuid);');
  if v_step = v_new then raise exception '1073: decide_suggestion tools anchor did not land'; end if;
  v_new := v_step;
  execute v_new;

  -- notice: the observed-technique offers join the existing daily round.
  v_def := pg_get_functiondef('app.notice(uuid,integer)'::regprocedure);
  v_new := replace(v_def, E'      union all select * from idle_source\n', E'      union all select * from idle_source\n      union all select * from app.engine_observed_skill_offers(p_office)\n');
  if v_new = v_def then raise exception '1073: notice anchor did not land'; end if;
  execute v_new;
end
$splice$;
