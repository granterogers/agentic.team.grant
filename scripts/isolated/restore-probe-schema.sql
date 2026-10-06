-- Proof-only tables for scripts/isolated/backup-restore-typed.ts. Applied to the SOURCE and the TARGET replica by hand
-- (never a migration, never production). Each exists to make a particular claim of the typed restore falsifiable:
--
--   zz_probe_parent   identity ALWAYS, a stored GENERATED column, jsonb, a numeric past 2^53, interval, text[], bytea, a
--                     CHECK, a SELF reference, and a cycle with zz_probe_other; a BEFORE INSERT trigger that logs.
--   zz_probe_log      what that trigger writes: if a restore FIRES the trigger the log doubles and the counts go red.
--   zz_probe_member   a composite key (id, office_id) to the real offices table, and
--   zz_probe_child    a composite FOREIGN KEY to it, the shape every office-owned table in the product has.
--   zz_probe_secret   row security on, with a policy.
--   zz_probe_texty    a TEXT primary key (keyset paging on a non-numeric key).
--   zz_probe_heap     NO key at all, with duplicate rows (paging on ctid).
--   zz_probe_big      a composite (bigint, uuid) key and enough rows to need many pages.

create table public.zz_probe_parent (
  id          bigint generated always as identity primary key,
  name        text not null check (length(name) > 0),
  upper_name  text generated always as (upper(name)) stored,
  meta        jsonb not null default '{}'::jsonb,
  amount      numeric(40, 6) not null default 0,
  big         bigint not null default 0,
  born        timestamptz not null default now(),
  span        interval,
  tags        text[] not null default '{}',
  blob        bytea,
  parent_id   bigint references public.zz_probe_parent (id),
  other_id    uuid
);

create table public.zz_probe_other (
  id         uuid primary key default gen_random_uuid(),
  parent_id  bigint not null references public.zz_probe_parent (id),
  note       text
);
alter table public.zz_probe_parent
  add constraint zz_probe_parent_other_fk foreign key (other_id) references public.zz_probe_other (id);

create table public.zz_probe_log (
  n    bigint generated always as identity primary key,
  what text not null
);
create function public.zz_probe_log_insert() returns trigger language plpgsql as $$
begin
  insert into public.zz_probe_log (what) values ('parent ' || new.name);
  return new;
end $$;
create trigger zz_probe_parent_logged before insert on public.zz_probe_parent
  for each row execute function public.zz_probe_log_insert();
-- a trigger that is DISABLED in the baseline must come back disabled, not enabled
create trigger zz_probe_parent_dormant before insert on public.zz_probe_parent
  for each row execute function public.zz_probe_log_insert();
alter table public.zz_probe_parent disable trigger zz_probe_parent_dormant;

create table public.zz_probe_member (
  id         uuid not null default gen_random_uuid(),
  office_id  uuid not null references public.offices (office_id),
  label      text not null,
  primary key (id, office_id)
);
create table public.zz_probe_child (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null,
  member_id  uuid not null,
  foreign key (member_id, office_id) references public.zz_probe_member (id, office_id)
);

create table public.zz_probe_secret (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null,
  body       text not null
);
alter table public.zz_probe_secret enable row level security;
create policy zz_probe_secret_own on public.zz_probe_secret using (office_id is not null);

create table public.zz_probe_texty (code text primary key, v text);
create table public.zz_probe_heap (x int, y text);
create table public.zz_probe_big (
  a    bigint not null,
  b    uuid not null,
  txt  text,
  doc  jsonb,
  blob bytea,
  primary key (a, b)
);
