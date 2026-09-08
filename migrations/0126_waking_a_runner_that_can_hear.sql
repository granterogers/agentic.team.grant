-- 0126 — Waking a runner that can hear
--
-- 0125 stopped the Edge worker from claiming voice notes it cannot transcribe.
-- Correct, and it leaves a gap: a voice note now waits for the GitHub Actions
-- worker, and Actions is exactly the thing that ran six times in fourteen hours
-- while claiming every five minutes. Grant's original complaint would be fixed
-- for typed messages and still true for spoken ones — and spoken ones are how
-- he actually talks to the team.
--
-- Actions has one trigger that is not a schedule and is not best-effort:
-- `repository_dispatch`. A POST starts a run within seconds. It needs a GitHub
-- token, so this allow-lists one name in the vault and nothing more.
--
-- ## Why widen `vault_secret` rather than add a reader
--
-- 0095 allow-listed one name, 0109 widened it to two, and the shape has earned
-- its keep: a caller that wants a different secret must change this line, in a
-- migration, where it is reviewable. A second reader function would be a second
-- place to audit and the first one to be forgotten.
--
-- ## What the token can do, and what it cannot
--
-- A fine-grained token scoped to this repository with `contents: write` is
-- enough for `repository_dispatch` and is the whole grant. It cannot read
-- Actions secrets, and nothing here ever returns it to a browser — the only
-- caller is an Edge Function using the service key.
--
-- Absent, everything still works: `telegram-webhook` skips the dispatch and the
-- voice note is picked up on the next Actions cron. Late, never lost (§18).

begin;

create or replace function app.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_name not in (
    'google.client_secret',
    'google.refresh_token',
    -- Lets the Telegram webhook start a GitHub Actions run the moment a voice
    -- note lands, because the Edge worker cannot transcribe (0125) and the
    -- Actions schedule cannot be relied on to fire.
    'github.dispatch_token'
  ) then
    raise exception 'no' using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

insert into public.system_config (key, value, description)
values
  ('github.repository', to_jsonb('granterogers/agentic.team.grant'::text),
   'owner/repo that repository_dispatch wakes when a voice note needs a worker '
   'that can run faster-whisper.')
on conflict (key) do nothing;

/**
 * Everything the webhook needs to wake a runner, in one read.
 *
 * Returns nulls rather than raising when it is not configured: the caller's
 * correct behaviour is to skip the dispatch, and an exception would turn "no
 * token yet" into a failed webhook and a lost message.
 */
create or replace function app.github_dispatch()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'repository', (select value #>> '{}' from public.system_config
                    where key = 'github.repository'),
    'token', (select decrypted_secret from vault.decrypted_secrets
               where name = 'github.dispatch_token')
  )
$$;

revoke all on function app.github_dispatch() from public;
grant execute on function app.github_dispatch() to service_role;

create or replace function public.github_dispatch()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.github_dispatch() $$;

revoke all on function public.github_dispatch() from public;
grant execute on function public.github_dispatch() to service_role;

commit;
