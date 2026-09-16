begin;

-- ---------------------------------------------------------------------------
-- 0379 - an agent who answered a question has not "done nothing" (#25)
--
-- 0378's first run against a real project put Tom on the map as `idle`, saying
-- "nothing yet". He had run a job on that project and finished it; what he had
-- not done was produce a DOCUMENT, and the state machine only counted
-- documents, live jobs and impediments.
--
-- Most of what this office does is answer a question. An answer is an output,
-- not a document, so a map that measures work in documents reports the
-- commonest kind of work as nothing at all - and a node that says "nothing yet"
-- about somebody who answered is a state that is not merely unhelpful but
-- false.
--
-- `answered` counts completed jobs. It sits below `made` in the sentence,
-- because a document is the more specific fact and a person reading the map
-- wants the most specific true thing.
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc where oid = 'app.studio_plane(uuid)'::regprocedure;

  if position('as made' in v_def) = 0 then
    raise exception 'the agent state block did not look as expected - read it before replacing';
  end if;

  v_def := replace(v_def,
    '          where d.project_id = p_project_id and j3.recipient_agent = t.slug) as made',
    '          where d.project_id = p_project_id and j3.recipient_agent = t.slug) as made,' || E'\n' ||
    '         (select count(*) from public.jobs j4' || E'\n' ||
    '           where j4.project_id = p_project_id and j4.recipient_agent = t.slug' || E'\n' ||
    '             and j4.state = ''complete''' || E'\n' ||
    '             and not coalesce(app.harness_job(j4.job_id), false)) as answered');

  v_def := replace(v_def,
    '                         when a.made  > 0 then ''done''' || E'\n' ||
    '                         else ''idle'' end,',
    '                         when a.made  > 0 or a.answered > 0 then ''done''' || E'\n' ||
    '                         else ''idle'' end,');

  v_def := replace(v_def,
    '                         when a.made  > 0 then a.made::text  || '' made''' || E'\n' ||
    '                         else ''nothing yet'' end',
    '                         when a.made  > 0 then a.made::text  || '' made''' || E'\n' ||
    '                         when a.answered > 0 then a.answered::text || '' answered''' || E'\n' ||
    '                         else ''nothing yet'' end');

  if position('answered' in v_def) = 0 then
    raise exception 'none of the three replacements matched - the function has moved';
  end if;
  execute v_def;
end
$$;

commit;
