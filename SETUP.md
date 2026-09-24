<!--
  GENERATED — do not edit by hand.

  Written by `npm run fresh:docs` from `src/fresh/contract.ts`, which is the
  single source of truth for what an installation of this office needs.
  `npm run check:fresh` fails if this file and the contract disagree, so an
  edit here is a change that will be overwritten. Change the contract.
-->

# Set up your own Agentic Team

This is the one page to follow. Anything else in this repository that looks like setup instructions is a record of how **this particular** office was built, and is kept for history rather than for you.

## What you are setting up

Eight members of staff — a Chief of Staff, and directors for strategy, research, finance, operations, growth, communications and quality. You give them work in ordinary language. They queue it, decide between them who should answer, do it, check it before it commits, and tell you. Only the Chief of Staff messages you; everybody else still does the work and writes it down where you can read it.

## What it costs

Nothing, for everything in the required list below. Supabase’s free tier holds the office, and the models it thinks with are free ones. The single paid thing in the whole system is talking to it out loud, which is optional and switched off until you ask for it.

## How long

About **10 minutes of your time**, spread across **3 things only you can do**: A Supabase project of your own; A Supabase access token; An OpenRouter API key. Everything else is a command you run and wait a moment for.

## If you only remember one thing

```bash
npm run fresh:doctor
```

It looks at what you have, tells you the **one** thing to do next, and says whether that thing is yours or the computer’s. Run it whenever you are unsure, including halfway through. Nothing here has to be done in one sitting, and nothing is damaged by stopping.

---

## The required steps

### 1. Node.js 22 and npm

Everything in this repository runs on it, including the installer.

**Quick, and yours to do.** Install Node 22 from https://nodejs.org, or run: nvm install 22

### 2. The repository’s dependencies

Nothing runs until they are installed. Takes a few seconds.

**The computer does this one.** Run:

```bash
npm ci
```

### 3. A Supabase project of your own

This is where the office lives — every project, task, document, job and credential. The free tier is enough: 500MB of database and 1GB of files.

**This one needs you.** No software may do it — identity verification — so it is on your list rather than the computer's. About 5 minutes. Cost: free.

1. Go to https://supabase.com/dashboard and sign in (GitHub sign-in is quickest).
2. Press “New project”.
3. Name it anything you like — “my-team” is fine.
4. Choose a region near you, and let it generate a database password. You do not need to keep the password: nothing in this setup asks for it.
5. Choose the Free plan.
6. Press “Create new project” and wait about two minutes for it to finish provisioning.
7. When it is ready, look at the browser address bar. It reads https://supabase.com/dashboard/project/XXXXXXXX — that XXXXXXXX is your project reference. Copy it.

### 4. Tell this repository which project is yours

Every command needs to know which database to talk to. Until you set it, the installer refuses to guess — and it is right to: guessing would mean reaching into somebody else’s.

**The computer does this one.** Run:

```bash
export SUPABASE_PROJECT_REF=<the reference you copied>
```

### 5. A Supabase access token

How this repository applies the database schema and deploys the office’s functions. It is shown once and never again, which is why a person has to fetch it.

**This one needs you.** No software may do it — one-time secret retrieval — so it is on your list rather than the computer's. About 2 minutes. Cost: free.

1. Go to https://supabase.com/dashboard/account/tokens
2. Press “Generate new token”.
3. Name it “agentic team setup”.
4. Copy the token immediately — Supabase shows it once and will never show it again.
5. In your terminal: export SUPABASE_ACCESS_TOKEN=<the token>
6. Do not paste it into a chat, a file, or a commit.

### 6. The office’s database

The schema, and the seed that makes the office itself: the eight staff, what each of them is for, which tools exist and what each one may do.

**The computer does this one.** Run:

```bash
npm run fresh:install
```

### 7. Tell the office its own address

The office composes URLs about itself — where its MCP server is, where Google should send you back. It will say nothing rather than guess, so until this is set those come out blank.

**The computer does this one.** Run:

```bash
npm run fresh:configure
```

### 8. An OpenRouter API key

This is the office’s ability to think. Without it every member can be asked something and none of them can answer.

**This one needs you.** No software may do it — one-time secret retrieval — so it is on your list rather than the computer's. About 3 minutes. Cost: free — free models are the default; paid models are opt-in.

1. Go to https://openrouter.ai and sign in.
2. Go to https://openrouter.ai/keys
3. Press “Create Key”, name it “agentic team”, and copy it.
4. You do not have to add credit: the office prefers free models and falls back through several of them.
5. Store it in your office’s vault (never in a file): npm run fresh:secret -- openrouter.api_key
6. It will prompt you. The value is not echoed, not logged, and not written to disk.

### 9. The office’s own API token

One bearer token guards everything the office exposes over HTTP. It is generated for you — you never choose it and never type it.

**The computer does this one.** Run:

```bash
npm run fresh:configure
```

### 10. The worker

The part that actually does the work: it takes a job off the queue, chooses who should answer, asks them, and writes down what they said.

**The computer does this one.** Run:

```bash
npm run deploy:worker
```

### 11. The office’s HTTP gateway

How anything outside the database reads or writes the office — including you.

**The computer does this one.** Run:

```bash
npm run deploy:hq
```

