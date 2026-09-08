-- 0134 — Saying "I cannot hear you"
--
-- 0133 set `voice.transcription = 'none'`, because with GitHub Actions switched
-- off there is nothing that can run faster-whisper. The webhook has to say so
-- when a voice note arrives, and to say anything it needs the bot's token — and
-- it has none.
--
-- ## Why one narrow function rather than a token reader
--
-- The obvious move is an RPC that returns a bot's token, and it is the wrong
-- shape: a general token reader is a general token reader, reachable for any
-- purpose, and 0124 was explicit that `token_ref` must never surface in a
-- projection. This answers one question — "should I refuse this voice note,
-- and if so what do I speak with" — and returns the token ONLY in the case
-- where it is about to be used to speak. When transcription is available it
-- returns no token at all, because none is needed.
--
-- The caller already holds the service key and could read the vault directly;
-- narrowing is not about what it could do, it is about what the next reader of
-- this schema will think is normal.

begin;

create or replace function app.voice_refusal(p_bot_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when coalesce(
      (select value #>> '{}' from public.system_config where key = 'voice.transcription'),
      'none'
    ) <> 'none'
      then jsonb_build_object('refuse', false)
    else jsonb_build_object(
      'refuse', true,
      'token', (select app.resolve_secret(t.token_ref)
                  from public.telegram_bots t
                 where t.bot_id = p_bot_id and t.enabled and t.token_ref is not null)
    )
  end
$$;

revoke all on function app.voice_refusal(text) from public;
grant execute on function app.voice_refusal(text) to service_role;

create or replace function public.voice_refusal(p_bot_id text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.voice_refusal(p_bot_id) $$;

revoke all on function public.voice_refusal(text) from public;
grant execute on function public.voice_refusal(text) to service_role;

commit;
