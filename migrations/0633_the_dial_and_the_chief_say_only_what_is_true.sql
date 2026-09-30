-- 0633 - the Settings copy says what the office does (final audit, invariants 2, 22, 37).
--
-- Two sentences the product shows Grant were false, and a person decides things on them:
--
--   "Watch only: changes nothing anywhere"  and  "Ask me first: every action outside our own records waits for you"
--     Nine kinds of work write outside WITHOUT asking that time (Slack channels and the Slack key, Notion import
--     and sync, the task board, ...). They are held by containment, not by the dial - a decision Grant has not made
--     (#389, #390, #393). The dial still governs what it governs; the copy now says what it does not.
--   "Only the Chief of Staff messages me: everyone else ... just do not send"
--     True on Telegram (enforced at the pager); on Slack each colleague speaks under their own name by design.
--
-- Nothing about behaviour changes here. The functions are rebuilt from their LIVE definitions so a sentence is the
-- only thing that moves, and the migration refuses to apply if the sentence it means to replace is not there.

create or replace function app.autonomy_choices()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'observe', 'name', 'Watch only',
      'note', 'The team reads and reports and starts nothing for you. Its housekeeping (Slack channels and key, Notion sync, task board) is not governed by this dial yet.'),
    jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
      'note', 'Every action you ask for outside our own records waits for you. Housekeeping (Slack channels and key, Notion sync, task board) is not governed by this dial yet.'),
    jsonb_build_object('id', 'act_with_review', 'name', 'Act, then show me',
      'note', 'Routine work proceeds and lands in front of you afterwards.'),
    jsonb_build_object('id', 'act', 'name', 'Act',
      'note', 'Only purchases and destructive changes stop and ask.')
  )
$$;

do $m$
declare
  v_def text;
  v_old constant text := 'Everyone else still works and still writes output. They just do not send.';
  v_new constant text := 'On Telegram, everyone else still works and still writes output; they just do not send. Slack shows each colleague under their own name.';
begin
  v_def := pg_get_functiondef('app.hq_studio_settings()'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '0633: the sentence to replace is not in app.hq_studio_settings';
  end if;
  execute replace(v_def, v_old, v_new);
  if position(v_new in pg_get_functiondef('app.hq_studio_settings()'::regprocedure)) = 0 then
    raise exception '0633: the replacement did not land';
  end if;
end
$m$;
