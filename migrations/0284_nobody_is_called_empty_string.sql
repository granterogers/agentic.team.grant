-- 0284 — nobody is called empty string
--
-- Found by `verify:corpus` on its first run, against 0283. It marked the six
-- module pages `origin = 'made'` with
--
--   produced_by = coalesce(d.produced_by, 'office.notion_import')
--
-- and every one came out blank. `documents.produced_by` is NOT NULL with a
-- default of `''`, so `coalesce` can never fire on it — there is no null to
-- coalesce. Every reader in the database makes the same mistake:
--
--   app.studio_documents   'origin', ... when 'made' then coalesce(d.produced_by, 'The team')
--   app.studio_document    the same
--
-- which means a document the office made with no producer recorded renders as
-- an EMPTY origin line in Grant's gallery, where it was meant to read "The
-- team". Latent since 0175 and reached for the first time by #20, because until
-- #20 nothing had ever set `origin = 'made'` on a row the projections show.
--
-- ## The fix is the column, not the four readers
--
-- 0177 made exactly this argument about a different column and it is worth
-- quoting, because the reasoning transfers without a word changed:
--
--   > A sentinel would satisfy the constraint and lie. `connector = 'none'`
--   > reads as a connector called none in every join, group-by and health
--   > count... Null means what it means: this did not come from anywhere else.
--
-- `produced_by = ''` is a person called empty string. It reads as a producer in
-- every group-by, it defeats `coalesce` in every reader, and it is
-- indistinguishable from "we do not know who made this" — which is the thing it
-- is actually recording. So the column becomes nullable with no default, the
-- existing blanks become null, and the four readers that were already written
-- against null start working as written.
--
-- Nothing that writes `''` breaks: the trigger normalises it on the way in, the
-- same way 0178 already normalises an empty `connector`.

begin;

alter table public.documents alter column produced_by drop default;
alter table public.documents alter column produced_by drop not null;

update public.documents set produced_by = null where btrim(produced_by) = '';

comment on column public.documents.produced_by is
  'Who made this, when origin is ''made''. NULL means we do not know, which is '
  'what every reader''s coalesce is written against — 0284. Never '''': a '
  'sentinel reads as a producer in a group-by and defeats the coalesce, which '
  'is 0177''s argument about connector = ''none'' in a second column.';

-- ---------------------------------------------------------------------------
-- The trigger keeps it that way
-- ---------------------------------------------------------------------------
--
-- Patched from `pg_get_functiondef`, not rewritten from memory. The two
-- existing rules are untouched; the third is the same normalisation 0178
-- already applies to `connector`.

create or replace function app.origin_follows_connector() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Only fill in what the caller did not say. `origin` defaults to 'yours', so
  -- "did not say" and "said yours" are indistinguishable here — and that is
  -- acceptable, because a row with a connector is a source either way.
  if new.connector is not null and btrim(new.connector) <> '' and new.origin = 'yours' then
    new.origin := 'source';
  end if;

  -- The mirror of it: an origin of 'yours' cannot carry a connector, so an
  -- empty string is normalised to null rather than tripping the check. Since
  -- 0283 a 'made' document MAY name a connector — provenance is who made it,
  -- the connector is where it lives — so only a blank one is cleared.
  if new.connector is not null and btrim(new.connector) = '' then
    new.connector := null;
  end if;

  -- 0284. Nobody is called empty string.
  if new.produced_by is not null and btrim(new.produced_by) = '' then
    new.produced_by := null;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- And the six pages get the name that 0283 meant to give them
-- ---------------------------------------------------------------------------

update public.documents
   set produced_by = 'office.notion_import'
 where origin = 'made'
   and produced_by is null
   and connector = 'notion'
   and content like '%' || chr(10) || '## Built from' || chr(10) || '%';

commit;
