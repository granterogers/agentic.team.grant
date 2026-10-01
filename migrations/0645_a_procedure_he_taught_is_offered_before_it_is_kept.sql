-- 0645 - a procedure is a standing way of acting, so it is OFFERED and kept only on his press.
--
-- Grant's decision 5: the office may learn ordinary preferences on its own, but nothing it learned becomes a durable
-- rule, permission, automation or behavioural policy without his explicit confirmation. A standing RULE already has
-- its confirmation route (`app.propose_standing_rule`, and `app.decide_suggestion` is the only way an offer becomes
-- a lesson). A PROCEDURE (`app.teach_skill`) had none: it was stored from his marked words with a say-back. This gives
-- it the same one, rather than another mechanism:
--
--   * `app.propose_standing_procedure` puts the drafted procedure on the Governance page as an offer whose kind is
--     `teach_skill`; like the rule offer it carries `from_job`, so `app.harness_suggestion` keeps a harness's offers
--     off his page (0543), and a procedure he already answered is not offered again.
--   * `app.decide_suggestion` performs a `teach_skill` offer on an accept. The write is the same `app.teach_skill`
--     with the same ADR-0017 boundary (an address or a credential in a procedure is refused), and a refusal is
--     returned as an error to the press rather than raised, so a refused procedure leaves the offer open.
--
-- Rebuilt from the LIVE definition of decide_suggestion; refuses to apply if the text it replaces is not there.

create function app.propose_standing_procedure(p_name text, p_when text, p_procedure text, p_scope text default 'global',
                                               p_staff text default null, p_project_id uuid default null,
                                               p_from_job uuid default null, p_because jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_catalog' as $f$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_proc text := btrim(coalesce(p_procedure, ''));
  v_staff text := nullif(btrim(coalesce(p_staff, '')), '');
  v_ref text;
  v_id uuid;
begin
  if length(v_name) < 3 or length(v_proc) < 12 then
    return jsonb_build_object('error', 'a procedure needs a name and something to do');
  end if;
  if p_scope not in ('global', 'project', 'staff') then
    return jsonb_build_object('error', format('%L is not a scope a procedure can be offered at', p_scope));
  end if;
  if p_scope = 'project' and p_project_id is null then
    return jsonb_build_object('error', 'a project procedure needs a project');
  end if;
  if p_scope = 'staff' and v_staff is null then
    return jsonb_build_object('error', 'a procedure for one person needs to say who');
  end if;
  v_ref := left(regexp_replace(lower(v_name || ' ' || v_proc), '[^a-z0-9]+', '-', 'g'), 120);
  -- Any row, not only an open one: a declined procedure must not come back.
  if exists (select 1 from public.suggestions s where s.kind = 'standing_procedure' and s.subject_ref = v_ref) then
    return jsonb_build_object('offered', false, 'why', 'already offered once');
  end if;
  insert into public.suggestions (project_id, kind, subject_ref, body, because, weight, offer_kind, offer_args)
  values (p_project_id, 'standing_procedure', v_ref,
          left(format('%s: %s', v_name, v_proc), 400), coalesce(p_because, '{}'::jsonb), 3, 'teach_skill',
          jsonb_build_object('name', v_name, 'when', btrim(coalesce(p_when, '')), 'procedure', v_proc,
                             'scope', p_scope, 'staff', case when p_scope = 'staff' then v_staff end,
                             'project_id', case when p_scope = 'project' then p_project_id end,
                             'from_job', p_from_job))
  returning suggestion_id into v_id;
  return jsonb_build_object('offered', true, 'suggestion', v_id, 'name', v_name);
end;
$f$;

do $m$
declare
  v_def text;
  v_anchor constant text := E'  update public.suggestions\n     set state = ''acted'', settled_at = app.now_utc()\n   where suggestion_id = p_suggestion_id;';
begin
  v_def := pg_get_functiondef('app.decide_suggestion(uuid,boolean,text)'::regprocedure);
  if position(v_anchor in v_def) = 0 then
    raise exception '0645: the settle step is not where it was expected in app.decide_suggestion';
  end if;
  v_def := replace(v_def, v_anchor, $r$  if s.offer_kind = 'teach_skill' then
    -- The only path by which a procedure he taught is kept, and it is reachable only from a press. The same writer and
    -- the same ADR-0017 boundary as before; a refusal is an answer to the press, and the offer stays open.
    begin
      v_did := app.teach_skill(
        p_name => s.offer_args ->> 'name',
        p_when_to_use => coalesce(nullif(s.offer_args ->> 'when', ''), 'when it comes up'),
        p_procedure => s.offer_args ->> 'procedure',
        p_authored_by => p_by,
        p_scope => (s.offer_args ->> 'scope')::lesson_scope,
        p_project_id => nullif(s.offer_args ->> 'project_id', '')::uuid,
        p_staff_slug => nullif(s.offer_args ->> 'staff', ''),
        p_from_job => nullif(s.offer_args ->> 'from_job', '')::uuid);
    exception when others then
      return jsonb_build_object('error', left(sqlerrm, 300));
    end;
    if v_did ? 'error' then
      return jsonb_build_object('error', v_did ->> 'error');
    end if;
  end if;

$r$ || v_anchor);
  execute v_def;
end $m$;
