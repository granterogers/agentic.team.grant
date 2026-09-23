-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITIONS — what Grant's database already contained
-- ---------------------------------------------------------------------------
--
-- Several migrations are not pure schema. They seed rows describing resources
-- Grant had created by hand — a Telegram bot, a stored credential — or they
-- assert that his operational data exists and RAISE when it does not. Those
-- migrations applied cleanly on his database because that database had the
-- state; on a blank one they fail, and the corpus stops at 0054 of 533.
--
-- This file supplies the MINIMUM state that lets the historical corpus replay,
-- so that a fully-migrated schema can be produced at all. It is not part of a
-- fresh user's install. It is scaffolding for building the baseline in
-- `npm run fresh:baseline`, and the baseline is what a fresh user gets.
--
-- Everything here is obviously fake and says so in its own value. Nothing here
-- is a credential. `scripts/fresh/zero-state.ts` refuses to run against
-- anything but a disposable loopback database, which is the other half of why
-- that is safe.
--
-- The rule for adding to this file: add the SMALLEST thing that lets a
-- migration proceed, and write down which migration needed it. A precondition
-- with no migration named is a precondition nobody can retire.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Vault placeholders
--
-- Needed by: 0054 (telegram bots), 0007/0112 (slack, google), and every later
-- migration whose seed reads `vault.secrets where name = '...'`. The names are
-- enumerated from the corpus itself rather than remembered:
--   grep -ohE "vault\.secrets where name = '[^']+'" migrations/*.sql
-- ---------------------------------------------------------------------------
do $$
declare n text;
begin
  foreach n in array array[
    'backup.s3_bucket',
    'google.refresh_token',
    'google.revoking_refresh_token',
    'notebook.storage_state',
    'notion.integration_token',
    'slack.bot_token',
    'slack.signing_secret',
    'telegram.chief.bot_token',
    'telegram.finance-director.bot_token',
    'telegram.growth-director.bot_token',
    'telegram.operations-director.bot_token',
    'telegram.research-director.bot_token',
    'telegram.strategy-director.bot_token',
    'vikunja.api_token'
  ]
  loop
    if not exists (select 1 from vault.secrets where name = n) then
      perform vault.create_secret(
        'PLACEHOLDER-NOT-A-CREDENTIAL',
        n,
        'fresh-install baseline scaffolding; never a real value');
    end if;
  end loop;
end $$;
