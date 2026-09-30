-- Rollback of 0636: the job an approval starts inherits approval_next again, and the answer is judged by the word list.
begin;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.answer_generation_approval(uuid,boolean,text)'::regprocedure);
  execute replace(v_def, E'(coalesce(v_config, ''{}''::jsonb) - ''approval_next'')', E'coalesce(v_config, ''{}''::jsonb)');
  v_def := pg_get_functiondef('app.hq_answer_blocker(uuid,text,text)'::regprocedure);
  execute replace(v_def, E'case when b.decline_option is not null then v_answer <> b.decline_option\n           else lower(v_answer) in (''yes'', ''approve'', ''approved'', ''go ahead'', ''ok'', ''do it'') end,', E'lower(v_answer) in (''yes'', ''approve'', ''approved'', ''go ahead'', ''ok'', ''do it''),');
end $m$;
commit;
