-- 0348 — the four states a conversation channel can be in
--
-- Issue #198's middle section, which is the substantive half: *never connected*
-- must read as an invitation and not an error; *connected but idle* must look
-- different from never connected; *disconnected after being connected* must
-- keep the history and offer reconnection; and *degraded* — the credential is
-- fine and the provider is failing — must be distinguishable from disconnected.
--
-- Those are four different sentences and the product had one: a credential
-- either exists or it does not. #123 is the same complaint at page scale —
-- "empty-because-new looks like empty-because-broken" — and #90 was the
-- narrower version: the status lied because it read the presence of a stored
-- secret rather than a live check.
--
-- Three facts decide the state, and no single one of them can:
--
--   * `connection_health` — is the credential live? Refreshed by a real probe,
--     not by asking whether a row exists in the vault.
--   * `inbound_commands` — has anything ever come in on this surface, and when?
--     A connection nobody has used is not broken.
--   * `deliveries` — is anything failing right now? This is where #202 becomes
--     visible: a working credential with five failed sends in the last hour is
--     DEGRADED, and calling it "connected" would be the status lying again in
--     the other direction.
--
-- Derived, never stored. A fifth column saying "degraded" would be a fact in
-- two places, and 0303/0304 are the standing lesson about which copy rots.

begin;

create or replace function app.conversation_channels()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with want as (
    /*
      The surfaces a CONVERSATION can happen on, which is not the same list as
      the connectors the office has. Voice is here because #196's Issue is
      careful about the distinction and Grant's own instruction is "Voice is
      required"; teamhq is here because the studio is a surface like any other
      and leaving it out would make the page unable to describe itself.

      `origin_channel` already has a word for the web dashboard and it is
      `teamhq`. 0313 tried `studio` and was refused; ADR-0019 changed which
      files serve the page, not what the channel is called.
    */
    select * from (values
      ('slack',    'Slack',    'Slack'),
      ('telegram', 'Telegram', 'Telegram'),
      ('voice',    'Voice',    'Twilio'),
      ('teamhq',   'This dashboard', null)
    ) as t(channel, label, health_service)
  ),
  cred as (
    select w.channel,
           -- The worst state across that service's credentials. A workspace
           -- token that works and a bot token that does not is not "ok".
           min(case h.state
                 when 'dead' then 0 when 'missing' then 1 when 'unknown' then 2
                 when 'parked' then 3 when 'ok' then 4 when 'attested' then 5
                 else 6 end) as rank,
           max(h.checked_at) as checked_at,
           (array_agg(h.detail order by
              case h.state when 'dead' then 0 when 'missing' then 1 else 9 end))[1] as detail
      from want w
      left join public.connection_health h on h.service = w.health_service
     group by w.channel
  ),
  traffic as (
    select c.origin_channel as channel,
           count(*) as messages,
           max(c.received_at) as last_at
      from public.inbound_commands c
      left join public.jobs j on j.job_id = c.job_id
     where coalesce(j.is_fixture, false) = false
     group by c.origin_channel
  ),
  trouble as (
    /*
      Failing NOW, not ever. A delivery that failed a fortnight ago and was
      retried successfully is history, and reporting it as a current fault is
      the harness-traffic mistake in a different costume: an alarming word for
      a normal state.
    */
    select d.channel,
           count(*) as recent_failures,
           max(d.updated_at) as last_failure,
           (array_agg(d.error_code order by d.updated_at desc))[1] as last_error
      from public.deliveries d
      left join public.jobs j on j.job_id = d.job_id
     where d.state = 'failed'
       and coalesce(j.is_fixture, false) = false
       and d.updated_at > app.now_utc() - interval '24 hours'
     group by d.channel
  )
  select coalesce(jsonb_agg(row order by row->>'channel'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'channel', w.channel,
        'label',   w.label,
        'messages', coalesce(t.messages, 0),
        'last_at',  t.last_at,
        'recent_failures', coalesce(tr.recent_failures, 0),
        'last_error', tr.last_error,
        'checked_at', c.checked_at,
        /*
          The state, decided in one place and in this order. Order is the whole
          design: a failing provider outranks a quiet one, and a missing
          credential outranks both, because the most actionable truth is the
          one to say.
        */
        'state', case
          when w.health_service is null then
            -- The dashboard is not a connection. It cannot be disconnected and
            -- it has no credential; saying "connected" about it would be
            -- describing the floor you are standing on.
            'here'
          when c.rank is null or c.rank <= 1 then
            case when coalesce(t.messages, 0) > 0 then 'disconnected' else 'never' end
          when coalesce(tr.recent_failures, 0) > 0 then 'degraded'
          when coalesce(t.messages, 0) = 0 then 'quiet'
          else 'carrying'
        end,
        /*
          And what that means, in a sentence. #198 asks for never-connected to
          read as an INVITATION rather than an error, and the difference
          between those is entirely the wording — the state name is for the
          code and this is for the person.
        */
        'says', case
          when w.health_service is null then
            'You are reading it. Everything said here is part of the same conversation.'
          when c.rank is null or c.rank <= 1 then
            case when coalesce(t.messages, 0) > 0
              then 'Not connected any more. Everything already said is kept — reconnect and it carries on.'
              else 'Not connected yet. Connect it and the office can reach you there.'
            end
          when coalesce(tr.recent_failures, 0) > 0 then
            'Connected, but the provider is refusing messages. Nothing is lost; they are waiting.'
          when coalesce(t.messages, 0) = 0 then
            'Connected and ready. Nothing has come through it yet.'
          else 'Connected and carrying the conversation.'
        end
      ) as row
        from want w
        left join cred c on c.channel = w.channel
        left join traffic t on t.channel = w.channel
        left join trouble tr on tr.channel = w.channel
    ) rows
$fn$;

drop function if exists public.conversation_channels();
create function public.conversation_channels()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.conversation_channels() $fn$;

grant execute on function public.conversation_channels() to anon, authenticated, service_role;

comment on function app.conversation_channels() is
  'Issue #198. Which state each conversation surface is in — never, quiet, '
  'carrying, degraded or disconnected — from the credential, the traffic and '
  'the last day of delivery failures together. Derived, never stored.';

commit;
