-- Origin follows the connector.
--
-- 0177 added `connector_matches_origin`: a document with `origin = 'source'`
-- must name its connector, and one with 'yours' or 'made' must not. The rule is
-- right. The rollout was not.
--
-- `origin` defaults to 'yours', and every existing writer sets `connector`
-- without knowing `origin` exists — they predate it. So the first insert from
-- `verify:knowledge` after 0177 failed:
--
--   ERROR: new row for relation "documents" violates check constraint
--          "connector_matches_origin"
--
-- Found by running the whole verification suite, which is the only reason it
-- was caught before it reached the ingestion path in production. A constraint
-- that requires every existing caller to be updated in the same commit is a
-- constraint that will break something you did not think of.
--
-- ## The fix is a default, not a looser rule
--
-- Weakening the check would give back the thing it was added for. Instead the
-- database works out `origin` when the caller has not said: a row arriving with
-- a connector IS a source, and that is not a guess, it is the definition. A
-- caller that states an origin is left alone.

begin;

create or replace function app.origin_follows_connector() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only fill in what the caller did not say. `origin` defaults to 'yours', so
  -- "did not say" and "said yours" are indistinguishable here — and that is
  -- acceptable, because a row with a connector is a source either way.
  if new.connector is not null and btrim(new.connector) <> '' and new.origin = 'yours' then
    new.origin := 'source';
  end if;

  -- The mirror of it: an origin of 'yours' or 'made' cannot carry a connector,
  -- so an empty string is normalised to null rather than tripping the check.
  if new.origin in ('yours', 'made') and new.connector is not null
     and btrim(new.connector) = '' then
    new.connector := null;
  end if;

  return new;
end $$;

drop trigger if exists documents_origin_follows_connector on public.documents;
create trigger documents_origin_follows_connector
  before insert or update on public.documents
  for each row execute function app.origin_follows_connector();

commit;
