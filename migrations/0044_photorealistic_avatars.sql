-- 0044 — the avatars are photographs now, and they are hosted
--
-- Two changes, and the first is a reversal worth recording rather than quietly
-- performing.
--
-- **The avatars are photorealistic.** The earlier judgement, made deliberately
-- and written down in `docs/implementation-plan.md`, was that they should not
-- be: a synthetic photograph is a claim about a person who does not exist, and
-- §12 spends its length on not presenting inference as observation.
--
-- Grant has asked for photographs, twice, having read that reasoning. The
-- concern was about how the images might read to someone who did not know what
-- the team is; this is a private workspace with one member, who knows exactly
-- what it is. So the objection does not apply here, and it was his call
-- regardless.
--
-- The illustrated set is kept at `assets/avatars/` rather than deleted, and the
-- generator still works. Reverting is one UPDATE and one config value.
--
-- **They are served over HTTPS**, from Supabase Storage's public `avatars`
-- bucket. 0032 wrote `avatar_ref` as a repository path and said explicitly that
-- a guessed URL would put a broken image in the database and call it
-- configuration. It is not a guess any more — the files were uploaded and read
-- back before this migration was written.
--
-- Still a PATH, not a URL. The base lives in `system_config` (0043) and
-- `identityFor` joins them, which keeps one thing to change if the bucket ever
-- moves, and keeps the refusal to build a non-HTTPS URL in one place.

begin;

update public.staff
   set avatar_ref = slug || '.jpg'
 where permanent;

comment on column public.staff.avatar_ref is
  'Path to the staff photograph, relative to system_config staff.avatar_base_url. '
  'Not a URL: the base is configuration and belongs in one place, and the '
  'presentation layer refuses to build a URL from a non-HTTPS base rather than '
  'shipping a broken image.';

commit;
