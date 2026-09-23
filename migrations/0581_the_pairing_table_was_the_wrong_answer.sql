-- Taking out the pairing flow, whole.
--
-- 0577 added a table and four functions so a browser could ask to be signed in
-- and Grant could approve it with a tap in Telegram. It worked, it was driven
-- rather than read, and its detectors were proved able to fail — and it was the
-- wrong answer to the question.
--
-- Grant, 24 September:
--
--   "Grant did not ask to replace 'Paste the office token' with 'Approve an
--    office token through Telegram.' He does not want an office-token
--    interaction in the normal user experience AT ALL... The normal user should
--    not: see an office token; paste an office token; copy an office token;
--    receive an office token; approve an office token through Telegram; enter a
--    pairing code; understand what an office token is."
--
-- Every one of those describes what 0577 built. Making the ceremony nicer was
-- never the ask; removing it was.
--
-- WHAT REPLACED IT. `public.office_members` (0580) and this project's own
-- Supabase Auth, which had never been used — `auth.users` held zero rows. A
-- person signs in with an emailed link and holds THEIR OWN short-lived
-- session; the gateway verifies it with Supabase and checks the allowlist. The
-- office's bearer token is unchanged and is what machines present. ADR-0043.
--
-- WHAT IS LOST BY DROPPING THE TABLE. Nothing that is anybody's record. It
-- held one row per browser asking to be let in, each spent or expired within
-- five minutes, and the sweep deleted them after a day. There is no history
-- here to keep.

drop function if exists public.sign_in_begin(text);
drop function if exists public.sign_in_approve(text);
drop function if exists public.sign_in_claim(uuid);
drop function if exists public.sign_in_sweep();

drop function if exists app.sign_in_begin(text);
drop function if exists app.sign_in_approve(text);
drop function if exists app.sign_in_claim(uuid);
drop function if exists app.sign_in_sweep();

drop table if exists public.sign_in_requests;
