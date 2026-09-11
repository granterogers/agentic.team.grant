-- Answer the button.
--
-- Issue #59. `answerCallbackQuery` is listed as idempotent in the Telegram
-- client and is **called from nowhere**. So pressing 👍 or 👎 leaves the little
-- spinner turning on the button until Telegram gives up. The press IS recorded
-- — `inbound_commands` takes it and the worker acts on it within the minute —
-- but nothing tells Grant that, and the only honest reading of a spinner that
-- never resolves is "it did not work".
--
-- Telegram wants that call within a few seconds, which rules out the worker:
-- the pass runs every minute. So the acknowledgement belongs in the webhook,
-- and the webhook needs the bot's token.
--
-- `voice_refusal` already established this exact shape — an RPC that takes a
-- bot id and returns a token for the webhook to send with — so this follows it
-- rather than inventing a second convention.
--
-- ## What it says
--
-- Different words per button, because "Done" on both is the same as no
-- acknowledgement. 👍 confirms; 👎 says a follow-up is coming, so the message
-- that arrives a moment later reads as an answer rather than as the office
-- suddenly asking him something.
--
-- The text is generated here rather than in the edge function so it can be
-- changed without a deploy — and so this migration is the one place that says
-- what a press means.

begin;

create or replace function app.callback_ack(p_bot_id text, p_action text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select jsonb_build_object(
    -- `app.resolve_secret`, the same helper `voice_refusal` uses. The token
    -- reaches the edge function and nowhere else: it is never logged, never
    -- returned to a caller that did not ask for it, and never printed.
    'token', (
      select app.resolve_secret(b.token_ref)
        from public.telegram_bots b
       where b.bot_id = p_bot_id and b.enabled and b.token_ref is not null
    ),
    'text', case p_action
      when 'useful'     then 'Noted — thank you'
      -- Says what happens next, so the question arriving in a moment reads as
      -- an answer rather than as the office starting a new conversation.
      when 'not_useful' then 'Noted. Tell me what I should have done'
      when 'undo'       then 'Undoing…'
      when 'approve'    then 'Go ahead — starting'
      when 'decline'    then 'Left alone'
      when 'mute_24h'   then 'Quiet for 24 hours'
      when 'more_detail' then 'Fetching the detail…'
      else 'Got it'
    end
  )
$$;

comment on function app.callback_ack(text, text) is
  'The toast shown the instant a Telegram button is pressed, and the token to '
  'send it with. Answering within seconds is Telegram''s requirement, so this '
  'is the webhook''s job and not the worker''s (#59).';

create or replace function public.callback_ack(p_bot_id text, p_action text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select app.callback_ack(p_bot_id, p_action) $$;

commit;
