-- Rollback of 0633: the previous sentences.
begin;
create or replace function app.autonomy_choices()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'observe', 'name', 'Watch only',
      'note', 'The team reads and reports. It changes nothing anywhere.'),
    jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
      'note', 'Every action outside our own records waits for you.'),
    jsonb_build_object('id', 'act_with_review', 'name', 'Act, then show me',
      'note', 'Routine work proceeds and lands in front of you afterwards.'),
    jsonb_build_object('id', 'act', 'name', 'Act',
      'note', 'Only purchases and destructive changes stop and ask.')
  )
$$;
do $m$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.hq_studio_settings()'::regprocedure);
  execute replace(v_def, 'On Telegram, everyone else still works and still writes output; they just do not send. Slack shows each colleague under their own name.', 'Everyone else still works and still writes output. They just do not send.');
end $m$;
commit;
