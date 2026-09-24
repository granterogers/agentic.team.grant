-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0590
--
-- 0590 separates a credential that ADMINISTERS from one that ACTS: Slack's
-- 12-hour config token rotates the app's administration pair, and a failure to
-- rotate it was making the whole service read unreachable although the bot
-- token -- the one messages ride on -- was fine. It drives the distinction:
--
--     if v_slack is distinct from true then
--       raise exception '0590: Slack still reads unreachable on a live bot token';
--     if v_tg is distinct from true then
--       raise exception '0590: Telegram moved, and this migration must not touch it';
--
-- `public.connection_health` holds one row on a blank database, for a Google
-- OAuth client that is `missing`. Nothing has ever connected Slack or
-- Telegram, so both are absent and the migration cannot read the answer it is
-- about.
--
-- This is NOT a data assumption about Grant's business -- it is a CONNECTION
-- assumption, and the distinction matters: what the migration needs is a
-- connected office, which is a thing configuration creates and which a fresh
-- install genuinely does not have until somebody connects something.
--
-- Three rows are scaffolded, the three the migration and its two controls
-- name. They carry LABELS and no credential material, which the table's own
-- `connection_health_carries_no_credential` constraint enforces and which is
-- checked here as well as there.
--
-- The migration's own controls are what keep this honest, and both of them
-- move rows this precondition creates: it kills the bot token in a
-- subtransaction and requires the answer to flip, and then marks every Slack
-- credential as maintaining and requires the worst row to speak. Seeding three
-- healthy rows cannot satisfy either -- only the ordering 0590 splices can.
-- ---------------------------------------------------------------------------

insert into public.connection_health (service, credential, state, detail, owner, action, checked_at)
values
  ('Slack', 'bot token', 'ok',
   'fresh-install baseline scaffolding: the credential messages ride on',
   'office', '', app.now_utc()),
  ('Slack', 'config token (12h)', 'ok',
   'fresh-install baseline scaffolding: the administration pair, rotated every 12 hours',
   'office', '', app.now_utc()),
  ('Telegram', 'bot token', 'ok',
   'fresh-install baseline scaffolding: the control that proves Telegram did not move',
   'office', '', app.now_utc())
on conflict (service, credential) do nothing;
