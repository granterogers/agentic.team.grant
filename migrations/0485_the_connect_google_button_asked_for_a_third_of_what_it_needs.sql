/*
  0485 — the Connect Google button asked for a third of what it needs.

  Found by probing the link before sending Grant to press it, which is the only
  reason it was found at all.

  `supabase/functions/google-oauth/start` takes a `service` query parameter and
  resolves its scopes from `public.google_services`. That per-service design is
  right and Grant asked for it in as many words — *"if someone wants to add
  connection to Gmail, connection to Google Calendar, you just click on a
  button and it brings up the Google authenticator"* — one consent screen per
  service, asking only for what that service needs.

  The **default** is the defect. With no parameter it falls back to
  `'calendar'`, and the Connect Google button in Settings links to the bare
  `/start`. So the one control in the product for reconnecting Google asks for
  `calendar.events` and `calendar.readonly` and nothing else — while
  `src/google/mail.ts`, `src/google/drive.ts` and `src/google/calendar.ts` all
  authenticate with the SAME `google.refresh_token`, and each callback REPLACES
  it.

  Pressing that button therefore reconnects Calendar and leaves Gmail and Drive
  dead. Which is exactly the state the office is in today — Google's token has
  been refused since 17 September — so the one action Grant was about to take
  to fix it would have fixed a third of it and looked like it had worked.

  Same family as `attachFile.storagePath` and the duty whose handler the
  deployed worker did not carry: a path that looks right, compiles, returns 302,
  and has never done what it says.

  ## What replaces the default, and why it is derived

  Not a hardcoded list of three slugs, which is the enumeration that goes stale
  the day a fourth service is used. `app.google_scopes_in_use()` is the union
  of scopes for every OFFERED Google service that the office actually has a
  capability for — `tool_permissions` rows enabled under the service's own
  name, which is the same word as the slug.

  Today that is `gmail` (2 enabled tools), `calendar` (2) and `drive` (1).
  **`youtube` is offered and has none, so it is not asked for** — over-asking on
  a consent screen is its own defect, and a person who sees a scope they did
  not expect is right to stop.

  The safety property of the existing code is kept exactly: an UNKNOWN service
  still resolves to the empty string and still asks for no permission rather
  than for somebody else's. Only an absent parameter, or the literal word
  `all`, gets the union.
*/

create or replace function app.google_scopes_in_use()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  /*
    Distinct, because two services can legitimately want the same scope and a
    consent URL that repeats one is not wrong but is untidy in the one place a
    person reads it carefully. Ordered, so the same set produces the same
    string and a diff of a consent URL means something.
  */
  select coalesce(
    (select string_agg(s, ' ' order by s)
       from (
         select distinct unnest(string_to_array(g.scopes, ' ')) as s
           from public.google_services g
          where g.offered
            and exists (
              select 1 from public.tool_permissions t
               where t.enabled and t.tool like g.slug || '.%')
       ) x
      where s <> ''),
    '')
$function$;

comment on function app.google_scopes_in_use() is
  'Every Google scope the office actually has an enabled capability for (#172). '
  'The default for the Connect Google button, which asked for Calendar alone '
  'while Gmail and Drive share the same refresh token.';

create or replace function public.google_scopes_in_use()
returns text
language sql
stable
security definer
set search_path to ''
as $function$ select app.google_scopes_in_use() $function$;

revoke all on function public.google_scopes_in_use() from public;
grant execute on function public.google_scopes_in_use() to service_role;
grant execute on function public.google_scopes_in_use() to anon;

/*
  `anon` because the OAuth start endpoint is reached by a person following a
  link and has no bearer token — the same reason `google_service_scopes` is
  already reachable that way. It returns a list of Google scope URLs, which are
  public constants, and nothing else.
*/

-- ---------------------------------------------------------------------------
-- Drive it, including the two things that could quietly be wrong
-- ---------------------------------------------------------------------------

do $drive$
declare
  v_all text := app.google_scopes_in_use();
begin
  if v_all = '' then
    raise exception '0485: the union is empty — no Google capability is enabled?';
  end if;
  if position('gmail.readonly' in v_all) = 0 then
    raise exception '0485: Gmail is enabled and not in the consent — %', v_all;
  end if;
  if position('calendar.readonly' in v_all) = 0 then
    raise exception '0485: Calendar is enabled and not in the consent — %', v_all;
  end if;
  if position('drive.readonly' in v_all) = 0 then
    raise exception '0485: Drive is enabled and not in the consent — %', v_all;
  end if;
  /*
    CONTROL: and it does not over-ask. YouTube is offered and no tool uses it,
    so a consent screen that named it would be asking Grant for reach the
    office has no use for — which is the defect this migration fixes, with the
    sign reversed.
  */
  if position('youtube' in v_all) > 0 then
    raise exception '0485: youtube has no enabled tool and is being asked for — %', v_all;
  end if;
  /*
    CONTROL: and the per-service door is unchanged, including its safety
    property. An unknown service must still ask for nothing.
  */
  if app.google_service_scopes('gmail') = v_all then
    raise exception '0485: the per-service door now returns the union';
  end if;
  if app.google_service_scopes('not-a-service') <> '' then
    raise exception '0485: an unknown service no longer asks for nothing';
  end if;

  raise notice '0485: the default consent covers % scope(s)',
    array_length(string_to_array(v_all, ' '), 1);
end $drive$;
