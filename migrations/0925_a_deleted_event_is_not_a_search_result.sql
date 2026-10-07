-- 0925: a tombstoned event is not a search result.
-- Numbering note (6 Oct 2026): below, "0897" means the project calendar, now migration 0906. The Public Sample Office's
-- applied 0897 is a different migration.
--
-- 0921's calendar provider was written before 0897 existed and read whatever columns the table had. 0897's table
-- tombstones a deleted event (deleted_at) until the deletion has reached Google, so searching found events the person had
-- already deleted. The filter is added only when the column exists, so the provider still works on a deployment without it.
-- Spliced from the live definition; changed in exactly one place.

CREATE OR REPLACE FUNCTION app.psearch_events(p_office uuid, p_project uuid, p_q tsquery, p_limit integer)
 RETURNS TABLE(kind text, id text, title text, snippet text, project_slug text, url_hint text, score real, at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cols text[];
  v_id text; v_start text; v_desc text; v_loc text; v_text text;
begin
  if p_q is null or to_regclass('public.project_events') is null then return; end if;
  select array_agg(column_name::text) into cols
    from information_schema.columns where table_schema = 'public' and table_name = 'project_events';
  v_id    := case when 'event_id' = any(cols) then 'event_id' when 'id' = any(cols) then 'id' end;
  v_start := case when 'starts_at' = any(cols) then 'starts_at' when 'start_at' = any(cols) then 'start_at' end;
  v_desc  := case when 'description' = any(cols) then 'description' when 'notes' = any(cols) then 'notes'
                  when 'detail' = any(cols) then 'detail' end;
  v_loc   := case when 'location' = any(cols) then 'location' end;
  if v_id is null or v_start is null
     or not ('office_id' = any(cols) and 'project_id' = any(cols) and 'title' = any(cols)) then
    return;
  end if;
  v_text := format('coalesce(e.title, '''') || '' '' || coalesce(%s, '''') || '' '' || coalesce(%s, '''')',
                   case when v_desc is null then 'null' else 'e.' || quote_ident(v_desc) end,
                   case when v_loc is null then 'null' else 'e.' || quote_ident(v_loc) end);
  return query execute format($q$
    select 'event'::text,
           e.%1$I::text,
           coalesce(nullif(e.title, ''), '(untitled event)'),
           ts_headline('english', %2$s, $2, 'MaxWords=24, MinWords=4, ShortWord=3, MaxFragments=1'),
           p.slug,
           '/p/' || p.slug || '/schedule?focus=' || e.%1$I::text,
           ts_rank(to_tsvector('english', %2$s), $2),
           e.%3$I::timestamptz
      from public.project_events e
      join public.projects p on p.project_id = e.project_id and p.office_id = $1 and not p.is_fixture
     where e.office_id = $1
       and ($3 is null or e.project_id = $3)
       %4$s
       and to_tsvector('english', %2$s) @@ $2
     order by 7 desc, 8 desc
     limit greatest(1, least(coalesce($4, 20), 100))
  $q$, v_id, v_text, v_start, case when 'deleted_at' = any(cols) then 'and e.deleted_at is null' else '' end) using p_office, p_q, p_project, p_limit;
end
$function$;
