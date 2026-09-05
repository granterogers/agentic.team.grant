-- 0043 — Grant's timezone, and where the avatars are served from
--
-- Two settings that were open questions in the handoff and are now answered.
--
-- **The timezone matters more than it looks.** `localDate` decides which day a
-- briefing is about, and the server clock is UTC. Grant is in Greece — UTC+3 in
-- summer — so a briefing composed at 22:40 local is 19:40 UTC on the same day,
-- but one composed at 00:30 local is 21:30 UTC on the PREVIOUS day. Without a
-- configured zone the morning briefing would occasionally be dated yesterday,
-- and the failure looks like a stale briefing rather than a clock bug.
--
-- Stored as an IANA name, never as an offset: Greece observes DST, and an
-- offset is right for half the year. `Europe/Athens` carries its own rules.
--
-- **The avatar base is a URL, at last.** 0032 wrote `staff.avatar_ref` as a
-- repository path and said, in as many words, that a guessed CDN URL would put
-- a broken image in the database and call it configuration. The images are now
-- actually hosted, so the base is a fact rather than a guess — and it lives
-- here rather than in an environment variable because it is configuration the
-- application reads, not a secret.
--
-- `identityFor` still refuses to build a URL from a non-HTTPS base, so a
-- mistake here degrades to the emoji fallback rather than to a broken image.

begin;

insert into public.system_config (key, value, description, self_adjustable)
values
  (
    'grant.timezone',
    '"Europe/Athens"'::jsonb,
    'IANA timezone for anything that has to decide which DAY something belongs to - briefings above all. An IANA name rather than an offset because Greece observes DST.',
    false
  ),
  (
    'staff.avatar_base_url',
    '"https://baujwlzcziasnfhhkchg.supabase.co/storage/v1/object/public/avatars"'::jsonb,
    'Public HTTPS base under which staff.avatar_ref paths are served. Slack icon_url needs a reachable image; without this the presentation degrades to a per-role emoji and says so.',
    false
  )
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

commit;
