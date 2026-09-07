-- 0117 — Repair what 0115's probe wrote
--
-- 0115 ended with a consistency check that called `hq_set_setting` with the
-- value `'~~probe~~'`, chosen as "guaranteed invalid for every type". It is not
-- invalid for a TEXT key, so on the way past it wrote that string into six real
-- settings — including `db.project_ref`, which is the project the whole system
-- connects through — and created three rows that had never existed.
--
-- 0116 replaced the check with one that reads the setter's source instead of
-- calling it, so it cannot write at all. This repairs the damage, which 0116
-- did not.
--
-- ## Why this is a third migration and not an edit to either
--
-- Both have run. `check:migrations` refuses a modified migration by checksum,
-- and it refused two attempts to tidy this away — first an edit to 0115, then
-- an edit to 0116. Both times within the minute, and both times correctly: a
-- migration changed after the fact builds a different database on a fresh
-- install from the one it built here, which is the whole reason the checksum
-- exists.
--
-- So the record keeps the mistake and the fix separately, in the order they
-- happened. A fresh install runs 0115's bad check, 0116's good one, and this,
-- and lands exactly where this database is.
--
-- ## Why the predicate is the probe string
--
-- Only rows still holding `~~probe~~` are touched. A key someone has since set
-- deliberately must not be reverted to a seed value by a repair that ran later
-- than they did.

begin;

update public.system_config set value = to_jsonb('baujwlzcziasnfhhkchg'::text)
 where key = 'db.project_ref' and value #>> '{}' = '~~probe~~';
update public.system_config set value = to_jsonb('eu-west-2'::text)
 where key = 'db.region' and value #>> '{}' = '~~probe~~';
update public.system_config set value = to_jsonb('primary'::text)
 where key = 'calendar.calendar_id' and value #>> '{}' = '~~probe~~';

-- Google's two, which 0094 seeded and the probe would also have overwritten on
-- a fresh install. The redirect URI is derived from the project ref, so it is
-- rebuilt rather than restated.
update public.system_config
   set value = to_jsonb(format(
     'https://%s.supabase.co/functions/v1/google-oauth/callback',
     (select value #>> '{}' from public.system_config where key = 'db.project_ref')))
 where key = 'google.redirect_uri' and value #>> '{}' = '~~probe~~';
update public.system_config set value = to_jsonb(
   'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'::text)
 where key = 'google.scopes' and value #>> '{}' = '~~probe~~';

-- These three never had a row before the probe created one: no migration seeds
-- them and the real values are vault secrets. Removed rather than blanked, so
-- the result matches an install where the check had never run.
delete from public.system_config
 where key in ('backup.s3_bucket', 'backup.s3_endpoint', 'backup.s3_region')
   and value #>> '{}' = '~~probe~~';

-- And prove it. A repair that silently matched nothing is a repair nobody can
-- tell from one that was not needed.
do $$
declare
  n integer;
begin
  select count(*) into n from public.system_config where value #>> '{}' = '~~probe~~';
  if n > 0 then
    raise exception '% setting(s) still hold the probe value', n;
  end if;
end $$;

commit;
