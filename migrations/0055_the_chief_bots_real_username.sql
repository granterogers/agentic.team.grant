-- 0055 — the Chief of Staff bot's actual username
--
-- 0054 seeded it as `atg_chief_bot`, taken from the roster document, which
-- describes the seven bots Grant was going to create. The Chief of Staff bot
-- predates that document and is called `@agenticteamgrantbot`.
--
-- Not cosmetic: the username is how a person finds the bot to message it, and
-- the registry is where anything looking one up will read. A registry that
-- names a bot nobody can open is worse than one with no name at all, because
-- the wrong name looks like an answer.
--
-- Read from Telegram's own `getMe` rather than from the roster, which is what
-- 0054 should have done: the roster records an intention and the API records
-- a fact.

begin;

update public.telegram_bots
   set username = 'agenticteamgrantbot'
 where bot_id = '8967954396';

commit;
