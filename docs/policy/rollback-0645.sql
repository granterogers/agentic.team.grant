-- SAFE ONLY TOGETHER WITH THE CODE ROLLBACK: the worker that shipped with this migration calls what it removes. A
-- database-only rollback leaves a worker that fails (0640/0643) or degrades to its own project (0644) or reports that it
-- could not offer the teaching (0645); roll the worker back to the previous version first, then run this.
-- Rollback of 0645: a procedure is stored from his marked words again (it does NOT: the handler then says it could not put the teaching in front of him; roll the worker back first).
begin;
do $m$
declare v_def text; v_a int; v_b int;
begin
  v_def := pg_get_functiondef('app.decide_suggestion(uuid,boolean,text)'::regprocedure);
  v_a := position('  if s.offer_kind = ''teach_skill'' then' in v_def);
  v_b := position(E'  update public.suggestions\n     set state = ''acted''' in v_def);
  if v_a = 0 or v_b = 0 or v_b < v_a then raise exception 'rollback 0645: 0645 is not applied'; end if;
  execute substr(v_def, 1, v_a - 1) || substr(v_def, v_b);
end $m$;
-- Offers of a procedure still open have nothing to perform now: they are settled as stale rather than left to fail.
update public.suggestions set state = 'stale', settled_at = app.now_utc()
 where kind = 'standing_procedure' and state = 'open';
drop function app.propose_standing_procedure(text, text, text, text, text, uuid, uuid, jsonb);
commit;
