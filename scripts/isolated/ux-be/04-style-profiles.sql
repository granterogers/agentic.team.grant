-- Proof for 0923: style profiles - storage, validation, field-level inheritance, isolation. Local replica only; rolls back.
\set ON_ERROR_STOP on
begin;
set local application_name = 'PostgREST proof';
do $t$
declare
  a uuid := (select office_id from public.offices where kind = 'person' limit 1);
  b uuid := (select office_id from public.offices where kind = 'test' limit 1);
  pa uuid; pb uuid; r jsonb; doc uuid; docb uuid; msg text;
begin
  insert into public.projects (office_id, slug, name) values (a, 'zz-st-a', 'Style A') returning project_id into pa;
  insert into public.projects (office_id, slug, name) values (b, 'zz-st-b', 'Style B') returning project_id into pb;
  insert into public.documents (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (a, pa, 'Logo', 'note', 'x', repeat('7',64), 1, now(), 'you') returning document_id into doc;
  insert into public.documents (office_id, project_id, title, doc_type, content, content_fingerprint, content_chars, fetched_at, added_by)
    values (b, pb, 'Foreign logo', 'note', 'y', repeat('8',64), 1, now(), 'you') returning document_id into docb;

  -- empty: nothing set, nothing invented
  r := app.hq_style_get(a, null);
  if r -> 'profile' <> '{}'::jsonb or r ->> 'scope' <> 'office' then raise exception 'empty office style: %', r; end if;
  if (r -> 'vocabulary' -> 'fonts') <> '["Helvetica","Times"]'::jsonb then raise exception 'vocabulary'; end if;

  -- office default: aliases normalise, colours lower-case
  r := app.hq_style_set(a, null, '{"palette":{"primary":"#1F5A85","accent":"#E8A04A"},"typography":{"heading":"Arial","body":"serif"},"tone":"plain and warm","formatting":{"title_page":"band"},"structure":{"sections":["Summary","Findings"]}}', 'teamhq', 'grant');
  if r ? 'error' then raise exception 'office set: %', r; end if;
  if r -> 'profile' #>> '{palette,primary}' <> '#1f5a85' then raise exception 'hex not normalised'; end if;
  if r -> 'profile' #>> '{typography,heading}' <> 'Helvetica' or r -> 'profile' #>> '{typography,body}' <> 'Times' then raise exception 'font alias not normalised: %', r; end if;
  if r -> 'profile' #>> '{source,kind}' <> 'manual' then raise exception 'source should read manual'; end if;

  -- project override: only some fields; the rest inherit, and each field says where from
  r := app.hq_style_set(a, 'zz-st-a', '{"palette":{"primary":"#aa3322"},"tone":"formal","structure":{"sections":["Brief"]}}', 'claude', 'grant');
  if r ? 'error' then raise exception 'project set: %', r; end if;
  if r -> 'profile' #>> '{palette,primary}' <> '#aa3322' then raise exception 'project colour must win'; end if;
  if r -> 'profile' #>> '{palette,accent}' <> '#e8a04a' then raise exception 'unset project colour must inherit'; end if;
  if r -> 'profile' #>> '{typography,heading}' <> 'Helvetica' then raise exception 'typography must inherit'; end if;
  if r -> 'profile' -> 'structure' -> 'sections' <> '["Brief"]'::jsonb then raise exception 'arrays replace, never splice: %', r -> 'profile' -> 'structure'; end if;
  if r -> 'inherited_from' ->> 'palette.primary' <> 'project' or r -> 'inherited_from' ->> 'palette.accent' <> 'office'
     or r -> 'inherited_from' ->> 'tone' <> 'project' or r -> 'inherited_from' ->> 'typography.body' <> 'office'
     or r -> 'inherited_from' ->> 'formatting.title_page' <> 'office' then raise exception 'inherited_from: %', r -> 'inherited_from'; end if;
  -- the office default is untouched by the project override
  if app.hq_style_get(a, null) -> 'profile' #>> '{palette,primary}' <> '#1f5a85' then raise exception 'override leaked into office default'; end if;
  -- the event records the door (claude) and the FIELDS, never the values
  if not exists (select 1 from public.events where action_type = 'style.updated' and origin_channel = 'claude' and office_id = a
                   and rationale_summary like '%palette, structure, tone%' and rationale_summary not like '%aa3322%') then
    raise exception 'style event door/fields'; end if;

  -- patch semantics: JSON null removes; removing the last project field returns to pure inheritance
  r := app.hq_style_set(a, 'zz-st-a', '{"palette":{"primary":null},"tone":null,"structure":null}', 'teamhq', 'grant');
  if r -> 'profile' #>> '{palette,primary}' <> '#1f5a85' then raise exception 'null did not remove the project colour'; end if;
  if r -> 'inherited_from' ->> 'tone' <> 'office' then raise exception 'tone should inherit again'; end if;

  -- validation: refused BY NAME, nothing stored
  for msg in select unnest(array[
      '{"typography":{"heading":"Comic Sans"}}', '{"palette":{"primary":"red"}}', '{"palette":{"primary":"#12345"}}',
      '{"palette":{"neon":"#ffffff"}}', '{"tone":123}', '{"formatting":{"title_page":"fancy"}}', '{"bogus":1}',
      '{"chart":{"series_colors":["#fff"]}}', '{"source":{"kind":"saved_from_document"}}', '{"terminology":{"a":1}}',
      '{"logo_document_id":"not-a-uuid"}', '[]', '{"structure":{"sections":"Summary"}}', '{"instructions":{}}']) loop
    r := app.hq_style_set(a, 'zz-st-a', msg::jsonb, 'teamhq', 'grant');
    if not (r ? 'error') then raise exception 'accepted invalid patch %', msg; end if;
  end loop;
  -- ...and the stored profile is unchanged by all of those
  if (select count(*) from public.style_profiles where office_id = a) <> 1 then raise exception 'a refused patch changed rows (project row should be gone: empty)'; end if;
  -- the table CHECK also refuses a raw write (no writer can bypass the validator)
  begin
    insert into public.style_profiles (office_id, scope, profile) values (b, 'office', '{"typography":{"body":"Comic Sans"}}');
    raise exception 'raw insert of an invalid profile succeeded';
  exception when check_violation then null; end;
  begin
    insert into public.style_profiles (office_id, scope, project_id, profile) values (b, 'project', pa, '{}');
    raise exception 'a project of another office was accepted';
  exception when foreign_key_violation then null; end;

  -- documents: a logo must be a document of THIS office (and project, for a project's profile)
  r := app.hq_style_set(a, null, jsonb_build_object('logo_document_id', doc), 'teamhq', 'grant');
  if r ? 'error' then raise exception 'own logo refused: %', r; end if;
  r := app.hq_style_set(a, null, jsonb_build_object('logo_document_id', docb), 'teamhq', 'grant');
  if not (r ? 'error') then raise exception 'another office''s document accepted as a logo'; end if;
  r := app.hq_style_set(a, null, jsonb_build_object('source', jsonb_build_object('kind','saved_from_document','document_id', docb)), 'teamhq', 'grant');
  if not (r ? 'error') then raise exception 'another office''s document accepted as a source'; end if;
  r := app.hq_style_set(a, null, jsonb_build_object('source', jsonb_build_object('kind','saved_from_document','document_id', doc)), 'teamhq', 'grant');
  if r ? 'error' then raise exception 'own source refused: %', r; end if;

  -- tenant isolation: office B sees nothing of A's, cannot reach A's project, and writes only its own
  if app.hq_style_get(b, null) -> 'profile' <> '{}'::jsonb then raise exception 'B sees A''s default'; end if;
  if not (app.hq_style_get(b, 'zz-st-a') ? 'error') then raise exception 'B read A''s project'; end if;
  if not (app.hq_style_set(b, 'zz-st-a', '{"tone":"x"}', 'teamhq', 'x') ? 'error') then raise exception 'B wrote A''s project'; end if;
  r := app.hq_style_set(b, 'zz-st-b', '{"tone":"b only"}', 'teamhq', 'x');
  if r ? 'error' then raise exception 'B own set: %', r; end if;
  if app.hq_style_get(a, 'zz-st-a') -> 'profile' ->> 'tone' = 'b only' then raise exception 'B leaked into A'; end if;
  if app.hq_style_get(a, null) -> 'profile' ->> 'tone' <> 'plain and warm' then raise exception 'A default changed by B'; end if;

  -- clear: a field, then everything; clearing what is not set says so; clearing nothing does not raise
  r := app.hq_style_clear(a, null, 'tone', 'teamhq', 'grant');
  if r -> 'profile' ? 'tone' then raise exception 'tone not cleared'; end if;
  if not (app.hq_style_clear(a, null, 'tone', 'teamhq', 'grant') ? 'error') then raise exception 'clearing an unset field should say so'; end if;
  r := app.hq_style_clear(a, null, null, 'teamhq', 'grant');
  if r -> 'profile' <> '{}'::jsonb then raise exception 'clear all: %', r; end if;
  if (app.hq_style_clear(a, 'zz-st-a') ->> 'cleared') <> 'false' then raise exception 'clear nothing'; end if;
  if not exists (select 1 from public.events where action_type = 'style.cleared' and office_id = a) then raise exception 'clear event'; end if;
  -- the public (page) wrapper writes the channel itself
  r := public.hq_style_set(a, '{"tone":"from the page"}', null, 'grant');
  if not exists (select 1 from public.events where action_type = 'style.updated' and origin_channel = 'teamhq' and rationale_summary like '%tone%') then raise exception 'page wrapper must record teamhq'; end if;
  -- no office, no answer
  begin perform app.hq_style_get('00000000-0000-0000-0000-000000000000'); raise exception 'no_office should refuse'; exception when sqlstate '42501' then null; end;
  raise notice 'PASS 04-style-profiles';
end $t$;
rollback;
