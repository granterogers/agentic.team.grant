begin;

-- Upload the NotebookLM master token from Team HQ, without a terminal (issue #502).
--
-- The token file is made on the owner's computer (scripts/notebook/make-token.ts) and uploaded in Settings. This
-- function stores it in the vault as notebook.master_token_json, the same name scripts/notebook/deploy-token.ts uses,
-- so the existing reader and the existing deploy path both see it.
--
-- Checked here, not only in the page: a file that is not JSON, or whose master_token does not start aas_et/ (a
-- storage_state.json, or someone else's file), is refused with a sentence and nothing is stored. The token value is
-- never returned or logged. Operator-only at the gateway (OPERATOR_ONLY in supabase/functions/hq-api), as the Slack and
-- Google credential setters are.

create or replace function app.hq_set_notebook_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v text := btrim(coalesce(p_token, ''));
  parsed jsonb;
begin
  if v = '' then
    return jsonb_build_object('error', 'the file was empty - choose the master_token.json that the sign-in made');
  end if;
  -- A token file is a few kilobytes. Anything much larger is not one, and is refused before it is parsed.
  if length(v) > 20000 then
    return jsonb_build_object('error', 'that file is too large to be the token file');
  end if;

  begin
    parsed := v::jsonb;
  exception when others then
    return jsonb_build_object('error', 'that is not a JSON file - choose the master_token.json, not a picture or a document');
  end;

  if jsonb_typeof(parsed) <> 'object' or coalesce(parsed ->> 'master_token', '') !~ '^aas_et/' then
    return jsonb_build_object('error',
      'this is not the master token file. It should contain a master_token that starts aas_et/. A storage_state.json is the wrong file');
  end if;

  perform app.store_secret('notebook.master_token_json', v,
    'Durable master_token.json for the dedicated NotebookLM account, uploaded from Team HQ Settings (issue #502). Full-account and long-lived - dedicated account only.');

  return jsonb_build_object('ok', true, 'account', coalesce(parsed ->> 'email', parsed ->> 'account', 'unknown'));
end;
$$;

comment on function app.hq_set_notebook_token(text) is
  'Stores an uploaded NotebookLM master_token.json in the vault after checking it is that file. Never returns the token.';

revoke all on function app.hq_set_notebook_token(text) from public;
grant execute on function app.hq_set_notebook_token(text) to service_role;

create or replace function public.hq_set_notebook_token(p_token text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_notebook_token(p_token) $$;

revoke all on function public.hq_set_notebook_token(text) from public;
grant execute on function public.hq_set_notebook_token(text) to service_role;

commit;
