-- 0085 — The button vocabulary grew
--
-- 0011 constrained `inbound_commands.callback_action` to §12's six buttons, and
-- 0083 added a seventh and an eighth. A press on Go ahead was refused by the
-- database, reported by the webhook as a 503, and retried by Telegram forever.
--
-- Exactly 0076's shape: a rule written when the list was complete, still there
-- when the list stopped being complete. That one cost a voice note; this one
-- cost the approval button that was the whole point of the feature. Twice is a
-- pattern, so the comment below names every place this list now lives.
--
-- ## Three copies, and why that is tolerable
--
--   * this constraint
--   * `ACTIONS` in `src/slack/blocks.ts` (the ids Slack sends)
--   * `CALLBACK_ACTIONS` in `src/channels/telegram.ts` (the words Telegram sends)
--
-- The two TypeScript ones are one source in practice: `CALLBACK_ACTIONS` is
-- typed `Record<ActionId, string>`, so adding an action without mapping it does
-- not compile. This constraint is the copy that can drift silently, which is
-- why `verify:slack` now inserts every one of them and fails if any is refused.
-- A comment saying "keep these in step" would have been here already and would
-- have been ignored twice.

begin;

alter table public.inbound_commands
  drop constraint inbound_callback_action_known;

alter table public.inbound_commands
  add constraint inbound_callback_action_known
    check (
      callback_action is null
      or callback_action in (
        -- §12's six.
        'useful', 'not_useful', 'undo', 'open_project', 'mute_24h', 'more_detail',
        -- 0083's two. Not §12, and load-bearing: nothing is generated in the
        -- notebook until one of them is pressed.
        'approve', 'decline'
      )
    );

comment on constraint inbound_callback_action_known on public.inbound_commands is
  'The button vocabulary. Kept in step with ACTIONS in src/slack/blocks.ts and '
  'CALLBACK_ACTIONS in src/channels/telegram.ts by a check in verify:slack, '
  'because a comment asking for it to be kept in step was ignored twice.';

commit;