### 12. Your first real instruction

Setup is not finished when the configuration is complete. It is finished when you have asked the office something and it has answered.

**The computer does this one.** Run:

```bash
npm run fresh:first-use
```

---

## When it is done

Setup is not finished when the configuration is complete. It is finished when you have asked your office something and it has answered — which is what the last required step does, and why it is on the list.

## Optional — add any of these later, or never

None of these is needed for the office to work, and a missing one never breaks anything else. Add one when you want what it does.

### A Telegram bot to talk to

*talking to the office from your phone — the simplest first surface* — One bot, not eight. This is the Chief of Staff, and she is the only one who messages you; everybody else still does the work and writes it down.

Needs you (provider policy), about 4 minutes. Cost: free.

1. Open Telegram and search for @BotFather (he has a blue tick).
2. Send him: /newbot
3. He asks for a display name. Anything: “My Chief of Staff”.
4. He asks for a username. It must end in “bot” — for example my_chief_of_staff_bot. If it is taken he will say so; try another.
5. He replies with a line reading “Use this token to access the HTTP API:” followed by the token. Copy it.
6. Store it: npm run fresh:secret -- telegram.chief.bot_token
7. Then: npm run telegram:configure — this registers the bot, points Telegram at your office, and verifies it by asking Telegram who the bot is.

### The web dashboard

*seeing the office in a browser rather than only messaging it* — A second surface, not a required one. The office is fully usable from Telegram alone, and the dashboard needs a Vercel account to host.

Run: `npm run deploy:page`

### Slack

*a channel per project, and talking to the office from Slack* — Useful if you already live in Slack. Nothing else depends on it.

Needs you (consent), about 10 minutes. Cost: free.

1. Go to https://api.slack.com/apps and press “Create New App” → “From an app manifest”.
2. Choose the workspace you want the office in.
3. Give it a name, choose the workspace, and paste the manifest from docs/slack-app-status.md.
4. Press “Install to Workspace” and approve the permissions.
5. From “OAuth & Permissions”, copy the Bot User OAuth Token (it starts xoxb-).
6. Store it: npm run fresh:secret -- slack.bot_token
7. From “Basic Information”, copy the Signing Secret and store it: npm run fresh:secret -- slack.signing_secret
8. Then: npm run deploy:slack

### Google — Calendar, Gmail, Drive

*the office reading your diary, your mail and your documents* — It lets the team answer questions about your week and cite your own files. It can never send mail: that is off by policy, whatever the permission allows.

Needs you (consent), about 20 minutes. Cost: free.

1. This one is genuinely fiddly and takes about twenty minutes.
2. Follow docs/google-cloud-tts-credential.md, which has the console steps in order.
3. Then: npm run deploy:google — it deploys the OAuth callback your office needs.
4. Then press Connect on the office’s Settings page.

### Notion

*mirroring the office’s documents into a Notion database* — Only if you want the output somewhere you already read.

Needs you (consent), about 5 minutes. Cost: free.

1. Go to https://www.notion.so/my-integrations and press “New integration”.
2. Name it “Agentic Team”, choose your workspace, and press Save.
3. Copy the Internal Integration Secret.
4. Store it: npm run fresh:secret -- notion.integration_token
5. In Notion, open the page you want the office to write under, press the ⋯ menu → Connections → and add your integration.

### Talking to the office out loud

*a spoken conversation with the Chief of Staff* — This is the one part that genuinely costs money: it uses OpenAI’s realtime voice API, which has no free tier. Everything else here is free.

Needs you (payment), about 5 minutes. Cost: paid — OpenAI realtime pricing, roughly a few pence per minute of conversation.

1. Go to https://platform.openai.com/api-keys and create a key.
2. You must add a payment method — the realtime voice API has no free tier.
3. Store it: npm run fresh:secret -- openai.api_key
4. Then: npm run deploy:voice

### Off-site backups

*a copy of the office somewhere other than Supabase* — Worth doing once the office holds something you would miss. Not worth doing before your first conversation with it.

Run: `npm run bootstrap:backup-credentials`

---

## If something goes wrong

**Run `npm run fresh:doctor`.** It is the answer to most of this.

| What happened | What to do |
|---|---|
| You stopped halfway through | Run the same command again. Nothing is left half-done: the install is a single step that either happens or does not. |
| A credential is wrong | The doctor names which one and where to get another. Replace it and carry on from where you were. |
| You want to start again | Make a new, empty database and install into that. Installing over an existing office is refused, on purpose. |
| You installed a while ago and have pulled new changes | `npm run migrate` — it applies only what is new. |
| Something else | `npm run fresh:doctor`, then `npm run fresh:accept` |

## About your secrets

Every credential goes into your own database’s vault, through `npm run fresh:secret`, which prompts you and does not echo what you type. It refuses a value passed on the command line — an argument lives in your shell history, in `ps` output while it runs, and in your terminal scrollback. Nothing in this repository ever prints a credential back to you, including when it is the thing that is wrong.

## Proving it all still works

```bash
npm run fresh:accept
```

Installs an office into a throwaway database, asks it a question, and checks ten separate things about the experience you have just had — including that nothing in your office belongs to anybody else. It needs no account and costs nothing.
