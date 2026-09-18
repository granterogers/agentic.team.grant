/*
  0486 — the OAuth pages have never rendered (#172).

  Grant reconnected Google this morning. It worked — a refresh token landed at
  10:00:57 with all five scopes, Gmail went from 164 to 194 cached messages and
  from a fortnight stale to today, Calendar and Drive both read. Then he sent
  the callback URL back and said *"it just gave me this"*, because the
  confirmation page was unreadable.

  ## What is actually wrong, established by probing rather than reading

  `google-oauth`'s `page()` helper sets `content-type: text/html; charset=utf-8`
  and the wire says:

      HTTP/2 400
      content-type: text/plain
      x-content-type-options: nosniff

  **Supabase rewrites it.** The control settles it: `hq-api` returns
  `application/json; charset=utf-8` through the same gateway, untouched — so it
  is not a header we failed to set, it is the shared `*.supabase.co` functions
  domain refusing to serve HTML, which is an ordinary anti-phishing measure on
  a host thousands of projects share. `nosniff` then guarantees the browser
  will NOT guess, so the markup is rendered as text.

  So every page this function has ever produced — the success page, the two
  failure pages and the 404 — has been a wall of raw HTML. It has never worked,
  for anybody, and the only reason it surfaced today is that Grant was asked to
  use it.

  Fourth instance this run of a path that looks right, compiles, returns a 2xx
  and has never done what it says: `attachFile.storagePath`, the duty whose
  handler the deployed worker did not carry, the Connect Google button asking
  for a third of what it needs, and this.

  ## The fix is to stop trying

  A header cannot win an argument with the host. The callback REDIRECTS to the
  studio, which is on our own domain and may serve whatever it likes — and that
  is the better product anyway: the old page was a dead end with no way back
  into the app, which is the complaint #216 exists for.

  This migration records WHERE to redirect to. Not hardcoded in the edge
  function, for the same reason `notebook.reader_url` is not: the deployment
  URL is a fact about the environment and belongs in `system_config` where it
  can be changed without a deploy.
*/

insert into public.system_config (key, value, description)
values (
  'app.base_url',
  to_jsonb('https://ai-team-hq.vercel.app'::text),
  'Where Team HQ is served. Used by google-oauth to send a person back into '
  || 'the app after consent, because Supabase will not serve HTML from the '
  || 'shared functions domain (0486).'
)
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

/*
  A reader the edge function can call with no bearer token, the same way it
  already calls `google_service_scopes`. It returns one public URL and nothing
  else.
*/
create or replace function app.app_base_url()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    nullif(btrim((select value #>> '{}' from public.system_config where key = 'app.base_url')), ''),
    '')
$function$;

create or replace function public.app_base_url()
returns text
language sql
stable
security definer
set search_path to ''
as $function$ select app.app_base_url() $function$;

revoke all on function public.app_base_url() from public;
grant execute on function public.app_base_url() to service_role;
grant execute on function public.app_base_url() to anon;

do $drive$
declare v text := app.app_base_url();
begin
  if v = '' then
    raise exception '0486: no app base url — the callback would have nowhere to send anybody';
  end if;
  if v not like 'https://%' then
    raise exception '0486: the app base url is not https — %', v;
  end if;
  if right(v, 1) = '/' then
    raise exception '0486: trailing slash would make a double slash in the redirect — %', v;
  end if;
  raise notice '0486: consent will return people to %', v;
end $drive$;
