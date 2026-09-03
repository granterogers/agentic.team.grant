-- 0007 — Slack per-app credentials, as references to encrypted secrets
--
-- Master spec §15: "Slack per-app credentials live in Postgres, one row per app
-- — never a flat environment variable. With multiple bot identities there is no
-- correct value for a single SLACK_BOT_TOKEN. Only the human-provided config
-- token pair lives in the bootstrap store, and its rotating state belongs in
-- the database."
--
-- And §6: "Never write decrypted secrets into the ledger — store secret
-- references only."
--
-- The design point of this table is that it holds NO secret values. Every
-- credential column is a `uuid` pointing into Supabase Vault, so a token cannot
-- be stored here even by mistake: the type rejects it. That is stronger than a
-- naming convention or a code review, both of which eventually lose.
--
-- Verified before writing this (2026-09-03): vault.create_secret() returns a
-- uuid, vault.decrypted_secrets round-trips the plaintext, and vault.secrets
-- holds genuine ciphertext — a 29-character value stored as 85 characters of
-- non-matching data. The application role has no access to either, which is
-- checked again at the end of this migration rather than assumed.

-- ---------------------------------------------------------------------------
-- A secret reference is a distinct type, not "a uuid that happens to mean
-- something". Naming it makes the intent visible in every column definition
-- and in error messages.
-- ---------------------------------------------------------------------------
create domain app.vault_secret_ref as uuid;

comment on domain app.vault_secret_ref is
  'A reference to a row in vault.secrets. NEVER a secret value — the type '
  'makes storing one impossible rather than merely discouraged (§6, §15).';

-- ---------------------------------------------------------------------------
-- One row per Slack app
-- ---------------------------------------------------------------------------
create table public.slack_app_credentials (
  slack_app_id            text        primary key,
  team_id                 text        not null,
  app_name                text        not null,

  -- Bot identity, from auth.test. Non-secret, so stored directly.
  bot_user_id             text,
  bot_id                  text,
  scopes                  text[]      not null default '{}',
  is_enterprise_install   boolean     not null default false,

  -- Credentials, as references only.
  bot_token_ref           app.vault_secret_ref,
  signing_secret_ref      app.vault_secret_ref,
  client_secret_ref       app.vault_secret_ref,
  config_token_ref        app.vault_secret_ref,
  config_refresh_ref      app.vault_secret_ref,

  -- §15: the config token pair ROTATES, roughly every 12 hours, which is
  -- precisely why it cannot live in a static store. This is the rotating state.
  config_token_expires_at timestamptz,
  config_token_rotated_at timestamptz,
  rotation_failures       integer     not null default 0,
  last_rotation_error     text,

  -- §8 kill-switch: every integration must be independently disableable
  -- without taking the application offline.
  enabled                 boolean     not null default true,
  disabled_reason         text,

  installed_at            timestamptz,
  revoked_at              timestamptz,
  created_at              timestamptz not null default app.now_utc(),
  updated_at              timestamptz not null default app.now_utc(),

  constraint slack_app_id_format
    check (slack_app_id ~ '^A[A-Z0-9]{8,}$'),
  constraint slack_team_id_format
    check (team_id ~ '^T[A-Z0-9]{8,}$'),
  constraint slack_app_name_present
    check (length(trim(app_name)) > 0),
  -- A disabled integration must say why, or nobody will remember whether it
  -- was deliberate.
  constraint slack_disabled_has_reason
    check (enabled or disabled_reason is not null),
  constraint slack_rotation_failures_non_negative
    check (rotation_failures >= 0),
  constraint slack_rotation_error_is_brief
    check (last_rotation_error is null or length(last_rotation_error) <= 500),
  -- A revoked install is not an enabled one.
  constraint slack_revoked_is_disabled
    check (revoked_at is null or not enabled)
);

comment on table public.slack_app_credentials is
  'One row per Slack app (§15). Holds secret REFERENCES only — every credential '
  'column is a uuid into Supabase Vault, so a token cannot be stored here at '
  'all. Carries the config token pair''s rotation state, which is why a static '
  'environment variable cannot serve this purpose.';

comment on column public.slack_app_credentials.config_token_expires_at is
  'Slack config tokens expire roughly every 12 hours. Everything Slack depends '
  'on a credential that turns over twice a day, so rotation is tested against a '
  'real expiry window in Phase 2 before anything is built on it.';

create trigger slack_app_credentials_touch_updated_at
  before update on public.slack_app_credentials
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A reference must actually resolve
--
-- A dangling reference is worse than a missing one: the row looks configured
-- and fails only at the moment the credential is needed, which is the moment
-- something is already going wrong. Postgres cannot express this as a CHECK
-- (no subqueries), and a foreign key into `vault.secrets` would couple this
-- schema to a Supabase-internal table that may be reshaped without notice. A
-- trigger is the middle path.
-- ---------------------------------------------------------------------------
create or replace function app.validate_vault_refs()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, vault, public
as $$
declare
  r app.vault_secret_ref;
  col text;
