-- ---------------------------------------------------------------------------
-- How much of the free tier is left, measured rather than asserted.
--
-- The Settings page said "Supabase storage is at 82% of the free tier — 412 MB
-- of 500 MB". Nobody measured that. It was written to make a mock look
-- realistic, and it is the single most consequential number on the page: the
-- hard constraint on this project is ~£0/month, and 500 MB is where the
-- database stops being free.
--
-- The Management API has no usage endpoint for a project-scoped token
-- (`/v1/projects/:ref/usage` is a 404 and `/v1/organizations` returns an empty
-- list), so the number cannot come from there. It does not need to: Postgres
-- knows how big it is, and the storage bucket contents are rows in
-- `storage.objects` with the byte size in their metadata.
--
-- Measuring it here rather than in a script is the point. Grant: *"I want to
-- reduce my dependence on Claude or another coding interface for maintaining
-- and extending the system."* A capability that only exists as a script an
-- agent runs is a capability he does not have.
-- ---------------------------------------------------------------------------

create or replace function app.free_tier_headroom()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- The Supabase free tier, as documented, in bytes. Named here so the numbers
  -- below are a comparison rather than a magic constant three lines long.
  db_limit      bigint := 500 * 1024 * 1024;
  storage_limit bigint := 1024 * 1024 * 1024;
  db_bytes      bigint;
  storage_bytes bigint;
begin
  select pg_catalog.pg_database_size(pg_catalog.current_database()) into db_bytes;

  /*
    `metadata->>'size'`, not a column.

    `storage.objects` has no size column — the byte count lives in the metadata
    the storage API writes when the object is uploaded. An object whose metadata
    is missing counts as zero rather than nulling the whole sum, because one
    unmeasurable file must not make the total unreadable.
  */
  select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)
    into storage_bytes
    from storage.objects o;

  return jsonb_build_object(
    'database', jsonb_build_object(
      'bytes', db_bytes,
      'limit_bytes', db_limit,
      'percent', round((db_bytes::numeric / db_limit) * 100, 1),
      'human', pg_catalog.pg_size_pretty(db_bytes),
      'limit_human', pg_catalog.pg_size_pretty(db_limit)
    ),
    'storage', jsonb_build_object(
      'bytes', storage_bytes,
      'limit_bytes', storage_limit,
      'percent', round((storage_bytes::numeric / storage_limit) * 100, 1),
      'human', pg_catalog.pg_size_pretty(storage_bytes),
      'limit_human', pg_catalog.pg_size_pretty(storage_limit),
      'objects', (select count(*) from storage.objects)
    ),
    -- The five biggest tables, because "the database is at 61%" is a fact and
    -- "and 70% of that is one table of embeddings" is an action.
    'largest', coalesce((
      select jsonb_agg(x)
        from (
          select jsonb_build_object(
                   'table', n.nspname || '.' || c.relname,
                   'bytes', pg_catalog.pg_total_relation_size(c.oid),
                   'human', pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(c.oid))
                 ) as x
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
           where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema')
           order by pg_catalog.pg_total_relation_size(c.oid) desc
           limit 5
        ) t
    ), '[]'::jsonb),
    'measured_at', app.now_utc()
  );
end;
$$;

comment on function app.free_tier_headroom() is
  'Real database and storage usage against the Supabase free tier, measured '
  'from pg_database_size and storage.objects metadata. The Management API has '
  'no usage endpoint for a project-scoped token, and the figure on the '
  'Settings page was invented.';

-- PostgREST only exposes `public`, so every app.* RPC a client calls needs a
-- wrapper. Bitten enough times that it is in CLAUDE.md.
create or replace function public.free_tier_headroom()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$ select app.free_tier_headroom() $$;

comment on function public.free_tier_headroom() is
  'Public wrapper for app.free_tier_headroom().';
