-- 0010 — Detect dangling secret references
--
-- 0007's trigger validates references when a credentials row is WRITTEN. That
-- turned out to be insufficient, and it was found the hard way: a verification
-- script deleted a vault secret, and the row referencing it became dangling
-- with **no write to it at all**. The next legitimate write then failed —
-- correctly, but confusingly, because the trigger validates every reference on
-- the row and so blocked the very write that would have fixed the bad one.
--
-- A foreign key into `vault.secrets` would prevent this, and was deliberately
-- rejected in 0007: it couples this schema to a Supabase-internal table that
-- may be reshaped without notice. That trade stands. What was missing is the
-- other half of the trade — §8's connector reconciliation: *"Webhooks and push
-- events are hints, not truth."* The same applies to a reference. It is a hint
-- that a credential exists, and hints get reconciled.
--
-- So: a view that names dangling references, for the health page and for a
-- scheduled check. Detection rather than prevention, which is the honest
-- consequence of choosing not to couple.

create or replace view public.credential_health as
  with refs as (
    select c.slack_app_id, r.column_name, r.ref
    from public.slack_app_credentials c
    cross join lateral (
      values
        ('bot_token_ref',      c.bot_token_ref),
        ('signing_secret_ref', c.signing_secret_ref),
        ('client_secret_ref',  c.client_secret_ref),
        ('config_token_ref',   c.config_token_ref),
        ('config_refresh_ref', c.config_refresh_ref)
    ) as r(column_name, ref)
  )
  select
    refs.slack_app_id,
    refs.column_name,
    refs.ref::text as secret_ref,
    case
      when refs.ref is null then 'not_configured'
      when exists (select 1 from vault.secrets s where s.id = refs.ref::uuid) then 'ok'
      else 'DANGLING'
    end as status
  from refs;

comment on view public.credential_health is
  'Every credential reference and whether it still resolves. A reference is a '
  'hint that a credential exists (§8), and hints get reconciled — 0007''s write-'
  'time trigger cannot see a secret deleted out from under a row.';

-- Convenience for the health page and CI: one row, or none when all is well.
create or replace view public.credential_health_problems as
  select * from public.credential_health where status = 'DANGLING';

comment on view public.credential_health_problems is
  'Empty is healthy. Non-empty means a credential reference no longer resolves, '
  'which fails only when the credential is needed — i.e. when something is '
  'already going wrong.';

-- ---------------------------------------------------------------------------
-- Rotation health
--
-- §15: the config token pair expires roughly every twelve hours. A pair that
-- is not rotating is an outage that has not happened yet, so "when did we last
-- rotate" has to be queryable rather than inferred from logs.
-- ---------------------------------------------------------------------------
create or replace view public.slack_rotation_health as
  select
    slack_app_id,
    config_token_expires_at,
    config_token_rotated_at,
    rotation_failures,
    last_rotation_error,
    extract(epoch from (config_token_expires_at - now()))::bigint as seconds_until_expiry,
    case
      when config_token_expires_at is null then 'never_rotated'
      when config_token_expires_at < now() then 'EXPIRED'
      when config_token_expires_at - now() < interval '1 hour' then 'due'
      when rotation_failures >= 3 then 'FAILING'
      else 'ok'
    end as status
  from public.slack_app_credentials;

comment on view public.slack_rotation_health is
  'Rotation state per app. EXPIRED is recoverable — the refresh token survives '
  'the access token, demonstrated 2026-09-03 by rotating out of an expired '
  'state. FAILING means retries are not helping and a human is needed.';

grant select on public.credential_health          to ai_team_app;
grant select on public.credential_health_problems to ai_team_app;
grant select on public.slack_rotation_health      to ai_team_app;
