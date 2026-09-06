# The seven Telegram bots — names, roles, and what to type

**For Grant.** Everything below is what BotFather will ask you for, in the order
it asks. Nothing here is guesswork about the roles: they are §9's eight
permanent staff, already seeded in the database (`migrations/0019`).

---

## Eight staff, seven new bots

The Chief of Staff bot already exists — **@agenticteamgrantbot**, the one you
messaged. It stays as it is. Seven more, one per remaining role.

| # | Role | Bot name | Username | Description (BotFather `/setdescription`) |
|---|---|---|---|---|
| — | Chief of Staff | *(exists)* | `@agenticteamgrantbot` | Routes work, decides who is needed and who is not |
| 1 | Research Director | Research · AI Team | `@atg_research_bot` | Gathers evidence and reports what the sources actually support |
| 2 | Strategy Director | Strategy · AI Team | `@atg_strategy_bot` | Turns evidence into options with trade-offs, and recommends one |
| 3 | Growth & Marketing Director | Growth · AI Team | `@atg_growth_bot` | Positioning, messaging, audience and demand |
| 4 | Finance & Data Director | Finance · AI Team | `@atg_finance_bot` | Numbers, unit economics, and whether a figure is measured or modelled |
| 5 | Operations Director | Operations · AI Team | `@atg_operations_bot` | Sequencing, dependencies, capacity and follow-through |
| 6 | Quality & Risk Director | Quality · AI Team | `@atg_quality_bot` | Reviews substantive output before it commits. Can say no |
| 7 | Communications & Creative Director | Comms · AI Team | `@atg_comms_bot` | How things are said to people outside the team |

**Five of the seven exist as of 2026-09-06** — research, strategy, growth,
finance and operations. Their tokens are in the vault under
`telegram.<slug>.bot_token`, the registry is `public.telegram_bots` (migration
0054), and each one's name, short description and description have been set
from the `staff` table by `npm run telegram:configure-staff`.

Quality and Comms are still to make. Nothing waits on them: a staff member with
no bot resolves to null and falls back to the pager, and there is a check that
proves it does.

**One thing the API cannot do: the profile photo.** `setUserProfilePhotos` is
BotFather-only, so each bot's avatar has to be set by hand — message
@BotFather → `/setuserpic` → pick the bot → send the image. The photorealistic
avatars are at
`https://baujwlzcziasnfhhkchg.supabase.co/storage/v1/object/public/avatars/<slug>.jpg`.
Entirely cosmetic; the office already shows these faces in Slack.

Check any time with `npm run telegram:roster`, which probes each token against
`getMe` rather than reporting what a table says.

---

## What you do, once per bot

In a chat with [@BotFather](https://t.me/BotFather):

1. `/newbot`
2. Paste the **Bot name** from the table (this is the display name, and it can
   contain spaces and punctuation).
3. Paste the **Username** (must be unique, must end in `bot`).
4. BotFather replies with a token like `8967954396:AAF...`. **That is the only
   thing I need.**

Then send me the seven tokens together. Everything else — description, about
text, commands, profile photo, webhook, privacy mode — is API-settable and I
will do it (`npm run telegram:configure` already does this for the first bot).

**Do not** press "Enable Groups" or change any other setting; the defaults are
right and the ones that need changing are changed over the API.

---

## Why seven bots rather than one with seven personalities

§9 asks for staff to be distinguishable at a glance, and Telegram — unlike Slack
— has no `chat:write.customize`. A bot cannot post under another name or another
picture. One bot means one avatar and one name for eight people, which is the
exact failure the avatars exist to prevent.

The cost is that each is a separate conversation in your Telegram list. That is
also the benefit: the Quality Director objecting to something arrives in its own
thread rather than in a stream.

---

## What happens after you hand the tokens over

Nothing you have to watch. In order:

1. Each token is stored in the vault, never in the repository or an environment
   variable — §15 is explicit that per-app credentials live in Postgres, one row
   per app, because with several bot identities there is no correct value for a
   single `TELEGRAM_BOT_TOKEN`.
2. Each bot gets its name, description, commands and **profile photo** set over
   the API — the photographs are already generated and hosted.
3. Each gets a webhook pointing at the same endpoint, distinguished by its own
   secret token.
4. `telegram_chats` starts empty for each one, exactly as the first did. **You
   will need to send one message to each new bot**, for the same reason as
   before: Telegram forbids a bot messaging anyone who has not messaged it
   first. Seven "hi"s, once.

Step 4 is worth knowing before you start, because it is the only part that
cannot be automated.
