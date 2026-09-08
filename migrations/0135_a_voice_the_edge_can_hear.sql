-- 0135 — A voice the edge can hear
--
-- Grant chose (c): a speech API rather than a GitHub runner. That is a real
-- change of posture and it deserves recording rather than burying.
--
-- ## What we are giving up, and what we get
--
-- Until now the audio never left our own compute. `scripts/voice/transcribe.py`
-- ran faster-whisper on the same machine as the worker, and ADR-0009's
-- `data_collection: 'deny'` was the reason: a voice note carries Grant's actual
-- voice, and it was the last thing to make an exception for.
--
-- The exception is now made, deliberately and by him. What buys it:
--
--   * Actions is off entirely, and a subprocess is the one thing the free
--     runtime cannot do. Without this, voice notes do not work at all.
--   * It is FASTER, not merely cheaper. Transcription moves into the Edge
--     Function that pg_cron already kicks every minute and the Telegram
--     webhook kicks instantly — so a voice note is answered in the time one
--     API call plus one model call takes, rather than waiting for a runner to
--     boot, install and download a model.
--
-- ## Why the provider is configuration, not code
--
-- The endpoint is OpenAI-shaped (`/audio/transcriptions`, multipart, a `model`
-- field), and Groq, OpenAI and several others all speak it. So the base URL and
-- the model are settings and the key is a vault entry: switching provider, or
-- retreating to the local runner, is a settings change rather than a deploy.
--
-- `voice.transcription` keeps the three values 0133 defined. This migration
-- adds what 'api' needs and changes nothing on its own — the mode is still
-- whatever it was until the key exists.

begin;

insert into public.system_config (key, value, description)
values
  ('voice.api_base_url', to_jsonb('https://api.groq.com/openai/v1'::text),
   'OpenAI-shaped speech endpoint. Groq by default: fastest of the compatible '
   'ones and free at this volume. Any provider speaking the same shape works.'),
  ('voice.api_model', to_jsonb('whisper-large-v3-turbo'::text),
   'The transcription model. Considerably better than the base.en that ran '
   'locally, which is what turned "NotebookLM" into "Not-to-But".')
on conflict (key) do nothing;

/**
 * Everything the transcriber needs, in one read, or nulls.
 *
 * Returns the key ONLY when the mode is 'api' — the same shape as
 * `voice_refusal` in 0134, and for the same reason: a function that hands back
 * a credential regardless of whether it is about to be used is a credential
 * reader wearing a narrower name.
 */
create or replace function app.voice_transcriber()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when coalesce(
      (select value #>> '{}' from public.system_config where key = 'voice.transcription'),
      'none') <> 'api'
      then jsonb_build_object('mode', coalesce(
        (select value #>> '{}' from public.system_config where key = 'voice.transcription'),
        'none'))
    else jsonb_build_object(
      'mode', 'api',
      'base_url', (select value #>> '{}' from public.system_config
                    where key = 'voice.api_base_url'),
      'model', (select value #>> '{}' from public.system_config
                 where key = 'voice.api_model'),
      'key', (select decrypted_secret from vault.decrypted_secrets
               where name = 'voice.api_key')
    )
  end
$$;

revoke all on function app.voice_transcriber() from public;
grant execute on function app.voice_transcriber() to service_role;

create or replace function public.voice_transcriber()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.voice_transcriber() $$;

revoke all on function public.voice_transcriber() from public;
grant execute on function public.voice_transcriber() to service_role;

-- `voice_refusal` (0134) must now agree with reality: it refuses when the mode
-- is 'none', and 'api' is not 'none'. It already tests exactly that, so it
-- needs no change — noted here because a reader checking whether the refusal
-- still fires deserves the answer without going to look.

commit;