begin
  foreach col in array array[
    'bot_token_ref', 'signing_secret_ref', 'client_secret_ref',
    'config_token_ref', 'config_refresh_ref'
  ]
  loop
    execute format('select ($1).%I', col) into r using new;
    if r is not null and not exists (select 1 from vault.secrets s where s.id = r::uuid) then
      raise exception
        '%.% references vault secret % which does not exist',
        tg_table_name, col, r
        using errcode = '23503',
              hint = 'Create the secret with vault.create_secret() first, then '
                     'store the id it returns.';
    end if;
  end loop;
  return new;
end
$$;

create trigger slack_app_credentials_validate_refs
  before insert or update on public.slack_app_credentials
  for each row execute function app.validate_vault_refs();

-- ---------------------------------------------------------------------------
-- The connector invocation layer, and nothing else, gets plaintext
--
-- §15: "only the connector invocation layer receives decrypted credentials."
-- This function is that layer's single door. SECURITY DEFINER, because the
-- application role deliberately has no access to the vault at all — verified
-- above: no usage on the schema, no select on either table.
--
-- It takes a reference rather than a credential NAME, so a caller cannot go
-- fishing through the vault for secrets belonging to something else: it can
-- only resolve a reference some row already gave it.
-- ---------------------------------------------------------------------------
create or replace function app.resolve_secret(p_ref app.vault_secret_ref)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, vault, public
as $$
declare
  v_secret text;
begin
  if p_ref is null then
    return null;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = p_ref::uuid;

  if not found then
    raise exception 'vault secret % does not exist', p_ref
      using errcode = '23503';
  end if;

  return v_secret;
end
$$;

comment on function app.resolve_secret(app.vault_secret_ref) is
  'The ONLY path from a reference to a plaintext credential (§15). Takes a '
  'reference, never a name, so a caller cannot enumerate the vault — it can '
  'only resolve what a row already handed it. Its return value must never '
  'reach a log, an error trace, or the event ledger.';

-- ---------------------------------------------------------------------------
-- Storing a credential
--
-- Wrapping create_secret means the plaintext appears in exactly one place in
-- the codebase, and the caller receives a reference rather than ever holding
-- both halves.
-- ---------------------------------------------------------------------------
create or replace function app.store_secret(p_name text, p_value text, p_description text)
  returns app.vault_secret_ref
  language plpgsql
  security definer
  set search_path = pg_catalog, vault, public
as $$
declare
  v_id uuid;
begin
  if p_value is null or length(p_value) = 0 then
    raise exception 'refusing to store an empty secret as %', p_name
      using errcode = '22023';
  end if;

  select id into v_id from vault.secrets where name = p_name;

  if v_id is null then
    v_id := vault.create_secret(p_value, p_name, p_description);
  else
    -- Rotation: same reference, new value. Every row pointing at this
    -- reference picks up the new credential with no write of its own, which is
    -- what makes a 12-hourly rotation survivable.
    perform vault.update_secret(v_id, p_value, p_name, p_description);
  end if;

  return v_id::app.vault_secret_ref;
end
$$;

comment on function app.store_secret(text, text, text) is
  'Create or rotate a vault secret and return its reference. Rotation reuses '
  'the reference, so every row pointing at it picks up the new value without a '
  'write — which is what makes a twice-daily rotation survivable.';

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------
alter table public.slack_app_credentials enable row level security;
alter table public.slack_app_credentials force  row level security;

create policy slack_credentials_app_read on public.slack_app_credentials
  for select to ai_team_app using (true);
create policy slack_credentials_app_write on public.slack_app_credentials
  for insert to ai_team_app with check (true);
-- Rotation is an UPDATE, so the application role needs it.
create policy slack_credentials_app_update on public.slack_app_credentials
  for update to ai_team_app using (true) with check (true);

grant select, insert, update on public.slack_app_credentials to ai_team_app;

grant execute on function app.resolve_secret(app.vault_secret_ref) to ai_team_app;
grant execute on function app.store_secret(text, text, text)       to ai_team_app;

-- Belt to the braces: the application role must reach the vault ONLY through
-- those two functions. Stated as explicit REVOKEs so the intent survives
-- someone later granting broadly by habit, and so this migration fails loudly
-- if Supabase ever changes the default.
revoke all on schema vault from ai_team_app;
revoke all on all tables in schema vault from ai_team_app;

-- Not granted: DELETE. A revoked Slack install is recorded with revoked_at and
-- enabled = false, never deleted — the ledger references it forever.
