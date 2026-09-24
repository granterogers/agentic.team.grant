-- 0536 — an office can connect its own ability to think
--
-- `ProviderRouter` resolves the inference key from `providers.secret_ref`,
-- preferring the vault over the environment, and its own comment records that
-- the column "has existed since the registry did, was loaded into ProviderRow
-- on every call, and was never read" until that was fixed.
--
-- It is read now. Nothing SETS it.
--
-- On this database that has never mattered: the deployed worker carries
-- `OPENROUTER_API_KEY` in its environment and the fallback catches it. On a
-- fresh installation it is the whole difference between an office that thinks
-- and one that cannot, and it fails in the worst available way — silently, and
-- looking like success. A new person follows the instruction to store their
-- OpenRouter key, `app.store_secret` writes it to the vault exactly as asked,
-- every setup check that looks for the credential finds it, and every single
-- job then fails for want of a key that is sitting in the same database.
--
-- §5 of the fresh-install brief lists this shape by name: *"credential presence
-- mistaken for working connection"*.
--
-- ## Why a function rather than an UPDATE in a setup script
--
-- Grant's standing instruction: *"I want to reduce my dependence on Claude or
-- another coding interface for maintaining and extending the system"*, and the
-- rule that follows from it — a capability that exists only as a script an
-- agent runs is a capability he does not have. Connecting a credential to the
-- provider that uses it is something an office should be able to do to itself,
-- from its own Settings page, without anybody opening a terminal.
--
-- ## It takes a NAME and returns a REFERENCE
--
-- Deliberately, and it is the same argument §15 makes about `resolve_secret`
-- taking a reference rather than a name: the caller never holds both halves.
-- Here the caller has the name because they just chose it; what they must never
-- receive back is the value, so the function returns the reference and says
-- nothing about what is behind it.

begin;

create or replace function app.connect_provider_key(p_provider text, p_secret_name text)
  returns app.vault_secret_ref
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_ref app.vault_secret_ref;
begin
  if not exists (select 1 from public.providers where provider = p_provider) then
    raise exception 'no provider called %', p_provider
      using hint = 'The providers this office knows are in public.providers.',
            errcode = '23503';
  end if;

  select id::app.vault_secret_ref into v_ref
    from vault.secrets where name = p_secret_name;

  if v_ref is null then
    -- Name what is missing and how to supply it. A credential that is not
    -- there is the commonest state during setup, not an exceptional one.
    raise exception 'there is no secret called % in this office''s vault', p_secret_name
      using hint = 'Store it first: npm run fresh:secret -- ' || p_secret_name,
            errcode = '23503';
  end if;

  update public.providers set secret_ref = v_ref, updated_at = app.now_utc()
   where provider = p_provider;

  return v_ref;
end
$$;

comment on function app.connect_provider_key(text, text) is
  'Point a provider at a credential already in the vault. Takes the secret''s '
  'NAME and returns its REFERENCE: the caller chose the name, and must never '
  'be handed the value. Without this a stored inference key is connected to '
  'nothing and every job fails for want of a credential in the same database.';

revoke all on function app.connect_provider_key(text, text) from public;
grant execute on function app.connect_provider_key(text, text) to service_role;

-- Drive it. A migration that applies cleanly is not a function that works.
do $drive$
declare
  v_saved app.vault_secret_ref;
  v_ref   app.vault_secret_ref;
  v_probe uuid;
  v_msg   text;
begin
  select secret_ref into v_saved from public.providers where provider = 'openrouter';

  v_probe := vault.create_secret('not-a-real-key-0536', 'probe.0536_key', 'drive 0536');

  v_ref := app.connect_provider_key('openrouter', 'probe.0536_key');
  if v_ref is null then
    raise exception '0536: connecting a provider key returned nothing';
  end if;
  if (select secret_ref from public.providers where provider = 'openrouter') <> v_ref then
    raise exception '0536: the provider was not actually pointed at the secret';
  end if;
  -- And the reference resolves to the value, which is the property that
  -- matters: a reference that points at nothing is 0298's defect with a uuid.
  if app.resolve_secret(v_ref) <> 'not-a-real-key-0536' then
    raise exception '0536: the reference does not resolve to the stored value';
  end if;

  -- CONTROL: a name that is not in the vault is refused, and the refusal says
  -- what to do rather than only that something was wrong.
  begin
    perform app.connect_provider_key('openrouter', 'probe.0536_absent');
    raise exception '0536: a secret that does not exist was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg !~ 'no secret called' then
      raise exception '0536: refused for the wrong reason: %', v_msg;
    end if;
  end;

  -- CONTROL: and a provider that does not exist is refused too, so the
  -- function cannot quietly create a registry row by being called wrongly.
  begin
    perform app.connect_provider_key('not-a-provider-0536', 'probe.0536_key');
    raise exception '0536: an unknown provider was accepted';
  exception when foreign_key_violation then
    get stacked diagnostics v_msg = message_text;
    if v_msg !~ 'no provider called' then
      raise exception '0536: refused for the wrong reason: %', v_msg;
    end if;
  end;

  update public.providers set secret_ref = v_saved where provider = 'openrouter';
  perform vault.delete_secret(v_probe);
  raise notice '0536: an office can connect its own thinking, and refuses to pretend it did';
end
$drive$;

commit;
