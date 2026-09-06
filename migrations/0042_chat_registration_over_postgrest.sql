-- 0042 — the registration the webhook can actually call
--
-- 0041 put `record_telegram_chat` in the `app` schema, where every other
-- function in this system lives. The webhook then could not call it: PostgREST
-- exposes only the schemas it is configured for, `app` is not one of them, and
-- an RPC to an unexposed schema fails.
--
-- It failed silently, which is the more interesting half. The webhook's call
-- ended in `.catch(() => undefined)` — deliberately, because failing to
-- register a chat must not make Telegram retry an update that was otherwise
-- handled. But "must not fail the request" was implemented as "must not be
-- noticed", and the endpoint returned 200 having done nothing. The check that
-- caught it asserted the CONSEQUENCE — a row exists afterwards — rather than
-- the status code, which was 200 and meaningless.
--
-- Two fixes, one here and one in the handler. Here: a thin `public` wrapper,
-- which is the narrowest thing that makes the call reachable. The logic stays
-- in `app` where the rest of it is; this is an exposure decision, not a second
-- implementation.
--
-- Note what is NOT done: exposing the `app` schema to PostgREST. That would
-- make every internal function callable over HTTP with the anon key as the only
-- thing standing in the way, to fix one call.

begin;

/**
 * PostgREST-reachable registration. Wrapper only — see `app.record_telegram_chat`.
 *
 * Argument names are the parameter names PostgREST binds from the JSON body,
 * so they are part of the contract with the webhook and cannot be renamed
 * without changing it.
 */
create or replace function public.record_telegram_chat(
  p_chat_id text,
  p_chat_type text,
  p_bot_id text,
  p_subject text default null,
  p_title text default null,
  p_username text default null
)
returns text
language sql
security definer
set search_path = ''
as $$
  select app.record_telegram_chat(p_chat_id, p_chat_type, p_bot_id, p_subject, p_title, p_username);
$$;

comment on function public.record_telegram_chat(text, text, text, text, text, text) is
  'Exposure wrapper so the Telegram webhook can register a chat over PostgREST. '
  'The logic is in app.record_telegram_chat; this exists because the app schema '
  'is deliberately not exposed.';

-- Only the webhook. Not anon: an unauthenticated caller able to register a chat
-- could point the pager at itself.
revoke all on function public.record_telegram_chat(text, text, text, text, text, text) from public;
grant execute on function public.record_telegram_chat(text, text, text, text, text, text)
  to service_role;

commit;
