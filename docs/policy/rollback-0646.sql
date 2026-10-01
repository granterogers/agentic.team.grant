-- Rollback of 0646: the dial's copy returns to 0633's (which names the four duties as not governed - now untrue; use only to undo a bad deploy).
begin;
create or replace function app.autonomy_choices()
returns jsonb language sql immutable set search_path to '' as $f$
  select jsonb_build_array(
    jsonb_build_object('id', 'observe', 'name', 'Watch only',
      'note', 'The team reads and reports and starts nothing for you. Slack channels and key, Notion and the task board are not governed by this dial yet.'),
    jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
      'note', 'Every action you ask for outside our own records waits for you - except Slack channels and key, Notion and the task board, which this dial does not govern yet.'),
    jsonb_build_object('id', 'act_with_review', 'name', 'Act, then show me',
      'note', 'Routine work proceeds and lands in front of you afterwards.'),
    jsonb_build_object('id', 'act', 'name', 'Act',
      'note', 'Only purchases and destructive changes stop and ask.')
  )
$f$;
commit;
