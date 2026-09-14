begin;

-- ---------------------------------------------------------------------------
-- 0354 - disconnecting Google revokes the grant AT GOOGLE (#109)
--
-- #90 asked to "revoke, do not just forget". 0350 delivered the forget half
-- honestly: `hq_disconnect` deletes our copy, switches off everything that
-- reads it, and hands back `revoke_at` so the studio can point at Google's own
-- consent page. It claimed nothing it had not done.
--
-- What it could not do is revoke, because Postgres makes no HTTP calls. So a
-- deleted vault row and a live refresh token at Google were the same event
-- from Grant's side and two very different states in the world. For a token
-- that has been on a machine we no longer control, that difference is the
-- whole point of pressing Disconnect.
--
-- ## The ordering problem the Issue did not see
--
-- #109 says: delete the local copy, THEN enqueue the revoke, "so a failed
-- revoke never leaves a credential we are still using."
--
-- Those two cannot both happen in that order. Google's revoke endpoint takes
-- the token as its argument, so deleting it first leaves the worker with
-- nothing to post. The safety property behind the instruction is right and
-- the sequence cannot deliver it.
--
-- So the token is PARKED rather than deleted: moved to a name nothing reads.
-- `app.vault_secret` gates reads against an allow-list, `googleAccess` asks
-- for `google.refresh_token` by name, and after this runs that name is gone.
-- The credential is therefore unusable by the office at the moment Grant
-- presses the button - which is the property the Issue wanted - and still
-- present for the one caller whose job is to destroy it.
--
-- ## The parked copy always goes
--
-- `app.google_revoke_finish` deletes it whether the revoke succeeded or
-- failed, and the handler calls it on both paths. A parked token that
-- outlives its job would be the exact thing this migration exists to prevent,
-- wearing a different name.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The worker has to be able to read the parked copy
--
-- One name added to the allow-list, and nothing else widened. 0126 is the
-- current definition; this repeats its list rather than extending it, because
-- `create or replace` replaces the whole body and a partial copy would
-- silently drop a name something depends on.
-- ---------------------------------------------------------------------------
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
    'github.dispatch_token',
    -- Where a refresh token waits between "Grant pressed Disconnect" and
    -- "Google confirmed the grant is dead" (#109). Read by exactly one
    -- handler, whose only purpose is to destroy it.
    'google.revoking_refresh_token'
  ) then
    raise exception 'no' using errcode = '42501';
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Park it, switch everything off, and ask the worker to finish the job
-- ---------------------------------------------------------------------------
create or replace function app.google_revoke_begin()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_token text;
  v_job   uuid;
  v_old   uuid;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'google.refresh_token';

  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('parked', false, 'job_id', null);
  end if;

  -- Overwrite rather than accumulate: a second Disconnect before the first
  -- revoke has run must not leave two live tokens parked.
  select id into v_old from vault.secrets where name = 'google.revoking_refresh_token';
  if v_old is null then
    perform vault.create_secret(v_token, 'google.revoking_refresh_token',
      'A Google refresh token awaiting revocation at Google (#109). Deleted by '
      || 'app.google_revoke_finish whether the revoke succeeds or fails.');
  else
    perform vault.update_secret(v_old, v_token, 'google.revoking_refresh_token');
  end if;

  -- The office's copy goes NOW. `app.vault_secret` refuses any name outside
  -- its list and `googleAccess` asks for this one, so from this statement on
  -- nothing in the office can use the credential.
  delete from vault.secrets where name = 'google.refresh_token';

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority)
  values (gen_random_uuid(), null,
          format('google-revoke-%s', gen_random_uuid()),
          'google.revoke', 'grant', 400)
  returning job_id into v_job;

  return jsonb_build_object('parked', true, 'job_id', v_job);
end;
$$;

grant execute on function app.google_revoke_begin() to service_role;

-- ---------------------------------------------------------------------------
-- What the worker reports back
--
-- Takes the OUTCOME rather than a status string, so a caller cannot invent a
-- third state. The parked secret is deleted on both paths.
-- ---------------------------------------------------------------------------
create or replace function app.google_revoke_finish(p_ok boolean, p_detail text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_gone int := 0;
begin
  delete from vault.secrets where name = 'google.revoking_refresh_token';
  get diagnostics v_gone = row_count;

  update public.connection_health
     set state = 'missing',
         detail = case when p_ok
           then 'signed out, and the grant is revoked at Google'
           else 'signed out here; Google did not confirm the revoke'
                || case when btrim(coalesce(p_detail, '')) = '' then ''
                        else ' (' || left(btrim(p_detail), 120) || ')' end
         end,
         action = case when p_ok
           then 'Sign in with Google on the Set up page'
           -- The honest instruction when we could not do it ourselves, and the
           -- reason this branch says something different rather than
           -- pretending: a person who thinks a grant is dead does not go and
           -- kill it.
           else 'Revoke it yourself at https://myaccount.google.com/permissions'
         end,
         checked_at = app.now_utc()
   where service = 'google_calendar';

  return jsonb_build_object('ok', true, 'parked_copy_removed', v_gone, 'revoked', p_ok);
end;
$$;

grant execute on function app.google_revoke_finish(boolean, text) to service_role;

create or replace function public.google_revoke_finish(p_ok boolean, p_detail text default '')
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.google_revoke_finish(p_ok, p_detail) $$;

revoke all on function public.google_revoke_finish(boolean, text) from public;
grant execute on function public.google_revoke_finish(boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Signing out of Google now starts a revoke
--
-- `app.hq_forget_google` keeps doing everything it did EXCEPT deleting the
-- refresh token, which `google_revoke_begin` has already done by moving it.
-- Two functions deleting the same secret is how one of them ends up deleting
-- the parked copy out from under the job that needs it.
-- ---------------------------------------------------------------------------
create or replace function app.hq_forget_google()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_started jsonb;
begin
  -- Parks the token and enqueues the revoke. Returns parked=false when there
  -- was nothing stored, which is not an error: signing out twice is allowed.
  v_started := app.google_revoke_begin();

  delete from public.system_config where key = 'google.granted_scopes';

  -- Everything that reads Google goes off with it. Leaving `calendar.enabled`
  -- true would mean an hourly duty failing forever against a credential that
  -- was deliberately removed, and a red light he caused and cannot explain.
  update public.system_config set value = to_jsonb(false) where key = 'calendar.enabled';

  update public.connection_health
     set state = 'missing',
         detail = case when (v_started->>'parked')::boolean
           then 'signed out at your request; revoking at Google'
           else 'signed out at your request' end,
         action = 'Sign in with Google on the Set up page',
         checked_at = app.now_utc()
   where service = 'google_calendar';

  return jsonb_build_object('ok', true, 'revoking', coalesce((v_started->>'parked')::boolean, false),
                            'job_id', v_started->>'job_id');
end;
$$;

comment on function app.hq_forget_google() is
  'Signs out of Google here AND asks the worker to revoke the grant at Google '
  '(#109). The refresh token is parked under another name rather than deleted, '
  'because the revoke endpoint needs it; app.vault_secret gates the read, so '
  'nothing in the office can use it from the moment this runs.';

commit;
