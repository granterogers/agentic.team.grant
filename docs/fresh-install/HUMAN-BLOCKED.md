# HUMAN_BLOCKED — actions no software may perform

An item belongs here ONLY if it survives §8's filter: repository code cannot do
it, no official CLI can, no official API can, no safe supported browser
automation can, and it genuinely requires identity verification, consent,
payment, CAPTCHA, one-time secret retrieval, provider policy, or a subjective
human choice.

Each entry states the EXACT action, with URLs, per Grant's standing
instruction: *"Always be explicit with instructions!!! ... include full
instructions each and every time with URLs, steps to follow, etc."*

**These are also in `src/fresh/contract.ts`, which is where they are
maintained.** This file is the report; the contract is the source. If the two
disagree, the contract is right — that is the whole point of §6.

---

## For a working office, there are THREE, and they take about ten minutes

### HB-1 · Create a Supabase project — *identity verification*

**Why no software may do it:** account creation requires a verified identity
and acceptance of terms. There is no API that creates an account.

1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is quickest).
2. Press **New project**.
3. Name it anything — `my-team` is fine.
4. Choose a region near you, and let it generate a database password. **You do
   not need to keep the password**: nothing in this setup asks for it.
5. Choose the **Free** plan.
6. Press **Create new project** and wait about two minutes.
7. Look at the address bar: `https://supabase.com/dashboard/project/XXXXXXXX`.
   That `XXXXXXXX` is your project reference. Copy it.
8. `export SUPABASE_PROJECT_REF=<the reference>`

**Cost:** free. 500MB database, 1GB storage.
**Time:** about 5 minutes.

### HB-2 · Fetch a Supabase access token — *one-time secret retrieval*

**Why no software may do it:** the token is displayed exactly once, in a
browser, to an authenticated human. There is no API that mints one.

1. Go to https://supabase.com/dashboard/account/tokens
2. Press **Generate new token**.
3. Name it `agentic team setup`.
4. **Copy it immediately.** Supabase shows it once and never again.
5. `export SUPABASE_ACCESS_TOKEN=<the token>`
6. Do not paste it into a chat, a file, or a commit.

**Cost:** free. **Time:** about 2 minutes.

### HB-3 · Fetch an OpenRouter API key — *one-time secret retrieval*

**Why no software may do it:** same shape. An account, then a key shown once.

1. Go to https://openrouter.ai and sign in.
2. Go to https://openrouter.ai/keys
3. Press **Create Key**, name it `agentic team`, copy it.
4. You do **not** have to add credit — the office prefers free models and falls
   back through several of them.
5. `npm run fresh:secret -- openrouter.api_key` — it prompts, and does not echo
   what you type.

**Cost:** free. **Time:** about 3 minutes.

---

## For the first surface to talk to it on, there is ONE more

### HB-4 · Create one Telegram bot — *provider policy*

**Why no software may do it:** Telegram creates bots only through a
conversation with @BotFather, by policy. There is no API for it, and automating
the conversation would be circumventing a provider's stated rule.

**One bot, not eight.** This is the Chief of Staff, and she is the only one who
messages you. Everybody else still does the work and still writes it down.

1. Open Telegram and search for **@BotFather** (blue tick).
2. Send `/newbot`
3. Display name: anything — *My Chief of Staff*.
4. Username: must end in `bot` — e.g. `my_chief_of_staff_bot`. If it is taken,
   he says so; try another.
5. He replies with *"Use this token to access the HTTP API:"* and the token.
   Copy it.
6. `npm run fresh:secret -- telegram.chief.bot_token`

**Cost:** free. **Time:** about 4 minutes.

---

## What this run could NOT prove, and why

| Not proven | Because | What WAS proven instead |
|---|---|---|
| The office answering with a real model | HB-3 needs an account | The whole path with a stand-in answering over real HTTPS: the router chose the provider, resolved the credential from the vault, made a real request, parsed a real response, and the handler, gates, review and output insert were all live. See journey G. |
| Installation into a real Supabase project | HB-1 needs an account | Installation into a genuinely blank Postgres 16 with a Supabase compatibility shim, through the same `SqlExecutor` interface the Management API uses. Journeys B, C, D, H, I. |
| The deployed worker and gateway answering over HTTP | HB-1, and Supabase Edge Functions | The same worker code running in process against the installed database, taking a real job off the real queue. Journey G. |
| A Telegram message arriving | HB-4 | The instruction path itself, through `inbound_commands` and `app.enqueue_inbound` — the same door a Telegram message uses. Journey G. |

**Two things about that table.** The first column is what an account would add,
not what is untested — every one of them has a proof beside it that goes as far
as an account-free environment can. The second is that the gap is named rather
than papered over: §22 is explicit that a green deployment without a real
interaction is not done, and the honest position is that this is proven up to
the model and not through it.

---

## Deliberately NOT here

These were considered and rejected as human-only, because software can do them:

| Not human-only | Done by |
|---|---|
| Applying the schema | `npm run fresh:install` |
| Telling the office its own address | `npm run fresh:configure` |
| Generating the office's API token | `npm run fresh:configure` — generated, never chosen |
| Connecting a stored key to the provider that uses it | `npm run fresh:configure`, via `app.connect_provider_key` (0536) |
| Deciding what is still missing | `npm run fresh:doctor` |
| Proving the office works | `npm run fresh:first-use` |
