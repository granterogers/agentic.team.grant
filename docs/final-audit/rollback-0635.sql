-- Rollback of 0635: Stop only stamps the request, as before.
begin;
do $m$
declare v_def text; v_start int; v_end int;
begin
  v_def := pg_get_functiondef('app.request_stop(uuid,text)'::regprocedure);
  v_start := position(E'  if v_state in (''paused'', ''queued'', ''retrying'')' in v_def);
  v_end := position(E'  update public.jobs\n     set stop_requested_at = coalesce(stop_requested_at, app.now_utc()),' in v_def);
  if v_start = 0 or v_end = 0 or v_end < v_start then raise exception 'rollback 0635: 0635 is not applied'; end if;
  execute substr(v_def, 1, v_start - 1) || substr(v_def, v_end);
end $m$;
commit;
