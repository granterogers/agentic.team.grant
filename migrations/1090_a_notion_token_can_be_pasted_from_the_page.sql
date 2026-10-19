begin;

-- The Notion integration token, pasted from Team HQ Settings -> Services -> Notion, without a terminal.
--
-- It is stored in the vault as notion.integration_token, the name the Notion sync and the adoption handler already read
-- (src/handlers/notion-sync.ts, src/handlers/notion-adopt.ts). The token is checked here, not only in the page: it must
-- look like a Notion integration token (secret_ or ntn_). Nothing here returns or logs the value. Operator-only at the
-- gateway (OPERATOR_ONLY in supabase/functions/hq-api), as the NotebookLM and Google credential setters are.

create or replace function app.hq_set_notion_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v text := btrim(coalesce(p_token, ''));
begin
  if v = '' then
    return jsonb_build_object('error', 'the token box was empty - paste the Notion integration token first');
  end if;
  if length(v) > 200 then
    return jsonb_build_object('error', 'that is too long to be a Notion integration token');
  end if;
  if v !~ '^(secret_|ntn_)[A-Za-z0-9_]{20,}$' then
    return jsonb_build_object('error',
      'that is not a Notion integration token. It starts with secret_ or ntn_. Copy it from notion.so/profile/integrations');
  end if;

  perform app.store_secret('notion.integration_token', v,
    'Notion integration token, pasted into Team HQ Settings. Read by the Notion sync and the adoption handler.');

  return jsonb_build_object('ok', true);
end;
$$;

comment on function app.hq_set_notion_token(text) is
  'Stores a pasted Notion integration token in the vault after checking its shape. Never returns the token.';

revoke all on function app.hq_set_notion_token(text) from public;
grant execute on function app.hq_set_notion_token(text) to service_role;

create or replace function public.hq_set_notion_token(p_token text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.hq_set_notion_token(p_token) $$;

revoke all on function public.hq_set_notion_token(text) from public;
grant execute on function public.hq_set_notion_token(text) to service_role;

commit;
