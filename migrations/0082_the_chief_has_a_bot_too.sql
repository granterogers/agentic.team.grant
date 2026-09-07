-- 0082 — The chief has a bot too
--
-- 0079 copied each person's bot username onto their staff row by joining
-- `telegram_bots` on `staff_slug`. Every director got one and Claire got null,
-- so the team page says "no bot yet" beside the one person Grant messages most.
--
-- The join was right and the data is shaped differently than it looks:
-- `@agenticteamgrantbot` is registered as the PAGER, with `staff_slug` null,
-- because it is also the bot that carries alerts and vault exports that belong
-- to no one person. It is the Chief of Staff's bot and it is not only that.
--
-- So this is a fact about the roster, recorded where the roster is, rather than
-- a change to the registry. Widening the join would have been the other fix and
-- it is worse: it would make the pager a director's bot, and the next thing to
-- read `telegram_bots` would deliver Grant's backup passphrase in Claire's
-- voice.

begin;

update public.staff s
   set telegram_username = b.username
  from public.telegram_bots b
 where s.slug = 'chief-of-staff'
   and b.staff_slug is null
   and b.enabled
   and b.username is not null
   and s.telegram_username is null;

commit;
